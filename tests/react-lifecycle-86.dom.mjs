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
let server, Home, Issue, Member, Config, configFixture
before(async () => {
 server=await createServer({root:process.cwd(),configFile:false,logLevel:'silent',plugins:[react()],server:{middlewareMode:true}})
 Home=(await server.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')).default
 Issue=(await server.ssrLoadModule('/plugins/issue-detail/src/IssueDetailPage.tsx')).default
 Member=(await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')).default
 Config=(await server.ssrLoadModule('/plugins/repo-config/src/ConfigPage.tsx')).default
 configFixture=(await server.ssrLoadModule('/apps/playground/src/config-fixture.ts')).createRepoConfigFixtureService
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
