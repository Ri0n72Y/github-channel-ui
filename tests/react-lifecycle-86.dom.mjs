import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'


import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import {observeHttp} from './helpers/observe-http.mjs'
import { configSnapshot } from './helpers/config-wire-fixture.mjs'

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
let server, Home, Issue, Member, Members, Config, configFixture, RepoPanel, makeRepoStore, CreateIssue, createIssueDetailApi, createRepoIssuesApi
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
 createIssueDetailApi=(await server.ssrLoadModule('/plugins/issue-detail/src/service.ts')).createIssueDetailApi
 createRepoIssuesApi=(await server.ssrLoadModule('/plugins/repo-issues/src/api.ts')).createRepoIssuesApi
})
after(async () => {await server?.close();dom.window.close()})
// Mount resource routes through their actual Cordis plugin registration.
// A direct render is reserved for independently owned components/host slots.
async function mount(path, route, Component, prop) {
 const host=document.createElement('div')
 document.body.append(host)
 const root=createRoot(host)
 let navigate,core,fiber
 function Nav(){navigate=useNavigate();return null}
 const pluginFactory=Component===Issue?['issue-detail','createIssueDetailPlugin',prop.service]:
   Component===Config?['repo-config','createRepoConfigPlugin',prop.api]:
   Component===CreateIssue?['repo-home','createRepoHomePlugin',undefined,{issueApi:prop.api}]:
   [Home,Member,Members].includes(Component)&&!Object.hasOwn(prop,'coverUrl')?
     ['repo-home','createRepoHomePlugin',prop.api]:
   route==='/topic/:owner/:repo'?['topic-page','createTopicPagePlugin',prop.api]:null
 let entry
 try{
  if(pluginFactory){
   const {Context}=await import('@deepseek-ai/cordis')
   const {ReactUIService,App}=await server.ssrLoadModule('/plugins/react-ui/src/index.tsx')
   const [name,factory,...args]=pluginFactory
   const module=await server.ssrLoadModule('/plugins/'+name+'/src/index.tsx')
   const ctx=new Context()
   core=ctx.plugin(ReactUIService);await core
   fiber=ctx.plugin(module[factory](...args));await fiber
   entry=h(App,{ui:ctx.reactUI})
  }else entry=h(Routes,null,h(Route,{path:route,element:h(Component,prop)}))
  async function settleRoute(){
   await flush()
   for(let i=0;pluginFactory&&i<100&&/^正在加载(?:项目页面|创建 Issue 页面|讨论|仓库配置|TopicPage)…$/.test(host.textContent);i++){
    await act(async()=>{await new Promise(r=>setTimeout(r,20))})
   }
   assert.doesNotMatch(host.textContent,/^正在加载(?:项目页面|创建 Issue 页面|讨论|仓库配置|TopicPage)…$/)
  }
  await act(async()=>root.render(h(React.StrictMode,null,h(MemoryRouter,{initialEntries:[path]},h(Nav),entry))))
  await settleRoute()
  return {host,go:async path=>{await act(async()=>navigate(path));await settleRoute()},
   close:async()=>{try{await act(async()=>root.unmount())}finally{host.remove();try{await fiber?.dispose()}finally{await core?.dispose()}}}}
 }catch(error){try{await act(async()=>root.unmount())}finally{host.remove();try{await fiber?.dispose()}finally{await core?.dispose()}}throw error}
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
 const calls=[],writes=[]
 const api=createIssueDetailApi(observeHttp(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  const method=init.method||'GET'
  try{
   assert.equal(init.credentials,'same-origin')
   if(url.pathname==='/api/github-session'&&method==='GET')
    return Response.json({authenticated:opts.session?await opts.session():Boolean(opts.authorized)})
   const o=url.searchParams.get('owner'),r=url.searchParams.get('repo'),n=Number(url.searchParams.get('number'))
   if(url.pathname==='/api/github-verify'&&method==='GET'){
    assert.equal(o,'sample');assert.equal(r,'repo')
    return Response.json({user:{id:opts.userId?opts.userId():1,login:'fixture-user'},
     repository:{accessible:true,full_name:o+'/'+r,permissions:null}})
   }
   if(url.pathname==='/api/issue-detail'&&method==='GET'){
    assert.equal(o,'sample');assert.equal(r,'repo')
    return Response.json({...issue(n),html_url:'https://github.com/'+o+'/'+r+'/issues/'+n,...opts.issueFields})
   }
   if(url.pathname==='/api/issue-comments'&&method==='GET'){
    assert.equal(o,'sample');assert.equal(r,'repo')
    const page=Number(url.searchParams.get('page'))
    calls.push({n,page,signal:init.signal})
    const data=await (opts.comments?.(n,page,init.signal)??Promise.resolve({items:[comment(n*100+page)],hasMore:page===1}))
    return Response.json(data.items,{headers:data.hasMore?{Link:'<https://api.github.com/repos/'+o+'/'+r+'/issues/'+n+'/comments?page='+(page+1)+'>; rel="next"'}:{}})
   }
   if(url.pathname==='/api/github-issue-comment'&&method==='POST'){
    const {owner,repo,number,body}=JSON.parse(init.body)
    writes.push({owner,repo,number,body,signal:init.signal})
    assert.equal(owner,'sample');assert.equal(repo,'repo')
    assert.equal(init.headers['X-LabourChain-Write'],'1')
    const result=await (opts.postComment?.(owner,repo,number,body,init.signal)??{id:99})
    return Response.json({comment:{body,created_at:'2026-11-17T00:00:00Z',
     html_url:'https://github.com/'+owner+'/'+repo+'/issues/'+number+'#issuecomment-'+result.id,...result}},{status:201})
   }
   throw Error('Unexpected Issue HTTP request: '+method+' '+address)
  }catch(error){
   if(typeof error?.status==='number')return Response.json({error:error.message,state:error.state},{status:error.status})
   throw error
  }
 }))
 return {...api,calls,writes}
}

test('Repo A -> B: StrictMode remount hides old cards and preserves per-repo branch',async()=>{
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
 const app=await mount('/sample/alpha','/:owner/:repo',Home,{api})
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
test('Issue A -> B: current-page input and late writes belong to their original controller',async()=>{
 const pending=deferred()
 let writes=0
 const svc=issueService({authorized:true,postComment:()=>{writes++;return pending.promise}})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc})
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
test('Issue route change excludes old labour records even when an earlier page completes late',async()=>{
 const late=deferred()
 let oldSignal
 const record=(id,n,hours,outcome)=>({
  ...comment(id,'\x60\x60\x60yaml\nlabour:\n  work: review\n  hr: ~'+hours+'\n  outcome: '+outcome+'\n\x60\x60\x60'),
  html_url:'https://github.com/sample/repo/issues/'+n+'#issuecomment-'+id,
 })
 const svc=issueService({comments:(n,page,signal)=>{
  if(n===1&&page===2){oldSignal=signal;return late.promise}
  return Promise.resolve({items:n===1?[record(101,1,0.5,'old outcome')]:[record(201,2,1.5,'current outcome')],
   hasMore:n===1})
 }})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,{service:svc})
 const summary=()=>app.host.querySelector('[aria-label="最近劳动成果与工时摘要"]')
 try{
  assert.match(summary().textContent,/old outcome/)
  const more=[...app.host.querySelectorAll('button')].find(b=>b.textContent==='加载下一页评论')
  assert.ok(more)
  await act(async()=>more.click())
  assert.ok(oldSignal)
  await app.go('/sample/repo/issues/2')
  assert.equal(oldSignal.aborted,true)
  assert.match(summary().textContent,/current outcome/)
  assert.equal(summary().querySelector('strong').textContent,'1.5')
  late.resolve({items:[record(102,1,3,'late old outcome')],hasMore:false})
  await flush()
  assert.match(summary().textContent,/current outcome/)
  assert.equal(summary().querySelector('strong').textContent,'1.5')
  assert.doesNotMatch(app.host.textContent,/old outcome|late old outcome/)
 }finally{await app.close()}
})

test('Issue page: two same-tick load-more events are single-flight and IDs dedupe',async()=>{
 const next=deferred()
 const svc=issueService({comments:(_n,page)=>page===2?next.promise:
   Promise.resolve({items:[comment(101)],hasMore:true})})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc})
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
  assert.match(app.host.textContent,/评论数量尚未核对完整/)
  assert.equal(app.host.querySelector('[aria-label="读取状态"]').querySelectorAll('[role="status"]').length,0)
 }finally{await app.close()}
})

