import { loginHref } from '../../github-access/src/access'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { browserRequest, record, type RequestFn } from '../../shared/src/browser-http'
import { emitSessionChanged } from '../../shared/src/session-change'
import styles from './SessionMenu.module.css'

interface PublicUser { readonly login: string; readonly avatarUrl: string | null }
type SessionState = { readonly state: 'loading' | 'anonymous' | 'authenticated' | 'error';
  readonly user: PublicUser | null }
const INITIAL:SessionState={state:'loading',user:null}

function validPublicUser(value:unknown):PublicUser|null {
  const user=record(value)
  if(!user||typeof user.login!=='string'||!/^[a-z\d-]{1,39}$/i.test(user.login))return null
  if(user.avatarUrl!==null){
    if(typeof user.avatarUrl!=='string')return null
    try{const url=new URL(user.avatarUrl)
      if(url.protocol!=='https:'||url.hostname!=='avatars.githubusercontent.com'||
         url.username||url.password)return null
    }catch{return null}
  }
  return {login:user.login,avatarUrl:user.avatarUrl}
}
/** @summary Keep the one mounted Header Session control independent of route state. */
export default function SessionMenu({request=browserRequest}:{request?:RequestFn}) {
  const { pathname } = useLocation()
  const [session,setSession]=useState<SessionState>(INITIAL)
  const [revision,setRevision]=useState(0)
  const [open,setOpen]=useState(false)
  const [pending,setPending]=useState(false)
  const [avatarFailed,setAvatarFailed]=useState(false)
  const [actionError,setActionError]=useState('')
  const wrapper=useRef<HTMLDivElement>(null)
  const trigger=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    const abort=new AbortController()
    setSession(INITIAL)
    void request('/api/github-session',{
      credentials:'same-origin',cache:'no-store',signal:abort.signal,
    }).then(async response=>{
      const body:unknown=await response.json()
      if(!response.ok)throw new Error('GitHub 登录状态暂不可用')
      const value=record(body)
      if(value?.authenticated===false)return {state:'anonymous',user:null} as SessionState
      if(value?.authenticated!==true)throw new Error('GitHub 登录响应格式无效')
      const user=validPublicUser(value.user)
      if(!user)throw new Error('GitHub 用户资料无效')
      return {state:'authenticated',user} as SessionState
    }).then(next=>{
      if(!abort.signal.aborted){setSession(next);setAvatarFailed(false)}
    }).catch(()=>{
      if(!abort.signal.aborted)setSession({state:'error',user:null})
    })
    return ()=>abort.abort()
  },[revision,request])
  useEffect(()=>{
    if(!open)return
    function outside(event:PointerEvent){
      if(event.target instanceof Node&&!wrapper.current?.contains(event.target)){
        setOpen(false)
      }
    }
    function keydown(event:KeyboardEvent){
      if(event.key==='Escape'){
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown',outside)
    document.addEventListener('keydown',keydown)
    return ()=>{
      document.removeEventListener('pointerdown',outside)
      document.removeEventListener('keydown',keydown)
    }
  },[open])
  const login=loginHref(pathname)
  async function logout(){
    if(pending)return
    setPending(true);setActionError('')
    try{
      const response=await request('/api/github-logout',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'X-LabourChain-Write':'1'},
      })
      const payload:unknown=await response.json()
      if(!response.ok||record(payload)?.authenticated!==false){
        throw new Error('退出登录失败，请重试')
      }
      setSession({state:'anonymous',user:null});setOpen(false);setAvatarFailed(false)
      emitSessionChanged()
    }catch{
      setActionError('退出登录失败，请重试')
    }finally{setPending(false)}
  }
  return <div className={styles.account} ref={wrapper}
    onBlur={event=>{
      if(!(event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)))setOpen(false)
    }}>
    {session.state==='loading'&&<span className={styles.status} role="status">
      正在检查 GitHub 登录…
    </span>}
    {session.state==='error'&&<span className={styles.status} role="alert">
      登录状态加载失败
      <button type="button" className={styles.retry}
        onClick={()=>setRevision(n=>n+1)}>重试</button>
    </span>}
    {session.state==='anonymous'&&<a className={styles.login} href={login}>
      使用 GitHub 登录
    </a>}
    {session.state==='authenticated'&&session.user&&<>
      <button type="button" ref={trigger} className={styles.trigger}
        aria-expanded={open} aria-controls="lc-account-menu"
        onClick={()=>setOpen(previous=>!previous)}>
        {session.user.avatarUrl&&!avatarFailed?
          <img className={styles.avatar} alt=""
            src={session.user.avatarUrl} onError={()=>setAvatarFailed(true)}/>:
          <span className={styles.fallback} aria-hidden="true">
            {session.user.login.slice(0,1).toUpperCase()}
          </span>}
        <span className={styles.username}>{session.user.login}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open&&<div className={styles.menu} id="lc-account-menu" role="group"
        aria-label="GitHub 账户操作">
        <span className={styles.menuUser}>@{session.user.login}</span>
        <button type="button" disabled={pending}
          onClick={()=>void logout()}>{pending?'正在退出…':'退出登录'}</button>
      </div>}
    </>}
    {actionError&&<p role="alert" className={styles.error}>{actionError}</p>}
  </div>
}
