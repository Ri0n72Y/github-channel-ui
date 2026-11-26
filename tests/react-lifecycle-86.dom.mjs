import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { readFileSync } from 'node:fs'


import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const h = React.createElement
const dom = new JSDOM('<!doctype html><html><body></body></html>', {url:'https://local.test'})
for (const name of ['window','document','HTMLElement','Node','Event','MouseEvent','localStorage','HTMLInputElement','HTMLTextAreaElement'])
  globalThis[name] = dom.window[name]
const {createRoot} = await import('react-dom/client')
const {MemoryRouter, Routes, Route, useParams, useNavigate} = await import('react-router')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.IntersectionObserver = class {observe(){} disconnect(){}}
window.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}})
window.confirm = () => true
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a,b) => {resolve=a;reject=b})
  return {promise,resolve,reject}
}
const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
let server, Home, Issue, Member, Members, Config, configFixture, RepoPanel, makeRepoStore, CreateIssue
before(async () => {
 server=await createServer({root:process.cwd(),configFile:false,logLevel:'silent',plugins:[react()],server:{middlewareMode:true}})
 Home=(await server.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')).default
 CreateIssue=(await server.ssrLoadModule('/plugins/repo-home/src/RepoIssueCreatePage.tsx')).default
 Issue=(await server.ssrLoadModule('/plugins/issue-detail/src/IssueDetailPage.tsx')).default
 Member=(await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')).default
 Members=(await server.ssrLoadModule('/plugins/repo-home/src/MembersPage.tsx')).default
 Config=(await server.ssrLoadModule('/plugins/repo-config/src/ConfigPage.tsx')).default
 configFixture=(await server.ssrLoadModule('/apps/playground/src/config-fixture.ts')).createRepoConfigFixtureService
 RepoPanel=(await server.ssrLoadModule('/plugins/repo-panel/src/index.tsx')).RepoPanel
 makeRepoStore=(await server.ssrLoadModule('/plugins/repo-issues/src/index.ts')).createRepoIssuesStore
})
after(async () => {await server?.close();dom.window.close()})
async function mount(path, route, Component, prop, keyFor) {
 const host=document.createElement('div')
 document.body.append(host)
 const root=createRoot(host)
 let navigate
 function Nav(){navigate=useNavigate();return null}
 function Scoped(){
  const params=useParams()
  return h(Component,{key:keyFor?.(params),...prop})
 }
 await act(async()=>root.render(h(React.StrictMode,null,h(MemoryRouter,{initialEntries:[path]},
   h(Nav), h(Routes,null,h(Route,{path:route,element:h(Scoped)}))))))
 await flush()
 return {host,go:async path=>{await act(async()=>navigate(path));await flush()},
   close:async()=>{await act(async()=>root.unmount());host.remove()}}
}
function input(element,value) {
 const setter=Object.getOwnPropertyDescriptor(
   element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set
 setter.call(element,value)
 element.dispatchEvent(new Event('input',{bubbles:true}))
}
const comment=(id,body='note')=>({id,body,html_url:'https://github.com/a/issues/1#issuecomment-'+id,
 created_at:'2026-11-17T00:00:00Z',user:{login:'alice'}})
const issue=(number)=>({number,title:'Issue '+number,body:'body',state:'open',labels:[],
 html_url:'https://github.com/a/issues/'+number,comments:3,user:{login:'alice'}})
function issueService(opts={}){
 const calls=[]
 return {
  calls,
  getIssue:async (_owner,_repo,n)=>issue(n),
  getComments:(_owner,_repo,n,page,signal)=>{
   calls.push({n,page,signal})
   return opts.comments?.(n,page,signal) ?? Promise.resolve({items:[comment(n*100+page)],hasMore:page===1})
  },
  getSession:async()=>Boolean(opts.authorized),
  verify:async()=>({repository:{accessible:true}}),
  postComment: opts.postComment ?? (async()=>({id:99})),
 }
}
test('#86 Repo A -> B: StrictMode remount hides old cards and preserves per-repo branch',async()=>{
 const pending=deferred()
 const calls=[]
 const api={
  getHome:async(o,r,b)=>{calls.push(o+'/'+r+':'+b)
    if(r==='beta') return pending.promise
    return {repository:{name:r,full_name:o+'/'+r,description:'Home '+r},
      branch:b,team:{state:'empty',members:[]},readme:{state:'missing'}}},
  getFeed:async(o,r,page)=>r==='alpha'?{page,hasMore:false,items:[
   {id:1,number:1,state:'open',title:'Only in alpha',updated_at:'2026-11-17T00:00:00Z'}]}:
   {page,hasMore:false,items:[]},
  getCapability:async()=>{throw Error('denied')},
 }
 localStorage.setItem('labourchain:display-branch:sample/beta','feature')
 const app=await mount('/sample/alpha','/:owner/:repo',Home,{api},p=>p.owner+'/'+p.repo)
 try{
  assert.match(app.host.textContent,/Only in alpha/)
  await app.go('/sample/beta')
  assert.doesNotMatch(app.host.textContent,/Only in alpha/)
  assert.ok(![...app.host.querySelectorAll('a')].some(a=>a.href.includes('/sample/beta/issues/1')))
  pending.resolve({repository:{name:'beta',full_name:'sample/beta',description:'Beta only'},
    branch:'main',team:{state:'empty',members:[]},readme:{state:'missing'}})
  await flush()
  assert.match(app.host.textContent,/Beta only/)
  assert.ok(calls.some(x=>x==='sample/beta:feature'))
 } finally {await app.close()}
})
test('#86 Issue A -> B: draft and late writes belong to their original controller',async()=>{
 const pending=deferred()
 let writes=0
 const svc=issueService({authorized:true,postComment:()=>{writes++;return pending.promise}})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc},p=>p.owner+'/'+p.repo+'/issues/'+p.number)
 try{
  const form=app.host.querySelector('form[aria-label="参与讨论"] textarea')
  assert.ok(form)
  await act(async()=>input(form,'A-only draft'))
  assert.equal(app.host.querySelector('form[aria-label="参与讨论"] textarea').value,'A-only draft')
  const submit=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('发表评论'))
  assert.ok(submit&&!submit.disabled)
  await act(async()=>submit.click())
  assert.equal(writes,1)
  await app.go('/sample/repo/issues/2')
  assert.equal(app.host.querySelector('form[aria-label="参与讨论"] textarea').value,'')
  pending.resolve({id:991})
  await flush()
  assert.doesNotMatch(app.host.textContent,/GitHub 已确认发表/)
 }finally{await app.close()}
})
test('#86 Issue page: two same-tick load-more events are single-flight and IDs dedupe',async()=>{
 const next=deferred()
 const svc=issueService({comments:(_n,page)=>page===2?next.promise:
   Promise.resolve({items:[comment(101)],hasMore:true})})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc},p=>p.owner+'/'+p.repo+'/issues/'+p.number)
 try{
  const more=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('加载下一页'))
  assert.ok(more,'load-more button exists')
  await act(async()=>{more.dispatchEvent(new MouseEvent('click',{bubbles:true}))
    more.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  assert.equal(svc.calls.filter(x=>x.page===2).length,1)
  next.resolve({items:[comment(101),comment(102)],hasMore:false})
  await flush()
  const diagnostic=app.host.querySelector('[aria-label="读取状态"] details')
  assert.equal(diagnostic.open,false)
  assert.match(diagnostic.textContent,/2 \/ 3/)
  assert.equal(app.host.querySelector('[aria-label="读取状态"]').querySelectorAll('[role="status"]').length,1)
 }finally{await app.close()}
})
test('#86 Member: session invalidation releases pending without replaying a possibly committed POST',async()=>{
 const pending=deferred()
 let writes=0
 const api={
  getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'}),
  register:()=>{writes++;return pending.promise},
 }
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  const name=app.host.querySelector('input[required]')
  assert.ok(name)
  await act(async()=>input(name,'Alice'))
  const form=app.host.querySelector('form')
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.match(app.host.textContent,/正在提交/)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.doesNotMatch(app.host.textContent,/正在提交…/)
  assert.match(app.host.textContent,/可能已经接收请求/)
  assert.equal(writes,1)
  pending.resolve({status:'committed',url:'https://github.com/sample/repo/commit/1'})
  await flush()
  assert.equal(writes,1)
 }finally{await app.close()}
})
test('#86 Config: dirty draft survives session reads, refresh requires confirmation and slow refresh blocks save',async()=>{
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 const lag=deferred()
 let gets=0, saves=0, blockNext=false
 const api={
  ...source,
  get:(...args)=>{gets++;if(blockNext){blockNext=false;return lag.promise}return source.get(...args)},
  save:(...args)=>{saves++;return source.save(...args)},
 }
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
   {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const area=app.host.querySelector('textarea')
  assert.ok(area,'editor loaded')
  const edited=area.value.replace('namespaces:', 'namespaces:\n# local draft')
  await act(async()=>input(area,edited))
  assert.equal(app.host.querySelector('textarea').value,edited)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.equal(app.host.querySelector('textarea').value,edited)
  window.confirm=()=>false
  const refresh=[...app.host.querySelectorAll('button')].find(b=>b.textContent==='重新读取')
  assert.ok(refresh)
  await act(async()=>refresh.click())
  assert.equal(app.host.querySelector('textarea').value,edited)
  window.confirm=()=>true
  blockNext=true
  await act(async()=>refresh.click())
  await flush()
  assert.ok([...app.host.querySelectorAll('button')].filter(b=>b.type==='submit').every(b=>b.disabled))
  assert.equal(saves,0)
  lag.resolve(await source.get('sample','repo',new AbortController().signal))
  await flush()
  assert.notEqual(app.host.querySelector('textarea').value,edited)
 }finally{await app.close()}
})

