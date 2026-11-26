import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { memberWriteBranch, readDisplayBranch, type RepoHomeApi, type RepoHomeData } from './service'
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
  const {reason:accessReason,report}=useRepoAccess(owner+'/'+repo+'/'+branch+'/'+revision)
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const memberWrite = useMemberWriteAccess(api, owner, repo, memberWriteBranch, revision, Boolean(data))
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setData(null)
    void api.getHome(owner, repo, branch, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result)
    }).catch(e => { if (!controller.signal.aborted && !report(e)) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, owner, repo, branch, revision, report])
  return <section className={[styles.page, styles.membersPage].join(' ')}>
    <nav className={styles.membersBreadcrumb} aria-label="成员页面导航">
      <Link to={base}>项目主页</Link><span aria-hidden="true"> / </span><span>团队成员</span>
    </nav>
    <header className={styles.membersHeader}>
      <div className={styles.membersHeading}>
        <h1>团队成员 {data?.team.state === 'ready' || data?.team.state === 'empty'
          ? '(' + data.team.members.length + ')' : ''}</h1>
        <p className={styles.muted}>展示分支 <code>{branch}</code></p>
      </div>
      {!accessReason&&<MemberManagementLink base={base} state={memberWrite.state} />}
    </header>
    {accessReason&&<RepoAccessNotice owner={owner} repo={repo} reason={accessReason} onRetry={()=>setRevision(n=>n+1)}/>}
    {!accessReason&&(memberWrite.capability || memberWrite.state === 'denied' || memberWrite.state === 'error') &&
      <div className={styles.memberPermission}>
        {memberWrite.capability &&
          <p className={styles.muted}>已验证操作者 @{memberWrite.capability.user.login}，写入分支 {memberWriteBranch}</p>}
        {memberWrite.state === 'denied' &&
          <p className={styles.muted}>当前账号没有成员登记权限。</p>}
        {memberWrite.state === 'error' && <p role="status" className={styles.muted}>
          登记权限暂无法验证：{memberWrite.error}
          <button type="button" onClick={memberWrite.retry}>重试检查</button>
        </p>}
      </div>}
    {(loading || error || (data && data.team.state !== 'ready')) && <div className={styles.memberReadStatus}>
      {loading && <p role="status">正在读取成员文件…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setRevision(n => n + 1)}>重试</button></p>}
      {data && <TeamStatus team={data.team} base={base} branch={branch} onRetry={() => setRevision(n => n + 1)} />}
    </div>}
    {data?.team.state === 'ready' && <div className={styles.memberGrid}>
      {data.team.members.map(member => <article className={styles.memberCard} key={member.id}>
        <MemberProfile member={member} variant="card" />
      </article>)}
    </div>}
  </section>
}
