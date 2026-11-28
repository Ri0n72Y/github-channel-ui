import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepoConfigHandler } from '../api/_repo-config.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'
const http=githubHttpFixture('https://example.test','user-oauth-token')

const OWNER = 'octocat'
const REPO = 'demo'
const BASE = '/repos/' + OWNER + '/' + REPO
const HEAD = 'a'.repeat(40)
const FILE_SHA = 'b'.repeat(40)
const COMMIT_SHA = 'c'.repeat(40)
const NEW_FILE_SHA = 'd'.repeat(40)
const CONFIG = 'namespaces:\n  status:\n    - todo\n  foo: []\n'
const NEXT_CONFIG = 'namespaces:\n  status:\n    - todo\n    - done\n  foo: []\n'
const respond = (status, data, headers = {}) => new Response(
  data == null ? null : JSON.stringify(data),
  { status, headers: { 'content-type': 'application/json', ...headers } },
)
const file = (content, sha = FILE_SHA) => ({
  type: 'file', encoding: 'base64', path: 'labourchain.config.yaml',
  content: Buffer.from(content, 'utf8').toString('base64'),
  size: Buffer.byteLength(content), sha,
})
const issue = (labels = ['foo:old']) => ({
  number: 1, state: 'open', labels: labels.map(name => ({ name })),
})

function actorEntries(options = {}) {
  return {
    '/user': () => respond(200, { id: 7, login: 'fixture-operator' }),
    '/user/installations/17/repositories': () => respond(200, {
      repositories: [{
        full_name: OWNER + '/' + REPO, private: false,
        permissions: options.userPermissions || {
          pull: true, triage: true, push: true, maintain: false, admin: false,
        },
      }],
    }),
    '/app/installations/17': () => respond(200, {
      id: 17, account: { login: 'octocat' }, suspended_at: null,
      permissions: options.appPermissions || {
        contents: 'write', issues: 'write', pull_requests: 'write',
      },
    }),
    [BASE + '/branches/main']: () => respond(200, {
      name: 'main', protected: options.protected !== false, commit: { sha: HEAD },
    }),
    [BASE + '/rules/branches/main']: () => respond(200, options.mainRules || []),
  }
}

