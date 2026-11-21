import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'


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
let server, Home, Issue, Member, Config, configFixture, RepoPanel, makeRepoStore
before(async () => {
 server=await createServer({root:process.cwd(),configFile:false,logLevel:'silent',plugins:[react()],server:{middlewareMode:true}})
 Home=(await server.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')).default
 Issue=(await server.ssrLoadModule('/plugins/issue-detail/src/IssueDetailPage.tsx')).default
 Member=(await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')).default
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
  const form=app.host.querySelector('textarea')
  assert.ok(form)
  await act(async()=>input(form,'A-only draft'))
  assert.equal(app.host.querySelector('textarea').value,'A-only draft')
  const submit=[...app.host.querySelectorAll('button')].find(b=>b.textContent.includes('确认以 GitHub 身份评论'))
  assert.ok(submit&&!submit.disabled)
  await act(async()=>submit.click())
  assert.equal(writes,1)
  await app.go('/sample/repo/issues/2')
  assert.equal(app.host.querySelector('textarea').value,'')
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
  assert.match(app.host.textContent,/2 \/ 3|2\/3|已加载\s*2/)
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
  assert.deepEqual(calls.lookups,['sample/repo'])
  assert.deepEqual(calls.reads,['sample/repo'])
  assert.match(app.host.textContent,/受控公开 Issue/)
  assert.match(app.host.textContent,/可匿名阅读/)
  const create=[...app.host.querySelectorAll('button')].find(x=>x.textContent.includes('新建 Issue'))
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
  await act(async()=>input(field,'Alice'))
  await act(async()=>app.host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await flush()
  assert.equal(writes,1)
  const heading=app.host.querySelector('h2[tabindex="-1"]')
  assert.ok(heading)
  assert.match(heading.textContent,/维护 PR 已创建/)
  assert.equal(document.activeElement,heading)
  const cta=[...app.host.querySelectorAll('a')].find(x=>x.textContent.includes('前往 GitHub PR'))
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
