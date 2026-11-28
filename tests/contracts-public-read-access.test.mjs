import {observeHttp} from './helpers/observe-http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { issueReadAccess, issueGitHubGet } from '../api/_issue-access.mjs'
import repoHome from '../api/_repo-home.mjs'
import repoFeed from '../api/_repo-feed.mjs'
import issueDetail from '../api/_issue-detail.mjs'
import issueComments from '../api/_issue-comments.mjs'
import issueConfig from '../api/_issue-config.mjs'
import { createRepoConfigHandler } from '../api/_repo-config.mjs'
import repoChannels from '../api/_repo-channels.mjs'
import memberRegister from '../api/_repo-member-register.mjs'
import issueComment from '../api/github-issue-comment.mjs'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = { GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) }
const repository = {
  id: 50, name: 'ledger', full_name: 'collective/ledger', private: false,
  default_branch: 'main', html_url: 'https://github.com/collective/ledger',
  description: 'A public repository',
  owner: { login: 'collective', type: 'User' },
}
const installation = { id: 17, account: { login: 'collective' }, suspended_at: null,
  permissions: { issues: 'write', contents: 'read', metadata: 'read' } }
const reply = (status, data, headers = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', ...headers },
  })

function fakeGitHub(options = {}) {
  const calls = []
  const fetcher = observeHttp(async (url, init = {}) => {
    const path = new URL(url).pathname
    const method = init.method || 'GET'
    assert.equal(new URL(url).origin, 'https://api.github.com')
    assert.equal(init.redirect, 'manual')
    calls.push({ path, method, body: init.body, auth: init.headers?.Authorization })
    if (path === '/repos/collective/ledger' && method === 'GET')
      return options.repositoryResponse?.clone() || reply(200, repository)
    if (path === '/repos/collective/ledger/installation' && method === 'GET')
      return options.missingInstallation ? reply(404) :
        reply(200, { id: 17, account: { login: 'collective' }, suspended_at: null })
    if (path === '/app/installations/17' && method === 'GET')
      return options.installationResponse?.clone() || reply(200, {
        ...installation, ...options.installation,
      })
    if (path === '/app/installations/17/access_tokens' && method === 'POST') {
      const payload = JSON.parse(init.body)
      assert.deepEqual(payload.repository_ids, [50], 'never issue an all-repository token')
      const scopes = Object.keys(payload.permissions || {}).sort()
      assert.ok(['issues', 'contents'].every(p => !scopes.includes(p) ||
        payload.permissions[p] === 'read'))
      assert.ok(scopes.length > 0 && scopes.every(p => p === 'issues' || p === 'contents'),
        'never request unrelated App permissions')
      assert.match(init.headers.Authorization, /^Bearer ey/)
      return options.tokenResponse || reply(201, {
        token: 'scoped-read-token', repositories: [{ id: 50 }],
      })
    }
    if (path === '/repos/collective/ledger/branches/main' && method === 'GET')
      return reply(200, { name: 'main', commit: { sha: 'a'.repeat(40) } })
    if (path === '/repos/collective/ledger/readme' && method === 'GET')
      return reply(404)
    if (path === '/repos/collective/ledger/contents/team-member.json' && method === 'GET')
      return reply(404)
    if (path === '/repos/collective/ledger/contents/labourchain.config.yaml' && method === 'GET')
      return reply(404)
    if (path === '/repos/collective/ledger/issues/2' && method === 'GET')
      return options.issueResponse || reply(200, { id: 2, number: 2, title: 'A normal Issue', body: '',
        state: 'open', html_url: 'https://github.com/collective/ledger/issues/2' })
    if (path === '/repos/collective/ledger/issues/2/comments' && method === 'GET')
      return options.commentsResponse || reply(200, [])
    if (path === '/repos/collective/ledger/issues' && method === 'GET')
      return reply(200, [{ id: 2, number: 2, title: 'A normal Issue', state: 'open' }])
    throw Error('Unexpected mocked GitHub call ' + method + ' ' + path)
  })
  return { fetcher, calls }
}

const readAccess = mock => issueReadAccess({
  owner: 'collective', repo: 'ledger', env, fetcher: mock.fetcher,
})

