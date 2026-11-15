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
  failed?: ReadonlyArray<{ kind: string; error: string; name?: string; number?: number; label?: string; retryAfter?: string | null }>
  pending?: unknown
  retryAfter?: string | null
  noChanges?: boolean
  reconciled?: boolean
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
function parseAction(value:unknown):ConfigActionResult{
  const result=responseObject(value,'Config 写入响应无效')
  if(typeof result.state!=='string')throw configError('Config 写入状态无效',502)
  // Validate the full result against the explicitly named wire fields.
  for(const key of ['prUrl','branch','branchUrl','commitSha','fileSha','headSha',
    'requestedBy','error','previewId'] as const) {
    if(result[key]!==undefined&&typeof result[key]!=='string')
      throw configError('Config 写入响应字段无效：'+key,502)
  }
  if(result.prNumber!==undefined&&!Number.isSafeInteger(result.prNumber))
    throw configError('Config PR 编号无效',502)
  if(result.createdLabels!==undefined&&(!Array.isArray(result.createdLabels)||
      result.createdLabels.some(v=>typeof v!=='string')))
    throw configError('Config Label 写入结果无效',502)
  if(result.failed!==undefined&&!Array.isArray(result.failed))
    throw configError('Config 部分失败列表无效',502)
  return {...result,state:result.state} as ConfigActionResult
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
    return parseAction(body)
  }
  async function sync(owner:string,repo:string,previewId:string,confirmed:boolean,
    signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-config',signal,{
      method:'POST',headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({action:'sync_labels',owner,repo,branch:'main',previewId,
        confirmRemovals:confirmed}),
    })
    return parseAction(body)
  }
  return Object.freeze({get,save,sync})
}
export const repoConfigApi=createRepoConfigApi()
