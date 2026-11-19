export type ConfigLabelPlan = {
  createLabels: ReadonlyArray<{ name: string }>
  removeIssueLabels: ReadonlyArray<{ number: number; labels: readonly string[] }>
  impact: { definitions: number; issues: number; removals: number }
  hasChanges: boolean
  requiresConfirmation: boolean
}
export type ConfigCapability = {
  state: string
  user?: { login: string; id: number }
  userPermissions?: { pull: boolean; triage: boolean; push: boolean; maintain: boolean; admin: boolean }
  appPermissions?: Record<string, string>
  protectedBranch?: boolean
  branchHead?: string
  canSaveConfig?: boolean
  canCreateLabels?: boolean
  canRemoveLabels?: boolean
  missingAppPermissions?: readonly string[]
  error?: string
}
export type ConfigSnapshot = {
  state: string
  branch?: string
  headSha?: string
  fileSha?: string | null
  configText?: string | null
  config?: { state: string; defaultPreview?: string; error?: string; namespaces?: Record<string, string[]> }
  snapshotId?: string
  counts?: { labels: number; issueObjects: number }
  plan?: ConfigLabelPlan | null
  capability?: ConfigCapability
  prUrl?: string
  error?: string
}
export type ConfigActionResult = {
  state: string
  error?: string
  prUrl?: string
  prNumber?: number
  branch?: string
  branchUrl?: string
  commitSha?: string
  fileSha?: string
  headSha?: string
  requestedBy?: string
  createdLabels?: readonly string[]
  removedAssociations?: number | ReadonlyArray<{ number: number; label: string }>
  failed?: ReadonlyArray<{ kind: string; error: string; stage?: string; name?: string;
    number?: number; label?: string; retryAfter?: string | null }>
  pending?: ReadonlyArray<{ readonly number: number; readonly labels: readonly string[] }> |
    ConfigLabelPlan | null
  retryAfter?: string | null
  previewId?: string
  requiresRefresh?: boolean
  noChanges?: boolean
  reconciled?: boolean
  reused?: boolean
}

import { browserRequest, readResponse, record, requestFailure, requestState,
  responseObject, type RequestFn } from '../../shared/src/browser-http'

