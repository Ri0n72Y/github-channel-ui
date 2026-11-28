import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
let vite,View,fixture,draftModule
before(async()=>{
  vite=await createServer({root,configFile:false,logLevel:'silent',
    plugins:[react()],server:{middlewareMode:true}})
  View=(await vite.ssrLoadModule('/plugins/topic-page/src/TopicPageView.tsx')).default
  fixture=(await vite.ssrLoadModule('/apps/playground/src/topic-fixture.ts'))
    .createTopicFixtureService
  draftModule=await vite.ssrLoadModule('/plugins/topic-page/src/topic-config-draft.ts')
})
after(async()=>await vite?.close())
const noop=()=>{}
const route={owner:'sample',repo:'repo'}
const signal=()=>new AbortController().signal
function render(snapshot,more={}){
  return renderToStaticMarkup(createElement(View,{
    owner:'sample',repo:'repo',snapshot,projects:[],loading:false,error:null,
    windowExhausted:false,report:{open:false,title:'',body:'',pending:false,
      checking:false,uncertain:false,message:'',url:''},
    writeEnabled:false,canReport:false,onRetry:noop,onOpenReport:noop,
    onCloseReport:noop,onConfirmUnknown:noop,onReportTitleChange:noop,
    onReportBodyChange:noop,onSubmitReport:noop,
    onDraftChange:noop,onConfigSave:noop,onConfirmConfigUnknown:noop,
    ...more,
  }))
}
test('#83 missing YAML is an editable draft, anonymous submit is Login-only',async()=>{
  const api=fixture(new URLSearchParams({topicCase:'config-missing'}))
  const snapshot=await api.getSnapshot(route,signal())
  assert.equal(snapshot.config,null)
  assert.equal(snapshot.configState,'missing')
  assert.equal(snapshot.configSha,null)
  const html=render(snapshot,{draft:'topic: labourchain\nwhitelist: true\n'})
  assert.match(html,/尚未初始化/)
  assert.match(html,/topics\.config\.yaml/)
  assert.match(html,/topic: labourchain/)
  assert.match(html,/登录 GitHub 后提交配置/)
  assert.doesNotMatch(html,/确认提交配置/)
  const logged=render(snapshot,{authenticated:true,
    draft:'topic: labourchain\nwhitelist: true\n'})
  assert.match(logged,/确认提交配置/)
  assert.match(logged,/textarea/)
})
test('#83 PR remains unmerged and uncertain writes require explicit confirmation',async()=>{
  const api=fixture(new URLSearchParams({topicCase:'config-pr',fixtureAuth:'1'}))
  const snapshot=await api.getSnapshot(route,signal())
  const result=await api.saveConfig(route,'topic: labourchain\nwhitelist: false\n',
    snapshot.headSha,snapshot.configSha,signal())
  assert.equal(result.state,'pending_pr')
  assert.equal(result.effective,false)
  const html=render(snapshot,{authenticated:true,result:undefined,configResult:result,
    configUncertain:false})
  assert.match(html,/合并前继续使用默认分支原配置/)
  assert.match(html,/https:\/\/github.com\/sample\/repo\/pull\/81/)
  const unknown=render(snapshot,{authenticated:true,configUncertain:true,
    configError:'提交结果未知'})
  assert.match(unknown,/我已在 GitHub 核查，允许再次提交/)
  assert.match(unknown,/disabled=""/)
  const denied=fixture(new URLSearchParams({topicCase:'config-denied',fixtureAuth:'1'}))
  await assert.rejects(denied.saveConfig(route,'topic: labourchain\n',
    snapshot.headSha,snapshot.configSha,signal()),{status:403})
  const uncertain=fixture(new URLSearchParams({topicCase:'config-unknown',fixtureAuth:'1'}))
  await assert.rejects(uncertain.saveConfig(route,'topic: labourchain\n',
    snapshot.headSha,snapshot.configSha,signal()),{outcomeUnknown:true})
})
test('Topic config version and draft reconciliation preserve the owned data invariants',()=>{
  const baseline={headSha:'a'.repeat(40),configSha:'b'.repeat(40)}
  assert.equal(draftModule.sameTopicConfigBase(baseline,{...baseline}),true)
  assert.equal(draftModule.sameTopicConfigBase(null,baseline),false)
  assert.equal(draftModule.sameTopicConfigBase(baseline,{...baseline,headSha:'c'.repeat(40)}),false)
  assert.equal(draftModule.sameTopicConfigBase(baseline,{...baseline,configSha:'d'.repeat(40)}),false)
  const edited='topic: custom-topic\nwhitelist: false\n'
  const remote='topic: labourchain\nwhitelist: true\n'
  assert.equal(draftModule.reconcileTopicDraft(edited,remote,true),edited)
  assert.equal(draftModule.reconcileTopicDraft(edited,null,true),edited)
  assert.equal(draftModule.reconcileTopicDraft(edited,remote,false),remote)
  assert.equal(draftModule.reconcileTopicDraft('',null,false),draftModule.NEW_TOPIC_DRAFT)
})

