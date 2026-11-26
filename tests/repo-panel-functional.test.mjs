import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { ProbeError } from '../api/_installation-probe.mjs'
import { auth as oldAuth, repos as oldRepos, issues as oldIssues } from '../api/_github.mjs'
import { createReposHandler } from '../api/repos.mjs'
import { createIssuesHandler } from '../api/issues.mjs'
import { parseGitHubResourceUrl, parseGitHubRepositoryUrl, repositoryLinkPath, resourcePath } from '../plugins/repo-issues/src/target.mjs'

let vite, createRepoIssuesApi, createRepoIssuesStore
before(async () => {
  vite = await createServer({root:resolve(import.meta.dirname,'..'),configFile:false,
    logLevel:'silent',plugins:[react()],server:{middlewareMode:true}})
  createRepoIssuesApi = (await vite.ssrLoadModule('/plugins/repo-issues/src/api.ts')).createRepoIssuesApi
  createRepoIssuesStore = (await vite.ssrLoadModule('/plugins/repo-issues/src/index.ts')).createRepoIssuesStore
})
after(async () => { await vite?.close() })
const signal = () => new AbortController().signal
const repo = {owner:'sample',name:'repo',full_name:'sample/repo'}
const issue = {number:2,title:'Fixture Issue',html_url:'https://github.com/sample/repo/issues/2',comments:1}

