import { loginHref } from '../../github-access/src/access'
import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { repoIssuesApi, type Repo, type RepoIssuesApi } from '../../repo-issues/src/api'
import { parseGitHubRepositoryUrl } from '../../repo-issues/src/target.mjs'
import { uncertainWriteResult } from '../../shared/src/browser-http'
import styles from './RepoIssueCreatePage.module.css'

type ScopedIssueApi = Pick<RepoIssuesApi, 'getRepositories' | 'getSession' | 'createIssue'>
type Status = 'checking' | 'anonymous' | 'ready' | 'error'

/** Reject cross-repository, protocol, redirect, and non-Issue links after a possibly successful write. */
export function trustedCreatedIssueUrl(url: string, number: number, repo: Repo): string | null {
  try {
    const target = new URL(url)
    if (target.origin !== 'https://github.com' || target.username || target.password ||
        target.search || target.hash || target.port ||
        !Number.isSafeInteger(number) || number < 1) return null
    const parts = target.pathname.split('/')
    if (parts.length !== 5 || parts[0] !== '' ||
        parts[1].toLowerCase() !== repo.owner.toLowerCase() ||
        parts[2].toLowerCase() !== repo.name.toLowerCase() ||
        parts[3] !== 'issues' || parts[4] !== String(number)) return null
    return target.href
  } catch { return null }
}

/** Repo ownership is fixed by the route; no global Issue creator or Installation enumeration. */
export default function RepoIssueCreatePage({ owner, repo, api = repoIssuesApi }: {
  owner: string; repo: string; api?: ScopedIssueApi
}) {
  const target = useMemo(() => parseGitHubRepositoryUrl(
    'https://github.com/' + owner + '/' + repo), [owner, repo])
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const login = loginHref(base + '/issues/new')
  const [revision, setRevision] = useState(0)
  const {reason:accessReason,report}=useRepoAccess(owner+'/'+repo+'/'+revision)
  const [status, setStatus] = useState<Status>('checking')
  const [verified, setVerified] = useState<Repo | null>(null)
  const [message, setMessage] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [created, setCreated] = useState<{ number: number; url: string } | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const failureRef=useRef<HTMLParagraphElement>(null)
  useEffect(()=>{if(status==='ready'&&message&&!unknown&&!created)failureRef.current?.focus()},[status,message,unknown,created])

  useEffect(() => {
    const controller = new AbortController()
    setVerified(null); setStatus('checking'); setMessage('')
    if (!target) {
      setStatus('error'); setMessage('仓库地址无效')
      return () => controller.abort()
    }
    void Promise.all([
      api.getRepositories(controller.signal, target),
      api.getSession(controller.signal),
    ]).then(([repositories, loggedIn]) => {
      if (controller.signal.aborted) return
      const exact = repositories.find(item =>
        item.full_name.toLowerCase() === target.full_name.toLowerCase())
      if (!exact) throw Error('GitHub Installation 未确认此仓库')
      setVerified(exact)
      setStatus(loggedIn ? 'ready' : 'anonymous')
    }).catch(error => {
      if (!controller.signal.aborted) {
        setStatus('error')
        if(!report(error))setMessage(error instanceof Error ? error.message : '仓库或权限核验失败')
      }
    })
    return () => controller.abort()
  }, [api, target, revision, report])

  useEffect(() => () => { inflight.current?.abort() }, [])
  useEffect(() => {
    if (created || unknown) resultHeading.current?.focus()
  }, [created, unknown])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = title.trim()
    if (!verified || status !== 'ready' || pending || inflight.current ||
        created || unknown || !name || name.length > 256 || description.length > 20000 ||
        !window.confirm('确认以你的 GitHub 身份在 ' + verified.full_name + ' 公开发布此动态？')) return
    const controller = new AbortController()
    inflight.current = controller
    setPending(true); setMessage('')
    try {
      const result = await api.createIssue(verified, name, description, controller.signal)
      if (controller.signal.aborted) return
      const url = trustedCreatedIssueUrl(result.html_url, result.number, verified)
      if (!url) {
        setUnknown(true)
        setMessage('GitHub 返回的发布链接无法确认；请先在目标仓库核实动态（Issue），禁止直接重试。')
        return
      }
      setCreated({ number: result.number, url })
    } catch (error) {
      if (!controller.signal.aborted) {
        setUnknown(uncertainWriteResult(error))
        setMessage(error instanceof Error ? error.message : '发布动态失败')
      }
    } finally {
      if (inflight.current === controller) {
        inflight.current = null
        if (!controller.signal.aborted) setPending(false)
      }
    }
  }

  return <section className={styles.page}>
    <nav aria-label="面包屑"><Link to={base}>项目主页</Link> / 发布动态</nav>
    <h1>发布动态</h1>
    <p>发布到 <strong>{owner}/{repo}</strong>，动态公开可见。</p>
    {status === 'checking' && <p role="status">正在检查发布权限…</p>}
    {accessReason&&<RepoAccessNotice owner={owner} repo={repo} reason={accessReason} onRetry={()=>setRevision(n=>n+1)}/>}
    {status === 'error' && !accessReason && <p role="alert">{message}
      <button type="button" onClick={() => setRevision(n => n + 1)}>重新核验</button></p>}
    {status === 'anonymous' && <p>登录 GitHub 后才能发布动态。
      <a href={login}>登录 GitHub 后返回此仓库</a></p>}
    {unknown && <section className={styles.warning} role="alert">
      <h2 ref={resultHeading} tabIndex={-1}>发布结果尚未确认</h2>
      <p>{message}</p>
      {target && <a href={target.url + '/issues'} target="_blank" rel="noopener noreferrer">
        在 GitHub 核查目标仓库 Issues（新标签）</a>}
    </section>}
    {created && <section className={styles.success} role="status" aria-live="polite">
      <h2 ref={resultHeading} tabIndex={-1}>动态已发布 · #{created.number}</h2>
      <p>提交已由 GitHub 确认。</p>
      <div className={styles.actions}>
        <Link className={styles.primaryResult} to={base + '/issues/' + created.number}>查看已发布动态</Link>
        <a href={created.url} target="_blank" rel="noopener noreferrer">在 GitHub 查看（新标签）</a>
      </div>
    </section>}
    {status === 'ready' && verified && !created && !unknown &&
      <form className={styles.form} onSubmit={event => { void submit(event) }}>
        {message&&<p ref={failureRef} tabIndex={-1} role="alert">发布失败：{message}。内容已保留，请检查后重试。</p>}
        <label htmlFor="create-issue-title">标题
          <input id="create-issue-title" required maxLength={256} value={title}
            onChange={event => setTitle(event.target.value)} />
        </label>
        <label htmlFor="create-issue-body">正文
          <textarea id="create-issue-body" rows={8} maxLength={20000} value={description}
            onChange={event => setDescription(event.target.value)} />
        </label>
        <div className={styles.actions}>
          <button type="submit" disabled={pending || !title.trim()}>
            {pending ? '正在发布…' : '确认发布'}
          </button>
          <Link to={base}>取消，返回项目</Link>
        </div>
        <p>将以你的 GitHub 身份公开发布。提交时会再次检查权限。</p>
      </form>}
  </section>
}
