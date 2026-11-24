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
  const m=topicReadFixture({projects:declarations,config:'topic: labourchain\ncover: https://raw.githubusercontent.com/sample/repo/'+HEAD+'/cover.png\n',cover:'image',intercept:async u=>{
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
  assert.equal(snapshot.coverUrl,'https://raw.githubusercontent.com/sample/repo/'+HEAD+'/cover.png')
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

function deferred(){
  let resolve,reject
  const promise=new Promise((a,b)=>{resolve=a;reject=b})
  return {promise,resolve,reject}
}
test('#83 B2 refresh replaces ordinary pending, joins concurrent refresh and bounds superseded reads',async()=>{
  const cache=createTopicReadCache({ttl:100,limit:2})
  const older=deferred(),fresh=deferred()
  let loads=0,replacements=0
  const replaced=()=>replacements++
  const old=cache.get('repo|source',()=>{loads++;return older.promise},false,replaced)
  const refresh=cache.get('repo|source',()=>{loads++;return fresh.promise},true,replaced)
  assert.notEqual(refresh,old)
  assert.equal(cache.get('repo|source',()=>assert.fail('duplicate refresh'),true,replaced),refresh)
  assert.equal(cache.get('repo|source',()=>assert.fail('duplicate normal')),refresh)
  assert.equal(cache.peek('repo|source'),undefined)
  await assert.rejects(cache.get('other|source',()=>assert.fail('unbounded pending')),{status:503,stage:'source'})
  assert.equal(loads,2);assert.equal(replacements,2)
  fresh.resolve('fresh');assert.equal(await refresh,'fresh')
  older.resolve('old');assert.equal(await old,'old')
  assert.equal(cache.peek('repo|source'),'fresh')
  assert.equal(await cache.get('repo|source',()=>assert.fail('late old replaced fresh')),'fresh')
  assert.equal(await cache.get('other|source',async()=>1),1)
})
test('#83 B2 failed refresh does not resurrect ordinary pending success; retry remains possible',async()=>{
  const cache=createTopicReadCache({ttl:100,limit:2})
  const older=deferred(),fresh=deferred()
  const old=cache.get('repo|source',()=>older.promise)
  const refresh=cache.get('repo|source',()=>fresh.promise,true)
  fresh.reject(new Error('refresh failed'))
  await assert.rejects(refresh,/refresh failed/)
  older.resolve('old');assert.equal(await old,'old')
  assert.equal(cache.has('repo|source'),false)
  assert.equal(await cache.get('repo|source',async()=>'retry'),'retry')
  const late=deferred()
  const obsolete=cache.get('repo|source',()=>late.promise,true)
  cache.invalidate('repo|')
  assert.equal(await cache.get('repo|source',async()=>'replacement'),'replacement')
  late.reject(new Error('old failure'))
  await assert.rejects(obsolete,/old failure/)
  assert.equal(cache.peek('repo|source'),'replacement')
})
test('#83 B2 server refresh bypasses old ordinary source, coalesces refresh and blocks its late Search',async()=>{
  const oldStarted=deferred(),oldGate=deferred(),newStarted=deferred(),newGate=deferred()
  let sourceReads=0
  const nextHead='e'.repeat(40)
  const old=topicReadFixture({projects:null,config:'topic: old\nwhitelist: false\n'})
  const next=topicReadFixture({head:nextHead,projects:null,config:'topic: fresh\nwhitelist: false\n',
    search:()=>({total_count:1,incomplete_results:false,items:[candidate(2)]})})
  // Hold the old read at its final Raw request, after the old HEAD/tree
  // have already been resolved.
  let version=old
  const m={fetcher:async(url,init)=>{
    const u=new URL(url)
    const selected=version
    if(u.pathname==='/repos/sample/repo')sourceReads++
    if(selected===old&&u.hostname==='raw.githubusercontent.com'&&u.pathname.endsWith('/topics.config.yaml')){
      oldStarted.resolve();await oldGate.promise
    }
    if(selected===next&&u.pathname==='/repos/sample/repo'){
      newStarted.resolve();await newGate.promise
    }
    return selected.fetcher(url,init)
  }}
  const {meta,list}=endpoints(m)
  const stale=get(list,projects)
  await oldStarted.promise
  version=next
  const refresh=get(meta,source+'&refresh=1')
  await newStarted.promise
  const joined=get(meta,source+'&refresh=1')
  const ordinary=get(meta,source)
  newGate.resolve()
  for(const response of await Promise.all([refresh,joined,ordinary])){
    assert.equal(response.status,200);assert.equal((await response.json()).headSha,nextHead)
  }
  oldGate.resolve()
  assert.equal((await stale).status,409)
  assert.equal(sourceReads,2)
  assert.equal(counts(old.calls)[2],0)
  const current=await get(list,projects.replace(HEAD,nextHead))
  assert.equal(current.status,200);assert.equal((await current.json()).items[0].id,2)
  assert.equal((await (await get(meta,source)).json()).headSha,nextHead)
  assert.equal(sourceReads,2)
})
test('#83 B2 same-HEAD server refresh isolates old pending Search and late completion',async()=>{
  const oldStarted=deferred(),oldGate=deferred(),newStarted=deferred(),newGate=deferred()
  let searches=0
  const m=topicReadFixture({projects:null,config:'topic: labourchain\nwhitelist: false\n',
    search:async()=>{
      const number=++searches
      if(number===1){oldStarted.resolve();await oldGate.promise}
      if(number===2){newStarted.resolve();await newGate.promise}
      return {total_count:1,incomplete_results:false,items:[candidate(number)]}
    }})
  const {meta,list}=endpoints(m)
  await get(meta,source)
  const oldPage=get(list,projects)
  await oldStarted.promise
  assert.equal((await get(meta,source+'&refresh=1')).status,200)
  const newPage=get(list,projects)
  await newStarted.promise
  const joined=get(list,projects)
  newGate.resolve()
  for(const response of await Promise.all([newPage,joined])){
    assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,2)
  }
  oldGate.resolve()
  assert.equal((await oldPage).status,409)
  assert.equal((await (await get(list,projects)).json()).items[0].id,2)
  assert.equal(searches,2)
  assert.deepEqual(counts(m.calls),[6,4,2])
})
test('#83 P2 cache saturation is a diagnostic retryable HTTP 503',async()=>{
  const gate=deferred(),started=deferred()
  let begun=0
  const m={fetcher:async()=>{if(++begun===16)started.resolve();await gate.promise;throw Error('offline')}}
  const {meta}=endpoints(m)
  const pending=Array.from({length:16},(_,i)=>get(meta,source.replace('repo=repo','repo=r'+i)))
  await started.promise
  const saturated=await get(meta,source)
  assert.equal(saturated.status,503)
  assert.deepEqual(await saturated.json(),{error:'Topic 读取繁忙，请稍后重试',stage:'source',retryable:true})
  gate.resolve()
  for(const response of await Promise.all(pending))assert.equal(response.status,502)
})

test('#83 configured cover only, no arbitrary server image request or legacy fallback',async()=>{
  const cover='https://raw.githubusercontent.com/sample/repo/'+HEAD+'/poster.webp'
  for(const value of [null,cover,'javascript:alert(1)','https://evil.invalid/image.png',
    'https://raw.githubusercontent.com.evil.invalid/sample/repo/'+HEAD+'/poster.png',
    'data:image/svg+xml,<svg/onload=alert(1)>','https://user-images.githubusercontent.com/a.svg']){
    const config='topic: labourchain\nwhitelist: false\n'+(value===null?'':'cover: '+JSON.stringify(value)+'\n')
    const m=topicReadFixture({config,cover:'legacy',projects:null})
    const {meta,list}=endpoints(m)
    const response=await get(meta,source)
    if(value===null||value===cover){
      assert.equal(response.status,200)
      assert.equal((await response.json()).coverUrl,value)
    }else{
      assert.equal(response.status,422)
      assert.equal((await response.json()).stage,'config')
      assert.equal((await get(list,projects)).status,422)
    }
    assert.equal(m.calls.filter(c=>c.path.includes('poster')||c.path.endsWith('cover.jpg')).length,0)
    assert.equal(m.calls.filter(c=>c.path==='/search/repositories').length,0)
  }
})
