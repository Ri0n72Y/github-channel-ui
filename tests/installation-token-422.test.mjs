import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { issueReadAccess, IssueAccessError } from '../api/_issue-access.mjs'
import repoHome from '../api/_repo-home.mjs'
import repoFeed from '../api/_repo-feed.mjs'
import issueDetail from '../api/_issue-detail.mjs'
import issueComments from '../api/_issue-comments.mjs'
import repoConfig from '../api/_repo-config.mjs'
import repoChannels from '../api/_repo-channels.mjs'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = { GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
const repository = {
  id: 50, name: 'hello', full_name: 'octocat/hello', private: false,
  default_branch: 'main', html_url: 'https://github.com/octocat/hello',
  description: 'A public repository',
  owner: { login: 'octocat', type: 'User' },
}
const installation = { id: 17, account: { login: 'octocat' }, suspended_at: null,
  permissions: { issues: 'write', contents: 'read', metadata: 'read' } }
const reply = (status, data, headers = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', ...headers },
  })

function fakeGitHub(options = {}) {
  const calls = []
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname
    const method = init.method || 'GET'
    assert.equal(new URL(url).origin, 'https://api.github.com')
    assert.equal(init.redirect, 'manual')
    calls.push({ path, method, body: init.body, auth: init.headers?.Authorization })
    if (path === '/repos/octocat/hello' && method === 'GET')
      return reply(200, repository)
    if (path === '/repos/octocat/hello/installation' && method === 'GET')
      return options.missingInstallation ? reply(404) :
        reply(200, { id: 17, account: { login: 'octocat' }, suspended_at: null })
    if (path === '/app/installations/17' && method === 'GET')
      return options.installationResponse || reply(200, {
        ...installation, ...options.installation,
      })
    if (path === '/app/installations/17/access_tokens' && method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), {
        repository_ids: [50],
        permissions: { issues: 'read', contents: 'read' },
      }, 'never issue an all-repository token or request unnecessary metadata grants')
      assert.match(init.headers.Authorization, /^Bearer ey/)
      return options.tokenResponse || reply(201, {
        token: 'scoped-read-token', repositories: [{ id: 50 }],
      })
    }
    if (path === '/repos/octocat/hello/branches/main' && method === 'GET')
      return reply(200, { name: 'main', commit: { sha: 'a'.repeat(40) } })
    if (path === '/repos/octocat/hello/readme' && method === 'GET')
      return reply(404)
    if (path === '/repos/octocat/hello/contents/team-member.json' && method === 'GET')
      return reply(404)
    if (path === '/repos/octocat/hello/contents/labourchain.config.yaml' && method === 'GET')
      return reply(404)
    if (path === '/repos/octocat/hello/issues/2' && method === 'GET')
      return reply(200, { id: 2, number: 2, title: 'A normal Issue', body: '',
        state: 'open', html_url: 'https://github.com/octocat/hello/issues/2' })
    if (path === '/repos/octocat/hello/issues/2/comments' && method === 'GET')
      return reply(200, [])
    if (path === '/repos/octocat/hello/issues' && method === 'GET')
      return reply(200, [{ id: 2, number: 2, title: 'A normal Issue', state: 'open' }])
    throw Error('Unexpected mocked GitHub call ' + method + ' ' + path)
  }
  return { fetcher, calls }
}

const readAccess = mock => issueReadAccess({
  owner: 'octocat', repo: 'hello', env, fetcher: mock.fetcher,
})

test('#72 exact repository and minimum read scopes produce a scoped installation token', async () => {
  const mock = fakeGitHub()
  const access = await readAccess(mock)
  assert.equal(access.token, 'scoped-read-token')
  assert.deepEqual(mock.calls.map(c => c.path).slice(0, 4), [
    '/repos/octocat/hello',
    '/repos/octocat/hello/installation',
    '/app/installations/17',
    '/app/installations/17/access_tokens',
  ])
  assert.equal(mock.calls.filter(c => c.path.endsWith('/access_tokens')).length, 1)
})

