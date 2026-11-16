const CHANGE = 'labourchain:session-change'

/** @summary Notify mounted pages to re-check authorization after a local logout. */
export function emitSessionChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE))
}
export function subscribeSessionChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHANGE, listener)
  return () => window.removeEventListener(CHANGE, listener)
}
