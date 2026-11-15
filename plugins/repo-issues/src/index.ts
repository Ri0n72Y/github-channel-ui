import { Service, type Context } from '@deepseek-ai/cordis'
import { repoIssuesApi, type Repo, type Issue, type RepoIssuesApi } from './api'
export type { Repo, Issue } from './api'

export interface RepoIssueState {
  readonly repos:readonly Repo[]; readonly selected:string; readonly issues:readonly Issue[];
  readonly loading:boolean;readonly error:string
}
export interface RepoIssueStore {
  readonly api:Readonly<RepoIssuesApi>
  readonly getSnapshot:()=>RepoIssueState
  readonly subscribe:(listener:()=>void)=>(()=>void)
  readonly select:(fullName:string)=>Promise<void>
  readonly refresh:()=>Promise<void>
  readonly dispose:()=>void
}
/** @summary Store new immutable Issue snapshots without exposing an HTTP Service instance. */
export function createRepoIssuesStore(api:Readonly<RepoIssuesApi>=repoIssuesApi):Readonly<RepoIssueStore>{
  const listeners=new Set<()=>void>()
  let snapshot:RepoIssueState=Object.freeze({repos:Object.freeze([]),selected:'',
    issues:Object.freeze([]),loading:false,error:''})
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
  async function select(fullName:string){
    const repo=snapshot.repos.find(item=>item.full_name===fullName)
    if(!repo)return
    const current=begin()
    publish({...snapshot,selected:fullName,loading:true,error:'',issues:[]})
    try{
      const issues=await api.getIssues(repo.owner,repo.name,current.signal)
      if(current.revision===revision&&!current.signal.aborted)
        publish({...snapshot,issues,loading:false})
    }catch(error){
      if(current.revision===revision&&!current.signal.aborted)
        publish({...snapshot,loading:false,error:error instanceof Error?error.message:'Issue 读取失败'})
    }
  }
  async function refresh(){
    const current=begin()
    publish({...snapshot,loading:true,error:''})
    try{
      const repos=await api.getRepositories(current.signal)
      if(current.revision!==revision||current.signal.aborted)return
      const selected=repos.some(repo=>repo.full_name===snapshot.selected)?
        snapshot.selected:repos[0]?.full_name||''
      publish({...snapshot,repos,selected,issues:[],loading:false})
      if(selected)await select(selected)
    }catch(error){
      if(current.revision===revision&&!current.signal.aborted)
        publish({...snapshot,loading:false,error:error instanceof Error?error.message:'仓库读取失败'})
    }
  }
  function dispose(){
    controller?.abort()
    revision++
    listeners.clear()
  }
  return Object.freeze({api,getSnapshot,subscribe,select,refresh,dispose})
}
declare module '@deepseek-ai/cordis' {
  interface Context {repoIssues:RepoIssuesService}
}
/** @summary Bridge Cordis plugin lifecycle only; business API remains a frozen plain object. */
export class RepoIssuesService extends Service {
  readonly store=createRepoIssuesStore()
  constructor(ctx:Context){
    super(ctx,'repoIssues')
    ctx.effect(()=>()=>this.store.dispose())
  }
}