test('#77 Repo Panel uses a frozen functional API and immutable store with stable snapshots',async()=>{
  const calls=[]
  const request=async (url,init)=>{
    assert.equal(this,undefined)
    calls.push({url:String(url),init})
    if(String(url)==='/api/repos?owner=sample&repo=repo')return Response.json({
      state:'connected',repository:repo,
    })
    if(String(url).startsWith('/api/issues?'))return Response.json({issues:[issue]})
    throw Error('unexpected endpoint '+url)
  }
  const api=createRepoIssuesApi(request)
  const store=createRepoIssuesStore(api)
  assert.ok(Object.isFrozen(api))
  assert.ok(Object.isFrozen(store))
  const updates=[]
  const unsubscribe=store.subscribe(()=>updates.push(store.getSnapshot()))
  const old=store.getSnapshot()
  await store.refresh()
  assert.equal(calls.length,0,'root must not enumerate unknown Installation repositories')
  await store.connect('https://github.com/sample/repo')
  const snapshot=store.getSnapshot()
  assert.equal(snapshot.loading,false)
  assert.equal(snapshot.selected,repo.full_name)
  assert.equal(snapshot.issues[0].title,issue.title)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.repos))
  assert.ok(Object.isFrozen(snapshot.issues))
  assert.notEqual(old,snapshot)
  assert.equal(updates.length>=2,true)
  assert.equal(calls.length,1)
  assert.match(calls[0].url,/^\/api\/issues\?/)
  assert.equal(calls[0].init.credentials,'same-origin')
  assert.equal(snapshot.availability,'connected')
  assert.equal(snapshot.targetUrl,'https://github.com/sample/repo')
  unsubscribe()
  store.dispose()
})
test('#77 Repo Panel filters outdated Issue loads after route selection and disposal',async()=>{
  let finish
  const api=Object.freeze({
    getRepositories:async()=>[repo,{owner:'sample',name:'other',full_name:'sample/other'}],
    getIssues:async(owner,name)=>name==='repo'?
      new Promise(resolve=>{finish=resolve}):[issue],
    getSession:async()=>false,
    verify:async()=>{throw Error('not in test')},
    createIssue:async()=>{throw Error('not in test')},
  })
  const store=createRepoIssuesStore(api)
  const update=store.connect('https://github.com/sample/repo')
  await Promise.resolve()
  await store.connect('https://github.com/sample/other')
  assert.equal(store.getSnapshot().selected,'sample/other')
  assert.equal(store.getSnapshot().issues.length,1)
  finish?.([{
    number:99,title:'stale',html_url:'https://github.com/sample/repo/issues/99',comments:0,
  }])
  await update
  assert.equal(store.getSnapshot().selected,'sample/other')
  assert.equal(store.getSnapshot().issues[0].number,2)
  store.dispose()
})
test('#76 Repo Panel Issue creation requires explicit confirm and reports uncertain writes',async()=>{
  const calls=[]
  const request=async(url,init)=>{
    calls.push({url:String(url),init})
    if(url==='/api/github-issue-create')return Response.json({
      issue:{number:44,html_url:'https://github.com/sample/repo/issues/44'},
    },{status:201})
    throw Error('Unexpected URL')
  }
  const api=createRepoIssuesApi(request)
  const result=await api.createIssue(repo,'Title','Body',signal())
  assert.equal(result.number,44)
  assert.equal(calls[0].init.method,'POST')
  assert.equal(calls[0].init.headers['X-LabourChain-Write'],'1')
  assert.equal(calls[0].init.credentials,'same-origin')
  await assert.rejects(createRepoIssuesApi(async()=>{
    throw Error('broken connection')
  }).createIssue(repo,'Title','Body',signal()),/创建结果未知/)
  const source=readFileSync(new URL('../plugins/repo-panel/src/issue-workspace.tsx',import.meta.url),'utf8')
  assert.match(source,/window\.confirm/)
  assert.match(source,/api\.createIssue/)
  assert.doesNotMatch(source,/await fetch\(/)
})


test('#96 scoped RepoPanel API refuses legacy no-target callers and unverified repository swaps',async()=>{
  const calls=[]
  const request=async(url,init)=>{
    calls.push(String(url))
    if(String(url).startsWith('/api/repos?'))return Response.json({
      state:'connected',
      repository:{owner:'other',name:'repo',full_name:'other/repo'},
    })
    throw Error('unexpected path')
  }
  const api=createRepoIssuesApi(request)
  await assert.rejects(api.getRepositories(signal()),
    error=>error.status===400&&error.state==='target_required')
  assert.equal(calls.length,0)
  await assert.rejects(api.getRepositories(signal(),repo),
    error=>error.status===502&&/身份不匹配/.test(error.message))
  assert.equal(calls.length,1)
})

test('#96 missing, suspended and not-selected Installation results preserve safe management hints',async()=>{
  const cases=[
    ['needs_installation','https://github.com/apps/example/installations/new'],
    ['needs_repository_authorization','https://github.com/settings/installations/77'],
    ['installation_suspended',undefined],
    ['repository_unavailable',undefined],
    ['needs_installation','https://evil.example/install'],
  ]
  for(const [state,url] of cases){
    const api=createRepoIssuesApi(async()=>Response.json({
      state,action_url:url,
    }))
    await assert.rejects(api.getRepositories(signal(),repo),error=>{
      assert.equal(error.state,state)
      assert.equal(error.actionUrl,url?.startsWith('https://github.com/')?url:undefined)
      return true
    })
  }
})

test('#96 store rejects unsafe URLs and keeps exact-target state after revoked installation',async()=>{
  const calls=[]
  const api=Object.freeze({
    getRepositories:async()=>{throw Error('unexpected success-path probe')},
    getIssues:async(owner,name)=>{
      calls.push(owner+'/'+name)
      if(owner==='sample'&&name==='repo')return [issue]
      throw Object.assign(new Error('仓库授权已撤销'),{state:'repo_access_required'})
    },
    getSession:async()=>false,
    verify:async()=>{throw Error('OAuth not requested')},
    createIssue:async()=>{throw Error('Write not requested')},
  })
  const store=createRepoIssuesStore(api)
  await store.connect('https://github.com/sample/repo')
  assert.equal(store.getSnapshot().selected,'sample/repo')
  assert.deepEqual(store.getSnapshot().repos,[repo])
  await store.connect('https://github.com/other/repo')
  assert.equal(store.getSnapshot().availability,'repo_access_required')
  assert.equal(store.getSnapshot().selected,'')
  assert.deepEqual(store.getSnapshot().issues,[])
  await store.connect('https://github.com/sample/repo/issues/1')
  assert.equal(store.getSnapshot().availability,'invalid_target')
  assert.deepEqual(calls,['sample/repo','other/repo'])
  store.dispose()
})


const url = 'https://local.test/api/repos?owner=sample&repo=repo'
const issueUrl = 'https://local.test/api/issues?owner=sample&repo=repo'
const sampleIssue = (number, extra = {}) => ({
  number, title: 'Issue #' + number, comments: 1,
  html_url: 'https://github.com/sample/repo/issues/' + number, ...extra,
})
const req = (uri, method = 'GET') => new Request(uri, { method })

test('#96 repository URL accepts only exact github.com/owner/repo paths', () => {
  const good = [
    'https://github.com/sample/repo',
    ' HTTPS://GITHUB.COM/Sample/Repo/ ',
    'https://github.com/a/b.c-d_1',
  ]
  assert.equal(parseGitHubResourceUrl('https://github.com/sample/repo/issues/28')?.path,'/sample/repo/issues/28')
  for(const url of ['https://github.com/sample/repo/issues/0','https://github.com/sample/repo/issues/9007199254740992','https://github.com/sample/repo/issues/2?x=1','https://github.com/sample/repo/pull/2'])assert.equal(parseGitHubResourceUrl(url),null)
  for (const value of good) {
    const parsed = parseGitHubRepositoryUrl(value)
    assert.ok(parsed, value)
    assert.ok(parsed.url.startsWith('https://github.com/'))
    assert.equal(parsed.full_name, parsed.owner + '/' + parsed.name)
  }
  for (const value of [
    null, '', 'sample/repo', 'http://github.com/sample/repo',
    'https://www.github.com/sample/repo', 'https://github.com.evil.test/sample/repo',
    'https://github.com@evil.test/sample/repo',
    'https://user@github.com/sample/repo', 'https://github.com:443/sample/repo',
    'https://github.com/sample/repo?foo=bar', 'https://github.com/sample/repo#readme',
    'https://github.com/sample/repo/issues/2',
    'https://github.com/sample/repo%2Fother', 'https://github.com/sample/%2e%2e',
    'https://github.com/-bad/repo', 'https://github.com/a-/repo',
    'https://github.com/a/..', 'https://github.com/a/.',
    'https://github.com/a/b//', 'https://github.com/a/b/../../bad',
  ]) assert.equal(parseGitHubRepositoryUrl(value), null, String(value))
})

test('#96 legacy /api/repos requires a real target and never enumerates Installation repositories', async () => {
  let calls = 0
  const endpoint = createReposHandler({ inspect: async () => { calls++; throw Error('not expected') } })
  assert.equal((await endpoint.fetch(req('https://local.test/api/repos'))).status, 400)
  assert.equal((await endpoint.fetch(req(url.replace('sample', 'bad/name')))).status, 400)
  assert.equal((await endpoint.fetch(req(url, 'POST'))).status, 405)
  assert.equal(calls, 0)
  const old = readFileSync(new URL('../plugins/github-access/server/_github.mjs', import.meta.url),'utf8')
  assert.doesNotMatch(old, /GITHUB_INSTALLATION_ID|\/installation\/repositories|\/access_tokens/)
})

test('#96 connected repository returns only the exact public target', async () => {
  const inputs = []
  const endpoint = createReposHandler({ inspect: async input => {
    inputs.push(input)
    return { state: 'connected', repository: 'Sample/Repo' }
  } })
  const response = await endpoint.fetch(req(url))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { state: 'connected',
    repository: { owner: 'Sample', name: 'Repo', full_name: 'Sample/Repo' } })
  assert.deepEqual(inputs.map(x => ({owner:x.owner, repo:x.repo})),
    [{ owner: 'sample', repo: 'repo' }])
  const mismatched = createReposHandler({ inspect: async () =>
    ({ state: 'connected', repository: 'other/repo' }) })
  assert.equal((await mismatched.fetch(req(url))).status, 502)
})

