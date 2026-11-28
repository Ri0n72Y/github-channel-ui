import {observeHttp} from './helpers/observe-http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import feedEndpoint from '../api/_repo-feed.mjs'
import homeEndpoint from '../api/_repo-home.mjs'
import permissionEndpoint from '../api/_repo-member-permission.mjs'
import registerEndpoint from '../api/_repo-member-register.mjs'
import { seal, SESSION_COOKIE } from '../api/_oauth.mjs'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = randomBytes(32)
const credentials = {
  GITHUB_APP_ID: '123456',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  GITHUB_APP_CLIENT_ID: 'Iv1234567.mock',
  GITHUB_APP_CLIENT_SECRET: 'mock-secret',
  GITHUB_OAUTH_CALLBACK_URL: 'https://labour.example/api/github-callback',
  GITHUB_OAUTH_COOKIE_KEY: key.toString('base64url'),
}
const repo = { id: 50, private: false, full_name: 'octocat/hello',
  owner: { login: 'octocat', type: 'User' }, name: 'hello', default_branch: 'main',
  html_url: 'https://github.com/octocat/hello', description: null }
const headers = { 'Content-Type': 'application/json' }
const response = (status, data, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { ...headers, ...extra },
})
function makeGitHubMock(options = {}) {
  const calls = [], writes = []
  let conflicted = false
  const fetcher = observeHttp(async (url, init = {}) => {
    const u = new URL(url)
    assert.equal(u.host, 'api.github.com', 'all upstream GitHub calls are absolute API endpoints')
    const path = u.pathname, method = init.method || 'GET'
    calls.push({ method, path, query: u.search, auth: init.headers?.Authorization })
    if (['PUT','POST','PATCH','DELETE'].includes(method)) writes.push({ method, path, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : undefined })
    if (method === 'GET' && path === '/repos/octocat/hello') return response(200, repo)
    if (method === 'GET' && path === '/repos/octocat/hello/installation') return response(200,
      { id: 17, account: { login: 'octocat' }, suspended_at: null })
    if (method === 'POST' && path === '/app/installations/17/access_tokens') return response(201,
      { token: method + '-installation-token' })
    if (method === 'GET' && path === '/repos/octocat/hello/branches/main') return response(200,
      { name: 'main', protected: options.protected !== false, commit: { sha: 'abc123' } })
    if (method === 'GET' && path === '/repos/octocat/hello/rules/branches/main') {
      if (options.rulesFail) return response(options.rulesFail, { message: 'Rules unavailable' })
      return response(200, options.rules || [])
    }
    if (method === 'GET' && path === '/app/installations/17') return response(200,
      { id: 17, account: { login: 'octocat' }, suspended_at: null,
        permissions: { issues: 'read', contents: options.contents || 'write',
          pull_requests: options.pull_requests || 'write', metadata: 'read' } })
    if (method === 'GET' && path === '/user') return response(200, { id: 100, login: 'operator' })
    if (method === 'GET' && path === '/user/installations/17/repositories') return response(200,
      { repositories: [{ ...repo, permissions: { push: options.push !== false } }] })
    if (method === 'GET' && path === '/repos/octocat/hello/readme') {
      const body = '# hello\n\n![badge](https://example.org/badge.svg)\n\nThis is the introduction.'
      return response(200, { type: 'file', path: 'README.md', size: body.length,
        encoding: 'base64', content: Buffer.from(body).toString('base64') })
    }
    if (method === 'GET' && path === '/repos/octocat/hello/contents/team-member.json') {
      const team = conflicted && options.conflictTeam ? options.conflictTeam : options.team
      if (!team) return response(404, { message: 'Not Found' })
      return response(200, { type: 'file', path: 'team-member.json', sha: conflicted && options.conflictTeam ? 'concurrent-file-sha' : 'file-sha',
        size: team.length, encoding: 'base64', content: Buffer.from(team).toString('base64') })
    }
    if (method === 'GET' && path === '/repos/octocat/hello/issues') {
      if (u.searchParams.get('page') === '1') return response(200,
        [{ id: 10, number: 10, pull_request: { url: 'https://example.org/pr' } }],
        { Link: '<https://api.github.com/repos/octocat/hello/issues?page=2>; rel="next"' })
      return response(200, [{ id: 20, number: 20, title: 'A normal issue', body: 'Hello' }])
    }
    if (method === 'POST' && path === '/repos/octocat/hello/git/refs') return response(201,
      { ref: 'refs/heads/labourchain/team-member-123' })
    if (method === 'PUT' && path === '/repos/octocat/hello/contents/team-member.json') {
      if (options.validation422) return response(422, { message: 'Validation Failed: invalid commit payload' })
      if (options.directDenied) return response(403, { message: 'Write access denied' })
      if (options.conflict && !conflicted) { conflicted = true; return response(409, { message: 'conflict' }) }
      return response(201, { commit: { sha: 'saved-commit' }, content: { sha: 'new-file-sha' } })
    }
    if (method === 'POST' && path === '/repos/octocat/hello/pulls') return response(201,
      { html_url: 'https://github.com/octocat/hello/pull/17' })
    throw Error('Unexpected request: ' + method + ' ' + url)
  })
  return { fetcher, calls, writes }
}
async function mocked(options, action) {
  const originalFetch = globalThis.fetch
  const previous = Object.fromEntries(Object.keys(credentials).map(k => [k, process.env[k]]))
  const mock = makeGitHubMock(options)
  Object.assign(process.env, credentials)
  globalThis.fetch = mock.fetcher
  try { return await action(mock) }
  finally {
    globalThis.fetch = originalFetch
    for (const [k, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[k]
      else process.env[k] = value
    }
  }
}
const origin = 'https://labour.example'
const session = () => SESSION_COOKIE + '=' + seal({ token: 'user-token', exp: Date.now() + 60_000 }, 'session', key)
const request = (path, init) => new Request(origin + path, init)

const target = 'owner=octocat&repo=hello'
const endpoint = '/api/repo-member-register'
const submit = (member={name:'New'}, extra={}) => registerEndpoint.fetch(request(endpoint,{
  method:'POST',headers:{Origin:origin,Cookie:session(),'Content-Type':'application/json',
    'X-LabourChain-Write':'1',...extra},
  body:JSON.stringify({owner:'octocat',repo:'hello',branch:'main',member,user:'spoofed-login'}),
}))
const permission = () => permissionEndpoint.fetch(request('/api/repo-member-permission?'+target+'&branch=main',{
  headers:{Cookie:session()},
}))
const mutations = mock => mock.writes.filter(w=>!w.path.endsWith('/access_tokens'))
const members = write => JSON.parse(Buffer.from(write.body.content,'base64').toString()).members

test('public home preserves missing team independently of README, and feed follows raw pages even when a page contains only PRs',async()=>{
  await mocked({},async mock=>{
    const home=await homeEndpoint.fetch(request('/api/repo-home?'+target+'&branch=main'))
    assert.equal(home.status,200)
    const value=await home.json()
    assert.equal(value.repository.full_name,'octocat/hello')
    assert.equal(value.team.state,'missing')
    assert.equal(value.readme.state,'ready')
    assert.match(value.readme.content,/This is the introduction/)
    for(const [page,ids,hasMore] of [[1,[],true],[2,[20],false]]){
      const result=await feedEndpoint.fetch(request('/api/repo-feed?'+target+'&page='+page))
      assert.equal(result.status,200)
      const data=await result.json()
      assert.deepEqual(data.items.map(i=>i.id),ids)
      assert.equal(data.page,page)
      assert.equal(data.hasMore,hasMore)
    }
    assert.deepEqual(mock.calls.filter(c=>c.path.endsWith('/issues')).map(c=>new URLSearchParams(c.query).get('page')),['1','2'])
    assert.deepEqual(mutations(mock),[])
  })
})

test('invalid resource branch or page is rejected before upstream access',async()=>{
  await mocked({},async mock=>{
    assert.equal((await homeEndpoint.fetch(request('/api/repo-home?'+target+'&branch=../main'))).status,400)
    assert.equal((await feedEndpoint.fetch(request('/api/repo-feed?'+target+'&page=0'))).status,400)
    assert.deepEqual(mock.calls,[])
  })
})

test('branch protection and effective PR rules both write only a maintenance branch, attributed to the verified operator',async()=>{
  for(const options of [{protected:true},{protected:false,rules:[{type:'pull_request'}]}]){
    await mocked(options,async mock=>{
      const capability=await permission()
      assert.equal(capability.status,200)
      const grant=await capability.json()
      assert.equal(grant.mode,'pr')
      assert.equal(grant.protected,true)
      const result=await submit({name:'New',role:'Reviewer',links:[]})
      assert.equal(result.status,202)
      const body=await result.json()
      assert.equal(body.status,'pending_pr')
      assert.equal(body.requestedBy,'operator')
      const [ref,file,pr]=mutations(mock)
      assert.deepEqual(mutations(mock).map(w=>[w.method,w.path]),[
        ['POST','/repos/octocat/hello/git/refs'],
        ['PUT','/repos/octocat/hello/contents/team-member.json'],
        ['POST','/repos/octocat/hello/pulls'],
      ])
      assert.match(file.body.branch,/^labourchain\/team-member-/)
      assert.equal(ref.body.ref,'refs/heads/'+file.body.branch)
      assert.equal(pr.body.head,file.body.branch)
      assert.equal(pr.body.base,'main')
      assert.match(file.body.message,/Requested by @operator/)
      assert.doesNotMatch(file.body.message,/spoofed-login/)
      assert.deepEqual(members(file).map(({name,role})=>({name,role})),[{name:'New',role:'Reviewer'}])
      assert.ok(mutations(mock).every(w=>w.auth==='Bearer POST-installation-token'))
    })
  }
})

test('a genuine SHA conflict retries against the concurrent document without losing members or changing target',async()=>{
  const old=JSON.stringify({version:1,members:[{id:'old',name:'Previously added'}]})
  const concurrent=JSON.stringify({version:1,members:[
    {id:'old',name:'Previously added'},{id:'other-writer',name:'Concurrent member'},
  ]})
  await mocked({protected:false,conflict:true,team:old,conflictTeam:concurrent},async mock=>{
    const result=await submit()
    assert.equal(result.status,201)
    assert.equal((await result.json()).status,'committed')
    const writes=mutations(mock)
    assert.deepEqual(writes.map(w=>[w.method,w.body.branch,w.body.sha]),[
      ['PUT','main','file-sha'],['PUT','main','concurrent-file-sha'],
    ])
    assert.deepEqual(members(writes[1]).map(p=>p.name),['Previously added','Concurrent member','New'])
    assert.deepEqual(members(writes[1]).slice(0,2).map(p=>p.id),['old','other-writer'])
    assert.ok(writes.every(w=>w.auth==='Bearer POST-installation-token'))
  })
})

test('a displayed capability is not write authorization: missing grants and unknown rules prevent actual registration',async()=>{
  for(const [options,message] of [
    [{contents:'read'},/Contents/],
    [{protected:false,rules:[{type:'pull_request'}],pull_requests:'read'},/Pull requests/],
    [{protected:false,rulesFail:403},/./],
    [{push:false},/./],
  ]){
    await mocked(options,async mock=>{
      const check=await permission()
      assert.equal(check.status,403)
      assert.match((await check.json()).error,message)
      const result=await submit()
      assert.equal(result.status,403)
      assert.deepEqual(mutations(mock),[])
    })
  }
  await mocked({},async mock=>{
    assert.equal((await submit({name:'New'},{Origin:'https://attacker.example'})).status,403)
    assert.deepEqual(mock.calls,[])
  })
})

test('non-conflict PUT failures retain their status without retrying or inventing a PR fallback',async()=>{
  for(const [options,status] of [[{validation422:true},422],[{directDenied:true},403]]){
    await mocked({protected:false,...options},async mock=>{
      const result=await submit()
      assert.equal(result.status,status)
      const data=await result.json()
      if(status===422){
        assert.match(data.error,/Validation Failed/)
        assert.doesNotMatch(data.error,/SHA 冲突/)
      }
      assert.deepEqual(mutations(mock).map(w=>[w.method,w.body.branch]),[['PUT','main']])
    })
  }
})
