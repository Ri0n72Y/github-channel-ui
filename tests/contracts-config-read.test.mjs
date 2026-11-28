import test from 'node:test'
import assert from 'node:assert/strict'
import { readRepoConfigPreview } from '../api/_repo-config-preview.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'
const http=githubHttpFixture('https://labour.test','unused-user-token')

const CONFIG = 'namespaces:\n  status:\n    - todo\n    - done\n  foo: []\n'
const SHA = 'a'.repeat(40)
const FILE_SHA = 'b'.repeat(40)
const issue = (number, labels, state = 'open', extra = {}) =>
  ({ number, labels: labels.map(name => ({ name })), state, ...extra })

function mockRead(options = {}) {
  const calls = []
  const branch = options.branch || 'main'
  const configText = options.configText ?? CONFIG
  const file = { type: 'file', path: 'labourchain.config.yaml', encoding: 'base64',
    sha: FILE_SHA, size: Buffer.byteLength(configText),
    content: Buffer.from(configText, 'utf8').toString('base64') }
  const labelPages = options.labelPages || [[{ name: 'status:todo' }, { name: 'foo:unused' }]]
  const issuePages = options.issuePages || [[issue(1, ['status:obsolete', 'foo:unused', 'foobar:legacy'])]]
  const fetcher=async(address,init={})=>{
    const url=new URL(address),pathname=url.pathname
    calls.push(pathname+url.search)
    if(url.origin!=='https://api.github.com')throw Error('Unexpected external host: '+url.origin)
    const auth=init.headers?.Authorization
    if(url.pathname==='/repos/octocat/demo/installation'){
      http.assertApp(auth)
      return Response.json({id:17,account:{login:'octocat'},suspended_at:null},{status:options.denyAccess?404:200})
    }
    if(url.pathname==='/app/installations/17'){
      http.assertApp(auth)
      return Response.json({id:17,account:{login:'octocat'},suspended_at:null,
        permissions:{issues:'read',contents:'read'}})
    }
    if(url.pathname==='/app/installations/17/access_tokens'){
      http.assertApp(auth)
      assert.deepEqual(JSON.parse(init.body),{repository_ids:[10],permissions:{issues:'read',contents:'read'}})
      return Response.json({token:'readonly-fixture'},{status:201})
    }
    if(url.pathname==='/repos/octocat/demo')return Response.json({id:10,private:false,full_name:'octocat/demo',
      owner:{login:'octocat',type:'User'}})
    assert.equal(init.method||'GET','GET')
    assert.equal(auth,'Bearer readonly-fixture')
    if (pathname === '/repos/octocat/demo/branches/' + encodeURIComponent(branch)) {
      if (options.missingBranch) return Response.json({message:'Branch not found'},{status:404})
      return Response.json({ name: branch, commit: { sha: SHA } })
    }
    if (pathname === '/repos/octocat/demo/contents/labourchain.config.yaml') {
      if (options.missingConfig) return Response.json({}, {status:404})
      assert.equal(url.searchParams.get('ref'), branch)
      return Response.json(options.invalidFile ? { ...file, content: 'NOT-BASE64' } : file)
    }
    if (pathname === '/repos/octocat/demo/labels' ||
      pathname === '/repos/octocat/demo/issues') {
      if (options.errorStatus && pathname.endsWith('/issues')) {
        return Response.json({message:'Upstream failure'},{status:options.errorStatus})
      }
      const group = pathname.endsWith('/labels') ? labelPages : issuePages
      const page = Number(url.searchParams.get('page'))
      assert.equal(url.searchParams.get('per_page'), '100')
      if (pathname.endsWith('/issues')) assert.equal(url.searchParams.get('state'), 'all')
      assert.ok(page > 0 && page <= group.length)
      return Response.json(group[page-1],{headers:{Link:page<group.length?
        '<https://api.github.com/next>; rel="next"':''}})
    }
    throw Error('Unexpected read path '+url.pathname)
  }
  http.use(fetcher)
  return { calls }
}

