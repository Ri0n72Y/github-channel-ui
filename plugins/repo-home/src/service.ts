import type { Member } from './domain.mjs'
import { browserRequest, readResponse, record, requestFailure, requestStatus,
  responseObject, type RequestFn } from '../../shared/src/browser-http'

export type Team = { readonly state: 'ready' | 'empty' | 'missing' | 'invalid' | 'error';
  readonly members: readonly Member[]; readonly error?: string; readonly sha?: string | null }
export type RepoHomeData = {
  readonly repository: { readonly full_name: string; readonly name: string;
    readonly description: string | null; readonly html_url: string; readonly default_branch: string }
  readonly branch: string
  readonly readme: { readonly state: 'ready' | 'missing' | 'error';
    readonly content?: string; readonly path?: string; readonly error?: string }
  readonly team: Team
}
export type RepoFeedIssue = { readonly id: number; readonly number: number; readonly state: string;
  readonly title: string; readonly body: string | null; readonly html_url: string;
  readonly updated_at: string; readonly user?: { readonly login: string } | null;
  readonly pull_request?: unknown }
export type RepoFeedPage = { readonly page: number; readonly items: readonly RepoFeedIssue[];
  readonly hasMore: boolean }
export type MemberCapability = { readonly user: { readonly login: string; readonly id: number };
  readonly branch: string; readonly protected: boolean; readonly mode: 'pr' | 'commit' }
export type MemberSubmitResult = { readonly status: 'committed' | 'pending_pr';
  readonly url: string; readonly sha: string; readonly requestedBy: string }

export interface RepoHomeApi {
  readonly getHome: (owner: string, repo: string, branch: string, signal: AbortSignal) => Promise<RepoHomeData>
  readonly getFeed: (owner: string, repo: string, page: number, signal: AbortSignal,
    labelFilter?: readonly string[]) => Promise<RepoFeedPage>
  readonly getCapability: (owner: string, repo: string, branch: string,
    signal: AbortSignal) => Promise<MemberCapability>
  readonly register: (owner: string, repo: string, branch: string, member: Omit<Member,'id'>,
    signal: AbortSignal) => Promise<MemberSubmitResult>
}

