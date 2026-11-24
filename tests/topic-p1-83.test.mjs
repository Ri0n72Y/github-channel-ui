import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { createTopicConfigEndpoint } from '../api/_topic-config.mjs'
import { loadInstalledTopicBatch } from '../plugins/topic-page/src/domain.mjs'

const ROOT = '/repos/sample/repo'
const source = 'topic: labourchain\nwhitelist: true\n'
const file = (value, sha='a'.repeat(40))=>({
  type:'file',sha,encoding:'base64',size:Buffer.byteLength(value),
  content:Buffer.from(value).toString('base64') })
const reply=(status,data,headers={})=>Response.json(data,{status,headers})
const address='/api/topic-projects?owner=sample&repo=repo'
const candidate=(id)=>({id,full_name:'member/p'+id,name:'p'+id,
  owner:{login:'member'},private:false,
  html_url:'https://github.com/member/p'+id,stargazers_count:id,language:null})
function searchMock({items=Array.from({length:100},(_,i)=>candidate(i+1)),
  total=250, config='topic: labourchain\nwhitelist: false\n',incomplete=false}={}){
  const calls=[]
  const fetcher=async(url,init={})=>{
    const u=new URL(url)
    calls.push({path:u.pathname,search:u.search,auth:init.headers?.Authorization,
      method:init.method||'GET'})
    if(u.pathname===ROOT)return reply(200,{private:false,full_name:'sample/repo'})
    if(u.pathname===ROOT+'/contents/topics.config.yaml')return reply(200,file(config))
    if(u.pathname==='/search/repositories')return reply(200,{
      total_count:total,incomplete_results:incomplete,items})
    throw Error('unexpected GET '+u.pathname)
  }
  return {fetcher,calls}
}
test('#83 configured public Topic reads a bounded slice without Installation or authorization',async()=>{
  const mock=searchMock()
  const endpoint=createTopicProjectsEndpoint({fetcher:mock.fetcher})
  const first=await endpoint.fetch(new Request('https://labour.test'+address))
  assert.equal(first.status,200)
  const data=await first.json()
  assert.deepEqual([data.page,data.offset,data.items.length,data.nextPage,data.nextOffset],
    [1,0,25,1,25])
  assert.deepEqual(mock.calls.map(c=>c.path),[
    ROOT,ROOT+'/contents/topics.config.yaml','/search/repositories'])
  assert.equal(new URLSearchParams(mock.calls[2].search).get('q'),'topic:labourchain is:public')
  assert.ok(mock.calls.every(c=>!c.auth&&c.method==='GET'))
  const second=await endpoint.fetch(new Request('https://labour.test'+address+'&offset=25'))
  assert.equal((await second.json()).items[0].id,26)
})
test('#83 public search excludes private, malformed, mismatched and source candidates',async()=>{
  const items=[candidate(1),candidate(2),{...candidate(3),private:true},
    {...candidate(4),id:0},{...candidate(5),html_url:'https://evil.invalid/member/p5'},
    {...candidate(6),full_name:'another/p6'},
    {...candidate(7),full_name:'sample/repo',name:'repo',
      owner:{login:'sample'},html_url:'https://github.com/sample/repo'}]
  const mock=searchMock({items,total:items.length})
  const response=await createTopicProjectsEndpoint({fetcher:mock.fetcher})
    .fetch(new Request('https://labour.test'+address))
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).items.map(p=>p.id),[1,2])
  assert.equal(mock.calls.length,3)
})
test('#83 incomplete Search, throttling and invalid cursor fail closed',async()=>{
  const incomplete=searchMock({incomplete:true})
  const response=await createTopicProjectsEndpoint({fetcher:incomplete.fetcher})
    .fetch(new Request('https://labour.test'+address))
  assert.equal(response.status,502)
  assert.equal((await response.json()).stage,'topic-search')
  const limited=searchMock()
  const throttled=await createTopicProjectsEndpoint({fetcher:(url,init)=>
    new URL(url).pathname==='/search/repositories'?
      reply(403,{}, {'x-ratelimit-remaining':'0'}):limited.fetcher(url,init)})
    .fetch(new Request('https://labour.test'+address))
  assert.equal(throttled.status,429)
  assert.equal((await throttled.json()).stage,'topic-search')
  const invalid=searchMock()
  const result=await createTopicProjectsEndpoint({fetcher:invalid.fetcher})
    .fetch(new Request('https://labour.test'+address+'&offset=90'))
  assert.equal(result.status,400)
  assert.equal(invalid.calls.length,0)
})
test('#83 public batch fills sparse pages, dedups stable ID and distinguishes window exhaustion',async()=>{
  const meta={repository:{full_name:'sample/repo'},
    config:{whitelist:true},allowedRepositories:['member/p1','member/p2']}
  const calls=[]
  const getPage=async(page,offset)=>{
    calls.push({page,offset})
    if(offset===0)return {page:1,offset:0,perPage:100,hasNext:true,
      nextPage:1,nextOffset:25,windowExhausted:false,items:[]}
    if(offset===25)return {page:1,offset:25,perPage:100,hasNext:true,
      nextPage:1,nextOffset:50,windowExhausted:false,items:[
        candidate(1),{...candidate(1),full_name:'MEMBER/P1'},candidate(3)]}
    return {page:1,offset:50,perPage:100,hasNext:false,nextPage:null,nextOffset:null,
      windowExhausted:true,items:[candidate(2)]}
  }
  const result=await loadInstalledTopicBatch(meta,getPage,new AbortController().signal)
  assert.deepEqual(result.items.map(p=>p.id),[1,2])
  assert.deepEqual(calls,[{page:1,offset:0},{page:1,offset:25},{page:1,offset:50}])
  assert.equal(result.windowExhausted,true)
  assert.equal(result.cursor,null)
  const aborted=new AbortController()
  aborted.abort()
  await assert.rejects(loadInstalledTopicBatch(meta,getPage,aborted.signal))
})

