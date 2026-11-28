import test from 'node:test'
import assert from 'node:assert/strict'
import {createTopicReadCache} from '../plugins/topic-page/src/topic-read-cache.mjs'
function deferred(){
  let resolve,reject
  const promise=new Promise((a,b)=>{resolve=a;reject=b})
  return {promise,resolve,reject}
}
test('ordinary reads coalesce and the cache reloads exactly at expiry',async()=>{
  let now=10,loads=0
  const cache=createTopicReadCache({ttl:100,limit:3,now:()=>now})
  const pending=deferred()
  const load=()=>{loads++;return pending.promise}
  const first=cache.get('repo/source',load)
  const joined=cache.get('repo/source',load)
  pending.resolve('first version')
  assert.deepEqual(await Promise.all([first,joined]),['first version','first version'])
  assert.equal(loads,1)
  now=109
  assert.equal(await cache.get('repo/source',()=>{loads++;return 'second version'}),'first version')
  assert.equal(loads,1)
  now=110
  assert.equal(await cache.get('repo/source',()=>{loads++;return 'second version'}),'second version')
  assert.equal(loads,2)
})
test('refresh supersedes pending ordinary reads, joins concurrent refresh and invalidates dependent pages once',async()=>{
  const cache=createTopicReadCache({ttl:100,limit:4,now:()=>0})
  await cache.get('repo/page/1',()=>['old page'])
  const old=deferred(),fresh=deferred(),loads=[]
  const ordinary=cache.get('repo/source',()=>{loads.push('old');return old.promise})
  let replacements=0
  const replace=()=>{replacements++;cache.invalidate('repo/page/')}
  const refresh=cache.get('repo/source',()=>{loads.push('fresh');return fresh.promise},true,replace)
  const joined=cache.get('repo/source',()=>{loads.push('duplicate');return 'wrong'},true,replace)
  const reader=cache.get('repo/source',()=>{loads.push('ordinary');return 'wrong'})
  assert.equal(cache.peek('repo/page/1'),undefined)
  fresh.resolve('new source')
  assert.deepEqual(await Promise.all([refresh,joined,reader]),['new source','new source','new source'])
  old.resolve('old source')
  assert.equal(await ordinary,'old source')
  assert.equal(cache.peek('repo/source'),'new source')
  assert.deepEqual(loads,['old','fresh'])
  assert.equal(replacements,1)
})
test('failed refresh cannot resurrect a superseded successful response and a subsequent read can recover',async()=>{
  const cache=createTopicReadCache({ttl:100,limit:3,now:()=>0})
  const old=deferred(),fresh=deferred()
  const ordinary=cache.get('repo/source',()=>old.promise)
  const refresh=cache.get('repo/source',()=>fresh.promise,true)
  fresh.reject(Error('upstream failed'))
  await assert.rejects(refresh,/upstream failed/)
  old.resolve('obsolete')
  assert.equal(await ordinary,'obsolete')
  assert.equal(cache.has('repo/source'),false)
  assert.equal(await cache.get('repo/source',()=> 'recovered'),'recovered')
  assert.equal(cache.peek('repo/source'),'recovered')
})
test('invalidated in-flight reads do not reenter the cache and still consume bounded pending capacity',async()=>{
  const cache=createTopicReadCache({ttl:100,limit:1,now:()=>0})
  const old=deferred()
  const reading=cache.get('repo/a',()=>old.promise)
  cache.invalidate('repo/')
  assert.equal(cache.has('repo/a'),false)
  let attempts=0
  await assert.rejects(cache.get('repo/b',()=>{attempts++;return 'new'}),{status:503,stage:'source'})
  assert.equal(attempts,0)
  old.resolve('obsolete')
  assert.equal(await reading,'obsolete')
  assert.equal(cache.has('repo/a'),false)
  assert.equal(await cache.get('repo/b',()=>{attempts++;return 'new'}),'new')
  assert.equal(attempts,1)
})
