import {observeHttp} from './helpers/observe-http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { createTopicReportEndpoint } from '../api/_topic-report.mjs'
import { resolveInstalledRepository } from '../api/_installation-probe.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'

const SITE = 'https://topic.test'
const api = SITE + '/api/topic-report'
const ghRepo = '/repos/sample/repo'
const http = githubHttpFixture(SITE,'user-alice')
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const appEnv = {
  GITHUB_APP_ID: '123456',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
}
function setup(opts = {}) {
  const config = { origin: SITE, key: randomBytes(32) }
  const calls = []
  let now = 1_800_000_000_000
  let appInstalled = opts.appInstalled !== false
  let appIssuesPermission = opts.appIssuesPermission ?? 'write'
  const fetcher = observeHttp(async (url, init = {}) => {
    const location = new URL(url)
    const path = location.pathname
    const authorization = init.headers?.Authorization
    const method = init.method || 'GET'
    calls.push({ origin: location.origin, path, method, authorization, body: init.body || null,
      cookie: init.headers?.cookie })
    const metadata = {
      id: 23, full_name: opts.fullName || 'sample/repo',
      private: opts.private === true,
      owner: { login: 'sample', type: 'User' },
    }
    if (path === ghRepo && !authorization) {
      assert.equal(method, 'GET')
      return Response.json(metadata)
    }
    if (path === ghRepo + '/installation') {
      assert.match(authorization, /^Bearer ey/, 'App JWT only for installation verification')
      if(opts.realSession)http.assertApp(authorization)
      assert.equal(method, 'GET')
      if (opts.installationNetworkFailure) throw Error('App installation network failure')
      if (opts.installationStatus) return Response.json({}, { status: opts.installationStatus })
      if (!appInstalled) return Response.json({}, { status: 404 })
      return Response.json({ id: 17, account: { login: 'sample' }, suspended_at: null })
    }
    if (path === '/app/installations/17') {
      assert.match(authorization, /^Bearer ey/, 'only App JWT may inspect installation grants')
      if(opts.realSession)http.assertApp(authorization)
      assert.equal(method, 'GET')
      if (opts.appPermissionNetworkFailure) throw Error('App permission read timeout')
      if (opts.appPermissionStatus) return Response.json({}, { status: opts.appPermissionStatus })
      if (opts.appPermissionInvalidJson) return new Response('invalid-json', { status: 200 })
      return Response.json({
        id: opts.appPermissionWrongId ? 18 : 17,
        account: { login: opts.appPermissionWrongAccount ? 'other' : 'sample' },
        suspended_at: opts.appPermissionSuspended ? '2026-11-13T00:00:00Z' : null,
        ...(opts.appPermissionsMissing ? {} : {
          permissions: opts.appPermissionsMalformed ? 'invalid' :
            { issues: appIssuesPermission },
        }),
      })
    }
    assert.ok(authorization?.startsWith('Bearer user-'), 'only user token reads and writes')
    assert.ok(!authorization.includes('bot'), 'must not use bot token')
    if (path.startsWith('/user/installations/17/repositories')) {
      assert.equal(method, 'GET')
      const page = Number(new URL(url).searchParams.get('page'))
      assert.equal(page, 1)
      if (opts.userInstallNetworkFailure) throw Error('user installation list timeout')
      if (opts.userInstallStatus) return Response.json({}, { status: opts.userInstallStatus })
      if (opts.userInstallMalformed) return Response.json({ repositories: null })
      const repositories = opts.userInstallMissing ? [] :
        [{ id: opts.userInstallWrongId ? 24 : 23,
          full_name: opts.userInstallWrongRepo ? 'other/repo' : 'sample/repo',
          private: false }]
      return Response.json({ total_count: repositories.length, repositories })
    }
    if (path.startsWith('/repos/')) {
      if (path.endsWith('/issues')) {
        assert.equal(method, 'POST')
        if (opts.writeNetworkFailure) throw Error('network timeout after POST')
        if (opts.writeStatus) return Response.json({ message: 'GitHub rejected' },
          { status: opts.writeStatus, headers: opts.writeHeaders || {} })
        if (opts.invalidCreated) return Response.json({
          number: 45, html_url: 'https://evil.test/sample/repo/issues/45',
        }, { status: 201 })
        if (opts.invalidCreatedJson) return new Response('broken json', { status: 201 })
        return Response.json({ number: 45,
          html_url: 'https://github.com/sample/repo/issues/45' }, { status: 201 })
      }
      assert.equal(path, ghRepo, 'must not probe unrelated repository')
      if (opts.repoStatus) return Response.json({ message: 'GitHub error' },
        { status: opts.repoStatus })
      return Response.json({
        ...metadata, has_issues: opts.hasIssues !== false,
        ...(opts.permissionsMissing ? {} : { permissions: {
          triage: opts.canWrite !== false, push: false, maintain: false, admin: false,
        } }),
      })
    }
    throw Error('Unexpected GitHub path ' + path)
  })
  const sessionReader = request => {
    const cookie = request.headers.get('cookie') || ''
    if (cookie.includes('session=alice')) return { token: 'user-alice' }
    if (cookie.includes('session=bob')) return { token: 'user-bob' }
    return null
  }
  const endpoint = opts.realSession ? createTopicReportEndpoint({fetcher}) : createTopicReportEndpoint({ fetcher,
    sessionReader, configReader: () => config, clock: () => now,
    installationResolver: args => resolveInstalledRepository({ ...args, env: appEnv }),
  })
  const cookieFor=()=>http.post('/api/topic-report',{}).headers.get('cookie')
  const preflight = async (person = 'alice', owner = 'sample', repo = 'repo') => {
    const response = await endpoint.fetch(new Request(
      api + '?owner=' + owner + '&repo=' + repo,
      { headers: { cookie: opts.realSession?cookieFor():'session=' + person } }))
    return { response, data: await response.json() }
  }
  const submit = async (proof, changes = {}, headers = {}) => {
    const payload = { owner: 'sample', repo: 'repo', title: 'TopicPage report',
      body: 'Error stage: readme\nHTTP: 502', confirmed: true, proof, ...changes }
    return endpoint.fetch(new Request(api, { method: 'POST', headers: {
      origin: SITE, 'content-type': 'application/json',
      'x-labourchain-write': '1', 'sec-fetch-site': 'same-origin',
      referer: SITE + '/topic/sample/repo', cookie: opts.realSession?cookieFor():'session=alice', ...headers,
    }, body: JSON.stringify(payload) }))
  }
  return { endpoint, calls, preflight, submit, setNow: value => { now = value },
    setAppInstalled: value => { appInstalled = value },
    setAppIssuesPermission: value => { appIssuesPermission = value } }
}


