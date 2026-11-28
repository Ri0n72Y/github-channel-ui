import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepoChannelsHandler } from '../api/_repo-channels.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'
const http=githubHttpFixture('https://labour.test','unused-user-token')

const HEAD = 'a'.repeat(40)
const CONFIG_SHA = 'b'.repeat(40)
const ROOT = '/repos/octocat/demo'
const CONFIG = 'namespaces:\n  channel: [discussion, wishlist]\n  status: [todo]\n'
const cfgFile = source => ({
  type: 'file', encoding: 'base64',
  size: Buffer.byteLength(source), sha: CONFIG_SHA,
  content: Buffer.from(source).toString('base64'),
})
const item = (number, channels, opts = {}) => ({
  id: number + 1000,
  number,
  title: 'Issue #' + number,
  state: opts.state || 'open',
  labels: channels.map(name => ({ name })),
  html_url: 'https://github.com/octocat/demo/issues/' + number,
  user: { login: 'author' },
  comments: 2,
  created_at: opts.createdAt || '2026-11-01T00:00:00Z',
  ...(opts.pr ? { pull_request: { url: 'https://api.github.com/...' } } : {}),
})

function mockSource(options = {}) {
  const calls = []
  const pages = options.pages || [[item(1, ['channel:discussion'])]]
  const fetcher = async (address, init={}) => {
    const url = new URL(address)
    calls.push(url.pathname+url.search)
    if(url.origin!=='https://api.github.com')throw Error('Unexpected external host: '+url.origin)
    const auth=init.headers?.Authorization
    if(url.pathname==='/repos/octocat/demo/installation'){
      http.assertApp(auth)
      return Response.json({id:17,account:{login:'octocat'},suspended_at:null})
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
    if (url.pathname === ROOT + '/branches/main') {
      if (options.noMain) return Response.json({message:'main missing'},{status:404})
      return Response.json({ name: 'main', commit: { sha: HEAD } })
    }
    if (url.pathname === ROOT + '/contents/labourchain.config.yaml') {
      assert.equal(url.searchParams.get('ref'), 'main')
      return options.config === null ? Response.json({}, {status:404}) : Response.json(cfgFile(options.config ?? CONFIG))
    }
    if (url.pathname === ROOT + '/issues') {
      assert.equal(url.searchParams.get('state'), 'open')
      assert.equal(url.searchParams.get('sort'), 'created')
      assert.equal(url.searchParams.get('direction'), 'desc')
      assert.equal(url.searchParams.get('per_page'), '100')
      const page = Number(url.searchParams.get('page'))
      if (options.failPage === page) return Response.json({message:'rate limit'},{status:429})
      const data = pages[page - 1] || []
      return Response.json(data,{headers:{Link:page < pages.length ?
        '<https://api.github.com' + ROOT + '/issues?page=' + (page + 1) + '>; rel="next"' : '' }})
    }
    throw new Error('Unexpected GitHub path: ' + url.pathname)
  }
  http.use(fetcher)
  return {calls,handler:createRepoChannelsHandler({maxPages:options.maxPages||10})}
}
const request = () => new Request('https://labour.test/api/repo-channels?owner=octocat&repo=demo')

test('public API reads only main Config and complete Open Issue pagination', async () => {
  const mock = mockSource({ pages: [
    [item(1, ['channel:discussion'], { createdAt: '2026-11-01T00:00:00Z' })],
    [item(2, ['channel:discussion'], { createdAt: '2026-11-02T00:00:00Z' }),
      item(3, ['channel:wishlist'])],
  ] })
  const response = await mock.handler.fetch(request())
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.state, 'ready')
  assert.equal(data.branch, 'main')
  assert.equal(data.headSha, HEAD)
  assert.equal(data.pages, 2)
  assert.equal(data.scannedIssues, 3)
  assert.deepEqual(data.channels.map(c => c.issue.number), [2, 3])
  assert.ok(mock.calls.some(p => p.endsWith('ref=main')))
})

test('config missing and malformed YAML never scan GitHub Issues', async () => {
  for (const config of [null, 'namespaces:\n  channel:[]\n',
    'namespaces:\n  channel: [discussion]\n  unknown: [\n']) {
    const mock = mockSource({ config })
    const response = await mock.handler.fetch(request())
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.state, config === null ? 'config_missing' : 'invalid_config')
    assert.deepEqual(data.channels, [])
    assert.ok(!mock.calls.some(p => p.includes('/issues?')))
  }
})

test('missing or empty channel Namespace has no Channel entries', async () => {
  for (const config of ['namespaces:\n  status: [todo]\n',
    'namespaces:\n  channel: []\n']) {
    const mock = mockSource({ config })
    const response = await mock.handler.fetch(request())
    const data = await response.json()
    assert.equal(data.state, 'no_channels')
    assert.deepEqual(data.channels, [])
    assert.equal(mock.calls.filter(p => p.includes('/issues?')).length, 0)
  }
})

test('missing main does not fallback to repository default branch', async () => {
  const mock = mockSource({ noMain: true })
  const response = await mock.handler.fetch(request())
  assert.equal((await response.json()).state, 'sync_branch_missing')
  assert.equal(mock.calls.some(p => p.includes('/contents/')), false)
})

test('pagination limit never publishes a potentially incorrect channel winner', async () => {
  const mock = mockSource({ maxPages: 1, pages: [
    [item(1, ['channel:discussion'])],
    [item(2, ['channel:discussion'], { createdAt: '2026-11-09T00:00:00Z' })],
  ] })
  const response = await mock.handler.fetch(request())
  const data = await response.json()
  assert.equal(data.state, 'snapshot_incomplete')
  assert.deepEqual(data.channels, [])
  assert.match(data.error, /分页/)
  assert.equal(mock.calls.filter(p => p.includes('/issues?')).length, 1)
})

test('API preserves 429/permission failures, blocks POST and non-main branch', async () => {
  const mock = mockSource({ failPage: 1 })
  const response = await mock.handler.fetch(request())
  assert.equal(response.status, 429)
  assert.match((await response.json()).error, /限流/)
  const method = await mock.handler.fetch(new Request(request().url, { method: 'POST' }))
  assert.equal(method.status, 405)
  const wrong = await mock.handler.fetch(new Request(request().url + '&branch=feature'))
  assert.equal(wrong.status, 400)
  assert.equal(mock.calls.some(p => p.includes('feature')), false)
})