function mockFetcher(options = {}) {
  const calls = []
  let mainContent = options.content === undefined ? CONFIG : options.content
  let mainFileSha = options.fileSha || FILE_SHA
  let mainHead = HEAD
  let labels = options.labels || [{ name: 'foo:old' }]
  let currentIssue = options.issue || issue()
  const branches = new Map()
  let createdLabelsCount = 0
  let removedLabelsCount = 0
  let completedPutCount = 0
  const fetcher = async (url, init = {}) => {
    const parsed = new URL(url)
    const path = decodeURIComponent(parsed.pathname)
    const method = (init.method || 'GET').toUpperCase()
    const authorization = init.headers?.Authorization
    calls.push({ path, method, authorization, body: init.body || null })
    if (path === BASE + '/branches/main' && method === 'GET') {
      if (options.failMainAfterLabelCreate && createdLabelsCount > 0) {
        return respond(429, { message: 'rate limited' }, { 'retry-after': '60' })
      }
      if (options.failMainAfterIssueDeletes && removedLabelsCount >= 10) {
        return respond(503, { message: 'temporary upstream error' })
      }
      if (options.failDirectVerification && completedPutCount > 0) {
        return respond(503, { message: 'failed to verify main commit' })
      }
    }
    if (options.failBranchVerification && completedPutCount > 0 &&
        path.startsWith(BASE + '/branches/labourchain/config-')) {
      return respond(503, { message: 'failed to verify maintenance branch commit' })
    }
    if (path === '/user' || path.startsWith('/user/installations/') ||
        path === '/app/installations/17' || path === BASE + '/branches/main' ||
        path === BASE + '/rules/branches/main') {
      const value = actorEntries(options)[path]
      if (path==='/user' || path.startsWith('/user/installations/')) {
        assert.equal(authorization,'Bearer user-oauth-token')
        if(options.notMember&&path.startsWith('/user/installations/'))return respond(200,{repositories:[]})
      }
      if(path==='/app/installations/17')http.assertApp(authorization)
      if (value) return value()
    }
    if (path === BASE) return respond(200, { id:10, private: false, full_name: OWNER + '/' + REPO, owner:{login:OWNER,type:'User'} })
    if (path === BASE+'/installation') {
      http.assertApp(authorization)
      return respond(options.revoked?404:200,{id:17,account:{login:OWNER},suspended_at:null})
    }
    if (path === '/app/installations/17/access_tokens') {
      http.assertApp(authorization)
      assert.deepEqual(JSON.parse(init.body).repository_ids,[10])
      return respond(201,{token:'app-install-read-token'})
    }
    if (path.startsWith(BASE + '/rules/branches/')) {
      const name = path.slice((BASE + '/rules/branches/').length)
      return branches.has(name) && !options.newBranchRulesUnavailable ?
        respond(200, []) : respond(404, {})
    }
    if (path === BASE + '/branches/main') {
      return respond(200, { name: 'main', protected: options.protected !== false,
        commit: { sha: mainHead } })
    }
    if (path.startsWith(BASE + '/branches/')) {
      const name = path.slice((BASE + '/branches/').length)
      const entry = branches.get(name)
      return entry ? respond(200, { name, protected: false, commit: { sha: entry.head } }) : respond(404, {})
    }
    if (path === BASE + '/contents/labourchain.config.yaml' && method === 'GET') {
      const ref = parsed.searchParams.get('ref') || 'main'
      if (ref === 'main') return mainContent == null ? respond(404, {}) : respond(200, file(mainContent, mainFileSha))
      const entry = branches.get(ref)
      return entry ? respond(200, file(entry.content, entry.fileSha)) : respond(404, {})
    }
    if (path === BASE + '/git/refs' && method === 'POST') {
      const body = JSON.parse(init.body)
      const name = body.ref.replace('refs/heads/', '')
      branches.set(name, { content: mainContent, fileSha: mainFileSha, head: body.sha })
      return respond(201, { ref: body.ref, object: { sha: body.sha } })
    }
    if (path.startsWith(BASE + '/git/ref/heads/')) {
      const name = path.slice((BASE + '/git/ref/heads/').length)
      const entry = branches.get(name)
      return entry ? respond(200, { object: { sha: entry.head } }) : respond(404, {})
    }
    if (path === BASE + '/contents/labourchain.config.yaml' && method === 'PUT') {
      const body = JSON.parse(init.body)
      const next = Buffer.from(body.content, 'base64').toString('utf8')
      if (body.branch === 'main') {
        mainContent = next; mainFileSha = NEW_FILE_SHA; mainHead = COMMIT_SHA
      } else {
        const entry = branches.get(body.branch)
        if (!entry) return respond(404, {})
        entry.content = next; entry.fileSha = NEW_FILE_SHA; entry.head = COMMIT_SHA
      }
      completedPutCount++
      return respond(200, { commit: { sha: COMMIT_SHA }, content: { sha: NEW_FILE_SHA } })
    }
    if (path === BASE + '/pulls' && method === 'POST') {
      return respond(201, { number: 88, html_url: 'https://github.com/octocat/demo/pull/88' })
    }
    if (path === BASE + '/labels' && method === 'GET') return respond(200, labels)
    if (path === BASE + '/labels' && method === 'POST') {
      const data = JSON.parse(init.body)
      labels = [...labels, { name: data.name, color: data.color }]
      createdLabelsCount++
      return respond(201, { name: data.name, color: data.color })
    }
    if (path.startsWith(BASE + '/labels/') && method === 'GET') {
      const name = path.slice((BASE + '/labels/').length)
      const label = labels.find(item => item.name === name)
      return label ? respond(200, label) : respond(404, {})
    }
    if (path === BASE + '/issues' && method === 'GET') return respond(200, [currentIssue])
    if (path === BASE + '/issues/1' && method === 'GET') return respond(200, currentIssue)
    if (path.startsWith(BASE + '/issues/1/labels/') && method === 'DELETE') {
      const name = path.slice((BASE + '/issues/1/labels/').length)
      currentIssue = { ...currentIssue,
        labels: currentIssue.labels.filter(label => label.name !== name) }
      removedLabelsCount++
      return respond(200, currentIssue.labels)
    }
    return respond(404, { message: 'Unexpected ' + method + ' ' + path })
  }
  http.use(fetcher)
  return { fetcher, calls, getIssue: () => currentIssue,
    getLabels: () => labels, getMainContent: () => mainContent }
}