// Test the mounted production plugin and real browser service together.
// Substitute only HTTP; inspect every actual request outside the transport catch.
async function configJourney({read,write}) {
 const {createRepoConfigApi}=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 const requests=[]
 const api=createRepoConfigApi(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  const entry={path:url.pathname,query:Object.fromEntries(url.searchParams),method:init.method||'GET',
   signal:init.signal,credentials:init.credentials,body:init.body?JSON.parse(init.body):undefined,
   write:init.headers?.['X-LabourChain-Write']}
  requests.push(entry)
  if(entry.path!=='/api/repo-config')throw Error('Unexpected HTTP path')
  return entry.method==='GET'?read(entry):write(entry)
 })
 const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,{api,owner:'sample',repo:'repo'})
 return {app,requests,posts:()=>requests.filter(x=>x.method==='POST'),
  verify:()=>{for(const request of requests){
   assert.equal(request.path,'/api/repo-config')
   assert.equal(request.credentials,'same-origin')
   if(request.method==='GET')assert.deepEqual(request.query,{owner:'sample',repo:'repo'})
   else {assert.equal(request.method,'POST');assert.equal(request.write,'1')
    assert.equal(request.body.owner,'sample');assert.equal(request.body.repo,'repo');assert.equal(request.body.branch,'main')}
  }}}
}
const formSubmit=host=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
const buttonWith=(host,text)=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text))

test('Config preserves a dirty draft across permission reads, rejects stale writes, and discards only after a successful confirmed refresh',async()=>{
 let snapshot=configSnapshot(),nextRead=null
 const j=await configJourney({read:()=>nextRead?nextRead():Response.json(snapshot),
  write:()=>{throw Error('Unexpected write')}})
 const {app}=j
 const initial=snapshot.configText,draft=initial+'\n# local work'
 const confirm=window.confirm
 try{
  await act(async()=>input(app.host.querySelector('textarea'),draft))
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,false)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,false)
  snapshot={...snapshot,headSha:'d'.repeat(40)}
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.match(app.host.textContent,/GitHub 配置版本已变化/)
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,true)
  await act(async()=>formSubmit(app.host))
  const reads=j.requests.length
  window.confirm=()=>false
  await act(async()=>buttonWith(app.host,'重新读取').click())
  assert.equal(j.requests.length,reads)
  assert.equal(app.host.querySelector('textarea').value,draft)
  window.confirm=()=>true
  const delay=deferred()
  nextRead=()=>delay.promise
  await act(async()=>buttonWith(app.host,'重新读取').click())
  await flush()
  assert.ok(!app.host.querySelector('button[type="submit"]')||app.host.querySelector('button[type="submit"]').disabled)
  delay.resolve(Response.json({error:'GitHub temporarily unavailable'},{status:503}))
  await flush()
  assert.match(app.host.textContent,/GitHub temporarily unavailable/)
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.equal(app.host.querySelector('button[type="submit"]'),null)
  nextRead=null
  await act(async()=>buttonWith(app.host,'重新读取 GitHub 配置').click())
  await flush()
  assert.equal(app.host.querySelector('textarea').value,initial)
  assert.equal(j.posts().length,0)
  j.verify()
 }finally{window.confirm=confirm;await app.close()}
})

test('Config rejected saves preserve the draft; an acknowledged PR suppresses further writes until main contains that content',async()=>{
 let snapshot=configSnapshot(),attempt=0
 const j=await configJourney({read:()=>Response.json(snapshot),write:()=>{
  attempt++
  if(attempt===1)return Response.json({error:'Permission denied'},{status:403})
  if(attempt===2)return Response.json({error:'Conflict'},{status:409})
  return Response.json({state:'awaiting_pr_merge',prUrl:'https://github.com/sample/repo/pull/88'})
 }})
 const {app}=j
 try{
  const draft=snapshot.configText+'\n# reviewed change'
  await act(async()=>input(app.host.querySelector('textarea'),draft))
  for(const message of [/Permission denied/,/Conflict/]){
   assert.equal(app.host.querySelector('button[type="submit"]').disabled,false)
   await act(async()=>formSubmit(app.host))
   assert.match(app.host.textContent,message)
   assert.equal(app.host.querySelector('textarea').value,draft)
   assert.doesNotMatch(app.host.textContent,/写入结果未知/)
  }
  assert.equal(j.posts().length,2)
  await act(async()=>formSubmit(app.host))
  assert.match(app.host.textContent,/等待 GitHub 审核与合并/)
  assert.ok(app.host.querySelector('a[href="https://github.com/sample/repo/pull/88"]'))
  assert.equal(app.host.querySelector('button[type="submit"]'),null)
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.match(app.host.textContent,/等待 GitHub 审核与合并/)
  assert.equal(app.host.querySelector('button[type="submit"]'),null)
  snapshot={...snapshot,headSha:'e'.repeat(40),fileSha:'f'.repeat(40),configText:draft}
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.doesNotMatch(app.host.textContent,/等待 GitHub 审核与合并/)
  assert.equal(app.host.querySelector('textarea').value,draft)
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,true)
  assert.deepEqual(j.posts().map(x=>x.body),Array(3).fill({
   action:'save_config',owner:'sample',repo:'repo',branch:'main',content:draft,
   expectedHeadSha:'a'.repeat(40),expectedFileSha:'b'.repeat(40)
  }))
  j.verify()
 }finally{await app.close()}
})



async function memberJourney(write){
 const {createRepoHomeApi}=await server.ssrLoadModule('/plugins/repo-home/src/service.ts')
 const requests=[]
 const api=createRepoHomeApi(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  const entry={path:url.pathname,query:Object.fromEntries(url.searchParams),method:init.method||'GET',
   signal:init.signal,body:init.body?JSON.parse(init.body):undefined,credentials:init.credentials,
   write:init.headers?.['X-LabourChain-Write']}
  requests.push(entry)
  if(entry.path==='/api/repo-member-permission'&&entry.method==='GET')return Response.json({
   user:{login:'operator',id:12},branch:'main',protected:false,mode:'commit'})
  if(entry.path==='/api/repo-member-register'&&entry.method==='POST')return write(entry)
  throw Error('Unexpected member HTTP request')
 })
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 return {app,requests,posts:()=>requests.filter(x=>x.method==='POST'),verify:()=>{
  for(const request of requests){
   assert.equal(request.credentials,'same-origin')
   if(request.method==='GET'){assert.equal(request.path,'/api/repo-member-permission')
    assert.deepEqual(request.query,{owner:'sample',repo:'repo',branch:'main'})}
   else{assert.equal(request.method,'POST');assert.equal(request.path,'/api/repo-member-register')
    assert.equal(request.write,'1');assert.deepEqual(request.body,{owner:'sample',repo:'repo',branch:'main',member:{name:'Alice'}})}
  }
 }}
}
const memberSuccess=sha=>Response.json({status:'committed',url:'https://github.com/sample/repo/commit/'+sha,sha,requestedBy:'operator'})



