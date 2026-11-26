import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { inspectRepoAccess, loginHref, type AccessResult, type RepoAccessReason } from './access'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import type { RequestFn } from '../../shared/src/browser-http'
import styles from './RepoAccessNotice.module.css'

const AccessRequestContext=createContext<RequestFn|undefined>(undefined)
export function RepoAccessRequestProvider({request,children}:{request:RequestFn;children:ReactNode}){
  return <AccessRequestContext.Provider value={request}>{children}</AccessRequestContext.Provider>
}
const labels: Record<AccessResult['state'],string> = {
  repo_access_required:'需要核验 GitHub App 仓库授权',
  repository_unavailable:'仓库不存在、不可访问或不是公开仓库',
  installation_suspended:'GitHub App 安装已暂停，请联系安装管理员',
  needs_installation:'此仓库尚未安装 GitHub App',
  needs_repository_authorization:'此仓库未包含在 GitHub App 授权范围内',
  connected:'当前仓库已授权，可以重新读取',
  login_required:'登录 GitHub 后才能核验安装或管理授权',
  rate_limited:'GitHub API 限流，请稍后重试',
  probe_error:'暂时无法确认仓库授权，请重试',
}
/** One notice per page. Probe only after a structured read denial; no success-path request. */
export default function RepoAccessNotice({owner,repo,reason,onRetry,request,retryDisabled=false}:{
  owner:string;repo:string;reason:RepoAccessReason;onRetry():void;request?:RequestFn;retryDisabled?:boolean
}) {
  const {pathname}=useLocation()
  const inheritedRequest=useContext(AccessRequestContext)
  const activeRequest=request??inheritedRequest
  const [revision,setRevision]=useState(0)
  useEffect(()=>subscribeSessionChanged(()=>setRevision(n=>n+1)),[])
  const [result,setResult]=useState<{key:string;value:AccessResult}|null>(null)
  const key=owner+'/'+repo+'/'+reason+'/'+revision
  useEffect(()=>{
    if(reason!=='repo_access_required'&&reason!=='needs_installation'&&reason!=='needs_repository_authorization')return
    const abort=new AbortController()
    // StrictMode setup/cleanup must not start duplicate probes.
    const timer=setTimeout(()=>{void inspectRepoAccess(owner,repo,abort.signal,activeRequest).then(value=>{
      if(!abort.signal.aborted)setResult({key,value})
    }).catch(()=>{})},0)
    return()=>{clearTimeout(timer);abort.abort()}
  },[owner,repo,reason,key,activeRequest])
  const value:AccessResult=result?.key===key?result.value:{state:reason}
  return <section className={styles.notice} aria-label="仓库访问授权">
    <h2>仓库访问状态</h2>
    <p role="status">{labels[value.state]}</p>
    {value.state==='login_required'&&<a href={loginHref(pathname)}>登录 GitHub</a>}
    {value.actionUrl&&<a href={value.actionUrl} target="_blank" rel="noopener noreferrer">前往 GitHub 安装或管理授权</a>}
    <button type="button" disabled={retryDisabled} onClick={onRetry}>重新核验并读取</button>
  </section>
}