test('#96 uninstalled, not selected, suspended and unavailable repo have precise read-only states', async () => {
  const cases = [
    { state: 'repository_unavailable' },
    { state: 'installation_suspended', repository: 'sample/repo' },
    { state: 'needs_installation', repository: 'sample/repo',
      action_url: 'https://github.com/apps/labourchain/installations/new' },
    { state: 'needs_repository_authorization', repository: 'sample/repo',
      action_url: 'https://github.com/settings/installations/17' },
  ]
  for (const value of cases) {
    const endpoint = createReposHandler({ inspect: async () => value })
    const response = await endpoint.fetch(req(url))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.state, value.state)
    assert.equal(body.action_url, value.action_url)
    assert.ok(!('repositories' in body))
  }
})

test('#96 withdrawn, 403, 429, 503 and malformed upstream checks fail closed', async () => {
  for (const status of [403, 429, 503, 502]) {
    const endpoint = createReposHandler({ inspect: async () => {
      throw new ProbeError('verification unavailable',status)
    } })
    const response = await endpoint.fetch(req(url))
    assert.equal(response.status,status)
    assert.ok(!('repositories' in await response.json()))
  }
  const endpoint = createReposHandler({ inspect: async () =>
    ({ state: 'connected', repository: 'sample/repo', repositories: ['private/repo'] }) })
  const response = await endpoint.fetch(req(url))
  assert.equal(response.status,200)
  assert.ok(!('repositories' in await response.json()))
})

test('#96 /api/issues requires explicit target and never invokes a token reader without one', async () => {
  let accesses = 0
  const endpoint = createIssuesHandler({ readAccess: async () => { accesses++; throw Error('unexpected') } })
  assert.equal((await endpoint.fetch(req('https://local.test/api/issues'))).status, 400)
  assert.equal((await endpoint.fetch(req('https://local.test/api/issues?owner=a/b&repo=repo'))).status, 400)
  assert.equal((await endpoint.fetch(req(issueUrl,'POST'))).status,405)
  assert.equal(accesses,0)
})

