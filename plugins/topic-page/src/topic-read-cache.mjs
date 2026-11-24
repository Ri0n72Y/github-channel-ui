/** Topic public-read cache only. No sessions, credentials, writes or failed values. */
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
  function get(key, load, refresh = false) {
    const old = entries.get(key)
    if (old && (old.pending || !refresh && old.expires > now())) return old.promise
    entries.delete(key)
    for (const [k, entry] of entries) if (!entry.pending && entry.expires <= now()) entries.delete(k)
    while (entries.size >= limit) {
      const victim = [...entries].find(([, entry]) => !entry.pending)
      if (!victim) break
      entries.delete(victim[0])
    }
    if (entries.size >= limit || pending >= limit)
      return Promise.reject(Object.assign(new Error('Topic 读取繁忙，请稍后重试'),{status:503,stage:'source'}))
    const entry = {pending:true,expires:0,promise:null}
    pending++
    entry.promise = Promise.resolve().then(load).then(value => {
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
  return Object.freeze({get,has,invalidate})
}
