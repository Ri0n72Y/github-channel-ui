export type TopicRoute = { owner: string; repo: string }
export type TopicSlugRoute = { topic: string }
export type TopicReadRoute = TopicRoute | TopicSlugRoute
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
  config: { topic: string; whitelist: boolean; cover?: string } | null;
  configState: 'ready' | 'missing'; configText: string | null;
  configSha: string | null; headSha: string; defaultBranch: string;
  allowedRepositories: readonly string[]
}
export type TopicProjectsPage = {
  page: number; offset: number; perPage: number; totalCount: number;
  hasNext: boolean; nextPage: number | null; nextOffset: number | null;
  windowExhausted: boolean; items: readonly TopicRepository[]
}
export type TopicPageError = Error & { stage?: string; status?: number; retryable?: boolean; observedAt?: string; outcomeUnknown?: boolean }
export type ReportIssue = { title: string; body: string }
export type TopicConfigResult = {
  readonly state: 'committed' | 'pending_pr' | 'unchanged' | 'partial_failure';
  readonly effective: boolean; readonly branch: string;
  readonly prUrl?: string; readonly branchUrl?: string;
  readonly commitSha?: string; readonly error?: string; readonly outcomeUnknown?: boolean
}
export interface TopicPageApi {
  readonly reportAvailable: boolean
  getSnapshot(route: TopicRoute, signal: AbortSignal, refresh?: boolean): Promise<TopicSnapshot>
  getProjects(route: TopicReadRoute, page: number, signal: AbortSignal, offset?: number, head?: string): Promise<TopicProjectsPage>
  getSession(signal: AbortSignal): Promise<boolean>
  getReportTarget(route: TopicRoute, signal: AbortSignal): Promise<string>
  submitReport(route: TopicRoute, report: ReportIssue, proof: string, signal: AbortSignal): Promise<string>
  saveConfig(route: TopicRoute, content: string, headSha: string,
    configSha: string | null, signal: AbortSignal): Promise<TopicConfigResult>
}

import { safeTopicCoverUrl } from './domain.mjs'
import { createTopicReadCache } from './topic-read-cache.mjs'
import { browserRequest, record, requestFailure, responseObject,
  type RequestFn } from '../../shared/src/browser-http'

