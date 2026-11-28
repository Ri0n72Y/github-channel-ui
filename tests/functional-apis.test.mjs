import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const root=resolve(import.meta.dirname,'..')
let vite,services
before(async()=>{
  vite=await createServer({root,configFile:false,logLevel:'silent',
    plugins:[react()],server:{middlewareMode:true}})
  const paths=['repo-home','repo-config','issue-detail','channel','topic-page']
  services=Object.fromEntries(await Promise.all(paths.map(async name=>
    [name,await vite.ssrLoadModule('/plugins/'+name+'/src/service.ts')])))
})
after(async()=>{await vite?.close()})
const signal=()=>new AbortController().signal
function mockReplies(table){
  const calls=[]
  async function request(url,init={}){
    assert.equal(this,undefined,'request function must have no Service instance receiver')
    assert.equal(init.credentials,'same-origin')
    assert.equal(init.cache,'no-store')
    assert.ok(init.signal instanceof AbortSignal)
    const key=(init.method||'GET')+' '+String(url).split('?')[0]
    calls.push({key,url:String(url),init})
    const reply=table[key]
    if(!reply)throw Error('Unexpected '+key)
    return Response.json(reply.value,{status:reply.status||200,headers:reply.headers||{}})
  }
  return {request,calls}
}
test('#77 all five module APIs are frozen stable ordinary objects without HTTP Classes',()=>{
  const entries=[
    ['repo-home','createRepoHomeApi','repoHomeApi'],
    ['repo-config','createRepoConfigApi','repoConfigApi'],
    ['issue-detail','createIssueDetailApi','issueDetailApi'],
    ['channel','createChannelApi','channelApi'],
    ['topic-page','createTopicPageApi','topicPageApi'],
  ]
  for(const [name,factory,staticName]of entries){
    const module=services[name]
    const api=module[factory](async()=>Response.json({}))
    assert.equal(typeof api,'object')
    assert.ok(Object.isFrozen(api))
    assert.ok(Object.isFrozen(module[staticName]))
    for(const fn of Object.values(api)) if(typeof fn==='function'){
      assert.equal(Object.hasOwn(fn,'fetcher'),false)
    }
    assert.equal(module[classNames[name]],undefined,
      'old HTTP Service Class must be removed')
  }
})
const classNames={'repo-home':'RepoHomeService','repo-config':'RepoConfigService',
  'issue-detail':'IssueDetailService','channel':'ChannelService','topic-page':'TopicPageService'}