test('member session change invalidates pending HTTP write, preserves the draft and requires a checked retry',async()=>{
 const pending=deferred()
 let attempts=0
 const j=await memberJourney(()=>++attempts===1?pending.promise:memberSuccess('b'.repeat(40)))
 const {app}=j,confirm=window.confirm
 try{
  await act(async()=>input(app.host.querySelector('input[required]'),'Alice'))
  await act(async()=>formSubmit(app.host))
  assert.equal(j.posts().length,1)
  const before=j.requests.length
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.ok(j.requests.length>before)
  assert.equal(j.posts()[0].signal.aborted,true)
  assert.equal(app.host.querySelector('input[required]').value,'Alice')
  assert.match(app.host.textContent,/提交结果未知/)
  await act(async()=>formSubmit(app.host))
  assert.equal(j.posts().length,1)
  window.confirm=()=>false
  await act(async()=>buttonWith(app.host,'解除提交锁定').click())
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,true)
  window.confirm=()=>true
  await act(async()=>buttonWith(app.host,'解除提交锁定').click())
  await flush()
  assert.equal(app.host.querySelector('button[type="submit"]').disabled,false)
  await act(async()=>formSubmit(app.host))
  assert.equal(j.posts().length,2)
  assert.ok(app.host.querySelector('a[href="https://github.com/sample/repo/commit/'+ 'b'.repeat(40)+'"]'))
  pending.resolve(memberSuccess('a'.repeat(40)))
  await flush()
  assert.ok(!app.host.querySelector('a[href="https://github.com/sample/repo/commit/'+ 'a'.repeat(40)+'"]'))
  assert.equal(j.posts().length,2)
  j.verify()
 }finally{window.confirm=confirm;await app.close()}
})




test('Config uncertain Save or Label Sync locks both HTTP writes until an explicit checked refresh',async()=>{
 const {createRepoConfigApi}=await server.ssrLoadModule('/plugins/repo-config/src/service.ts')
 for(const action of ['save_config','sync_labels']){
  const snapshot=configSnapshot()
  const posts=[],reads=[],unexpected=[]
  const api=createRepoConfigApi(async(address,init={})=>{
   const url=new URL(address,'https://local.test')
   if(url.pathname!=='/api/repo-config'){
    unexpected.push(String(address));throw Error('Unexpected Config request')
   }
   if((init.method||'GET')==='GET'){
    reads.push([url.searchParams.get('owner'),url.searchParams.get('repo')])
    return Response.json(snapshot)
   }
   if(init.method!=='POST'){
    unexpected.push(init.method);throw Error('Unexpected Config method')
   }
   posts.push({body:JSON.parse(init.body),write:init.headers['X-LabourChain-Write'],credentials:init.credentials})
   if(posts.length===1){
    if(action==='save_config')throw new TypeError('Connection reset after request')
    return Response.json({state:'ready'}) // HTTP success without the required sync result
   }
   return action==='save_config'
     ? Response.json({state:'sync_pending',commitSha:'d'.repeat(40),fileSha:'e'.repeat(40)})
     : Response.json({state:'ready',createdLabels:['status:review'],removedAssociations:1})
  })
  const app=await mount('/sample/repo/config','/:owner/:repo/config',Config,{api,owner:'sample',repo:'repo'})
  const save=()=>app.host.querySelector('button[type="submit"]')
  const sync=()=>[...app.host.querySelectorAll('button')].find(x=>x.textContent.includes('确认并执行 Label 同步'))
  const checkbox=()=>app.host.querySelector('input[type="checkbox"]')
  const unlock=()=>[...app.host.querySelectorAll('button')].find(x=>x.textContent.includes('解除锁定并重新读取'))
  const originalConfirm=window.confirm
  try{
   const draft=snapshot.configText+'\n# local change'
   // The selected operation must really be enabled before the uncertain write.
   if(action==='save_config')await act(async()=>input(app.host.querySelector('textarea'),draft))
   else await act(async()=>checkbox().click())
   const submit=action==='save_config'?save:sync
   assert.ok(submit()&&!submit().disabled)
   await act(async()=>submit().click())
   const expected=action==='save_config'
    ? {action,owner:'sample',repo:'repo',branch:'main',content:draft,expectedHeadSha:snapshot.headSha,expectedFileSha:snapshot.fileSha}
    : {action,owner:'sample',repo:'repo',branch:'main',previewId:snapshot.snapshotId,confirmRemovals:true}
   assert.deepEqual(posts,[{body:expected,write:'1',credentials:'same-origin'}])
   assert.match(app.host.textContent,/写入结果未知/)
   assert.ok(save().disabled)
   assert.ok(sync().disabled)
   await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
   await flush()
   assert.ok(reads.length>=2)
   if(action==='save_config')assert.equal(app.host.querySelector('textarea').value,draft)
   assert.ok(save().disabled)
   assert.ok(sync().disabled)
   await act(async()=>{save().click();sync().click()})
   assert.equal(posts.length,1)
   window.confirm=()=>false
   await act(async()=>unlock().click())
   assert.ok(submit().disabled)
   assert.equal(posts.length,1)
   window.confirm=()=>true
   await act(async()=>unlock().click())
   await flush()
   if(action==='save_config'&&app.host.querySelector('textarea').value!==draft)
     await act(async()=>input(app.host.querySelector('textarea'),draft))
   if(action==='sync_labels'&&!checkbox().checked)await act(async()=>checkbox().click())
   assert.ok(!submit().disabled)
   await act(async()=>submit().click())
   assert.deepEqual(posts,[{body:expected,write:'1',credentials:'same-origin'},
    {body:expected,write:'1',credentials:'same-origin'}])
   assert.ok(reads.length>=3)
   assert.ok(reads.every(target=>target[0]==='sample'&&target[1]==='repo'))
   assert.deepEqual(unexpected,[])
  }finally{window.confirm=originalConfirm;await app.close()}
 }
})