test('#86 Config: HTTP 403/409 leave the editor usable and do not automatically retry',async()=>{
 let attempts=0
 const original=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...original,save:async()=>{attempts++;const error=Error('GitHub '+(attempts===1?'403':'409'))
   error.status=attempts===1?403:409
   throw error
 }}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
   {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  await act(async()=>input(app.host.querySelector('textarea'),
    app.host.querySelector('textarea').value+'\n# local change'))
  let submit=[...app.host.querySelectorAll('button')].find(b=>b.type==='submit')
  assert.ok(submit&&!submit.disabled)
  await act(async()=>submit.click())
  assert.match(app.host.textContent,/GitHub 403/)
  assert.ok(!app.host.textContent.includes('正在提交'))
  assert.equal(attempts,1)
  submit=[...app.host.querySelectorAll('button')].find(b=>b.type==='submit')
  await act(async()=>submit.click())
  assert.match(app.host.textContent,/GitHub 409/)
  assert.equal(attempts,2)
 }finally{await app.close()}
})
test('#86 Config: maintenance PR keeps the draft awaiting merge and disallows another write',async()=>{
 let writes=0
 const original=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...original,save:async()=>{writes++;return {state:'awaiting_pr_merge',prUrl:'https://github.com/sample/repo/pull/88'}}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
   {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  await act(async()=>input(app.host.querySelector('textarea'),
    app.host.querySelector('textarea').value+'\n# pending change'))
  const submit=[...app.host.querySelectorAll('button')].find(b=>b.type==='submit')
  await act(async()=>submit.click())
  assert.equal(writes,1)
  assert.match(app.host.textContent,/等待 GitHub 审核与合并/)
  assert.match(app.host.innerHTML,/github.com\/sample\/repo\/pull\/88/)
  assert.equal(app.host.querySelector('button[type="submit"]'),null)
 }finally{await app.close()}
})

test('#86 Config: remote HEAD change preserves dirty content but blocks stale writes',async()=>{
 const original=configFixture(new URLSearchParams({configCase:'changes'}))
 let revision=0,attempts=0
 const api={...original,get:async(...args)=>{
  const value=await original.get(...args)
  return {...value,headSha:revision?'new-head-sha':value.headSha}
 },save:async()=>{attempts++;return {state:'ready'}}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const draft=app.host.querySelector('textarea').value+'\n# local edited'
  await act(async()=>input(app.host.querySelector('textarea'),draft))
  revision=1
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.match(app.host.textContent,/GitHub 配置版本已变化/)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  assert.equal(attempts,0)
 } finally {await app.close()}
})
test('#86 Member: route unmount aborts in-flight submission, with no background replay',async()=>{
 const pending=deferred()
 let signal, calls=0
 const api={getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'}),
 register:(_owner,_repo,_branch,_member,currentSignal)=>{calls++;signal=currentSignal;return pending.promise}}
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  await act(async()=>input(app.host.querySelector('input[required]'),'Alice'))
  await act(async()=>app.host.querySelector('form').dispatchEvent(
    new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(calls,1)
 }finally{await app.close()}
 assert.equal(signal.aborted,true)
 pending.resolve({status:'committed',url:'https://github.com/sample/repo/commit/1'})
 await flush()
 assert.equal(calls,1)
})

test('#86 Config: session change during write releases busy, preserves unknown outcome warning',async()=>{
 const pending=deferred()
 let sends=0
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...source,save:()=>{sends++;return pending.promise}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
   {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const area=app.host.querySelector('textarea')
  await act(async()=>input(area,area.value+'\n# pending write'))
  const submit=app.host.querySelector('button[type="submit"]')
  assert.ok(submit&&!submit.disabled)
  await act(async()=>submit.click())
  assert.equal(sends,1)
  assert.match(app.host.textContent,/正在提交/)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.doesNotMatch(app.host.textContent,/正在提交…/)
  assert.match(app.host.textContent,/GitHub 写入结果未知/)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  assert.equal(sends,1)
  pending.resolve({state:'ready'})
  await flush()
  assert.equal(sends,1)
 } finally {await app.close()}
})

test('#86 Repo: stale A response after B navigation never leaks A data into B links',async()=>{
 const first=deferred()
 const api={
  getHome:(o,r,b)=>r==='alpha'?first.promise:Promise.resolve({
   repository:{name:'beta',full_name:'sample/beta',description:'Beta confirmed'},
   branch:b,team:{state:'empty',members:[]},readme:{state:'missing'}}),
  getFeed:async(o,r,page)=>({page,hasMore:false,items:r==='beta'?[{
   id:2,number:2,title:'Beta issue',state:'open',updated_at:'2026-11-17T00:00:00Z'}]:[]}),
  getCapability:async()=>{throw Error('denied')}
 }
 const app=await mount('/sample/alpha','/:owner/:repo',Home,{api},p=>p.owner+'/'+p.repo)
 try{
  await app.go('/sample/beta')
  first.resolve({repository:{name:'alpha',full_name:'sample/alpha',description:'Alpha stale'},
   branch:'main',team:{state:'empty',members:[]},readme:{state:'missing'}})
  await flush()
  assert.doesNotMatch(app.host.textContent,/Alpha stale/)
  assert.match(app.host.textContent,/Beta confirmed/)
  assert.ok([...app.host.querySelectorAll('a')].some(a=>a.getAttribute('href')?.includes('/sample/beta/issues/2')))
 } finally {await app.close()}
})
test('#86 Config: unmount aborts active GitHub write without hidden retry',async()=>{
 const pending=deferred()
 let signal, calls=0
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...source,save:(_o,_r,_yaml,_head,_file,currentSignal)=>{
  calls++;signal=currentSignal;return pending.promise
 }}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 await act(async()=>input(app.host.querySelector('textarea'),
  app.host.querySelector('textarea').value+'\n# async write'))
 await act(async()=>app.host.querySelector('button[type="submit"]').click())
 assert.equal(calls,1)
 await app.close()
 assert.equal(signal.aborted,true)
 pending.resolve({state:'ready'})
 await flush()
 assert.equal(calls,1)
})