test('#76 Repo Home, Feed, capability and member write use receiver-safe factory functions',async()=>{
  const home={repository:{full_name:'sample/repo',name:'repo',description:null,
    html_url:'https://github.com/sample/repo',default_branch:'main'},
    branch:'main',readme:{state:'ready',content:'# Repo',path:'README.md'},
    team:{state:'missing',members:[]}}
  const {request,calls}=mockReplies({
    'GET /api/repo-home':{value:home},
    'GET /api/repo-feed':{value:{page:1,items:[],hasMore:false}},
    'GET /api/repo-member-permission':{value:{user:{id:7,login:'sample'},
      branch:'main',protected:false,mode:'commit'}},
    'POST /api/repo-member-register':{value:{status:'committed',
      url:'https://github.com/sample/repo/commit/abc',sha:'abc',requestedBy:'sample'}},
  })
  const api=services['repo-home'].createRepoHomeApi(request)
  assert.equal((await api.getHome('sample','repo','main',signal())).team.state,'missing')
  assert.deepEqual((await api.getFeed('sample','repo',1,signal())).items,[])
  assert.equal((await api.getCapability('sample','repo','main',signal())).user.login,'sample')
  const member={name:'A',links:[{label:'GitHub',url:'https://github.com'}]}
  const before=JSON.stringify(member)
  assert.equal((await api.register('sample','repo','main',member,signal())).status,'committed')
  assert.equal(JSON.stringify(member),before)
  assert.deepEqual(calls.map(c=>c.key),[
    'GET /api/repo-home','GET /api/repo-feed',
    'GET /api/repo-member-permission','POST /api/repo-member-register'])
  assert.equal(calls.at(-1).init.headers['X-LabourChain-Write'],'1')
})
test('#77 Config, Issue, Channel and Topic preserve read models and explicit OAuth writes',async()=>{
  const config=mockReplies({
    'GET /api/repo-config':{value:{state:'config_missing',branch:'main',
      headSha:'a'.repeat(40),fileSha:null,configText:null,
      config:{state:'config_missing',defaultPreview:'namespaces: {}'},
      capability:{state:'unauthenticated',canSaveConfig:false}}},
    'POST /api/repo-config':{value:{state:'ready',noChanges:true,
      createdLabels:[],removedAssociations:0}},
  })
  const api=services['repo-config'].createRepoConfigApi(config.request)
  const snapshot=await api.get('sample','repo',signal())
  assert.equal(snapshot.state,'config_missing')
  assert.equal(snapshot.capability.canSaveConfig,false)
  await api.save('sample','repo','namespaces: {}','a'.repeat(40),null,signal())
  await api.sync('sample','repo','c'.repeat(64),false,signal())
  assert.equal(config.calls.filter(c=>c.key.startsWith('POST')).length,2)
  const issue=mockReplies({
    'GET /api/issue-detail':{value:{number:2,title:'Title',body:null,
      state:'open',html_url:'https://github.com/sample/repo/issues/2',labels:[],comments:0}},
    'GET /api/issue-comments':{value:[],headers:{Link:'<https://github.com/x>; rel="next"'}},
    'GET /api/issue-config':{value:{encoding:'base64',content:'eA=='}},
    'GET /api/github-session':{value:{authenticated:false}},
    'GET /api/github-verify':{value:{user:{id:7,login:'sample'},
      repository:{full_name:'sample/repo',accessible:true,permissions:null}}},
    'POST /api/github-issue-comment':{value:{comment:{id:1,body:'A',
      html_url:'https://github.com/sample/repo/issues/2#issuecomment-1',
      created_at:'2026-11-15T00:00:00Z'}}},
  })
  const issues=services['issue-detail'].createIssueDetailApi(issue.request)
  assert.equal((await issues.getIssue('sample','repo',2,signal())).number,2)
  assert.equal((await issues.getComments('sample','repo',2,1,signal())).hasMore,true)
  assert.equal(await issues.getConfig('sample','repo',signal()),'x')
  assert.equal(await issues.getSession(signal()),false)
  assert.equal((await issues.verify('sample','repo',signal())).user.login,'sample')
  assert.equal((await issues.postComment('sample','repo',2,'A',signal())).id,1)
  assert.equal(issue.calls.at(-1).init.headers['X-LabourChain-Write'],'1')
  const channel=mockReplies({
    'GET /api/repo-channels':{value:{state:'config_missing',branch:'main',channels:[]}},
  })
  assert.equal((await services.channel.createChannelApi(channel.request)
    .getChannels('sample','repo',signal())).state,'config_missing')
  const topic=mockReplies({
    'GET /api/topic-page':{value:{repository:{owner:'sample',name:'repo',
      full_name:'sample/repo',html_url:'https://github.com/sample/repo'},
      readme:'abc',coverUrl:null,config:{topic:'sample',whitelist:false},
      configState:'ready',configText:'topic: sample',configSha:'a'.repeat(40),
      headSha:'b'.repeat(40),defaultBranch:'main',
      allowedRepositories:[]}},
    'GET /api/topic-projects':{value:{page:1,offset:0,perPage:100,totalCount:0,
      hasNext:false,nextPage:null,nextOffset:null,windowExhausted:false,items:[]}},
    'GET /api/github-session':{value:{authenticated:false}},
    'GET /api/topic-report':{value:{state:'ready',proof:'fake-proof'}},
    'POST /api/topic-report':{status:201,value:{state:'created',
      issue:{number:2,html_url:'https://github.com/sample/repo/issues/2'}}},
  })
  const topics=services['topic-page'].createTopicPageApi(topic.request)
  const route={owner:'sample',repo:'repo'}
  const topicSnapshot=await topics.getSnapshot(route,signal())
  assert.equal(topicSnapshot.config.whitelist,false)
  assert.deepEqual((await topics.getProjects(route,1,signal(),0,topicSnapshot.headSha)).items,[])
  assert.equal(await topics.getSession(signal()),false)
  assert.equal(await topics.getReportTarget(route,signal()),'fake-proof')
  assert.equal(await topics.submitReport(route,{title:'T',body:'B'},'fake-proof',signal()),
    'https://github.com/sample/repo/issues/2')
  assert.equal(topic.calls.at(-1).init.headers['X-LabourChain-Write'],'1')
})
test('#77 invalid unknown response cannot masquerade as a complete domain object',async()=>{
  for(const [name,method,args,key]of [
    ['repo-home','getHome',['a','b','main',signal()],'GET /api/repo-home'],
    ['repo-config','get',['a','b',signal()],'GET /api/repo-config'],
    ['issue-detail','getIssue',['a','b',2,signal()],'GET /api/issue-detail'],
    ['channel','getChannels',['a','b',signal()],'GET /api/repo-channels'],
    ['topic-page','getSnapshot',[{owner:'a',repo:'b'},signal()],'GET /api/topic-page'],
  ]){
    const factory=Object.keys(services[name]).find(k=>/^create.*Api$/.test(k))
    const api=services[name][factory](mockReplies({[key]:{value:{data:'untrusted'}}}).request)
    await assert.rejects(api[method](...args),Error,name)
  }
})
test('#76 default HTTP request calls global fetch with its native receiver',async()=>{
  const module=await vite.ssrLoadModule('/plugins/shared/src/browser-http.ts')
  const real=globalThis.fetch
  const seen=[]
  globalThis.fetch=async function(input,init){
    assert.equal(this,globalThis,'global native fetch receiver must be preserved')
    seen.push({input,init})
    return Response.json({authenticated:false})
  }
  try{
    const data=await module.readResponse(module.browserRequest,
      '/api/github-session',signal())
    assert.deepEqual(data.body,{authenticated:false})
    assert.equal(seen.length,1)
    assert.equal(seen[0].init.credentials,'same-origin')
  }finally{globalThis.fetch=real}
})


