
import { browserRequest, readResponse, requestState, requestStatus, responseObject, type RequestFn } from '../../shared/src/browser-http'
import { validLoginReturnPath } from '../../repo-issues/src/target.mjs'

const accessStates = ['repo_access_required','repository_unavailable','installation_suspended',
  'needs_installation','needs_repository_authorization'] as const
export type RepoAccessReason = typeof accessStates[number]
export function repoAccessReason(error:unknown): RepoAccessReason | null {
  const state=requestState(error)
  return accessStates.find(value=>value===state) || null
}
export function officialActionUrl(value:unknown):string|undefined {
  if(typeof value!=='string' || /[\s%\\?#]/u.test(value))return undefined
  return /^https:\/\/github\.com\/(?:apps\/[a-z\d-]{1,100}\/installations\/new|(?:settings|organizations\/[a-z\d-]{1,39}\/settings)\/installations\/[1-9]\d*\/?)$/i
    .test(value) ? value : undefined
}
export function loginHref(path:string) {
  return '/api/github-login?'+new URLSearchParams({return_to:validLoginReturnPath(path)})
}
export type AccessResult = {state:RepoAccessReason|'connected'|'login_required'|'rate_limited'|'probe_error'; actionUrl?:string}
export async function inspectRepoAccess(owner:string,repo:string,signal:AbortSignal,request:RequestFn=browserRequest):Promise<AccessResult> {
  try {
    if(!await readSessionStatus(signal,request))return {state:'login_required'}
    if(signal.aborted)throw new DOMException('Aborted','AbortError')
    const {body}=await readResponse(request,'/api/github-installation-probe?'+new URLSearchParams({owner,repo}),signal)
    const result=responseObject(body)
    if(result.state!=='repository_unavailable' && (typeof result.repository!=='string' ||
        result.repository.toLowerCase()!==(owner+'/'+repo).toLowerCase()))return {state:'probe_error'}
    if(result.state==='connected')return {state:'connected'}
    if(accessStates.some(value=>value===result.state) && result.state!=='repo_access_required')
      return {state:result.state as RepoAccessReason,actionUrl:officialActionUrl(result.action_url)}
    return {state:'probe_error'}
  }catch(error){
    if(signal.aborted)throw error
    return {state:requestStatus(error)===401?'login_required':requestStatus(error)===429?'rate_limited':'probe_error'}
  }
}
export async function readSessionStatus(signal:AbortSignal,request:RequestFn=browserRequest):Promise<boolean>{
  const {body}=await readResponse(request,'/api/github-session',signal)
  const value=responseObject(body).authenticated
  if(typeof value!=='boolean')throw Error('Session 响应无效')
  return value
}
