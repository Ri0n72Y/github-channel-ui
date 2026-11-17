import type { FormEvent, RefObject } from 'react'
import TopicPageHead from './TopicPageHead'
import TopicProjectCard from './TopicProjectCard'
import TopicStatus from './TopicStatus'
import TopicConfigEditor from './TopicConfigEditor'
import TopicReportDialog from './TopicReportDialog'
import type { TopicPageError, TopicRepository, TopicSnapshot, TopicConfigResult } from './service'
import styles from './topic-page.module.css'

export type TopicPageViewProps = {
  owner: string; repo: string; snapshot: TopicSnapshot | null;
  projects: TopicRepository[]; loading: boolean;
  error: TopicPageError | null; windowExhausted: boolean;
  canLoadMore?: boolean; loadingMore?: boolean; moreError?: TopicPageError | null;
  sentinelRef?: RefObject<HTMLDivElement | null>; onLoadMore?: () => void;
  draft?: string; authenticated?: boolean; configPending?: boolean;
  configError?: string; configResult?: TopicConfigResult | null; configUncertain?: boolean;
  configAwaitingMerge?: boolean; onConfigRecheck?: () => void;
  onDraftChange?: (value: string) => void; onConfigSave?: () => void;
  onConfirmConfigUnknown?: () => void;
  report: { open: boolean; title: string; body: string; pending: boolean;
    checking: boolean; uncertain: boolean; message: string; url: string };
  writeEnabled: boolean; canReport: boolean;
  onRetry(): void; onOpenReport(): void; onCloseReport(): void;
  onConfirmUnknown(): void;
  onReportTitleChange(value: string): void; onReportBodyChange(value: string): void;
  onSubmitReport(event: FormEvent<HTMLFormElement>): void;
}

/** @summary Render Topic projects, explicit search bounds and an editable report without business fetches. */
export default function TopicPageView(props: TopicPageViewProps) {
  const githubIssuesUrl = 'https://github.com/' + encodeURIComponent(props.owner) + '/' +
    encodeURIComponent(props.repo) + '/issues'
  const base = githubIssuesUrl + '/new'
  const login = '/api/github-login?return_to=' + encodeURIComponent(
    '/topic/' + props.owner + '/' + props.repo)
  return <div className={styles.page}>
    {props.snapshot && <TopicPageHead snapshot={props.snapshot}/>}
    {props.snapshot && <TopicConfigEditor
      snapshot={props.snapshot} draft={props.draft ?? props.snapshot.configText ?? ''}
      authenticated={props.authenticated === true}
      pending={props.configPending === true} uncertain={props.configUncertain === true}
      awaitingMerge={props.configAwaitingMerge === true}
      onRecheck={props.onConfigRecheck ?? (()=>{})}
      error={props.configError ?? ''} result={props.configResult ?? null}
      loginUrl={login} onChange={props.onDraftChange ?? (() => {})}
      onSave={props.onConfigSave ?? (() => {})}
      onConfirmUnknown={props.onConfirmConfigUnknown ?? (() => {})}/>}
    <section className={styles.section} aria-labelledby="topic-projects-heading">
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>PUBLIC GITHUB TOPIC</span>
          <h2 id="topic-projects-heading">参与项目</h2></div>
        <span className={styles.count}>{props.projects.length} 个候选项目</span>
      </div>
      <TopicStatus loading={props.loading} error={props.error}
        windowExhausted={props.windowExhausted} count={props.projects.length}
        onRetry={props.onRetry}
        onReport={props.canReport ? props.onOpenReport : undefined}
        reportUrl={props.report.url}
        loginUrl={login}/>
      {props.snapshot?.configState === 'missing' ?
        <div className={styles.empty} role="status">
          topics.config.yaml 尚未初始化。请编辑上方草稿并明确提交；提交前不搜索项目。
        </div> :
        !props.loading && !props.error && props.projects.length === 0 &&
        <div className={styles.empty}>当前可访问搜索范围没有符合配置的已安装项目。</div>}
      {props.projects.length > 0 && <div className={styles.grid}>
        {props.projects.map(project => <TopicProjectCard
          key={project.id || project.full_name.toLowerCase()} project={project}/>)}
      </div>}
      {props.moreError && <p role="alert" className={styles.errorText}>
        加载更多失败：{props.moreError.message}
      </p>}
      {props.canLoadMore && <div className={styles.loadMore} ref={props.sentinelRef}>
        <button type="button" onClick={props.onLoadMore} disabled={props.loadingMore}>
          {props.loadingMore ? '正在加载更多…' :
            props.moreError ? '重试加载更多' : '加载更多项目'}
        </button>
      </div>}
    </section>
    {props.report.open && <TopicReportDialog
      title={props.report.title} body={props.report.body}
      pending={props.report.pending} checking={props.report.checking}
      uncertain={props.report.uncertain} message={props.report.message}
      writeEnabled={props.writeEnabled} githubNewIssueUrl={base}
      githubIssuesUrl={githubIssuesUrl} loginUrl={login}
      onTitleChange={props.onReportTitleChange} onBodyChange={props.onReportBodyChange}
      onCancel={props.onCloseReport} onConfirmUnknown={props.onConfirmUnknown}
      onSubmit={props.onSubmitReport}/>}
  </div>
}