const writes = calls => calls.filter(call=>call.method!=='GET' && !call.path.endsWith('/access_tokens'))

test('repo-config public GET reads only main and exposes a default preview without login', async () => {
  const mock = mockFetcher({ content: null })
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(new Request(
    'https://example.test/api/repo-config?owner=octocat&repo=demo'))
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.state, 'config_missing')
  assert.equal(data.branch, 'main')
  assert.equal(data.config.state, 'config_missing')
  assert.match(data.config.defaultPreview, /channel:/)
  assert.equal(data.canApply, false)
  assert.deepEqual(writes(mock.calls),[])
})

test('repo-config rejects a caller-selected branch', async () => {
  const handler = createRepoConfigHandler()
  const response = await handler.fetch(new Request(
    'https://example.test/api/repo-config?owner=octocat&repo=demo&branch=feature'))
  const data = await response.json()
  assert.equal(response.status, 400)
  assert.equal(data.state, 'invalid_target')
})

test('protected Config update uses OAuth user identity, maintenance branch and a PR', async () => {
  const mock = mockFetcher()
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: HEAD, expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.state, 'awaiting_pr_merge')
  assert.equal(data.prUrl, 'https://github.com/octocat/demo/pull/88')
  assert.equal(data.branch.startsWith('labourchain/config-'), true)
  assert.ok(mock.calls.some(call => call.method === 'POST' && call.path === BASE + '/git/refs' &&
    call.authorization === 'Bearer user-oauth-token'))
  assert.ok(mock.calls.some(call => call.method === 'PUT' &&
    call.path === BASE + '/contents/labourchain.config.yaml' &&
    call.authorization === 'Bearer user-oauth-token'))
  assert.ok(mock.calls.some(call => call.method === 'POST' && call.path === BASE + '/pulls' &&
    call.authorization === 'Bearer user-oauth-token'))
  http.assertApp(mock.calls.find(call => call.path === '/app/installations/17').authorization)
  assert.ok(!mock.calls.some(call => call.authorization === 'Bearer app-install-read-token'))
  assert.equal(mock.getMainContent(), CONFIG)
})

async function syncPreviewId(mock) {
  const response=await createRepoConfigHandler({fetcher:mock.fetcher}).fetch(new Request(
    'https://example.test/api/repo-config?owner='+OWNER+'&repo='+REPO))
  assert.equal(response.status,200)
  const preview=await response.json()
  assert.equal(preview.state,'sync_pending')
  assert.match(preview.snapshotId,/^[a-f0-9]{64}$/)
  mock.calls.length=0
  return preview.snapshotId
}

