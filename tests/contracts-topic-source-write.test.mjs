import {observeHttp} from './helpers/observe-http.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { createTopicConfigEndpoint } from '../api/_topic-config.mjs'
import { topicReadFixture, HEAD, PROJECT_TREE } from './helpers/topic-read-fixture.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'
const http=githubHttpFixture('https://labour.test','user-token')

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
  total=250,config='topic: labourchain\nwhitelist: false\n',incomplete=false}={}){
  return topicReadFixture({config,search:()=>({total_count:total,incomplete_results:incomplete,items})})
}

test('public search excludes private, malformed, mismatched and source candidates',async()=>{
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
  assert.ok(mock.calls.every(c=>!c.path.includes('/projects/')&&!c.path.endsWith(PROJECT_TREE)))
})

function configMock({protectedBranch=false,appWrite=true,appPrWrite=true,
  userPush=true,sha=null,actual='topic: labourchain\nwhitelist: true\n',
  mismatch=false,prFailure=false,rulesFailure=false,readbackFailure=null,revoked=false,notMember=false}={}){
  const calls=[]
  const base=ROOT
  const savedByBranch=new Map()
  let pendingPR=null
  const fetcher=observeHttp(async(url,init={})=>{
    const path=new URL(url).pathname,method=init.method||'GET'
    const req={path,method,body:init.body?JSON.parse(init.body):null,
      auth:init.headers?.Authorization}
    calls.push(req)
    if(path===base+'/installation'){
      http.assertApp(req.auth)
      return reply(revoked?404:200,{id:17,account:{login:'sample'},suspended_at:null})
    }
    if(path==='/user/installations/17/repositories'){
      assert.equal(req.auth,'Bearer user-token')
      return reply(200,{repositories:notMember?[]:[{id:50,private:false,full_name:'sample/repo'}]})
    }
    if(path==='/app/installations/17')http.assertApp(req.auth)
    if(path==='/app/installations/17')return reply(200,{
      id:17,account:{login:'sample'},permissions:{
        contents:appWrite?'write':'read',pull_requests:appPrWrite?'write':'read'},
      suspended_at:null})
    if(path==='/user')return reply(200,{id:42,login:'sample'})
    if(path===base&&method==='GET')return reply(200,{
      id:50,private:false,full_name:'sample/repo',default_branch:'main',owner:{login:'sample',type:'User'},
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
  })
  http.use(fetcher)
  return {fetcher,calls,savedByBranch}
}
const configUrl='https://labour.test/api/topic-config'
const post=(body={},options={})=>http.post('/api/topic-config',{owner:'sample',repo:'repo',confirmed:true,
    expectedHeadSha:'b'.repeat(40),expectedFileSha:null,
    content:'topic: labourchain\nwhitelist: false\n',...body},options)

test('verified direct write persists exact Topic YAML including cover, reads it back and invalidates only its source',async()=>{
  const mock=configMock(),invalidated=[]
  const cover='https://raw.githubusercontent.com/sample/repo/'+HEAD+'/poster.png'
  const content='topic: labourchain\ncover: '+cover+'\n'
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,invalidate:(...args)=>invalidated.push(args)})
  const response=await handler.fetch(post({content}))
  assert.equal(response.status,200)
  const result=await response.json()
  assert.equal(result.state,'committed')
  assert.equal(result.effective,true)
  assert.equal(result.commitSha,'f'.repeat(40))
  assert.equal(result.config.cover,cover)
  const writes=mock.calls.filter(c=>c.method!=='GET')
  assert.deepEqual(writes.map(c=>[c.method,c.path,c.auth]),[['PUT',ROOT+'/contents/topics.config.yaml','Bearer user-token']])
  assert.equal(writes[0].body.branch,'main')
  assert.equal(mock.savedByBranch.get('main').text,content)
  assert.ok(mock.calls.slice(mock.calls.indexOf(writes[0])+1).some(c=>c.method==='GET'&&c.path===ROOT+'/contents/topics.config.yaml'))
  assert.deepEqual(invalidated,[['sample','repo']])
})

