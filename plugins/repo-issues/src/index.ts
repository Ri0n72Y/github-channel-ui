import { Service, type Context } from '@deepseek-ai/cordis'
import { repoIssuesApi, type Repo, type Issue, type RepoIssuesApi,
  type RepoLookupError } from './api'
import { parseGitHubRepositoryUrl } from './target.mjs'
export type { Repo, Issue } from './api'

export interface RepoIssueState {
  readonly repos:readonly Repo[]; readonly selected:string; readonly issues:readonly Issue[];
  readonly loading:boolean;readonly error:string
  readonly availability:string;readonly actionUrl:string|null;readonly targetUrl:string
}
export interface RepoIssueStore {
  readonly api:Readonly<RepoIssuesApi>
  readonly getSnapshot:()=>RepoIssueState
  readonly subscribe:(listener:()=>void)=>(()=>void)
  readonly connect:(url:string)=>Promise<void>
  readonly select:(fullName:string)=>Promise<void>
  readonly refresh:()=>Promise<void>
  readonly dispose:()=>void
}
/** @summary No global repo enumeration: the user supplies an exact GitHub URL per connection. */
export function createRepoIssuesStore(api:Readonly<RepoIssuesApi>=repoIssuesApi):Readonly<RepoIssueStore>{
  const listeners=new Set<()=>void>()
  let snapshot:RepoIssueState=Object.freeze({repos:Object.freeze([]),selected:'',
    issues:Object.freeze([]),loading:false,error:'',availability:'target_required',
    actionUrl:null,targetUrl:''})
  let revision=0
  let controller:AbortController|null=null
  function getSnapshot(){return snapshot}
  function subscribe(listener:()=>void){
    listeners.add(listener)
    return ()=>{listeners.delete(listener)}
  }
  function publish(next:RepoIssueState){
    snapshot=Object.freeze({...next,
      repos:Object.freeze([...next.repos]),issues:Object.freeze([...next.issues])})
    listeners.forEach(listener=>listener())
  }
  function begin(){
    controller?.abort()
    controller=new AbortController()
    return {revision:++revision,signal:controller.signal}
  }
  function current(request:{revision:number;signal:AbortSignal}){
    return request.revision===revision&&!request.signal.aborted
  }
  async function loadIssues(repo:Repo,request:{revision:number;signal:AbortSignal}){
    try {
      const issues=await api.getIssues(repo.owner,repo.name,request.signal)
      if(current(request))publish({...snapshot,issues,loading:false,error:''})
    }catch(error){
      if(current(request))publish({...snapshot,issues:[],loading:false,
        error:error instanceof Error?error.message:'Issue 读取失败'})
    }
  }
  async function connect(url:string){
    const request=begin()
    const target=parseGitHubRepositoryUrl(url)
    if(!target){
      publish({...snapshot,repos:[],selected:'',issues:[],loading:false,
        error:'请输入完整的 https://github.com/owner/repo 地址',
        availability:'invalid_target',actionUrl:null,targetUrl:''})
      return
    }
    publish({...snapshot,repos:[],selected:'',issues:[],loading:true,error:'',
      availability:'checking',actionUrl:null,targetUrl:target.url})
    try{
      const repos=await api.getRepositories(request.signal,target)
      if(!current(request))return
      // Old isolated Fixture adapters may return multiple rows. Use only the
      // exact verified target; never trust or expose unrelated repository rows.
      const repo=repos.find(item=>item.full_name.toLowerCase()===target.full_name.toLowerCase())
      if(!repo)throw Error('GitHub Installation 未确认目标仓库')
      publish({...snapshot,repos:[repo],selected:repo.full_name,issues:[],
        loading:true,error:'',availability:'connected',actionUrl:null})
      await loadIssues(repo,request)
    }catch(error){
      if(!current(request))return
      const issue=error as Partial<RepoLookupError>
      publish({...snapshot,repos:[],selected:'',issues:[],loading:false,
        error:error instanceof Error?error.message:'仓库安装授权核验失败',
        availability:typeof issue.state==='string'?issue.state:'verification_error',
        actionUrl:typeof issue.actionUrl==='string'?issue.actionUrl:null})
    }
  }
  async function select(fullName:string){
    const repo=snapshot.repos.find(item=>item.full_name===fullName)
    if(!repo)return
    const request=begin()
    publish({...snapshot,selected:repo.full_name,loading:true,error:'',issues:[]})
    await loadIssues(repo,request)
  }
  async function refresh(){
    // Initial root mount must not call /api/repos with an unknown target.
    const target=snapshot.targetUrl
    if(target)await connect(target)
  }
  function dispose(){
    controller?.abort()
    revision++
    listeners.clear()
  }
  return Object.freeze({api,getSnapshot,subscribe,connect,select,refresh,dispose})
}
declare module '@deepseek-ai/cordis' {
  interface Context {repoIssues:RepoIssuesService}
}
/** @summary Cordis owns lifecycle; the scoped API remains an immutable plain object. */
export class RepoIssuesService extends Service {
  readonly store=createRepoIssuesStore()
  constructor(ctx:Context){
    super(ctx,'repoIssues')
    ctx.effect(()=>()=>this.store.dispose())
  }
}