export interface RepoConfigApi {
  readonly get: (owner: string, repo: string, signal: AbortSignal) => Promise<ConfigSnapshot>
  readonly save: (owner: string, repo: string, content: string, head: string,
    file: string | null, signal: AbortSignal) => Promise<ConfigActionResult>
  readonly sync: (owner: string, repo: string, previewId: string, confirmed: boolean,
    signal: AbortSignal) => Promise<ConfigActionResult>
}
export function configState(error: unknown): string { return requestState(error) }
export function configError(message: string,status: number,state='error'){
  return requestFailure(message,status,{state})
}
function optionalString(value:unknown, field:string){
  if (value===undefined) return undefined
  if (typeof value!=='string')throw configError('Config 响应字段无效：'+field,502)
  return value
}
function optionalBool(value:unknown,field:string){
  if(value===undefined)return undefined
  if(typeof value!=='boolean')throw configError('Config 响应字段无效：'+field,502)
  return value
}
function parseCapability(value:unknown):ConfigCapability|undefined{
  if(value===undefined)return undefined
  const c=responseObject(value,'Config 权限状态无效'),user=c.user===undefined?null:responseObject(c.user)
  const userPermissions=record(c.userPermissions),appPermissions=record(c.appPermissions)
  return {
    state:typeof c.state==='string'?c.state:'error',
    ...(user&&typeof user.login==='string'&&typeof user.id==='number'?
      {user:{login:user.login,id:user.id}}:{}),
    ...(userPermissions?{userPermissions:{
      pull:userPermissions.pull===true,triage:userPermissions.triage===true,
      push:userPermissions.push===true,maintain:userPermissions.maintain===true,
      admin:userPermissions.admin===true}}:{}),
    ...(appPermissions?{appPermissions:Object.fromEntries(
      Object.entries(appPermissions).filter((entry):entry is [string,string]=>
        typeof entry[1]==='string'))}:{}),
    ...(optionalBool(c.protectedBranch,'protectedBranch')===undefined?{}:
      {protectedBranch:optionalBool(c.protectedBranch,'protectedBranch')}),
    ...(optionalString(c.branchHead,'branchHead')?{branchHead:c.branchHead as string}:{}),
    ...(['canSaveConfig','canCreateLabels','canRemoveLabels'] as const).reduce(
      (out,key)=>{const v=optionalBool(c[key],key);return v===undefined?out:{...out,[key]:v}},
      {} as Record<string,boolean>),
    ...(Array.isArray(c.missingAppPermissions)?{
      missingAppPermissions:c.missingAppPermissions.filter((p):p is string=>typeof p==='string')}:{}),
    ...(typeof c.error==='string'?{error:c.error}:{}),
  }
}
function parsePlan(value:unknown):ConfigLabelPlan|null|undefined{
  if(value===null)return null
  if(value===undefined)return undefined
  const p=responseObject(value,'Config Label 计划无效'),impact=responseObject(p.impact)
  if(!Array.isArray(p.createLabels)||!Array.isArray(p.removeIssueLabels)||
      typeof p.hasChanges!=='boolean'||typeof p.requiresConfirmation!=='boolean'||
      !Number.isSafeInteger(impact.definitions)||!Number.isSafeInteger(impact.issues)||
      !Number.isSafeInteger(impact.removals))throw configError('Config Label 计划无效',502)
  return {
    createLabels:p.createLabels.map(v=>{const row=responseObject(v);if(typeof row.name!=='string')
      throw configError('Config Label 名称无效',502);return {name:row.name}}),
    removeIssueLabels:p.removeIssueLabels.map(v=>{const row=responseObject(v)
      if(!Number.isSafeInteger(row.number)||!Array.isArray(row.labels)||
        row.labels.some(x=>typeof x!=='string'))throw configError('Config Issue Label 无效',502)
      return {number:row.number as number,labels:row.labels as string[]}}),
    impact:{definitions:impact.definitions as number,issues:impact.issues as number,
      removals:impact.removals as number},
    hasChanges:p.hasChanges,requiresConfirmation:p.requiresConfirmation,
  }
}
function parseSnapshot(value:unknown):ConfigSnapshot{
  const s=responseObject(value,'Config 响应格式无效')
  if(typeof s.state!=='string')throw configError('Config 状态无效',502)
  const config=s.config===undefined?undefined:responseObject(s.config)
  const counts=s.counts===undefined?undefined:responseObject(s.counts)
  const namespaces=config?record(config.namespaces):null
  return {
    state:s.state,
    ...(optionalString(s.branch,'branch')===undefined?{}:{branch:s.branch as string}),
    ...(optionalString(s.headSha,'headSha')===undefined?{}:{headSha:s.headSha as string}),
    ...(s.fileSha===null?{fileSha:null}:optionalString(s.fileSha,'fileSha')===undefined?
      {}:{fileSha:s.fileSha as string}),
    ...(s.configText===null?{configText:null}:optionalString(s.configText,'configText')===undefined?
      {}:{configText:s.configText as string}),
    ...(config?{config:{
      state:typeof config.state==='string'?config.state:'error',
      ...(optionalString(config.defaultPreview,'defaultPreview')?{defaultPreview:config.defaultPreview as string}:{}),
      ...(optionalString(config.error,'error')?{error:config.error as string}:{}),
      ...(namespaces?{namespaces:Object.fromEntries(
        Object.entries(namespaces).map(([key,value])=>{
          if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))
            throw configError('Config 命名空间响应无效',502)
          return [key,value as string[]]
        }))}:{}),
    }}:{}),
    ...(optionalString(s.snapshotId,'snapshotId')?{snapshotId:s.snapshotId as string}:{}),
    ...(counts?{counts:{
      labels:Number.isSafeInteger(counts.labels)?counts.labels as number:0,
      issueObjects:Number.isSafeInteger(counts.issueObjects)?counts.issueObjects as number:0,
    }}:{}),
    ...(s.plan!==undefined?{plan:parsePlan(s.plan)}:{}),
    ...(s.capability!==undefined?{capability:parseCapability(s.capability)}:{}),
    ...(optionalString(s.prUrl,'prUrl')?{prUrl:s.prUrl as string}:{}),
    ...(optionalString(s.error,'error')?{error:s.error as string}:{}),
  }
}
/** @summary Reject malformed optional wire fields before any value reaches React. */
function optionalActionNumber(value:unknown,field:string):number|undefined{
  if(value===undefined)return undefined
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)
    throw configError('Config 写入数字字段无效：'+field,502)
  return value
}
function nullableActionString(value:unknown,field:string):string|null|undefined{
  if(value===null)return null
  return optionalString(value,field)
}
function parseFailed(value:unknown):ConfigActionResult['failed']{
  if(value===undefined)return undefined
  if(!Array.isArray(value))throw configError('Config 部分失败列表无效',502)
  return value.map(item=>{
    const row=responseObject(item,'Config 部分失败项无效')
    if(typeof row.kind!=='string'||typeof row.error!=='string')
      throw configError('Config 部分失败项字段无效',502)
    const number=optionalActionNumber(row.number,'failed.number')
    return {
      kind:row.kind,error:row.error,
      ...(optionalString(row.stage,'failed.stage')===undefined?{}:
        {stage:row.stage as string}),
      ...(optionalString(row.name,'failed.name')===undefined?{}:
        {name:row.name as string}),
      ...(number===undefined?{}:{number}),
      ...(optionalString(row.label,'failed.label')===undefined?{}:
        {label:row.label as string}),
      ...(row.retryAfter===undefined?{}:
        {retryAfter:nullableActionString(row.retryAfter,'failed.retryAfter')}),
    }
  })
}
function parseRemovedAssociations(value:unknown):ConfigActionResult['removedAssociations']{
  if(value===undefined)return undefined
  if(typeof value==='number')return optionalActionNumber(value,'removedAssociations')
  if(!Array.isArray(value))throw configError('Config 移除关联结果无效',502)
  return value.map(item=>{
    const row=responseObject(item,'Config 移除关联项无效')
    if(typeof row.label!=='string')throw configError('Config 移除关联标签无效',502)
    const number=optionalActionNumber(row.number,'removedAssociations.number')
    if(number===undefined||number===0)throw configError('Config 移除关联编号无效',502)
    return {number,label:row.label}
  })
}
function parsePending(value:unknown):ConfigActionResult['pending']{
  if(value===undefined)return undefined
  if(value===null)return null
  if(!Array.isArray(value))return parsePlan(value)
  return value.map(item=>{
    const row=responseObject(item,'Config 待处理项无效')
    const number=optionalActionNumber(row.number,'pending.number')
    if(number===undefined||number===0||!Array.isArray(row.labels)||
      row.labels.some(label=>typeof label!=='string'))
      throw configError('Config 待处理关联无效',502)
    return {number,labels:[...row.labels] as string[]}
  })
}
/** @summary Require a recognized action-specific outcome before trusting a successful POST. */
function validPullRequestUrl(value:unknown):boolean{
  if(typeof value!=='string')return false
  try{
    const url=new URL(value)
    return url.protocol==='https:'&&url.hostname==='github.com'&&
      !url.username&&!url.password&&
      /^\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/.test(url.pathname)
  }catch{return false}
}
function parseAction(value:unknown,action:'save_config'|'sync_labels'):ConfigActionResult{
  const data=responseObject(value,'Config 写入响应无效')
  if(typeof data.state!=='string')throw configError('Config 写入状态无效',502)
  const result:ConfigActionResult={state:data.state}
  const strings=['prUrl','branch','branchUrl','commitSha','fileSha',
    'headSha','requestedBy','error','previewId'] as const
  for(const key of strings){
    const value=optionalString(data[key],key)
    if(value!==undefined)Object.assign(result,{[key]:value})
  }
  const prNumber=optionalActionNumber(data.prNumber,'prNumber')
  if(prNumber!==undefined){
    if(prNumber===0)throw configError('Config PR 编号无效',502)
    Object.assign(result,{prNumber})
  }
  const retryAfter=nullableActionString(data.retryAfter,'retryAfter')
  if(retryAfter!==undefined)Object.assign(result,{retryAfter})
  for(const key of ['noChanges','reconciled','reused','requiresRefresh'] as const){
    const value=optionalBool(data[key],key)
    if(value!==undefined)Object.assign(result,{[key]:value})
  }
  if(data.createdLabels!==undefined){
    if(!Array.isArray(data.createdLabels)||
      data.createdLabels.some(label=>typeof label!=='string'))
      throw configError('Config Label 写入结果无效',502)
    Object.assign(result,{createdLabels:[...data.createdLabels] as string[]})
  }
  const removedAssociations=parseRemovedAssociations(data.removedAssociations)
  if(removedAssociations!==undefined)Object.assign(result,{removedAssociations})
  const failed=parseFailed(data.failed)
  if(failed!==undefined)Object.assign(result,{failed})
  const pending=parsePending(data.pending)
  if(pending!==undefined)Object.assign(result,{pending})
  const state=result.state
  if(action==='save_config'){
    if(state==='awaiting_pr_merge'){
      if(!validPullRequestUrl(result.prUrl))throw configError('维护 PR 地址缺失或无效',502)
    }else if(state==='sync_pending'){
      if(typeof result.commitSha!=='string'||!/^[a-f0-9]{40}$/i.test(result.commitSha)||
        typeof result.fileSha!=='string'||!/^[a-f0-9]{40}$/i.test(result.fileSha))
        throw configError('Config Commit 结果缺少有效 SHA',502)
    }else if(state==='ready'){
      if(result.noChanges!==true)throw configError('Config 无变更确认缺失',502)
    }else if(state==='partial_failure'){
      if(!result.error)throw configError('Config 部分失败信息缺失',502)
    }else throw configError('Config 写入状态无效',502)
  }else if(state==='ready'){
    if(!Array.isArray(result.createdLabels)||result.removedAssociations===undefined)
      throw configError('Label 同步成功结果不完整',502)
  }else if(state==='partial_failure'){
    if(!result.failed?.length)throw configError('Label 同步部分失败信息缺失',502)
  }else throw configError('Label 同步状态无效',502)
  return result
}
function params(owner:string,repo:string){return new URLSearchParams({owner,repo}).toString()}
/** @summary Return one stable request-function-only Config API with explicit user writes. */
export function createRepoConfigApi(request:RequestFn=browserRequest):Readonly<RepoConfigApi>{
  async function get(owner:string,repo:string,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-config?'+params(owner,repo),signal)
    return parseSnapshot(body)
  }
  async function save(owner:string,repo:string,content:string,head:string,file:string|null,
    signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-config',signal,{
      method:'POST',headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({action:'save_config',owner,repo,branch:'main',content,
        expectedHeadSha:head,expectedFileSha:file}),
    })
    try { return parseAction(body,'save_config') }
    catch (error) {
      throw requestFailure(error instanceof Error ? error.message : 'Config 写入响应无效',
        502, { outcomeUnknown: true })
    }
  }
  async function sync(owner:string,repo:string,previewId:string,confirmed:boolean,
    signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-config',signal,{
      method:'POST',headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({action:'sync_labels',owner,repo,branch:'main',previewId,
        confirmRemovals:confirmed}),
    })
    try { return parseAction(body,'sync_labels') }
    catch (error) {
      throw requestFailure(error instanceof Error ? error.message : 'Config 同步响应无效',
        502, { outcomeUnknown: true })
    }
  }
  return Object.freeze({get,save,sync})
}
export const repoConfigApi=createRepoConfigApi()
