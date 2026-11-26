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
import { uncertainWriteResult } from '../../shared/src/browser-http'
import type { FormNotice, IssueDetailViewActions, IssueDetailViewModel,
  LabourDraft, LabourField, PermissionView, QuoteReply } from './view-model'

type FormKind = 'comment' | 'labour'

type Load = {
  key: string; loading: boolean; refreshing: boolean; issue: GithubIssue | null; comments: GithubComment[];
  page: number; hasMore: boolean; fetchingMore: boolean;
  lastRead: string; error: { message: string; status: number } | null; pageError: string
}
const empty: Load = { key: '', loading: true, refreshing: false, issue: null, comments: [], page: 0, hasMore: false,
  fetchingMore: false, lastRead: '', error: null, pageError: '' }
type Auth = {
  key: string; status: 'checking' | 'anonymous' | 'authorized' | 'denied' | 'error'; message: string
  userId?: number; epoch?: number
}

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
const initialLabour: LabourDraft = {work:'',hours:'0.5',outcome:'',commits:'',start:'',end:''}
function sameLabourDraft(a:LabourDraft,b:LabourDraft){
  return (Object.keys(a) as LabourField[]).every(field=>a[field]===b[field])
}

/** @summary Orchestrate URL-bound Issue requests, OAuth checks and writes; prepare data for the pure View. */
export default function IssueDetailPage({ service }: { service: IssueDetailApi }) {
  const { owner, repo, number } = useParams<'owner' | 'repo' | 'number'>()
  const location = useLocation()
  const [state, setState] = useState<Load>(empty)
  const [auth, setAuth] = useState<Auth>({ key: '', status: 'checking', message: '' })
  const [reload, setReload] = useState(0)
  const [authRevision, setAuthRevision] = useState(0)
  const [draft,setDraft]=useState('')
  const [quote,setQuote]=useState<QuoteReply|null>(null)
  const [labour,setLabour]=useState<LabourDraft>({...initialLabour})
  const activeScope=useRef('')
  const lastUserId=useRef<number|null>(null)
  const writeInFlight=useRef<{kind:FormKind;abort:AbortController}|null>(null)
  const [pendingKind,setPendingKind]=useState<FormKind|null>(null)
  const [unknownKind,setUnknownKind]=useState<FormKind|null>(null)
  useEffect(()=>subscribeSessionChanged(()=>{
    activeScope.current=''
    lastUserId.current=null
    writeInFlight.current?.abort.abort()
    writeInFlight.current=null
    setPendingKind(null)
    setUnknownKind(null)
    setDraft('')
    setQuote(null)
    setLabour({...initialLabour})
    setAuth({key:'',status:'checking',message:''})
    setNotice(null)
    setAuthRevision(n=>n+1)
  }),[])
  useEffect(()=>()=>{activeScope.current='';writeInFlight.current?.abort.abort();writeInFlight.current=null},[])
  const [notice, setNotice] = useState<FormNotice | null>(null)
  const publishedRefresh=useRef<string|null>(null)
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

  useEffect(() => {
    const current = ++revision.current
    if(writeInFlight.current?.abort.signal.aborted){writeInFlight.current=null;setPendingKind(null)}
    pageInFlight.current = null
    const abort = new AbortController()
    controller.current = abort
    // Keep the mounted reading surface and its scroll position during same-Issue refresh.
    setState(previous => previous.key === routeKey && previous.issue
      ? { ...previous, refreshing: true, fetchingMore: false }
      : { ...empty, key: routeKey })
    if (!valid || !owner || !repo) {
      setState({ ...empty, key: routeKey, loading: false,
        error: { message: '无效的 Issue URL', status: 404 } })
      return () => { abort.abort(); writeInFlight.current?.abort.abort(); revision.current++ }
    }
    void (async () => {
      try {
        // Generic Issue reading must not depend on Channel configuration.
        const loaded = await loadIssueContent(service, owner, repo, numberValue, abort.signal)
        if (!loaded) throw issueRequestError('该地址不是有效的 GitHub Issue', 404)
        const { issue, first } = loaded
        if (current !== revision.current || abort.signal.aborted) return
        const published=publishedRefresh.current
        if(published){setNotice(previous=>previous?.url===published?{...previous,message:'已发表；讨论列表已重新读取。'}:previous);publishedRefresh.current=null}
        setState({ key: routeKey, loading: false, refreshing: false, issue, comments: uniqueComments(first.items),
          page: 1, hasMore: first.hasMore, fetchingMore: false,
          lastRead: new Date().toISOString(), error: null, pageError: '' })
      } catch (error) {
        if (current !== revision.current || abort.signal.aborted) return
        report(error)
        const published=publishedRefresh.current
        if(published){setNotice(previous=>previous?.url===published?{...previous,message:'GitHub 已确认发表；讨论列表刷新失败，请通过评论来源核实。'}:previous);publishedRefresh.current=null}
        const failure=asIssueError(error)
        setState(previous=>previous.key===routeKey&&previous.issue
          ? {...previous,refreshing:false,fetchingMore:false,error:failure,pageError:failure.message}
          : {...empty,key:routeKey,loading:false,error:failure})
      }
    })()
    return () => { abort.abort(); writeInFlight.current?.abort.abort(); revision.current++ }
  }, [service, owner, repo, number, valid, numberValue, routeKey, reload, report])

  useEffect(() => {
    const abort = new AbortController()
    setAuth({ key: routeKey, status: 'checking', message: '',epoch:authRevision })
    if (!valid || !owner || !repo) return () => abort.abort()
    void (async () => {
      try {
        if (!await service.getSession(abort.signal)) {
          if (!abort.signal.aborted) setAuth({ key: routeKey, status: 'anonymous', message: '',epoch:authRevision })
          return
        }
        const verified = await service.verify(owner, repo, abort.signal)
        if (!abort.signal.aborted) setAuth(verified.repository.accessible &&
          Number.isSafeInteger(verified.user?.id) && verified.user.id>0 &&
          verified.repository.full_name?.toLowerCase()===target.toLowerCase()
          ? { key: routeKey, status: 'authorized',userId:verified.user.id,epoch:authRevision,
            message: '当前账号身份与项目访问权限已确认。' }
          : { key: routeKey, status: 'denied',epoch:authRevision,
            message: '当前账号身份或项目访问权限无法确认。' })
      } catch (error) {
        if (!abort.signal.aborted) setAuth({
          key: routeKey, status: 'error', message: asIssueError(error).message,epoch:authRevision,
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
  const authStatus = auth.key === routeKey && auth.epoch===authRevision ? auth.status : 'checking'
  const identity = authStatus==='authorized' && auth.userId && valid && owner && repo && resourcePath(owner,repo,'issue',numberValue)
    ? {owner,repo,number:numberValue,userId:auth.userId} : null
  if(identity)lastUserId.current=identity.userId
  const scope=routeKey+':'+(identity?.userId??lastUserId.current??'pending')
  const commentBody=buildCommentReply(draft,quote)
  const loginUrl = loginHref(location.pathname)
  const canWrite = authStatus === 'authorized' && Boolean(identity) && Boolean(issue) &&
    !state.refreshing && !accessReason && !state.error
  useEffect(()=>{
    activeScope.current=scope
    setDraft('')
    setQuote(null)
    setLabour({...initialLabour})
    setPendingKind(null)
    setUnknownKind(null)
    setNotice(null)
    return ()=>{if(activeScope.current===scope)activeScope.current=''}
  },[scope])

  const permission: PermissionView = {
    state: authStatus,
    allowed: canWrite,
    reason: accessReason ? '仓库访问授权需要恢复；已读内容暂时保留，禁止提交。'
      : state.error && issue ? '重新读取失败；已读内容可能过时，暂不能提交。'
      : authStatus === 'checking' ? '正在检查登录和提交权限。'
      : authStatus === 'anonymous' ? '登录后即可发表评论或登记劳动。'
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

  async function submit(body: string, kind: FormKind) {
    if (!canWrite || pendingKind || writeInFlight.current || unknownKind===kind ||
        !owner || !repo || !valid || !body.trim() || !scope || activeScope.current!==scope) return
    if (body.length > COMMENT_LIMIT) {
      setNotice({ kind, tone: 'error', message: '提交内容（含引用）超过 20000 字符，请缩短后重试。' })
      return
    }
    if (!window.confirm('确认以当前 GitHub 身份在 ' + target + ' #' + numberValue + ' 公开发表这条' +
      (kind === 'labour' ? '劳动记录' : '评论') + '？')) return
    const submittedDraft=draft
    const submittedQuote=quote
    const submittedLabour={...labour}
    const current=revision.current
    const abort=new AbortController()
    const flight={kind,abort}
    writeInFlight.current=flight
    setPendingKind(kind)
    setNotice(null)
    const active=()=>writeInFlight.current===flight&&!abort.signal.aborted&&
      current===revision.current&&activeScope.current===scope
    try {
      const response=await service.postComment(owner,repo,numberValue,body,abort.signal)
      if(!active())return
      const permalink=commentPermalink(response.html_url,owner,repo,numberValue,response.id)
      if(!Number.isSafeInteger(response.id)||response.id<=0||!permalink)
        throw issueRequestError('GitHub 返回的评论结果无法确认',502)
      if(kind==='comment'){
        setDraft(value=>value===submittedDraft?'':value)
        setQuote(value=>value===submittedQuote?null:value)
      }else{
        setLabour(value=>sameLabourDraft(value,submittedLabour)?{...initialLabour}:value)
      }
      publishedRefresh.current=permalink
      setNotice({kind,tone:'success',message:'GitHub 已确认发表：评论 #'+response.id+'。',url:permalink})
      setReload(value=>value+1)
    } catch(error) {
      if(!active())return
      const unknown=uncertainWriteResult(error)
      if(unknown)setUnknownKind(kind)
      setNotice({kind,tone:'error',message:asIssueError(error).message+(unknown
        ? '。提交状态未知，请先在 GitHub 检查，避免重复发表。'
        : '。提交未成功，请修正内容后重试。')})
    } finally {
      if(writeInFlight.current===flight){writeInFlight.current=null;setPendingKind(null)}
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
  if(issue&&(accessReason||state.error))warnings.push('当前保留上次已读取的内容；恢复授权后重新读取 Issue 与第一页评论。')

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
      notice, permission, unknownKind },
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
    onCommentChange: value => setDraft(value),
    onQuoteComment: id => {
      if (!canWrite || !issue || !owner || !repo) return
      const item = summary.discussion.find(comment => comment.id === id)
      if (!item) return
      const selected = createQuoteReply(item, owner, repo, numberValue)
      if (selected) setQuote(selected)
    },
    onCancelQuote: () => setQuote(null),
    onLabourChange: (field: LabourField, value: string) => {
      setLabour(previous=>({...previous,[field]:value}))
    },
    onSubmitComment: () => { if (draft.trim()) void submit(commentBody, 'comment') },
    onSubmitLabour: submitLabour,
  }
  const accessNotice=accessReason&&owner&&repo?<RepoAccessNotice owner={owner} repo={repo}
    reason={accessReason} onRetry={retryRead} retryDisabled={Boolean(pendingKind)||state.refreshing}/>:null
  return <IssueDetailView key={routeKey} model={model} actions={actions} accessNotice={accessNotice}
    paginationBlocked={Boolean(accessReason||state.error)}/>
}
