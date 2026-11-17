import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { validTopicRepository, loadInstalledTopicBatch, parseTopicYaml } from './domain.mjs'
import type { TopicPageApi, TopicRoute, TopicPageError, TopicRepository,
  TopicSnapshot, TopicConfigResult } from './service'
import TopicPageView from './TopicPageView'
import { subscribeSessionChanged } from '../../shared/src/session-change'

type Cursor = { readonly page: number; readonly offset: number }
type ReadState = {
  snapshot: TopicSnapshot | null; projects: TopicRepository[];
  loading: boolean; loadingMore: boolean; error: TopicPageError | null;
  moreError: TopicPageError | null; cursor: Cursor | null; windowExhausted: boolean
}
type ReportState = {
  open: boolean; title: string; body: string; pending: boolean;
  checking: boolean; uncertain: boolean; proof: string;
  message: string; url: string
}
const EMPTY_REPORT: ReportState = {
  open: false, title: '', body: '', pending: false, checking: false,
  uncertain: false, proof: '', message: '', url: '',
}
function asError(value: unknown, stage = 'source'): TopicPageError {
  if (value instanceof Error) return Object.assign(value,
    { stage: (value as TopicPageError).stage || stage,
      observedAt: new Date().toISOString() })
  return Object.assign(new Error('TopicPage 请求失败'),
    { stage, status: 502, observedAt: new Date().toISOString() })
}

