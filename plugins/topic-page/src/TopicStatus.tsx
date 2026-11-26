import type { TopicPageError } from './service'
import styles from './topic-page.module.css'

/** @summary Present retryable Topic failures and honest 1000-result window exhaustion. */
export default function TopicStatus({ loading, error, windowExhausted, count,
  onRetry, onReport, reportUrl, loginUrl }: {
  loading: boolean; error: TopicPageError | null;
  windowExhausted: boolean; count: number; onRetry(): void;
  onReport?: () => void; reportUrl: string; loginUrl?: string;
}) {
  return <>
    {loading && <div className={styles.grid} role="status" aria-label="正在加载项目">
      {[1, 2, 3].map(i => <div className={styles.skeleton} key={i}/>)}
    </div>}
    {error && <section className={styles.error} role="alert">
      <h2>项目读取失败</h2>
      <p>{error.message}</p>
      <p className={styles.note}>可以重试读取；失败或限流期间无法确认项目列表已全部读取。</p>
      <details className={styles.secondaryDetails}><summary>错误诊断</summary>
        <p>{error.status ? 'HTTP ' + error.status + ' · ' : ''}阶段：{error.stage || 'source'}。{error.observedAt && '请求时间：' + error.observedAt + '。'}</p>
      </details>
      <div className={styles.errorActions}>
        <button type="button" onClick={onRetry}>重新加载</button>
        {onReport && <button type="button" onClick={onReport}>编辑问题报告</button>}
        {!onReport && loginUrl && <a href={loginUrl}>登录 GitHub 后报告问题</a>}
      </div>
      {reportUrl && <a href={reportUrl} target="_blank" rel="noopener noreferrer">
        打开已创建 Issue
      </a>}
    </section>}
    {!loading && !error && windowExhausted && <p className={styles.windowWarning} role="status">
      当前已加载 {count} 个有效项目，已达到 GitHub 搜索的 1000 条可访问上限；
      无法确认是否还有更多项目，列表并非全量结果。
    </p>}
  </>
}