test('root RepoPanel: URL target is required, anonymous read works, OAuth write remains disabled',async()=>{
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


test('Member validation opens the invalid field, links its error and preserves edits without a write',async()=>{
 let writes=0
 const api={
  getCapability:async()=>({user:{login:'operator',id:1},mode:'pr',branch:'main'}),
  register:async()=>{writes++;throw Error('invalid form must not write')},
 }
 const app=await mount('/sample/repo/members/register','/:owner/:repo/members/register',Member,{api})
 try{
  const form=app.host.querySelector('form')
  const name=form.querySelector('input[required]')
  const avatar=form.querySelector('input[type="url"]')
  const details=avatar.closest('details')
  const submit=()=>act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  const errorFor=field=>{
   assert.equal(field.getAttribute('aria-invalid'),'true')
   const error=document.getElementById(field.getAttribute('aria-describedby'))
   assert.ok(error&&error.textContent.trim(),'invalid field exposes its associated error')
   return error.textContent
  }
  assert.equal(details.open,false)
  await submit()
  assert.equal(document.activeElement,name)
  assert.match(errorFor(name),/姓名/)
  await act(async()=>input(name,'Alice'))
  await act(async()=>input(avatar,'http://example.com/old.png'))
  await submit()
  assert.equal(details.open,true)
  assert.equal(document.activeElement,avatar)
  assert.match(errorFor(avatar),/HTTPS/)
  await act(async()=>input(avatar,'http://example.com/new.png'))
  assert.match(errorFor(avatar),/HTTPS/)
  await act(async()=>input(avatar,'https://example.com/new.png'))
  assert.equal(avatar.getAttribute('aria-invalid'),'false')
  assert.equal(avatar.hasAttribute('aria-describedby'),false)
  const links=[...form.querySelectorAll('fieldset input[type="url"]')]
  assert.equal(links.length,3)
  const last=links.at(-1)
  const label=last.closest('label').parentElement.querySelector('input:not([type="url"])')
  assert.ok(label)
  await act(async()=>input(label,'Website'))
  await act(async()=>input(last,'javascript:alert(1)'))
  details.open=false
  await submit()
  assert.equal(details.open,true)
  assert.equal(document.activeElement,last)
  assert.match(errorFor(last),/HTTPS/)
  await act(async()=>input(last,'https://example.com'))
  assert.equal(last.getAttribute('aria-invalid'),'false')
  assert.equal(name.value,'Alice')
  assert.equal(writes,0)
 }finally{await app.close()}
})

test('Member pending PR prioritizes the exact external GitHub link with accessible focus',async()=>{
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


test('Config local preview cannot redirect member write branch across pages',async()=>{
 const key='labourchain:display-branch:sample/repo'
 localStorage.removeItem(key)
 const configFixtureApi=configFixture(new URLSearchParams({configCase:'changes'}))
 let configWrites=0,memberWrites=0
 const config=await mount('/sample/repo/config','/:owner/:repo/config',Config,
  {api:{...configFixtureApi,save:async()=>{configWrites++;throw Error('unexpected config write')}},
   owner:'sample',repo:'repo'})
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

test('member registration fails closed when server capability branch differs from write target',async()=>{
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








test('compact team layout preserves missing, empty, error and unauthorized states',async()=>{
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

test('Issue Detail Markdown image fallback and keyboard tabs preserve current-page comment input',async()=>{
 const svc=issueService({authorized:true,comments:()=>Promise.resolve({items:[
  comment(101,'## Comment heading\n\n**Readable comment**\n\n![broken picture](https://example.com/comment.png)'),
  comment(102,'<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'),
  comment(103,'\x60\x60\x60yaml\nlabour:\n  work: "**literal labour work**"\n  hr: ~1.5h\n  outcome: "# literal outcome"\n  commits:\n    - '+'a'.repeat(40)+'\n\x60\x60\x60'),
  comment(104,'\x60\x60\x60yaml\nlabour:\n  work: Conflict\n  hr: ~2h\n  commits:\n    - '+'a'.repeat(40)+'\n\x60\x60\x60'),
  comment(105,'\x60\x60\x60yaml\nlabour:\n  hr: ~1h\n\x60\x60\x60'),
 ],hasMore:false}),issueFields:{body:'# Topic heading\n\n**Issue emphasis**\n\n![topic image](https://example.com/topic.png)',comments:6}})
 const app=await mount('/sample/repo/issues/1','/:owner/:repo/issues/:number',Issue,
   {service:svc})
 try{
  assert.match(app.host.textContent,/Topic heading/)
  assert.match(app.host.textContent,/Comment heading/)
  assert.ok([...app.host.querySelectorAll('strong')].some(el=>el.textContent==='Issue emphasis'))
  assert.ok([...app.host.querySelectorAll('strong')].some(el=>el.textContent==='Readable comment'))
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
  assert.match(app.host.textContent,/\*\*literal labour work\*\*/)
  assert.match(app.host.textContent,/# literal outcome/)
  assert.ok(![...app.host.querySelectorAll('strong')].some(el=>el.textContent==='literal labour work'))
  assert.match(app.host.textContent,/Commit 冲突/)
  assert.match(app.host.textContent,/1 条候选劳动评论格式无效/)
  assert.match(app.host.textContent,/非完整汇总/)
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
  {service:svc})
test('quote choose/replace/cancel and tabs preserve current-page input; confirmation guards the exact POST',async()=>{
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
  assert.equal(app.host.querySelector('[aria-label="从 GitHub 重新加载此 Issue"]'),null)
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
  assert.match(app.host.textContent,/已发表；讨论列表已重新读取/)
 }finally{window.confirm=originalConfirm;await app.close()}
})

test('failed/unknown reply keeps current-page input; duplicate submit is blocked and newer edits survive success',async()=>{
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
    await act(async()=>input(replyArea(app),'new current-page input'))
    await act(async()=>pending.resolve({id:999}))
   }else await act(async()=>pending.reject(outcome==='unknown'?Error('网络中断，结果未知'):Object.assign(Error('GitHub rejected'),{status:422})))
   await flush()
   assert.ok(quotePreview(app))
   assert.equal(replyArea(app).value,outcome==='success'?'new current-page input':'submitted')
   if(outcome==='unknown'){
    assert.match(app.host.textContent,/避免重复发表/)
    assert.ok(replySend(app).disabled)
    assert.equal([...app.host.querySelectorAll('button')].some(b=>/解除提交锁定|解锁/.test(b.textContent)),false)
   }else if(outcome==='failure'){
    assert.match(app.host.textContent,/提交未成功/)
    assert.equal(replySend(app).disabled,false)
   }else assert.match(quotePreview(app).textContent,/two/)
   await app.go('/sample/repo/issues/2')
   assert.equal(quotePreview(app),null)
   assert.equal(replyArea(app).value,'')
   await app.go('/sample/repo/issues/1')
   assert.equal(quotePreview(app),null)
   assert.equal(replyArea(app).value,'')
  }finally{await app.close()}
 }
})


const labourWork=app=>[...app.host.querySelectorAll('textarea')].find(el=>el.closest('label')?.textContent.includes('工作内容'))
const labourSend=app=>labourWork(app)?.closest('form')?.querySelector('button[type="submit"]')
const issueTabs=app=>app.host.querySelectorAll('[role="tab"]')
test('comment and labour unknown writes keep independent locks and feedback across cross-kind writes',async()=>{
 for(const firstKind of ['comment','labour']){
  for(const secondOutcome of ['failure','success']){
   let writes=0
   const svc=issueService({authorized:true,postComment:async()=>{
    writes++
    if(writes===1)throw Error('connection lost')
    if(secondOutcome==='failure')throw Object.assign(Error('GitHub rejected'),{status:422})
    return {id:990+writes}
   }})
   const app=await issueMount(svc)
   const [discussion,labourTab]=issueTabs(app)
   const select=async kind=>act(async()=>{(kind==='comment'?discussion:labourTab).click()})
   const fill=async kind=>act(async()=>input(kind==='comment'?replyArea(app):labourWork(app),
    kind==='comment'?'comment payload':'labour payload'))
   const send=kind=>kind==='comment'?replySend(app):labourSend(app)
   const otherKind=firstKind==='comment'?'labour':'comment'
   try{
    await select(firstKind)
    await fill(firstKind)
    await act(async()=>send(firstKind).click())
    await flush()
    assert.equal(writes,1)
    assert.ok(send(firstKind).disabled)
    assert.match(app.host.textContent,/避免重复发表/)
    await select(otherKind)
    await fill(otherKind)
    await act(async()=>send(otherKind).click())
    await flush()
    assert.equal(writes,2)
    if(secondOutcome==='failure')assert.match(app.host.textContent,/提交未成功/)
    else assert.match(app.host.textContent,/已发表；讨论列表已重新读取/)
    await select(firstKind)
    assert.ok(send(firstKind).disabled,'the first kind remains locked')
    assert.match(app.host.textContent,/避免重复发表/)
    await select(otherKind)
    await fill(otherKind)
    if(secondOutcome==='failure'){
     assert.ok(!send(otherKind).disabled,'a definite failure of the other kind remains retryable')
     assert.match(app.host.textContent,/提交未成功/)
    }else{
     assert.ok(!send(otherKind).disabled,'success of the other kind does not create an uncertainty lock')
     assert.match(app.host.textContent,/已发表；讨论列表已重新读取/)
    }
   }finally{await app.close()}
  }
 }
})

test('unknown write locks reset on Issue remount and verified account/session change',async()=>{
 let userId=1,writes=0
 const stored=JSON.stringify({...localStorage})
 const svc=issueService({authorized:true,userId:()=>userId,postComment:async()=>{writes++;throw Error('connection lost')}})
 const app=await issueMount(svc)
 try{
  await act(async()=>input(replyArea(app),'issue one'))
  await act(async()=>replySend(app).click())
  await flush()
  assert.equal(writes,1)
  assert.ok(replySend(app).disabled)
  await app.go('/sample/repo/issues/2')
  await flush();await flush()
  await act(async()=>input(replyArea(app),'issue two fresh input'))
  assert.ok(!replySend(app).disabled,'a different Issue gets a fresh in-memory lock scope')
  await app.go('/sample/repo/issues/1')
  await flush();await flush()
  await act(async()=>input(replyArea(app),'issue one fresh input'))
  assert.ok(!replySend(app).disabled,'returning to the Issue remounts with fresh page state')
  await act(async()=>input(replyArea(app),'new account check'))
  await act(async()=>replySend(app).click())
  await flush()
  assert.equal(writes,2)
  assert.ok(replySend(app).disabled)
  userId=2
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  await flush()
  assert.equal(replyArea(app).value,'')
  await act(async()=>input(replyArea(app),'new account fresh input'))
  assert.ok(!replySend(app).disabled,'re-verifying a different account clears the prior account page lock')
  assert.equal(writes,2,'session revalidation never replays the uncertain POST')
  assert.equal(JSON.stringify({...localStorage}),stored,'discussion drafts and uncertainty remain memory-only')
 }finally{await app.close()}
})





test('Members full cards preserve stored order, complete profile content, safe links and scoped permissions',async()=>{
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

test('actual RepoPanel route keeps current list and refresh after invalid or reserved URL',async()=>{
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
test('Issue pagination denial preserves reading nodes, current-page input and uncertain-write feedback through failed and successful recovery',async()=>{
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


test('Topic pending config PR survives failed or unchanged rechecks and unlocks only on a changed version',async()=>{
 const Topic=(await server.ssrLoadModule('/plugins/topic-page/src/TopicPageContainer.tsx')).default
 const baseline={repository:{owner:'sample',name:'repo',full_name:'sample/repo',html_url:'https://github.com/sample/repo'},
  readme:'# Activity',coverUrl:null,config:{topic:'labourchain',whitelist:false},configState:'ready',
  configText:'topic: labourchain\nwhitelist: false\n',headSha:'a'.repeat(40),configSha:'b'.repeat(40),
  defaultBranch:'main',allowedRepositories:[]}
 const draft='topic: edited-topic\nwhitelist: false\n'
 let nextRead=()=>Promise.resolve(baseline),writes=0
 const refreshes=[]
 const {createTopicPageApi}=await server.ssrLoadModule('/plugins/topic-page/src/service.ts')
 const requests=[]
 const api=createTopicPageApi(observeHttp(async(address,init={})=>{
  const url=new URL(address,'https://local.test'),method=init.method||'GET'
  requests.push({path:url.pathname,method})
  assert.equal(url.origin,'https://local.test')
  if(url.pathname==='/api/github-session'&&method==='GET')return Response.json({authenticated:true})
  if(url.pathname==='/api/topic-page'&&method==='GET'){
   assert.equal(url.searchParams.get('owner'),'sample')
   assert.equal(url.searchParams.get('repo'),'repo')
   if(url.searchParams.get('refresh')==='1')refreshes.push(init.signal)
   try{return Response.json(await nextRead())}
   catch(error){return Response.json({error:error.message,stage:'source'},{status:503})}
  }
  if(url.pathname==='/api/topic-projects'&&method==='GET'){
   assert.equal(url.searchParams.get('owner'),'sample')
   assert.equal(url.searchParams.get('repo'),'repo')
   assert.equal(url.searchParams.get('page'),'1')
   return Response.json({page:1,offset:0,perPage:100,totalCount:0,
    hasNext:false,nextPage:null,nextOffset:null,windowExhausted:false,items:[]})
  }
  if(url.pathname==='/api/topic-config'&&method==='POST'){
   writes++
   assert.equal(init.credentials,'same-origin')
   assert.equal(init.headers['X-LabourChain-Write'],'1')
   assert.deepEqual(JSON.parse(init.body),{owner:'sample',repo:'repo',content:draft,
    expectedHeadSha:baseline.headSha,expectedFileSha:baseline.configSha,confirmed:true})
   return Response.json({state:'pending_pr',effective:false,branch:'maintenance',prUrl:'https://github.com/sample/repo/pull/81'})
  }
  throw Error('Unexpected Topic HTTP request: '+address)
 }))
 const app=await mount('/topic/sample/repo','/topic/:owner/:repo',Topic,{owner:'sample',repo:'repo',api})
 const field=()=>app.host.querySelector('#topic-config-yaml')
 const button=text=>[...app.host.querySelectorAll('button')].find(b=>b.textContent===text)
 const save=()=>button('确认提交配置')
 const recheck=()=>button('重新检查默认分支配置')
 try{
  assert.equal(field().value,baseline.configText)
  await act(async()=>input(field(),draft))
  await act(async()=>save().click())
  await flush()
  assert.equal(writes,1)
  assert.ok(save().disabled)
  assert.ok(app.host.querySelector('a[href="https://github.com/sample/repo/pull/81"]'))
  const same=deferred()
  nextRead=()=>same.promise
  await act(async()=>recheck().click())
  assert.ok(refreshes.length>0)
  same.resolve(baseline)
  await flush()
  assert.equal(field().value,draft)
  assert.ok(save().disabled)
  await act(async()=>save().click())
  assert.equal(writes,1)
  nextRead=()=>Promise.reject(Object.assign(Error('controlled source 503'),{status:503,stage:'source'}))
  await act(async()=>recheck().click())
  await flush()
  assert.match(app.host.textContent,/controlled source 503/)
  assert.equal(writes,1)
  nextRead=()=>Promise.resolve(baseline)
  await act(async()=>button('重新加载').click())
  await flush()
  assert.equal(field().value,draft)
  assert.ok(save().disabled)
  nextRead=()=>Promise.resolve({...baseline,headSha:'c'.repeat(40),configSha:'d'.repeat(40),
   configText:'topic: remote-topic\nwhitelist: false\n',config:{topic:'remote-topic',whitelist:false}})
  await act(async()=>recheck().click())
  await flush()
  assert.equal(field().value,draft)
  assert.equal(save().disabled,false)
  assert.equal(writes,1)
 }finally{await app.close()}
})

test('Topic project pagination coalesces rapid UI requests and preserves loaded results after a failed page',async()=>{
 const Topic=(await server.ssrLoadModule('/plugins/topic-page/src/TopicPageContainer.tsx')).default
 const {createTopicPageApi}=await server.ssrLoadModule('/plugins/topic-page/src/service.ts')
 const snapshot={repository:{owner:'sample',name:'repo',full_name:'sample/repo',html_url:'https://github.com/sample/repo'},
  readme:'# Activity',coverUrl:null,config:{topic:'labourchain',whitelist:false},configState:'ready',
  configText:'topic: labourchain\nwhitelist: false\n',headSha:'a'.repeat(40),configSha:'b'.repeat(40),
  defaultBranch:'main',allowedRepositories:[]}
 const project=id=>({id,full_name:'member/project-'+id,name:'project-'+id,owner:'member',
  description:'Project '+id,html_url:'https://github.com/member/project-'+id,stargazers_count:1,language:null})
 const page=(n,items,more)=>({page:n,offset:0,perPage:100,totalCount:11,hasNext:more,
  nextPage:more?2:null,nextOffset:more?0:null,windowExhausted:false,items})
 const pending=deferred()
 let page2Calls=0
 const requests=[]
 const api=createTopicPageApi(observeHttp(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  assert.equal(init.method||'GET','GET')
  if(url.pathname==='/api/github-session')return Response.json({authenticated:false})
  assert.equal(url.searchParams.get('owner'),'sample')
  assert.equal(url.searchParams.get('repo'),'repo')
  if(url.pathname==='/api/topic-page')return Response.json(snapshot)
  assert.equal(url.pathname,'/api/topic-projects')
  assert.equal(url.searchParams.get('head'),snapshot.headSha)
  const n=Number(url.searchParams.get('page'))
  requests.push(n)
  if(n===1)return Response.json(page(1,Array.from({length:10},(_,i)=>project(i+1)),true))
  assert.equal(n,2)
  page2Calls++
  return page2Calls===1?pending.promise:Response.json({...page(2,[project(10),project(11)],false),totalCount:1001,windowExhausted:true})
 }))
 const app=await mount('/topic/sample/repo','/topic/:owner/:repo',Topic,{owner:'sample',repo:'repo',api})
 const button=text=>[...app.host.querySelectorAll('button')].find(b=>b.textContent===text)
 const cards=()=>app.host.querySelectorAll('[data-topic-masonry-item]')
 try{
  assert.equal(cards().length,10)
  const more=button('加载更多项目')
  assert.ok(more)
  await act(async()=>{more.dispatchEvent(new MouseEvent('click',{bubbles:true}));more.dispatchEvent(new MouseEvent('click',{bubbles:true}))})
  assert.equal(page2Calls,1)
  pending.resolve(Response.json({error:'controlled page 429',stage:'topic-search'},{status:429}))
  await flush()
  assert.equal(cards().length,10)
  assert.match(app.host.textContent,/controlled page 429/)
  await act(async()=>button('重试加载更多').click())
  await flush()
  assert.equal(page2Calls,2)
  assert.equal(cards().length,11)
  assert.equal(app.host.querySelectorAll('a[href="https://github.com/member/project-10"]').length,1)
  assert.equal(button('加载更多项目'),undefined)
  assert.match(app.host.textContent,/1000 条可访问上限/)
  assert.deepEqual(requests,[1,2,2])
 }finally{await app.close()}
})

test('Member management permission cannot survive logout or a late old capability response',async()=>{
 const pending=deferred()
 const calls=[]
 let phase='initial'
 const api={getHome:async(o,r,branch)=>({repository:{name:r,full_name:o+'/'+r},branch,
  team:{state:'ready',members:[{id:'one',name:'Visible member'}]},readme:{state:'missing'}}),
  getCapability:async(o,r,branch,signal)=>{
   calls.push({o,r,branch,signal,phase})
   if(phase==='initial')return pending.promise
   if(phase==='allowed')return {user:{id:1,login:'operator'},mode:'commit',branch:'main'}
   throw Object.assign(Error('logged out'),{status:401})
  }}
 const app=await mount('/sample/repo/members','/:owner/:repo/members',Members,{api})
 const link=()=>app.host.querySelector('a[href="/sample/repo/members/register"]')
 try{
  assert.match(app.host.textContent,/Visible member/)
  assert.equal(link(),null)
  assert.ok(calls.length)
  phase='allowed'
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.ok(link())
  phase='logout'
  await act(async()=>window.dispatchEvent(new Event('labourchain:session-change')))
  await flush()
  assert.equal(link(),null)
  assert.match(app.host.textContent,/Visible member/)
  assert.ok(calls.filter(c=>c.phase==='initial').every(c=>c.signal.aborted))
  pending.resolve({user:{id:1,login:'stale'},mode:'commit',branch:'main'})
  await flush()
  assert.equal(link(),null)
  assert.ok(calls.every(c=>c.o==='sample'&&c.r==='repo'&&c.branch==='main'))
 }finally{await app.close()}
})

test('Topic report controller blocks duplicate and unknown POSTs until explicit recheck',async()=>{
 const Topic=(await server.ssrLoadModule('/plugins/topic-page/src/TopicPageContainer.tsx')).default
 const {createTopicPageApi}=await server.ssrLoadModule('/plugins/topic-page/src/service.ts')
 const pending=deferred()
 const writes=[],preflights=[],unexpected=[]
 let proofs=0
 const api=createTopicPageApi(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  if(url.pathname==='/api/github-session')return Response.json({authenticated:true})
  if(url.pathname==='/api/topic-page')return Response.json({error:'controlled source 503',stage:'source'},{status:503})
  if(url.pathname==='/api/topic-report'&&(init.method||'GET')==='GET'){
   preflights.push([url.searchParams.get('owner'),url.searchParams.get('repo')])
   return Response.json({state:'ready',proof:'proof-'+(++proofs)})
  }
  if(url.pathname==='/api/topic-report'&&init.method==='POST'){
   writes.push({body:JSON.parse(init.body),write:init.headers['X-LabourChain-Write'],credentials:init.credentials})
   if(writes.length===1)return pending.promise
   return Response.json({state:'created',issue:{number:71,html_url:'https://github.com/sample/repo/issues/71'}},{status:201})
  }
  unexpected.push([String(address),init.method]);throw Error('Unexpected Topic request')
 })
 const app=await mount('/topic/sample/repo','/topic/:owner/:repo',Topic,{owner:'sample',repo:'repo',api})
 const dialog=()=>app.host.querySelector('[role="dialog"]')
 const button=text=>[...app.host.querySelectorAll('button')].find(b=>b.textContent===text)
 const submit=()=>dialog().querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
 try{
  await act(async()=>button('编辑问题报告').click());await flush()
  assert.equal(proofs,1)
  const title='Edited report',body='Keep this draft'
  await act(async()=>{input(dialog().querySelector('input'),title);input(dialog().querySelector('textarea'),body)})
  assert.ok(!dialog().querySelector('button[type="submit"]').disabled)
  await act(async()=>{submit();submit()})
  assert.equal(writes.length,1)
  assert.deepEqual(writes[0],{body:{owner:'sample',repo:'repo',title,body,confirmed:true,proof:'proof-1'},write:'1',credentials:'same-origin'})
  pending.reject(new TypeError('connection lost after request'))
  await flush()
  assert.equal(dialog().querySelector('input').value,title)
  assert.equal(dialog().querySelector('textarea').value,body)
  assert.ok(dialog().querySelector('button[type="submit"]').disabled)
  assert.match(dialog().textContent,/之前的创建结果未知/)
  await act(async()=>submit())
  assert.equal(writes.length,1)
  await act(async()=>button('我已在 GitHub 核查，允许再次提交').click());await flush()
  assert.equal(proofs,2)
  assert.equal(writes.length,1)
  assert.ok(!dialog().querySelector('button[type="submit"]').disabled)
  await act(async()=>submit());await flush()
  assert.equal(writes.length,2)
  assert.deepEqual(writes[1],{...writes[0],body:{...writes[0].body,proof:'proof-2'}})
  assert.deepEqual(preflights,[['sample','repo'],['sample','repo']])
  assert.deepEqual(unexpected,[])
  assert.equal(dialog(),null)
  assert.ok(app.host.querySelector('a[href="https://github.com/sample/repo/issues/71"]'))
 }finally{await app.close()}
})

test('Topic denied report preflight cannot dispatch a write and offers the exact GitHub fallback',async()=>{
 const Topic=(await server.ssrLoadModule('/plugins/topic-page/src/TopicPageContainer.tsx')).default
 const {createTopicPageApi}=await server.ssrLoadModule('/plugins/topic-page/src/service.ts')
 const requests=[]
 const api=createTopicPageApi(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  requests.push({path:url.pathname,query:url.search,method:init.method||'GET'})
  if(url.pathname==='/api/github-session')return Response.json({authenticated:true})
  if(url.pathname==='/api/topic-page')return Response.json({error:'source unavailable',stage:'source'},{status:503})
  if(url.pathname==='/api/topic-report'&&(init.method||'GET')==='GET')
   return Response.json({error:'permission denied'},{status:403})
  throw Error('Unexpected request')
 })
 const app=await mount('/topic/sample/repo','/topic/:owner/:repo',Topic,{owner:'sample',repo:'repo',api})
 try{
  const opener=[...app.host.querySelectorAll('button')].find(x=>x.textContent==='编辑问题报告')
  assert.ok(opener)
  await act(async()=>opener.click());await flush()
  const dialog=app.host.querySelector('[role="dialog"]')
  assert.match(dialog.textContent,/当前不能确认写入权限/)
  assert.match(dialog.textContent,/permission denied/)
  assert.ok(dialog.querySelector('button[type="submit"]').disabled)
  assert.ok(dialog.querySelector('a[href="https://github.com/sample/repo/issues/new"]'))
  await act(async()=>dialog.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  assert.deepEqual(requests.filter(x=>x.path==='/api/topic-report'),
   [{path:'/api/topic-report',query:'?owner=sample&repo=repo',method:'GET'}])
  assert.ok(requests.every(x=>x.method==='GET'&&['/api/github-session','/api/topic-page','/api/topic-report'].includes(x.path)))
 }finally{await app.close()}
})

test('Theme preference is restored on remount and remains usable when persistence fails',async()=>{
 const {ThemeProvider,ThemeToggle}=await server.ssrLoadModule('/plugins/react-ui/src/index.tsx')
 const key='labourchain.theme',previous=localStorage.getItem(key)
 const original=window.Storage.prototype.setItem
 let app
 const open=()=>mount('/sample/repo','/:owner/:repo',()=>h(ThemeProvider,null,h(ThemeToggle)),{})
 const root=()=>app.host.querySelector('[data-lc-theme]')
 try{
  localStorage.setItem(key,'invalid')
  app=await open()
  assert.equal(root().dataset.lcTheme,'dark')
  await act(async()=>root().querySelector('button').click())
  assert.equal(root().dataset.lcTheme,'light')
  assert.equal(localStorage.getItem(key),'light')
  await app.close();app=null
  app=await open()
  assert.equal(root().dataset.lcTheme,'light')
  window.Storage.prototype.setItem=function(name,value){
   if(name===key)throw Error('storage denied')
   return original.call(this,name,value)
  }
  await act(async()=>root().querySelector('button').click())
  assert.equal(root().dataset.lcTheme,'dark')
  assert.equal(localStorage.getItem(key),'light')
 }finally{
  window.Storage.prototype.setItem=original
  if(app)await app.close()
  if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous)
 }
})

test('Session control retries a failed read and emits session invalidation only after confirmed logout',async()=>{
 const SessionMenu=(await server.ssrLoadModule('/plugins/react-ui/src/SessionMenu.tsx')).default
 let readReady=false,logoutReady=false,reads=0,writes=0,changes=0,app
 const changed=()=>{changes++}
 window.addEventListener('labourchain:session-change',changed)
 const request=async(path,init)=>{
  if(path==='/api/github-session'){
   reads++
   return readReady
    ? Response.json({authenticated:true,user:{login:'fixture-user',avatarUrl:null}})
    : Response.json({error:'unavailable'},{status:503})
  }
  assert.equal(path,'/api/github-logout')
  assert.equal(init.method,'POST')
  assert.equal(init.credentials,'same-origin')
  assert.equal(init.headers['X-LabourChain-Write'],'1')
  writes++
  return logoutReady
   ? Response.json({authenticated:false})
   : Response.json({error:'unavailable'},{status:503})
 }
 try{
  app=await mount('/sample/repo','/:owner/:repo',SessionMenu,{request})
  assert.match(app.host.querySelector('[role="alert"]').textContent,/登录状态加载失败/)
  const before=reads
  readReady=true
  await act(async()=>app.host.querySelector('[role="alert"] button').click())
  await flush()
  assert.ok(reads>before)
  const trigger=app.host.querySelector('button[aria-expanded]')
  assert.ok(trigger)
  await act(async()=>trigger.click())
  const menu=app.host.querySelector('[aria-label="GitHub 账户操作"]')
  assert.equal(menu.getAttribute('role'),'group')
  await act(async()=>menu.querySelector('button').click())
  await flush()
  assert.equal(writes,1)
  assert.equal(changes,0)
  assert.match(app.host.querySelector('[role="alert"]').textContent,/退出登录失败/)
  logoutReady=true
  await act(async()=>menu.querySelector('button').click())
  await flush()
  assert.equal(writes,2)
  assert.equal(changes,1)
  assert.equal(app.host.querySelector('[aria-expanded]'),null)
  assert.match(app.host.querySelector('a').textContent,/使用 GitHub 登录/)
 }finally{
  window.removeEventListener('labourchain:session-change',changed)
  if(app)await app.close()
 }
})

test('account disclosure requires explicit activation; Escape and outside close without new requests',async()=>{
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
  assert.equal(expanded(),'false')
  await act(async()=>trigger.click())
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
  assert.equal(expanded(),'false')
  await act(async()=>trigger.click())
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






test('feed card preserves title, independent markdown link, expansion, selection and modifiers',async()=>{
 const Card=(await server.ssrLoadModule('/plugins/repo-home/src/RepoIssueActivityCard.tsx')).RepoIssueActivityCard
 const issue={number:11,title:'Controlled card',state:'open',updated_at:'2026-11-26T00:00:00Z',html_url:'https://github.com/sample/repo/issues/11',
  body:'[reference](https://example.org/) '+ 'long body '.repeat(100)}
 const app=await mount('/sample/repo','/:owner/:repo',Card,{issue,base:'/sample/repo'})
 const cancel=e=>e.preventDefault()
 document.addEventListener('click',cancel)
 try{
  const card=app.host.querySelector('article')
  const title=card.querySelector('h3 a')
  assert.equal(title.getAttribute('href'),'/sample/repo/issues/11')
  const expand=card.querySelector('button')
  await act(async()=>expand.click())
  assert.equal(expand.getAttribute('aria-expanded'),'true')
  const nested=card.querySelector('a[href="https://example.org/"]')
  assert.ok(nested)
  await act(async()=>nested.click())
  assert.ok(app.host.contains(card))
  const source=card.querySelector('[aria-label="GitHub 原文"]')
  await act(async()=>source.click())
  assert.ok(app.host.contains(card))
  await act(async()=>card.dispatchEvent(new MouseEvent('click',{bubbles:true,metaKey:true})))
  assert.ok(app.host.contains(card))
  const range=document.createRange();range.selectNodeContents(title)
  const selection=window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
  assert.equal(selection.isCollapsed,false,'fixture must establish an actual text selection')
  await act(async()=>card.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})))
  assert.ok(app.host.contains(card))
  window.getSelection().removeAllRanges()
  await act(async()=>card.click())
  assert.equal(app.host.contains(card),false)
 }finally{window.getSelection().removeAllRanges();document.removeEventListener('click',cancel);await app.close()}
})


test('permalink stays verifiable and refresh success/failure are distinct',async()=>{
 for(const refreshFails of [false,true]){
  let posted=false
  const svc=issueService({authorized:true,
   comments:()=>posted&&refreshFails?Promise.reject(Error('refresh offline')):
    Promise.resolve({items:[replyComment(700,'existing discussion')],hasMore:false}),
   postComment:async()=>{posted=true;return {id:771}}})
  const app=await issueMount(svc)
  try{
   await act(async()=>input(replyArea(app),'publish once'))
   await act(async()=>replySend(app).click());await flush()
   assert.ok([...app.host.querySelectorAll('a')].some(a=>a.href.endsWith('#issuecomment-771')))
   if(refreshFails)assert.match(app.host.textContent,/GitHub 已确认发表；讨论列表刷新失败/)
   else assert.match(app.host.textContent,/已发表；讨论列表已重新读取/)
  }finally{await app.close()}
 }
})

test('shared Markdown renders supported syntax and rejects executable markup and unsafe media',async()=>{
 const {SafeMarkdown}=await server.ssrLoadModule('/plugins/shared/src/SafeMarkdown.tsx')
 const body=[
  ...Array.from({length:6},(_,i)=>'#'.repeat(i+1)+' Heading '+(i+1)),
  '**real emphasis** [Safe](https://example.org)',
  '> exact quotation','- first entry\n- second entry',
  '\x60\x60\x60js\nconst example = "<script>"\n\x60\x60\x60',
  '![poster](https://example.com/poster.png)','@[video](https://example.com/watch)',
  '<script>window.bad=true</script>','<iframe src="https://evil.invalid"></iframe>',
  '[bad](javascript:alert(1))','![bad](data:image/png;base64,AA)',
  '![plain HTTP](http://example.com/x.png)','[credentials](https://user:pass@example.com)',
  'FINAL BODY MARKER',
 ].join('\n\n')
 const app=await mount('/','/',SafeMarkdown,{body})
 try{
  for(let level=1;level<=6;level++){
   const heading=app.host.querySelector('[role="heading"][aria-level="'+level+'"],h'+level)
   assert.ok(heading);assert.equal(heading.textContent,'Heading '+level)
  }
  const links=[...app.host.querySelectorAll('a')]
  const safe=links.find(a=>a.textContent==='Safe')
  assert.ok(safe);assert.equal(safe.href,'https://example.org/')
  assert.ok(safe.relList.contains('noopener'))
  assert.equal(app.host.querySelector('strong').textContent,'real emphasis')
  assert.equal(app.host.querySelector('blockquote').textContent,'exact quotation')
  assert.deepEqual([...app.host.querySelectorAll('li')].map(li=>li.textContent),['first entry','second entry'])
  assert.equal(app.host.querySelector('pre code').textContent,'const example = "<script>"')
  const img=app.host.querySelector('img[alt="poster"]')
  assert.ok(img);assert.equal(img.src,'https://example.com/poster.png')
  assert.equal(img.getAttribute('referrerpolicy'),'no-referrer')
  assert.equal(links.find(a=>a.textContent==='打开视频').href,'https://example.com/watch')
  assert.match(app.host.textContent,/<script>window.bad=true<\/script>/)
  assert.match(app.host.textContent,/图片链接不可用：bad/)
  assert.match(app.host.textContent,/图片链接不可用：plain HTTP/)
  assert.match(app.host.textContent,/FINAL BODY MARKER/)
  assert.equal(app.host.querySelectorAll('img').length,1)
  assert.equal(app.host.querySelector('script,iframe,object,embed,[href^="javascript:"],[src^="data:"],[href*="user:pass@"],[src^="http:"]'),null)
 }finally{await app.close()}
})

test('anonymous discussion is readable; confirmed reply length and empty body are enforced by the mounted page',async()=>{
 const long=replyComment(101,'长'.repeat(1500))
 for(const authorized of [false,true]){
  const svc=issueService({authorized,comments:()=>({items:[long],hasMore:false})})
  const app=await issueMount(svc)
  try{
   assert.match(app.host.textContent,/长长长/)
   if(!authorized){
    assert.equal(replyArea(app),null)
    assert.equal(quoteButtons(app).length,0)
    assert.ok([...app.host.querySelectorAll('a')].some(a=>new URL(a.href).searchParams.get('return_to')==='/sample/repo/issues/1'))
   }else{
    await act(async()=>quoteButtons(app)[0].click())
    assert.ok(replySend(app).disabled)
    await act(async()=>input(replyArea(app),'x'.repeat(20000)))
    await act(async()=>replyArea(app).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
    assert.ok(replySend(app).disabled)
    await act(async()=>input(replyArea(app),'short'))
    assert.equal(replySend(app).disabled,false)
   }
   assert.deepEqual(svc.writes,[])
  }finally{await app.close()}
 }
})

const publishKey='labourchain:issue-create:v1:sample/repo'
const publishTarget={owner:'sample',repo:'repo'}
function publishNetwork(write,authenticated=true){
 const calls=[]
 const api=createRepoIssuesApi(observeHttp(async(address,init={})=>{
  const url=new URL(address,'https://local.test')
  const entry={path:url.pathname,query:Object.fromEntries(url.searchParams),method:init.method||'GET',
   body:init.body?JSON.parse(init.body):undefined,signal:init.signal}
  calls.push(entry)
  assert.equal(init.credentials,'same-origin')
  if(entry.path==='/api/repos'&&entry.method==='GET'){
   assert.deepEqual(entry.query,publishTarget)
   return Response.json({state:'connected',repository:{owner:'sample',name:'repo',full_name:'sample/repo'}})
  }
  if(entry.path==='/api/github-session'&&entry.method==='GET')return Response.json({authenticated})
  if(entry.path==='/api/github-issue-create'&&entry.method==='POST'){
   assert.equal(init.headers['X-LabourChain-Write'],'1')
   return write(entry)
  }
  throw Error('Unexpected publication HTTP request: '+address)
 }))
 return {api,calls,posts:()=>calls.filter(x=>x.method==='POST'),
  open:()=>mount('/sample/repo/issues/new','/:owner/:repo/issues/new',CreateIssue,{api,owner:'sample',repo:'repo'})}
}
const fillPublication=async(page,title,body)=>act(async()=>{
 input(page.host.querySelector('#create-issue-title'),title)
 input(page.host.querySelector('#create-issue-body'),body)
})
const createdIssue=(number,repo='sample/repo')=>Response.json({issue:{
 number,html_url:'https://github.com/'+repo+'/issues/'+number}},{status:201})

test('Issue publication submits the latest restored draft once and clears only the exact acknowledged draft',async()=>{
 for(const changedDuringWrite of [false,true]){
  localStorage.removeItem(publishKey)
  const pending=deferred(),remote=publishNetwork(()=>pending.promise)
  let page=await remote.open()
  try{
   await fillPublication(page,'Initial','Old body')
   await fillPublication(page,'  Reviewed title  ','Reviewed body')
   await page.close();page=await remote.open()
   assert.equal(page.host.querySelector('#create-issue-title').value,'  Reviewed title  ')
   assert.equal(page.host.querySelector('#create-issue-body').value,'Reviewed body')
   assert.deepEqual(remote.posts(),[])
   await act(async()=>{formSubmit(page.host);formSubmit(page.host)})
   assert.deepEqual(remote.posts().map(x=>x.body),[{...publishTarget,title:'Reviewed title',body:'Reviewed body'}])
   if(changedDuringWrite)await fillPublication(page,'Newer title','Newer body')
   pending.resolve(createdIssue(47));await flush()
   assert.ok(page.host.querySelector('a[href="/sample/repo/issues/47"]'))
   assert.ok(page.host.querySelector('a[href="https://github.com/sample/repo/issues/47"]'))
   assert.equal(page.host.querySelector('form'),null)
   assert.deepEqual(JSON.parse(localStorage.getItem(publishKey)),changedDuringWrite?{title:'Newer title',description:'Newer body'}:null)
   assert.equal(remote.posts().length,1)
  }finally{await page.close();localStorage.removeItem(publishKey)}
 }
})

test('a rejected publication preserves an editable draft; unverifiable success requires manual verification and never replays on reopening',async()=>{
 let attempt=0
 const remote=publishNetwork(()=>++attempt===1?Response.json({error:'Validation failed'},{status:422}):createdIssue(2,'other/repo'))
 let page=await remote.open()
 try{
  await fillPublication(page,'Review','Preserve this draft')
  await act(async()=>formSubmit(page.host));await flush()
  const failure=page.host.querySelector('form [role="alert"]')
  assert.match(failure.textContent,/Validation failed/)
  assert.equal(document.activeElement,failure)
  assert.equal(page.host.querySelector('button[type="submit"]').disabled,false)
  await act(async()=>formSubmit(page.host));await flush()
  assert.match(page.host.textContent,/发布结果尚未确认/)
  assert.equal(page.host.querySelector('form'),null)
  assert.equal(page.host.querySelector('a[href="https://github.com/other/repo/issues/2"]'),null)
  assert.deepEqual(JSON.parse(localStorage.getItem(publishKey)),{title:'Review',description:'Preserve this draft'})
  await page.close();page=await remote.open()
  assert.equal(page.host.querySelector('#create-issue-title').value,'Review')
  assert.equal(page.host.querySelector('#create-issue-body').value,'Preserve this draft')
  assert.deepEqual(remote.posts().map(x=>x.body),Array(2).fill({...publishTarget,title:'Review',body:'Preserve this draft'}))
 }finally{await page.close();localStorage.removeItem(publishKey)}
})

test('anonymous publication never sends a write and login returns to the scoped repository',async()=>{
 const remote=publishNetwork(()=>{throw Error('Unexpected anonymous write')},false)
 const page=await remote.open()
 try{
  assert.equal(page.host.querySelector('form'),null)
  const login=page.host.querySelector('a[href^="/api/github-login?"]')
  assert.equal(new URL(login.href).searchParams.get('return_to'),'/sample/repo/issues/new')
  assert.deepEqual(remote.posts(),[])
 }finally{await page.close()}
})
