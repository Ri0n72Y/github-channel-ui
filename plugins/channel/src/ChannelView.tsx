import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import type { ChannelSnapshot } from './service'
import styles from './ChannelView.module.css'
import { LocalTime } from '../../shared/src/Presentation'

type Props = {
  owner: string
  repo: string
  loading: boolean
  snapshot: ChannelSnapshot | null
  error: string
  accessBlocked?: boolean
  onRetry(): void
}
const stateText: Record<string, string> = {
  config_missing: '频道尚未配置，请联系项目管理者。',
  invalid_config: '频道配置无效，请联系项目管理者修正。',
  sync_branch_missing: '频道来源分支不存在，请联系项目管理者。',
  no_channels: '项目还没有配置频道，请联系项目管理者。',
  snapshot_incomplete: '讨论读取不完整，暂时无法确定当前频道，请重试。',
}
function issueUrl(owner: string, repo: string, number: number) {
  return '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '/issues/' + number
}

/** @summary Display one repository's Channel selection with existing Issue detail navigation. */
export default function ChannelView({ owner, repo, loading, snapshot, error, accessBlocked=false, onRetry }: Props) {
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  return <section className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="频道导航">
      <Link to={base}>项目主页</Link><span aria-hidden="true">/</span><span>频道</span>
    </nav>
    <header className={styles.header}>
      <div className={styles.identity}>
        <p className={styles.eyebrow}>{owner}/{repo}</p>
        <h1>项目频道</h1>
        <p>选择一个频道，加入当前讨论。</p>
      </div>
      {!accessBlocked && !error && <div className={styles.actions}>
        <button type="button" disabled={loading} onClick={onRetry} aria-label="刷新频道" title="刷新频道"><span aria-hidden="true">↻</span></button>
      </div>}
    </header>
    {loading && <p role="status">正在加载频道…</p>}
    {error && !accessBlocked && <div className={styles.error} role="alert">读取失败：{error} <button type="button" onClick={onRetry}>重试读取</button></div>}
    {!loading && snapshot && snapshot.state !== 'ready' &&
      <section className={styles.notice} role="status">
        <h2>频道暂不可用</h2>
        <p>{stateText[snapshot.state] || snapshot.state}</p>
        {snapshot.error && <p>{snapshot.error}</p>}
        {snapshot.state === 'config_missing' && <details><summary>项目管理者操作</summary><Link to={base + '/config'}>查看配置初始化</Link></details>}
      </section>}
    {!loading && snapshot?.state === 'ready' && <>
      <ul className={styles.grid}>
        {snapshot.channels.map(channel => <li className={styles.card} key={channel.label}>
          <div className={styles.cardIdentity}>
            <span className={styles.channelMark} aria-hidden="true">#</span>
            <div><h2>{channel.name}</h2></div>
          </div>
          {channel.issue ? <>
            <div className={styles.issueSummary}>
              <p className={styles.status}>当前讨论</p>
              <h3>{channel.issue.title}</h3>
              <p className={styles.meta}>作者：{channel.issue.author || '未知'} ·
                创建时间：<LocalTime value={channel.issue.createdAt}/> · 评论：{channel.issue.comments}</p>
            </div>
            <Link className={styles.enter} to={issueUrl(owner, repo, channel.issue.number)}>
              进入讨论
            </Link>
          </> : <p className={styles.empty}>暂无进行中的讨论。</p>}
        </li>)}
      </ul>
    </>}
    {snapshot && <details className={styles.footnote}>
      <summary>频道规则与读取详情</summary>
      <p>频道根据 main 的 channel:* 配置选择最新创建的有效 Open Issue，不用已关闭 Issue 或 PR 替代。劳动历史仅汇总该 Issue 中的有效结构化评论；普通 Issue 可独立访问。</p>
      {snapshot.headSha && <p>配置版本：<code title={snapshot.headSha}>{snapshot.headSha.slice(0,12)}</code></p>}
      {snapshot.scannedIssues !== undefined && <p>已完整检查的 Open Issue 对象：{snapshot.scannedIssues}</p>}
      {snapshot.channels.map(channel=><p key={channel.label}>{channel.name}：<code>{channel.label}</code></p>)}
    </details>}
  </section>
}
