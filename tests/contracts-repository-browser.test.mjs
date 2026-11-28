import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
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


test('scoped RepoPanel API refuses legacy no-target callers and unverified repository swaps',async()=>{
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

test('missing, suspended and not-selected Installation results preserve safe management hints',async()=>{
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


test('repository URL accepts only exact github.com/owner/repo paths', () => {
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


test('canonical ordinary links and reserved namespace precedence',()=>{
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

test('repository switching and revocation affect the actual browser store without stale data or undispatched probes',async()=>{
  const calls=[],updates=[]
  let finish,revoked=false
  const delayed=new Promise(resolve=>{finish=resolve})
  const api=createRepoIssuesApi(async(address,init)=>{
    calls.push({address:String(address),signal:init.signal,method:init.method||'GET',credentials:init.credentials})
    if(address==='/api/issues?owner=sample&repo=repo')return delayed
    if(address==='/api/issues?owner=sample&repo=other'){
      if(revoked)return Response.json({state:'repo_access_required',error:'Access revoked'},{status:403})
      return Response.json({issues:[{number:2,title:'Current issue',comments:1,html_url:'https://github.com/sample/other/issues/2'}]})
    }
    throw Error('Unexpected browser request')
  })
  const store=createRepoIssuesStore(api)
  const unsubscribe=store.subscribe(()=>updates.push(store.getSnapshot()))
  try{
    await store.refresh()
    assert.deepEqual(calls,[])
    const abandoned=store.connect('https://github.com/sample/repo')
    assert.equal(calls.length,1)
    await store.connect('https://github.com/sample/other')
    assert.equal(calls[0].signal.aborted,true)
    const current=store.getSnapshot()
    assert.equal(current.selected,'sample/other')
    assert.deepEqual(current.issues,[{number:2,title:'Current issue',comments:1,html_url:'https://github.com/sample/other/issues/2'}])
    finish(Response.json({issues:[{number:99,title:'Abandoned',comments:0,html_url:'https://github.com/sample/repo/issues/99'}]}))
    await abandoned
    assert.equal(store.getSnapshot(),current)
    revoked=true
    await store.refresh()
    assert.equal(store.getSnapshot().availability,'repo_access_required')
    assert.deepEqual(store.getSnapshot().issues,[])
    assert.equal(store.getSnapshot().selected,'')
    assert.equal(current.issues[0].title,'Current issue')
    assert.ok(updates.some(state=>state.selected==='sample/other'))
    await store.connect('https://github.com/sample/repo/issues/1')
    assert.equal(store.getSnapshot().availability,'invalid_target')
    assert.deepEqual(calls.map(x=>[x.address,x.method,x.credentials]),[
      ['/api/issues?owner=sample&repo=repo','GET','same-origin'],
      ['/api/issues?owner=sample&repo=other','GET','same-origin'],
      ['/api/issues?owner=sample&repo=other','GET','same-origin'],
    ])
  }finally{unsubscribe();store.dispose()}
})