function configMock({protectedBranch=false,appWrite=true,appPrWrite=true,
  userPush=true,sha=null,actual='topic: labourchain\nwhitelist: true\n',
  mismatch=false,prFailure=false,rulesFailure=false,readbackFailure=null}={}){
  const calls=[]
  const base=ROOT
  const savedByBranch=new Map()
  let pendingPR=null
  const fetcher=async(url,init={})=>{
    const path=new URL(url).pathname,method=init.method||'GET'
    const req={path,method,body:init.body?JSON.parse(init.body):null,
      auth:init.headers?.Authorization}
    calls.push(req)
    if(path==='/app/installations/17')return reply(200,{
      id:17,account:{login:'sample'},permissions:{
        contents:appWrite?'write':'read',pull_requests:appPrWrite?'write':'read'},
      suspended_at:null})
    if(path==='/user')return reply(200,{id:42,login:'sample'})
    if(path===base&&method==='GET')return reply(200,{
      id:50,private:false,full_name:'sample/repo',default_branch:'main',
      permissions:{push:userPush}})
    if(path===base+'/branches/main'){
      if(savedByBranch.has('main')&&readbackFailure?.stage==='branch'){
        if(readbackFailure.type==='network')throw Error('timed out')
        if(readbackFailure.type==='json')return new Response('not JSON',{status:200})
        return reply(readbackFailure.status||503,{error:'readback unavailable'},
          readbackFailure.status===429?{'x-ratelimit-remaining':'0'}:{})
      }
      return reply(200,{name:'main',
        protected:protectedBranch,commit:{sha:mismatch?'d'.repeat(40):'b'.repeat(40)}})
    }
    if(path.startsWith(base+'/branches/labourchain%2Ftopic-'))return reply(200,{
      name:decodeURIComponent(path.split('/').slice(-1)[0]),
      commit:{sha:'c'.repeat(40)},protected:false})
    if(path===base+'/rules/branches/main'&&rulesFailure)
      return reply(403,{error:'Forbidden'})
    if(path===base+'/rules/branches/main')return reply(200,
      protectedBranch?[{type:'pull_request'}]:[])
    if(path.startsWith(base+'/rules/branches/labourchain%2Ftopic-'))
      return reply(200,[])
    if(path===base+'/contents/topics.config.yaml'&&method==='GET') {
      const ref=new URL(url).searchParams.get('ref')||'main'
      const saved=savedByBranch.get(ref)
      if(saved&&readbackFailure?.stage==='file'){
        if(readbackFailure.type==='network')throw Error('timed out')
        if(readbackFailure.type==='json')return new Response('not JSON',{status:200})
        return reply(readbackFailure.status||503,{error:'readback unavailable'},
          readbackFailure.status===429?{'x-ratelimit-remaining':'0'}:{})
      }
      if(!saved&&sha===null)return new Response('',{status:404})
      return reply(200,file(saved?.text||actual,saved?.sha||sha))
    }
    if(path===base+'/git/refs'&&method==='POST')
      return reply(201,{ref:req.body.ref})
    if(path===base+'/contents/topics.config.yaml'&&method==='PUT'){
      const saved={sha:'e'.repeat(40),text:Buffer.from(req.body.content,'base64').toString()}
      savedByBranch.set(req.body.branch,saved)
      return reply(201,{commit:{sha:'f'.repeat(40)},content:{sha:saved.sha}})
    }
    if(path===base+'/pulls'&&method==='GET'){
      const head=new URL(url).searchParams.get('head')
      return reply(200,pendingPR&&head==='sample:'+pendingPR.head.ref?[pendingPR]:[])
    }
    if(path===base+'/pulls'&&method==='POST'){
      if(prFailure)return reply(503,{error:'unavailable'})
      pendingPR={number:81,html_url:'https://github.com/sample/repo/pull/81',
        state:'open',head:{ref:req.body.head,repo:{full_name:'sample/repo'}},
        base:{ref:req.body.base}}
      return reply(201,pendingPR)
    }
    throw Error('unexpected '+method+' '+path)
  }
  return {fetcher,calls}
}
const contextFor=(body={})=>async(request,options)=>{
  assert.equal(options.dynamicInstallation,true)
  return {body:{owner:'sample',repo:'repo',confirmed:true,
    expectedHeadSha:'b'.repeat(40),expectedFileSha:null,
    content:'topic: labourchain\nwhitelist: false\n',...body},token:'user-token'}
}
const installation=async()=>({installationId:17,repositoryId:50,jwt:'app-jwt'})
const configUrl='https://labour.test/api/topic-config'

