import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
let vite
before(async()=>{
  vite=await createServer({root,configFile:false,logLevel:'silent',
    plugins:[react()],server:{middlewareMode:true}})
})
after(async()=>await vite?.close())
const route={owner:'sample',repo:'repo'}
const signal=()=>new AbortController().signal
const sourceSnapshot=()=>({repository:{owner:'sample',name:'repo',full_name:'sample/repo',
  html_url:'https://github.com/sample/repo'},readme:'# Activity',coverUrl:null,
  config:{topic:'labourchain',whitelist:true},configState:'ready',
  configText:'topic: labourchain\nwhitelist: true\n',headSha:'a'.repeat(40),
  configSha:'b'.repeat(40),defaultBranch:'main',allowedRepositories:[]})
test('browser source and complete Search page share requests across local slices and abort consumers',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=sourceSnapshot()
  const calls=[]
  const api=createTopicPageApi(async(url)=>{
    const u=new URL(url,'https://local.test');calls.push(u)
    await new Promise(resolve=>setTimeout(resolve,5))
    if(u.pathname==='/api/topic-page')return Response.json(sample)
    return Response.json({page:1,offset:0,perPage:100,totalCount:60,hasNext:false,
      nextPage:null,nextOffset:null,windowExhausted:false,
      items:Array.from({length:60},(_,i)=>({id:i+1,full_name:'member/p'+i,name:'p'+i,owner:'member',
        description:'',html_url:'https://github.com/member/p'+i,stargazers_count:0,language:null}))})
  })
  const controller=new AbortController()
  const first=api.getSnapshot(route,controller.signal)
  const second=api.getSnapshot(route,signal())
  controller.abort()
  await assert.rejects(first,{name:'AbortError'})
  const snapshot=await second
  assert.equal(calls.length,1)
  const slices=await Promise.all([0,25,50].map(offset=>api.getProjects(route,1,signal(),offset,snapshot.headSha)))
  assert.deepEqual(slices.map(p=>p.items.length),[25,25,10])
  assert.deepEqual(slices.map(p=>p.nextOffset),[25,50,null])
  assert.equal(calls.length,2)
  assert.equal(calls[1].searchParams.get('head'),snapshot.headSha)
  assert.equal(calls[1].searchParams.get('offset'),'0')
  await api.getSnapshot(route,signal(),true)
  await assert.rejects(api.getProjects(route,1,signal(),25,snapshot.headSha),
    {status:409,stage:'snapshot'})
  await api.getProjects(route,1,signal(),0,snapshot.headSha)
  assert.equal(calls.length,4)
  assert.equal(calls[2].searchParams.get('refresh'),'1')
})

function refreshGate(){
  let resolve
  const promise=new Promise(a=>{resolve=a})
  return {promise,resolve}
}
test('B2 browser explicit refresh bypasses ordinary pending, coalesces and preserves consumer Abort',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=sourceSnapshot()
  const fresh={...sample,headSha:'e'.repeat(40)}
  const oldStarted=refreshGate(),oldGate=refreshGate(),newStarted=refreshGate(),newGate=refreshGate()
  const calls=[]
  const api=createTopicPageApi(async(url)=>{
    const u=new URL(url,'https://local.test');calls.push(u)
    if(u.searchParams.get('refresh')==='1'){
      newStarted.resolve();await newGate.promise;return Response.json(fresh)
    }
    oldStarted.resolve();await oldGate.promise;return Response.json(sample)
  })
  const old=api.getSnapshot(route,signal())
  await oldStarted.promise
  const abandoned=new AbortController()
  const refresh=api.getSnapshot(route,abandoned.signal,true)
  await newStarted.promise
  const joined=api.getSnapshot(route,signal(),true)
  const ordinary=api.getSnapshot(route,signal())
  abandoned.abort()
  await assert.rejects(refresh,{name:'AbortError'})
  newGate.resolve()
  for(const snapshot of await Promise.all([joined,ordinary]))assert.equal(snapshot.headSha,fresh.headSha)
  oldGate.resolve()
  assert.equal((await old).headSha,sample.headSha)
  assert.equal((await api.getSnapshot(route,signal())).headSha,fresh.headSha)
  assert.equal(calls.length,2)
  assert.deepEqual(calls.map(u=>u.searchParams.get('refresh')),[null,'1'])
})
test('B2 browser same-HEAD refresh isolates pending Search and rejects late old slices',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=sourceSnapshot()
  const oldStarted=refreshGate(),oldGate=refreshGate(),newStarted=refreshGate(),newGate=refreshGate()
  let sourceReads=0,searchReads=0
  const api=createTopicPageApi(async(url)=>{
    const u=new URL(url,'https://local.test')
    if(u.pathname==='/api/topic-page'){sourceReads++;return Response.json(sample)}
    const number=++searchReads
    if(number===1){oldStarted.resolve();await oldGate.promise}
    if(number===2){newStarted.resolve();await newGate.promise}
    return Response.json({page:1,offset:0,perPage:100,totalCount:30,hasNext:false,
      nextPage:null,nextOffset:null,windowExhausted:false,
      items:Array.from({length:30},(_,i)=>({id:number*100+i,full_name:'member/p'+i,name:'p'+i,owner:'member',
        description:'',html_url:'https://github.com/member/p'+i,stargazers_count:0,language:null}))})
  })
  const snapshot=await api.getSnapshot(route,signal())
  const old=api.getProjects(route,1,signal(),0,snapshot.headSha)
  const rejected=assert.rejects(old,{status:409,stage:'snapshot'})
  await oldStarted.promise
  await api.getSnapshot(route,signal(),true)
  const fresh=api.getProjects(route,1,signal(),0,snapshot.headSha)
  await newStarted.promise
  const joined=api.getProjects(route,1,signal(),25,snapshot.headSha)
  newGate.resolve()
  const [a,b]=await Promise.all([fresh,joined])
  assert.equal(a.items[0].id,200);assert.equal(b.items[0].id,225)
  oldGate.resolve();await rejected
  assert.equal((await api.getProjects(route,1,signal(),0,snapshot.headSha)).items[0].id,200)
  assert.equal(sourceReads,2);assert.equal(searchReads,2)
})

test('browser API revalidates configured cover and ignores standalone legacy URL',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=sourceSnapshot()
  const cover='https://raw.githubusercontent.com/sample/repo/'+sample.headSha+'/poster.png'
  const apiFor=payload=>createTopicPageApi(async()=>Response.json(payload))
  assert.equal((await apiFor({...sample,coverUrl:cover}).getSnapshot(route,signal())).coverUrl,null)
  assert.equal((await apiFor({...sample,config:{...sample.config,cover}}).getSnapshot(route,signal())).coverUrl,cover)
  await assert.rejects(apiFor({...sample,config:{...sample.config,cover:'javascript:alert(1)'}})
    .getSnapshot(route,signal()),{status:502,stage:'config'})
})
