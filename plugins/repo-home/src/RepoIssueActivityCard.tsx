import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { repositoryLinkPath } from '../../repo-issues/src/target.mjs'
import type { RepoFeedIssue } from './service'
import { SafeMarkdown } from './SafeMarkdown'
import { previewMarkdown } from './domain.mjs'
import styles from './RepoHome.module.css'
import { ExternalIcon, LocalTime } from '../../shared/src/Presentation'

/** @summary Render a normal GitHub Issue as one accessible, expandable first-post article. */
export function RepoIssueActivityCard({ issue, base }: { issue: RepoFeedIssue; base: string }) {
  const navigate=useNavigate()
  const path=repositoryLinkPath(base+'/issues/'+issue.number)
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
  return <article className={[styles.card,path?styles.clickableCard:''].join(' ')}
    onClick={event=>{
      if(!path||event.defaultPrevented||event.button!==0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||
        !(event.target instanceof window.Element)||event.target.closest('a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable]')||
        window.getSelection()?.isCollapsed===false)return
      navigate(path)
    }}>
    <div className={styles.cardMeta}>
      <span className={styles.issueNumber}>#{issue.number}</span>
      <span className={styles.issueState} data-state={issue.state === 'closed' ? 'closed' : 'open'}>
        {issue.state === 'closed' ? '已关闭' : '开放中'}
      </span>
      <span className={styles.issueAuthor}>{issue.user?.login || '未知作者'}</span>
      <span>更新于 <LocalTime value={issue.updated_at} label="最近更新"/></span>
      {issue.html_url && <a className={styles.feedSource} href={issue.html_url} target="_blank" rel="noopener noreferrer" aria-label="GitHub 原文" title="GitHub 原文"><ExternalIcon/></a>}
    </div>
    <h3><Link to={base + '/issues/' + issue.number} aria-label={issue.title + ' · 参与讨论'}>{issue.title}</Link></h3>
    {!body.trim() ? <p className={styles.muted}>暂无正文</p> :
      <div className={styles.issueBody}><SafeMarkdown
        body={long && !expanded ? previewMarkdown(body, mobile ? 160 : 300) : body}
        preview={long && !expanded} article /></div>}
    {long && <button type="button" onClick={() => setExpanded(v => !v)}
      aria-expanded={expanded}>{expanded ? '收起正文' : '展开完整正文'}</button>}
  </article>
}
