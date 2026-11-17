export type TopicRoute = { owner: string; repo: string }
export type TopicRepository = {
  id: number; full_name: string; name: string; owner: string | null;
  description: string; html_url: string; stargazers_count: number;
  language: string | null;
  /** Optional URL supplied and host-validated from GitHub Search; never synthesized. */
  cover_url?: string; owner_avatar_url?: string
}
export type TopicSnapshot = {
  repository: { owner: string; name: string; full_name: string; html_url: string }
  readme: string; coverUrl: string | null;
  config: { topic: string; whitelist: boolean };
  allowedRepositories: readonly string[]
}
export type TopicProjectsPage = {
  page: number; offset: number; perPage: number; totalCount: number;
  hasNext: boolean; nextPage: number | null; nextOffset: number | null;
  windowExhausted: boolean; items: readonly TopicRepository[]
}
export type TopicPageError = Error & { stage?: string; status?: number; retryable?: boolean; observedAt?: string; outcomeUnknown?: boolean }
export type ReportIssue = { title: string; body: string }
export interface TopicPageApi {
  readonly reportAvailable: boolean
  getSnapshot(route: TopicRoute, signal: AbortSignal): Promise<TopicSnapshot>
  getProjects(route: TopicRoute, page: number, signal: AbortSignal, offset?: number): Promise<TopicProjectsPage>
  getSession(signal: AbortSignal): Promise<boolean>
  getReportTarget(route: TopicRoute, signal: AbortSignal): Promise<string>
  submitReport(route: TopicRoute, report: ReportIssue, proof: string, signal: AbortSignal): Promise<string>
}

import { browserRequest, record, requestFailure, responseObject,
  type RequestFn } from '../../shared/src/browser-http'

