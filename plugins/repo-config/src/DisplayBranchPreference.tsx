import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { displayBranchKey, readDisplayBranch } from '../../repo-home/src/service'
import styles from './ConfigPage.module.css'

/** Personal, device-local reading preference; never changes the repository's GitHub Config. */
export default function DisplayBranchPreference({ owner, repo, base }: {
  owner: string; repo: string; base: string
}) {
  const [branch, setBranch] = useState(() => readDisplayBranch(owner, repo))
  const [draft, setDraft] = useState(branch)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const next = readDisplayBranch(owner, repo)
    setBranch(next)
    setDraft(next)
    setMessage('')
    setError('')
  }, [owner, repo])
  function apply() {
    const value = draft.trim()
    if (!value || value.length > 180 || !/^[a-z\d][a-z\d._/-]*$/i.test(value) ||
        value.includes('..') || value.includes('//') || value.endsWith('/') ||
        value.split('/').some(part => part.endsWith('.lock'))) {
      setError('展示分支名称无效，请输入 GitHub 分支名。')
      setMessage('')
      return
    }
    try {
      localStorage.setItem(displayBranchKey(owner, repo), value)
      setBranch(value)
      setError('')
      setMessage('已保存到当前浏览器。返回项目主页后将用此分支读取项目介绍。')
    } catch {
      setError('当前浏览器无法保存偏好；没有修改 GitHub 仓库。')
      setMessage('')
    }
  }
  return <section className={styles.panel} aria-labelledby="display-branch-heading">
    <h2 id="display-branch-heading">本机展示分支偏好</h2>
    <p>当前浏览器：<strong>{branch}</strong>。仅影响你在项目主页和成员列表阅读的 README、成员文件；
      成员登记始终写入 main，不修改 GitHub 仓库默认分支、全局平台配置或 Label 同步使用的 main。</p>
    <div className={styles.displayPreference}>
      <label htmlFor="display-branch-input">查看的 GitHub 分支</label>
      <input id="display-branch-input" value={draft} maxLength={180}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply() } }} />
      <button type="button" onClick={apply}>保存本机偏好</button>
      <Link to={base}>返回项目主页</Link>
    </div>
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p>仓库级展示分支如需对所有访客生效，必须另行定义服务端配置读写及授权契约；本设置不提供仓库级写入。</p>
  </section>
}
