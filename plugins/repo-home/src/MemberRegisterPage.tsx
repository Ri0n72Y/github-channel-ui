import { loginHref } from '../../github-access/src/access'
import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { safeHttps, validLogin, validateMemberInput } from './domain.mjs'
import { memberWriteBranch, repoHomeStatus, type MemberCapability, type MemberSubmitResult,
  type RepoHomeApi } from './service'
import styles from './RepoHome.module.css'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import { uncertainWriteResult } from '../../shared/src/browser-http'
type Fields = { name: string; githubUsername: string; role: string; bio: string; avatarUrl: string;
  links: Array<{ label: string; url: string }> }
const initial = (): Fields => ({ name: '', githubUsername: '', role: '', bio: '', avatarUrl: '',
  links: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }] })
type FieldKey = keyof Omit<Fields, 'links'> | `links.${number}.label` | `links.${number}.url`
type FieldErrors = Partial<Record<FieldKey, string>>

/** Trust only the current repository's GitHub PR/Commit link before presenting the primary CTA. */
export function trustedMemberResultUrl(
  result: MemberSubmitResult, owner: string, repo: string,
): string | null {
  try {
    const url = new URL(result.url)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
        url.username || url.password || url.search || url.hash || url.port) return null
    const parts = url.pathname.split('/')
    if (parts.length !== 5 || parts[0] !== '' ||
        parts[1].toLowerCase() !== owner.toLowerCase() ||
        parts[2].toLowerCase() !== repo.toLowerCase()) return null
    if (result.status === 'pending_pr') {
      if (parts[3] !== 'pull' || !/^[1-9]\d*$/.test(parts[4])) return null
    } else if (parts[3] !== 'commit' || !/^[a-f\d]{40}$/i.test(parts[4])) return null
    return url.toString()
  } catch { return null }
}



