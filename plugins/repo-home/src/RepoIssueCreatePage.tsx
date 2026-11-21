import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
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
  const login = '/api/github-login?' + new URLSearchParams({
    return_to: base + '/issues/new',
  }).toString()
  const [revision, setRevision] = useState(0)
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
        setMessage(error instanceof Error ? error.message : '仓库或权限核验失败')
      }
    })
    return () => controller.abort()
  }, [api, target, revision])

  useEffect(() => () => { inflight.current?.abort() }, [])
  useEffect(() => {
    if (created || unknown) resultHeading.current?.focus()
  }, [created, unknown])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = title.trim()
    if (!verified || status !== 'ready' || pending || inflight.current ||
        created || unknown || !name || name.length > 256 || description.length > 20000 ||
        !window.confirm('确认以你的 GitHub 身份在 ' + verified.full_name + ' 创建此 Issue？')) return
    const controller = new AbortController()
    inflight.current = controller
    setPending(true); setMessage('')
    try {
      const result = await api.createIssue(verified, name, description, controller.signal)
      if (controller.signal.aborted) return
      const url = trustedCreatedIssueUrl(result.html_url, result.number, verified)
      if (!url) {
        setUnknown(true)
        setMessage('GitHub 返回的创建链接无法确认；请先在目标仓库核实 Issue，禁止直接重试。')
        return
      }
      setCreated({ number: result.number, url })
    } catch (error) {
      if (!controller.signal.aborted) {
        setUnknown(uncertainWriteResult(error))
        setMessage(error instanceof Error ? error.message : '创建 Issue 失败')
      }
    } finally {
      if (inflight.current === controller) {
        inflight.current = null
        if (!controller.signal.aborted) setPending(false)
      }
    }
  }

  return <section className={styles.page}>
    <nav aria-label="面包屑"><Link to={base}>项目主页</Link> / 新建 Issue</nav>
    <h1>新建 Issue</h1>
    <p>目标仓库：<strong>{owner}/{repo}</strong>。此页面只向该仓库提交，不枚举其他仓库。</p>
    {status === 'checking' && <p role="status">正在核验仓库 Installation 与 GitHub 登录状态…</p>}
    {status === 'error' && <p role="alert">{message}
      <button type="button" onClick={() => setRevision(n => n + 1)}>重新核验</button></p>}
    {status === 'anonymous' && <p>创建 Issue 需要 GitHub OAuth 登录。
      <a href={login}>登录 GitHub 后返回此仓库</a></p>}
    {unknown && <section className={styles.warning} role="alert">
      <h2 ref={resultHeading} tabIndex={-1}>Issue 创建结果尚未确认</h2>
      <p>{message}</p>
      {target && <a href={target.url + '/issues'} target="_blank" rel="noopener noreferrer">
        在 GitHub 核查目标仓库 Issues（新标签）</a>}
    </section>}
    {created && <section className={styles.success} role="status" aria-live="polite">
      <h2 ref={resultHeading} tabIndex={-1}>Issue #{created.number} 已创建</h2>
      <p>提交已由 GitHub 确认。</p>
      <div className={styles.actions}>
        <Link to={base + '/issues/' + created.number}>查看站内详情</Link>
        <a href={created.url} target="_blank" rel="noopener noreferrer">前往 GitHub Issue（新标签）</a>
      </div>
    </section>}
    {status === 'ready' && verified && !created && !unknown &&
      <form className={styles.form} onSubmit={event => { void submit(event) }}>
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
            {pending ? '正在创建…' : '确认创建 Issue'}
          </button>
          <Link to={base}>取消，返回项目</Link>
        </div>
        <p>提交时再次经过服务端 GitHub OAuth、App Installation 与仓库写入权限校验。</p>
      </form>}
  </section>
}
