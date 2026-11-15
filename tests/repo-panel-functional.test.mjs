import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

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
    if(String(url)==='/api/repos')return Response.json({repositories:[repo]})
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
  const snapshot=store.getSnapshot()
  assert.equal(snapshot.loading,false)
  assert.equal(snapshot.selected,repo.full_name)
  assert.equal(snapshot.issues[0].title,issue.title)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.repos))
  assert.ok(Object.isFrozen(snapshot.issues))
  assert.notEqual(old,snapshot)
  assert.equal(updates.length>=3,true)
  assert.equal(calls.length,2)
  assert.equal(calls[0].init.credentials,'same-origin')
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
  const update=store.refresh()
  await Promise.resolve()
  await store.select('sample/other')
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
