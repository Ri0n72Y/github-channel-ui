import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { topicReadFixture, HEAD } from './helpers/topic-read-fixture.mjs'
import { loadInstalledTopicBatch } from '../plugins/topic-page/src/domain.mjs'

const origin='https://labour.test'
const path='/api/topic-projects?owner=sample&repo=repo&head='+HEAD
const request=(page,offset=0)=>new Request(origin+path+'&page='+page+'&offset='+offset)
const metadata={repository:{full_name:'sample/repo'},config:{whitelist:true},allowedRepositories:['member/early','member/late']}
const repo=(id,name)=>({id,full_name:name,name:name.split('/')[1],owner:{login:name.split('/')[0]},
  html_url:'https://github.com/'+name,private:false})
function source({total=1001,failPage=null,incompletePage=null,empty=false}={}){
  const observed=[]
  const github=topicReadFixture({projects:{'early.yaml':'repository: member/early\n','late.yaml':'repository: member/late\n'},
    search:(url,init)=>{
      const page=Number(url.searchParams.get('page'))
      observed.push({page,perPage:url.searchParams.get('per_page'),query:url.searchParams.get('q'),method:init.method||'GET'})
      if(page===failPage)return Response.json({message:'rate limited'},{status:429})
      const size=Math.max(0,Math.min(100,total-(page-1)*100))
      return {total_count:total,incomplete_results:page===incompletePage,
        items:Array.from({length:empty&&page===incompletePage?0:size},(_,i)=>{
          const id=(page-1)*100+i+1
          return repo(id,id===1?'member/early':id===170?'member/late':'outside/project-'+id)
        })}
    }})
  const endpoint=createTopicProjectsEndpoint({fetcher:github.fetcher})
  const getPage=async(page,offset)=>{
    const response=await endpoint.fetch(request(page,offset))
    const body=await response.json()
    if(!response.ok)throw Object.assign(Error(body.error),{status:response.status,stage:body.stage,retryable:body.retryable})
    return body
  }
  return {endpoint,getPage,observed,github}
}
function checkSearch(fixture,pages){
  assert.deepEqual(fixture.observed.map(row=>row.page),pages)
  assert.ok(fixture.observed.every(row=>row.perPage==='100'&&row.method==='GET'&&row.query.includes('topic:labourchain')))
  assert.ok(fixture.github.calls.every(row=>row.method==='GET'&&!row.auth))
}
const signal=()=>new AbortController().signal

test('a sparse whitelist reads the remaining Search pages and never labels the 1000-result window as complete',async()=>{
  for(const [total,pages,windowExhausted,ids] of [
    [99,[1],false,[1]],
    [170,[1,2],false,[1,170]],
    [1000,[1,2,3,4,5,6,7,8,9,10],false,[1,170]],
    [1001,[1,2,3,4,5,6,7,8,9,10],true,[1,170]],
  ]){
    const fixture=source({total})
    const result=await loadInstalledTopicBatch(metadata,fixture.getPage,signal())
    assert.deepEqual(result.items.map(item=>item.id),ids,'total '+total)
    assert.equal(result.cursor,null)
    assert.equal(result.ended,true)
    assert.equal(result.windowExhausted,windowExhausted)
    checkSearch(fixture,pages)
  }
})

test('Search throttling or incomplete results interrupt the entire batch even after a valid earlier result',async()=>{
  for(const page of [1,2]){
    for(const [mode,expected] of [['rate-limit',429],['incomplete',502]]){
      const fixture=source({total:170,...(mode==='rate-limit'?{failPage:page}:{incompletePage:page})})
      await assert.rejects(loadInstalledTopicBatch(metadata,fixture.getPage,signal()),
        {status:expected,stage:'topic-search',retryable:true})
      checkSearch(fixture,page===1?[1]:[1,2])
    }
  }
  for(const empty of [true,false]){
    const fixture=source({total:1,incompletePage:1,empty})
    const response=await fixture.endpoint.fetch(request(1))
    assert.equal(response.status,502)
    assert.equal((await response.json()).stage,'topic-search')
    checkSearch(fixture,[1])
  }
})

test('invalid raw page and offset are rejected before reading any GitHub resource',async()=>{
  const fixture=source()
  for(const [page,offset] of [[0,0],[11,0],[1,25]]){
    const response=await fixture.endpoint.fetch(request(page,offset))
    assert.equal(response.status,400)
  }
  assert.deepEqual(fixture.github.calls,[])
})

test('the consumer rejects corrupted cursor metadata before requesting another page',async()=>{
  const valid={page:1,offset:0,perPage:100,hasNext:true,nextPage:2,nextOffset:0,windowExhausted:false,items:[]}
  for(const changed of [{nextPage:11},{nextPage:1},{nextOffset:24},{page:2},{offset:25},{windowExhausted:true},
    {items:[repo(0,'member/early')]},{hasNext:undefined},{incompleteResults:true}]){
    const calls=[]
    await assert.rejects(loadInstalledTopicBatch(metadata,async(page,offset)=>{
      calls.push([page,offset]);return {...valid,...changed}
    },signal()),{status:502,stage:'topic-search'})
    assert.deepEqual(calls,[[1,0]])
  }
})

test('cancellation after a valid page returns no partial result and schedules no next page',async()=>{
  const controller=new AbortController()
  let resolve
  const pending=new Promise(r=>{resolve=r})
  const reads=[]
  const load=loadInstalledTopicBatch(metadata,(page,offset)=>{
    reads.push([page,offset]);return pending
  },controller.signal)
  assert.deepEqual(reads,[[1,0]])
  controller.abort()
  resolve({page:1,offset:0,perPage:100,items:[repo(1,'member/early')],hasNext:true,nextPage:2,nextOffset:0})
  await assert.rejects(load,/aborted/)
  assert.deepEqual(reads,[[1,0]])
})
