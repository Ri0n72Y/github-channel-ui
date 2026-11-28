import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'
let vite,transport,repo,config,issue,channel
before(async()=>{
  vite=await createServer({root:resolve(import.meta.dirname,'..'),configFile:false,logLevel:'silent',
    plugins:[react()],server:{middlewareMode:true}})
  transport=await vite.ssrLoadModule('/plugins/shared/src/browser-http.ts')
  repo=(await vite.ssrLoadModule('/plugins/repo-home/src/service.ts')).createRepoHomeApi
  config=(await vite.ssrLoadModule('/plugins/repo-config/src/service.ts')).createRepoConfigApi
  issue=(await vite.ssrLoadModule('/plugins/issue-detail/src/service.ts')).createIssueDetailApi
  channel=(await vite.ssrLoadModule('/plugins/channel/src/service.ts')).createChannelApi
})
after(async()=>await vite?.close())

// Record the real wire request without asserting inside the production error boundary.
function exchange(replies){
  const calls=[]
  async function request(address,init={}){
    const url=new URL(address,'https://local.test')
    calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:init.method||'GET',
      credentials:init.credentials,cache:init.cache,signal:init.signal,receiver:this,
      write:init.headers?.['X-LabourChain-Write'],body:init.body?JSON.parse(init.body):undefined})
    const reply=replies[calls.length-1]
    if(!reply)throw Error('Unexpected browser request')
    return reply()
  }
  function check(expected,signal){
    assert.deepEqual(calls.map(({path,query,method,write,body})=>({path,query,method,write,body})),
      expected.map(({path,query={},method='GET',write,body})=>({path,query,method,write,body})))
    for(const call of calls){
      assert.equal(call.signal,signal)
      assert.equal(call.credentials,'same-origin')
      assert.equal(call.cache,'no-store')
      assert.equal(call.receiver,undefined)
    }
  }
  return {request,check,calls}
}
const json=(value,status=200,headers={})=>()=>Response.json(value,{status,headers})
const target={owner:'collective',repo:'ledger'}
const head='a'.repeat(40),file='b'.repeat(40)
const yaml='namespaces:\n  status: [todo]\n'
const githubIssue={number:8,title:'Review ledger',body:'Records',state:'open',
  html_url:'https://github.com/collective/ledger/issues/8',labels:[{name:'status:todo'}],comments:1,
  user:{login:'mira'},created_at:'2026-09-18T09:00:00Z'}
const comment={id:21,body:'Confirmed',html_url:'https://github.com/collective/ledger/issues/8#issuecomment-21',
  created_at:'2026-09-18T09:01:00Z',user:{login:'ren'}}

test('repository reads keep the display branch and filters separate from the exact member write target',async()=>{
  const snapshot={repository:{full_name:'collective/ledger',name:'ledger',description:null,
    html_url:'https://github.com/collective/ledger',default_branch:'main'},branch:'feature/docs',
    readme:{state:'ready',content:'# Ledger',path:'README.md'},team:{state:'missing',members:[]}}
  const feed={page:2,items:[{id:81,number:8,state:'open',title:'Review ledger',body:'Records',
    html_url:githubIssue.html_url,updated_at:'2026-09-18T10:00:00Z',user:{login:'mira'}}],hasMore:true}
  const capability={user:{id:19,login:'mira'},branch:'main',protected:true,mode:'pr'}
  const committed={status:'pending_pr',url:'https://github.com/collective/ledger/pull/17',sha:head,requestedBy:'mira'}
  const network=exchange([json(snapshot),json(feed),json(capability),json(committed)])
  const {getHome,getFeed,getCapability,register}=repo(network.request)
  const signal=new AbortController().signal
  assert.deepEqual(await getHome(target.owner,target.repo,'feature/docs',signal),snapshot)
  assert.deepEqual(await getFeed(target.owner,target.repo,2,signal,['status:todo','channel:review']),feed)
  assert.deepEqual(await getCapability(target.owner,target.repo,'main',signal),capability)
  const member={name:'Ren',links:[{label:'Profile',url:'https://example.org/ren'}]}
  assert.deepEqual(await register(target.owner,target.repo,'main',member,signal),committed)
  network.check([
    {path:'/api/repo-home',query:{...target,branch:'feature/docs'}},
    {path:'/api/repo-feed',query:{...target,page:'2',labels:'status:todo,channel:review'}},
    {path:'/api/repo-member-permission',query:{...target,branch:'main'}},
    {path:'/api/repo-member-register',method:'POST',write:'1',body:{...target,branch:'main',
      member:{name:'Ren',links:[{label:'Profile',url:'https://example.org/ren'}]}}},
  ],signal)
})

