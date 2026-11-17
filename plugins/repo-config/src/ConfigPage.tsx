import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { parseConfigNamespaces } from './domain.mjs'
import type { ConfigActionResult, ConfigSnapshot, RepoConfigApi } from './service'
import { configState } from './service'
import ConfigView from './ConfigView'
import { subscribeSessionChanged } from '../../shared/src/session-change'

/** @summary Own Config requests, validation, confirmations and state transitions; the View only renders props. */
export default function ConfigPage({ api, owner, repo }: {
  api: RepoConfigApi
  owner: string
  repo: string
}) {
  const base = '/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo)
  const login = '/api/github-login?return_to=' + encodeURIComponent(base + '/config')
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConfigActionResult | null>(null)
  const [confirmRemovals, setConfirmRemovals] = useState(false)
  const [revision, setRevision] = useState(0)
  const readController = useRef<AbortController | null>(null)
  const writeController = useRef<AbortController | null>(null)
  const edited = useRef(false)
  const draftBase = useRef<{ head: string | null; file: string | null } | null>(null)
  const [draftStale, setDraftStale] = useState(false)
  useEffect(() => subscribeSessionChanged(() => {
    if (writeController.current) {
      writeController.current.abort()
      writeController.current = null
      setBusy(false)
      setError('身份变化已中止提交；写入结果可能未知。请先到 GitHub 核查，不要盲目重试。')
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

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    try {
      let next = await api.get(owner, repo, signal)
      if (signal.aborted) return
      const pending = pendingPr.current
      if (pending) {
        if (next.configText != null && next.configText.replace(/\r\n/g, '\n') ===
            pending.content.replace(/\r\n/g, '\n')) {
          pendingPr.current = null
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
      setError(e instanceof Error ? e.message : 'Config 读取失败')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [api, owner, repo])

  useEffect(() => {
    const controller = new AbortController()
    readController.current = controller
    void load(controller.signal)
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
  const canSave = Boolean(!loading && !busy && !draftStale && editorEnabled && dirty && snapshot?.headSha &&
    validation.state === 'ready' && capability?.canSaveConfig)
  const canSync = Boolean(!loading && !busy && !draftStale && snapshot?.state === 'sync_pending' && snapshot.snapshotId &&
    plan?.hasChanges &&
    (!plan.createLabels.length || capability?.canCreateLabels) &&
    (!plan.removeIssueLabels.length || capability?.canRemoveLabels) &&
    (!plan.requiresConfirmation || confirmRemovals))

  function refresh() {
    if (busy || loading) return
    if (edited.current && !window.confirm('放弃未保存的 Config 草稿并重新读取 GitHub？')) return
    edited.current = false
    draftBase.current = null
    setDraftStale(false)
    setError('')
    setResult(null)
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
    if (!snapshot?.headSha || !canSave || busy || loading || draftStale || writeController.current) return
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
      if (saved.state === 'awaiting_pr_merge' && saved.prUrl) {
        pendingPr.current = { url: saved.prUrl, content }
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
    if (!snapshot?.snapshotId || !canSync || busy || loading || draftStale || writeController.current) return
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
      setRevision(value => value + 1)
    } catch (e) {
      if (!controller.signal.aborted && writeController.current === controller) {
        setError(e instanceof Error ? e.message : 'Label 同步失败')
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

  return <ConfigView
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
    onRefresh={refresh}
    onContentChange={changeContent}
    onConfirmRemovalsChange={setConfirmRemovals}
    onSave={save}
    onSync={() => void sync()}
  />
}