test('Label sync requires explicit cleanup confirmation and uses exact DELETE with OAuth user token', async () => {
  const mock = mockFetcher({
    content: 'namespaces:\n  foo: []\n',
    issue: issue(),
    labels: [{ name: 'foo:old' }],
  })
  const previewId = await syncPreviewId(mock)
  const payload = {
    owner: OWNER, repo: REPO, action: 'sync_labels', branch: 'main',
    previewId, confirmRemovals: true,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await response.json()
  assert.equal(response.status, 200)
  assert.equal(data.state, 'ready')
  assert.equal(data.removedAssociations, 1)
  assert.deepEqual(mock.getIssue().labels, [])
  const deletion = mock.calls.find(call => call.method === 'DELETE')
  assert.equal(deletion.path, BASE + '/issues/1/labels/foo:old')
  assert.equal(deletion.authorization, 'Bearer user-oauth-token')
  assert.ok(!mock.calls.some(call => call.method === 'PUT' && call.path.includes('/issues/')))
})

test('Label sync rejects an expired snapshot before any mutation', async () => {
  const mock = mockFetcher({ content: 'namespaces:\n  foo: []\n' })
  const payload = {
    owner: OWNER, repo: REPO, action: 'sync_labels', branch: 'main',
    previewId: '0'.repeat(64), confirmRemovals: true,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await response.json()
  assert.equal(response.status, 409)
  assert.equal(data.state, 'stale_preview')
  assert.deepEqual(writes(mock.calls),[])
})

test('Label sync without destructive confirmation performs no writes', async () => {
  const mock = mockFetcher({
    content: 'namespaces:\n  foo: []\n',
    issue: issue(),
    labels: [{ name: 'foo:old' }],
  })
  const previewId = await syncPreviewId(mock)
  const payload = {
    owner: OWNER, repo: REPO, action: 'sync_labels', branch: 'main',
    previewId, confirmRemovals: false,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await response.json()
  assert.equal(response.status, 400)
  assert.equal(data.state, 'confirmation_required')
  assert.deepEqual(writes(mock.calls),[])
})


test('protected Config refuses a missing maintenance Ruleset after creating a ref, without PUT', async () => {
  const mock = mockFetcher({ newBranchRulesUnavailable: true })
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: HEAD, expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.state, 'partial_failure')
  assert.match(result.error, /Rulesets/)
  assert.ok(result.branchUrl.includes('/tree/labourchain/config-'))
  const created = mock.calls.find(call => call.path === BASE + '/git/refs' && call.method === 'POST')
  const inspected = mock.calls.find(call => call.path.startsWith(BASE +
    '/rules/branches/labourchain/config-'))
  assert.ok(created)
  assert.ok(inspected)
  assert.ok(mock.calls.indexOf(created) < mock.calls.indexOf(inspected))
  assert.equal(mock.calls.filter(call => call.method === 'PUT').length, 0)
})

test('Config save rejects stale main SHA before creating a branch or Contents PUT', async () => {
  const mock = mockFetcher()
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: '0'.repeat(40),
    expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).state, 'stale_preview')
  assert.deepEqual(writes(mock.calls),[])
})

test('Config save rejects App permission gaps without Bot fallback or GitHub mutation', async () => {
  const mock = mockFetcher({
    appPermissions: { contents: 'read', issues: 'write', pull_requests: 'write' },
  })
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: HEAD, expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const response = await handler.fetch(http.post('/api/repo-config',payload))
  assert.equal(response.status, 403)
  assert.equal((await response.json()).state, 'app_permission_missing')
  assert.deepEqual(writes(mock.calls),[])
})

test('#47 B1-2: GET main 429 after a Label create preserves progress and retry metadata', async () => {
  const mock = mockFetcher({
    content: 'namespaces:\n  foo: []\n  status: [new]\n',
    labels: [{ name: 'foo:old' }],
    failMainAfterLabelCreate: true,
  })
  const previewId = await syncPreviewId(mock)
  const payload = {
    owner: OWNER, repo: REPO, action: 'sync_labels', branch: 'main',
    previewId, confirmRemovals: true,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const res = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.state, 'partial_failure')
  assert.deepEqual(data.createdLabels, ['status:new'])
  assert.deepEqual(data.removedAssociations, [])
  assert.equal(data.failed[0].kind, 'verify_main')
  assert.equal(data.failed[0].stage, 'after_label_creation')
  assert.equal(data.failed[0].retryAfter, '60')
  assert.equal(data.requiresRefresh, true)
  assert.deepEqual(data.pending, [{ number: 1, labels: ['foo:old'] }])
  assert.equal(mock.calls.filter(call => call.method === 'POST' &&
    call.path === BASE + '/labels').length, 1)
  assert.equal(mock.calls.filter(call => call.method === 'DELETE').length, 0)
})

