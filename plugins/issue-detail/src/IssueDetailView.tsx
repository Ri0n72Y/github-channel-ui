import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject, type ReactNode } from 'react'
import type { CommentItemView, IssueDetailViewActions, IssueDetailViewModel, IssueTab,
  LabourField, LabourItemView, PermissionView, FormNotice } from './view-model'
import { SafeMarkdown } from '../../shared/src/SafeMarkdown'
import styles from './IssueDetailView.module.css'
import { ExternalIcon, ReplyIcon, LocalTime } from '../../shared/src/Presentation'

type Props = { model: IssueDetailViewModel; actions: IssueDetailViewActions }

/** @summary Resolve keyboard navigation inside the two-tab Issue view. */
export function issueTabForKey(current: IssueTab, key: string): IssueTab | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return current === 'discussion' ? 'labour' : 'discussion'
  }
  if (key === 'Home') return 'discussion'
  if (key === 'End') return 'labour'
  return null
}

function PermissionHint({ permission }: { permission: PermissionView }) {
  if (permission.allowed) return <p className={styles.permission}>将以你的 GitHub 身份公开提交，结果以 GitHub 确认为准。</p>
  return <p className={styles.permission} role={permission.state === 'error' ? 'alert' : 'status'}>
    {permission.reason}
    {permission.loginHref && <> · <a href={permission.loginHref}>{permission.loginText}</a></>}
  </p>
}

function LoginComposer({permission,kind,hidden=false}:{permission:PermissionView;kind:'comment'|'labour';hidden?:boolean}){
  return <div hidden={hidden} className={styles.loginComposer}>
    {!permission.reason.startsWith('登录后')&&<p role="status" className={styles.permission}>{permission.reason}</p>}
    {permission.loginHref&&<a href={permission.loginHref}>{kind==='comment'?'登录后即可发表评论':'登录后即可登记劳动'}</a>}
  </div>
}
function FormFeedback({ notice, kind }: { notice: FormNotice | null; kind: 'comment' | 'labour' }) {
  if (!notice || notice.kind !== kind) return null
  return <p className={notice.tone === 'error' ? styles.error : styles.success}
    role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}{notice.url&&<> · <a href={notice.url} target="_blank" rel="noopener noreferrer">查看已发表评论</a></>}</p>
}

/** @summary Complete read-only discussion content uses the shared safe Markdown subset. */
function DiscussionMarkdown({ body, empty }: { body: string; empty: string }) {
  return body.trim() ? <div className={styles.markdownBody}><SafeMarkdown body={body} article /></div>
    : <p className={styles.empty}>{empty}</p>
}

function DiscussionView({ model, actions, onReplyFocus }: Props & { onReplyFocus(): void }) {
  const issue = model.issue!
  return <>
    <h2 className={styles.panelTitle}>讨论</h2>
    <ul className={[styles.list, styles.discussionList].join(' ')}>{issue.discussion.comments.map((item: CommentItemView) =>
      <li key={item.id} className={styles.listItem}>
        <article className={styles.commentCard}>
          <span className={styles.authorMark} aria-hidden="true">{Array.from(item.author.trim())[0]?.toUpperCase() || '?'}</span>
          <div className={styles.commentCopy}>
            <header className={styles.commentHeader}>
              <strong>{item.author}</strong>
              <span className={styles.meta}><LocalTime value={item.time}/></span>
              <span className={styles.commentActions}>
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="GitHub 来源" title="GitHub 来源"><ExternalIcon/></a>}
                {model.form.permission.allowed&&<button type="button" className={styles.quoteAction} aria-label={'引用回复 ' + item.author} title={'引用回复 ' + item.author}
                  onClick={() => { actions.onQuoteComment(item.id); onReplyFocus() }}><ReplyIcon/></button>}
              </span>
            </header>
            <DiscussionMarkdown body={item.body} empty="此评论暂无正文。"/>
          </div>
        </article>
      </li>)}</ul>
    {!issue.discussion.comments.length && <p className={styles.empty}>{issue.discussion.emptyText}</p>}
  </>
}

