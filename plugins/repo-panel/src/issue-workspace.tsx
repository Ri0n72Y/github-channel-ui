import { loginHref } from '../../github-access/src/access'
import { resourcePath } from '../../repo-issues/src/target.mjs'
import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import { useEffect, useState, type FormEvent } from 'react'
import { useWriteGate } from '../../shared/src/useWriteGate'
import { uncertainWriteResult } from '../../shared/src/browser-http'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import { trustedCreatedIssueUrl } from '../../repo-issues/src/api'
import type { Issue, Repo, RepoIssuesApi } from '../../repo-issues/src/api'
import styles from './IssueWorkspace.module.css'

type Notice = { text: string; url?: string; relogin?: boolean; error?: boolean }

/** @summary Keep the existing Issue creation demo while navigating to independent Issue pages. */
export function IssueWorkspace({ repo, issues, available, checking, loggedIn, api }: {
  repo: Repo; issues: readonly Issue[]; available: boolean; checking: boolean;
  loggedIn: boolean; api: Readonly<RepoIssuesApi>
}) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const {gate,pending,unknown}=useWriteGate()
  useEffect(()=>subscribeSessionChanged(()=>gate.invalidate()),[gate])
  const [notice, setNotice] = useState<Notice | null>(null)
  const canWrite=available&&loggedIn
  // A temporary read does not decide the outcome of an in-flight write.
  // A failed repository recheck detaches it; even a late success cannot unlock it.
  useEffect(()=>{
    if(!available&&!checking)gate.invalidate()
  },[available,checking,gate])

  async function submitIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || unknown || !canWrite || !title.trim() || title.length > 256 ||
        description.length > 20000 ||
        !window.confirm('确认以你的 GitHub 身份创建此 Issue？')) return
    const attempt=gate.begin()
    if(!attempt)return
    setNotice(null)
    try {
      const issue = await api.createIssue(repo, title.trim(), description,
        attempt.signal)
      if(!gate.isCurrent(attempt))return
      const url=trustedCreatedIssueUrl(issue.html_url,issue.number,repo)
      if(!url){gate.markUnknown(attempt);setNotice({text:'GitHub 返回的发布链接无法确认',error:true});return}
      setNotice({ text: 'Issue #' + issue.number + ' 创建成功。请手动刷新列表。',
        url })
      setCreating(false)
      setTitle('')
      setDescription('')
    } catch (error) {
      if(!gate.isCurrent(attempt))return
      if(uncertainWriteResult(error))gate.markUnknown(attempt)
      setNotice({ text: error instanceof Error ? error.message : String(error), error: true,
        relogin: Boolean((error as { relogin?: boolean })?.relogin) })
    } finally { gate.finish(attempt) }
  }

  if(!available&&!creating&&!pending&&!unknown&&!notice)return null

  return <section className={styles.workspace}>
    <header className={styles.toolbar}>
      <h2>{available?'开放中的讨论 ('+issues.length+')':'仓库发布草稿'}</h2>
      <button type="button" disabled={!canWrite || pending || unknown}
        onClick={() => setCreating(value => !value)}>
        {creating ? '取消创建' : '发布动态'}
      </button>
    </header>
    {!available && <p>仓库读取尚未确认，暂时禁止发布。</p>}
    {available&&!loggedIn && <p>可匿名阅读公开讨论，登录 GitHub 后发布。</p>}
    {notice && <p role={notice.error ? 'alert' : 'status'}>{notice.text}
      {notice.url && <> · <a href={notice.url} target="_blank" rel="noreferrer">在 GitHub 查看</a></>}
      {notice.relogin && <> · <a href={loginHref(resourcePath(repo.owner,repo.name,'issues')||'/')}>重新登录</a></>}
    </p>}
    {unknown && <p role="alert">发布结果尚未确认，请先在 GitHub 核查目标仓库，禁止直接重复提交。 · <a href={'https://github.com/'+repo.owner+'/'+repo.name+'/issues'} target="_blank" rel="noopener noreferrer">在 GitHub 核查</a></p>}
    {creating && <form className={styles.form} onSubmit={event => void submitIssue(event)}>
      <h3>发布动态 · {repo.full_name}</h3>
      <label>标题 <input required maxLength={256} value={title} readOnly={pending}
        onChange={e => { if (!pending) setTitle(e.target.value) }} /></label>
      <label>正文 <textarea rows={6} maxLength={20000} value={description} readOnly={pending}
        onChange={e => { if (!pending) setDescription(e.target.value) }} /></label>
      <button type="submit" disabled={pending || unknown || !canWrite || !title.trim()}>
        {pending ? '创建中…' : '确认发布'}
      </button>
    </form>}
    {available && <><ul className={styles.list}>{issues.map(issue => <li key={issue.number}>
      <Link to={'/' + repo.owner + '/' + repo.name + '/issues/' + issue.number}>
        #{issue.number} · {issue.title}
      </Link>
      <small>{issue.comments} 条评论</small>
      <a href={issue.html_url} target="_blank" rel="noreferrer">GitHub</a>
    </li>)}</ul>
    {!issues.length && <p>暂无开放中的讨论。</p>}</>}
  </section>
}
