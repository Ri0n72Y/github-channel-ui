/** Own a single explicit repository write and fail closed after an uncertain outcome.
 * The owner still decides authorization, payload, confirmation, and recovery reads.
 * Detach the attempt before aborting so its eventual response can never update a new attempt.
 */
export function createWriteGate(onChange = () => {}) {
  let active = null
  let unknown = false
  const publish = () => onChange({ pending: active !== null, unknown })
  const isCurrent = attempt => active !== null && active === attempt && !attempt.signal.aborted

  return {
    begin() {
      if (active || unknown) return null
      active = new AbortController()
      publish()
      return active
    },
    isCurrent,
    markUnknown(attempt) {
      if (isCurrent(attempt) && !unknown) {
        unknown = true
        publish()
      }
    },
    finish(attempt) {
      if (!isCurrent(attempt)) return
      active = null
      publish()
    },
    invalidate() {
      if (!active) return
      const attempt = active
      active = null
      unknown = true
      attempt.abort()
      publish()
    },
    unlock() {
      if (active || !unknown) return false
      unknown = false
      publish()
      return true
    },
    dispose() {
      const attempt = active
      active = null
      attempt?.abort()
    },
  }
}