test('invalid YAML, stale HEAD, App/User denial and missing OAuth never write',async()=>{
  const cases=[
    {args:{},body:{content:'topic: labourchain\nunknown: exposed\n'},status:422},
    {args:{},body:{content:'topic: labourchain\ncover: javascript:alert(1)\n'},status:422},
    {args:{mismatch:true},status:409},
    {args:{appWrite:false},status:403},
    {args:{userPush:false},status:403},
  ]
  for(const {args,body,status}of cases){
    const mock=configMock(args)
    const handler=createTopicConfigEndpoint({fetcher:mock.fetcher})
    const response=await handler.fetch(post(body))
    assert.equal(response.status,status)
    assert.equal(mock.calls.filter(c=>c.method!=='GET').length,0)
  }
  for(const [args,options,status] of [
    [{},{loggedIn:false},401],[{},{requestOrigin:'https://wrong.test'},403],
    [{revoked:true},{},403],[{notMember:true},{},403]]){
    const mock=configMock(args)
    const endpoint=createTopicConfigEndpoint({fetcher:mock.fetcher})
    assert.equal((await endpoint.fetch(post({},options))).status,status)
    assert.equal(mock.calls.filter(c=>c.method!=='GET').length,0)
  }
  const auth=createTopicConfigEndpoint({fetcher:async()=>{throw Error('unexpected external request')}})
  assert.equal((await auth.fetch(new Request(configUrl))).status,405)
})


test('two source configurations select their own Topic and case-insensitive whitelist',async()=>{
  const first=topicReadFixture({repo:'first',config:'topic: alpha\n',projects:{
    '1-member-p1.yaml':'repository: MEMBER/P1\n','2-member-p9.yaml':'repository: member/p9\n'},
    search:()=>({total_count:2,items:[candidate(1),candidate(2)],incomplete_results:false})})
  const second=topicReadFixture({repo:'second',config:'topic: beta\nwhitelist: false\n',
    search:()=>({total_count:2,items:[candidate(3),candidate(4)],incomplete_results:false})})
  const fetcher=(url,init)=>{
    const u=new URL(url)
    const isSecond=u.pathname.includes('/sample/second')||u.searchParams.get('q')==='topic:beta is:public'
    return (isSecond?second:first).fetcher(url,init)
  }
  const handler=createTopicProjectsEndpoint({fetcher})
  for(const [name,ids] of [['first',[1]],['second',[3,4]]]){
    const result=await handler.fetch(new Request('https://labour.test/api/topic-projects?owner=sample&repo='+name))
    assert.equal(result.status,200)
    assert.deepEqual((await result.json()).items.map(p=>p.id),ids)
  }
  assert.equal(first.calls.filter(c=>c.path==='/search/repositories').length,1)
  assert.equal(second.calls.filter(c=>c.path==='/search/repositories').length,1)
  assert.ok(second.calls.every(c=>!c.path.includes('/projects/')&&!c.path.endsWith(PROJECT_TREE)))
  assert.ok([...first.calls,...second.calls].every(c=>!c.path.includes('installation')&&!c.auth))
})
test('missing or invalid config and whitelist read failure never fall back to arbitrary Search',async()=>{
  for(const [mode,status,stage] of [['missing-config',404,'config'],
      ['bad-config',422,'config'],['directory-error',502,'whitelist'],
      ['listed-file-missing',404,'whitelist'],['rate-limit',429,'whitelist']]){
    const mock=topicReadFixture({config:mode==='missing-config'?null:mode==='bad-config'?'topic: bad_slug\n':source,
      intercept:u=>{
        if(mode==='directory-error'&&u.pathname.endsWith(PROJECT_TREE))return reply(503,{})
        if(mode==='rate-limit'&&u.pathname.endsWith('/projects/valid.yaml'))return reply(429,{})
        if(mode==='listed-file-missing'&&u.pathname.endsWith('/projects/valid.yaml'))return reply(404,{})
      }})
    const result=await createTopicProjectsEndpoint({fetcher:mock.fetcher})
      .fetch(new Request('https://labour.test'+address))
    assert.equal(result.status,status,mode)
    assert.equal((await result.json()).stage,stage,mode)
    assert.equal(mock.calls.filter(c=>c.path==='/search/repositories').length,0,mode)
  }
})
test('explicit or default whitelist stays closed with missing directory or invalid declarations',async()=>{
  for(const config of [source,'topic: labourchain\n']){
    for(const projects of [null,{'bad.yaml':'unknown: bad\n'}]){
      const mock=topicReadFixture({config,projects,search:()=>({total_count:1,items:[candidate(1)]})})
      const response=await createTopicProjectsEndpoint({fetcher:mock.fetcher})
        .fetch(new Request('https://labour.test'+address))
      assert.equal(response.status,200)
      assert.deepEqual((await response.json()).items,[])
      assert.equal(mock.calls.filter(c=>c.path==='/search/repositories').length,0)
    }
  }
})
test('protected write requires App PR permission and leaves partial state on uncertain PR creation',async()=>{
  const missing=configMock({protectedBranch:true,appPrWrite:false})
  const denied=await createTopicConfigEndpoint({fetcher:missing.fetcher})
    .fetch(post())
  assert.equal(denied.status,403)
  assert.equal(missing.calls.filter(c=>c.method!=='GET').length,0)
  const blocked=configMock({rulesFailure:true})
  const badRules=await createTopicConfigEndpoint({fetcher:blocked.fetcher})
    .fetch(post())
  assert.equal(badRules.status,403)
  assert.equal(blocked.calls.filter(c=>c.method!=='GET').length,0)
  const partial=configMock({protectedBranch:true,prFailure:true})
  const handler=createTopicConfigEndpoint({fetcher:partial.fetcher})
  const response=await handler.fetch(post())
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.state,'partial_failure')
  assert.equal(body.effective,false)
  assert.equal(body.outcomeUnknown,true)
  assert.match(body.branchUrl,/^https:\/\/github\.com\/sample\/repo\/tree\/labourchain\/topic-/)
  assert.equal(partial.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='POST').length,1)
})