const prefix='/repos/collective/ledger'
const target='?owner=collective&repo=ledger'
const routes=mock=>[
 [repoHome,'/api/repo-home'+target+'&branch=main',{contents:'read'},200,'/branches/main'],
 [repoFeed,'/api/repo-feed'+target+'&page=1',{issues:'read'},200,'/issues'],
 [issueDetail,'/api/issue-detail'+target+'&number=2',{issues:'read'},200,'/issues/2'],
 [issueComments,'/api/issue-comments'+target+'&number=2&page=1',{issues:'read'},200,'/issues/2/comments'],
 [issueConfig,'/api/issue-config'+target,{contents:'read'},422,'/contents/labourchain.config.yaml'],
 [createRepoConfigHandler({fetcher:mock.fetcher}),'/api/repo-config'+target,{issues:'read',contents:'read'},200,'/contents/labourchain.config.yaml'],
 [repoChannels,'/api/repo-channels'+target,{issues:'read',contents:'read'},200,'/contents/labourchain.config.yaml'],
]
async function visitor(mock,run){
 const old=globalThis.fetch,backup=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]))
 Object.assign(process.env,env);globalThis.fetch=mock.fetcher
 try{await run(routes(mock))}finally{
  globalThis.fetch=old
  for(const [key,value] of Object.entries(backup)){
   if(value===undefined)delete process.env[key]
   else process.env[key]=value
  }
 }
}
const get=(handler,path)=>handler.fetch(new Request('https://labour.test'+path))

test('every installed public read entry requests only the grants needed for its resource and dispatches the actual read',async()=>{
 const mock=fakeGitHub()
 await visitor(mock,async endpoints=>{
  for(const [handler,path,permissions,status,resource] of endpoints){
   const before=mock.calls.length
   const response=await get(handler,path)
   assert.equal(response.status,status,path)
   const calls=mock.calls.slice(before)
   assert.deepEqual(calls.slice(0,3).map(c=>c.path),[prefix,prefix+'/installation','/app/installations/17'],path)
   const tokens=calls.filter(c=>c.path.endsWith('/access_tokens'))
   assert.equal(tokens.length,1,path)
   assert.deepEqual(JSON.parse(tokens[0].body),{repository_ids:[50],permissions},path)
   const reads=calls.slice(calls.indexOf(tokens[0])+1)
   assert.ok(reads.some(c=>c.path===prefix+resource),path)
   assert.ok(reads.every(c=>c.method==='GET'&&c.auth==='Bearer scoped-read-token'&&c.path.startsWith(prefix)),path)
  }
 })
})

test('missing App grants permit only installed public GETs, while an absent installation stops every entry before data access',async()=>{
 const fallback=fakeGitHub({installation:{permissions:{metadata:'read'}}})
 await visitor(fallback,async endpoints=>{
  for(const [handler,path,,status,resource] of endpoints){
   const before=fallback.calls.length
   assert.equal((await get(handler,path)).status,status,path)
   const calls=fallback.calls.slice(before)
   assert.deepEqual(calls.slice(0,3).map(c=>c.path),[prefix,prefix+'/installation','/app/installations/17'],path)
   const reads=calls.slice(3)
   assert.ok(reads.some(c=>c.path===prefix+resource),path)
   assert.ok(reads.every(c=>c.method==='GET'&&!c.auth&&c.path.startsWith(prefix)),path)
  }
 })
 const revoked=fakeGitHub({missingInstallation:true})
 await visitor(revoked,async endpoints=>{
  for(const [handler,path] of endpoints){
   const before=revoked.calls.length
   assert.equal((await get(handler,path)).status,403,path)
   assert.deepEqual(revoked.calls.slice(before).map(c=>c.path),[prefix,prefix+'/installation'],path)
  }
 })
})

test('narrow App grants can read their own resources without unrelated permission, mixed-resource reads fall back without token issuance',async()=>{
 for(const granted of ['issues','contents']){
  const mock=fakeGitHub({installation:{permissions:{[granted]:'read'}}})
  const permitted=await issueReadAccess({owner:'collective',repo:'ledger',env,
   permissions:[granted],fetcher:mock.fetcher})
  assert.equal(permitted.token,'scoped-read-token')
  assert.deepEqual(JSON.parse(mock.calls.find(c=>c.path.endsWith('/access_tokens')).body),
   {repository_ids:[50],permissions:{[granted]:'read'}})
  const mixed=await readAccess(mock)
  assert.equal(mixed.anonymous,true)
  assert.equal(mixed.token,null)
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/access_tokens')).length,1)
 }
})

