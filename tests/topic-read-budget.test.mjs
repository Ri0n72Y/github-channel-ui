import test from 'node:test'
import assert from 'node:assert/strict'
import {createTopicSourceStore} from '../plugins/topic-page/server/_topic-source.mjs'
import {createTopicReadCache} from '../plugins/topic-page/src/topic-read-cache.mjs'
import {createTopicPageEndpoint} from '../api/_topic-page.mjs'
import {createTopicProjectsEndpoint} from '../api/_topic-projects.mjs'
import {topicReadFixture,HEAD,ROOT_TREE,PROJECT_TREE,blobSha,json} from './helpers/topic-read-fixture.mjs'

const source='https://labour.test/api/topic-page?owner=sample&repo=repo'
const projects='https://labour.test/api/topic-projects?owner=sample&repo=repo&head='+HEAD
const candidate=id=>({id,full_name:'member/p'+id,name:'p'+id,owner:{login:'member'},
  private:false,html_url:'https://github.com/member/p'+id})
const counts=calls=>[
  calls.filter(c=>c.host==='api.github.com'&&c.path!=='/search/repositories').length,
  calls.filter(c=>c.host==='raw.githubusercontent.com').length,
  calls.filter(c=>c.path==='/search/repositories').length]
function endpoints(m,options={}){
  const store=createTopicSourceStore({fetcher:m.fetcher,...options})
  return {store,meta:createTopicPageEndpoint({fetcher:m.fetcher,store}),
    list:createTopicProjectsEndpoint({fetcher:m.fetcher,store})}
}
const get=(endpoint,url)=>endpoint.fetch(new Request(url))
test('#83 cold 50-file source: 4 core REST, 52 Raw, one Search per page; concurrent requests coalesce',async()=>{
  const declarations=Object.fromEntries(Array.from({length:50},(_,i)=>[
    (i+1)+'-member-p'+(i+1)+'.yaml','repository: member/p'+(i+1)+'\n']))
  let active=0,peak=0
  const m=topicReadFixture({projects:declarations,cover:'image',intercept:async u=>{
    if(u.hostname==='raw.githubusercontent.com'&&u.pathname.includes('/projects/')){
      active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--
    }
  },search:u=>({total_count:200,incomplete_results:false,items:
    Array.from({length:100},(_,i)=>candidate((Number(u.searchParams.get('page'))-1)*100+i+1))})})
  const {meta,list}=endpoints(m)
  const [a,b,c]=await Promise.all([get(meta,source),get(list,projects),get(list,projects)])
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(c.status,200)
  const snapshot=await a.json(),page=await b.json()
  assert.equal(snapshot.allowedRepositories.length,50)
  assert.equal(snapshot.configSha,blobSha('topic: labourchain\n'))
  assert.equal(snapshot.coverUrl,'https://raw.githubusercontent.com/sample/repo/'+HEAD+'/cover.jpg')
  assert.equal(page.items.length,50);assert.deepEqual(await c.json(),page)
  assert.deepEqual(counts(m.calls),[4,52,1])
  assert.ok(peak<=5&&peak>1)
  assert.ok(m.calls.every(c=>!c.auth&&c.method==='GET'))
  assert.ok(m.calls.filter(c=>c.host==='raw.githubusercontent.com').every(c=>c.path.includes('/'+HEAD+'/')))
  assert.equal((await get(list,projects+'&page=2')).status,200)
  assert.equal((await get(list,projects+'&page=2')).status,200)
  assert.equal((await get(meta,source)).status,200)
  assert.deepEqual(counts(m.calls),[4,52,2])
})
test('#83 missing, empty and disabled whitelist avoid unnecessary requests',async()=>{
  for(const [config,files,expected,status] of [
    [null,{},[3,1,0],404],
    ['topic: labourchain\n',null,[3,2,0],200],
    ['topic: labourchain\n',{},[4,2,0],200],
    ['topic: labourchain\nwhitelist: false\n',{'p.yaml':'repository: member/p1\n'},[3,2,1],200],
  ]){
    const m=topicReadFixture({config,projects:files})
    const {meta,list}=endpoints(m)
    assert.equal((await get(meta,source)).status,200)
    assert.equal((await get(list,projects)).status,status)
    assert.deepEqual(counts(m.calls),expected)
  }
})
test('#83 cache TTL, refresh and effective-config invalidation; cold version mismatch refuses pagination',async()=>{
  let now=0,head=HEAD
  const versions=[topicReadFixture({projects:null,config:'topic: labourchain\nwhitelist: false\n'}),
    topicReadFixture({head:'e'.repeat(40),config:'topic: changed\n',projects:null})]
  const m={fetcher:(url,init)=>versions[head===HEAD?0:1].fetcher(url,init)}
  const {store,meta,list}=endpoints(m,{now:()=>now})
  assert.equal((await get(list,projects)).status,200)
  now=119999
  assert.equal((await get(list,projects)).status,200)
  assert.deepEqual(counts(versions[0].calls),[3,2,1])
  now=120001
  assert.equal((await get(list,projects)).status,200)
  assert.deepEqual(counts(versions[0].calls),[3,2,2])
  assert.equal((await get(meta,source+'&refresh=1')).status,200)
  assert.equal((await get(list,projects)).status,200)
  assert.deepEqual(counts(versions[0].calls),[6,4,3])
  head='e'.repeat(40)
  store.invalidate('SAMPLE','REPO')
  const mismatch=await get(list,projects+'&page=2')
  assert.equal(mismatch.status,409);assert.equal((await mismatch.json()).stage,'snapshot')
  assert.deepEqual(counts(versions[1].calls),[3,2,0])
  const cold=endpoints(m)
  assert.equal((await get(cold.list,projects+'&page=2')).status,409)
  assert.equal((await get(meta,source)).status,200)
  now+=300001
  const before=counts(versions[1].calls)
  assert.equal((await get(meta,source)).status,200)
  assert.deepEqual(counts(versions[1].calls),[before[0]+3,before[1]+2,before[2]])
})
test('#83 Raw failure, mismatching blob, truncated tree and Search failure are not cached',async()=>{
  for(const mode of ['raw-429','raw-404','raw-mismatch','truncated','search-incomplete']){
    let fail=true
    const m=topicReadFixture({projects:{'one.yaml':'repository: member/p1\n'},
      intercept:u=>{
        if(!fail)return
        if(mode==='raw-429'&&u.pathname.endsWith('/one.yaml'))return new Response('',{status:429})
        if(mode==='raw-404'&&u.pathname.endsWith('/one.yaml'))return new Response('',{status:404})
        if(mode==='raw-mismatch'&&u.pathname.endsWith('/one.yaml'))return new Response('repository: member/p2\n')
        if(mode==='truncated'&&u.pathname.endsWith(ROOT_TREE))return json({sha:ROOT_TREE,truncated:true,tree:[]})
      },search:()=>({total_count:1,incomplete_results:fail&&mode==='search-incomplete',items:[candidate(1)]})})
    const {list}=endpoints(m)
    const result=await get(list,projects)
    assert.equal(result.status,mode==='raw-429'?429:mode==='raw-404'?404:502,mode)
    if(mode!=='search-incomplete')assert.equal(counts(m.calls)[2],0)
    fail=false
    const retry=await get(list,projects)
    assert.equal(retry.status,200,mode);assert.equal((await retry.json()).items[0].id,1)
  }
})
test('#83 bounded cache invalidation never resurrects a stale in-flight entry',async()=>{
  let now=0,finish,loads=0
  const cache=createTopicReadCache({ttl:10,limit:2,now:()=>now})
  const a=cache.get('repo|old',()=>new Promise(resolve=>{finish=resolve}))
  await Promise.resolve()
  cache.invalidate('repo|')
  const b=cache.get('repo|old',async()=>++loads)
  assert.equal(await b,1)
  finish('stale');assert.equal(await a,'stale')
  assert.equal(await cache.get('repo|old',async()=>++loads),1)
  assert.equal(cache.has('repo|old'),true)
  now=11
  assert.equal(cache.has('repo|old'),false)
  assert.equal(await cache.get('repo|old',async()=>++loads),2)
  await assert.rejects(cache.get('repo|failed',async()=>{throw Error('failure')}))
  assert.equal(await cache.get('repo|failed',async()=>3),3)
})