function topicError(message:string,status:number,stage='source',
  outcomeUnknown=false):TopicPageError{
  return Object.assign(new Error(message),{status,stage,retryable:!outcomeUnknown,outcomeUnknown})
}
function query(route:TopicRoute,page?:number,offset?:number){
  return new URLSearchParams(page===undefined?route:{...route,page:String(page),offset:String(offset||0)}).toString()
}
async function read(request:RequestFn,url:string,signal:AbortSignal):Promise<unknown>{
  const response=await request(url,{cache:'no-store',signal,credentials:'same-origin'})
  let body:unknown
  try{body=await response.json()}
  catch{throw topicError('TopicPage API 响应无效',502)}
  if(!response.ok){
    const result=record(body)
    const error=topicError(typeof result?.error==='string'?result.error:
      'HTTP '+response.status,response.status,
      typeof result?.stage==='string'?result.stage:'source')
    error.retryable=result?.retryable!==false
    throw error
  }
  return body
}
function required(value:unknown,name:string):string{
  if(typeof value!=='string')throw topicError('Topic 字段无效：'+name,502)
  return value
}
function parseSnapshot(value:unknown):TopicSnapshot{
  const snapshot=responseObject(value),repo=responseObject(snapshot.repository),
    config=responseObject(snapshot.config)
  if(typeof config.whitelist!=='boolean'||!Array.isArray(snapshot.allowedRepositories)||
    snapshot.allowedRepositories.some(p=>typeof p!=='string')||
    snapshot.coverUrl!==null&&typeof snapshot.coverUrl!=='string')
    throw topicError('Topic 元数据无效',502)
  return {repository:{owner:required(repo.owner,'owner'),name:required(repo.name,'name'),
    full_name:required(repo.full_name,'full_name'),html_url:required(repo.html_url,'html_url')},
    readme:required(snapshot.readme,'readme'),coverUrl:snapshot.coverUrl as string|null,
    config:{topic:required(config.topic,'topic'),whitelist:config.whitelist},
    allowedRepositories:[...snapshot.allowedRepositories as string[]]}
}
function parseProject(value:unknown):TopicRepository{
  const p=responseObject(value,'Topic 项目响应无效')
  if(!Number.isSafeInteger(p.stargazers_count)||
    (p.owner!==null&&typeof p.owner!=='string')||
    (p.language!==null&&typeof p.language!=='string'))
    throw topicError('Topic 项目字段无效',502)
  if(!Number.isSafeInteger(p.id)||typeof p.id!=='number'||p.id<=0)
    throw topicError('Topic 项目仓库 ID 无效',502)
  const result:TopicRepository={id:p.id,full_name:required(p.full_name,'full_name'),
    name:required(p.name,'name'),owner:p.owner as string|null,
    description:required(p.description,'description'),
    html_url:required(p.html_url,'html_url'),
    stargazers_count:p.stargazers_count as number,language:p.language as string|null}
  if(typeof p.cover_url==='string')return {
    ...result,cover_url:p.cover_url,
    ...(typeof p.owner_avatar_url==='string'?{owner_avatar_url:p.owner_avatar_url}:{})}
  return typeof p.owner_avatar_url==='string'?{...result,owner_avatar_url:p.owner_avatar_url}:result
}
function parsePage(value:unknown):TopicProjectsPage{
  const p=responseObject(value)
  if(!Array.isArray(p.items)||!Number.isSafeInteger(p.page)||
    !Number.isSafeInteger(p.offset)||![0,25,50,75].includes(p.offset as number)||
    !Number.isSafeInteger(p.perPage)||p.perPage!==100||
    !Number.isSafeInteger(p.totalCount)||typeof p.hasNext!=='boolean'||
    typeof p.windowExhausted!=='boolean'||
    (p.hasNext && (!Number.isSafeInteger(p.nextPage)||
      ![0,25,50,75].includes(p.nextOffset as number)))||
    (!p.hasNext && (p.nextPage!==null||p.nextOffset!==null))||
    p.hasNext && p.windowExhausted)
    throw topicError('Topic 搜索分页游标无效',502,'topic-search')
  return {page:p.page as number,offset:p.offset as number,perPage:100,
    totalCount:p.totalCount as number,hasNext:p.hasNext,
    nextPage:p.nextPage as number|null,nextOffset:p.nextOffset as number|null,
    windowExhausted:p.windowExhausted,items:p.items.map(parseProject)}
}
/** @summary Provide a stable, no-Class Topic API with explicit OAuth Issue report writes. */
export function createTopicPageApi(request:RequestFn=browserRequest):Readonly<TopicPageApi>{
  async function getSnapshot(route:TopicRoute,signal:AbortSignal){
    return parseSnapshot(await read(request,'/api/topic-page?'+query(route),signal))
  }
  async function getProjects(route:TopicRoute,page:number,signal:AbortSignal,offset=0){
    return parsePage(await read(request,'/api/topic-projects?'+query(route,page,offset),signal))
  }
  async function getSession(signal:AbortSignal){
    return responseObject(await read(request,'/api/github-session',signal)).authenticated===true
  }
  async function getReportTarget(route:TopicRoute,signal:AbortSignal){
    const data=responseObject(await read(request,'/api/topic-report?'+query(route),signal))
    if(data.state!=='ready'||typeof data.proof!=='string'||!data.proof)
      throw topicError('报告仓库权限核查失败，请重新登录或检查仓库权限',403,'permission')
    return data.proof
  }
  async function submitReport(route:TopicRoute,report:ReportIssue,proof:string,signal:AbortSignal){
    // Never automatically retry uncertain writes.
    let response:Response
    try{response=await request('/api/topic-report',{method:'POST',
      credentials:'same-origin',cache:'no-store',signal,
      headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({...route,title:report.title,body:report.body,confirmed:true,proof})})}
    catch{throw topicError('创建结果未知；请先到 GitHub 检查是否已创建 Issue，再决定是否重试',
      502,'report',true)}
    let body:unknown
    try{body=await response.json()}
    catch{throw topicError('GitHub 写入响应无法核实；请先到 GitHub 检查，避免重复创建',
      502,'report',true)}
    const result=record(body)
    if(!response.ok){
      throw topicError(typeof result?.error==='string'?result.error:
        '创建 Issue 失败，HTTP '+response.status,response.status,'report',
        result?.outcomeUnknown===true)
    }
    const issue=record(result?.issue),url=issue?.html_url,id=issue?.number
    let safe=false
    if(typeof url==='string'&&Number.isSafeInteger(id)&&typeof id==='number'&&id>0){
      try{const parsed=new URL(url)
        safe=parsed.protocol==='https:'&&parsed.hostname==='github.com'&&
          !parsed.search&&!parsed.hash&&parsed.pathname.toLowerCase()===
          ('/'+route.owner+'/'+route.repo+'/issues/'+id).toLowerCase()
      }catch{safe=false}
    }
    if(response.status!==201||result?.state!=='created'||!safe){
      throw topicError('Issue 已提交，但 GitHub 返回的创建结果无法确认；请先核查再重试',
        502,'report',true)
    }
    return url as string
  }
  return Object.freeze({reportAvailable:true,getSnapshot,getProjects,getSession,
    getReportTarget,submitReport})
}
export const topicPageApi=createTopicPageApi()
