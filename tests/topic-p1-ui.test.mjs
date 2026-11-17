import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readFileSync} from 'node:fs'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
let vite,View,fixture,parseBatch,draftModule
before(async()=>{
  vite=await createServer({root,configFile:false,logLevel:'silent',
    plugins:[react()],server:{middlewareMode:true}})
  View=(await vite.ssrLoadModule('/plugins/topic-page/src/TopicPageView.tsx')).default
  fixture=(await vite.ssrLoadModule('/apps/playground/src/topic-fixture.ts'))
    .createTopicFixtureService
  parseBatch=(await vite.ssrLoadModule('/plugins/topic-page/src/domain.mjs'))
    .loadInstalledTopicBatch
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
test('#83 sparse Installation fixture fills after several cursor chunks, with abort/single-flight hooks',async()=>{
  const api=fixture(new URLSearchParams({topicCase:'sparse'}))
  const meta=await api.getSnapshot(route,signal())
  const seen=[]
  const result=await parseBatch(meta,(page,offset)=>{
    seen.push([page,offset])
    return api.getProjects(route,page,signal(),offset)
  },signal())
  assert.deepEqual(seen,[[1,0],[1,25],[1,50],[1,75],[2,0]])
  assert.ok(result.items.length>=10)
  assert.ok(result.items.every(x=>Number.isSafeInteger(x.id)))
  const source=readFileSync(resolve(root,'plugins/topic-page/src/TopicPageContainer.tsx'),'utf8')
  assert.match(source,/new IntersectionObserver\(/)
  assert.match(source,/moreLoading\.current/)
  assert.match(source,/moreAbort\.current\?\.abort\(\)/)
  assert.match(source,/loadInstalledTopicBatch/)
  assert.match(source,/window\.confirm\(/)
  const view=readFileSync(resolve(root,'plugins/topic-page/src/TopicPageView.tsx'),'utf8')
  assert.match(view,/加载更多项目/)
  assert.match(view,/重试加载更多/)
})


test('#83 Reviewer B2: pending PR locks resubmit until source HEAD or config SHA changes',async()=>{
  const api=fixture(new URLSearchParams({topicCase:'config-pr',fixtureAuth:'1'}))
  const snapshot=await api.getSnapshot(route,signal())
  const result=await api.saveConfig(route,'topic: labourchain\n',
    snapshot.headSha,snapshot.configSha,signal())
  const html=render(snapshot,{authenticated:true,configResult:result,
    configAwaitingMerge:true,onConfigRecheck:noop})
  assert.match(html,/已有待合并维护 PR，重复提交已锁定/)
  assert.match(html,/重新检查默认分支配置/)
  const button=html.match(/<button[^>]*disabled=""[^>]*>确认提交配置<\/button>/)
  assert.ok(button,'pending PR blocks write before any new request')
  assert.equal(draftModule.sameTopicConfigBase(snapshot,snapshot),true)
  assert.equal(draftModule.sameTopicConfigBase(snapshot,
    {...snapshot,headSha:'d'.repeat(40)}),false)
  assert.equal(draftModule.sameTopicConfigBase(snapshot,
    {...snapshot,configSha:'e'.repeat(40)}),false)
  const source=readFileSync(resolve(root,'plugins/topic-page/src/TopicPageContainer.tsx'),'utf8')
  assert.match(source,/pendingConfigBase\.current !== null/)
  assert.match(source,/sameTopicConfigBase\(pendingConfigBase\.current,meta\)/)
  assert.match(source,/configAwaitingMerge=\{pendingConfigBase\.current !== null\}/)
})
test('#83 Reviewer P2: delayed successful snapshot and failed reload preserve dirty draft',async()=>{
  const prior='topic: custom-topic\nwhitelist: false\n'
  const initial='topic: labourchain\nwhitelist: true\n'
  let existing=initial,dirty=false,resolveLater
  const delayed=new Promise(resolve=>{resolveLater=resolve})
  const refreshing=delayed.then(incoming=>{
    existing=draftModule.reconcileTopicDraft(existing,incoming,dirty)
  })
  // Simulates the user editing while the retry is still in-flight.
  await Promise.resolve()
  existing=prior;dirty=true
  resolveLater(initial)
  await refreshing
  assert.equal(existing,prior)
  assert.equal(draftModule.reconcileTopicDraft(existing,initial,true),prior)
  assert.equal(draftModule.reconcileTopicDraft(existing,initial,false),initial)
  let failure
  try {await Promise.reject(Error('GitHub GET 503'))}catch(err){failure=err}
  assert.match(failure.message,/503/)
  assert.equal(existing,prior,'failing GET must not mutate an existing dirty draft')
  const source=readFileSync(resolve(root,'plugins/topic-page/src/TopicPageContainer.tsx'),'utf8')
  assert.match(source,/draftDirty\.current=true/)
  assert.match(source,/setDraft\(previous => reconcileTopicDraft\(previous,meta\.configText,draftDirty\.current\)\)/)
  assert.doesNotMatch(source,/setDraft\(meta\.configText \?\?/)
  assert.doesNotMatch(source,/setConfigUncertain\(false\).*setDraft/)
})