test('#86 QA: Member session-aborted POST stays locked after new capability until explicit check', async()=>{
 const first=deferred()
 let writes=0,capabilityReads=0
 const api={getCapability:async()=>{capabilityReads++;return {user:{login:'operator'},mode:'direct',branch:'main'}},
  register:()=>{writes++;return writes===1?first.promise:Promise.resolve({
   status:'committed',url:'https://github.com/sample/repo/commit/new'})}}
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  await act(async()=>input(app.host.querySelector('input[required]'),'Alice'))
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,1)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.ok(capabilityReads>=2)
  assert.match(app.host.textContent,/提交结果未知/)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,1)
  const unlock=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('解除提交锁定'))
  assert.ok(unlock)
  window.confirm=()=>false
  await act(async()=>unlock.click())
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  window.confirm=()=>true
  await act(async()=>unlock.click())
  await flush()
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,false)
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,2)
  first.resolve({status:'committed',url:'https://github.com/sample/repo/commit/old'})
  await flush()
  assert.equal(writes,2)
 } finally {window.confirm=()=>true;await app.close()}
})
test('#86 QA: Member transport failure locks POST; 403 explicitly rejected remains retryable',async()=>{
 let writes=0
 const api={getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'}),
  register:async()=>{writes++;if(writes===1)throw new TypeError('Network request failed')
   const e=Error('GitHub 403'); e.status=403; throw e}}
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  await act(async()=>input(app.host.querySelector('input[required]'),'Alice'))
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,1)
  assert.match(app.host.textContent,/提交结果未知/)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,1)
  const unlock=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('解除提交锁定'))
  await act(async()=>unlock.click())
  await flush()
  await act(async()=>app.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,2)
  assert.doesNotMatch(app.host.textContent,/提交结果未知/)
 } finally {await app.close()}
})
test('#86 QA: Config save transport failure blocks both writes through subsequent session GET',async()=>{
 let writes=0,reads=0
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...source,get:async(...args)=>{reads++;return source.get(...args)},
  save:async(...args)=>{writes++;if(writes===1)throw new TypeError('Connection reset')
   return source.save(...args)}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const yaml=app.host.querySelector('textarea').value+'\n# new change'
  await act(async()=>input(app.host.querySelector('textarea'),yaml))
  await act(async()=>app.host.querySelector('button[type="submit"]').click())
  assert.equal(writes,1)
  assert.match(app.host.textContent,/写入结果未知/)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.ok(reads>=2)
  assert.equal(app.host.querySelector('textarea').value,yaml)
  assert.ok(app.host.querySelector('button[type="submit"]').disabled)
  await act(async()=>app.host.querySelector('button[type="submit"]').click())
  assert.equal(writes,1)
  const unlock=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('解除锁定并重新读取'))
  assert.ok(unlock)
  await act(async()=>unlock.click())
  await flush()
  assert.ok(!app.host.querySelector('button[type="submit"]').disabled)
  await act(async()=>app.host.querySelector('button[type="submit"]').click())
  assert.equal(writes,2)
 } finally {await app.close()}
})
test('#86 QA: Config sync transport failure prevents second write until confirmed unlock',async()=>{
 let calls=0
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 const api={...source,sync:async(...args)=>{calls++;if(calls===1)throw new TypeError('Connection closed')
   return source.sync(...args)}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  await act(async()=>app.host.querySelector('input[type="checkbox"]').click())
  const sync=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认并执行 Label 同步'))
  assert.ok(sync&&!sync.disabled)
  await act(async()=>sync.click())
  assert.equal(calls,1)
  assert.match(app.host.textContent,/写入结果未知/)
  assert.ok(sync.disabled)
  await act(async()=>sync.click())
  assert.equal(calls,1)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  const newSync=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认并执行 Label 同步'))
  assert.ok(newSync.disabled)
  const unlock=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('解除锁定并重新读取'))
  await act(async()=>unlock.click())
  await flush()
  await act(async()=>app.host.querySelector('input[type="checkbox"]').click())
  const retry=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认并执行 Label 同步'))
  assert.ok(!retry.disabled)
  await act(async()=>retry.click())
  assert.equal(calls,2)
 } finally {await app.close()}
})
test('#86 QA: failed refresh leaves old Config HEAD unauthorized and draft copyable until valid GET',async()=>{
 const source=configFixture(new URLSearchParams({configCase:'changes'}))
 let failNext=false,writes=0
 const api={...source,get:async(...args)=>{
    if(failNext){failNext=false;throw Error('controlled GitHub 503')}
    return source.get(...args)
  },save:async()=>{writes++;return {state:'ready'}}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const draft=app.host.querySelector('textarea').value+'\n# local unsaved'
  await act(async()=>input(app.host.querySelector('textarea'),draft))
  failNext=true
  const refresh=[...app.host.querySelectorAll('button')].find(b=>b.textContent==='重新读取')
  assert.ok(refresh)
  await act(async()=>refresh.click())
  await flush()
  assert.match(app.host.textContent,/controlled GitHub 503/)
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.equal(app.host.querySelector('button[type="submit"]'),null)
  assert.equal(writes,0)
  const retry=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('重新读取 GitHub 配置'))
  assert.ok(retry)
  await act(async()=>retry.click())
  await flush()
  assert.doesNotMatch(app.host.textContent,/controlled GitHub 503/)
  assert.notEqual(app.host.querySelector('textarea').value,draft)
  assert.equal(writes,0)
 } finally {await app.close()}
})
test('#86 QA: malformed 200 or non-JSON POST response is classified as unknown',async()=>{
 const { createRepoHomeApi }=await server.ssrLoadModule('/plugins/repo-home/src/service.ts')
 const { createRepoConfigApi }=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 const { uncertainWriteResult }=await server.ssrLoadModule('/plugins/shared/src/browser-http.ts')
 const signal=new AbortController().signal
 const badJson=async()=>new Response('invalid json',{status:200})
 const badShape=async()=>new Response(JSON.stringify({state:23}),{
   status:200,headers:{'Content-Type':'application/json'}})
 const rejected=async()=>new Response(JSON.stringify({error:'Denied',state:'user_permission_missing'}),{
   status:403,headers:{'Content-Type':'application/json'}})
 for(const request of [badJson,badShape]){
  const config=createRepoConfigApi(request)
  await assert.rejects(config.save('sample','repo','yaml','head',null,signal),e=>
    e.outcomeUnknown===true&&uncertainWriteResult(e))
  await assert.rejects(config.sync('sample','repo','preview',true,signal),e=>
    e.outcomeUnknown===true&&uncertainWriteResult(e))
  const member=createRepoHomeApi(request)
  await assert.rejects(member.register('sample','repo','main',{name:'Alice',links:[]},signal),
    e=>e.outcomeUnknown===true&&uncertainWriteResult(e))
 }
 await assert.rejects(createRepoConfigApi(rejected).save('sample','repo','yaml','head',null,signal),
  e=>e.status===403&&!uncertainWriteResult(e))
})


test('#86 B1: malformed successful Config Save/Sync responses become unknown writes',async()=>{
 const {createRepoConfigApi}=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 const {uncertainWriteResult}=await server.ssrLoadModule('/plugins/shared/src/browser-http.ts')
 const signal=new AbortController().signal
 const response=body=>new Response(JSON.stringify(body),{
  status:200,headers:{'Content-Type':'application/json'}})
 const save=body=>createRepoConfigApi(async()=>response(body)).save(
  'sample','repo','namespaces:\n  status: [todo]','a'.repeat(40),'b'.repeat(40),signal)
 const sync=body=>createRepoConfigApi(async()=>response(body)).sync(
  'sample','repo','c'.repeat(64),true,signal)
 for(const body of [
  {state:'awaiting_pr_merge'},
  {state:'awaiting_pr_merge',prUrl:''},
  {state:'awaiting_pr_merge',prUrl:'https://evil.example/sample/repo/pull/1'},
  {state:'awaiting_pr_merge',prUrl:'https://github.com/sample/repo/issues/1'},
  {state:'unexpected'},
  {state:'sync_pending'},
  {state:'ready'},
  {state:'partial_failure'},
 ]){
  await assert.rejects(save(body),e=>e.outcomeUnknown===true&&uncertainWriteResult(e),
    'save response must be unknown: '+JSON.stringify(body))
 }
 for(const body of [
  {state:'unexpected'},
  {state:'awaiting_pr_merge',prUrl:'https://github.com/sample/repo/pull/3'},
  {state:'sync_pending',commitSha:'a'.repeat(40)},
  {state:'ready'},
  {state:'partial_failure'},
 ]){
  await assert.rejects(sync(body),e=>e.outcomeUnknown===true&&uncertainWriteResult(e),
    'sync response must be unknown: '+JSON.stringify(body))
 }
 assert.equal((await save({state:'awaiting_pr_merge',
  prUrl:'https://github.com/sample/repo/pull/88'})).state,'awaiting_pr_merge')
 assert.equal((await save({state:'sync_pending',commitSha:'d'.repeat(40),
  fileSha:'e'.repeat(40)})).state,'sync_pending')
 assert.equal((await save({state:'ready',noChanges:true})).state,'ready')
 assert.equal((await sync({state:'ready',createdLabels:[],removedAssociations:0})).state,'ready')
})
test('#86 B1: malformed 200 Config Save cannot create a second maintenance PR',async()=>{
 const {createRepoConfigApi}=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 const fixture=configFixture(new URLSearchParams({configCase:'changes'}))
 for(const bad of [{state:'awaiting_pr_merge'},{state:'unexpected'}]){
  let posts=0
  const wire=createRepoConfigApi(async()=>{posts++;return new Response(JSON.stringify(bad),{
   status:200,headers:{'Content-Type':'application/json'}})})
  const api={...fixture,save:(...args)=>wire.save(...args)}
  const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
   {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
  try{
   const area=app.host.querySelector('#repo-config-source')
   await act(async()=>input(area,area.value+'\n# changed B1'))
   let submit=app.host.querySelector('button[type="submit"]')
   assert.ok(submit&&!submit.disabled)
   await act(async()=>submit.click())
   assert.equal(posts,1)
   assert.match(app.host.textContent,/GitHub 写入结果未知/)
   submit=app.host.querySelector('button[type="submit"]')
   assert.ok(submit.disabled)
   await act(async()=>submit.click())
   assert.equal(posts,1)
   await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
   await flush()
   assert.equal(app.host.querySelector('button[type="submit"]').disabled,true)
   await act(async()=>app.host.querySelector('button[type="submit"]').click())
   assert.equal(posts,1)
  }finally{await app.close()}
 }
})
test('#86 B1: malformed 200 Config Sync blocks retry after capability refresh',async()=>{
 const {createRepoConfigApi}=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 const fixture=configFixture(new URLSearchParams({configCase:'changes'}))
 let posts=0
 const wire=createRepoConfigApi(async()=>{posts++;return new Response(
  JSON.stringify({state:'unexpected'}),{status:200,
   headers:{'Content-Type':'application/json'}})})
 const api={...fixture,sync:(...args)=>wire.sync(...args)}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  await act(async()=>app.host.querySelector('input[type="checkbox"]').click())
  let button=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认并执行 Label 同步'))
  assert.ok(button&&!button.disabled)
  await act(async()=>button.click())
  assert.equal(posts,1)
  assert.match(app.host.textContent,/GitHub 写入结果未知/)
  assert.equal(button.disabled,true)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  button=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认并执行 Label 同步'))
  assert.ok(button.disabled)
  await act(async()=>button.click())
  assert.equal(posts,1)
 }finally{await app.close()}
})


test('#96 root RepoPanel: URL target is required, anonymous read works, OAuth write remains disabled',async()=>{
 const calls={lookups:[],reads:[],writes:0,session:0}
 const repo={owner:'sample',name:'repo',full_name:'sample/repo'}
 const api=Object.freeze({
  getRepositories:async(_signal,target)=>{
   calls.lookups.push(target.full_name)
   return [repo]
  },
  getIssues:async(owner,name)=>{
   calls.reads.push(owner+'/'+name)
   return [{number:1,title:'受控公开 Issue',comments:1,
     html_url:'https://github.com/sample/repo/issues/1'}]
  },
  getSession:async()=>{calls.session++;return false},
  verify:async()=>{throw Error('OAuth not available')},
  createIssue:async()=>{calls.writes++;throw Error('OAuth write not allowed')},
 })
 const store=makeRepoStore(api)
 const app=await mount('/','/',RepoPanel,{store})
 try{
  assert.deepEqual(calls.lookups,[],'initial root must not enumerate repositories')
  assert.match(app.host.textContent,/GitHub 仓库 URL/)
  assert.ok(!app.host.textContent.includes('受控公开 Issue'))
  const field=app.host.querySelector('input[type="url"]')
  assert.ok(field)
  await act(async()=>input(field,'https://github.com/sample/repo'))
  const form=app.host.querySelector('form')
  await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await flush()
  assert.deepEqual(calls.lookups,[],'successful read must not probe Installation')
  assert.deepEqual(calls.reads,['sample/repo'])
  assert.match(app.host.textContent,/受控公开 Issue/)
  assert.match(app.host.textContent,/可匿名阅读/)
  const create=[...app.host.querySelectorAll('button')].find(x=>x.textContent.includes('发布动态'))
  assert.ok(create?.disabled,'anonymous users must not be able to open the Issue writer')
  assert.equal(calls.writes,0)
 }finally{await app.close();store.dispose()}
})


