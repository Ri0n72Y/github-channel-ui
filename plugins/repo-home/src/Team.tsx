import { RepositoryLink as Link } from '../../repo-issues/src/RepositoryLink'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { safeHttps, type Member } from './domain.mjs'
import type { Team } from './service'
import type { MemberWriteState } from './useMemberWriteAccess'
import styles from './RepoHome.module.css'

/** @summary Use a validated avatar URL or GitHub avatar with an initial-letter fallback. */
export function MemberAvatar({ member, size = 'small' }: { member: Member; size?: 'small' | 'large' }) {
  const [failed, setFailed] = useState(false)
  const url = member.avatarUrl && safeHttps(member.avatarUrl) ? member.avatarUrl :
    member.githubUsername ? 'https://github.com/' + encodeURIComponent(member.githubUsername) + '.png' : ''
  return <span className={size === 'small' ? styles.avatar : styles.avatarLarge}>
    {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} loading="lazy" /> :
      <span aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span>}
  </span>
}
export function TeamStatus({ team, base, branch = 'main', onRetry }: {
  team: Team; base: string; branch?: string; onRetry?: () => void
}) {
  if (team.state === 'ready') return null
  if (team.state === 'missing') return <p>尚未添加团队成员。</p>
  if (team.state === 'empty') return <p>暂无成员。</p>
  return <p role="alert">{team.state === 'invalid' ? '成员文件格式错误：' : '成员文件读取失败：'}{team.error}
    {team.state === 'invalid' && <a href={'https://github.com/' + base.slice(1) + '/blob/' +
      encodeURIComponent(branch) + '/team-member.json'} target="_blank" rel="noopener noreferrer">查看 GitHub 成员文件</a>}
    {onRetry && <button type="button" onClick={onRetry}>重试</button>}</p>
}
/** @summary Keep the management route invisible until its scoped write capability succeeds. */
export function MemberManagementLink({ base, state }: {
  readonly base: string; readonly state: MemberWriteState
}) {
  return state === 'allowed' ? <Link to={base + '/members/register'}>添加成员</Link> : null
}
/** @summary Preserve the default compact profile; only the Members directory uses the full-width card. */
export function MemberProfile({ member, variant = 'popover' }: {
  member: Member; variant?: 'popover' | 'card'
}) {
  const avatar = <MemberAvatar member={member} size="large" />
  const role = member.role && <p>{member.role}</p>
  const bio = member.bio && <p className={styles.bio}>{member.bio}</p>
  const links = <>
    {member.githubUsername && <a href={'https://github.com/' + encodeURIComponent(member.githubUsername)}
      target="_blank" rel="noopener noreferrer">GitHub @{member.githubUsername}</a>}
    {member.links?.map((item, i) => <a key={i} href={item.url}
      target="_blank" rel="noopener noreferrer">{item.label}</a>)}
  </>
  if (variant === 'card') return <div className={styles.fullProfile}>
    <div className={styles.fullProfileIdentity}>
      {avatar}
      <div className={styles.fullProfileName}><h2>{member.name}</h2>{role}</div>
    </div>
    {bio}
    {(member.githubUsername || Boolean(member.links?.length)) && <div className={styles.fullProfileLinks}>{links}</div>}
  </div>
  return <div className={styles.profile}>
    {avatar}
    <div className={styles.profileText}><strong>{member.name}</strong>
      {role}
      {bio}
      {links}
    </div>
  </div>
}
/** @summary Keep each member's identity visible and position the popover by its measured height. */
export function TeamStrip({ members, base }: { members: readonly Member[]; base: string }) {
  const [active, setActive] = useState<number | null>(null)
  const [position, setPosition] = useState({ left: 12, top: 64, maxHeight: 360 })
  const root = useRef<HTMLDivElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const anchors = useRef<Map<number, HTMLButtonElement>>(new Map())
  const pointer = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  const open = (i: number) => { cancel(); setActive(i) }
  const delayOpen = (i: number) => {
    cancel(); timer.current = setTimeout(() => open(i), 120)
  }
  const delayClose = () => { cancel(); timer.current = setTimeout(() => setActive(null), 180) }

  useLayoutEffect(() => {
    if (active === null) return
    const button = anchors.current.get(active), panel = popover.current
    if (!button || !panel) return
    const measure = () => {
      const rect = button.getBoundingClientRect()
      const width = Math.min(300, window.innerWidth - 24)
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
      const below = Math.max(0, window.innerHeight - rect.bottom - 20)
      const above = Math.max(0, rect.top - 20)
      const naturalHeight = Math.min(panel.scrollHeight, 360)
      const placeAbove = below < naturalHeight && above > below
      const available = placeAbove ? above : below
      const maxHeight = Math.min(360, Math.max(48, available))
      const height = Math.min(panel.scrollHeight, maxHeight)
      const desiredTop = placeAbove ? rect.top - height - 8 : rect.bottom + 8
      const top = Math.max(12, Math.min(desiredTop, window.innerHeight - height - 12))
      setPosition(previous => previous.left === left && previous.top === top &&
        previous.maxHeight === maxHeight ? previous : { left, top, maxHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [active, members])

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setActive(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActive(null); cancel() }
      if (event.key === 'Tab') pointer.current = false
    }
    const onViewportChange = () => { cancel(); setActive(null) }
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popover.current?.contains(event.target)) return
      onViewportChange()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onScroll, true)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      cancel()
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return <div className={styles.strip} ref={root} aria-label="团队成员"
    onScroll={() => { cancel(); setActive(null) }}>
    {members.map((member, index) => <div key={member.id} className={styles.avatarItem}
      onPointerEnter={e => { if (e.pointerType !== 'touch') delayOpen(index) }}
      onPointerLeave={delayClose}
      onFocus={e => { cancel(); if (!pointer.current && e.target instanceof HTMLButtonElement) open(index) }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) delayClose() }}>
      <button ref={node => { if (node) anchors.current.set(index, node); else anchors.current.delete(index) }}
        type="button" className={styles.avatarButton}
        aria-label={member.role ? member.name + ' · ' + member.role : member.name}
        aria-expanded={active === index} aria-controls={'team-popover-' + index}
        onPointerDown={() => { pointer.current = true }}
        onClick={() => { cancel(); if (active === index) setActive(null); else open(index) }}>
        <MemberAvatar member={member} />
        <span className={styles.memberIdentity}>
          <strong>{member.name}</strong>
          {member.role && <small>{member.role}</small>}
        </span>
      </button>
      {active === index && <div ref={popover} id={'team-popover-' + index}
        className={styles.popover}
        style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
        onPointerEnter={cancel} onPointerLeave={delayClose}>
        <MemberProfile member={member} />
      </div>}
    </div>)}
  </div>
}