const postCalls=s=>s.calls.filter(c=>c.method==='POST')
const expectedWrite={title:'TopicPage report',body:'Error stage: readme\nHTTP: 502'}
function checkWrite(s){
 const calls=postCalls(s)
 assert.equal(calls.length,1)
 assert.equal(calls[0].origin,'https://api.github.com')
 assert.equal(calls[0].path,ghRepo+'/issues')
 assert.equal(calls[0].authorization,'Bearer user-alice')
 assert.equal(calls[0].cookie,undefined)
 assert.deepEqual(JSON.parse(calls[0].body),expectedWrite)
}

test('a verified report creates exactly one Issue as the current actor and revalidates the current repository grants',async()=>{
 const s=setup({realSession:true})
 const pre=await s.preflight()
 assert.equal(pre.response.status,200)
 assert.equal(pre.data.state,'ready')
 assert.equal(pre.data.target,'sample/repo')
 assert.deepEqual(postCalls(s),[])
 const before=s.calls.length
 const invalidCookies=['', 'session=alice', '__Host-lc-session=invalid', http.post('/api/topic-report',{}, {expiresIn:0.5}).headers.get('cookie')]
 for(const cookie of invalidCookies){
  assert.equal((await s.endpoint.fetch(new Request(api+'?owner=sample&repo=repo',{headers:{cookie}}))).status,401)
  assert.equal((await s.submit(pre.data.proof,{}, {cookie})).status,401)
 }
 assert.equal(s.calls.length,before)
 const response=await s.submit(pre.data.proof)
 assert.equal(response.status,201)
 assert.deepEqual(await response.json(),{state:'created',issue:{number:45,html_url:'https://github.com/sample/repo/issues/45'}})
 checkWrite(s)
 const sequence=[ghRepo,ghRepo+'/installation','/app/installations/17','/user/installations/17/repositories',ghRepo]
 assert.deepEqual(s.calls.map(c=>c.path),[...sequence,...sequence,ghRepo+'/issues'])
 for(const start of [0,5]){
  const calls=s.calls.slice(start,start+5)
  assert.equal(calls[0].authorization,undefined)
  assert.ok(calls.slice(1,3).every(c=>c.method==='GET'&&/^Bearer ey/.test(c.authorization)))
  assert.ok(calls.slice(3).every(c=>c.method==='GET'&&c.authorization==='Bearer user-alice'))
 }
 assert.ok(s.calls.every(c=>c.origin==='https://api.github.com'&&c.cookie===undefined))
})

test('unauthenticated and unconfirmed report requests are rejected before contacting GitHub',async()=>{
 const s=setup()
 assert.equal((await s.endpoint.fetch(new Request(api+'?owner=sample&repo=repo'))).status,401)
 assert.equal((await s.submit('any',{}, {cookie:''})).status,401)
 assert.deepEqual(s.calls,[])
 const {data}=await s.preflight()
 const count=s.calls.length
 for(const [changes,headers,status] of [
  [{},{origin:'https://evil.test'},403],
  [{},{'x-labourchain-write':'0'},403],
  [{},{'sec-fetch-site':'cross-site'},403],
  [{},{referer:SITE+'/topic/other/repo'},403],
  [{},{'content-type':'text/plain'},415],
  [{confirmed:false},{},400],
  [{title:''},{},400],
  [{body:''},{},400],
 ]){
  assert.equal((await s.submit(data.proof,changes,headers)).status,status)
 }
 assert.equal(s.calls.length,count)
})