test('successful direct PUT followed by readback faults stays outcomeUnknown',async()=>{
  for(const scenario of [
    {stage:'branch',type:'network'},
    {stage:'file',status:429},
    {stage:'file',type:'json'},
  ]){
    const mock=configMock({readbackFailure:scenario})
    const handler=createTopicConfigEndpoint({fetcher:mock.fetcher})
    const response=await handler.fetch(post())
    assert.equal(response.status,502,JSON.stringify(scenario))
    const body=await response.json()
    assert.equal(body.state,'rejected',JSON.stringify(scenario))
    assert.equal(body.outcomeUnknown,true,JSON.stringify(scenario))
    assert.match(body.error,/已执行 GitHub PUT/)
    assert.equal(mock.calls.filter(c=>c.method==='PUT').length,1)
    assert.equal(mock.calls.filter(c=>c.method==='POST').length,0)
  }
})
test('protected PUT readback failure preserves partial branch and unknown status',async()=>{
  const mock=configMock({protectedBranch:true,
    readbackFailure:{stage:'file',status:503}})
  const response=await createTopicConfigEndpoint({fetcher:mock.fetcher})
    .fetch(post())
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.state,'partial_failure')
  assert.equal(body.effective,false)
  assert.equal(body.outcomeUnknown,true)
  assert.match(body.branchUrl,/^https:\/\/github\.com\/sample\/repo\/tree\/labourchain\/topic-/)
  assert.equal(mock.calls.filter(c=>c.method==='PUT').length,1)
  assert.equal(mock.calls.filter(c=>c.path===ROOT+'/pulls'&&c.method==='POST').length,0)
})
test('protected Topic edits remain pending, reuse the same open PR, and isolate different content',async()=>{
  const mock=configMock({protectedBranch:true}),invalidated=[]
  const handler=createTopicConfigEndpoint({fetcher:mock.fetcher,invalidate:(...args)=>invalidated.push(args)})
  const firstResponse=await handler.fetch(post())
  assert.equal(firstResponse.status,200)
  const first=await firstResponse.json()
  assert.equal(first.state,'pending_pr')
  assert.equal(first.effective,false)
  assert.equal(first.prUrl,'https://github.com/sample/repo/pull/81')
  const mutations=()=>mock.calls.filter(c=>c.method!=='GET')
  assert.deepEqual(mutations().map(c=>[c.method,c.path]),[
    ['POST',ROOT+'/git/refs'],['PUT',ROOT+'/contents/topics.config.yaml'],['POST',ROOT+'/pulls'],
  ])
  assert.equal(mutations()[1].body.branch,first.branch)
  assert.equal(mutations()[2].body.head,first.branch)
  assert.equal(mutations()[2].body.base,'main')
  const reused=await (await handler.fetch(post())).json()
  assert.equal(reused.state,'pending_pr')
  assert.equal(reused.reused,true)
  assert.equal(reused.branch,first.branch)
  assert.equal(reused.prUrl,first.prUrl)
  assert.equal(mutations().length,3)
  const content='topic: changed\nwhitelist: false\n'
  const next=await (await handler.fetch(post({content}))).json()
  assert.equal(next.state,'pending_pr')
  assert.equal(next.effective,false)
  assert.notEqual(next.branch,first.branch)
  assert.equal(mock.savedByBranch.get(next.branch).text,content)
  assert.equal(mock.savedByBranch.get(first.branch).text,'topic: labourchain\nwhitelist: false\n')
  assert.equal(mock.savedByBranch.has('main'),false)
  assert.deepEqual(invalidated,[])
  assert.equal(mutations().length,6)
  assert.ok(mutations().every(c=>c.auth==='Bearer user-token'))
})
