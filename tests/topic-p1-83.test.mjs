import test from 'node:test'
import assert from 'node:assert/strict'
import { ProbeError } from '../api/_installation-probe.mjs'
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
test('#83 verified public installations only; 25-candidate/5-worker bounded slice and cursor',async()=>{
  const mock=searchMock()
  let active=0, max=0
  const checked=[]
  const resolver=async({owner,repo})=>{
    assert.equal(owner,'member')
    active++;max=Math.max(active,max)
    checked.push(repo)
    await Promise.resolve()
    active--
    return {repositoryId:Number(repo.slice(1)),installationId:17}
  }
  const handler=createTopicProjectsEndpoint({fetcher:mock.fetcher,
    installationResolver:resolver})
  const first=await handler.fetch(new Request('https://labour.test'+address))
  assert.equal(first.status,200)
  const data=await first.json()
  assert.deepEqual([data.page,data.offset,data.items.length,data.nextPage,data.nextOffset],
    [1,0,25,1,25])
  assert.ok(max<=5)
  assert.equal(checked.length,25)
  assert.equal(mock.calls.filter(c=>c.path==='/search/repositories').length,1)
  assert.equal(mock.calls.filter(c=>c.auth).length,0)
  assert.ok(data.items.every(p=>Number.isInteger(p.id)&&p.id>0))
  const second=await handler.fetch(new Request('https://labour.test'+address+'&offset=25'))
  assert.equal((await second.json()).items[0].id,26)
})
test('#83 revoked, suspended and private candidates are skipped; unexpected failures stop list',async()=>{
  const items=[candidate(1),candidate(2),candidate(3),
    {...candidate(4),private:true}]
  const mock=searchMock({items,total:4,config:'topic: labourchain\nwhitelist: false\n'})
  const resolver=async({repo})=>{
    if(repo==='p2')throw new ProbeError('Repository is not authorized for this App',403)
    if(repo==='p3')throw new ProbeError('Repository App installation is suspended',403)
    return {repositoryId:Number(repo.slice(1)),installationId:17}
  }
  const endpoint=createTopicProjectsEndpoint({fetcher:mock.fetcher,
    installationResolver:resolver})
  const response=await endpoint.fetch(new Request('https://labour.test'+address))
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).items.map(p=>p.id),[1])
  for(const [err,status]of [
    [new ProbeError('GitHub API rate limit reached',429),429],
    [new ProbeError('GitHub verification denied',403),502],
    [new ProbeError('GitHub verification is temporarily unavailable',503),503],
  ]){
    const denied=createTopicProjectsEndpoint({fetcher:searchMock({items:[candidate(1)],
      total:1}).fetcher,installationResolver:async()=>{throw err}})
    const result=await denied.fetch(new Request('https://labour.test'+address))
    assert.equal(result.status,status)
    assert.equal((await result.json()).stage,'installation')
  }
})
test('#83 Search incomplete, ID mismatch and invalid cursor fail closed',async()=>{
  const incomplete=searchMock({incomplete:true})
  const incompleteResult=await createTopicProjectsEndpoint({fetcher:incomplete.fetcher,
    installationResolver:async()=>{throw Error('never called')}})
    .fetch(new Request('https://labour.test'+address))
  assert.equal(incompleteResult.status,502)
  const mock=searchMock({items:[candidate(1)],total:1})
  const mismatch=await createTopicProjectsEndpoint({fetcher:mock.fetcher,
    installationResolver:async()=>({repositoryId:999,installationId:17})})
    .fetch(new Request('https://labour.test'+address))
  assert.equal(mismatch.status,502)
  assert.equal((await mismatch.json()).stage,'installation')
  const invalid=await createTopicProjectsEndpoint({fetcher:mock.fetcher})
    .fetch(new Request('https://labour.test'+address+'&offset=90'))
  assert.equal(invalid.status,400)
})
test('#83 installed batch fills sparse pages, dedups stable ID and distinguishes window exhaustion',async()=>{
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
    if(path===base+'/pulls'&&method==='GET')return reply(200,pendingPR?[pendingPR]:[])
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


test('#83 source projects whitelist intersects installed results on the server',async()=>{
  const base=searchMock({items:[candidate(1),candidate(2)],total:2,config:source})
  const calls=[]
  const fetcher=async(url,init)=>{
    const pathname=new URL(url).pathname
    if(pathname===ROOT+'/contents/projects')
      return reply(200,[{name:'p1.yaml',path:'projects/p1.yaml'}])
    if(pathname===ROOT+'/contents/projects/p1.yaml')
      return reply(200,file('repository: member/p1\n'))
    return base.fetcher(url,init)
  }
  const endpoint=createTopicProjectsEndpoint({fetcher,
    installationResolver:async({repo})=>{
      calls.push(repo)
      return {installationId:17,repositoryId:Number(repo.slice(1))}
    }})
  const result=await endpoint.fetch(new Request('https://labour.test'+address))
  assert.equal(result.status,200)
  assert.deepEqual((await result.json()).items.map(item=>item.id),[1])
  assert.deepEqual(calls,['p1'],'not-whitelisted candidates are not installation-probed')
  const failing=createTopicProjectsEndpoint({
    fetcher:async(url,init)=>new URL(url).pathname===ROOT+'/contents/projects'?
      reply(503,{message:'unavailable'}):base.fetcher(url,init),
    installationResolver:async()=>{throw Error('should not probe')},
  })
  const failure=await failing.fetch(new Request('https://labour.test'+address))
  assert.equal(failure.status,502)
  assert.equal((await failure.json()).stage,'whitelist')
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
  assert.equal(partial.calls.filter(c=>c.path===ROOT+'/pulls').length,1)
})