test('Config Save and Label Sync use different confirmation and revision fields and never dispatch to a display branch',async()=>{
  const snapshot={state:'config_missing',branch:'main',headSha:head,fileSha:null,configText:null,
    config:{state:'config_missing',defaultPreview:yaml},capability:{state:'unauthenticated',canSaveConfig:false}}
  const saved={state:'sync_pending',commitSha:'d'.repeat(40),fileSha:'e'.repeat(40)}
  const synced={state:'ready',createdLabels:['status:todo'],removedAssociations:0}
  const network=exchange([json(snapshot),json(saved),json(synced)])
  const api=config(network.request),signal=new AbortController().signal
  assert.deepEqual(await api.get(target.owner,target.repo,signal),snapshot)
  assert.deepEqual(await api.save(target.owner,target.repo,yaml,head,null,signal),saved)
  assert.deepEqual(await api.sync(target.owner,target.repo,'c'.repeat(64),true,signal),synced)
  network.check([{path:'/api/repo-config',query:target},
    {path:'/api/repo-config',method:'POST',write:'1',body:{...target,action:'save_config',branch:'main',
      content:yaml,expectedHeadSha:head,expectedFileSha:null}},
    {path:'/api/repo-config',method:'POST',write:'1',body:{...target,action:'sync_labels',branch:'main',
      previewId:'c'.repeat(64),confirmRemovals:true}}],signal)
})

test('Issue reads decode only documented fields, preserve a real next-page link and post the exact comment',async()=>{
  const upstreamIssue={...githubIssue,labels:[{name:'status:todo',description:'not used'}],user:{login:'mira',id:19},unused:true}
  const upstreamComment={...comment,user:{login:'ren',id:20},unused:true}
  const network=exchange([json(upstreamIssue),json([upstreamComment],200,{Link:'<https://api.github.com/next>; rel="next"'}),
    json({encoding:'base64',content:Buffer.from(yaml).toString('base64')}),
    json({authenticated:false}),json({user:{id:19,login:'mira'},repository:{full_name:'collective/ledger',
      accessible:true,permissions:null}}),json({comment:upstreamComment},201)])
  const api=issue(network.request),signal=new AbortController().signal
  assert.deepEqual(await api.getIssue(target.owner,target.repo,8,signal),githubIssue)
  assert.deepEqual(await api.getComments(target.owner,target.repo,8,2,signal),{items:[comment],hasMore:true})
  assert.equal(await api.getConfig(target.owner,target.repo,signal),yaml)
  assert.equal(await api.getSession(signal),false)
  assert.deepEqual(await api.verify(target.owner,target.repo,signal),{user:{id:19,login:'mira'},
    repository:{full_name:'collective/ledger',accessible:true,permissions:null}})
  assert.deepEqual(await api.postComment(target.owner,target.repo,8,'Confirmed',signal),comment)
  network.check([{path:'/api/issue-detail',query:{...target,number:'8'}},
    {path:'/api/issue-comments',query:{...target,number:'8',page:'2'}},
    {path:'/api/issue-config',query:target},{path:'/api/github-session'},
    {path:'/api/github-verify',query:target},{path:'/api/github-issue-comment',method:'POST',write:'1',
      body:{...target,number:8,body:'Confirmed'}}],signal)
})

test('Channel response retains the selected Issue and main provenance, never treats an invalid shape as ready',async()=>{
  const snapshot={state:'ready',branch:'main',headSha:head,pages:2,scannedIssues:3,
    channels:[{label:'channel:review',name:'review',issue:{number:8,title:'Review ledger',
      createdAt:'2026-09-18T09:00:00Z',comments:1,author:'mira'}}]}
  const signal=new AbortController().signal
  const network=exchange([json(snapshot)])
  assert.deepEqual(await channel(network.request).getChannels(target.owner,target.repo,signal),snapshot)
  network.check([{path:'/api/repo-channels',query:target}],signal)
  for(const invalid of [{data:[]},{...snapshot,branch:'feature'},{...snapshot,channels:[{label:'channel:review',issue:{number:8}}]}]){
    const rejected=exchange([json(invalid)])
    await assert.rejects(channel(rejected.request).getChannels(target.owner,target.repo,signal),{status:502})
    rejected.check([{path:'/api/repo-channels',query:target}],signal)
  }
})

test('invalid nested Issue or comment fields are rejected before reaching a reading view',async()=>{
  const signal=new AbortController().signal
  for(const invalid of [{...githubIssue,labels:[null]},{...githubIssue,labels:[{name:3}]},
    {...githubIssue,user:{login:3}},{...githubIssue,locked:'yes'},{...githubIssue,closed_at:3}]){
    const network=exchange([json(invalid)])
    await assert.rejects(issue(network.request).getIssue(target.owner,target.repo,8,signal),{status:502})
    network.check([{path:'/api/issue-detail',query:{...target,number:'8'}}],signal)
  }
  const malformed=exchange([json([{...comment,id:'21'}])])
  await assert.rejects(issue(malformed.request).getComments(target.owner,target.repo,8,1,signal),{status:502})
  malformed.check([{path:'/api/issue-comments',query:{...target,number:'8',page:'1'}}],signal)
})

