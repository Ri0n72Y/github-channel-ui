import test from 'node:test'
import assert from 'node:assert/strict'
import {createIssuesHandler} from '../api/issues.mjs'
import {githubHttpFixture} from './helpers/github-http.mjs'

const origin='https://local.test'
const http=githubHttpFixture(origin,'unused-fixture-user')
const base='/repos/sample/repo'
const target=origin+'/api/issues?owner=sample&repo=repo'
const issue=(number,fields={})=>({number,title:'Issue '+number,comments:2,
  html_url:'https://github.com/sample/repo/issues/'+number,...fields})
const next='<https://api.github.com/repos/sample/repo/issues?page=2>; rel="next"'
const page=(items,more=false)=>Response.json(items,{headers:more?{Link:next}:{}})

function upstream({grants={issues:'read'},installed=true,pages=[]}={}){
 const calls=[]
 http.use(async(url,init={})=>{
  const u=new URL(url)
  const request={origin:u.origin,path:u.pathname,query:Object.fromEntries(u.searchParams),
   method:init.method||'GET',authorization:init.headers?.Authorization,redirect:init.redirect,
   body:init.body?JSON.parse(init.body):undefined}
  calls.push(request)
  if(u.origin!=='https://api.github.com')throw Error('Unexpected upstream origin')
  if(request.path===base)return Response.json({id:50,private:false,full_name:'sample/repo',
    owner:{login:'sample',type:'User'}})
  if(request.path===base+'/installation')return Response.json(
    {id:17,account:{login:'sample'},suspended_at:null},{status:installed?200:404})
  if(request.path==='/app/installations/17')return Response.json({id:17,account:{login:'sample'},
    suspended_at:null,permissions:grants})
  if(request.path==='/app/installations/17/access_tokens')return Response.json(
    {token:'fixture-read-token',repositories:[{id:50}]},{status:201})
  if(request.path===base+'/issues'){
   const response=pages[Number(request.query.page)-1]
   if(response)return response()
  }
  throw Error('Unexpected upstream request')
 })
 return {calls,handler:createIssuesHandler(),check(expectedPages,withToken=true){
  const prefix=[base,base+'/installation','/app/installations/17',
    ...(withToken?['/app/installations/17/access_tokens']:[])]
  assert.deepEqual(calls.map(c=>c.path),[...prefix,...expectedPages.map(()=>base+'/issues')])
  assert.ok(calls.every(c=>c.origin==='https://api.github.com'&&c.redirect==='manual'))
  assert.deepEqual(calls.filter(c=>c.method!=='GET').map(c=>[c.path,c.method,c.body]),withToken?
    [['/app/installations/17/access_tokens','POST',{repository_ids:[50],permissions:{issues:'read'}}]]:[])
  for(const [i,c] of calls.slice(prefix.length).entries()){
   assert.deepEqual(c.query,{state:'open',per_page:'100',page:String(expectedPages[i])})
   assert.equal(c.authorization,withToken?'Bearer fixture-read-token':undefined)
  }
 }}
}

test('actual repository Issue endpoint joins distinct Issues across GitHub pages and excludes pull requests',async()=>{
 for(const grants of [{issues:'read'},{}]){
  const remote=upstream({grants,pages:[
   ()=>page([issue(1),issue(99,{pull_request:{}})],true),
   ()=>page([issue(1),issue(2,{extra:'ignored'})])
  ]})
  const response=await remote.handler.fetch(new Request(target))
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{issues:[issue(1),issue(2)]})
  remote.check([1,2],Boolean(grants.issues))
 }
})

test('invalid repository target and method are rejected before any upstream HTTP',async()=>{
 const remote=upstream()
 for(const [url,method,status] of [[origin+'/api/issues','GET',400],
  [origin+'/api/issues?owner=a%2Fb&repo=repo','GET',400],[target,'POST',405]]){
  assert.equal((await remote.handler.fetch(new Request(url,{method}))).status,status)
 }
 assert.deepEqual(remote.calls,[])
})

test('revoked Installation cannot read public Issues without the repository gate',async()=>{
 const remote=upstream({installed:false})
 const response=await remote.handler.fetch(new Request(target))
 assert.equal(response.status,403)
 assert.equal(Object.hasOwn(await response.json(),'issues'),false)
 assert.deepEqual(remote.calls.map(c=>c.path),[base,base+'/installation'])
 assert.ok(remote.calls.every(c=>c.method==='GET'))
})

test('malformed later pages or cross-repository links never become successful partial Issue lists',async()=>{
 for(const bad of [()=>page([issue(2,{html_url:'https://github.com/other/repo/issues/2'})]),
  ()=>page([issue(2,{html_url:'https://example.invalid/issues/2'})]),
  ()=>page({issues:[]}),()=>new Response('invalid JSON')]){
  const remote=upstream({pages:[()=>page([issue(1)],true),bad]})
  const response=await remote.handler.fetch(new Request(target))
  assert.equal(response.status,502)
  assert.equal(Object.hasOwn(await response.json(),'issues'),false)
  remote.check([1,2])
 }
})

test('actual GitHub errors and the five-page cap cannot masquerade as an empty successful list',async()=>{
 for(const status of [403,429,503]){
  const remote=upstream({pages:[()=>page([issue(1)],true),()=>Response.json({message:'Unavailable'},{status})]})
  const response=await remote.handler.fetch(new Request(target))
  assert.equal(response.status,status)
  assert.equal(Object.hasOwn(await response.json(),'issues'),false)
  remote.check([1,2])
 }
 const remote=upstream({pages:Array.from({length:5},(_,i)=>()=>page([issue(i+1)],true))})
 const response=await remote.handler.fetch(new Request(target))
 assert.equal(response.status,409)
 assert.equal(Object.hasOwn(await response.json(),'issues'),false)
 remote.check([1,2,3,4,5])
})