function CommentComposer({ model, actions, inputRef, hidden }: Props & { inputRef: RefObject<HTMLTextAreaElement | null>; hidden: boolean }) {
  const form = model.form
  const tooLong = form.commentLength > 20000
  const preview = Array.from((form.quote?.excerpt || '').replace(/\s+/g, ' '))
  if(form.permission.state==='anonymous')return <LoginComposer permission={form.permission} kind="comment" hidden={hidden}/>
  return <form hidden={hidden} tabIndex={0} className={[styles.composer, styles.commentComposer].join(' ')} aria-label="参与讨论"
    onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); actions.onSubmitComment() }}>
    {form.quote && <div className={styles.quotePreview} aria-label="当前引用">
        <div className={styles.quoteCopy}>
          <strong>回复 {form.quote.author}</strong>
          {form.quote.sourceUrl && <> · <a href={form.quote.sourceUrl} target="_blank" rel="noopener noreferrer">原评论</a></>}
          <p>摘要：{preview.slice(0, 36).join('')}{preview.length > 36 ? '…' : ''}{form.quote.truncated && '（引用已截取）'}</p>
        </div>
        <button type="button" onClick={() => { actions.onCancelQuote(); inputRef.current?.focus() }}>取消引用</button>
      </div>}
    <div className={styles.composerInfo}>
      <PermissionHint permission={form.permission}/>
      {form.pending && form.pendingKind === 'comment' && <p role="status" className={styles.meta}>正在提交评论，请勿重复操作。</p>}
      <FormFeedback notice={form.notices.comment} kind="comment"/>

    </div>
    <div className={styles.commentComposerRow}>
      <label>写下你的评论
        <textarea ref={inputRef} rows={3} maxLength={20000} value={form.draft} readOnly={form.permission.state!=='authorized'}
          onChange={event => actions.onCommentChange(event.target.value)} />
      </label>
      <div className={styles.sendActions}>
        <button type="submit" disabled={!form.permission.allowed || form.pending || form.unknownKinds.includes('comment') || !form.draft.trim() || tooLong}>
          {form.pending && form.pendingKind === 'comment' ? '提交中…' : '发表评论'}
        </button>
        {form.quote && <span className={styles.meta}>{form.commentLength} / 20000 字符（含引用）</span>}
      </div>
    </div>
    {tooLong && <p className={styles.error} role="alert">提交内容（含引用）超过 20000 字符，请缩短后重试。</p>}
  </form>
}

function LabourHistoryView({ model, actions }: Props) {
  const issue = model.issue!
  const form = model.form
  const update = (field: LabourField, value: string) => actions.onLabourChange(field, value)
  return <>
    <h2>当前 Issue 劳动历史</h2>
    <p className={styles.meta}>仅展示本 Issue 中可识别的结构化登记；没有可靠 Issue 关联的独立 Commit 不计入。</p>
    <ul className={styles.list}>{issue.labour.records.map((item: LabourItemView) =>
      <li key={item.id} className={styles.listItem}>
        <article className={styles.record}>
          <p className={styles.meta}>{item.author} · 登记于 <LocalTime value={item.time}/>
            {item.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">原始劳动评论</a></>}
          </p>
          <div className={styles.body}>{item.work}</div>
          <p>主观估时：{item.hours} 小时
            {item.conflicted && <span className={styles.warning}> · Commit 冲突，暂不计入总数</span>}
          </p>
          {item.outcome && <p className={styles.body}>成果：{item.outcome}</p>}
          <p className={styles.meta}>劳动发生时间：{item.occurrence}</p>
          {item.commits.map(commit => <p key={commit.sha} className={styles.commit}>
            Commit：<a href={commit.href} target="_blank" rel="noopener noreferrer">{commit.sha}</a>
          </p>)}
        </article>
      </li>)}</ul>
    {!issue.labour.records.length && <p>{issue.labour.emptyText}</p>}
    {issue.labour.invalidCount > 0 && <p className={styles.warning} role="status">
      {issue.labour.invalidCount} 条候选劳动评论格式无效，仍保留在普通讨论中；统计不能视为完整。
    </p>}
    {form.permission.state==='anonymous'?<LoginComposer permission={form.permission} kind="labour"/>:<form className={styles.composer} onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      actions.onSubmitLabour()
    }}>
      <h3>登记劳动记录</h3>
      <fieldset disabled={form.permission.state!=='authorized'} className={styles.labourFields}>
      <label>工作内容（必填）
        <textarea rows={4} required value={form.labour.work}
          onChange={event => update('work', event.target.value)}/>
      </label>
      <label>主观估时 / 小时（0.5 递增）
        <input type="number" required min="0.5" step="0.5" value={form.labour.hours}
          onChange={event => update('hours', event.target.value)}/>
      </label>
      <label>成果（可选）
        <textarea rows={3} value={form.labour.outcome}
          onChange={event => update('outcome', event.target.value)}/>
      </label>
      <details className={styles.secondaryDetails} open={form.notices.labour?.tone==='error' ? true : undefined}><summary>关联提交与时间（可选）</summary>
      <label>关联 Commit SHA（可选；逗号或换行分隔）
        <textarea rows={3} value={form.labour.commits}
          onChange={event => update('commits', event.target.value)}/>
      </label>
      <div className={styles.dateFields}>
        <label>开始时间（可选）
          <input type="datetime-local" value={form.labour.start}
            onChange={event => update('start', event.target.value)}/>
        </label>
        <label>结束时间（可选；与开始时间成对）
          <input type="datetime-local" value={form.labour.end}
            onChange={event => update('end', event.target.value)}/>
        </label>
      </div>
      </details>
      </fieldset>
      <div className={styles.formActions}>
        <button type="submit" disabled={!form.permission.allowed || form.pending || form.unknownKinds.includes('labour') || !form.labour.work.trim()}>
          {form.pending && form.pendingKind === 'labour' ? '提交中…' : '确认登记劳动'}
        </button>
        {form.pending && form.pendingKind === 'labour' && <span role="status">正在提交劳动记录，请勿重复操作。</span>}
      </div>
      <PermissionHint permission={form.permission}/>
      <FormFeedback notice={form.notices.labour} kind="labour"/>

    </form>}
  </>
}