test('#72 withdrawn installation and missing App grants reject before token issuance', async () => {
  const cases = [
    { missingInstallation: true },
    { installation: { permissions: { issues: 'read', metadata: 'read' } } },
    { installation: { permissions: { contents: 'read', metadata: 'read' } } },
    { installation: { permissions: { issues: 'none', contents: 'read' } } },
    { installation: { id: 18 } },
    { installation: { account: { login: 'other' } } },
    { installation: { suspended_at: '2026-11-15T01:00:00Z' } },
    { installationResponse: reply(404, { message: 'Not Found' }) },
  ]
  for (const item of cases) {
    const mock = fakeGitHub(item)
    await assert.rejects(readAccess(mock),
      error => error instanceof Error && error.status === 403)
    assert.equal(mock.calls.filter(c => c.path.endsWith('/access_tokens')).length,
      0, JSON.stringify(item))
  }
})

test('#72 token creation 422 maps to controlled permission/repository/unknown diagnosis without upstream leakage', async () => {
  const secret = 'sensitive-upstream-diagnostic-never-expose'
  for (const [failure, expected] of [
    [reply(422, { message: secret, errors: [{ field: 'permissions', code: 'invalid' }] }),
      'Installation token permission scope rejected by GitHub (422)'],
    [reply(422, { message: secret, errors: [{ field: 'repository_ids', code: 'invalid' }] }),
      'Installation token repository scope rejected by GitHub (422)'],
    [reply(422, { message: secret, errors: [{ field: 'different', code: 'invalid' }] }),
      'Installation token request rejected by GitHub (422)'],
    [reply(422, { message: secret }),
      'Installation token request rejected by GitHub (422)'],
  ]) {
    const mock = fakeGitHub({ tokenResponse: failure })
    await assert.rejects(readAccess(mock), error => {
      assert.equal(error.status, 422)
      assert.equal(error.message, expected)
      assert.doesNotMatch(error.message, /sensitive-upstream/)
      return true
    })
  }
})

test('#72 invalid token scope, missing token and permission preflight failure do not authorize downstream reads', async () => {
  for (const tokenResponse of [
    reply(201, { token: 'leaked', repositories: [{ id: 50 }, { id: 60 }] }),
    reply(201, { token: 'leaked', repositories: [{ id: 60 }] }),
    reply(201, { repositories: [{ id: 50 }] }),
  ]) {
    const mock = fakeGitHub({ tokenResponse })
    await assert.rejects(readAccess(mock), error => error.status === 502)
    assert.equal(mock.calls.some(c => c.path === '/repos/octocat/hello/issues/2'), false)
  }
  const malformed = fakeGitHub({ installationResponse: reply(200, { ...installation,
    permissions: null }) })
  await assert.rejects(readAccess(malformed), error => error.status === 403)
  const rate = fakeGitHub({ installationResponse: reply(403, {
    message: 'You have exceeded a secondary rate limit.',
  }, { 'retry-after': '60' }) })
  await assert.rejects(readAccess(rate), error => error.status === 429)
})

test('#72 six public read routes use the same exact-installation scoped token flow', async () => {
  const previous = globalThis.fetch
  const backup = { GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY }
  const mock = fakeGitHub()
  globalThis.fetch = mock.fetcher
  Object.assign(process.env, env)
  const cases = [
    [repoHome, '/api/repo-home?owner=octocat&repo=hello&branch=main', 200],
    [repoFeed, '/api/repo-feed?owner=octocat&repo=hello&page=1', 200],
    [issueDetail, '/api/issue-detail?owner=octocat&repo=hello&number=2', 200],
    [issueComments, '/api/issue-comments?owner=octocat&repo=hello&number=2&page=1', 200],
    [repoConfig, '/api/repo-config?owner=octocat&repo=hello', 200],
    [repoChannels, '/api/repo-channels?owner=octocat&repo=hello', 200],
  ]
  try {
    for (const [handler, path, status] of cases) {
      const response = await handler.fetch(new Request('https://labour.test' + path))
      assert.equal(response.status, status, path + ': ' + await response.clone().text())
    }
    assert.equal(mock.calls.filter(c => c.path === '/app/installations/17/access_tokens').length,
      cases.length)
    assert.equal(mock.calls.filter(c => c.path === '/app/installations/17').length,
      cases.length)
    assert.equal(mock.calls.some(c => c.method !== 'GET' &&
      !c.path.endsWith('/access_tokens')), false, 'read routes never mutate GitHub')
  } finally {
    globalThis.fetch = previous
    for (const [key, value] of Object.entries(backup)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