test('#99 Member pending PR prioritizes the exact external GitHub link with accessible focus',async()=>{
 localStorage.removeItem('labourchain:display-branch:sample/repo')
 let writes=0
 const api={
  getCapability:async()=>({user:{login:'operator',id:1},mode:'pr',branch:'main'}),
  register:async()=>{writes++;return {status:'pending_pr',
   url:'https://github.com/sample/repo/pull/17',sha:'a'.repeat(40),requestedBy:'operator'}},
 }
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  const field=app.host.querySelector('input[required]')
  assert.ok(field)
  assert.equal(app.host.querySelector('input[type="url"]').closest('details').open,false)
  const fields=[...app.host.querySelectorAll('form input, form textarea')]
  assert.deepEqual(fields.map(el=>el.getAttribute('maxlength')),['60','39','40','280',null,'24',null,'24',null,'24',null])
  assert.equal(fields[0],field)
  await act(async()=>input(field,'Alice'))
  await act(async()=>app.host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await flush()
  assert.equal(writes,1)
  const heading=app.host.querySelector('h2[tabindex="-1"]')
  assert.ok(heading)
  assert.match(heading.textContent,/等待管理员审核/)
  assert.equal(document.activeElement,heading)
  const cta=[...app.host.querySelectorAll('a')].find(x=>x.textContent.includes('查看 GitHub 审核记录'))
  assert.ok(cta)
  assert.equal(cta.href,'https://github.com/sample/repo/pull/17')
  assert.equal(cta.target,'_blank')
  assert.equal(cta.rel,'noopener noreferrer')
  const submit=app.host.querySelector('button[type="submit"]')
  assert.ok(submit?.disabled,'pending maintenance PR must block duplicate submit')
  await act(async()=>app.host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(writes,1)
  const secondary=[...app.host.querySelectorAll('a')].find(x=>x.textContent.includes('查看成员列表'))
  assert.ok(secondary)
  assert.ok(secondary.href.endsWith('/sample/repo/members'))
  assert.ok(heading.compareDocumentPosition(app.host.querySelector('form')) & Node.DOCUMENT_POSITION_FOLLOWING)
 }finally{await app.close()}
})

test('#99 Config display-branch preference stays local and never invokes repository writes',async()=>{
 const key='labourchain:display-branch:sample/repo'
 localStorage.removeItem(key)
 const fixture=configFixture(new URLSearchParams({configCase:'changes'}))
 let saves=0
 const api={...fixture,save:async()=>{saves++;throw Error('must not write')}}
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api,owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  const inputNode=app.host.querySelector('#display-branch-input')
  assert.ok(inputNode)
  await act(async()=>input(inputNode,'feature/docs'))
  const button=[...app.host.querySelectorAll('button')].find(x=>x.textContent==='保存本机偏好')
  assert.ok(button)
  await act(async()=>button.click())
  assert.equal(localStorage.getItem(key),'feature/docs')
  assert.equal(saves,0)
  assert.match(app.host.textContent,/不修改 GitHub 仓库默认分支/)
 }finally{await app.close();localStorage.removeItem(key)}
})


test('#99 Config local preview cannot redirect member write branch across pages',async()=>{
 const key='labourchain:display-branch:sample/repo'
 localStorage.removeItem(key)
 const configFixtureApi=configFixture(new URLSearchParams({configCase:'changes'}))
 let configWrites=0,memberWrites=0
 const config=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api:{...configFixtureApi,save:async()=>{configWrites++;throw Error('unexpected config write')}},
   owner:'sample',repo:'repo'},p=>p.owner+'/'+p.repo)
 try{
  await act(async()=>input(config.host.querySelector('#display-branch-input'),'feature/docs'))
  const save=[...config.host.querySelectorAll('button')].find(b=>b.textContent==='保存本机偏好')
  assert.ok(save)
  await act(async()=>save.click())
  assert.equal(localStorage.getItem(key),'feature/docs')
  assert.equal(configWrites,0)
 }finally{await config.close()}
 const reads=[],checks=[],submitted=[]
 const api={
  getHome:async(owner,repo,branch)=>{
   reads.push(branch)
   return {repository:{full_name:owner+'/'+repo,name:repo,description:'Preview',
    html_url:'https://github.com/sample/repo',default_branch:'main'},
    branch,readme:{state:'missing'},team:{state:'empty',members:[]}}
  },
  getFeed:async(_owner,_repo,page)=>({page,hasMore:false,items:[]}),
  getCapability:async(owner,repo,branch)=>{
   checks.push({owner,repo,branch})
   return {user:{login:'operator',id:1},branch:'main',mode:'pr',protected:true}
  },
  register:async(owner,repo,branch,member)=>{
   memberWrites++;submitted.push({owner,repo,branch,member})
   return {status:'pending_pr',url:'https://github.com/sample/repo/pull/42',
    sha:'a'.repeat(40),requestedBy:'operator'}
  },
 }
 try{
  const home=await mount('/sample/repo','/:owner/:repo',Home,{api})
  try{
   assert.ok(reads.includes('feature/docs'),'preview must still use local preference')
   assert.ok(checks.every(c=>c.branch==='main'),'home permission may only check authorized main')
  }finally{await home.close()}
  const members=await mount('/sample/repo/members','/:owner/:repo/members',Members,{api})
  try{
   assert.ok(reads.every(b=>b==='feature/docs'))
   assert.ok(checks.every(c=>c.branch==='main'))
   assert.match(members.host.textContent,/写入分支 main/)
  }finally{await members.close()}
  const registration=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
  try{
   assert.ok(registration.host.querySelector('form'))
   assert.match(registration.host.textContent,/登记写入固定分支 main/)
   await act(async()=>input(registration.host.querySelector('input[required]'),'Alice'))
   await act(async()=>registration.host.querySelector('form').dispatchEvent(
    new Event('submit',{bubbles:true,cancelable:true})))
   await flush()
   assert.equal(memberWrites,1)
   assert.deepEqual(submitted.map(x=>[x.owner,x.repo,x.branch]),[['sample','repo','main']])
   assert.ok(checks.every(c=>c.branch==='main'))
  }finally{await registration.close()}
 }finally{localStorage.removeItem(key)}
})

test('#99 member registration fails closed when server capability branch differs from write target',async()=>{
 const key='labourchain:display-branch:sample/repo'
 localStorage.setItem(key,'feature/docs')
 let writes=0
 const api={
  getCapability:async()=>({user:{login:'operator',id:1},branch:'feature/docs',mode:'pr'}),
  register:async()=>{writes++;throw Error('must not send')},
 }
 const registration=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  assert.equal(registration.host.querySelector('form'),null)
  assert.match(registration.host.textContent,/已拒绝提交/)
  assert.equal(writes,0)
 }finally{await registration.close();localStorage.removeItem(key)}
})

test('#15 scoped Issue creation requires the exact selected repository and OAuth session', async()=>{
 let writes=0,requested=[]
 const api={
  getRepositories:async(_signal,target)=>{requested.push(target.full_name);return [target]},
  getSession:async()=>false,
  createIssue:async()=>{writes++;throw Error('must not write')},
 }
 const page=await mount('/sample/repo/issues/new','/:owner/:repo/issues/new',CreateIssue,
   {api,owner:'sample',repo:'repo'})
 try{
  assert.ok(requested.length >= 1 && requested.every(value => value === 'sample/repo'))
  assert.equal(page.host.querySelector('form'),null)
  assert.match(page.host.textContent,/登录 GitHub 后才能发布动态/)
  const link=page.host.querySelector('a[href^="/api/github-login?"]')
  assert.ok(link)
  assert.equal(new URLSearchParams(link.getAttribute('href').split('?')[1]).get('return_to'),
    '/sample/repo/issues/new')
  assert.equal(writes,0)
 } finally {await page.close()}
})

