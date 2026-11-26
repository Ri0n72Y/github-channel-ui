import { commentPermalink } from './quote-reply.mjs'
import type { LabourDraft, QuoteReply } from './view-model'

export type DraftKind = 'comment' | 'labour'
export const initialLabour: LabourDraft = { work:'', hours:'0.5', outcome:'', commits:'', start:'', end:'' }
type DraftData = { draft:string; quote:QuoteReply|null; labour:LabourDraft }
export type DraftRecord = { version:string; data:DraftData; pending:string|null }
export type DraftSnapshot = { record:DraftRecord; warning:string }
const prefix = 'labourchain:issue-draft:v1:'
const failedMessage = '当前浏览器无法可靠保存草稿或提交状态。草稿暂保留在此页面；刷新或关闭后无法保证恢复和防重复提交。'
const corruptMessage = '浏览器中的草稿或提交状态损坏。请先在 GitHub 核查提交结果，再确认解除锁定。'
const fresh = ():DraftRecord => ({version:'initial',data:{draft:'',quote:null,labour:{...initialLabour}},pending:null})
const token = () => globalThis.crypto.randomUUID()
const object = (v:unknown):Record<string,unknown>|null => v && typeof v==='object'&&!Array.isArray(v) ? v as Record<string,unknown>:null

export function draftKey(owner:string,repo:string,number:number,userId:number,kind:DraftKind,host='/'):string {
  return prefix+JSON.stringify([owner.toLowerCase(),repo.toLowerCase(),number,userId,kind,host])
}
function decode(raw:string|null,key:string):DraftRecord {
  if(raw===null)return fresh()
  const v=object(JSON.parse(raw)),data=object(v?.data),labour=object(data?.labour)
  if(!v||typeof v.version!=='string'||!v.version||v.version.length>100||
     !(v.pending===null||typeof v.pending==='string'&&v.pending.length>0&&v.pending.length<=100)||
     !data||typeof data.draft!=='string'||data.draft.length>20000||!labour)throw Error('invalid draft')
  const fields = Object.keys(initialLabour) as (keyof LabourDraft)[]
  if(fields.some(f=>typeof labour[f]!=='string'))throw Error('invalid labour')
  let quote:QuoteReply|null=null
  if(data.quote!==null){
    const q=object(data.quote)
    if(!q||typeof q.id!=='number'||!Number.isSafeInteger(q.id)||q.id<=0||
       typeof q.author!=='string'||!q.author.trim()||q.author.length>100||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(q.author)||
       typeof q.excerpt!=='string'||Array.from(q.excerpt).length>1000||q.excerpt.split('\n').length>12||
       /[\r\u2028\u2029]/u.test(q.excerpt)||typeof q.truncated!=='boolean')throw Error('invalid quote')
    const [owner,repo,number]=JSON.parse(key.slice(prefix.length))
    const url=commentPermalink(q.sourceUrl,owner,repo,number,q.id)
    if(q.sourceUrl!==null&&!url)throw Error('invalid quote URL')
    quote={id:q.id,author:q.author,excerpt:q.excerpt,truncated:q.truncated,sourceUrl:url}
  }
  return {version:v.version,pending:v.pending as string|null,data:{draft:data.draft,quote,
    labour:Object.fromEntries(fields.map(f=>[f,labour[f]])) as LabourDraft}}
}

/** A per-controller fallback, never shared across identities or resources. Storage read/modify/write
 * is synchronous and version/token checked, but localStorage has no cross-tab compare-and-swap. */
export class IssueDraftStore {
  private memory=new Map<string,DraftRecord>()
  private seen=new Map<string,string|null>()
  private unsaved=new Set<string>()
  private corrupt=new Set<string>()
  private inaccessible=new Set<string>()
  private conflict=new Set<string>()
  private conflictWarning='另一个标签页更新了本地草稿或提交状态。请复制此页未保存的内容，核查 GitHub 后重新打开讨论；此页不会覆盖另一标签的记录。'
  read(key:string):DraftSnapshot {
    let raw:string|null
    try {raw=window.localStorage.getItem(key);this.inaccessible.delete(key)}
    catch {
      this.inaccessible.add(key)
      const local=this.memory.get(key)||fresh()
      if(this.conflict.has(key))return {record:{...local,pending:'conflict'},warning:this.conflictWarning}
      if(this.corrupt.has(key))return {record:{...local,pending:local.pending||'corrupt'},warning:corruptMessage+' '+failedMessage}
      return {record:local,warning:failedMessage}
    }
    const local=this.memory.get(key)||fresh()
    if(this.unsaved.has(key)&&(!this.seen.has(key)||this.seen.get(key)!==raw)){
      this.conflict.add(key)
      return {record:{...local,pending:'conflict'},warning:this.conflictWarning}
    }
    if(this.conflict.has(key))return {record:{...local,pending:'conflict'},warning:this.conflictWarning}
    this.seen.set(key,raw)
    try {
      const remote=decode(raw,key)
      this.corrupt.delete(key)
      if(this.unsaved.has(key))return {record:local,warning:failedMessage}
      this.memory.set(key,remote)
      return {record:remote,warning:''}
    } catch {
      this.corrupt.add(key)
      const record={...local,pending:local.pending||'corrupt'}
      this.memory.set(key,record)
      return {record,warning:corruptMessage}
    }
  }
  private write(key:string,record:DraftRecord):DraftSnapshot {
    this.memory.set(key,record)
    if(this.conflict.has(key)||this.corrupt.has(key)||this.inaccessible.has(key)){
      this.unsaved.add(key)
      return {record,warning:this.conflict.has(key)?this.conflictWarning:this.corrupt.has(key)?corruptMessage:failedMessage}
    }
    try {
      const data=record.data
      const empty=!data.draft&&!data.quote&&Object.keys(initialLabour).every(f=>data.labour[f as keyof LabourDraft]===initialLabour[f as keyof LabourDraft])
      const raw=empty&&!record.pending?null:JSON.stringify(record)
      if(raw===null)window.localStorage.removeItem(key)
      else window.localStorage.setItem(key,raw)
      this.seen.set(key,raw)
      this.unsaved.delete(key)
      const saved=raw===null?fresh():record
      this.memory.set(key,saved)
      return {record:saved,warning:''}
    } catch {
      this.unsaved.add(key)
      return {record,warning:failedMessage}
    }
  }
  edit(key:string,change:(data:DraftData)=>DraftData):DraftSnapshot {
    const {record}=this.read(key)
    return this.write(key,{...record,version:token(),data:change(record.data)})
  }
  begin(key:string,expectedVersion:string):{token:string;version:string;snapshot:DraftSnapshot}|null {
    const {record}=this.read(key)
    if(record.pending||record.version!==expectedVersion)return null
    const id=record.version+':'+token()
    const snapshot=this.write(key,{...record,pending:id})
    return {token:id,version:record.version,snapshot}
  }
  settle(key:string,id:string,version:string,outcome:'success'|'rejected'|'unknown'):DraftSnapshot {
    const current=this.read(key)
    if(current.record.pending!==id||outcome==='unknown')return current
    const data=outcome==='success'&&current.record.version===version?fresh().data:current.record.data
    return this.write(key,{...current.record,data,pending:null})
  }
  unlock(key:string,expected:string):DraftSnapshot {
    const current=this.read(key)
    if(current.record.pending!==expected||this.conflict.has(key))return current
    this.corrupt.delete(key)
    return this.write(key,{...current.record,pending:null})
  }
}
export function blankSnapshot():DraftSnapshot {return {record:fresh(),warning:''}}