/** @summary Render Issue identity, conversation and labour forms from typed props, without business dependencies. */
export default function IssueDetailView({ model, actions, accessNotice, paginationBlocked=false }: Props & {accessNotice?:ReactNode;paginationBlocked?:boolean}) {
  const [tab, setTab] = useState<IssueTab>('discussion')
  const [canScrollDown,setCanScrollDown]=useState(false)
  const [compact,setCompact]=useState(false)
  const baseId = useId()
  const pageRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const readingRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const discussionTab = useRef<HTMLButtonElement>(null)
  const labourTab = useRef<HTMLButtonElement>(null)
  const tabId = (name: IssueTab) => baseId + '-tab-' + name
  const panelId = (name: IssueTab) => baseId + '-panel-' + name

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = issueTabForKey(tab, event.key)
    if (!next) return
    event.preventDefault()
    setTab(next)
    ;(next === 'discussion' ? discussionTab : labourTab).current?.focus()
  }

  // Measure the actual host offset, not a guessed toolbar height. VisualViewport
  // resize/scroll accounts for mobile keyboards and browser viewport changes.
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const viewport = window.visualViewport
    const update = () => {
      const height = Math.max(1, Math.floor(viewport?.height ?? window.innerHeight))
      const top = viewport?.offsetTop ?? 0
      // If the host toolbar fills the visible area, allow the document to scroll
      // to a small usable shell, without creating a shell taller than the viewport.
      const available = Math.max(Math.min(120, height),
        Math.floor(top + height - Math.max(top, page.getBoundingClientRect().top)))
      const mode = available < 480 ? 'compact' : 'split'
      setCompact(mode==='compact')
      const previous = page.dataset.heightMode
      const shell = shellRef.current
      const reading = readingRef.current
      const position = previous === 'compact' ? shell?.scrollTop : reading?.scrollTop
      const value = available + 'px'
      if (page.style.getPropertyValue('--issue-available-height') !== value)
        page.style.setProperty('--issue-available-height', value)
      if (previous !== mode) {
        page.dataset.heightMode = mode
        // Transfer the reading position, not an unconditional jump to the bottom.
        if (previous && shell && reading && position !== undefined) {
          if (mode === 'compact') shell.scrollTop = position
          else { shell.scrollTop = 0; reading.scrollTop = position }
        }
        // An already-focused editor/control must remain reachable after a keyboard resize.
        const active = document.activeElement
        if (active instanceof HTMLElement && shell?.contains(active) &&
            active.closest('form[aria-label="参与讨论"]'))
          active.scrollIntoView?.({block:'nearest',inline:'nearest'})
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, { passive: true })
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (page.parentElement) observer?.observe(page.parentElement)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [])
  const ready = model.load.phase === 'ready' && Boolean(model.issue)
  const scrollTarget=()=>pageRef.current?.dataset.heightMode==='compact'?shellRef.current:readingRef.current
  const distance=()=>{
    const target=scrollTarget()
    if(!target)return 0
    // Compact measures the full shell, including the composer dock.
    return Math.max(0,target.scrollHeight-target.clientHeight-target.scrollTop)
  }
  useEffect(()=>{
    if(!ready)return
    const update=()=>setCanScrollDown(distance()>80)
    const shell=shellRef.current,reading=readingRef.current,dock=dockRef.current
    shell?.addEventListener('scroll',update,{passive:true})
    reading?.addEventListener('scroll',update,{passive:true})
    window.addEventListener('resize',update)
    window.visualViewport?.addEventListener('resize',update)
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(update)
    if(reading){observer?.observe(reading);for(const child of Array.from(reading.children))observer?.observe(child)}
    if(dock){observer?.observe(dock);for(const child of Array.from(dock.children))observer?.observe(child)}
    update()
    return ()=>{
      shell?.removeEventListener('scroll',update);reading?.removeEventListener('scroll',update)
      window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update)
      observer?.disconnect()
    }
  },[ready,tab,compact,model.issue?.pagination.loaded,model.issue?.pagination.error,model.form.permission.state])
  function scrollToBottom(){
    const target=scrollTarget()
    if(!target)return
    const top=target.scrollTop+distance()
    if(typeof target.scrollTo==='function')target.scrollTo({top,behavior:'auto'})
    else target.scrollTop=top
    readingRef.current?.focus({preventScroll:true})
    setCanScrollDown(false)
  }
  const navigation = <nav className={styles.top} aria-label="Issue 导航">
    {model.navigation.repositoryHref!==model.navigation.homeHref &&
      <a href={model.navigation.repositoryHref}>返回项目</a>}
    {(!ready || model.navigation.repositoryHref===model.navigation.homeHref) &&
      <a href={model.navigation.homeHref}>返回首页</a>}
  </nav>
  return <div ref={pageRef} className={styles.page} data-ready={ready}>
    {!ready && navigation}
    {!ready && accessNotice}
    {model.load.phase === 'loading' && <p role="status">正在读取讨论与相关记录…</p>}
    {model.load.phase === 'error' && !accessNotice && <section className={styles.errorPanel}>
      <h1>{model.load.statusCode === 404 ? '404 · Issue 不存在' : 'Issue 无法加载'}</h1>
      <p role="alert">{model.load.error}（HTTP {model.load.statusCode}）</p>
      <button type="button" onClick={actions.onRetry}>重试读取</button>
    </section>}
    {model.load.phase === 'ready' && model.issue && <div ref={shellRef} className={styles.conversationShell} role="region" aria-label="Issue 讨论面板" tabIndex={0}>
      <div ref={readingRef} className={styles.conversationScroll} role="region" aria-label="Issue 阅读区" tabIndex={0}>
      {navigation}
      <header className={styles.context}>
        <div className={styles.identity}>
          <span className={styles.repository}>{model.navigation.repository}</span>
          <span className={styles.issueNumber}>#{model.issue.number}</span>
          <span className={styles.issueState} data-state={model.issue.state.toLowerCase()}>{model.issue.state.toLowerCase()==='open'?'开放中':model.issue.state.toLowerCase()==='closed'?'已关闭':model.issue.state}</span>
        </div>
        <h1>{model.issue.title}</h1>
        <p className={styles.meta}>创建者：{model.issue.author} · 创建于 <LocalTime value={model.issue.created}/>
          {model.issue.sourceUrl && <> · <a href={model.issue.sourceUrl}
            className={styles.sourceAction} target="_blank" rel="noopener noreferrer" aria-label="GitHub 原文" title="GitHub 原文"><ExternalIcon/></a></>}
        </p>


      </header>
      {accessNotice}
      {model.issue.pagination.warnings.length>0&&<ul className={styles.warnings}>{model.issue.pagination.warnings.map(message=><li key={message}>{message}</li>)}</ul>}
      {!model.issue.pagination.complete&&!accessNotice&&!model.load.error&&<p role="status" className={styles.warning}>{model.issue.pagination.hasMore?'还有未加载的评论，当前读取不完整。':'评论数量尚未核对完整，可重新读取。'}</p>}
      {!accessNotice&&(model.load.error||!model.issue.pagination.complete&&!model.issue.pagination.hasMore)&&<div>
        {model.load.error&&<p className={styles.error} role="alert">重新读取失败：{model.load.error}。</p>}
        <button type="button" onClick={actions.onRetry} disabled={model.form.pending||model.form.refreshing}>重新读取讨论</button>
      </div>}
      <div className={styles.tabs} role="tablist" aria-label="Issue 内容">
        <button ref={discussionTab} id={tabId('discussion')} role="tab" type="button"
          aria-controls={panelId('discussion')} aria-selected={tab === 'discussion'}
          tabIndex={tab === 'discussion' ? 0 : -1}
          onClick={() => setTab('discussion')} onKeyDown={onTabKeyDown}>讨论</button>
        <button ref={labourTab} id={tabId('labour')} role="tab" type="button"
          aria-controls={panelId('labour')} aria-selected={tab === 'labour'}
          tabIndex={tab === 'labour' ? 0 : -1}
          onClick={() => setTab('labour')} onKeyDown={onTabKeyDown}>劳动历史</button>
      </div>
        <section className={styles.issueBody} aria-label="Issue 正文">
          <h2>话题背景</h2>
          <DiscussionMarkdown body={model.issue.body} empty="此 Issue 暂无正文。"/>
        </section>
      <section role="tabpanel" id={panelId('discussion')} aria-labelledby={tabId('discussion')}
        tabIndex={0} hidden={tab !== 'discussion'} className={styles.tabpanel}>
        <DiscussionView model={model} actions={actions} onReplyFocus={() => inputRef.current?.focus()}/>
      </section>
      <section role="tabpanel" id={panelId('labour')} aria-labelledby={tabId('labour')}
        tabIndex={0} hidden={tab !== 'labour'} className={styles.tabpanel}>
        <section className={styles.summary} aria-label="最近劳动成果与工时摘要">
          <div className={styles.summaryPart}>
            <h2>最近已登记成果</h2>
            {model.issue.labourSummary.outcome ? <>
              <p className={styles.body}>{model.issue.labourSummary.outcome.text}</p>
              <p className={styles.meta}>登记者：{model.issue.labourSummary.outcome.author}
                {' · '}<LocalTime value={model.issue.labourSummary.outcome.time}/>
                {model.issue.labourSummary.outcome.sourceUrl && <> · <a
                  href={model.issue.labourSummary.outcome.sourceUrl} target="_blank" rel="noopener noreferrer">来源</a></>}
              </p>
            </> : <p className={styles.meta}>{model.issue.labourSummary.outcomeEmptyText}</p>}
          </div>
          <div className={styles.summaryPart}>
            <h2>已登记主观工时</h2>
            <p className={styles.hours}><strong>{model.issue.labourSummary.hours}</strong> 小时</p>
            <p className={model.issue.labourSummary.complete ? styles.meta : styles.warning}
              role="status">{model.issue.labourSummary.statusText}</p>
          </div>
        </section>
        <LabourHistoryView model={model} actions={actions}/>
      </section>
      <section className={styles.readStatus} aria-label="读取状态">
        <details className={styles.secondaryDetails}><summary>读取时间与来源</summary>
          <p>已读取 {model.issue.pagination.loaded} / {model.issue.pagination.expected} 条评论。</p>
          <p className={styles.meta}>本次从服务器读取：<LocalTime value={model.issue.pagination.lastRead}/>。GitHub Issue 更新时间：<LocalTime value={model.issue.updated}/>。页面不会自动实时更新。</p>
          {paginationBlocked && model.issue.pagination.error && <p>上次读取错误：{model.issue.pagination.error}</p>}
        </details>

        {model.issue.pagination.hasMore && (!model.issue.pagination.error || paginationBlocked) && <button type="button"
          disabled={paginationBlocked || model.issue.pagination.fetchingMore || model.form.refreshing} onClick={actions.onLoadMore}>
          {model.issue.pagination.fetchingMore ? '加载中…' : '加载下一页评论'}
        </button>}

        {model.issue.pagination.error && !paginationBlocked && <p className={styles.error} role="alert">
          分页失败：{model.issue.pagination.error}。
          {model.issue.pagination.hasMore && <button type="button" disabled={model.form.refreshing || model.issue.pagination.fetchingMore} onClick={actions.onLoadMore}>重试本页</button>}
        </p>}
      </section>
      </div>
      <div ref={dockRef} className={styles.composerDock} hidden={tab!=='discussion'}>
        {ready&&tab==='discussion'&&canScrollDown&&<button type="button" className={styles.scrollBottom}
          aria-label="滚动到底部" title="滚动到底部" onClick={scrollToBottom}>↓</button>}
        <CommentComposer model={model} actions={actions} inputRef={inputRef} hidden={tab !== 'discussion'}/>
      </div>
    </div>}
  </div>
}