function topicError(message:string,status:number,stage='source',
  outcomeUnknown=false):TopicPageError{
  return Object.assign(new Error(message),{status,stage,retryable:!outcomeUnknown,outcomeUnknown})
}
function query(route:TopicReadRoute,page?:number,offset?:number,head?:string){
  return new URLSearchParams(page===undefined?route:{...route,page:String(page),offset:String(offset||0),...(head?{head}:{})}).toString()
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
    config=snapshot.config===null?null:responseObject(snapshot.config)
  if(!['ready','missing'].includes(String(snapshot.configState))||
    (config===null)!==(snapshot.configState==='missing')||
    config && typeof config.whitelist!=='boolean'||
    !Array.isArray(snapshot.allowedRepositories)||
    snapshot.allowedRepositories.some(p=>typeof p!=='string')||
    snapshot.coverUrl!==null&&typeof snapshot.coverUrl!=='string')
    throw topicError('Topic 元数据无效',502)
  const cover = config?.cover === undefined ? null : safeTopicCoverUrl(config.cover)
  if (config?.cover !== undefined && !cover) throw topicError('Topic 封面 URL 无效',502,'config')
  return {repository:{owner:required(repo.owner,'owner'),name:required(repo.name,'name'),
    full_name:required(repo.full_name,'full_name'),html_url:required(repo.html_url,'html_url')},
    readme:required(snapshot.readme,'readme'),coverUrl:cover,
    config:config?{topic:required(config.topic,'topic'),whitelist:config.whitelist as boolean,...(cover?{cover}:{})}:null,
    configState:snapshot.configState as TopicSnapshot['configState'],
    configText:snapshot.configText===null?null:required(snapshot.configText,'configText'),
    configSha:snapshot.configSha===null?null:required(snapshot.configSha,'configSha'),
    headSha:required(snapshot.headSha,'headSha'),
    defaultBranch:required(snapshot.defaultBranch,'defaultBranch'),
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
/** Abort one consumer, not the shared bounded request used by other consumers. */
function observe<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(new DOMException('Aborted','AbortError'))
    if(signal.aborted){cancel();return}
    signal.addEventListener('abort',cancel,{once:true})
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel))
  })
}
const sourceKey=(route:TopicRoute)=>route.owner.toLowerCase()+'/'+route.repo.toLowerCase()+'|'
/** @summary Cache public snapshots and whole Search pages; 25-card display slices stay in memory. */
export function createTopicPageApi(request:RequestFn=browserRequest):Readonly<TopicPageApi>{
  const snapshots=createTopicReadCache<TopicSnapshot>({ttl:300000,limit:16})
  // Keep a loaded page stable across its local display slices for the source TTL.
  // The server's upstream Search TTL is shorter (120s); explicit refresh clears both.
  const pages=createTopicReadCache<TopicProjectsPage>({ttl:300000,limit:80})
  async function getSnapshot(route:TopicRoute,signal:AbortSignal,refresh=false){
    if(signal.aborted)throw new DOMException('Aborted','AbortError')
    const key=sourceKey(route)
    return observe(snapshots.get(key,async()=>{
      // A bounded request independent of any single mounted consumer.
      const response=await read(request,'/api/topic-page?'+query(route)+(refresh?'&refresh=1':''),
        AbortSignal.timeout(120000))
      const value=parseSnapshot(response)
      if(value.repository.full_name.toLowerCase()!==(route.owner+'/'+route.repo).toLowerCase()||
          !/^[a-f0-9]{40}$/i.test(value.headSha))
        throw topicError('Topic 来源快照无效',502,'snapshot')
      return value
    },refresh,()=>pages.invalidate(key)),signal)
  }
  async function getProjects(route:TopicReadRoute,page:number,signal:AbortSignal,offset=0,head?:string){
    if ('topic' in route) throw topicError('正式 Topic 查询必须指定来源仓库',400,'route')
    if(signal.aborted)throw new DOMException('Aborted','AbortError')
    if(!head||!Number.isInteger(page)||page<1||page>10||![0,25,50,75].includes(offset))
      throw topicError('Topic 搜索分页游标无效',400,'topic-search')
    const prefix=sourceKey(route)
    const snapshot=snapshots.peek(prefix)
    if(!snapshot||snapshot.headSha!==head)
      throw topicError('来源快照已失效，请刷新 TopicPage',409,'snapshot')
    const key=prefix+head+'|'+page
    // Never splice a newly fetched Search page onto an already consumed local slice.
    if(offset!==0&&!pages.has(key))throw topicError('项目分页缓存已失效，请刷新 TopicPage',409,'snapshot')
    const whole=await observe(pages.get(key,async()=>{
      const value=parsePage(await read(request,'/api/topic-projects?'+query(route,page,0,head),
        AbortSignal.timeout(120000)))
      if(value.page!==page||value.offset!==0||value.items.length>100||
          value.hasNext&&(value.nextPage!==page+1||page===10||value.nextOffset!==0))
        throw topicError('Topic Search 完整页无效',502,'topic-search')
      return value
    }),signal)
    if(snapshots.peek(prefix)!==snapshot)
      throw topicError('来源快照已失效，请刷新 TopicPage',409,'snapshot')
    const moreLocal=offset+25<whole.items.length
    return {...whole,offset,items:whole.items.slice(offset,offset+25),
      hasNext:moreLocal||whole.hasNext,nextPage:moreLocal?page:whole.nextPage,
      nextOffset:moreLocal?offset+25:whole.nextOffset,
      windowExhausted:!moreLocal&&whole.windowExhausted}
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
  async function saveConfig(route:TopicRoute,content:string,headSha:string,
    configSha:string|null,signal:AbortSignal):Promise<TopicConfigResult>{
    // A single user-confirmed POST; uncertain outcomes must not be replayed automatically.
    let response:Response
    try{response=await request('/api/topic-config',{
      method:'POST',credentials:'same-origin',cache:'no-store',signal,
      headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({...route,content,expectedHeadSha:headSha,
        expectedFileSha:configSha,confirmed:true}),
    })}catch{
      throw topicError('Topic 配置提交结果未知，请先检查 GitHub',502,'config-write',true)
    }
    let body:unknown
    try{body=await response.json()}
    catch{throw topicError('Topic 配置响应无法核验，请先检查 GitHub',502,'config-write',true)}
    const data=record(body)
    if(!response.ok){
      throw topicError(typeof data?.error==='string'?data.error:
        'Topic 配置提交失败，HTTP '+response.status,response.status,'config-write',
        data?.outcomeUnknown===true)
    }
    if(!data||!['committed','pending_pr','unchanged','partial_failure'].includes(
      String(data.state))||typeof data.branch!=='string'||
      typeof data.effective!=='boolean'){
      throw topicError('Topic 配置提交状态无法核验，请先检查 GitHub',502,'config-write',true)
    }
    const state=data.state as TopicConfigResult['state']
    if(state==='pending_pr' && (data.effective!==false ||
        typeof data.prUrl!=='string')||state==='committed' && data.effective!==true)
      throw topicError('Topic Config 写入结果无法确认',502,'config-write',true)
    if(state==='committed'){
      snapshots.invalidate(sourceKey(route));pages.invalidate(sourceKey(route))
    }
    return {state,branch:data.branch,effective:data.effective,
      ...(typeof data.prUrl==='string'?{prUrl:data.prUrl}:{}),
      ...(typeof data.branchUrl==='string'?{branchUrl:data.branchUrl}:{}),
      ...(typeof data.commitSha==='string'?{commitSha:data.commitSha}:{}),
      ...(typeof data.error==='string'?{error:data.error}:{}),
      ...(data.outcomeUnknown===true?{outcomeUnknown:true}:{})}
  }
  return Object.freeze({reportAvailable:true,getSnapshot,getProjects,getSession,
    getReportTarget,submitReport,saveConfig})
}
export const topicPageApi=createTopicPageApi()
