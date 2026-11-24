import { useCallback, useEffect, useRef, useState } from 'react'
import { loadInstalledTopicBatch, validTopicSlug } from './domain.mjs'
import type { TopicPageApi, TopicPageError, TopicRepository } from './service'
import TopicMasonry from './TopicMasonry'
import TopicStatus from './TopicStatus'
import styles from './topic-page.module.css'

type Cursor = { readonly page: number; readonly offset: number }
type ReadState = {
  readonly projects: readonly TopicRepository[]
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: TopicPageError | null
  readonly moreError: TopicPageError | null
  readonly cursor: Cursor | null
  readonly windowExhausted: boolean
}
const initial = (): ReadState => ({
  projects: [], loading: true, loadingMore: false,
  error: null, moreError: null, cursor: null, windowExhausted: false,
})
function readError(reason: unknown, stage = 'topic-search'): TopicPageError {
  const error = reason instanceof Error ? reason : new Error('GitHub Topic 读取失败')
  return Object.assign(error, {
    stage: (error as TopicPageError).stage || stage,
    observedAt: new Date().toISOString(),
  })
}
function invalidSlug(): TopicPageError {
  return Object.assign(new Error('GitHub Topic slug 无效'), {
    stage: 'route', status: 400, retryable: false,
    observedAt: new Date().toISOString(),
  })
}

/** @summary Render only the controlled source-less Playground Topic fixture. */
export default function TopicSlugPage({ slug, api }: { slug: string; api: TopicPageApi }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<ReadState>(initial)
  const moreAbort = useRef<AbortController | null>(null)
  const moreLoading = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const topic = slug.toLowerCase()

  useEffect(() => {
    const controller = new AbortController()
    moreAbort.current?.abort()
    moreLoading.current = false
    setState(initial())
    if (!validTopicSlug(slug)) {
      setState({ ...initial(), loading: false, error: invalidSlug() })
      return () => controller.abort()
    }
    // The source-less descriptor is internal to the immutable cursor filter.
    // It never supplies repository metadata or a frontend write capability.
    const meta = { repository: null, config: { topic, whitelist: false },
      allowedRepositories: [] as string[] }
    void loadInstalledTopicBatch(meta,
      (page: number, offset: number) =>
        api.getProjects({ topic }, page, controller.signal, offset),
      controller.signal).then(result => {
        if (!controller.signal.aborted) setState({
          projects: result.items, loading: false, loadingMore: false,
          error: null, moreError: null, cursor: result.cursor,
          windowExhausted: result.windowExhausted,
        })
      }).catch(error => {
        if (!controller.signal.aborted) setState({
          ...initial(), loading: false, error: readError(error),
        })
      })
    return () => { controller.abort(); moreAbort.current?.abort() }
  }, [api, slug, topic, revision])

  const loadMore = useCallback(async () => {
    const cursor = state.cursor
    if (!cursor || !validTopicSlug(slug) || state.loading ||
        moreLoading.current) return
    moreLoading.current = true
    const controller = new AbortController()
    moreAbort.current = controller
    setState(prev => ({ ...prev, loadingMore: true, moreError: null }))
    try {
      const meta = { repository: null, config: { topic, whitelist: false },
        allowedRepositories: [] as string[] }
      const result = await loadInstalledTopicBatch(meta,
        (page: number, offset: number) =>
          api.getProjects({ topic }, page, controller.signal, offset),
        controller.signal, cursor, state.projects.map(p => p.id))
      if (controller.signal.aborted) return
      setState(prev => {
        const ids = new Set(prev.projects.map(p => p.id))
        const names = new Set(prev.projects.map(p => p.full_name.toLowerCase()))
        const additional = result.items.filter(p =>
          !ids.has(p.id) && !names.has(p.full_name.toLowerCase()))
        return { ...prev, projects: [...prev.projects, ...additional],
          loadingMore: false, moreError: null, cursor: result.cursor,
          windowExhausted: result.windowExhausted }
      })
    } catch (error) {
      if (!controller.signal.aborted) setState(prev => ({
        ...prev, loadingMore: false, moreError: readError(error),
      }))
    } finally {
      if (moreAbort.current === controller) {
        moreAbort.current = null
        moreLoading.current = false
      }
    }
  }, [api, slug, topic, state.cursor, state.loading, state.projects])

  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !state.cursor || state.loading || state.loadingMore ||
        state.moreError || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '260px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [loadMore, state.cursor, state.loading, state.loadingMore, state.moreError])

  const valid = validTopicSlug(slug)
  return <div className={styles.page}>
    <header className={styles.slugHead}>
      <span className={styles.eyebrow}>PLAYGROUND FIXTURE</span>
      <h1>{valid ? 'GitHub Topic：' + topic : '无效的 GitHub Topic'}</h1>
      <p>此页面仅供 Playground 界面测试，数据来自受控 Fixture，不提供配置或 Issue 写入。</p>
    </header>
    <section className={styles.section} aria-labelledby="topic-projects-heading">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>FIXTURE REPOSITORIES</span>
          <h2 id="topic-projects-heading">项目发现</h2></div>
        <span className={styles.count}>样例展示 {state.projects.length} 个项目</span>
      </div>
      <TopicStatus loading={state.loading} error={state.error}
        count={state.projects.length} windowExhausted={state.windowExhausted}
        onRetry={() => setRevision(value => value + 1)} reportUrl="" />
      {!state.loading && !state.error && state.projects.length === 0 &&
        <p role="status" className={styles.empty}>
          当前 Fixture 没有匹配项目。
        </p>}
      {state.projects.length > 0 && <TopicMasonry projects={state.projects}/>}
      {state.moreError && <p className={styles.errorText} role="alert">
        加载更多失败：{state.moreError.message}
      </p>}
      {state.cursor && <div className={styles.loadMore} ref={sentinelRef}>
        <button type="button" disabled={state.loadingMore}
          onClick={() => { void loadMore() }}>
          {state.loadingMore ? '正在加载更多…' :
            state.moreError ? '重试加载更多' : '加载更多项目'}
        </button>
      </div>}
    </section>
  </div>
}
