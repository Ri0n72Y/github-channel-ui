import { useCallback, useEffect, useState } from 'react'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import { repoHomeStatus, type MemberCapability, type RepoHomeApi } from './service'

export type MemberWriteState = 'checking' | 'allowed' | 'anonymous' | 'denied' | 'error'
interface AccessSnapshot {
  readonly key: string
  readonly state: MemberWriteState
  readonly capability: MemberCapability | null
  readonly error: string
}
const CHECKING: AccessSnapshot = { key: '', state: 'checking', capability: null, error: '' }

/** @summary Allow member-management links only after current repository, branch and session capability verify. */
export function useMemberWriteAccess(api: RepoHomeApi, owner: string, repo: string,
  branch: string, refresh = 0) {
  const [sessionRevision, setSessionRevision] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<AccessSnapshot>(CHECKING)
  useEffect(() => subscribeSessionChanged(() => setSessionRevision(value => value + 1)), [])
  const key = JSON.stringify([owner, repo, branch, refresh, sessionRevision, attempt])
  useEffect(() => {
    const abort = new AbortController()
    setSnapshot({ key, state: 'checking', capability: null, error: '' })
    if (!/^[a-z\d-]{1,39}$/i.test(owner) || !/^[a-z\d._-]{1,100}$/i.test(repo) || !branch) {
      setSnapshot({ key, state: 'error', capability: null, error: '无效的仓库或分支' })
      return () => abort.abort()
    }
    void api.getCapability(owner, repo, branch, abort.signal).then(value => {
      if (abort.signal.aborted) return
      if (value.branch !== branch) {
        setSnapshot({ key, state: 'error', capability: null, error: '登记权限与当前分支不匹配' })
        return
      }
      setSnapshot({ key, state: 'allowed', capability: value, error: '' })
    }).catch(error => {
      if (abort.signal.aborted) return
      const status = repoHomeStatus(error)
      setSnapshot({
        key,
        state: status === 401 ? 'anonymous' : status === 403 ? 'denied' : 'error',
        capability: null,
        error: status === 401 ? '' :
          error instanceof Error ? error.message : '登记权限暂无法验证',
      })
    })
    return () => abort.abort()
  }, [api, owner, repo, branch, key])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const current = snapshot.key === key ? snapshot : CHECKING
  return { state: current.state, capability: current.capability,
    error: current.error, retry } as const
}
