import type { LabourDraft, QuoteReply } from './view-model'
export type DraftKind='comment'|'labour'
export const initialLabour:LabourDraft={work:'',hours:'0.5',outcome:'',commits:'',start:'',end:''}
type DraftData={draft:string;quote:QuoteReply|null;labour:LabourDraft}
export type DraftRecord={version:string;data:DraftData;pending:string|null}
export type DraftSnapshot={record:DraftRecord;warning:string}
const fresh=():DraftRecord=>({version:'initial',data:{draft:'',quote:null,labour:{...initialLabour}},pending:null})
const token=()=>globalThis.crypto.randomUUID()
export class IssueDraftStore{
 private records=new Map<string,DraftRecord>()
 read(key:string):DraftSnapshot{const record=this.records.get(key)||fresh();this.records.set(key,record);return {record,warning:''}}
 edit(key:string,change:(data:DraftData)=>DraftData):DraftSnapshot{const {record}=this.read(key),next={...record,version:token(),data:change(record.data)};this.records.set(key,next);return {record:next,warning:''}}
 begin(key:string,expectedVersion:string):{token:string;version:string;snapshot:DraftSnapshot}|null{const {record}=this.read(key);if(record.pending||record.version!==expectedVersion)return null;const id=record.version+':'+token(),next={...record,pending:id};this.records.set(key,next);return {token:id,version:record.version,snapshot:{record:next,warning:''}}}
 settle(key:string,id:string,version:string,outcome:'success'|'rejected'|'unknown'):DraftSnapshot{const {record}=this.read(key);if(record.pending!==id||outcome==='unknown')return {record,warning:''};const data=outcome==='success'&&record.version===version?fresh().data:record.data;const next={...record,data,pending:null};this.records.set(key,next);return {record:next,warning:''}}
 unlock(key:string,expected:string):DraftSnapshot{const {record}=this.read(key);if(record.pending!==expected)return {record,warning:''};const next={...record,pending:null};this.records.set(key,next);return {record:next,warning:''}}
}
export function draftKey(owner:string,repo:string,number:number,userId:number,kind:DraftKind,host='/'):string{return JSON.stringify([owner.toLowerCase(),repo.toLowerCase(),number,userId,kind,host])}
export function blankSnapshot():DraftSnapshot{return {record:fresh(),warning:''}}
