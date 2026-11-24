import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { topicReadFixture, HEAD } from './helpers/topic-read-fixture.mjs'
import { loadInstalledTopicBatch } from '../plugins/topic-page/src/domain.mjs'

const request = (page,offset=0) => new Request(
  'https://labour.test/api/topic-projects?owner=sample&repo=repo&page='+page+'&offset='+offset+'&head='+HEAD)
const meta={repository:{full_name:'sample/repo'},config:{whitelist:true},
  allowedRepositories:['member/project-1','member/project-2']}
function backend({totalCount=1400,failPage=0,incompletePage=0,emptyIncomplete=false}={}){
  const calls=[],errors=[]
  const m=topicReadFixture({projects:{'first.yaml':'repository: member/project-1\n'},
    search:(u,opts)=>{
      const page=Number(u.searchParams.get('page'))
      calls.push({page,perPage:u.searchParams.get('per_page'),authorization:opts.headers?.Authorization})
      assert.equal(u.searchParams.get('per_page'),'100')
      if(page>10)throw Error('Search must never request page 11')
      if(page===failPage)return Response.json({},{status:403,headers:{'x-ratelimit-remaining':'0'}})
      const count=Math.max(0,Math.min(100,totalCount-(page-1)*100))
      return {total_count:totalCount,incomplete_results:page===incompletePage,
        items:Array.from({length:page===incompletePage&&emptyIncomplete?0:count},(_,index)=>{
          const id=(page-1)*100+index+1
          const full_name=page===1&&index===0?'member/project-1':'outside/candidate-'+id
          return {id,full_name,name:full_name.split('/')[1],owner:{login:full_name.split('/')[0]},
            html_url:'https://github.com/'+full_name,private:false,description:'public',stargazers_count:0,language:'TypeScript'}
        })}
    }})
  const endpoint=createTopicProjectsEndpoint({fetcher:m.fetcher})
  const getPage=async(page,offset)=>{
    const response=await endpoint.fetch(request(page,offset))
    const result=await response.json()
    if(!response.ok)throw Object.assign(new Error(result.error),{status:response.status,stage:result.stage})
    return result
  }
  return {calls,errors,endpoint,getPage}
}
const distinctPages=calls=>[...new Set(calls.map(c=>c.page))]

test('#31 B1 sparse whitelist scans each Search page once and flags 1000 window',async()=>{
  const api=backend()
  const result=await loadInstalledTopicBatch(meta,api.getPage,new AbortController().signal)
  assert.deepEqual(result.items.map(p=>p.full_name),['member/project-1'])
  assert.equal(result.windowExhausted,true)
  assert.equal(result.ended,true)
  assert.equal(result.slicesRead,10)
  assert.deepEqual(distinctPages(api.calls),[1,2,3,4,5,6,7,8,9,10])
  assert.equal(api.calls.length,10)
  assert.ok(api.calls.every(c=>c.perPage==='100'&&!c.authorization))
  assert.equal(api.errors.length,0)
})
test('#31 B1 exactly 1000 results is real Search exhaustion',async()=>{
  const api=backend({totalCount:1000})
  const result=await loadInstalledTopicBatch(meta,api.getPage,new AbortController().signal)
  assert.equal(result.slicesRead,10)
  assert.equal(result.ended,true)
  assert.equal(result.windowExhausted,false)
  assert.equal(api.calls.length,10)
})
test('#31 B1 real result exhaustion after two Search pages stops at actual last offset',async()=>{
  const api=backend({totalCount:170})
  const result=await loadInstalledTopicBatch(meta,api.getPage,new AbortController().signal)
  assert.equal(result.slicesRead,2)
  assert.equal(result.windowExhausted,false)
  assert.deepEqual(api.calls.map(c=>c.page),[1,2])
})
test('#31 B1 rate limited second Search page never returns a partial list as success',async()=>{
  const api=backend({failPage:2})
  await assert.rejects(loadInstalledTopicBatch(meta,api.getPage,
    new AbortController().signal),{stage:'topic-search',status:429})
  assert.deepEqual(distinctPages(api.calls),[1,2])
})
test('#31 B1 page 11 denied before GitHub; malformed next cursor denied immediately',async()=>{
  const api=backend()
  assert.equal((await api.endpoint.fetch(request(11))).status,400)
  assert.deepEqual(api.calls,[])
  const calls=[]
  await assert.rejects(loadInstalledTopicBatch(meta,async(page,offset)=>{
    calls.push([page,offset])
    return {page,offset,perPage:100,hasNext:true,nextPage:11,nextOffset:0,
      windowExhausted:false,items:[]}
  }),{stage:'topic-search',status:502})
  assert.deepEqual(calls,[[1,0]])
})
test('#31 B1-1 HTTP 200 incomplete Search is rejected for empty or nonempty candidates',async()=>{
  for(const emptyIncomplete of [true,false]){
    const api=backend({totalCount:1,incompletePage:1,emptyIncomplete})
    const http=await api.endpoint.fetch(request(1))
    assert.equal(http.status,502)
    assert.equal((await http.json()).stage,'topic-search')
    await assert.rejects(loadInstalledTopicBatch(meta,api.getPage,
      new AbortController().signal),{stage:'topic-search',status:502})
    assert.deepEqual(api.calls.map(c=>c.page),[1,1])
  }
})
test('#31 B1-1 incomplete second Search page fails without finalizing first-page candidates',async()=>{
  const api=backend({totalCount:170,incompletePage:2})
  await assert.rejects(loadInstalledTopicBatch(meta,api.getPage,
    new AbortController().signal),{stage:'topic-search',status:502})
  assert.deepEqual(distinctPages(api.calls),[1,2])
})
test('#31 B1-1 client rejects falsely successful incomplete-result payload',async()=>{
  const calls=[]
  await assert.rejects(loadInstalledTopicBatch(meta,async(page,offset)=>{
    calls.push([page,offset])
    return {page,offset,perPage:100,hasNext:false,nextPage:null,nextOffset:null,
      windowExhausted:false,incompleteResults:true,
      items:[{id:1,full_name:'member/project-1',
        html_url:'https://github.com/member/project-1'}]}
  },new AbortController().signal),{stage:'topic-search',status:502,
    message:/结果不完整/})
  assert.deepEqual(calls,[[1,0]])
})