/** @summary Map existing domain field constraints to actionable form errors without weakening API validation. */
export function validateVisibleFields(fields: Fields): FieldErrors {
  const errors: FieldErrors = {}
  const name = fields.name.trim()
  if (!name || name.length > 60) errors.name = '请输入 1–60 字符的姓名。'
  if (fields.githubUsername.trim() && !validLogin(fields.githubUsername.trim())) {
    errors.githubUsername = 'GitHub 用户名不符合 1–39 字符格式。'
  }
  if (fields.role.trim().length > 40) errors.role = '项目角色不能超过 40 字符。'
  if (fields.bio.trim().length > 280) errors.bio = '个人介绍不能超过 280 字符。'
  if (fields.avatarUrl.trim() && !safeHttps(fields.avatarUrl.trim())) {
    errors.avatarUrl = '头像需要有效的 HTTPS URL。'
  }
  for (const [index, link] of fields.links.entries()) {
    const label = link.label.trim(), url = link.url.trim()
    if (!label && !url) continue
    if (!label || label.length > 24) {
      errors[`links.${index}.label`] = '链接名称需填写 1–24 字符。'
    }
    if (!safeHttps(url)) errors[`links.${index}.url`] = '请输入有效的 HTTPS URL。'
  }
  return errors
}
/** @summary Preserve a member draft while verifying the OAuth operator and Bot delivery mode. */
export default function MemberRegisterPage({ api }: { api: RepoHomeApi }) {
  const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const branch = memberWriteBranch
  const login = loginHref(base + '/members/register')
  const [fields, setFields] = useState<Fields>(initial)
  const [capability, setCapability] = useState<MemberCapability | null>(null)
  const [authStatus, setAuthStatus] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  // After the first submit, diagnostics follow current field values.
  const fieldErrors: FieldErrors = submitAttempted ? validateVisibleFields(fields) : {}
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<MemberSubmitResult | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const [writeOutcomeUnknown, setWriteOutcomeUnknown] = useState(false)
  const [revision, setRevision] = useState(0)
  const {reason:accessReason,report}=useRepoAccess(owner+'/'+repo+'/'+revision)
  const pendingController = useRef<AbortController | null>(null)
  useEffect(() => { if (result) resultHeading.current?.focus() }, [result])
  useEffect(() => subscribeSessionChanged(() => {
    const write = pendingController.current
    if (write) {
      pendingController.current = null
      write.abort()
      setPending(false)
      setWriteOutcomeUnknown(true)
    }
    setCapability(null)
    setRevision(n => n + 1)
  }), [])
  useEffect(() => () => {
    pendingController.current?.abort()
    pendingController.current = null
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setCapability(null); setAuthStatus(null)
    void api.getCapability(owner, repo, branch, controller.signal).then(value => {
      if (!controller.signal.aborted) {
        if (value.branch !== branch) {
          setAuthStatus(403)
          setError('服务器返回的成员写入分支与授权目标不一致，已拒绝提交。')
        } else setCapability(value)
      }
    }).catch(e => {
      if (controller.signal.aborted) return
      setAuthStatus(repoHomeStatus(e))
      if(!report(e))setError(e instanceof Error ? e.message : '权限验证失败')
    })
    return () => controller.abort()
  }, [api, owner, repo, branch, revision, report])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!capability || pending || result?.status === 'pending_pr' || writeOutcomeUnknown || pendingController.current) return
    setSubmitAttempted(true)
    const first = Object.keys(validateVisibleFields(fields))[0] as FieldKey | undefined
    if (first) {
      setError('')
      const field = fieldRefs.current[first]
      field?.closest('details')?.setAttribute('open','')
      field?.focus()
      return
    }
    setSubmitAttempted(false)
    let member
    try { member = validateMemberInput(fields) }
    catch (e) { setError(e instanceof Error ? e.message : '资料无效'); return }
    const controller = new AbortController()
    pendingController.current = controller
    setPending(true); setError(''); setResult(null)
    try {
      const saved = await api.register(owner, repo, branch, member, controller.signal)
      if (pendingController.current === controller && !controller.signal.aborted) setResult(saved)
    } catch (e) {
      if (pendingController.current === controller && !controller.signal.aborted) {
        setError(e instanceof Error ? e.message : '提交失败，请先核查 GitHub 状态')
        if (uncertainWriteResult(e)) setWriteOutcomeUnknown(true)
        if (repoHomeStatus(e) === 401) { setAuthStatus(401); setCapability(null) }
      }
    } finally {
      if (pendingController.current === controller) {
        pendingController.current = null
        setPending(false)
      }
    }
  }
  function unlockUnknownWrite() {
    if (pending || !writeOutcomeUnknown || !window.confirm(
      '请确认已在 GitHub 检查成员文件和可能存在的维护 PR，并确认可以安全发起新的提交。解除锁定后将重新检查写入权限，继续吗？'
    )) return
    setWriteOutcomeUnknown(false)
    setCapability(null)
    setError('')
    setRevision(n => n + 1)
  }
  function change(key: keyof Omit<Fields, 'links'>, value: string) {
    setFields(previous => ({ ...previous, [key]: value }))
  }
  function changeLink(index: number, key: 'label' | 'url', value: string) {
    setFields(previous => ({ ...previous, links: previous.links.map((entry, i) =>
      i === index ? { ...entry, [key]: value } : entry) }))
  }
  const resultUrl = result ? trustedMemberResultUrl(result, owner, repo) : null
  return <section className={[styles.page, styles.registerPage].join(' ')}>
    <nav className={styles.registerBreadcrumb} aria-label="成员登记导航">
      <Link to={base}>项目</Link><span aria-hidden="true">/</span>
      <Link to={base + '/members'}>团队成员</Link><span aria-hidden="true">/</span><span>添加成员</span>
    </nav>
    <header className={styles.registerHeader}>
      <h1>添加团队成员</h1>
      <p>将成员添加到 <strong>{owner}/{repo}</strong>。</p>
      <details className={styles.secondaryDetails}><summary>写入详情</summary><p>成员登记写入固定分支 <strong>{branch}</strong>（不受本机展示偏好影响）。</p></details>
    </header>
    {result && <section className={styles.submitResult} role="status" aria-live="polite">
      <h2 ref={resultHeading} tabIndex={-1}>
        {result.status === 'pending_pr' ? '等待管理员审核' : '成员资料已提交'}
      </h2>
      <p>{result.status === 'pending_pr'
        ? '管理员在 GitHub 审核并合并后，新成员才会出现在团队列表中。'
        : 'GitHub Commit 已提交，返回团队成员页面后可重新加载查看。'}</p>
      <div className={styles.resultActions}>
        {resultUrl ? <a className={styles.resultPrimary} href={resultUrl}
          target="_blank" rel="noopener noreferrer">
          {result.status === 'pending_pr' ? '查看 GitHub 审核记录（新标签）' : '查看 GitHub Commit（新标签）'}
        </a> : <p role="alert">提交已返回结果，但 GitHub 来源链接未通过校验。请自行核查仓库中的记录，勿重复提交。</p>}
        <Link to={base + '/members'}>查看成员列表</Link>
      </div>
    </section>}
    {authStatus === null && !capability && <p role="status">正在验证操作者和仓库写权限…</p>}
    {accessReason&&<RepoAccessNotice owner={owner} repo={repo} reason={accessReason} onRetry={()=>setRevision(n=>n+1)}/>}
    {error && !accessReason && <p role="alert">{error}</p>}
    {writeOutcomeUnknown && <div role="alert">
      <p>提交结果未知，GitHub 可能已经接收请求。请先核查成员文件和维护 PR，禁止直接重复提交。</p>
      <button type="button" onClick={unlockUnknownWrite} disabled={pending}>
        我已核查 GitHub，解除提交锁定并重验权限
      </button>
    </div>}
    {submitAttempted && Object.keys(fieldErrors).length > 0 &&
      <p role="alert">请修正标记的字段后重新提交。</p>}
    {authStatus === 401 && <a href={login}>登录 GitHub 后返回此表单</a>}
    {authStatus !== null && authStatus !== 401 && !accessReason && <button type="button"
      onClick={() => setRevision(n => n + 1)}>重新检查权限</button>}
    {capability && <><p className={styles.registerOperator}>GitHub 操作者：<strong>@{capability.user.login}</strong>。由 LabourChain Bot
      {capability.mode === 'pr' ? ' 创建维护 PR，待审核合并后生效。' : ' 提交 Commit。'}</p>
      <form className={styles.memberForm} onSubmit={submit} noValidate>
        <section className={styles.registerGroup} aria-labelledby="member-identity-heading">
          <h2 id="member-identity-heading"><span aria-hidden="true">01</span> 成员身份</h2>
          <label>姓名（必填）<input required value={fields.name} maxLength={60}
            ref={node => { fieldRefs.current.name = node }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'member-error-name' : undefined}
            onChange={e => change('name', e.target.value)} />
            {fieldErrors.name && <small id="member-error-name" className={styles.fieldError}>{fieldErrors.name}</small>}
          </label>
          <label>GitHub 用户名（选填）<input value={fields.githubUsername} maxLength={39}
            ref={node => { fieldRefs.current.githubUsername = node }}
            aria-invalid={Boolean(fieldErrors.githubUsername)}
            aria-describedby={fieldErrors.githubUsername ? 'member-error-github' : undefined}
            onChange={e => change('githubUsername', e.target.value)} />
            {fieldErrors.githubUsername && <small id="member-error-github" className={styles.fieldError}>{fieldErrors.githubUsername}</small>}
          </label>
          <label>项目角色（选填）<input value={fields.role} maxLength={40}
            ref={node => { fieldRefs.current.role = node }}
            aria-invalid={Boolean(fieldErrors.role)}
            aria-describedby={fieldErrors.role ? 'member-error-role' : undefined}
            onChange={e => change('role', e.target.value)} />
            {fieldErrors.role && <small id="member-error-role" className={styles.fieldError}>{fieldErrors.role}</small>}
          </label>
        </section>
        <section className={styles.registerGroup} aria-labelledby="member-public-heading">
          <h2 id="member-public-heading"><span aria-hidden="true">02</span> 公开资料</h2>
          <label>个人介绍（纯文本，选填）<textarea value={fields.bio} maxLength={280}
            ref={node => { fieldRefs.current.bio = node }}
            aria-invalid={Boolean(fieldErrors.bio)}
            aria-describedby={fieldErrors.bio ? 'member-error-bio' : undefined}
            onChange={e => change('bio', e.target.value)} rows={4} />
            {fieldErrors.bio && <small id="member-error-bio" className={styles.fieldError}>{fieldErrors.bio}</small>}
          </label>
        </section>
        <details className={styles.secondaryDetails}><summary>头像与个人链接（选填）</summary>
          <label>头像链接（HTTPS，选填）<input type="url" value={fields.avatarUrl}
            ref={node => { fieldRefs.current.avatarUrl = node }}
            aria-invalid={Boolean(fieldErrors.avatarUrl)}
            aria-describedby={fieldErrors.avatarUrl ? 'member-error-avatar' : undefined}
            onChange={e => change('avatarUrl', e.target.value)} />
            {fieldErrors.avatarUrl && <small id="member-error-avatar" className={styles.fieldError}>{fieldErrors.avatarUrl}</small>}
          </label>
        <fieldset className={styles.registerLinks}><legend><span aria-hidden="true">03</span> 个人链接（最多三条，选填）</legend>
          {fields.links.map((link, index) => {
            const labelKey = `links.${index}.label` as const
            const urlKey = `links.${index}.url` as const
            return <div className={styles.linkFields} key={index}>
              <label>链接 {index + 1} 名称<input value={link.label} maxLength={24}
                ref={node => { fieldRefs.current[labelKey] = node }}
                aria-invalid={Boolean(fieldErrors[labelKey])}
                aria-describedby={fieldErrors[labelKey] ? `member-error-link-${index}-label` : undefined}
                onChange={e => changeLink(index, 'label', e.target.value)} />
                {fieldErrors[labelKey] && <small className={styles.fieldError} id={`member-error-link-${index}-label`}>
                  {fieldErrors[labelKey]}</small>}
              </label>
              <label>HTTPS URL<input type="url" value={link.url}
                ref={node => { fieldRefs.current[urlKey] = node }}
                aria-invalid={Boolean(fieldErrors[urlKey])}
                aria-describedby={fieldErrors[urlKey] ? `member-error-link-${index}-url` : undefined}
                onChange={e => changeLink(index, 'url', e.target.value)} />
                {fieldErrors[urlKey] && <small className={styles.fieldError} id={`member-error-link-${index}-url`}>
                  {fieldErrors[urlKey]}</small>}
              </label>
            </div>
          })}
        </fieldset>
        </details>
        <div className={[styles.actions, styles.registerActions].join(' ')}><button type="submit" disabled={pending || writeOutcomeUnknown || result?.status === 'pending_pr'}>
          {pending ? '正在提交…' : '提交成员资料'}</button><Link to={base + '/members'}>取消</Link></div>
      </form></>}

  </section>
}
