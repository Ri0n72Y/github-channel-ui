import { resourcePath } from '../../repo-issues/src/target.mjs'
import { loginHref } from '../../github-access/src/access'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHref, useLocation, useParams } from 'react-router'
import { formatLabourComment, summarizeIssueComments, validIssueTarget } from './domain.mjs'
import { COMMENT_LIMIT, buildCommentReply, createQuoteReply, commentPermalink } from './quote-reply.mjs'
import { loadIssueContent } from './load-issue.mjs'
import { issueRequestError, issueRequestStatus, type GithubComment, type GithubIssue,
  type IssueDetailApi } from './service'
import IssueDetailView from './IssueDetailView'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import type { FormNotice, IssueDetailViewActions, IssueDetailViewModel,
  LabourDraft, LabourField, PermissionView, QuoteReply } from './view-model'

type Load = {
  key: string; loading: boolean; refreshing: boolean; issue: GithubIssue | null; comments: GithubComment[];
  page: number; hasMore: boolean; fetchingMore: boolean;
  lastRead: string; error: { message: string; status: number } | null; pageError: string
}
const empty: Load = { key: '', loading: true, refreshing: false, issue: null, comments: [], page: 0, hasMore: false,
  fetchingMore: false, lastRead: '', error: null, pageError: '' }
type Auth = {
  key: string; status: 'checking' | 'anonymous' | 'authorized' | 'denied' | 'error'; message: string
}
const initialLabour: LabourDraft = { work: '', hours: '0.5', outcome: '',
  commits: '', start: '', end: '' }

function safeGitHubUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.origin === 'https://github.com' && !url.username && !url.password
      ? url.href : null
  } catch { return null }
}
function asIssueError(error: unknown) {
  return {message: error instanceof Error ? error.message : '请求失败',
    status: issueRequestStatus(error)}
}
function uniqueComments(items: readonly GithubComment[]) {
  const seen = new Set<number>()
  return items.filter(item => Number.isSafeInteger(item.id) &&
    (!seen.has(item.id) && Boolean(seen.add(item.id))))
}

