import { parseGitHubRepositoryUrl } from '../../repo-issues/src/target.mjs'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { repoAccessReason } from '../../github-access/src/access'
import { useParams, useLocation, useNavigate } from 'react-router'
import type { Context } from '@deepseek-ai/cordis'
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { RepoIssueStore } from '../../repo-issues/src/index'
import type { Verification as GithubVerification } from '../../repo-issues/src/api'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import { IssueWorkspace } from './issue-workspace'
import styles from './RepoPanel.module.css'

type Verification = { status: 'idle' | 'loading' | 'success' | 'error'; data?: GithubVerification; message?: string; relogin?: boolean }

/** @summary Display the repositories and Issues exposed by the repository service. */
export function RepoPanel({ store }: { store: RepoIssueStore }) {
  const {owner,repo} = useParams<'owner'|'repo'>()
  const location = useLocation()
  const navigate=useNavigate()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const s=owner&&repo&&snapshot.targetUrl.toLowerCase()!==('https://github.com/'+owner+'/'+repo).toLowerCase()
    ? {...snapshot,repos:[],selected:'',issues:[],error:'',availability:'checking',actionUrl:null,targetUrl:'',loading:true}:snapshot
  const accessReason=repoAccessReason(Object.assign(new Error(s.error),{state:s.availability}))
  const [session, setSession] = useState<'checking' | 'connected' | 'anonymous' | 'error'>('checking')
  const [verification, setVerification] = useState<Verification>({ status: 'idle' })
  const verifyRevision = useRef(0)
  const verifyAbort = useRef<AbortController|null>(null)
  const [sessionRevision,setSessionRevision]=useState(0)
  const [repositoryUrl,setRepositoryUrl]=useState('')
  useEffect(()=>subscribeSessionChanged(()=>{
    setSessionRevision(n=>n+1);setVerification({status:'idle'})
  }),[])

  function submitRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    verifyRevision.current++
    verifyAbort.current?.abort()
    setVerification({ status: 'idle' })
    const target=parseGitHubRepositoryUrl(repositoryUrl)
    if(target&&owner&&repo&&target.full_name.toLowerCase()!==(owner+'/'+repo).toLowerCase())navigate('/'+target.owner+'/'+target.name+'/issues')
    else void store.connect(repositoryUrl)
  }

  async function verifyUserAndRepo() {
    const repo = s.repos.find(item => item.full_name === s.selected)
    if (!repo || session !== 'connected') return
    const revision = ++verifyRevision.current
    verifyAbort.current?.abort()
    const controller=new AbortController()
    verifyAbort.current=controller
    setVerification({ status: 'loading' })
    try {
      const data=await store.api.verify(repo.owner,repo.name,controller.signal)
      if (revision !== verifyRevision.current || controller.signal.aborted) return
      setVerification({status:'success',data})
    } catch (error) {
      if (revision !== verifyRevision.current || controller.signal.aborted) return
      setVerification({status:'error',
        message:error instanceof Error?error.message:'网络请求失败',
        relogin:Boolean(error instanceof Error&&'relogin' in error&&error.relogin===true)})
    }
  }

  useEffect(()=>{verifyRevision.current++;verifyAbort.current?.abort();setVerification({status:'idle'});if(owner&&repo) {const url='https://github.com/'+owner+'/'+repo;setRepositoryUrl(url);void store.connect(url)} return ()=>{store.cancel();verifyRevision.current++;verifyAbort.current?.abort()}},[store,owner,repo])
  useEffect(()=>{
    const controller=new AbortController()
    setSession('checking')
    void store.api.getSession(controller.signal).then(connected=>{
      if(!controller.signal.aborted)setSession(connected?'connected':'anonymous')
    }).catch(()=>{
      if(!controller.signal.aborted)setSession('error')
    })
    return ()=>{
      controller.abort();verifyRevision.current++;verifyAbort.current?.abort()
    }
  },[store,sessionRevision])
  return <div className={styles.shell}>
    <header><h1>LabourChain · Issues</h1><div className={styles.actions}>
      {session === 'connected'
        ? <span className={styles.sessionStatus}>GitHub 会话已建立</span>
        : session === 'checking'
          ? <span className={styles.sessionStatus}>检查登录状态…</span>
          : session === 'error'
            ? <button type="button" onClick={()=>setSessionRevision(n=>n+1)}>登录状态检查失败，重试</button>
            : <a href={'/api/github-login?'+new URLSearchParams({return_to:location.pathname})}>使用 GitHub 登录</a>}
      <button type="button" disabled={!s.targetUrl || s.loading} onClick={() => {
        verifyRevision.current++
        verifyAbort.current?.abort()
        setVerification({ status: 'idle' })
        void store.refresh()
      }}>重新核验</button>
    </div></header>
    <p>输入要查看的公开 GitHub 仓库 URL。系统只读取目标仓库 Issues，明确授权失败时才引导核验。</p>
    <form className={styles.repoForm} onSubmit={submitRepository}>
      <label htmlFor="lc-repo-url">GitHub 仓库 URL</label>
      <input id="lc-repo-url" className={styles.repoInput} type="url"
        autoComplete="url" required value={repositoryUrl}
        placeholder="https://github.com/owner/repo"
        onChange={event => setRepositoryUrl(event.target.value)} />
      <button type="submit">打开仓库 Issues</button>
    </form>
    {s.availability === 'checking' && <p role="status">正在核验公开仓库与 GitHub App 授权…</p>}
    {s.availability === 'connected' && <p role="status">已验证公开仓库：{s.selected}</p>}
    {s.actionUrl && !accessReason && <p><a href={s.actionUrl} target="_blank" rel="noopener noreferrer">
      前往 GitHub 安装或管理授权</a></p>}
    {session === 'connected' && <section className={styles.verification}>
      <button type="button" disabled={!s.selected || verification.status === 'loading'}
        onClick={() => void verifyUserAndRepo()}>验证 GitHub 身份与仓库权限</button>
      {verification.status === 'loading' && <p role="status">正在向 GitHub 验证…</p>}
      {verification.status === 'error' && <p role="alert">验证失败：{verification.message}
        {verification.relogin && <> · <a href="/api/github-login">重新登录</a></>}</p>}
      {verification.status === 'success' && verification.data && <div role="status">
        <p>GitHub 用户：{verification.data.user.login}（ID {verification.data.user.id}）</p>
        <p>仓库 {verification.data.repository.full_name}：
          {verification.data.repository.accessible ? '当前用户可通过 App 访问' : '当前用户无法通过 App 访问'}</p>
        {verification.data.repository.permissions && <p>GitHub 返回的仓库权限：
          {(['admin', 'maintain', 'push', 'triage', 'pull'] as const)
            .filter(key => verification.data!.repository.permissions?.[key])
            .join('、') || '无已知权限'}</p>}
        <small>此处只验证读取和 GitHub 返回的权限信息，不代表 Issue 写入已经授权或测试。</small>
      </div>}
    </section>}
    {s.loading && s.availability === 'connected' && <p role="status">正在读取该仓库的 Issues…</p>}
    {accessReason&&s.targetUrl&&<RepoAccessNotice owner={s.targetUrl.split('/')[3]} repo={s.targetUrl.split('/')[4]} reason={accessReason} onRetry={()=>void store.refresh()}/>}
    {s.error && !accessReason && <p role="alert">{s.error}</p>}
    {s.repos.find(repo => repo.full_name === s.selected) && <IssueWorkspace
        key={s.selected}
        repo={s.repos.find(repo => repo.full_name === s.selected)!}
        issues={s.issues}
        loggedIn={session === 'connected'} api={store.api} />}
    <footer>仓库必须公开且已授权给当前 GitHub App。匿名用户可浏览；创建 Issue 或评论需 GitHub OAuth 和独立写入授权。</footer>
  </div>
}

/** @summary Contribute the Issues panel while both Cordis services are available. */
export const repoPanel = {
  name: 'repo-panel',
  inject: ['reactUI', 'repoIssues'],
  apply(ctx: Context) {
    const store = ctx.repoIssues.store
    function RepoPanelEntry() {
      return <RepoPanel store={store} />
    }
    ctx.effect(() => ctx.reactUI.registerPage({
      id: 'repo-panel', path: '/:owner/:repo/issues', Component: RepoPanelEntry,
    }))
  },
}