test('#83 browser source and complete Search page share requests across local slices and abort consumers',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=await fixture(new URLSearchParams()).getSnapshot(route,signal())
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
test('#83 B2 browser explicit refresh bypasses ordinary pending, coalesces and preserves consumer Abort',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=await fixture(new URLSearchParams()).getSnapshot(route,signal())
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
test('#83 B2 browser same-HEAD refresh isolates pending Search and rejects late old slices',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=await fixture(new URLSearchParams()).getSnapshot(route,signal())
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

test('#83 configured activity cover rendered as img, hostile URLs never become DOM attributes',async()=>{
  const sample=await fixture(new URLSearchParams()).getSnapshot(route,signal())
  const good='https://raw.githubusercontent.com/sample/repo/'+sample.headSha+'/poster.png'
  const html=render({...sample,coverUrl:good,config:{...sample.config,cover:good}})
  assert.match(html,/src="https:\/\/raw\.githubusercontent\.com\/sample\/repo\/[a-f0-9]+\/poster\.png"/)
  assert.match(html,/referrerPolicy="no-referrer"/i)
  for(const bad of ['javascript:alert(1)','data:image/svg+xml,<svg/onload=alert(1)>','https://evil.invalid/image.png']){
    const output=render({...sample,coverUrl:bad,config:{...sample.config,cover:bad}})
    assert.doesNotMatch(output,/<img[^>]*src=/i)
    assert.doesNotMatch(output,/<(?:script|iframe|object)\b/i)
  }
  assert.doesNotMatch(render({...sample,coverUrl:good}),/<img[^>]*src=/i)
})

test('#83 browser API revalidates configured cover and ignores standalone legacy URL',async()=>{
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const sample=await fixture(new URLSearchParams()).getSnapshot(route,signal())
  const cover='https://raw.githubusercontent.com/sample/repo/'+sample.headSha+'/poster.png'
  const apiFor=payload=>createTopicPageApi(async()=>Response.json(payload))
  assert.equal((await apiFor({...sample,coverUrl:cover}).getSnapshot(route,signal())).coverUrl,null)
  assert.equal((await apiFor({...sample,config:{...sample.config,cover}}).getSnapshot(route,signal())).coverUrl,cover)
  await assert.rejects(apiFor({...sample,config:{...sample.config,cover:'javascript:alert(1)'}})
    .getSnapshot(route,signal()),{status:502,stage:'config'})
})
test('#83 compact cards have one repository link, no empty media and truthful project identity',()=>{
  const project={id:1,full_name:'member/p1',name:'p1',owner:'member',description:'Readable project',
    html_url:'https://github.com/member/p1',language:'TypeScript',stargazers_count:1}
  const html=render(null,{projects:[project]})
  assert.equal((html.match(/href="https:\/\/github\.com\/member\/p1"/g)||[]).length,1)
  assert.match(html,/Readable project/)
  assert.match(html,/member\/p1/)
  assert.doesNotMatch(html,/暂无可用项目封面|data-cover-state=/)
  const pictured=render(null,{projects:[{...project,cover_url:'https://repository-images.githubusercontent.com/42/real.png'}]})
  assert.match(pictured,/data-cover-state="loading"/)
  assert.equal((pictured.match(/href="https:\/\/github\.com\/member\/p1"/g)||[]).length,1)
})

test('Topic project cards preserve complete description and accessible repository link',()=>{
  const project={id:1,full_name:'member/p1',name:'p1',owner:'member',
    html_url:'https://github.com/member/p1',language:'TypeScript',stargazers_count:1}
  for(const description of ['Short','中文项目简介自然换行'.repeat(30),'UnbrokenEnglishWord'.repeat(30)]){
    for(const cover of [undefined,'https://repository-images.githubusercontent.com/42/real.png']){
      const html=render(null,{projects:[{...project,description,cover_url:cover}]})
      assert.ok(html.includes('title="'+description+'"'))
      assert.ok(html.includes('aria-label="member/p1 — '+description+' — 打开 GitHub"'))
      assert.ok(html.includes('>'+description+'</p>'))
      assert.equal((html.match(/href="https:\/\/github\.com\/member\/p1"/g)||[]).length,1)
    }
  }
  assert.match(render(null,{projects:[{...project,description:''}]}),/暂无项目简介/)
})
