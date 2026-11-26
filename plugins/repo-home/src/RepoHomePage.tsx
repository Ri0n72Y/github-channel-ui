import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { summarizeReadme } from './domain.mjs'
import type { RepoHomeApi, RepoHomeData, RepoFeedIssue } from './service'
import { memberWriteBranch, readDisplayBranch } from './service'
import { MemberManagementLink, TeamStrip, TeamStatus } from './Team'
import { useMemberWriteAccess } from './useMemberWriteAccess'
import { RepoIssueActivityCard } from './RepoIssueActivityCard'
import styles from './RepoHome.module.css'

const valid = (owner?: string, repo?: string) => !!owner && !!repo &&
  /^[a-z\d-]{1,39}$/i.test(owner) && /^[a-z\d._-]{1,100}$/i.test(repo)
const errorText = (e: unknown) => e instanceof Error ? e.message : '网络请求失败'

export type RepoHomeTheme = 'dark' | 'light'

/** Optional presentation input only. No production source or file convention is enabled. */
export function safeRepoTitleCover(value: unknown, owner: string, repo: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  const match = /^https:\/\/raw\.githubusercontent\.com\/([a-z\d-]{1,39})\/([a-z\d._-]{1,100})\/([a-f\d]{40})\/([a-z\d._/-]+\.(?:png|jpe?g|gif|webp|avif))$/i.exec(value)
  if (!match || match[0] !== value || ['.','..'].includes(match[2]) || match[1].toLowerCase() !== owner.toLowerCase() ||
      match[2].toLowerCase() !== repo.toLowerCase() || match[4].split('/').some(p => !p || p === '.' || p === '..')) return null
  return value
}