test('#83 explicit OAuth owner edit writes verified unprotected branch and reads back',async()=>{
  const mock=configMock()
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
  const response=await handler.fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(response.status,200)
  const result=await response.json()
  assert.equal(result.state,'committed')
  assert.equal(result.effective,true)
  assert.equal(result.commitSha,'f'.repeat(40))
  const writes=mock.calls.filter(c=>c.method!=='GET')
  assert.equal(writes.length,1)
  assert.equal(writes[0].method,'PUT')
  assert.equal(writes[0].auth,'Bearer user-token')
  assert.equal(mock.calls.find(c=>c.path==='/app/installations/17').auth,'Bearer app-jwt')
})
test('#83 branch protection creates a PR, never advertises unmerged config as effective',async()=>{
  const mock=configMock({protectedBranch:true})
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
  const response=await handler.fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.state,'pending_pr')
  assert.equal(body.effective,false)
  assert.equal(body.prUrl,'https://github.com/sample/repo/pull/81')
  assert.deepEqual(mock.calls.filter(c=>c.method!=='GET').map(c=>c.method),
    ['POST','PUT','POST'])
})
test('#83 invalid YAML, stale HEAD, App/User denial and missing OAuth never write',async()=>{
  const cases=[
    {args:{},body:{content:'topic: labourchain\nunknown: exposed\n'},status:422},
    {args:{mismatch:true},status:409},
    {args:{appWrite:false},status:403},
    {args:{userPush:false},status:403},
  ]
  for(const {args,body,status}of cases){
    const mock=configMock(args)
    const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
      writeContextFn:contextFor(body),installationResolver:installation})
    const response=await handler.fetch(new Request(configUrl,{method:'POST'}))
    assert.equal(response.status,status)
    assert.equal(mock.calls.filter(c=>c.method!=='GET').length,0)
  }
  const auth=createTopicConfigEndpoint({fetcher:async()=>{throw Error('forbidden')},
    writeContextFn:async()=>({error:reply(401,{error:'login required'})})})
  assert.equal((await auth.fetch(new Request(configUrl,{method:'POST'}))).status,401)
  assert.equal((await auth.fetch(new Request(configUrl))).status,405)
})