test('#77 Config write boundary rejects malformed partial results before React',async()=>{
  const failures=[
    {failed:[null]},
    {failed:[{kind:{},error:'x'}]},
    {failed:[{kind:'create_label',error:{code:'bad'}}]},
    {failed:[{kind:'remove_label',error:'x',retryAfter:{seconds:5}}]},
    {removedAssociations:[null]},
    {removedAssociations:[{number:2,label:{value:'bug'}}]},
    {removedAssociations:{number:2,label:'bug'}},
    {pending:[null]},
    {pending:[{number:2,labels:['bug',null]}]},
    {pending:{unvalidated:true}},
    {createdLabels:['good',{name:'bad'}]},
    {requiresRefresh:'yes'},
    {retryAfter:{seconds:2}},
  ]
  for(const field of failures){
    const payload={state:'partial_failure',...field}
    const api=services['repo-config'].createRepoConfigApi(
      async()=>Response.json(payload))
    await assert.rejects(api.sync('sample','repo','proof',false,signal()),
      error=>error instanceof Error && 'status' in error && error.status===502,
      JSON.stringify(field))
  }
})
test('#77 valid Config partial writes project nested fields without forwarding unknown JSON',async()=>{
  const payload={state:'partial_failure',error:'Some labels could not sync',
    createdLabels:['new-label'],
    removedAssociations:[{number:2,label:'old-label'}],
    failed:[{kind:'remove_issue_label',error:'rate limited',number:2,
      label:'old-label',stage:'remove',retryAfter:'60',extra:{secret:'hidden'}}],
    pending:[{number:2,labels:['old-label']}],
    retryAfter:null,requiresRefresh:true,
    noChanges:false,reconciled:false,unsupported:{token:'secret'}}
  const before=JSON.stringify(payload)
  const api=services['repo-config'].createRepoConfigApi(async()=>Response.json(payload))
  const result=await api.sync('sample','repo','proof',false,signal())
  assert.deepEqual(result,{
    state:'partial_failure',error:'Some labels could not sync',
    createdLabels:['new-label'],
    removedAssociations:[{number:2,label:'old-label'}],
    failed:[{kind:'remove_issue_label',error:'rate limited',number:2,
      label:'old-label',stage:'remove',retryAfter:'60'}],
    pending:[{number:2,labels:['old-label']}],retryAfter:null,
    requiresRefresh:true,noChanges:false,reconciled:false,
  })
  assert.equal(JSON.stringify(payload),before,'the input business snapshot is immutable')
  assert.notStrictEqual(result.failed,payload.failed)
  assert.notStrictEqual(result.removedAssociations,payload.removedAssociations)
  const {createElement}=await import('react')
  const {renderToStaticMarkup}=await import('react-dom/server')
  const {MemoryRouter}=await import('react-router')
  const ConfigView=(await vite.ssrLoadModule(
    '/plugins/repo-config/src/ConfigView.tsx')).default
  const noop=()=>{}
  const html=renderToStaticMarkup(createElement(MemoryRouter,
    {initialEntries:['/sample/repo/config']},createElement(ConfigView,{
    owner:'sample',repo:'repo',base:'/sample/repo',login:'/api/github-login',
    snapshot:null,content:'',loading:false,busy:false,error:'',result,
    confirmRemovals:false,validationState:'ready',editorEnabled:false,
    canSave:false,canSync:false,dirty:false,onRefresh:noop,
    onContentChange:noop,onConfirmRemovalsChange:noop,onSave:noop,onSync:noop,
  })))
  assert.match(html,/remove_issue_label/)
  assert.match(html,/rate limited/)
  assert.match(html,/Retry-After 60/)
  assert.doesNotMatch(html,/secret/)
})


