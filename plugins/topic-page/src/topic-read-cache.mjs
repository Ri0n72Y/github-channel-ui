/** Topic public-read cache only. No sessions, credentials, writes or failed values. */
export class TopicReadCacheBusyError extends Error {
  constructor() {
    super('Topic 读取繁忙，请稍后重试')
    this.status = 503
    this.stage = 'source'
  }
}
export function createTopicReadCache({ ttl, limit, now = Date.now }) {
  const entries = new Map()
  let pending = 0
  function invalidate(prefix) {
    for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key)
  }
  function has(key) {
    const entry = entries.get(key)
    return Boolean(entry && (entry.pending || entry.expires > now()))
  }
  function peek(key) {
    const entry = entries.get(key)
    return entry && !entry.pending && entry.expires > now() ? entry.value : undefined
  }
  function get(key, load, refresh = false, onReplace) {
    const old = entries.get(key)
    // An explicit refresh supersedes a normal pending load, but joins a pending
    // refresh. Normal readers join the newest generation.
    if (old && (old.pending ? !refresh || old.refresh : !refresh && old.expires > now()))
      return old.promise
    entries.delete(key)
    // Invalidate dependent pages synchronously once per replacement, even
    // if the new read hits the global pending limit. Never retain stale pages.
    onReplace?.()
    for (const [k, entry] of entries) if (!entry.pending && entry.expires <= now()) entries.delete(k)
    while (entries.size >= limit) {
      const victim = [...entries].find(([, entry]) => !entry.pending)
      if (!victim) break
      entries.delete(victim[0])
    }
    // Superseded requests still count until they settle.
    if (entries.size >= limit || pending >= limit)
      return Promise.reject(new TopicReadCacheBusyError())
    const entry = {pending:true,refresh,expires:0,promise:null,value:undefined}
    pending++
    entry.promise = Promise.resolve().then(load).then(value => {
      // Only update this entry, never reinsert it after invalidation/replacement.
      entry.value = value
      entry.pending = false
      entry.expires = now() + ttl
      return value
    }, error => {
      if (entries.get(key) === entry) entries.delete(key)
      throw error
    }).finally(() => { pending-- })
    entries.set(key, entry)
    return entry.promise
  }
  return Object.freeze({get,has,peek,invalidate})
}
