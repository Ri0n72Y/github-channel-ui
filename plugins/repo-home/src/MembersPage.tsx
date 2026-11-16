import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { readDisplayBranch, type RepoHomeApi, type RepoHomeData } from './service'
import { MemberManagementLink, MemberProfile, TeamStatus } from './Team'
import styles from './RepoHome.module.css'
import { useMemberWriteAccess } from './useMemberWriteAccess'
/** @summary Read the selected branch team file and display cards in its exact stored order. */
export default function MembersPage({ api }: { api: RepoHomeApi }) {
  const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<RepoHomeData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const branch = readDisplayBranch(owner, repo)
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const memberWrite = useMemberWriteAccess(api, owner, repo, branch, revision)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setData(null)
    void api.getHome(owner, repo, branch, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result)
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, owner, repo, branch, revision])
  return <section className={styles.page}>
    <p><Link to={base}>项目主页</Link> / 团队成员</p>
    <div className={styles.sectionHead}><h1>团队成员 {data?.team.state === 'ready' || data?.team.state === 'empty'
      ? '(' + data.team.members.length + ')' : ''}</h1>
      <MemberManagementLink base={base} state={memberWrite.state} />
    </div>
    {memberWrite.capability &&
      <p className={styles.muted}>已验证操作者 @{memberWrite.capability.user.login}，目标分支 {branch}</p>}
    {memberWrite.state === 'denied' &&
      <p className={styles.muted}>当前账号没有成员登记权限。</p>}
    {memberWrite.state === 'error' && <p role="status" className={styles.muted}>
      登记权限暂无法验证：{memberWrite.error}
      <button type="button" onClick={memberWrite.retry}>重试检查</button>
    </p>}
    {loading && <p role="status">正在读取成员文件…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision(n => n + 1)}>重试</button></p>}
    {data && <TeamStatus team={data.team} base={base} branch={branch} onRetry={() => setRevision(n => n + 1)} />}
    {data?.team.state === 'ready' && <div className={styles.memberGrid}>
      {data.team.members.map(member => <article className={styles.memberCard} key={member.id}>
        <MemberProfile member={member} />
      </article>)}
    </div>}
  </section>
}