test('#77 Issue domain projects only validated fields and creates fresh nested snapshots',async()=>{
  const issue={number:2,title:'Issue',body:'Content',state:'open',comments:1,
    html_url:'https://github.com/sample/repo/issues/2',
    labels:[{name:'work',secret:'hidden'}],user:{login:'sample',token:'secret'},
    created_at:'2026-11-15T00:00:00Z',unknown:{secret:'hidden'}}
  const comment={id:3,body:'Feedback',created_at:'2026-11-15T00:01:00Z',
    html_url:'https://github.com/sample/repo/issues/2#issuecomment-3',
    user:{login:'reviewer',token:'secret'},untrusted:{secret:'hidden'}}
  const mock=mockReplies({
    'GET /api/issue-detail':{value:issue},
    'GET /api/issue-comments':{value:[comment]},
  })
  const api=services['issue-detail'].createIssueDetailApi(mock.request)
  const result=await api.getIssue('sample','repo',2,signal())
  assert.deepEqual(result,{
    number:2,title:'Issue',body:'Content',state:'open',comments:1,
    html_url:'https://github.com/sample/repo/issues/2',
    labels:[{name:'work'}],user:{login:'sample'},
    created_at:'2026-11-15T00:00:00Z',
  })
  const comments=await api.getComments('sample','repo',2,1,signal())
  assert.deepEqual(comments.items,[{
    id:3,body:'Feedback',created_at:'2026-11-15T00:01:00Z',
    html_url:'https://github.com/sample/repo/issues/2#issuecomment-3',
    user:{login:'reviewer'},
  }])
  assert.doesNotMatch(JSON.stringify({result,comments}),/secret/)
})
test('#77 malformed nested Github Issue or comment metadata fails at API boundary',async()=>{
  const good={number:2,title:'Issue',body:null,state:'open',
    html_url:'https://github.com/sample/repo/issues/2',labels:[],comments:0}
  for(const bad of [
    {...good,labels:[null]},
    {...good,labels:[{name:{code:500}}]},
    {...good,user:{login:{name:'bad'}}},
    {...good,locked:{yes:true}},
    {...good,closed_at:123},
  ]){
    const api=services['issue-detail'].createIssueDetailApi(
      mockReplies({'GET /api/issue-detail':{value:bad}}).request)
    await assert.rejects(api.getIssue('sample','repo',2,signal()),
      error=>error instanceof Error&&'status' in error&&error.status===502)
  }
})
