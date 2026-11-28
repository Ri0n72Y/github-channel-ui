import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import issueCreate from '../api/github-issue-create.mjs'
import { SESSION_COOKIE, sessionCookie } from '../api/_oauth.mjs'

// No real GitHub writes: every outbound request is intercepted by the fixture.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const appKey = privateKey.export({ type: 'pkcs8', format: 'pem' })
const mockResponse = (status, data) => Response.json(data, { status })
const target = (owner = 'sample', name = 'repo') => ({
  id: owner === 'sample' ? 50 : 51, full_name: owner + '/' + name,
  private: false, owner: { login: owner, type: 'User' },
})
const install = owner => ({ id: 77, account: { login: owner }, suspended_at: null })

function fakeGitHub({ probe = 'ok', member = 'ok', privateRepo = false } = {}) {
  const calls = []
  const fetcher = async (url, opts = {}) => {
    const u = new URL(url), path = u.pathname, method = opts.method || 'GET'
    assert.equal(u.origin, 'https://api.github.com')
    calls.push({ path, method, auth: opts.headers?.Authorization, body: opts.body })
    if (path === '/repos/sample/repo' || path === '/repos/other/repo') {
      if (privateRepo) return mockResponse(200, { ...target(), private: true })
      return mockResponse(200, path === '/repos/sample/repo' ? target() : target('other'))
    }
    if (path === '/repos/sample/repo/installation' || path === '/repos/other/repo/installation') {
      if (probe === 'removed') return mockResponse(404, { message: 'not installed' })
      if (probe === 'forbidden') return mockResponse(403, { message: 'forbidden' })
      if (probe === 'limited') return mockResponse(429, { message: 'rate limit' })
      return mockResponse(200, { ...install(path.includes('/other/') ? 'other' : 'sample'),
        suspended_at: probe === 'suspended' ? '2026-11-22T00:00:00Z' : null })
    }
    if (path === '/user/installations/77/repositories') {
      if (member === 'forbidden') return mockResponse(403, { message: 'forbidden' })
      if (member === 'limited') return Response.json(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
      return mockResponse(200, { repositories: member === 'ok' ? [target()] : [] })
    }
    if (path === '/repos/sample/repo/issues' && method === 'POST') {
      return mockResponse(201, { number: 42, title: JSON.parse(opts.body).title,
        html_url: 'https://github.com/sample/repo/issues/42' })
    }
    throw Error('Unexpected GitHub API request: ' + method + ' ' + path)
  }
  return { fetcher, calls,
    postCount: () => calls.filter(x => x.method === 'POST' && /\/issues$/.test(x.path)).length }
}

async function withSession(task) {
  const original = globalThis.fetch
  const keys = ['GITHUB_APP_ID','GITHUB_APP_PRIVATE_KEY','GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET','GITHUB_OAUTH_CALLBACK_URL','GITHUB_OAUTH_COOKIE_KEY',
    'GITHUB_INSTALLATION_ID']
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  const secret = randomBytes(32).toString('base64url')
  Object.assign(process.env, {
    GITHUB_APP_ID: '1234', GITHUB_APP_PRIVATE_KEY: appKey,
    GITHUB_APP_CLIENT_ID: 'Iv-example', GITHUB_APP_CLIENT_SECRET: 'test-secret',
    GITHUB_OAUTH_CALLBACK_URL: 'https://example.test/api/github-callback',
    GITHUB_OAUTH_COOKIE_KEY: secret,
  })
  delete process.env.GITHUB_INSTALLATION_ID
  const cookie = sessionCookie('user-oauth-token', 3600, Buffer.from(secret, 'base64url'))
  const request = ({ owner = 'sample', repo = 'repo', origin = 'https://example.test',
    loggedIn = true, ...fields } = {}) => new Request('https://example.test/api/github-issue-create', {
    method: 'POST', headers: {
      origin, 'content-type': 'application/json', 'x-labourchain-write': '1',
      ...(loggedIn ? { cookie: SESSION_COOKIE + '=' + cookie.split('=')[1].split(';')[0] } : {}),
    },
    body: JSON.stringify({ owner, repo, title: 'Scoped Issue', body: '', ...fields }),
  })
  try { await task({ request, mock: config => {
    const instance = fakeGitHub(config)
    globalThis.fetch = instance.fetcher
    return instance
  } }) }
  finally {
    globalThis.fetch = original
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

test('#101 Issue POST resolves its exact App Installation without a global ID', async () =>
  withSession(async ({ request, mock }) => {
    const github = mock()
    const response = await issueCreate.fetch(request())
    assert.equal(response.status, 201, await response.clone().text())
    assert.deepEqual(await response.json(), { issue: { number: 42, title: 'Scoped Issue',
      html_url: 'https://github.com/sample/repo/issues/42' } })
    assert.equal(github.postCount(), 1)
    assert.ok(github.calls.some(c => c.path === '/repos/sample/repo/installation'))
    assert.ok(github.calls.some(c => c.path === '/user/installations/77/repositories'))
    assert.ok(github.calls.some(c => c.path === '/repos/sample/repo/issues' &&
      c.method === 'POST' && c.auth === 'Bearer user-oauth-token'))
    assert.ok(!github.calls.some(c => c.method === 'POST' &&
      c.path.startsWith('/app/installations/')))
  }))

test('#101 revoked, suspended, private, cross-repo and throttled targets never create Issues', async () =>
  withSession(async ({ request, mock }) => {
    const cases = [
      { label: 'App no longer installed', config: { probe: 'removed' }, expected: 403 },
      { label: 'suspended installation', config: { probe: 'suspended' }, expected: 403 },
      { label: 'private repository', config: { privateRepo: true }, expected: 404 },
      { label: 'App lookup forbidden', config: { probe: 'forbidden' }, expected: 403 },
      { label: 'App lookup throttled', config: { probe: 'limited' }, expected: 429 },
      { label: 'user membership revoked', config: { member: 'removed' }, expected: 403 },
      { label: 'membership forbidden', config: { member: 'forbidden' }, expected: 403 },
      { label: 'membership rate limited', config: { member: 'limited' }, expected: 429 },
      { label: 'other repository outside selected membership',
        config: {}, request: { owner: 'other' }, expected: 403 },
      { label: 'cross-origin', config: {}, request: { origin: 'https://evil.example' }, expected: 403 },
      { label: 'no user session', config: {}, request: { loggedIn: false }, expected: 401 },
    ]
    for (const scenario of cases) {
      const github = mock(scenario.config)
      const response = await issueCreate.fetch(request(scenario.request))
      assert.equal(response.status, scenario.expected,
        scenario.label + ': ' + await response.clone().text())
      assert.equal(github.postCount(), 0, scenario.label + ': unexpected GitHub Issue POST')
    }
  }))