test('#15 scoped Issue submit is single-flight and confirms the same repository', async()=>{
 const target={owner:'sample',name:'repo',full_name:'sample/repo'}
 const pending=deferred()
 let writes=0,actual
 const api={
  getRepositories:async()=>[target],
  getSession:async()=>true,
  createIssue:async(repo,title,body)=>{writes++;actual={repo,title,body};return pending.promise},
 }
 const page=await mount('/sample/repo/issues/new','/:owner/:repo/issues/new',CreateIssue,
   {api,owner:'sample',repo:'repo'})
 try{
  const field=page.host.querySelector('#create-issue-title')
  assert.ok(field)
  await act(async()=>input(field,'Scoped task'))
  const form=page.host.querySelector('form')
  assert.ok(form)
  await act(async()=>{
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
  })
  assert.equal(writes,1)
  assert.deepEqual(actual,{repo:target,title:'Scoped task',body:''})
  pending.resolve({number:47,html_url:'https://github.com/sample/repo/issues/47'})
  await flush()
  assert.match(page.host.textContent,/动态已发布 · #47/)
  assert.equal(page.host.querySelector('form'),null)
  assert.ok(page.host.querySelector('a[href="/sample/repo/issues/47"]'))
  assert.ok(page.host.querySelector('a[href="https://github.com/sample/repo/issues/47"]'))
 }finally{await page.close()}
})

test('#15 invalid Issue creation response blocks retry after possible GitHub write',async()=>{
 let posts=0
 const api={
  getRepositories:async()=>[{owner:'sample',name:'repo',full_name:'sample/repo'}],
  getSession:async()=>true,
  createIssue:async()=>{posts++;return {number:2,
    html_url:'https://github.com/other/repo/issues/2'}},
 }
 const page=await mount('/sample/repo/issues/new','/:owner/:repo/issues/new',CreateIssue,
   {api,owner:'sample',repo:'repo'})
 try{
  await act(async()=>input(page.host.querySelector('#create-issue-title'),'Attempt'))
  await act(async()=>page.host.querySelector('form').dispatchEvent(
   new Event('submit',{bubbles:true,cancelable:true})))
  assert.equal(posts,1)
  assert.match(page.host.textContent,/发布结果尚未确认/)
  assert.equal(page.host.querySelector('form'),null)
  assert.doesNotMatch(page.host.innerHTML,/href="https:\/\/github.com\/other\/repo\/issues\/2"/)
 }finally{await page.close()}
})

test('#99 D2: concise RepoHome retains one members entry, genuine identities and issue source links',async()=>{
 const api={
  getHome:async()=>({
   repository:{name:'repo',full_name:'sample/repo',
     html_url:'https://github.com/sample/repo',description:'Real project description'},
   branch:'main',
   team:{state:'ready',members:[{id:'one',name:'Alice',role:'Maintainer'},
     {id:'two',name:'Bob',role:'Reviewer'}]},
   readme:{state:'missing'},
  }),
  getFeed:async(_o,_r,page)=>({
   page,hasMore:false,items:[{
    id:71,number:71,title:'Document actual state',state:'closed',
    body:'A useful Issue summary for the public project.',
    html_url:'https://github.com/sample/repo/issues/71',
    user:{login:'operator'},updated_at:'2026-11-22T12:00:00Z',
   }],
  }),
  getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'}),
 }
 const app=await mount('/sample/repo','/:owner/:repo',Home,{api})
 try{
  const nav=app.host.querySelectorAll('a[href="/sample/repo/members"]')
  assert.equal(nav.length,1,'team directory must not look like another member')
  const teamHead=app.host.querySelector('#team-heading')?.parentElement
  const feedHead=app.host.querySelector('#feed-heading')?.parentElement
  assert.ok(teamHead && feedHead)
  assert.equal(teamHead.dataset.teamState,'ready')
  const [heading,memberStrip,actions]=teamHead.children
  assert.equal(heading.id,'team-heading')
  assert.equal(memberStrip.getAttribute('aria-label'),'团队成员')
  assert.equal(teamHead.children.length,3)
  for (const path of ['/sample/repo/members','/sample/repo/members/register']) {
    const anchor=app.host.querySelector('a[href="'+path+'"]')
    assert.ok(anchor,'existing scoped team link: '+path)
    assert.equal(anchor.parentElement,actions,'team CTA must be a direct action-group link after the member strip')
  }
  const createIssue=app.host.querySelector('a[href="/sample/repo/issues/new"]')
  assert.ok(createIssue)
  assert.equal(createIssue.parentElement,feedHead,'Issue CTA must be a direct sectionHead link')
  const css=readFileSync(new URL('../plugins/repo-home/src/RepoHome.module.css',import.meta.url),'utf8')
  const targetRule=css.match(/\.homePage \.sectionHead > a\s*\{([^}]*)\}/)?.[1] ?? ''
  for (const contract of [/display:\s*inline-flex/,/min-height:\s*44px/,
    /min-width:\s*44px/,/max-width:\s*100%/,/overflow-wrap:\s*anywhere/]) {
    assert.match(targetRule,contract,'sectionHead links must keep accessible hit-area styling')
  }
  const gridRule=css.match(/\.homePage \.teamPanel\[data-team-state='ready'\]\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(gridRule,/grid-template-columns:auto minmax\(0,1fr\) auto/)
  assert.doesNotMatch(gridRule,/(?:height:|overflow:|transform:|contain:)/)
  assert.match(css,/\.homePage \.teamPanel\[data-team-state='ready'\] \{grid-template-columns:minmax\(0,1fr\)/)
  assert.match(css,/\.homePage \.strip \{min-width:0;padding:6px\}/)
  assert.match(css,/\.homePage \.issueBody > div > :is\(div,ul,ol,blockquote\) \{max-width:85ch\}/)
  const strip=app.host.querySelector('[aria-label="团队成员"]')
  assert.ok(strip)
  assert.match(strip.textContent,/Alice.*Maintainer.*Bob.*Reviewer/)
  assert.equal(strip.querySelectorAll('button[aria-expanded]').length,2)
  assert.ok(app.host.querySelector('a[href="/sample/repo/config"]'))
  assert.ok(app.host.querySelector('a[href="/sample/repo/channels"]'))
  const card=app.host.querySelector('article')
  assert.ok(card)
  assert.equal(card.querySelector('[data-state="closed"]').textContent.trim(),'已关闭')
  assert.equal(card.querySelectorAll('a[href="/sample/repo/issues/71"]').length,1)
  assert.match(card.textContent,/#71/)
  assert.match(card.textContent,/operator/)
  assert.match(card.textContent,/A useful Issue summary/)
  const source=card.querySelector('a[href="https://github.com/sample/repo/issues/71"]')
  assert.equal(source?.getAttribute('target'),'_blank')
  assert.equal(source.getAttribute('aria-label'),'GitHub 原文')
  assert.ok(source.querySelector('svg'))
  assert.ok(source.parentElement.querySelector('time[datetime="2026-11-22T12:00:00Z"]'))
  assert.match(source.parentElement.textContent,/更新于/)
 }finally{await app.close()}
})

test('#99 compact team layout preserves missing, empty, error and unauthorized states',async()=>{
 for(const [team,allowed,label] of [
  [{state:'missing'},true,'尚未添加团队成员'],
  [{state:'empty',members:[]},false,'暂无成员'],
  [{state:'invalid',error:'bad format'},true,'成员文件格式错误'],
  [{state:'error',error:'network'},true,'成员文件读取失败'],
  [{state:'ready',members:[{id:'x',name:'Real Member',role:'Reviewer'}]},false,'Real Member'],
 ]){
  const api={
   getHome:async()=>({repository:{name:'repo',full_name:'sample/repo',
    html_url:'https://github.com/sample/repo'},branch:'main',team,readme:{state:'missing'}}),
   getFeed:async(_o,_r,page)=>({page,hasMore:false,items:[]}),
   getCapability:async()=>{if(!allowed)throw Error('denied')
    return {user:{login:'operator'},mode:'direct',branch:'main'}}
  }
  const app=await mount('/sample/repo','/:owner/:repo',Home,{api})
  try{
   const panel=app.host.querySelector('#team-heading').parentElement
   assert.equal(panel.dataset.teamState,team.state)
   assert.ok(panel.textContent.includes(label))
   assert.equal(panel.querySelectorAll('a[href="/sample/repo/members"]').length,1)
   assert.equal(Boolean(panel.querySelector('a[href="/sample/repo/members/register"]')),
     allowed&&['ready','empty','missing'].includes(team.state))
   assert.equal(Boolean(panel.querySelector('[aria-label="团队成员"]')),team.state==='ready')
   if(['invalid','error'].includes(team.state)){
    assert.ok(panel.querySelector('[role="alert"]'))
    assert.match(panel.textContent,/重试/)
   }
  }finally{await app.close()}
 }
})

test('#69 Issue Detail Markdown image fallback and keyboard tabs preserve the actual comment draft',async()=>{
 const svc=issueService({authorized:true,comments:()=>Promise.resolve({items:[
  comment(101,'## Comment heading\n\n**Readable comment**\n\n![broken picture](https://example.com/comment.png)'),
  comment(102,'<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'),
 ],hasMore:false})})
 svc.getIssue=async(_o,_r,n)=>({...issue(n),body:'# Topic heading\n\n![topic image](https://example.com/topic.png)'})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc},p=>p.owner+'/'+p.repo+'/issues/'+p.number)
 try{
  assert.match(app.host.textContent,/Topic heading/)
  assert.match(app.host.textContent,/Comment heading/)
  assert.match(app.host.textContent,/<script>alert\(1\)<\/script>/)
  assert.equal(app.host.querySelector('script,iframe,a[href^="javascript:"]'),null)
  const img=app.host.querySelector('img[alt="broken picture"]')
  assert.ok(img)
  assert.equal(img.getAttribute('referrerpolicy'),'no-referrer')
  await act(async()=>img.dispatchEvent(new Event('error')))
  assert.equal(app.host.querySelector('img[alt="broken picture"]'),null)
  assert.match(app.host.textContent,/图片加载失败：broken picture/)
  const draft=app.host.querySelector('form[aria-label="参与讨论"] textarea')
  await act(async()=>input(draft,'kept across tabs'))
  const [discussion,labour]=app.host.querySelectorAll('[role="tab"]')
  discussion.focus()
  await act(async()=>discussion.dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true})))
  assert.equal(document.activeElement,labour)
  assert.equal(labour.getAttribute('aria-selected'),'true')
  assert.equal(app.host.querySelector('[id="'+discussion.getAttribute('aria-controls')+'"]').hidden,true)
  await act(async()=>labour.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true})))
  assert.equal(document.activeElement,discussion)
  assert.equal(discussion.getAttribute('aria-selected'),'true')
  assert.equal(app.host.querySelector('form[aria-label="参与讨论"] textarea').value,'kept across tabs')
 }finally{await app.close()}
})

