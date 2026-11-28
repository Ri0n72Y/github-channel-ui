import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepoChannelsHandler } from '../api/_repo-channels.mjs'
import { githubHttpFixture } from './helpers/github-http.mjs'

const http=githubHttpFixture('https://labour.test','not-used-for-public-read')
const base='/repos/collective/ledger'
const head='a'.repeat(40)
const config='namespaces:\n  channel: [review, planning]\n'
const request=(suffix='',method='GET')=>new Request('https://labour.test/api/repo-channels?owner=collective&repo=ledger'+suffix,{method})
const githubIssue=(number,channel,created_at)=>({id:number+100,number,title:'Discussion '+number,
  state:'open',labels:[{name:'channel:'+channel}],html_url:'https://github.com/collective/ledger/issues/'+number,
  user:{login:'mira'},comments:3,created_at})

// Only the external GitHub HTTP server is substituted. All outgoing requests are
// retained and checked outside production's network error handling.
function github({document=config,main=true,pages=[],failPage=0,limit=10}={}){
  const calls=[],unexpected=[]
  http.use(async(address,init={})=>{
    const url=new URL(address),method=init.method||'GET'
    const entry={origin:url.origin,path:url.pathname,query:Object.fromEntries(url.searchParams),
      method,auth:init.headers?.Authorization,body:init.body?JSON.parse(init.body):undefined}
    calls.push(entry)
    const reject=()=>{unexpected.push(entry);return Response.json({message:'unexpected request'},{status:500})}
    if(url.origin!=='https://api.github.com')return reject()
    if(method==='GET'&&url.pathname===base+'/installation')
      return Response.json({id:17,account:{login:'collective'},suspended_at:null})
    if(method==='GET'&&url.pathname==='/app/installations/17')
      return Response.json({id:17,account:{login:'collective'},suspended_at:null,
        permissions:{issues:'read',contents:'read'}})
    if(method==='GET'&&url.pathname===base)
      return Response.json({id:42,private:false,full_name:'collective/ledger',owner:{login:'collective',type:'User'}})
    if(method==='POST'&&url.pathname==='/app/installations/17/access_tokens')
      return Response.json({token:'channel-read-token'},{status:201})
    if(method!=='GET')return reject()
    if(url.pathname===base+'/branches/main')
      return main?Response.json({name:'main',commit:{sha:head}}):Response.json({message:'missing'},{status:404})
    if(url.pathname===base+'/contents/labourchain.config.yaml')
      return document===null?Response.json({},{status:404}):Response.json({
        type:'file',encoding:'base64',size:Buffer.byteLength(document),sha:'b'.repeat(40),
        content:Buffer.from(document).toString('base64')})
    if(url.pathname===base+'/issues'){
      const page=Number(url.searchParams.get('page'))
      if(page===failPage)return Response.json({message:'rate limit'},{status:429})
      if(!pages[page-1])return reject()
      return Response.json(pages[page-1],{headers:page<pages.length?
        {Link:'<https://api.github.com'+base+'/issues?page='+(page+1)+'>; rel="next"'}:{}})
    }
    return reject()
  })
  return {handler:createRepoChannelsHandler({maxPages:limit}),calls,unexpected}
}
function checkBoundary(fixture,expectedReads){
  assert.deepEqual(fixture.unexpected,[])
  assert.ok(fixture.calls.every(call=>call.origin==='https://api.github.com'))
  const tokens=fixture.calls.filter(call=>call.method==='POST')
  assert.equal(tokens.length,1)
  assert.equal(tokens[0].path,'/app/installations/17/access_tokens')
  assert.deepEqual(tokens[0].body,{repository_ids:[42],permissions:{issues:'read',contents:'read'}})
  http.assertApp(tokens[0].auth)
  for(const path of [base+'/installation','/app/installations/17']){
    const call=fixture.calls.find(row=>row.path===path)
    assert.ok(call)
    http.assertApp(call.auth)
  }
  const reads=fixture.calls.filter(call=>call.path.startsWith(base+'/')&&!call.path.endsWith('/installation'))
  assert.deepEqual(reads.map(({path,query})=>({path,query})),expectedReads)
  assert.ok(reads.every(row=>row.method==='GET'&&row.auth==='Bearer channel-read-token'))
}
const branchRead={path:base+'/branches/main',query:{}}
const configRead={path:base+'/contents/labourchain.config.yaml',query:{ref:'main'}}
const issueRead=page=>({path:base+'/issues',query:{state:'open',sort:'created',direction:'desc',per_page:'100',page:String(page)}})

test('Channel reads the exact installed repository main Config and every Issue page before publishing the result',async()=>{
  const fixture=github({pages:[
    [githubIssue(7,'review','2026-09-01T00:00:00Z')],
    [githubIssue(8,'review','2026-09-02T00:00:00Z')],
  ]})
  const response=await fixture.handler.fetch(request())
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{state:'ready',branch:'main',headSha:head,
    channels:[{label:'channel:review',name:'review',issue:{number:8,title:'Discussion 8',
      createdAt:'2026-09-02T00:00:00Z',comments:3,author:'mira'}},
      {label:'channel:planning',name:'planning',issue:null}],scannedIssues:2,pages:2})
  checkBoundary(fixture,[branchRead,configRead,issueRead(1),issueRead(2)])
})

test('missing main or an inactive Channel declaration stops reading before any Issue search',async()=>{
  for(const [options,state,reads] of [
    [{main:false},'sync_branch_missing',[branchRead]],
    [{document:null},'config_missing',[branchRead,configRead]],
    [{document:'namespaces:\n  channel:[]'},'invalid_config',[branchRead,configRead]],
    [{document:'namespaces:\n  status: [todo]'},'no_channels',[branchRead,configRead]],
    [{document:'namespaces:\n  channel: []'},'no_channels',[branchRead,configRead]],
  ]){
    const fixture=github(options)
    const response=await fixture.handler.fetch(request())
    assert.equal(response.status,200,state)
    const result=await response.json()
    assert.equal(result.state,state)
    assert.deepEqual(result.channels,[])
    checkBoundary(fixture,reads)
  }
})

test('bounded or failed later pagination does not return an apparent successful Channel winner',async()=>{
  const pages=[[githubIssue(7,'review','2026-09-01T00:00:00Z')],
    [githubIssue(8,'review','2026-09-02T00:00:00Z')]]
  const bounded=github({pages,limit:1})
  const response=await bounded.handler.fetch(request())
  assert.equal(response.status,200)
  const value=await response.json()
  assert.equal(value.state,'snapshot_incomplete')
  assert.deepEqual(value.channels,[])
  assert.match(value.error,/分页/)
  checkBoundary(bounded,[branchRead,configRead,issueRead(1)])
  const failure=github({pages,failPage:2})
  const rejected=await failure.handler.fetch(request())
  assert.equal(rejected.status,429)
  const error=await rejected.json()
  assert.match(error.error,/限流/)
  assert.equal(Object.hasOwn(error,'channels'),false)
  checkBoundary(failure,[branchRead,configRead,issueRead(1),issueRead(2)])
})

test('Channel rejects write methods and alternate branches without any external request',async()=>{
  const fixture=github()
  assert.equal((await fixture.handler.fetch(request('','POST'))).status,405)
  assert.equal((await fixture.handler.fetch(request('&branch=feature'))).status,400)
  assert.deepEqual(fixture.calls,[])
})