test('#83 two source configurations select their own Topic and case-insensitive whitelist',async()=>{
  const calls=[]
  const fetcher=async(url,init={})=>{
    const u=new URL(url);calls.push({path:u.pathname,q:u.searchParams.get('q')})
    assert.equal(init.headers?.Authorization,undefined)
    assert.equal(init.method||'GET','GET')
    for(const [name,topic,config] of [['first','alpha','topic: alpha\n'],
        ['second','beta','topic: beta\nwhitelist: false\n']]){
      const root='/repos/sample/'+name
      if(u.pathname===root)return reply(200,{private:false,full_name:'sample/'+name})
      if(u.pathname===root+'/contents/topics.config.yaml')return reply(200,file(config))
      if(u.pathname===root+'/contents/projects'){
        assert.equal(name,'first','disabled whitelist never reads project files')
        return reply(200,[{name:'1-member-p1.yaml',path:'projects/1-member-p1.yaml'},
          {name:'2-member-p9.yaml',path:'projects/2-member-p9.yaml'}])
      }
      if(u.pathname===root+'/contents/projects/1-member-p1.yaml')
        return reply(200,file('repository: MEMBER/P1\n'))
      if(u.pathname===root+'/contents/projects/2-member-p9.yaml')
        return reply(200,file('repository: member/p9\n'))
      if(u.pathname==='/search/repositories'&&u.searchParams.get('q')==='topic:'+topic+' is:public')
        return reply(200,{total_count:2,incomplete_results:false,items:
          name==='first'?[candidate(1),candidate(2)]:[candidate(3),candidate(4)]})
    }
    throw Error('unexpected GitHub read '+u.pathname)
  }
  const handler=createTopicProjectsEndpoint({fetcher})
  for(const [name,ids] of [['first',[1]],['second',[3,4]]]){
    const result=await handler.fetch(new Request('https://labour.test/api/topic-projects?owner=sample&repo='+name))
    assert.equal(result.status,200)
    assert.deepEqual((await result.json()).items.map(p=>p.id),ids)
  }
  assert.deepEqual(calls.filter(c=>c.path==='/search/repositories').map(c=>c.q),
    ['topic:alpha is:public','topic:beta is:public'])
  assert.ok(!calls.some(c=>c.path.includes('installation')))
})
test('#83 missing or invalid config and whitelist read failure never fall back to arbitrary Search',async()=>{
  for(const [mode,status,stage] of [['missing-config',404,'config'],
      ['bad-config',422,'config'],['directory-error',502,'whitelist'],
      ['listed-file-missing',404,'whitelist'],['rate-limit',429,'whitelist']]){
    const base=searchMock({items:[candidate(1)],total:1,config:source})
    let searches=0
    const fetcher=async(url,init)=>{
      const path=new URL(url).pathname
      if(path==='/search/repositories')searches++
      if(path===ROOT+'/contents/topics.config.yaml'){
        if(mode==='missing-config')return reply(404,{})
        if(mode==='bad-config')return reply(200,file('topic: bad_slug\n'))
      }
      if(path===ROOT+'/contents/projects'){
        if(mode==='directory-error')return reply(503,{})
        if(mode==='rate-limit')return reply(429,{})
        return reply(200,[{name:'p1.yaml',path:'projects/p1.yaml'}])
      }
      if(path===ROOT+'/contents/projects/p1.yaml')return reply(404,{})
      return base.fetcher(url,init)
    }
    const result=await createTopicProjectsEndpoint({fetcher})
      .fetch(new Request('https://labour.test'+address))
    assert.equal(result.status,status,mode)
    assert.equal((await result.json()).stage,stage,mode)
    assert.equal(searches,0,mode)
  }
})
test('#83 explicit or default whitelist stays closed with missing directory or invalid declarations',async()=>{
  for(const config of [source,'topic: labourchain\n']){
    for(const missing of [true,false]){
      const base=searchMock({items:[candidate(1)],total:1,config})
      const fetcher=(url,init)=>{
        const path=new URL(url).pathname
        if(path===ROOT+'/contents/projects')return missing?reply(404,{}):
          reply(200,[{name:'bad.yaml',path:'projects/bad.yaml'}])
        if(path===ROOT+'/contents/projects/bad.yaml')return reply(200,file('unknown: bad\n'))
        return base.fetcher(url,init)
      }
      const response=await createTopicProjectsEndpoint({fetcher})
        .fetch(new Request('https://labour.test'+address))
      assert.equal(response.status,200)
      assert.deepEqual((await response.json()).items,[])
    }
  }
})
test('#83 protected write requires App PR permission and leaves partial state on uncertain PR creation',async()=>{
  const missing=configMock({protectedBranch:true,appPrWrite:false})
  const denied=await createTopicConfigEndpoint({fetcher:missing.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
    .fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(denied.status,403)
  assert.equal(missing.calls.filter(c=>c.method!=='GET').length,0)
  const blocked=configMock({rulesFailure:true})
  const badRules=await createTopicConfigEndpoint({fetcher:blocked.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
    .fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(badRules.status,403)
  assert.equal(blocked.calls.filter(c=>c.method!=='GET').length,0)
  const partial=configMock({protectedBranch:true,prFailure:true})
  const handler=createTopicConfigEndpoint({fetcher:partial.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
  const response=await handler.fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.state,'partial_failure')
  assert.equal(body.effective,false)
  assert.equal(body.outcomeUnknown,true)
  assert.match(body.branchUrl,/^https:\/\/github\.com\/sample\/repo\/tree\/labourchain\/topic-/)
  assert.equal(partial.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='POST').length,1)
})


test('#83 Reviewer B1: successful direct PUT followed by readback faults stays outcomeUnknown',async()=>{
  for(const scenario of [
    {stage:'branch',type:'network'},
    {stage:'branch',status:429},
    {stage:'branch',status:503},
    {stage:'branch',type:'json'},
    {stage:'file',type:'network'},
    {stage:'file',status:429},
    {stage:'file',status:503},
    {stage:'file',type:'json'},
  ]){
    const mock=configMock({readbackFailure:scenario})
    const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
      writeContextFn:contextFor(),installationResolver:installation})
    const response=await handler.fetch(new Request(configUrl,{method:'POST'}))
    assert.equal(response.status,502,JSON.stringify(scenario))
    const body=await response.json()
    assert.equal(body.state,'rejected',JSON.stringify(scenario))
    assert.equal(body.outcomeUnknown,true,JSON.stringify(scenario))
    assert.match(body.error,/已执行 GitHub PUT/)
    assert.equal(mock.calls.filter(c=>c.method==='PUT').length,1)
    assert.equal(mock.calls.filter(c=>c.method==='POST').length,0)
  }
})
test('#83 Reviewer B1: protected PUT readback failure preserves partial branch and unknown status',async()=>{
  const mock=configMock({protectedBranch:true,
    readbackFailure:{stage:'file',status:503}})
  const response=await createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
    .fetch(new Request(configUrl,{method:'POST'}))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.state,'partial_failure')
  assert.equal(body.effective,false)
  assert.equal(body.outcomeUnknown,true)
  assert.match(body.branchUrl,/^https:\/\/github\.com\/sample\/repo\/tree\/labourchain\/topic-/)
  assert.equal(mock.calls.filter(c=>c.method==='PUT').length,1)
  assert.equal(mock.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='POST').length,0)
})
test('#83 Reviewer B2: identical protected save reuses the verified open PR',async()=>{
  const mock=configMock({protectedBranch:true})
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
  const one=await (await handler.fetch(new Request(configUrl,{method:'POST'}))).json()
  const two=await (await handler.fetch(new Request(configUrl,{method:'POST'}))).json()
  assert.equal(one.state,'pending_pr')
  assert.equal(two.state,'pending_pr')
  assert.equal(one.branch,two.branch)
  assert.equal(one.prUrl,two.prUrl)
  assert.equal(one.effective,false)
  assert.equal(two.effective,false)
  assert.equal(two.reused,true)
  assert.equal(mock.calls.filter(c=>c.path===ROOT+'/git/refs'&&c.method==='POST').length,1)
  assert.equal(mock.calls.filter(c=>c.method==='PUT').length,1)
  assert.equal(mock.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='POST').length,1)
  assert.ok(mock.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='GET').length>=2)
})
test('#83 Reviewer B2: changed YAML hashes to another branch; same-content PR remains deduplicated',async()=>{
  const mock=configMock({protectedBranch:true})
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:contextFor(),installationResolver:installation})
  const first=await (await handler.fetch(new Request(configUrl,{method:'POST'}))).json()
  assert.equal(first.state,'pending_pr')
  const otherText=contextFor({content:'topic: changed\nwhitelist: false\n'})
  const second=await createTopicConfigEndpoint({fetcher:mock.fetcher,
    writeContextFn:otherText,installationResolver:installation})
    .fetch(new Request(configUrl,{method:'POST'}))
  // A distinct YAML creates a separate deterministic branch; source-side base still unchanged.
  assert.equal(second.status,200)
  assert.notEqual((await second.json()).branch,first.branch)
})
