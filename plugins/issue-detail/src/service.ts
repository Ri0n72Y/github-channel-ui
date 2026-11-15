export type GithubIssue = {
  number: number; title: string; body: string | null; state: string; html_url: string;
  labels: ReadonlyArray<string | { name: string }>; comments: number;
  user?: { login: string }; created_at?: string; updated_at?: string;
  closed_at?: string | null; locked?: boolean; pull_request?: unknown;
  [field: string]: unknown
}
export type GithubComment = {
  id: number; body: string; html_url: string; created_at: string;
  user?: { login: string }; [field: string]: unknown
}
export type GithubVerification = {
  user: { id: number; login: string }
  repository: { full_name: string; accessible: boolean;
    permissions: Readonly<{ admin: boolean; maintain: boolean; push: boolean;
      triage: boolean; pull: boolean }> | null }
}

import { browserRequest, readResponse, record, requestFailure, requestStatus,
  responseObject, type RequestFn } from '../../shared/src/browser-http'

export interface IssueDetailApi {
  readonly getIssue:(owner:string,repo:string,number:number,signal:AbortSignal)=>Promise<GithubIssue>
  readonly getConfig:(owner:string,repo:string,signal:AbortSignal)=>Promise<string>
  readonly getComments:(owner:string,repo:string,number:number,page:number,signal:AbortSignal)=>
    Promise<{readonly items:readonly GithubComment[];readonly hasMore:boolean}>
  readonly getSession:(signal:AbortSignal)=>Promise<boolean>
  readonly verify:(owner:string,repo:string,signal:AbortSignal)=>Promise<GithubVerification>
  readonly postComment:(owner:string,repo:string,number:number,body:string,
    signal:AbortSignal)=>Promise<GithubComment>
}
export function issueRequestError(message:string,status:number,relogin=false){
  return requestFailure(message,status,{relogin})
}
export function issueRequestStatus(error:unknown){return requestStatus(error)}
function query(owner:string,repo:string,number?:number,page?:number){
  const q=new URLSearchParams({owner,repo})
  if(number!==undefined)q.set('number',String(number))
  if(page!==undefined)q.set('page',String(page))
  return '?'+q.toString()
}
function requiredString(v:unknown,field:string):string{
  if(typeof v!=='string')throw issueRequestError('Issue 响应字段无效：'+field,502)
  return v
}
function parseIssue(value:unknown):GithubIssue{
  const issue=responseObject(value,'Issue 响应无效')
  if(!Number.isSafeInteger(issue.number)||!Array.isArray(issue.labels)||
    issue.labels.some(label=>typeof label!=='string'&&
      typeof record(label)?.name!=='string')||!Number.isSafeInteger(issue.comments)){
    throw issueRequestError('Issue 字段无效',502)
  }
  return {...issue,number:issue.number as number,
    title:requiredString(issue.title,'title'),
    body:issue.body===null?null:requiredString(issue.body,'body'),
    state:requiredString(issue.state,'state'),
    html_url:requiredString(issue.html_url,'html_url'),
    labels:issue.labels as Array<string|{name:string}>,comments:issue.comments as number}
}
function parseComment(value:unknown):GithubComment{
  const v=responseObject(value,'Issue 评论无效')
  if(!Number.isSafeInteger(v.id))throw issueRequestError('Issue 评论编号无效',502)
  return {...v,id:v.id as number,body:requiredString(v.body,'body'),
    html_url:requiredString(v.html_url,'html_url'),
    created_at:requiredString(v.created_at,'created_at')}
}
function parseVerification(value:unknown):GithubVerification{
  const data=responseObject(value,'GitHub 用户身份响应无效')
  const user=responseObject(data.user),repository=responseObject(data.repository)
  if(!Number.isSafeInteger(user.id)||typeof repository.accessible!=='boolean')
    throw issueRequestError('GitHub 用户权限响应无效',502)
  const permissions=repository.permissions===null?null:responseObject(repository.permissions)
  return {user:{id:user.id as number,login:requiredString(user.login,'login')},
    repository:{full_name:requiredString(repository.full_name,'full_name'),
      accessible:repository.accessible,
      permissions:permissions?{
        admin:permissions.admin===true,maintain:permissions.maintain===true,
        push:permissions.push===true,triage:permissions.triage===true,
        pull:permissions.pull===true}:null}}
}
/** @summary Expose stable Issue reads and a single user-confirmed OAuth comment POST. */
export function createIssueDetailApi(request:RequestFn=browserRequest):Readonly<IssueDetailApi>{
  async function getIssue(owner:string,repo:string,number:number,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/issue-detail'+query(owner,repo,number),signal)
    return parseIssue(body)
  }
  async function getConfig(owner:string,repo:string,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/issue-config'+query(owner,repo),signal)
    const config=responseObject(body)
    if(config.encoding!=='base64'||typeof config.content!=='string')
      throw issueRequestError('Invalid repository configuration encoding',422)
    try {
      const bytes=Uint8Array.from(atob(config.content.replace(/\s/g,'')),c=>c.charCodeAt(0))
      return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
    } catch {throw issueRequestError('Repository configuration cannot be decoded',422)}
  }
  async function getComments(owner:string,repo:string,number:number,page:number,signal:AbortSignal){
    const {body,response}=await readResponse(request,
      '/api/issue-comments'+query(owner,repo,number,page),signal)
    if(!Array.isArray(body))throw issueRequestError('Invalid comments page',502)
    return {items:body.map(parseComment),
      hasMore:/<[^>]+>;\s*rel="next"/.test(response.headers.get('link')||'')}
  }
  async function getSession(signal:AbortSignal){
    const {body}=await readResponse(request,'/api/github-session',signal)
    return responseObject(body).authenticated===true
  }
  async function verify(owner:string,repo:string,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/github-verify'+query(owner,repo),signal)
    return parseVerification(body)
  }
  async function postComment(owner:string,repo:string,number:number,content:string,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/github-issue-comment',signal,{
      method:'POST',headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({owner,repo,number,body:content}),
    })
    return parseComment(responseObject(body).comment)
  }
  return Object.freeze({getIssue,getConfig,getComments,getSession,verify,postComment})
}
export const issueDetailApi=createIssueDetailApi()
