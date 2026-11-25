import { loginHref } from '../../github-access/src/access'
import RepoAccessNotice from '../../github-access/src/RepoAccessNotice'
import { useRepoAccess } from '../../github-access/src/useRepoAccess'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { parseConfigNamespaces } from './domain.mjs'
import type { ConfigActionResult, ConfigSnapshot, RepoConfigApi } from './service'
import { configState } from './service'
import ConfigView from './ConfigView'
import { subscribeSessionChanged } from '../../shared/src/session-change'
import { uncertainWriteResult } from '../../shared/src/browser-http'

/** @summary Own Config requests, validation, confirmations and state transitions; the View only renders props. */
export default function ConfigPage({ api, owner, repo }: {
  api: RepoConfigApi
  owner: string
  repo: string
}) {
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const login = loginHref(base + '/config')
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConfigActionResult | null>(null)
  const [confirmRemovals, setConfirmRemovals] = useState(false)
  const [revision, setRevision] = useState(0)
  const {reason:accessReason,report}=useRepoAccess(owner+'/'+repo+'/'+revision)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  const edited = useRef(false)
  const draftBase = useRef<{ head: string | null; file: string | null } | null>(null)
  const discardOnRefresh = useRef(false)
  const [draftStale, setDraftStale] = useState(false)
  const [writeOutcomeUnknown, setWriteOutcomeUnknown] = useState(false)
  useEffect(() => subscribeSessionChanged(() => {
    if (writeController.current) {
      writeController.current.abort()
      writeController.current = null
      setBusy(false)
      setWriteOutcomeUnknown(true)
    }
    setSnapshot(null)
    setRevision(n => n + 1)
  }), [])
  const pendingPr = useRef<{ url: string; content: string } | null>(null)

  useEffect(() => () => {
    readController.current?.abort()
    writeController.current?.abort()
    readController.current = null
    writeController.current = null
  }, [])

  const load = useCallback(async (signal: AbortSignal, discardDraft: boolean) => {
    setSnapshot(null)
    setLoading(true)
    try {
      let next = await api.get(owner, repo, signal)
      if (signal.aborted) return
      if (discardDraft) {
        edited.current = false
        draftBase.current = null
      }
      const pending = pendingPr.current
      if (pending) {
        if (next.configText != null && next.configText.replace(/\r\n/g, '\n') ===
            pending.content.replace(/\r\n/g, '\n')) {
          pendingPr.current = null
          edited.current = false
          draftBase.current = null
        } else {
          next = { ...next, state: 'awaiting_pr_merge', prUrl: pending.url }
        }
      }
      setSnapshot(next)
      if (edited.current) {
        if (draftBase.current && (draftBase.current.head !== (next.headSha ?? null) ||
            draftBase.current.file !== (next.fileSha ?? null))) setDraftStale(true)
      } else {
        setContent(pendingPr.current?.content ??
          next.configText ?? next.config?.defaultPreview ?? '')
        setDraftStale(false)
        setConfirmRemovals(false)
      }
    } catch (e) {
      if (signal.aborted) return
      if(!report(e))setError(e instanceof Error ? e.message : 'Config 读取失败')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [api, owner, repo, report])

  useEffect(() => {
    const controller = new AbortController()
    readController.current = controller
    const discardDraft = discardOnRefresh.current
    discardOnRefresh.current = false
    void load(controller.signal, discardDraft)
    return () => {
      controller.abort()
      if (readController.current === controller) readController.current = null
    }
  }, [load, revision])

  const validation = useMemo(() => parseConfigNamespaces(content), [content])
  const capability = snapshot?.capability
  const plan = snapshot?.plan || null
  const editorEnabled = snapshot?.state === 'config_missing' ||
    snapshot?.state === 'ready' || snapshot?.state === 'sync_pending'
  const dirty = snapshot?.state === 'config_missing' ||
    (snapshot?.configText != null &&
      content.replace(/\r\n/g, '\n') !== snapshot.configText.replace(/\r\n/g, '\n'))
  const canSave = Boolean(!loading && !busy && !draftStale && !writeOutcomeUnknown && editorEnabled && dirty && snapshot?.headSha &&
    validation.state === 'ready' && capability?.canSaveConfig)
  const canSync = Boolean(!loading && !busy && !draftStale && !writeOutcomeUnknown && snapshot?.state === 'sync_pending' && snapshot.snapshotId &&
    plan?.hasChanges &&
    (!plan.createLabels.length || capability?.canCreateLabels) &&
    (!plan.removeIssueLabels.length || capability?.canRemoveLabels) &&
    (!plan.requiresConfirmation || confirmRemovals))

  function refresh() {
    if (busy || loading) return
    if (edited.current && !window.confirm('重新读取成功后将放弃本地草稿；读取失败则保留草稿。继续吗？')) return
    discardOnRefresh.current = edited.current
    setSnapshot(null)
    setDraftStale(false)
    setError('')
    setResult(null)
    setRevision(value => value + 1)
  }

  function unlockUnknownWrite() {
    if (busy || loading || !writeOutcomeUnknown || !window.confirm(
      '请确认已在 GitHub 检查 Config、Labels 和可能的维护 PR，确定可以安全重新操作。解除锁定后将重新读取权限与快照，继续吗？'
    )) return
    setWriteOutcomeUnknown(false)
    setSnapshot(null)
    setConfirmRemovals(false)
    setError('')
    setRevision(value => value + 1)
  }

  function changeContent(value: string) {
    if (!edited.current) {
      draftBase.current = { head: snapshot?.headSha ?? null, file: snapshot?.fileSha ?? null }
    }
    edited.current = true
    setContent(value)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot?.headSha || !canSave || busy || loading || draftStale || writeOutcomeUnknown || writeController.current) return
    if (validation.state !== 'ready') {
      setError('当前 v1 仅支持已校验的 namespaces 列表；未知字段不会被覆盖。')
      return
    }
    const controller = new AbortController()
    writeController.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const saved = await api.save(owner, repo, content, snapshot.headSha,
        snapshot.fileSha ?? null, controller.signal)
      if (controller.signal.aborted || writeController.current !== controller) return
      setResult(saved)
      if (saved.state === 'partial_failure') setWriteOutcomeUnknown(true)
      if (saved.state === 'awaiting_pr_merge' && saved.prUrl) {
        pendingPr.current = { url: saved.prUrl, content }
        edited.current = false
        draftBase.current = null
        setDraftStale(false)
        setSnapshot(current => current ? {
          ...current, state: 'awaiting_pr_merge', prUrl: saved.prUrl,
        } : current)
      } else if (saved.state === 'sync_pending' || saved.state === 'ready') {
        pendingPr.current = null
        edited.current = false
        draftBase.current = null
        setRevision(value => value + 1)
      }
    } catch (e) {
      if (!controller.signal.aborted && writeController.current === controller) {
        setError(e instanceof Error ? e.message : 'Config 提交失败')
        if (uncertainWriteResult(e)) setWriteOutcomeUnknown(true)
        if (configState(e) === 'stale_preview') {
          setRevision(value => value + 1)
        }
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null
        setBusy(false)
      }
    }
  }

  async function sync() {
    if (!snapshot?.snapshotId || !canSync || busy || loading || draftStale || writeOutcomeUnknown || writeController.current) return
    const controller = new AbortController()
    writeController.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const synced = await api.sync(owner, repo, snapshot.snapshotId,
        confirmRemovals, controller.signal)
      if (controller.signal.aborted || writeController.current !== controller) return
      setResult(synced)
      if (synced.state === 'partial_failure') setWriteOutcomeUnknown(true)
      setRevision(value => value + 1)
    } catch (e) {
      if (!controller.signal.aborted && writeController.current === controller) {
        setError(e instanceof Error ? e.message : 'Label 同步失败')
        if (uncertainWriteResult(e)) setWriteOutcomeUnknown(true)
        if (configState(e) === 'stale_preview') {
          setRevision(value => value + 1)
        }
      }
    } finally {
      if (writeController.current === controller) {
        writeController.current = null
        setBusy(false)
      }
    }
  }

  return <>{accessReason&&<RepoAccessNotice owner={owner} repo={repo} reason={accessReason} onRetry={()=>{if(!busy){setError('');setRevision(n=>n+1)}}}/>}
    <ConfigView
    owner={owner}
    repo={repo}
    base={base}
    login={login}
    snapshot={snapshot}
    content={content}
    loading={loading}
    busy={busy}
    error={error}
    result={result}
    confirmRemovals={confirmRemovals}
    validationState={validation.state}
    editorEnabled={editorEnabled}
    canSave={canSave}
    canSync={canSync}
    dirty={Boolean(dirty)}
    draftStale={draftStale}
    retainedDraft={!snapshot && Boolean(content)}
    writeOutcomeUnknown={writeOutcomeUnknown}
    onRefresh={refresh}
    onUnlockUnknownWrite={unlockUnknownWrite}
    onContentChange={changeContent}
    onConfirmRemovalsChange={setConfirmRemovals}
    onSave={save}
    onSync={() => void sync()}
  /></>
}
