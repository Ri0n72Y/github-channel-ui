import { browserRequest, readResponse, record, requestFailure,
  responseObject, type RequestFn } from '../../shared/src/browser-http'

export interface Repo { readonly owner:string; readonly name:string; readonly full_name:string }
export type RepoLookupError = Error & { readonly status:number; readonly state?:string; readonly actionUrl?:string }
export interface Issue { readonly number:number; readonly title:string;
  readonly html_url:string; readonly comments:number }
export interface Verification {
  readonly user:{readonly id:number;readonly login:string}
  readonly repository:{readonly full_name:string;readonly accessible:boolean;
    readonly permissions:Readonly<{admin:boolean;maintain:boolean;push:boolean;
      triage:boolean;pull:boolean}>|null}
}
export interface RepoIssuesApi {
  /** Read only the explicitly selected public target; no global Installation listing. */
  readonly getRepositories:(signal:AbortSignal,target?:Repo)=>Promise<readonly Repo[]>
  readonly getIssues:(owner:string,repo:string,signal:AbortSignal)=>Promise<readonly Issue[]>
  readonly getSession:(signal:AbortSignal)=>Promise<boolean>
  readonly verify:(owner:string,repo:string,signal:AbortSignal)=>Promise<Verification>
  readonly createIssue:(repo:Repo,title:string,body:string,signal:AbortSignal)=>
    Promise<{readonly number:number;readonly html_url:string}>
}
function requiredString(value:unknown,name:string):string {
  if(typeof value!=='string')throw requestFailure('GitHub 响应字段无效：'+name,502)
  return value
}
function number(value:unknown,name:string):number {
  if(!Number.isSafeInteger(value)||typeof value!=='number')
    throw requestFailure('GitHub 响应数字字段无效：'+name,502)
  return value
}
const allowedStates = new Set(['repository_unavailable', 'installation_suspended',
  'needs_installation', 'needs_repository_authorization'])
function officialActionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.origin !== 'https://github.com' || url.username || url.password ||
        url.search || url.hash) return undefined
    if (/^\/apps\/[a-z\d-]{1,100}\/installations\/new$/i.test(url.pathname) ||
        /^\/(?:settings|organizations\/[a-z\d-]{1,39}\/settings)\/installations\/[1-9]\d*\/?$/i.test(url.pathname)) return url.href
  } catch { /* Never render a server-supplied unsafe management link. */ }
  return undefined
}
function parseScopedRepository(value:unknown,target:Repo):readonly Repo[] {
  const data=responseObject(value,'仓库安装状态响应无效')
  if (data.state === 'connected') {
    const row=responseObject(data.repository,'仓库身份响应无效')
    const owner=requiredString(row.owner,'owner')
    const name=requiredString(row.name,'name')
    const full_name=requiredString(row.full_name,'full_name')
    if (full_name !== owner + '/' + name ||
        full_name.toLowerCase() !== target.full_name.toLowerCase()) {
      throw requestFailure('GitHub Installation 仓库身份不匹配',502)
    }
    return [{ owner,name,full_name }]
  }
  if (allowedStates.has(data.state as string)) {
    const state=data.state as string
    const message=state === 'needs_installation' ? '此公开仓库尚未安装 GitHub App' :
      state === 'needs_repository_authorization' ? '此仓库未包含在 GitHub App 的当前授权范围' :
      state === 'installation_suspended' ? '此仓库的 GitHub App Installation 已暂停' :
      '目标仓库不存在或不是公开仓库'
    throw Object.assign(requestFailure(message,state==='repository_unavailable'?404:403,
      {state}), {actionUrl:officialActionUrl(data.action_url)}) as RepoLookupError
  }
  throw requestFailure('GitHub Installation 状态无法确认',502)
}

function parseIssues(value:unknown):readonly Issue[] {
  const data=responseObject(value)
  if(!Array.isArray(data.issues))throw requestFailure('Issue 列表无效',502)
  return data.issues.map(item=>{
    const row=responseObject(item)
    return {number:number(row.number,'number'),title:requiredString(row.title,'title'),
      html_url:requiredString(row.html_url,'html_url'),comments:number(row.comments,'comments')}
  })
}
function parseVerification(value:unknown):Verification {
  const data=responseObject(value),user=responseObject(data.user),
    repo=responseObject(data.repository)
  if(typeof repo.accessible!=='boolean')throw requestFailure('GitHub 权限响应无效',502)
  const p=repo.permissions===null?null:responseObject(repo.permissions)
  return {user:{id:number(user.id,'id'),login:requiredString(user.login,'login')},
    repository:{full_name:requiredString(repo.full_name,'full_name'),
      accessible:repo.accessible,permissions:p?{
        admin:p.admin===true,maintain:p.maintain===true,push:p.push===true,
        triage:p.triage===true,pull:p.pull===true}:null}}
}
/** @summary Consolidate the root Repo panel HTTP surface into a stable, readonly API. */
export function createRepoIssuesApi(request:RequestFn=browserRequest):Readonly<RepoIssuesApi>{
  async function getRepositories(signal:AbortSignal,target?:Repo){
    if (!target) throw requestFailure('请先输入完整的 GitHub 仓库 URL',400,
      {state:'target_required'})
    const {body}=await readResponse(request,
      '/api/repos?'+new URLSearchParams({owner:target.owner,repo:target.name}),signal)
    return parseScopedRepository(body,target)
  }
  async function getIssues(owner:string,repo:string,signal:AbortSignal){
    const {body}=await readResponse(request,
      '/api/issues?'+new URLSearchParams({owner,repo}),signal)
    return parseIssues(body)
  }
  async function getSession(signal:AbortSignal){
    const {body}=await readResponse(request,'/api/github-session',signal)
    const data=responseObject(body)
    if(typeof data.authenticated!=='boolean')throw requestFailure('Session 响应无效',502)
    return data.authenticated
  }
  async function verify(owner:string,repo:string,signal:AbortSignal){
    const {body}=await readResponse(request,
      '/api/github-verify?'+new URLSearchParams({owner,repo}),signal)
    return parseVerification(body)
  }
  async function createIssue(repo:Repo,title:string,content:string,signal:AbortSignal){
    let response:Response
    try{response=await request('/api/github-issue-create',{
      method:'POST',credentials:'same-origin',cache:'no-store',signal,
      headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({owner:repo.owner,repo:repo.name,title,body:content}),
    })}catch{throw requestFailure('创建结果未知，请先去 GitHub 检查再决定是否重试',502)}
    let payload:unknown
    try{payload=await response.json()}
    catch{throw requestFailure('创建结果无法核实，请先去 GitHub 检查',502)}
    const data=record(payload)
    if(!response.ok)throw requestFailure(
      typeof data?.error==='string'?data.error:'HTTP '+response.status,response.status,
      {relogin:data?.relogin===true})
    const issue=responseObject(data?.issue)
    if(response.status!==201)throw requestFailure('创建结果未知，请先检查 GitHub',502)
    return {number:number(issue.number,'number'),html_url:requiredString(issue.html_url,'html_url')}
  }
  return Object.freeze({getRepositories,getIssues,getSession,verify,createIssue})
}
export const repoIssuesApi=createRepoIssuesApi()
