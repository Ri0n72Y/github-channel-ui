import type { RequestFn } from '../../../plugins/shared/src/browser-http'

/** @summary Isolate Header auth, token expiry and logout failures without GitHub writes. */
export function createSessionFixture(query:URLSearchParams):Readonly<{
  request:RequestFn; isAuthenticated:()=>boolean
}>{
  const mode=query.get('sessionCase')||'anonymous'
  let signedIn=['authenticated','avatar-fail','logout-error'].includes(mode)
  async function request(input:RequestInfo|URL,init:RequestInit={}){
    const url=String(input),method=init.method||'GET'
    if(init.signal?.aborted)throw new DOMException('Aborted','AbortError')
    if(url==='/api/github-session'&&method==='GET'){
      if(mode==='network')return Response.json({error:'受控 Session 网络失败'},{status:503})
      if(!signedIn)return Response.json({authenticated:false})
      return Response.json({authenticated:true,user:{
        login:'fixture-user',
        avatarUrl:mode==='avatar-fail'?
          'https://avatars.githubusercontent.com/not-found-fixture.png':
          'https://avatars.githubusercontent.com/u/42?v=4',
      }})
    }
    if(url==='/api/github-logout'&&method==='POST'){
      if(init.headers==null||new Headers(init.headers).get('X-LabourChain-Write')!=='1')
        return Response.json({error:'Fixture 缺少写入防护头'},{status:403})
      if(mode==='logout-error')return Response.json({error:'受控退出失败'},{status:503})
      signedIn=false
      return Response.json({authenticated:false})
    }
    throw Error('Unexpected Session Fixture request: '+method+' '+url)
  }
  return Object.freeze({request,isAuthenticated:()=>signedIn})
}
