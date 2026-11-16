export type ChannelIssue = {
  number: number
  title: string
  createdAt: string
  comments: number
  author: string | null
}
export type ChannelChoice = {
  label: string
  name: string
  issue: ChannelIssue | null
}
export type ChannelSnapshot = {
  state: 'ready' | 'config_missing' | 'invalid_config' | 'no_channels' |
    'sync_branch_missing' | 'snapshot_incomplete'
  branch: 'main'
  channels: readonly ChannelChoice[]
  headSha?: string
  pages?: number
  scannedIssues?: number
  error?: string
}

import { browserRequest, readResponse, record, requestFailure, responseObject,
  type RequestFn } from '../../shared/src/browser-http'
export interface ChannelApi {
  readonly getChannels:(owner:string,repo:string,signal:AbortSignal)=>Promise<ChannelSnapshot>
}
export function channelError(message:string,status:number){return requestFailure(message,status)}
function parseChannels(value:unknown):ChannelSnapshot{
  const body=responseObject(value,'Channel 服务响应无效')
  const states=['ready','config_missing','invalid_config','no_channels',
    'sync_branch_missing','snapshot_incomplete']
  if(!states.includes(String(body.state))||body.branch!=='main'||!Array.isArray(body.channels))
    throw channelError('Channel 服务数据不完整',502)
  const channels=body.channels.map(item=>{
    const row=responseObject(item),issue=row.issue===null?null:responseObject(row.issue)
    if(typeof row.label!=='string'||typeof row.name!=='string'||
      (issue&&(!Number.isSafeInteger(issue.number)||typeof issue.title!=='string'||
      typeof issue.createdAt!=='string'||typeof issue.comments!=='number'||
      (issue.author!==null&&typeof issue.author!=='string'))))
      throw channelError('Channel 项目数据无效',502)
    return {label:row.label as string,name:row.name as string,
      issue:issue?{number:issue.number as number,title:issue.title as string,
        createdAt:issue.createdAt as string,comments:issue.comments as number,
        author:issue.author as string|null}:null}
  })
  return {state:body.state as ChannelSnapshot['state'],branch:'main',channels,
    ...(typeof body.headSha==='string'?{headSha:body.headSha}:{}),
    ...(Number.isSafeInteger(body.pages)?{pages:body.pages as number}:{}),
    ...(Number.isSafeInteger(body.scannedIssues)?{scannedIssues:body.scannedIssues as number}:{}),
    ...(typeof body.error==='string'?{error:body.error}:{})}
}
/** @summary Read Channel data via a fixed ordinary function-only gateway. */
export function createChannelApi(request:RequestFn=browserRequest):Readonly<ChannelApi>{
  async function getChannels(owner:string,repo:string,signal:AbortSignal){
    const params=new URLSearchParams({owner,repo})
    const {body}=await readResponse(request,'/api/repo-channels?'+params,signal)
    return parseChannels(body)
  }
  return Object.freeze({getChannels})
}
export const channelApi=createChannelApi()