/** @summary Load public Topic results and orchestrate an explicitly confirmed user OAuth Issue report. */
export default function TopicPageContainer({ owner, repo, api }: {
  owner: string; repo: string; api: TopicPageApi
}) {
  const route: TopicRoute = { owner, repo }
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<ReadState>({
    snapshot: null, projects: [], loading: true, loadingMore: false,
    error: null, moreError: null, cursor: null, windowExhausted: false,
  })
  const [authenticated, setAuthenticated] = useState(false)
  const [sessionRevision, setSessionRevision] = useState(0)
  useEffect(() => subscribeSessionChanged(() => {
    setAuthenticated(false)
    setReport(prev => ({ ...prev, proof: '', open: false }))
    setSessionRevision(n => n + 1)
  }), [])
  const [report, setReport] = useState<ReportState>(EMPTY_REPORT)
  const [draft,setDraft] = useState('')
  const [configResult,setConfigResult] = useState<TopicConfigResult|null>(null)
  const [configError,setConfigError] = useState('')
  const [savingConfig,setSavingConfig] = useState(false)
  const [configUncertain,setConfigUncertain] = useState(false)
  const configAbort = useRef<AbortController|null>(null)
  const writeAbort = useRef<AbortController | null>(null)
  const proofAbort = useRef<AbortController | null>(null)
  const moreAbort = useRef<AbortController | null>(null)
  const moreLoading = useRef(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    moreAbort.current?.abort()
    moreLoading.current = false
    setState({ snapshot: null, projects: [], loading: true, loadingMore: false,
      error: null, moreError: null, cursor: null, windowExhausted: false })
    if (!validTopicRepository(owner, repo)) {
      setState({ snapshot: null, projects: [], loading: false, loadingMore: false,
        error: Object.assign(new Error('TopicPage URL 仓库参数无效'),
          { stage: 'route', status: 400, observedAt: new Date().toISOString() }),
        moreError: null, cursor: null, windowExhausted: false })
      return () => abort.abort()
    }
    void (async () => {
      let meta: TopicSnapshot | null = null
      try {
        meta = await api.getSnapshot({ owner, repo }, abort.signal)
        if (abort.signal.aborted) return
        setState(prev => ({ ...prev, snapshot: meta }))
        setDraft(meta.configText ?? 'topic: your-topic\nwhitelist: true\n')
        setConfigResult(null); setConfigError(''); setConfigUncertain(false)
        if (meta.configState === 'missing') {
          setState({snapshot:meta,projects:[],loading:false,loadingMore:false,
            error:null,moreError:null,cursor:null,windowExhausted:false})
          return
        }
        const result = await loadInstalledTopicBatch(meta, (page: number, offset: number) =>
          api.getProjects({ owner, repo }, page, abort.signal, offset), abort.signal)
        if (abort.signal.aborted) return
        setState({ snapshot: meta, projects: result.items, loading: false,
          loadingMore: false, error: null, moreError: null,
          cursor: result.cursor, windowExhausted: result.windowExhausted })
      } catch (error) {
        if (!abort.signal.aborted) setState(prev => ({
          ...prev, snapshot: meta, projects: [], loading: false,
          loadingMore: false, error: asError(error), moreError: null,
          cursor: null, windowExhausted: false,
        }))
      }
    })()
    return () => { abort.abort(); moreAbort.current?.abort() }
  }, [api, owner, repo, revision])

  const loadMore = useCallback(async () => {
    const cursor = state.cursor
    if (!cursor || !state.snapshot || moreLoading.current || state.loading) return
    moreLoading.current = true
    const abort = new AbortController()
    moreAbort.current = abort
    setState(prev => ({ ...prev, loadingMore: true, moreError: null }))
    try {
      const result = await loadInstalledTopicBatch(state.snapshot,
        (page: number, offset: number) => api.getProjects({ owner, repo }, page,
          abort.signal, offset), abort.signal, cursor,
        state.projects.map(project => project.id))
      if (abort.signal.aborted) return
      setState(prev => {
        const ids = new Set(prev.projects.map(project => project.id))
        const names = new Set(prev.projects.map(project => project.full_name.toLowerCase()))
        const additional = result.items.filter(project =>
          !ids.has(project.id) && !names.has(project.full_name.toLowerCase()))
        return { ...prev, projects: [...prev.projects, ...additional],
          cursor: result.cursor, loadingMore: false,
          windowExhausted: result.windowExhausted, moreError: null }
      })
    } catch (error) {
      if (!abort.signal.aborted) setState(prev =>
        ({ ...prev, loadingMore: false, moreError: asError(error, 'topic-search') }))
    } finally {
      if (moreAbort.current === abort) moreAbort.current = null
      moreLoading.current = false
    }
  }, [api, owner, repo, state.cursor, state.snapshot, state.loading, state.projects])

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

  useEffect(() => {
    const abort = new AbortController()
    void api.getSession(abort.signal).then(connected => {
      if (!abort.signal.aborted) setAuthenticated(connected)
    }).catch(() => {
      if (!abort.signal.aborted) setAuthenticated(false)
    })
    return () => abort.abort()
  }, [api, owner, repo, sessionRevision])

  useEffect(() => () => {
    writeAbort.current?.abort()
    proofAbort.current?.abort()
    configAbort.current?.abort()
  }, [])

  async function saveTopicConfig() {
    const snapshot = state.snapshot
    if (!snapshot || !authenticated || savingConfig || configAbort.current ||
        configUncertain) return
    try { parseTopicYaml(draft) }
    catch {setConfigError('Topic YAML 只能包含有效 topic 和 whitelist');return}
    if (!window.confirm('确认以当前 GitHub 账号维护 topics.config.yaml？受保护分支将创建 PR。')) return
    const abort=new AbortController()
    configAbort.current=abort
    setSavingConfig(true);setConfigError('');setConfigResult(null)
    try {
      const outcome=await api.saveConfig({owner,repo},draft,snapshot.headSha,
        snapshot.configSha,abort.signal)
      if(abort.signal.aborted)return
      setConfigResult(outcome)
      if(outcome.outcomeUnknown)setConfigUncertain(true)
      if(outcome.state==='committed')setRevision(value=>value+1)
    } catch(error) {
      if(!abort.signal.aborted) {
        const failure=asError(error,'config-write')
        setConfigError(failure.message)
        if(failure.outcomeUnknown)setConfigUncertain(true)
      }
    } finally {
      if(configAbort.current===abort)configAbort.current=null
      if(!abort.signal.aborted)setSavingConfig(false)
    }
  }

  async function checkReportTarget() {
    proofAbort.current?.abort()
    const controller = new AbortController()
    proofAbort.current = controller
    setReport(prev => ({ ...prev, checking: true, proof: '',
      message: prev.uncertain ? prev.message : '' }))
    try {
      const proof = await api.getReportTarget(route, controller.signal)
      if (!controller.signal.aborted) setReport(prev => ({
        ...prev, checking: false, proof,
      }))
    } catch (error) {
      if (!controller.signal.aborted) setReport(prev => ({
        ...prev, checking: false, proof: '',
        message: asError(error, 'permission').message +
          '。当前报告草稿已保留；可在 GitHub 手动创建 Issue。',
      }))
    }
  }
  function openReport() {
    if (!authenticated || !state.error) return
    const issueError = state.error
    const stage = issueError.stage || 'source'
    setReport(prev => ({
      open: true, pending: false, checking: true,
      uncertain: prev.uncertain, proof: '', url: prev.url,
      message: prev.uncertain ?
        '上次提交结果未知。请先在 GitHub 检查是否已创建，再确认允许重试。' : '',
      title: prev.uncertain ? prev.title :
        '[TopicPage] ' + stage + ' 失败：' + owner + '/' + repo,
      body: prev.uncertain ? prev.body :
        '页面：/topic/' + owner + '/' + repo + '\n阶段：' + stage +
        '\nHTTP：' + (issueError.status || 'unknown') +
        '\n说明：' + issueError.message.slice(0, 600) +
        '\n时间：' + new Date().toISOString(),
    }))
    void checkReportTarget()
  }
  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (writeAbort.current || !api.reportAvailable || !authenticated || report.pending || report.checking ||
        report.uncertain || !report.proof || !report.title.trim() ||
        !report.body.trim()) return
    const controller = new AbortController()
    writeAbort.current = controller
    setReport(prev => ({ ...prev, pending: true, message: '' }))
    try {
      const url = await api.submitReport(route,
        { title: report.title, body: report.body }, report.proof, controller.signal)
      if (!controller.signal.aborted) setReport(prev =>
        ({ ...prev, open: false, pending: false, proof: '', url }))
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = asError(error, 'report')
        setReport(prev => ({
          ...prev, pending: false, uncertain: failure.outcomeUnknown === true,
          proof: failure.outcomeUnknown ? '' : prev.proof,
          message: failure.message + (failure.outcomeUnknown ?
            '。请在 GitHub 核查后，明确点击“已核查，允许再次提交”。' :
            '。草稿已保留，请修改或稍后重试。'),
        }))
      }
    } finally {
      if (writeAbort.current === controller) writeAbort.current = null
    }
  }
  function acknowledgeUnknown() {
    // Explicit user click only. This rechecks authority; it NEVER replays the POST.
    setReport(prev => ({ ...prev, uncertain: false, proof: '', message: '' }))
    void checkReportTarget()
  }
  return <TopicPageView owner={owner} repo={repo}
    snapshot={state.snapshot} projects={state.projects} loading={state.loading}
    error={state.error} windowExhausted={state.windowExhausted}
    canLoadMore={!!state.cursor} loadingMore={state.loadingMore}
    moreError={state.moreError} sentinelRef={sentinelRef}
    onLoadMore={() => { void loadMore() }}
    draft={draft} onDraftChange={setDraft} authenticated={authenticated}
    configPending={savingConfig} configError={configError} configResult={configResult}
    configUncertain={configUncertain}
    onConfigSave={() => { void saveTopicConfig() }}
    onConfirmConfigUnknown={() => {
      setConfigUncertain(false);setConfigError('');setConfigResult(null)
    }}
    report={report} canReport={authenticated && Boolean(state.error)}
    writeEnabled={api.reportAvailable && !!report.proof &&
      !report.uncertain && !report.checking}
    onRetry={() => setRevision(n => n + 1)}
    onOpenReport={openReport}
    onCloseReport={() => {
      proofAbort.current?.abort()
      if (!report.pending) setReport(prev => ({ ...prev, open: false, checking: false }))
    }}
    onConfirmUnknown={acknowledgeUnknown}
    onReportTitleChange={title => setReport(prev => ({ ...prev, title }))}
    onReportBodyChange={body => setReport(prev => ({ ...prev, body }))}
    onSubmitReport={event => { void submitReport(event) }}/>
}