test('#96 anonymous Issue read is scoped to the exact public repo; PR entries never appear', async () => {
  const readCalls=[], getCalls=[]
  const endpoint=createIssuesHandler({
    readAccess: async input => { readCalls.push(input); return {token:'scoped-read'} },
    githubGet: async (_access,path) => {
      getCalls.push(path)
      if (new URL('https://api.github.com' + path).searchParams.get('page') === '1') return {
        data:[sampleIssue(1),sampleIssue(100,{pull_request:{url:'https://api.github.com/pulls/100'}})],
        link:'<https://api.github.com/repos/sample/repo/issues?page=2>; rel="next"',
      }
      return { data:[sampleIssue(1),sampleIssue(2)], link:'' }
    },
  })
  const response=await endpoint.fetch(req(issueUrl))
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).issues.map(item=>item.number),[1,2])
  assert.equal(readCalls.length,1)
  assert.deepEqual({owner:readCalls[0].owner,repo:readCalls[0].repo,
    permissions:readCalls[0].permissions},{owner:'sample',repo:'repo',permissions:['issues']})
  assert.ok(getCalls.every(path=>path.startsWith('/repos/sample/repo/issues?')))
  assert.equal(getCalls.length,2)
})

test('#96 Issue listing rejects cross-repo links, malformed bodies and incomplete pagination', async () => {
  for (const result of [
    { data:[sampleIssue(1,{html_url:'https://evil.example/issues/1'})], link:'' },
    { data:[sampleIssue(1,{html_url:'https://github.com/other/repo/issues/1'})], link:'' },
    { data:{issues:[]}, link:'' },
    { data:[sampleIssue(1)], link:null },
  ]) {
    const endpoint=createIssuesHandler({
      readAccess:async()=>({token:'read'}),
      githubGet:async()=>result,
    })
    assert.equal((await endpoint.fetch(req(issueUrl))).status,502)
  }
  let pages=0
  const endpoint=createIssuesHandler({
    readAccess:async()=>({token:'read'}),
    githubGet:async()=>{ pages++; return {
      data:[sampleIssue(pages)],
      link:'<https://api.github.com/repos/sample/repo/issues?page=10>; rel="next"',
    } },
  })
  assert.equal((await endpoint.fetch(req(issueUrl))).status,409)
  assert.equal(pages,5)
})

test('#96 Issue 403/429/502 or revoked installation never produce a successful empty list', async () => {
  for (const status of [403,429,502,503]) {
    let gets=0
    const endpoint=createIssuesHandler({
      readAccess:async()=>{ throw Object.assign(new Error('read unavailable'),{status}) },
      githubGet:async()=>{gets++;throw Error('should not reach GitHub')},
    })
    const response=await endpoint.fetch(req(issueUrl))
    assert.notEqual(response.status,200)
    assert.deepEqual((await response.json()).error,'Issue service temporarily unavailable')
    assert.equal(gets,0)
  }
  const endpoint=createIssuesHandler({
    readAccess:async()=>({token:'read'}),
    githubGet:async()=>{ throw Object.assign(new Error('rate limit'),{status:429}) },
  })
  assert.equal((await endpoint.fetch(req(issueUrl))).status,502)
})

test('#96 legacy global auth/repo enumeration exports reject instead of selecting any Installation',async()=>{
  for(const call of [oldAuth,oldRepos,oldIssues]) {
    await assert.rejects(call(),error=>
      error.status===400&&error.state==='target_required')
  }
})

test('#115 canonical ordinary links and reserved namespace precedence',()=>{
 for(const kind of ['config','channels','members','issues']){
  assert.equal(resourcePath('topic','repo',kind),null)
  assert.equal(repositoryLinkPath('/topic/repo/'+kind),null)
 }
 for(const owner of ['api','assets','playground','API','ASSETS','Playground']){
  assert.equal(resourcePath(owner,'repo'),null)
  assert.equal(repositoryLinkPath('/'+owner+'/repo/issues/1'),null)
  assert.equal(parseGitHubResourceUrl('https://github.com/'+owner+'/repo'),null)
 }
 assert.equal(resourcePath('topic','repo'),'/topic/repo')
 assert.equal(repositoryLinkPath('/topic/repo/issues/1'),'/topic/repo/issues/1')
 assert.equal(repositoryLinkPath('/topic/repo/members/register'),'/topic/repo/members/register')
 assert.equal(resourcePath('repo','config','topic'),'/topic/repo/config')
 assert.equal(parseGitHubResourceUrl('https://github.com/repo/config/blob/main/topics.config.yaml')?.path,'/topic/repo/config')
 assert.equal(repositoryLinkPath('/sample/repo/issues/0'),null)
 assert.equal(repositoryLinkPath('/sample/repo/issues/9007199254740992'),null)
 assert.equal(repositoryLinkPath('/sample/repo/issues/1?x=1'),null)
})