test('invalid repository or Config snapshots do not become successful empty results',async()=>{
  const signal=new AbortController().signal
  const home=exchange([json({data:'invalid'})])
  await assert.rejects(repo(home.request).getHome(target.owner,target.repo,'main',signal),{status:502})
  home.check([{path:'/api/repo-home',query:{...target,branch:'main'}}],signal)
  const cfg=exchange([json({state:12})])
  await assert.rejects(config(cfg.request).get(target.owner,target.repo,signal),{status:502})
  cfg.check([{path:'/api/repo-config',query:target}],signal)
})

test('partial Label results preserve independently specified completed and pending operations',async()=>{
  const partial={state:'partial_failure',error:'Readback failed',createdLabels:['status:done'],
    removedAssociations:[{number:8,label:'status:old'}],
    failed:[{kind:'remove_issue_label',error:'rate limited',number:9,label:'status:old',retryAfter:'60'}],
    pending:[{number:9,labels:['status:old']}],requiresRefresh:true}
  const network=exchange([json({...partial,ignored:true,failed:[{...partial.failed[0],ignored:true}]})])
  const signal=new AbortController().signal
  assert.deepEqual(await config(network.request).sync(target.owner,target.repo,'preview',true,signal),partial)
  network.check([{path:'/api/repo-config',method:'POST',write:'1',body:{...target,action:'sync_labels',branch:'main',
    previewId:'preview',confirmRemovals:true}}],signal)
})

test('a malformed successful write is uncertain, never a completed operation or automatic retry',async()=>{
  const signal=new AbortController().signal
  const validPartial={state:'partial_failure',error:'Failed',failed:[{kind:'remove_issue_label',error:'Failed'}]}
  const malformed=[{failed:[null]},{failed:[{kind:12,error:'x'}]},{failed:[{kind:'remove',error:12}]},
    {failed:[{kind:'remove',error:'x',retryAfter:{seconds:5}}]},{removedAssociations:[null]},
    {removedAssociations:[{number:8,label:12}]},{removedAssociations:{number:8,label:'x'}},
    {pending:[null]},{pending:[{number:8,labels:['x',null]}]},{pending:{invalid:true}},
    {createdLabels:['x',{}]},{requiresRefresh:'yes'},{retryAfter:{seconds:5}}]
  for(const change of malformed){
    const network=exchange([json({...validPartial,...change})])
    await assert.rejects(config(network.request).sync(target.owner,target.repo,'preview',true,signal),
      {status:502,outcomeUnknown:true})
    network.check([{path:'/api/repo-config',method:'POST',write:'1',body:{...target,action:'sync_labels',branch:'main',
      previewId:'preview',confirmRemovals:true}}],signal)
  }
  for(const body of [{state:'awaiting_pr_merge'},{state:'awaiting_pr_merge',prUrl:'https://example.org/pull/8'},
    {state:'awaiting_pr_merge',prUrl:'https://github.com/collective/ledger/issues/8'},
    {state:'unknown'},{state:'sync_pending'},{state:'ready'},{state:'partial_failure'}]){
    const network=exchange([json(body)])
    await assert.rejects(config(network.request).save(target.owner,target.repo,yaml,head,file,signal),
      {status:502,outcomeUnknown:true})
    network.check([{path:'/api/repo-config',method:'POST',write:'1',body:{...target,action:'save_config',branch:'main',
      content:yaml,expectedHeadSha:head,expectedFileSha:file}}],signal)
  }
  for(const reply of [()=>new Response('not json'),json({state:'invalid'})]){
    const network=exchange([reply])
    await assert.rejects(repo(network.request).register(target.owner,target.repo,'main',{name:'Ren'},signal),
      {status:502,outcomeUnknown:true})
    network.check([{path:'/api/repo-member-register',method:'POST',write:'1',body:{...target,branch:'main',member:{name:'Ren'}}}],signal)
  }
})

test('transport distinguishes explicit rejection from possible remote completion without retrying',async()=>{
  const signal=new AbortController().signal
  for(const [reply,status,unknown] of [
    [json({error:'Denied'},403),403,false],
    [json({error:'Conflict'},409),409,false],
    [json({error:'Unavailable'},503),503,true],
    [json({error:'Rate limited'},429),429,true],
    [()=>new Response('not JSON'),502,true],
    [()=>{throw Error('connection lost')},502,true],
  ]){
    const network=exchange([reply])
    let failure
    try{await transport.readResponse(network.request,'/api/example',signal,{method:'POST',body:'{}'})}
    catch(error){failure=error}
    assert.ok(failure)
    assert.equal(failure.status,status)
    assert.equal(failure.outcomeUnknown,unknown)
    assert.equal(transport.uncertainWriteResult(failure),unknown)
    network.check([{path:'/api/example',method:'POST',body:{}}],signal)
  }
  const original=globalThis.fetch
  let receiver
  globalThis.fetch=async function(){receiver=this;return Response.json({ok:true})}
  try{
    assert.deepEqual((await transport.readResponse(transport.browserRequest,'/api/example',signal)).body,{ok:true})
    assert.equal(receiver,globalThis)
  }finally{globalThis.fetch=original}
})