/** @summary Orchestrate URL-bound Issue requests, OAuth checks and writes; prepare data for the pure View. */
export default function IssueDetailPage({ service }: { service: IssueDetailApi }) {
  const { owner, repo, number } = useParams<'owner' | 'repo' | 'number'>()
  const location = useLocation()
  const [state, setState] = useState<Load>(empty)
  const [auth, setAuth] = useState<Auth>({ key: '', status: 'checking', message: '' })
  const [reload, setReload] = useState(0)
  const [authRevision, setAuthRevision] = useState(0)
  useEffect(() => subscribeSessionChanged(() => setAuthRevision(n => n + 1)), [])
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState<{ key: string; quote: QuoteReply } | null>(null)
  const commentEdit = useRef(0)
  const writeInFlight = useRef(false)
  const [labour, setLabour] = useState<LabourDraft>(initialLabour)
  const [pendingKind, setPendingKind] = useState<'comment' | 'labour' | null>(null)
  const [notice, setNotice] = useState<FormNotice | null>(null)
  const revision = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const pageInFlight = useRef<number | null>(null)
  useEffect(() => {
    if (pageInFlight.current !== null && state.page >= pageInFlight.current) {
      pageInFlight.current = null
    }
  }, [state.page])
  const valid = validIssueTarget(owner, repo, number)
  const numberValue = Number(number)
  const target = (owner || '') + '/' + (repo || '')
  const homeHref=useHref('/')
  const repositoryHref=useHref(resourcePath(owner||'',repo||'')||'/')
  const routeKey = target + '/issues/' + (number || '')
  const {reason:accessReason,report}=useRepoAccess(routeKey+'/'+reload)
  const quote = selection?.key === routeKey ? selection.quote : null
  const commentBody = buildCommentReply(draft, quote)

  useEffect(() => {
    const current = ++revision.current
    pageInFlight.current = null
    const abort = new AbortController()
    controller.current = abort
    // Keep the mounted reading surface and its scroll position during same-Issue refresh.
    setState(previous => previous.key === routeKey && previous.issue
      ? { ...previous, refreshing: true, fetchingMore: false }
      : { ...empty, key: routeKey })
    setPendingKind(null)
    if (!valid || !owner || !repo) {
      setState({ ...empty, key: routeKey, loading: false,
        error: { message: '无效的 Issue URL', status: 404 } })
      return () => { abort.abort(); revision.current++ }
    }
    void (async () => {
      try {
        // Generic Issue reading must not depend on Channel configuration.
        const loaded = await loadIssueContent(service, owner, repo, numberValue, abort.signal)
        if (!loaded) throw issueRequestError('该地址不是有效的 GitHub Issue', 404)
        const { issue, first } = loaded
        if (current !== revision.current || abort.signal.aborted) return
        setState({ key: routeKey, loading: false, refreshing: false, issue, comments: uniqueComments(first.items),
          page: 1, hasMore: first.hasMore, fetchingMore: false,
          lastRead: new Date().toISOString(), error: null, pageError: '' })
      } catch (error) {
        if (current !== revision.current || abort.signal.aborted) return
        report(error)
        const failure=asIssueError(error)
        setState(previous=>previous.key===routeKey&&previous.issue
          ? {...previous,refreshing:false,fetchingMore:false,error:failure,pageError:failure.message}
          : {...empty,key:routeKey,loading:false,error:failure})
      }
    })()
    return () => { abort.abort(); revision.current++ }
  }, [service, owner, repo, number, valid, numberValue, routeKey, reload, report])

  useEffect(() => {
    const abort = new AbortController()
    setAuth({ key: routeKey, status: 'checking', message: '' })
    if (!valid || !owner || !repo) return () => abort.abort()
    void (async () => {
      try {
        if (!await service.getSession(abort.signal)) {
          if (!abort.signal.aborted) setAuth({ key: routeKey, status: 'anonymous', message: '' })
          return
        }
        const verified = await service.verify(owner, repo, abort.signal)
        if (!abort.signal.aborted) setAuth(verified.repository.accessible
          ? { key: routeKey, status: 'authorized',
            message: 'GitHub OAuth 身份与 App 仓库范围已验证。' }
          : { key: routeKey, status: 'denied',
            message: '当前 OAuth 用户不能通过 App 访问此仓库。' })
      } catch (error) {
        if (!abort.signal.aborted) setAuth({
          key: routeKey, status: 'error', message: asIssueError(error).message,
        })
      }
    })()
    return () => abort.abort()
  }, [service, owner, repo, valid, routeKey, authRevision])

  const issue = state.key === routeKey && !state.loading ? state.issue : null
  const completePages = Boolean(issue && !state.hasMore && !state.pageError && !state.error && !accessReason &&
    state.comments.length >= issue.comments)
  const summary = useMemo(() => summarizeIssueComments(
    state.key === routeKey ? state.comments : [], completePages),
  [state.key, state.comments, routeKey, completePages])
  const authStatus = auth.key === routeKey ? auth.status : 'checking'
  const canWrite = authStatus === 'authorized' && Boolean(issue) && !state.refreshing && !accessReason && !state.error
  const loginUrl = loginHref(location.pathname)

  const permission: PermissionView = {
    state: authStatus,
    allowed: canWrite,
    reason: accessReason ? '仓库访问授权需要恢复；已读内容及草稿暂保留，禁止提交。'
      : state.error && issue ? '重新读取失败；已读内容可能过时，暂不能提交。'
      : authStatus === 'checking' ? '正在检查登录和提交权限。'
      : authStatus === 'anonymous' ? '匿名用户只能阅读，登录 GitHub 后可检查提交权限。'
      : authStatus === 'denied' ? '当前账号没有此项目的访问授权，不能提交。'
      : authStatus === 'error' ? '无法确认写入权限：' + auth.message + '。'
      : state.refreshing ? '正在刷新讨论，暂不能提交。'
      : canWrite ? '' : '讨论尚未成功加载，暂不能提交。',
    loginHref: authStatus === 'anonymous' || authStatus === 'denied' ||
      authStatus === 'error' ? loginUrl : null,
    loginText: authStatus === 'anonymous' ? 'GitHub 登录' : '重新授权',
  }

  async function loadMore() {
    if (!valid || !owner || !repo || !issue || !state.hasMore || state.refreshing ||
        state.fetchingMore || accessReason || state.error || pageInFlight.current !== null) return
    const page = state.page + 1
    pageInFlight.current = page
    const current = revision.current
    setState(previous => ({ ...previous, fetchingMore: true, pageError: '' }))
    try {
      const next = await service.getComments(owner, repo, numberValue, page,
        controller.current?.signal || new AbortController().signal)
      if (current !== revision.current) return
      setState(previous => previous.key !== routeKey || previous.page !== page - 1
        ? previous : ({ ...previous, fetchingMore: false, page,
          comments: uniqueComments([...previous.comments, ...next.items]),
          lastRead: new Date().toISOString(), hasMore: next.hasMore, pageError: '' }))
    } catch (error) {
      if (current === revision.current) {
        if (pageInFlight.current === page) pageInFlight.current = null
        report(error)
        setState(previous => ({
          ...previous, fetchingMore: false, pageError: asIssueError(error).message,
        }))
      }
    } finally {
      // A completed page remains locked until React commits its new cursor.
      if (current === revision.current && pageInFlight.current === page &&
          controller.current?.signal.aborted) pageInFlight.current = null
    }
  }

  async function submit(body: string, kind: 'comment' | 'labour') {
    if (!canWrite || pendingKind || writeInFlight.current || !owner || !repo || !valid || !body.trim()) return
    if (body.length > COMMENT_LIMIT) {
      setNotice({ kind, tone: 'error', message: '提交内容（含引用）超过 20000 字符，请缩短后重试。' })
      return
    }
    if (!window.confirm('确认以当前 GitHub 身份在 ' + target + ' #' + numberValue + ' 公开发表这条' +
      (kind === 'labour' ? '劳动记录' : '评论') + '？')) return
    const current = revision.current
    const submittedEdit = commentEdit.current
    const submittedLabour = labour
    writeInFlight.current = true
    setPendingKind(kind)
    setNotice(null)
    try {
      const response = await service.postComment(owner, repo, numberValue, body,
        controller.current?.signal || new AbortController().signal)
      if (current !== revision.current) return
      if (kind === 'comment') {
        if (commentEdit.current === submittedEdit) { setDraft(''); setSelection(null) }
      } else setLabour(previous => previous === submittedLabour
        ? { ...initialLabour, hours: previous.hours } : previous)
      setNotice({ kind, tone: 'success',
        message: 'GitHub 已确认发表：评论 #' + response.id + '。正在刷新讨论。' })
      setReload(value => value + 1)
    } catch (error) {
      if (current === revision.current) setNotice({ kind, tone: 'error',
        message: asIssueError(error).message +
          '。如提交状态未知，请先在 GitHub 检查，避免重复发表。' })
    } finally {
      if (current === revision.current) { writeInFlight.current = false; setPendingKind(null) }
    }
  }

  function submitLabour() {
    try {
      const shas = labour.commits.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
      const toRfc3339 = (value: string) => value ? new Date(value).toISOString() : ''
      const body = formatLabourComment({ work: labour.work, hr: Number(labour.hours),
        outcome: labour.outcome, commits: shas,
        start: toRfc3339(labour.start), end: toRfc3339(labour.end) })
      void submit(body, 'labour')
    } catch {
      setNotice({ kind: 'labour', tone: 'error',
        message: '请检查工作内容、至少 0.5 小时且按 0.5 递增的估时、完整 Commit SHA，以及成对且顺序正确的起止时间。' })
    }
  }

  const warnings: string[] = []
  if(issue&&(accessReason||state.error))warnings.push('当前保留上次已读取的内容；恢复授权后重新读取 Issue 与第一页评论，不会自动提交草稿。')

  const latestOutcome = [...summary.records].filter(record => !record.conflicted && record.outcome)
    .sort((a, b) => (Date.parse(b.comment.created_at) || 0) -
      (Date.parse(a.comment.created_at) || 0))[0]
  const model: IssueDetailViewModel = {
    routeKey,
    navigation: { homeHref, repositoryHref, repository: target },
    load: {
      phase: state.key !== routeKey || state.loading ? 'loading'
        : state.error && !issue ? 'error' : 'ready',
      error: state.key === routeKey ? state.error?.message || null : null,
      statusCode: state.key === routeKey ? state.error?.status || null : null,
    },
    issue: issue ? {
      number: issue.number, title: issue.title, state: issue.state === 'open' ? 'Open' : 'Closed',
      author: issue.user?.login || '未知', created: issue.created_at || '未知',
      body: issue.body || '（无正文）', sourceUrl: safeGitHubUrl(issue.html_url),
      updated: issue.updated_at || '未知',
      labourSummary: {
        hours: summary.hours, complete: summary.complete,
        statusText: summary.complete
          ? '已读取全部评论；仅合计无冲突的有效主观登记工时。'
          : '仅为已读取评论中的无冲突主观登记工时，非完整汇总。',
        outcome: latestOutcome ? {
          text: latestOutcome.outcome!, author: latestOutcome.comment.user?.login || '未知',
          time: latestOutcome.comment.created_at,
          sourceUrl: safeGitHubUrl(latestOutcome.comment.html_url),
        } : null,
        outcomeEmptyText: summary.complete
          ? '当前 Issue 没有已登记的有效成果。'
          : '目前已读取的记录中暂无可确认的成果；评论尚可能不完整。',
      },
      pagination: {
        loaded: state.comments.length, expected: issue.comments, hasMore: state.hasMore,
        fetchingMore: state.fetchingMore, error: state.pageError, lastRead: state.lastRead,
        warnings, complete: completePages,
      },
      discussion: {
        comments: summary.discussion.map(item => ({
          id: item.id, author: item.user?.login || '未知', time: item.created_at,
          body: item.body || '（空评论）', sourceUrl: commentPermalink(item.html_url, owner || '', repo || '', numberValue, item.id),
        })),
        emptyText: completePages
          ? '当前 Issue 没有普通讨论评论。'
          : '已读取的评论中尚无普通讨论；还有评论可能未取得。',
      },
      labour: {
        records: summary.records.map(record => ({
          id: record.comment.id, author: record.comment.user?.login || '未知',
          time: record.comment.created_at, work: record.work, hours: record.hours,
          outcome: record.outcome, conflicted: record.conflicted,
          occurrence: record.startEnd
            ? record.startEnd.start + ' — ' + record.startEnd.end : '未登记',
          sourceUrl: safeGitHubUrl(record.comment.html_url),
          commits: record.commits.map(sha => ({
            sha, href: 'https://github.com/' + target + '/commit/' + sha,
          })),
        })),
        emptyText: completePages
          ? '当前 Issue 没有有效 Labour Record 登记。'
          : '已读取的评论中尚无有效劳动记录；仍有评论可能未取得。',
        invalidCount: summary.invalidCandidates.length,
      },
    } : null,
    form: { draft, quote, commentLength: commentBody.length, refreshing: state.refreshing,
      labour, pending: Boolean(pendingKind), pendingKind,
      notice, permission },
  }

  function retryRead(){
    if(writeInFlight.current||state.refreshing)return
    setState(previous=>({...previous,refreshing:true}))
    if(accessReason||state.error){setAuth({key:routeKey,status:'checking',message:''});setAuthRevision(n=>n+1)}
    setReload(n=>n+1)
  }
  const actions: IssueDetailViewActions = {
    onRetry: retryRead,
    onRefresh: retryRead,
    onLoadMore: () => { void loadMore() },
    onCommentChange: value => { commentEdit.current++; setDraft(value) },
    onQuoteComment: id => {
      if (!issue || !owner || !repo) return
      const item = summary.discussion.find(comment => comment.id === id)
      if (!item) return
      const selected = createQuoteReply(item, owner, repo, numberValue)
      if (selected) { commentEdit.current++; setSelection({ key: routeKey, quote: selected }) }
    },
    onCancelQuote: () => { commentEdit.current++; setSelection(null) },
    onLabourChange: (field: LabourField, value: string) => {
      setLabour(previous => ({ ...previous, [field]: value }))
    },
    onSubmitComment: () => { if (draft.trim()) void submit(commentBody, 'comment') },
    onSubmitLabour: submitLabour,
  }
  const accessNotice=accessReason&&owner&&repo?<RepoAccessNotice owner={owner} repo={repo}
    reason={accessReason} onRetry={retryRead} retryDisabled={Boolean(pendingKind)||state.refreshing}/>:null
  return <IssueDetailView key={routeKey} model={model} actions={actions} accessNotice={accessNotice}
    paginationBlocked={Boolean(accessReason||state.error)}/>
}
