export function createTopicReadCache<T>(options:{ttl:number;limit:number;now?:()=>number}):{
  get(key:string,load:()=>Promise<T>,refresh?:boolean):Promise<T>
  has(key:string):boolean
  invalidate(prefix:string):void
}
