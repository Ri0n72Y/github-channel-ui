import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { RepoFeedIssue } from './service'
import { SafeMarkdown } from './SafeMarkdown'
import { previewMarkdown } from './domain.mjs'
import styles from './RepoHome.module.css'

/** @summary Render a normal GitHub Issue as one accessible, expandable first-post article. */
export function RepoIssueActivityCard({ issue, base }: { issue: RepoFeedIssue; base: string }) {
  const [expanded, setExpanded] = useState(false)
  const body = issue.body || ''
  const long = body.length > 460 || body.split('\n').length > 12
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 680px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 680px)')
    const onChange = () => setMobile(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const updated = Date.parse(issue.updated_at)
  return <article className={styles.card}>
    <div className={styles.cardMeta}>
      <span className={styles.issueNumber}>#{issue.number}</span>
      <span className={styles.issueState} data-state={issue.state === 'closed' ? 'closed' : 'open'}>
        {issue.state === 'closed' ? 'Closed' : 'Open'}
      </span>
      <span className={styles.issueAuthor}>由 {issue.user?.login || '未知作者'} 发布</span>
      <time dateTime={issue.updated_at} title="最近更新">
        {Number.isNaN(updated) ? issue.updated_at : new Date(updated).toLocaleString('zh-CN')}
      </time>
    </div>
    <h3><Link to={base + '/issues/' + issue.number}>{issue.title}</Link></h3>
    {!body.trim() ? <p className={styles.muted}>此 Issue 暂无正文</p> :
      <div className={styles.issueBody}><SafeMarkdown
        body={long && !expanded ? previewMarkdown(body, mobile ? 160 : 300) : body}
        preview={long && !expanded} article /></div>}
    {long && <button type="button" onClick={() => setExpanded(v => !v)}
      aria-expanded={expanded}>{expanded ? '收起正文' : '展开完整正文'}</button>}
    <div className={styles.cardActions}>
      <Link to={base + '/issues/' + issue.number}>查看站内详情</Link>
      <a href={issue.html_url} target="_blank" rel="noopener noreferrer">GitHub 原文</a>
    </div>
  </article>
}