const replyComment=(id,body,extra={})=>({...comment(id,body),html_url:'https://github.com/sample/repo/issues/1#issuecomment-'+id,...extra})
const replyArea=app=>app.host.querySelector('form[aria-label="参与讨论"] textarea')
const replySend=app=>app.host.querySelector('form[aria-label="参与讨论"] button[type="submit"]')
const quoteButtons=app=>[...app.host.querySelectorAll('button[aria-label^="引用回复 "]')]
const quotePreview=app=>app.host.querySelector('[aria-label="当前引用"]')
const issueMount=svc=>mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
  {service:svc},p=>p.owner+'/'+p.repo+'/issues/'+p.number)
test('#69 quote choose/replace/cancel, tab and refresh preserve user draft; validates exact POST and clears on success',async()=>{
 const rows=[replyComment(101,'first line\nsecond line'),replyComment(102,'second target',{user:{login:'bob'}}),
  replyComment(103,'wrong permalink',{html_url:'https://github.com/other/repo/issues/1#issuecomment-103'})]
 const writes=[]
 const svc=issueService({authorized:true,comments:()=>Promise.resolve({items:rows,hasMore:false}),
  postComment:async(o,r,n,body)=>{writes.push({o,r,n,body});return {id:999}}})
 const app=await issueMount(svc)
 const originalConfirm=window.confirm
 try{
  await act(async()=>input(replyArea(app),'my reply'))
  await act(async()=>quoteButtons(app)[0].click())
  assert.match(quotePreview(app).textContent,/回复 alice/)
  assert.equal(replyArea(app).value,'my reply')
  assert.equal(document.activeElement,replyArea(app))
  await act(async()=>quoteButtons(app)[1].click())
  assert.match(quotePreview(app).textContent,/回复 bob/)
  await act(async()=>quotePreview(app).querySelector('button').click())
  assert.equal(quotePreview(app),null)
  assert.equal(replyArea(app).value,'my reply')
  await act(async()=>quoteButtons(app)[2].click())
  assert.equal(quotePreview(app).querySelector('a'),null)
  await act(async()=>quoteButtons(app)[0].click())
  const [discussion,labourTab]=app.host.querySelectorAll('[role="tab"]')
  await act(async()=>labourTab.click())
  assert.equal(replyArea(app).closest('form').hidden,true)
  await act(async()=>discussion.click())
  assert.equal(replyArea(app).value,'my reply')
  assert.match(quotePreview(app).textContent,/回复 alice/)
  const scroller=app.host.querySelector('[aria-label="Issue 阅读区"]')
  scroller.scrollTop=150
  await act(async()=>app.host.querySelector('[aria-label="从 GitHub 重新加载此 Issue"]').click())
  await flush()
  assert.equal(app.host.querySelector('[aria-label="Issue 阅读区"]'),scroller)
  assert.equal(replyArea(app).value,'my reply')
  assert.ok(quotePreview(app))
  window.confirm=()=>false
  await act(async()=>replySend(app).click())
  assert.equal(writes.length,0)
  assert.ok(quotePreview(app))
  window.confirm=()=>true
  await act(async()=>replySend(app).click())
  await flush()
  assert.deepEqual(writes,[{o:'sample',r:'repo',n:1,body:'回复 [alice](https://github.com/sample/repo/issues/1#issuecomment-101)\n\n> first line\n> second line\n\nmy reply'}])
  assert.equal(replyArea(app).value,'')
  assert.equal(quotePreview(app),null)
  assert.match(app.host.textContent,/GitHub 已确认发表/)
 }finally{window.confirm=originalConfirm;await app.close()}
})
test('#69 quote total length, empty reply and unauthorized state prevent writes',async()=>{
 for(const authorized of [true,false]){
  let writes=0
  const svc=issueService({authorized,comments:()=>Promise.resolve({items:[replyComment(101,'长'.repeat(1500))],hasMore:false}),
    postComment:async()=>{writes++;return {id:999}}})
  const app=await issueMount(svc)
  try{
   await act(async()=>quoteButtons(app)[0].click())
   assert.match(quotePreview(app).textContent,/引用已截取/)
   assert.equal(replySend(app).disabled,true)
   await act(async()=>input(replyArea(app),'x'.repeat(20000)))
   assert.equal(replySend(app).disabled,true)
   assert.match(app.host.textContent,/超过 20000 字符/)
   await act(async()=>replyArea(app).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
   assert.equal(writes,0)
   await act(async()=>input(replyArea(app),'short'))
   assert.equal(replySend(app).disabled,!authorized)
   if(!authorized){
    await act(async()=>replyArea(app).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    assert.equal(writes,0)
   }
  }finally{await app.close()}
 }
})
test('#69 failed or uncertain reply retains quote/draft; same-tick double submit and newer editing are isolated',async()=>{
 for(const outcome of ['failure','unknown','success']){
  const pending=deferred()
  let writes=0
  const svc=issueService({authorized:true,comments:()=>Promise.resolve({items:[replyComment(101,'one'),replyComment(102,'two')],hasMore:false}),
    postComment:()=>{writes++;return pending.promise}})
  const app=await issueMount(svc)
  try{
   await act(async()=>quoteButtons(app)[0].click())
   await act(async()=>input(replyArea(app),'submitted'))
   const form=replyArea(app).closest('form')
   await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
   assert.equal(writes,1)
   if(outcome==='success'){
    await act(async()=>quoteButtons(app)[1].click())
    await act(async()=>input(replyArea(app),'new draft'))
    await act(async()=>pending.resolve({id:999}))
   }else await act(async()=>pending.reject(Error(outcome==='unknown'?'网络中断，结果未知':'GitHub rejected')))
   await flush()
   assert.ok(quotePreview(app))
   assert.equal(replyArea(app).value,outcome==='success'?'new draft':'submitted')
   if(outcome!=='success')assert.match(app.host.textContent,/避免重复发表/)
   else assert.match(quotePreview(app).textContent,/two/)
   await app.go('/sample/repo/issues/2')
   assert.equal(quotePreview(app),null)
   assert.equal(replyArea(app).value,'')
  }finally{await app.close()}
 }
})

test('#69 B2 visual viewport resize keeps quote, feedback, last comment and pagination mounted in compact mode',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(window,'visualViewport')
 const viewport=new window.EventTarget()
 viewport.height=812;viewport.offsetTop=0
 Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport})
 let writes=0
 const svc=issueService({authorized:true,comments:(_n,page)=>Promise.resolve({items:[
  replyComment(100+page,'长引用'.repeat(500),{user:{login:'long-author'}}),
  replyComment(200+page,'last comment page '+page)
 ],hasMore:page===1}),postComment:async()=>{writes++;throw Error('GitHub rejected '.repeat(40))}})
 let app
 try{
  app=await issueMount(svc)
  const shell=app.host.querySelector('[aria-label="Issue 讨论面板"]')
  const reading=app.host.querySelector('[aria-label="Issue 阅读区"]')
  const page=shell.parentElement
  assert.equal(page.dataset.heightMode,'split')
  await act(async()=>quoteButtons(app)[0].click())
  await act(async()=>input(replyArea(app),'long draft\n'.repeat(1000)))
  await act(async()=>replySend(app).click())
  await flush()
  assert.equal(writes,1)
  assert.match(app.host.textContent,/避免重复发表/)
  for(const height of [480,479,320,280,240,200,160,120,80,812]){
   await act(async()=>{viewport.height=height;viewport.dispatchEvent(new Event('resize'))})
   assert.equal(page.dataset.heightMode,height<480?'compact':'split')
   assert.equal(page.style.getPropertyValue('--issue-available-height'),height+'px')
   assert.equal(app.host.querySelector('[aria-label="Issue 讨论面板"]'),shell)
   assert.equal(app.host.querySelector('[aria-label="Issue 阅读区"]'),reading)
   assert.equal(replyArea(app).value,'long draft\n'.repeat(1000))
   assert.ok(quotePreview(app))
   assert.ok(replySend(app))
   assert.match(app.host.textContent,/last comment page 1|避免重复发表/)
  }
  await act(async()=>{viewport.height=160;viewport.dispatchEvent(new Event('resize'))})
  await act(async()=>[...reading.querySelectorAll('button')].find(b=>b.textContent==='加载下一页评论').click())
  await flush()
  assert.match(reading.textContent,/last comment page 2/)
  await act(async()=>quotePreview(app).querySelector('button').click())
  assert.equal(quotePreview(app),null)
  assert.equal(document.activeElement,replyArea(app))
  assert.equal(replyArea(app).value,'long draft\n'.repeat(1000))
 }finally{
  if(app)await app.close()
  if(descriptor)Object.defineProperty(window,'visualViewport',descriptor)
  else delete window.visualViewport
 }
})