test('read-only installed-repository snapshot returns provenance and exact diff', async () => {
  const mock = mockRead()
  const result = await readRepoConfigPreview({
    owner: 'octocat', repo: 'demo' })
  assert.equal(result.state, 'changes')
  assert.equal(result.branch, 'main')
  assert.equal(result.headSha, SHA)
  assert.equal(result.fileSha, FILE_SHA)
  assert.equal(result.canApply, false)
  assert.deepEqual(result.plan.createLabels, [{ name: 'status:done' }])
  assert.deepEqual(result.plan.removeIssueLabels,
    [{ number: 1, labels: ['status:obsolete', 'foo:unused'] }])
  assert.ok(mock.calls.includes('/repos/octocat/demo/installation'))
  assert.ok(mock.calls.some(call => call.includes('contents/labourchain.config.yaml?ref=main')))
  assert.ok(!mock.calls.some(call => /\/(pulls|labels\/[^/?]+)$/.test(call)))
})

test('absent Config offers default preview but cannot trigger sync', async () => {
  const mock = mockRead({ missingConfig: true })
  const result = await readRepoConfigPreview({ owner: 'octocat', repo: 'demo' })
  assert.equal(result.state, 'config_missing')
  assert.match(result.config.defaultPreview, /channel:/)
  assert.equal(result.canApply, false)
  assert.equal(result.plan, null)
  assert.ok(!mock.calls.some(path => path.includes('/issues?')))
})

test('corrupted file and invalid YAML never enumerate issues/labels or apply', async () => {
  for (const opts of [{ invalidFile: true }, { configText: 'namespaces:\n  foo:[]\n' }]) {
    const mock = mockRead(opts)
    const result = await readRepoConfigPreview({ owner: 'octocat', repo: 'demo' })
    assert.equal(result.state, 'invalid_config')
    assert.equal(result.config.state,'invalid_config')
    assert.equal(result.plan, null)
    assert.equal(result.canApply,false)
    assert.ok(!mock.calls.some(path => path.includes('/labels?') || path.includes('/issues?')))
  }
})

test('absent main stops without selecting another branch; explicit branch is independent', async () => {
  const missing = mockRead({ missingBranch: true })
  const stopped = await readRepoConfigPreview({ owner: 'octocat', repo: 'demo' })
  assert.equal(stopped.state, 'sync_branch_missing')
  assert.equal(stopped.canApply, false)
  assert.ok(!missing.calls.some(path => path.includes('contents/')))
  const explicit = mockRead({ branch: 'maint/config' })
  const selected = await readRepoConfigPreview({ owner: 'octocat', repo: 'demo',
    syncBranch: 'maint/config' })
  assert.equal(selected.branch, 'maint/config')
  assert.ok(explicit.calls.some(path => path.includes('branches/maint%2Fconfig')))
})

test('incomplete Label/Issue pages, authorization failures and GitHub errors fail closed', async () => {
  for (const option of [
    { labelPages: [[{ name: 'foo:old' }], [{ name: 'status:todo' }]] },
    { issuePages: [[issue(1, ['foo:old'])], [issue(2, ['foo:old'])]] },
  ]) {
    const mock = mockRead(option)
    const result = await readRepoConfigPreview({
      owner: 'octocat', repo: 'demo', maxPages: 1 })
    assert.equal(result.state, 'snapshot_incomplete')
    assert.equal(result.canApply, false)
    assert.equal(result.plan, null)
  }
  const denied = mockRead({ denyAccess: true })
  await assert.rejects(readRepoConfigPreview({ owner: 'octocat', repo: 'demo' }), error => error.status === 403)
  assert.deepEqual(denied.calls, ['/repos/octocat/demo','/repos/octocat/demo/installation'])
  const limited = mockRead({ errorStatus: 429 })
  await assert.rejects(readRepoConfigPreview({ owner: 'octocat', repo: 'demo' }), error => error.status === 429)
  await assert.rejects(readRepoConfigPreview({ owner: 'bad/name', repo: 'demo' }), error => error.status === 400)
})

test('pagination reads all pages and excludes Pull Requests in the final diff', async () => {
  const mock = mockRead({
    labelPages: [[{ name: 'status:todo' }], [{ name: 'foo:unused' }]],
    issuePages: [[issue(1, ['foo:old'])],
      [issue(2, ['foo:ignored'], 'open', { pull_request: { url: 'https://github.com/pr' } })]],
  })
  const snapshot = await readRepoConfigPreview({
    owner: 'octocat', repo: 'demo' })
  assert.equal(snapshot.state, 'changes')
  assert.deepEqual(snapshot.plan.removeIssueLabels, [{ number: 1, labels: ['foo:old'] }])
  assert.deepEqual(snapshot.counts, { labels: 2, issueObjects: 2 })
  assert.equal(mock.calls.filter(path => path.includes('/issues?')).length, 2)
})