function TitleCover({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? null : <div className={styles.coverLayer} aria-hidden="true">
    <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  </div>
}

/** Use measured card width without CSS containment on the fixed Popover ancestors. */
export function titleLayout(width: number) {
  return width >= 1100 ? 'wide' : width >= 700 ? 'medium' : width >= 480 ? 'narrow' : 'small'
}

/** @summary Orchestrate independent hero/team loading and one-at-a-time cancellable issue pagination. */
export default function RepoHomePage({ api, theme, coverUrl }: { api: RepoHomeApi; theme?: RepoHomeTheme; coverUrl?: string }) {
  const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
  // A local viewing preference. GitHub repository-wide configuration is managed separately.
  const branch = readDisplayBranch(owner, repo)
  const [data, setData] = useState<RepoHomeData | null>(null)
  const memberWrite = useMemberWriteAccess(api, owner, repo, memberWriteBranch, 0, Boolean(data))
  const [homeError, setHomeError] = useState('')
  const [homeLoading, setHomeLoading] = useState(true)
  const [items, setItems] = useState<RepoFeedIssue[]>([])
  const [feedError, setFeedError] = useState('')
  const [feedLoading, setFeedLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [generation, setGeneration] = useState(0)
  const {reason:accessReason,report}=useRepoAccess(owner+'/'+repo+'/'+branch+'/'+generation)
  const nextPage = useRef(1), pendingPage = useRef<AbortController | null>(null), stopped = useRef(false)
  const controllers = useRef<Set<AbortController>>(new Set())
  const sentinel = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<ReturnType<typeof titleLayout>>('small')
  const titleCard = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = titleCard.current
    if (!node) return
    const measure = () => setLayout(titleLayout(node.getBoundingClientRect().width))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setHomeLoading(true); setHomeError(''); setData(null)
    if (valid(owner, repo)) {
      void api.getHome(owner, repo, branch, controller.signal).then(result => {
        if (controller.signal.aborted) return
        setData(result)
      }).catch(e => { if (!controller.signal.aborted && !report(e)) setHomeError(errorText(e)) })
        .finally(() => { if (!controller.signal.aborted) setHomeLoading(false) })
    } else { setHomeLoading(false); setHomeError('仓库 URL 参数无效') }
    return () => controller.abort()
  }, [api, owner, repo, branch, generation, report])

  const loadPage = useCallback(async () => {
    if (!valid(owner, repo) || pendingPage.current || stopped.current) return
    const page = nextPage.current
    const controller = new AbortController()
    pendingPage.current = controller
    controllers.current.add(controller)
    setFeedLoading(true); setFeedError('')
    try {
      const result = await api.getFeed(owner, repo, page, controller.signal, [])
      if (controller.signal.aborted) return
      if (result.page !== page || !Array.isArray(result.items)) throw Error('分页响应无效')
      setItems(current => {
        const ids = new Set(current.map(i => i.id))
        return [...current, ...result.items.filter(i => !i.pull_request && !ids.has(i.id) && ids.add(i.id))]
          .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      })
      nextPage.current = page + 1
      setHasMore(result.hasMore)
      if (!result.hasMore) stopped.current = true
    } catch (e) {
      if (!controller.signal.aborted) { stopped.current = true; if(!report(e)) setFeedError(errorText(e)) }
    } finally {
      controllers.current.delete(controller)
      if (pendingPage.current === controller) pendingPage.current = null
      if (!controller.signal.aborted) setFeedLoading(false)
    }
  }, [api, owner, repo, report])

  useEffect(() => {
    controllers.current.forEach(c => c.abort()); controllers.current.clear()
    pendingPage.current = null; stopped.current = false; nextPage.current = 1
    setItems([]); setHasMore(true); setFeedError(''); setFeedLoading(false)
    void loadPage()
    return () => { controllers.current.forEach(c => c.abort()); controllers.current.clear(); stopped.current = true }
  }, [loadPage, generation])

  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || !!feedError || feedLoading) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(x => x.isIntersecting)) {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => { void loadPage() }, 200)
      }
    }, { rootMargin: '400px 0px' })
    observer.observe(node)
    return () => { observer.disconnect(); if (timeout) clearTimeout(timeout) }
  }, [hasMore, feedError, feedLoading, items.length, loadPage])

  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const readmeUrl = data?.readme.state === 'ready' && data.readme.path
    ? 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
      '/blob/' + encodeURIComponent(data.branch) + '/' + data.readme.path.split('/').map(encodeURIComponent).join('/')
    : ''
  const description = data?.repository.description?.trim() || ''
  const readmeSummary = data?.readme.state === 'ready'
    ? summarizeReadme(data.readme.content || '', data.repository.name).trim() : ''
  const compact = (value: string) => value.replace(/\s+/g, ' ').trim()
  const descKey = compact(description).toLowerCase(), readmeText = compact(readmeSummary)
  const readmeKey = readmeText.toLowerCase()
  const summary = descKey && readmeKey && !descKey.includes(readmeKey)
    ? (readmeKey.startsWith(descKey)
      ? readmeText.slice(compact(description).length).replace(/^[\s.。:：;；,，-]+/, '') : readmeText) : ''
  const cover = data ? safeRepoTitleCover(coverUrl, owner, repo) : null
  return <section className={[styles.page, styles.homePage].join(' ')} data-lc-theme={theme}>
    <div className={styles.homeLayout}>
    {accessReason&&<RepoAccessNotice owner={owner} repo={repo} reason={accessReason} onRetry={()=>setGeneration(n=>n+1)}/>}
    <div className={styles.titleCard} ref={titleCard} data-title-layout={layout} hidden={Boolean(accessReason&&!data)}>
    {homeLoading && <p role="status">正在读取项目介绍与团队…</p>}
    {homeError && <p role="alert">{homeError} <button type="button" onClick={() => setGeneration(n => n + 1)}>重试介绍</button></p>}
    {data && <>
      {cover && <TitleCover key={cover} url={cover}/>}
      <header className={styles.titleContent}>
        <div className={styles.titleIdentity}>
          <span className={styles.projectMark} aria-hidden="true">{Array.from(data.repository.name.trim())[0]?.toUpperCase() || '?'}</span>
          <div className={styles.identityCopy}>
            <p className={styles.eyebrow}>{data.repository.full_name}</p>
            <h1>{data.repository.name}</h1>
            {description || readmeSummary ? <p className={styles.titleIntro}>{description || readmeSummary}</p> :
              <p className={styles.muted}>暂无项目简介。</p>}
          </div>
        </div>
        <div className={styles.titleReadme}>
          <h2>项目说明</h2>
          {summary && <p>{summary}</p>}
          {data.readme.state === 'missing' && <p className={styles.muted}>暂无 README。</p>}
          {data.readme.state === 'error' && <p role="status">
            README 读取失败：{data.readme.error} <button type="button" onClick={() => setGeneration(n => n + 1)}>重试</button>
          </p>}
          {readmeUrl && <a className={styles.readmeLink} href={readmeUrl} target="_blank" rel="noopener noreferrer">完整项目说明（GitHub）</a>}
        </div>
        <div className={[styles.actions, styles.titleActions].join(' ')}>
          <Link to={base + '/channels'}>项目频道</Link>
          <details className={styles.secondaryDetails}>
            <summary>项目设置与来源</summary>
            <p>当前展示分支：<code>{branch}</code></p>
            <Link to={base + '/config'}>仓库配置与本机偏好</Link>
            <a href={data.repository.html_url} target="_blank" rel="noopener noreferrer">GitHub 仓库</a>
          </details>
        </div>
      </header>
    </>}
    {(!accessReason||data)&&<section className={[styles.section, styles.teamPanel].join(' ')} aria-labelledby="team-heading"
      data-team-state={data?.team.state || (homeLoading ? 'loading' : 'unavailable')}>
      <h2 id="team-heading">团队成员</h2>
      {data ? <TeamStatus team={data.team} base={base} branch={branch}
        onRetry={() => setGeneration(n => n + 1)} /> : !homeLoading && !accessReason && <p>团队信息不可用。</p>}
      {data?.team.state === 'ready' && <TeamStrip members={data.team.members} base={base} />}
      <div className={[styles.sectionHead, styles.teamActions].join(' ')}>
        <Link to={base + '/members'}>查看全部成员</Link>
        {data && ['ready', 'empty', 'missing'].includes(data.team.state) &&
          <MemberManagementLink base={base} state={memberWrite.state} />}
      </div>
    </section>}
    </div>
    {(!accessReason||items.length>0)&&<section className={[styles.section, styles.feedSection].join(' ')} aria-labelledby="feed-heading">
      <div className={styles.sectionHead}><h2 id="feed-heading" tabIndex={-1}>项目动态</h2>
        <Link to={base + '/issues/new'}>发布动态</Link>
        </div>
      <div className={styles.feed}>{items.map(issue => <RepoIssueActivityCard
        key={issue.id} issue={issue} base={base} />)}</div>
      {items.length === 0 && !feedLoading && !feedError && !hasMore && <p>暂无项目动态。</p>}
      {feedError && <p role="alert">动态读取失败：{feedError} <button type="button" onClick={() => { stopped.current = false; setFeedError(''); void loadPage() }}>重试本页</button></p>}
      {feedLoading && <p role="status">正在加载动态…</p>}
      {!accessReason && !feedLoading && !feedError && hasMore && <button type="button" onClick={() => void loadPage()}>加载更多</button>}
      {!hasMore && <p className={styles.muted}>已加载全部动态</p>}
      <div ref={sentinel} aria-hidden="true" />
    </section>}
    </div>
  </section>
}