test('#99 Title layout uses measured card width, one identity/README/actions/team order, safe optional cover and secondary settings',async()=>{
 const source=(await server.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx'))
 for(const [width,layout] of [[320,'small'],[479,'small'],[480,'narrow'],[699,'narrow'],[700,'medium'],[1099,'medium'],[1100,'wide']])
  assert.equal(source.titleLayout(width),layout)
 const cover='https://raw.githubusercontent.com/sample/repo/'+'a'.repeat(40)+'/banner.png'
 const api={getHome:async()=>({repository:{name:'repo',full_name:'sample/repo',description:'Real description',
  html_url:'https://github.com/sample/repo'},branch:'main',readme:{state:'ready',path:'README.md',content:'# repo\n\nReal description\n\nUnique README prose'},
  team:{state:'ready',members:[{id:'1',name:'Alice',role:'Reviewer'}]}}),
  getFeed:async(_o,_r,page)=>({page,hasMore:false,items:[]}),getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'})}
 for(const url of [undefined,cover,'javascript:alert(1)','https://raw.githubusercontent.com/other/repo/'+'a'.repeat(40)+'/banner.png']){
  const app=await mount('/sample/repo','/:owner/:repo',Home,{api,coverUrl:url})
  try{
   const title=app.host.querySelector('[data-title-layout]')
   const header=title.querySelector('header')
   assert.equal(header.children.length,3)
   assert.match(header.children[0].textContent,/sample\/repo.*Real description/)
   assert.match(header.children[1].textContent,/Unique README prose/)
   assert.doesNotMatch(header.children[1].textContent,/Real description/)
   const actions=header.children[2]
   assert.equal(actions.querySelector('a[href="/sample/repo/channels"]').textContent,'项目频道')
   const more=actions.querySelector('details')
   assert.ok(more&&!more.open,'settings and source are secondary by default')
   assert.ok(more.querySelector('a[href="/sample/repo/config"]'))
   assert.ok(more.querySelector('a[href="https://github.com/sample/repo"]'))
   assert.equal(title.querySelector('a[href="#feed-heading"]'),null,'no duplicate same-page feed link')
   assert.ok(title.contains(app.host.querySelector('#team-heading')))
   assert.equal(title.querySelector('img')?.getAttribute('src'),url===cover?cover:undefined)
   if(url===cover){
    const img=title.querySelector('img')
    assert.equal(img.getAttribute('referrerpolicy'),'no-referrer')
    assert.equal(img.getAttribute('alt'),'')
    await act(async()=>img.dispatchEvent(new Event('error')))
    assert.equal(title.querySelector('img'),null)
   }
   assert.ok(app.host.querySelector('#feed-heading'))
   assert.equal(app.host.querySelector('a[href="/sample/repo/issues/new"]').textContent,'发布动态')
   assert.equal(title.querySelector('a[href="https://github.com/sample/repo/blob/main/README.md"]').textContent,'完整项目说明（GitHub）')
  }finally{await app.close()}
 }
})

test('#99 Title reacts to card width changes without remounting Team or reloading data',async()=>{
 const original=globalThis.ResizeObserver
 const rect=HTMLElement.prototype.getBoundingClientRect
 let width=1160, callback, observed, disconnects=0
 globalThis.ResizeObserver=class {
  constructor(cb){callback=cb}
  observe(node){observed=node}
  disconnect(){disconnects++}
 }
 HTMLElement.prototype.getBoundingClientRect=function(){
  return this.hasAttribute('data-title-layout')?{width,height:250,x:0,y:0,top:0,left:0,bottom:250,right:width,toJSON(){}}:rect.call(this)
 }
 let app,homeCalls=0,feedCalls=0
 const api={getHome:async()=>{homeCalls++;return {repository:{name:'repo',full_name:'sample/repo',description:'Description',html_url:'https://github.com/sample/repo'},branch:'main',readme:{state:'missing'},team:{state:'ready',members:[{id:'1',name:'Alice',role:'Reviewer'}]}}},
 getFeed:async(_o,_r,page)=>{feedCalls++;return {page,hasMore:false,items:[]}},
 getCapability:async()=>({user:{login:'operator'},mode:'direct',branch:'main'})}
 try{
  app=await mount('/sample/repo','/:owner/:repo',Home,{api})
  const title=app.host.querySelector('[data-title-layout]'), strip=title.querySelector('[aria-label="团队成员"]')
  assert.equal(observed,title)
  assert.equal(title.dataset.titleLayout,'wide')
  const initial=[homeCalls,feedCalls]
  for(const [w,mode] of [[1099,'medium'],[700,'medium'],[699,'narrow'],[480,'narrow'],[479,'small'],[320,'small'],[1100,'wide']]){
   await act(async()=>{width=w;callback()})
   assert.equal(title.dataset.titleLayout,mode)
   assert.equal(title.querySelector('[aria-label="团队成员"]'),strip)
   assert.deepEqual([homeCalls,feedCalls],initial)
  }
  await app.close();app=null
  assert.ok(disconnects>=1)
 }finally{if(app)await app.close();HTMLElement.prototype.getBoundingClientRect=rect;if(original===undefined)delete globalThis.ResizeObserver;else globalThis.ResizeObserver=original}
})

test('#69 Members full cards preserve stored order, complete profile content, safe links and scoped permissions',async()=>{
 const key='labourchain:display-branch:sample/repo'
 const original=localStorage.getItem(key)
 localStorage.setItem(key,'feature/docs')
 const bio='First line\n'+'Long biography '.repeat(100)+'\nLast line'
 const members=[{id:'z',name:'Zed',role:'Maintainer',bio,githubUsername:'zed',
   avatarUrl:'https://example.com/avatar.png',links:[{label:'Portfolio',url:'https://example.com/portfolio'},{label:'Notes',url:'https://example.com/notes'}]},
   {id:'a',name:'Ada'}]
 const reads=[],checks=[]
 let allowed=false
 const api={
   getHome:async(o,r,b)=>{reads.push(b);return {repository:{name:r,full_name:o+'/'+r},
      branch:b,team:{state:'ready',members},readme:{state:'missing'}}},
   getCapability:async(o,r,b)=>{checks.push(b);if(!allowed)throw Error('temporary capability error')
      return {user:{login:'operator'},mode:'direct',branch:'main'}},
 }
 let app
 try{
   app=await mount('/sample/repo/members','/:owner/:repo/members',Members,{api})
   const cards=[...app.host.querySelectorAll('article')]
   assert.equal(cards.length,2)
   assert.deepEqual(cards.map(card=>card.querySelector('h2').textContent),['Zed','Ada'])
   assert.ok([...cards[0].querySelectorAll('p')].some(p=>p.textContent===bio))
   assert.equal(cards[1].querySelector('p'),null)
   assert.equal(cards[1].querySelector('a'),null)
   assert.deepEqual([...cards[0].querySelectorAll('a')].map(a=>[a.textContent,a.getAttribute('href')]),
     [['GitHub @zed','https://github.com/zed'],['Portfolio','https://example.com/portfolio'],['Notes','https://example.com/notes']])
   for(const a of cards[0].querySelectorAll('a')){
     assert.equal(a.target,'_blank')
     assert.ok(a.relList.contains('noopener')&&a.relList.contains('noreferrer'))
   }
   const img=cards[0].querySelector('img')
   assert.ok(img)
   await act(async()=>img.dispatchEvent(new Event('error')))
   assert.equal(cards[0].querySelector('img'),null)
   assert.match(app.host.querySelector('h1').textContent,/团队成员 \(2\)/)
   assert.equal(app.host.querySelector('a[href="/sample/repo/members/register"]'),null)
   assert.match(app.host.textContent,/登记权限暂无法验证/)
   allowed=true
   await act(async()=>[...app.host.querySelectorAll('button')].find(b=>b.textContent==='重试检查').click())
   await flush()
   assert.ok(app.host.querySelector('a[href="/sample/repo/members/register"]'))
   assert.match(app.host.textContent,/写入分支 main/)
   assert.ok(reads.length&&reads.every(b=>b==='feature/docs'))
   assert.ok(checks.length&&checks.every(b=>b==='main'))
   assert.equal(app.host.querySelectorAll('article').length,2)
 }finally{if(app)await app.close();if(original===null)localStorage.removeItem(key);else localStorage.setItem(key,original)}
})

test('structured repository denial coalesces read failures and retry adds no success probe',async()=>{
 const {RepoAccessRequestProvider}=await server.ssrLoadModule('/plugins/github-access/src/RepoAccessNotice.tsx')
 const {inspectRepoAccess}=await server.ssrLoadModule('/plugins/github-access/src/access.ts')
 let allowed=false,capability=0
 const requests=[]
 const request=async(path,init)=>{
   requests.push(path)
   assert.ok(init.signal)
   if(path==='/api/github-session')return Response.json({authenticated:true})
   assert.match(path,/github-installation-probe/)
   return Response.json({state:'needs_installation',repository:'sample/repo',action_url:'https://github.com/apps/labourchain/installations/new'})
 }
 const denial=()=>Object.assign(Error('denied'),{status:403,state:'repo_access_required'})
 const api={getHome:async(o,r,b)=>{if(!allowed)throw denial();return {repository:{name:r,full_name:o+'/'+r,description:'Recovered repository'},branch:b,team:{state:'empty',members:[]},readme:{state:'missing'}}},
   getFeed:async(o,r,page)=>{if(!allowed)throw denial();return {page,items:[],hasMore:false}},
   getCapability:async()=>{capability++;throw Error('denied')}}
 function Page(){return h(RepoAccessRequestProvider,{request},h(Home,{api}))}
 const app=await mount('/sample/repo','/:owner/:repo',Page,{})
 try{
   await flush();await flush()
   assert.equal(app.host.querySelectorAll('[aria-label="仓库访问授权"]').length,1)
   assert.equal(requests.length,2)
   assert.equal(capability,0)
   assert.ok(app.host.querySelector('a[href="https://github.com/apps/labourchain/installations/new"]'))
   allowed=true
   const retry=[...app.host.querySelectorAll('button')].find(b=>b.textContent==='重新核验并读取')
   await act(async()=>retry.click());await flush()
   assert.match(app.host.textContent,/Recovered repository/)
   assert.equal(app.host.querySelectorAll('[aria-label="仓库访问授权"]').length,0)
   assert.equal(requests.length,2)
 }finally{await app.close()}
 let anonymousCalls=0
 assert.deepEqual(await inspectRepoAccess('sample','repo',new AbortController().signal,async()=>{anonymousCalls++;return Response.json({authenticated:false})}),{state:'login_required'})
 assert.equal(anonymousCalls,1)
})

test('#115 actual RepoPanel route keeps current list and refresh after invalid or reserved URL',async()=>{
 const reads=[],probes=[]
 const api=Object.freeze({
  getRepositories:async(...args)=>{probes.push(args);throw Error('unexpected probe')},
  getIssues:async(owner,name)=>{reads.push(owner+'/'+name);return [{number:1,title:'List '+owner+'/'+name,comments:0,html_url:'https://github.com/'+owner+'/'+name+'/issues/1'}]},
  getSession:async()=>false,verify:async()=>{throw Error('unexpected verify')},
  createIssue:async()=>{throw Error('unexpected write')},
 })
 const store=makeRepoStore(api)
 const app=await mount('/sample/repo/issues','/:owner/:repo/issues',RepoPanel,{store})
 try{
  assert.match(app.host.textContent,/List sample\/repo/)
  const initial=store.getSnapshot(),count=reads.length
  const field=app.host.querySelector('input[type="url"]')
  const submit=async value=>{
   await act(async()=>input(field,value))
   await act(async()=>app.host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
   await flush()
  }
  for(const value of ['https://evil.example/sample/repo','https://github.com/playground/repo','https://github.com/assets/repo','https://github.com/api/repo','https://github.com/topic/repo']){
   await submit(value)
   assert.equal(field.getAttribute('aria-invalid'),'true')
   assert.match(app.host.textContent,/保留路径冲突/)
   assert.match(app.host.textContent,/List sample\/repo/)
   assert.equal(store.getSnapshot(),initial)
   assert.equal(reads.length,count)
   assert.doesNotMatch(app.host.textContent,/正在读取项目/)
   assert.equal([...app.host.querySelectorAll('button')].find(x=>x.textContent==='重新核验').disabled,false)
  }
  await act(async()=>[...app.host.querySelectorAll('button')].find(x=>x.textContent==='重新核验').click());await flush()
  assert.equal(reads.length,count+1)
  assert.equal(reads.at(-1),'sample/repo')
  await submit('https://github.com/other/second')
  assert.match(app.host.textContent,/List other\/second/)
  assert.doesNotMatch(app.host.textContent,/List sample\/repo|保留路径冲突/)
  assert.equal(reads.at(-1),'other/second')
  assert.equal(store.getSnapshot().selected,'other/second')
  await submit(' HTTPS://GITHUB.COM/OTHER/SECOND/ ')
  assert.match(app.host.textContent,/List other\/second/)
  assert.equal(store.getSnapshot().targetUrl,'https://github.com/other/second')
  assert.deepEqual(probes,[])
 }finally{await app.close();store.dispose()}
})
test('#115 Issue pagination denial preserves reading nodes, drafts and uncertain-write feedback through failed and successful recovery',async()=>{
 const {RepoAccessRequestProvider}=await server.ssrLoadModule('/plugins/github-access/src/RepoAccessNotice.tsx')
 let blocked=false,failRefresh=false,writes=0
 const reads=[]
 const denied=()=>Object.assign(Error('仓库授权失败'),{status:403,state:'repo_access_required'})
 const svc=issueService({authorized:true,comments:(_n,page,signal)=>{
   reads.push(page)
   if(page===2&&blocked||page===1&&failRefresh)return Promise.reject(denied())
   return Promise.resolve({items:[comment(page,'Read comment '+page)],hasMore:page===1})
 },postComment:async()=>{writes++;throw Error('连接中断，提交状态未知')}})
 const request=async()=>Response.json({authenticated:false})
 function Page(){return h(RepoAccessRequestProvider,{request},h(Issue,{service:svc}))}
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Page,{})
 try{
  const field=app.host.querySelector('form[aria-label="参与讨论"] textarea')
  const reading=app.host.querySelector('[aria-label="Issue 阅读区"]')
  await act(async()=>input(field,'Retain draft'))
  const send=()=>app.host.querySelector('form[aria-label="参与讨论"] button[type="submit"]')
  assert.ok(!send().disabled)
  await act(async()=>send().click());await flush()
  assert.equal(writes,1)
  assert.match(app.host.textContent,/提交状态未知/)
  blocked=true
  const next=[...app.host.querySelectorAll('button')].find(b=>b.textContent==='加载下一页评论')
  await act(async()=>next.click());await flush()
  assert.equal(app.host.querySelector('[aria-label="Issue 阅读区"]'),reading)
  assert.equal(app.host.querySelector('form[aria-label="参与讨论"] textarea'),field)
  assert.equal(field.value,'Retain draft')
  assert.match(app.host.textContent,/Read comment 1/)
  assert.match(app.host.textContent,/提交状态未知/)
  assert.equal(app.host.querySelectorAll('[aria-label="仓库访问授权"]').length,1)
  assert.ok(send().disabled)
  assert.ok(next.disabled)
  assert.equal(app.host.querySelector('[aria-label="从 GitHub 重新加载此 Issue"]'),null)
  assert.equal([...app.host.querySelectorAll('button')].filter(b=>b.textContent==='重试本页').length,0)
  const retry=()=>[...app.host.querySelectorAll('button')].find(b=>b.textContent==='重新核验并读取')
  failRefresh=true
  await act(async()=>retry().click());await flush()
  assert.equal(app.host.querySelector('[aria-label="Issue 阅读区"]'),reading)
  assert.equal(field.value,'Retain draft')
  assert.match(app.host.textContent,/Read comment 1/)
  assert.match(app.host.textContent,/提交状态未知/)
  assert.ok(send().disabled)
  failRefresh=false;blocked=false
  await act(async()=>retry().click());await flush()
  assert.equal(app.host.querySelector('[aria-label="Issue 阅读区"]'),reading)
  assert.equal(field.value,'Retain draft')
  assert.equal(app.host.querySelectorAll('[aria-label="仓库访问授权"]').length,0)
  assert.match(app.host.textContent,/Read comment 1/)
  assert.match(app.host.textContent,/提交状态未知/)
  assert.equal(reads.at(-1),1,'recovery restarts the Issue and first page, not a POST')
  assert.equal(writes,1)
 }finally{await app.close()}
})

test('#115 case-insensitive resource route emits canonical OAuth return target',async()=>{
 const reads=[]
 const store=makeRepoStore(Object.freeze({
  getRepositories:async()=>{throw Error('unexpected probe')},
  getIssues:async(owner,name)=>{reads.push(owner+'/'+name);return []},
  getSession:async()=>false,verify:async()=>{throw Error('unexpected verify')},
  createIssue:async()=>{throw Error('unexpected write')},
 }))
 const app=await mount('/OwNeR/RePo/ISSUES','/:owner/:repo/issues',RepoPanel,{store})
 try{
  assert.ok(reads.length>0)
  assert.ok(reads.every(value=>value==='OwNeR/RePo'))
  const link=app.host.querySelector('a[href^="/api/github-login?"]')
  assert.ok(link)
  assert.equal(new URL(link.getAttribute('href'),'https://local.test').searchParams.get('return_to'),
   '/OwNeR/RePo/issues')
  assert.equal(store.getSnapshot().selected,'OwNeR/RePo')
 }finally{await app.close();store.dispose()}
})


test('#20 account disclosure preserves hover/focus and explicit toggle, Escape and outside close without new requests',async()=>{
 const SessionMenu=(await server.ssrLoadModule('/plugins/react-ui/src/SessionMenu.tsx')).default
 const calls=[]
 const request=async(path,init)=>{
   calls.push({path,method:init?.method||'GET'})
   assert.equal(path,'/api/github-session')
   return Response.json({authenticated:true,user:{login:'fixture-user',avatarUrl:null}})
 }
 const app=await mount('/sample/repo','/:owner/:repo',SessionMenu,{request})
 const pointer=(type,pointerType)=>{const e=new MouseEvent(type,{bubbles:true});Object.defineProperty(e,'pointerType',{value:pointerType});return e}
 try{
  const trigger=app.host.querySelector('button[aria-controls="lc-account-menu"]')
  assert.ok(trigger)
  const count=calls.length
  const expanded=()=>trigger.getAttribute('aria-expanded')
  const menu=()=>app.host.querySelector('[aria-label="GitHub 账户操作"]')
  assert.equal(expanded(),'false')
  await act(async()=>trigger.dispatchEvent(pointer('pointerover','mouse')))
  assert.equal(expanded(),'true')
  await act(async()=>trigger.click())
  assert.equal(expanded(),'false')
  await act(async()=>trigger.click())
  assert.equal(expanded(),'true')
  await act(async()=>menu().querySelector('button').focus())
  await act(async()=>document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
  assert.equal(expanded(),'false')
  assert.equal(document.activeElement,trigger)
  await act(async()=>trigger.click())
  assert.equal(expanded(),'true')
  await act(async()=>document.body.dispatchEvent(pointer('pointerdown','mouse')))
  assert.equal(expanded(),'false')
  await act(async()=>trigger.blur())
  await act(async()=>trigger.focus())
  assert.equal(expanded(),'true')
  await act(async()=>trigger.click())
  assert.equal(expanded(),'false')
  await act(async()=>trigger.blur())
  await act(async()=>{
   trigger.dispatchEvent(pointer('pointerdown','touch'))
   trigger.dispatchEvent(pointer('pointerup','touch'))
   trigger.focus()
   trigger.click()
  })
  assert.equal(expanded(),'true')
  await act(async()=>trigger.click())
  assert.equal(expanded(),'false')
  assert.equal(calls.length,count)
 }finally{await app.close()}
})