test('a report proof is bound to its exact target, actor and validity window',async()=>{
 const s=setup()
 const {data}=await s.preflight(),count=s.calls.length
 assert.equal((await s.submit(data.proof,{}, {cookie:'session=bob'})).status,403)
 assert.equal((await s.submit(data.proof,{owner:'other'},{referer:SITE+'/topic/other/repo'})).status,403)
 assert.equal((await s.submit('invalid-proof')).status,403)
 s.setNow(1_800_000_601_000)
 assert.equal((await s.submit(data.proof)).status,403)
 assert.equal(s.calls.length,count)
})

test('reports refuse secret-bearing or out-of-contract content before any upstream request',async()=>{
 const s=setup()
 const {data}=await s.preflight(),count=s.calls.length
 for(const body of ['Authorization: Bearer fixture-value','Cookie: fixture=value','github_pat_fixture123456789','__Host-lc-session=fixture']){
  const response=await s.submit(data.proof,{body})
  assert.equal(response.status,422)
  assert.ok(!(await response.text()).includes(body))
 }
 assert.equal((await s.submit(data.proof,{body:'x'.repeat(21000)})).status,400)
 assert.equal((await s.submit(data.proof,{destination:'https://evil.test'})).status,400)
 assert.equal(s.calls.length,count)
})

test('preflight fails closed at the first missing, mismatched or unavailable authorization boundary',async()=>{
 // Select representative failure mechanisms at each dependency boundary.
 for(const [options,status,lastPath] of [
  [{private:true},403,ghRepo],
  [{fullName:'other/repo'},502,ghRepo],
  [{appInstalled:false},403,ghRepo+'/installation'],
  [{installationNetworkFailure:true},502,ghRepo+'/installation'],
  [{appIssuesPermission:'read'},403,'/app/installations/17'],
  [{appPermissionsMalformed:true},403,'/app/installations/17'],
  [{appPermissionWrongId:true},502,'/app/installations/17'],
  [{appPermissionSuspended:true},502,'/app/installations/17'],
  [{appPermissionStatus:429},429,'/app/installations/17'],
  [{appPermissionInvalidJson:true},502,'/app/installations/17'],
  [{userInstallMissing:true},403,'/user/installations/17/repositories'],
  [{userInstallWrongRepo:true},403,'/user/installations/17/repositories'],
  [{userInstallWrongId:true},403,'/user/installations/17/repositories'],
  [{userInstallMalformed:true},502,'/user/installations/17/repositories'],
  [{userInstallNetworkFailure:true},502,'/user/installations/17/repositories'],
  [{hasIssues:false},410,ghRepo],
  [{canWrite:false},403,ghRepo],
  [{permissionsMissing:true},403,ghRepo],
  [{repoStatus:503},502,ghRepo],
 ]){
  const s=setup(options)
  const {response,data}=await s.preflight()
  assert.equal(response.status,status,JSON.stringify(options))
  assert.equal(data.state,'rejected')
  assert.equal(Object.hasOwn(data,'proof'),false)
  assert.notEqual(data.outcomeUnknown,true)
  assert.equal(s.calls.at(-1).path,lastPath)
  assert.ok(s.calls.every(c=>c.method==='GET'&&c.origin==='https://api.github.com'))
 }
})

test('permission withdrawn after preflight cannot be used to create an Issue',async()=>{
 for(const revoke of [s=>s.setAppInstalled(false),s=>s.setAppIssuesPermission('read')]){
  const s=setup()
  const ready=await s.preflight()
  assert.equal(ready.data.state,'ready')
  revoke(s)
  const response=await s.submit(ready.data.proof)
  assert.equal(response.status,403)
  assert.equal((await response.json()).state,'rejected')
  assert.equal(s.calls.filter(c=>c.path===ghRepo+'/installation').length,2)
  assert.deepEqual(postCalls(s),[])
 }
})

test('an upstream rejection differs from an uncertain completed write; neither is automatically repeated',async()=>{
 for(const [options,status,unknown] of [
  [{writeStatus:401},401,false],
  [{writeStatus:422},422,false],
  [{writeStatus:403,writeHeaders:{'retry-after':'45'}},429,false],
  [{writeStatus:503},502,true],
  [{writeNetworkFailure:true},502,true],
  [{invalidCreated:true},502,true],
  [{invalidCreatedJson:true},502,true],
 ]){
  const s=setup(options)
  const prepared=await s.preflight()
  assert.equal(prepared.data.state,'ready')
  const response=await s.submit(prepared.data.proof),body=await response.json()
  assert.equal(response.status,status,JSON.stringify(options))
  assert.equal(body.outcomeUnknown,unknown)
  if(status===429)assert.equal(body.retryAfter,'45')
  assert.equal(Object.hasOwn(body,'issue'),false)
  checkWrite(s)
 }
})