test('inconclusive or mismatched public repository and installation evidence prevents any resource access',async()=>{
 for(const [options,status] of [
  [{repositoryResponse:reply(200,{...repository,private:true})},404],
  [{repositoryResponse:reply(200,{...repository,full_name:'other/repo'})},502],
  [{installation:{id:18}},403],
  [{installation:{account:{login:'other'}}},403],
  [{installation:{suspended_at:'2026-11-15T01:00:00Z'}},403],
  [{installationResponse:reply(404,{})},403],
  [{installationResponse:reply(200,{...installation,permissions:null})},502],
  [{installationResponse:reply(503,{})},503],
  [{installationResponse:reply(403,{}, {'retry-after':'60'})},429],
 ]){
  const mock=fakeGitHub(options)
  await assert.rejects(readAccess(mock),{status})
  assert.ok(mock.calls.every(c=>c.method==='GET'))
  assert.ok(mock.calls.every(c=>[prefix,prefix+'/installation','/app/installations/17'].includes(c.path)))
 }
})

test('a missing or mismatched scoped grant is not usable and GitHub diagnostics are never passed through',async()=>{
 for(const tokenResponse of [
  reply(201,{token:'fixture',repositories:[{id:50},{id:60}]}),
  reply(201,{token:'fixture',repositories:[{id:60}]}),
  reply(201,{repositories:[{id:50}]}),
 ]){
  const mock=fakeGitHub({tokenResponse})
  await assert.rejects(readAccess(mock),{status:502})
  assert.equal(mock.calls.filter(c=>c.path.endsWith('/access_tokens')).length,1)
  assert.equal(mock.calls.length,4)
 }
 const mock=fakeGitHub({tokenResponse:reply(422,{message:'upstream private diagnostic',errors:[{field:'permissions'}]})})
 await assert.rejects(readAccess(mock),error=>error.status===422&&
  /permission scope/.test(error.message)&&!error.message.includes('upstream private diagnostic'))
 assert.equal(mock.calls.length,4)
})

test('anonymous fallback refuses unrelated repositories and non-public resources before HTTP',async()=>{
 const mock=fakeGitHub({installation:{permissions:{}}})
 const access=await readAccess(mock)
 for(const path of ['/repos/collective/another-repo/issues',prefix+'/pulls',prefix+'/git/refs',prefix+'/actions/secrets','/user']){
  await assert.rejects(issueGitHubGet(access,path),{status:403})
 }
 assert.deepEqual(mock.calls.map(c=>c.path),[prefix,prefix+'/installation','/app/installations/17'])
})
test('#72 verified public anonymous read never substitutes for OAuth on write routes', async () => {
  const mock = fakeGitHub({ installation: { permissions: {} } })
  const access = await readAccess(mock)
  assert.equal(access.anonymous, true)
  const before = mock.calls.length
  const original = globalThis.fetch
  const oauthEnv = {
    GITHUB_APP_CLIENT_ID: 'Iv-test',
    GITHUB_APP_CLIENT_SECRET: 'test-secret',
    GITHUB_OAUTH_CALLBACK_URL: 'https://labour.test/api/github-callback',
    GITHUB_OAUTH_COOKIE_KEY: Buffer.alloc(32, 7).toString('base64url'),
  }
  const saved = Object.fromEntries(Object.keys(oauthEnv).map(k => [k, process.env[k]]))
  Object.assign(process.env, oauthEnv)
  globalThis.fetch = mock.fetcher
  const body = { owner: 'collective', repo: 'ledger' }
  const routes = [
    [memberRegister, '/api/repo-member-register', { ...body, branch: 'main', member: { name: 'Guest' } }],
    [issueComment, '/api/github-issue-comment', { ...body, number: 2, body: 'Guest comment' }],
    [createRepoConfigHandler({ fetcher: mock.fetcher }), '/api/repo-config',
      { ...body, action: 'save_config', branch: 'main', content: 'namespaces: {}' }],
  ]
  try {
    for (const [handler, path, payload] of routes) {
      const response = await handler.fetch(new Request('https://labour.test' + path, {
        method: 'POST', headers: {
          origin: 'https://labour.test', 'content-type': 'application/json',
          'x-labourchain-write': '1',
        }, body: JSON.stringify(payload),
      }))
      assert.equal(response.status, 401, path + ': an anonymous reader cannot write')
    }
    assert.equal(mock.calls.length, before, 'no anonymous write request reaches GitHub')
  } finally {
    globalThis.fetch = original
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