export function repoHomeError(message: string, status: number): Error & { readonly status: number } {
  return requestFailure(message, status)
}
export function repoHomeStatus(error: unknown): number { return requestStatus(error) }
export function displayBranchKey(owner: string, repo: string) {
  return 'labourchain:display-branch:' + owner.toLowerCase() + '/' + repo.toLowerCase()
}
export function readDisplayBranch(owner: string, repo: string) {
  try { return localStorage.getItem(displayBranchKey(owner, repo)) || 'main' }
  catch { return 'main' }
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw repoHomeError('仓库响应字段无效：' + name, 502)
  return value
}
function parseTeam(value: unknown): Team {
  const team = responseObject(value)
  if (!['ready','empty','missing','invalid','error'].includes(String(team.state)) ||
      !Array.isArray(team.members)) throw repoHomeError('成员数据响应无效', 502)
  const members = team.members.map(item => {
    const member = responseObject(item)
    const links = member.links
    if (links !== undefined && (!Array.isArray(links) || links.some(link => {
      const v = record(link)
      return !v || typeof v.label !== 'string' || typeof v.url !== 'string'
    }))) throw repoHomeError('成员链接响应无效', 502)
    return {
      id: requiredString(member.id, 'member.id'), name: requiredString(member.name, 'member.name'),
      ...(typeof member.role === 'string' ? {role:member.role} : {}),
      ...(typeof member.bio === 'string' ? {bio:member.bio} : {}),
      ...(typeof member.githubUsername === 'string' ? {githubUsername:member.githubUsername} : {}),
      ...(typeof member.avatarUrl === 'string' ? {avatarUrl:member.avatarUrl} : {}),
      ...(Array.isArray(links) ? {links:links.map(v => ({
        label: requiredString(record(v)?.label, 'link.label'),
        url: requiredString(record(v)?.url, 'link.url'),
      }))} : {}),
    }
  })
  return {
    state: team.state as Team['state'], members,
    ...(typeof team.error === 'string' ? {error:team.error} : {}),
    ...(typeof team.sha === 'string' || team.sha === null ? {sha:team.sha} : {}),
  }
}
function parseHome(value: unknown): RepoHomeData {
  const body = responseObject(value)
  const repo = responseObject(body.repository)
  const readme = responseObject(body.readme)
  if (!['ready','missing','error'].includes(String(readme.state))) {
    throw repoHomeError('README 状态无效', 502)
  }
  return {
    repository: {
      full_name: requiredString(repo.full_name, 'full_name'),
      name: requiredString(repo.name, 'name'),
      description: repo.description === null ? null : requiredString(repo.description, 'description'),
      html_url: requiredString(repo.html_url, 'html_url'),
      default_branch: requiredString(repo.default_branch, 'default_branch'),
    },
    branch: requiredString(body.branch, 'branch'),
    readme: {
      state: readme.state as RepoHomeData['readme']['state'],
      ...(typeof readme.content === 'string' ? {content:readme.content} : {}),
      ...(typeof readme.path === 'string' ? {path:readme.path} : {}),
      ...(typeof readme.error === 'string' ? {error:readme.error} : {}),
    },
    team: parseTeam(body.team),
  }
}
function parseFeed(value: unknown): RepoFeedPage {
  const body = responseObject(value)
  if (!Array.isArray(body.items) || typeof body.hasMore !== 'boolean' ||
      !Number.isSafeInteger(body.page)) throw repoHomeError('Issue Feed 响应无效', 502)
  const items = body.items.map(item => {
    const row = responseObject(item)
    if (!Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.number)) {
      throw repoHomeError('Issue 编号无效', 502)
    }
    const user = row.user == null ? null : responseObject(row.user)
    return {
      id: row.id as number, number: row.number as number,
      state: requiredString(row.state,'state'), title: requiredString(row.title,'title'),
      body: row.body === null ? null : requiredString(row.body,'body'),
      html_url: requiredString(row.html_url,'html_url'),
      updated_at: requiredString(row.updated_at,'updated_at'),
      user: user === null ? null : { login: requiredString(user.login,'login') },
    }
  })
  return { page: body.page as number, items, hasMore: body.hasMore }
}
function parseCapability(value: unknown): MemberCapability {
  const data=responseObject(value), user=responseObject(data.user)
  if (!Number.isSafeInteger(user.id) || typeof data.protected !== 'boolean' ||
      (data.mode !== 'pr' && data.mode !== 'commit')) {
    throw repoHomeError('成员权限响应无效', 502)
  }
  return {user:{id:user.id as number,login:requiredString(user.login,'login')},
    branch:requiredString(data.branch,'branch'), protected:data.protected, mode:data.mode}
}
function parseRegistration(value: unknown): MemberSubmitResult {
  const data=responseObject(value)
  if (data.status !== 'committed' && data.status !== 'pending_pr') {
    throw repoHomeError('成员提交响应无效', 502)
  }
  return {status:data.status,url:requiredString(data.url,'url'),sha:requiredString(data.sha,'sha'),
    requestedBy:requiredString(data.requestedBy,'requestedBy')}
}
function params(owner:string,repo:string,extra:Record<string,string>={}){
  return new URLSearchParams({owner,repo,...extra}).toString()
}
/** @summary Publish a fixed, immutable API; native fetch uses its original global receiver. */
export function createRepoHomeApi(request:RequestFn=browserRequest):Readonly<RepoHomeApi>{
  async function getHome(owner:string,repo:string,branch:string,signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-home?'+params(owner,repo,{branch}),signal)
    return parseHome(body)
  }
  async function getFeed(owner:string,repo:string,page:number,signal:AbortSignal,
    labels:readonly string[]=[]){
    const query:Record<string,string>={page:String(page)}
    if(labels.length)query.labels=labels.join(',')
    const {body}=await readResponse(request,'/api/repo-feed?'+params(owner,repo,query),signal)
    return parseFeed(body)
  }
  async function getCapability(owner:string,repo:string,branch:string,signal:AbortSignal){
    const {body}=await readResponse(request,
      '/api/repo-member-permission?'+params(owner,repo,{branch}),signal)
    return parseCapability(body)
  }
  async function register(owner:string,repo:string,branch:string,member:Omit<Member,'id'>,
    signal:AbortSignal){
    const {body}=await readResponse(request,'/api/repo-member-register',signal,{
      method:'POST',headers:{'Content-Type':'application/json','X-LabourChain-Write':'1'},
      body:JSON.stringify({owner,repo,branch,member}),
    })
    try { return parseRegistration(body) }
    catch (error) {
      throw requestFailure(error instanceof Error ? error.message : '成员写入响应无效',
        502, { outcomeUnknown: true })
    }
  }
  return Object.freeze({getHome,getFeed,getCapability,register})
}
export const repoHomeApi=createRepoHomeApi()
