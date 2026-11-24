export class TopicReadCacheBusyError extends Error {
  readonly status:503
  readonly stage:'source'
}
export function createTopicReadCache<T>(options:{ttl:number;limit:number;now?:()=>number}):{
  get(key:string,load:()=>Promise<T>,refresh?:boolean,onReplace?:()=>void):Promise<T>
  has(key:string):boolean
  peek(key:string):T|undefined
  invalidate(prefix:string):void
}