test('#47 B1-2: GET main 503 after ten Issue deletes preserves all successful operations', async () => {
  const names = Array.from({ length: 10 }, (_, i) => 'foo:old-' + i)
  const mock = mockFetcher({
    content: 'namespaces:\n  foo: []\n',
    labels: names.map(name => ({ name })),
    issue: issue(names),
    failMainAfterIssueDeletes: true,
  })
  const previewId = await syncPreviewId(mock)
  const payload = {
    owner: OWNER, repo: REPO, action: 'sync_labels', branch: 'main',
    previewId, confirmRemovals: true,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const res = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.state, 'partial_failure')
  assert.deepEqual(data.createdLabels, [])
  assert.equal(data.removedAssociations.length, 10)
  assert.deepEqual(data.removedAssociations.map(item => item.label), names)
  assert.equal(data.failed[0].kind, 'verify_main')
  assert.equal(data.failed[0].stage, 'after_issue_batch')
  assert.equal(data.requiresRefresh, true)
  assert.deepEqual(data.pending, [{ number: 1, labels: names }])
  assert.deepEqual(mock.getIssue().labels, [])
  assert.equal(mock.calls.filter(call => call.method === 'DELETE').length, 10)
})

test('#47 B1-2: post-PUT maintenance branch verification 503 keeps commit and branch evidence', async () => {
  const mock = mockFetcher({ failBranchVerification: true })
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: HEAD, expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const res = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.state, 'partial_failure')
  assert.equal(data.commitSha, COMMIT_SHA)
  assert.match(data.branchUrl, /\/tree\/labourchain\/config-/)
  assert.equal(data.failed[0].kind, 'verify_branch')
  assert.equal(data.requiresRefresh, true)
  assert.equal(mock.calls.filter(call => call.method === 'POST' &&
    call.path === BASE + '/pulls').length, 0)
})

test('#47 B1-2: post-PUT direct main verification 503 keeps commit evidence', async () => {
  const mock = mockFetcher({ protected: false, failDirectVerification: true })
  const payload = {
    owner: OWNER, repo: REPO, action: 'save_config', branch: 'main',
    content: NEXT_CONFIG, expectedHeadSha: HEAD, expectedFileSha: FILE_SHA,
  }
  const handler = createRepoConfigHandler({
    fetcher: mock.fetcher,
  })
  const res = await handler.fetch(http.post('/api/repo-config',payload))
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.equal(data.state, 'partial_failure')
  assert.equal(data.commitSha, COMMIT_SHA)
  assert.equal(data.fileSha, NEW_FILE_SHA)
  assert.equal(data.failed[0].kind, 'verify_main_commit')
  assert.equal(data.requiresRefresh, true)
  assert.equal(mock.calls.filter(call => call.method === 'PUT').length, 1)
})

test('Config mutations require authenticated same-origin access to the exact active Installation',async()=>{
  const payload={owner:OWNER,repo:REPO,action:'save_config',branch:'main',
    content:NEXT_CONFIG,expectedHeadSha:HEAD,expectedFileSha:FILE_SHA}
  for(const [options,requestOptions,status] of [
    [{},{loggedIn:false},401],[{},{requestOrigin:'https://wrong.test'},403],
    [{revoked:true},{},403],[{notMember:true},{},403]]){
    const mock=mockFetcher(options)
    const response=await createRepoConfigHandler({fetcher:mock.fetcher}).fetch(http.post('/api/repo-config',payload,requestOptions))
    assert.equal(response.status,status)
    assert.deepEqual(writes(mock.calls),[])
    assert.equal(mock.getMainContent(),CONFIG)
  }
})
