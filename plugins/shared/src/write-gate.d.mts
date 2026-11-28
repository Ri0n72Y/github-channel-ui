export type WriteGateState = Readonly<{ pending: boolean; unknown: boolean }>
export interface WriteGate {
  begin(): AbortController | null
  isCurrent(attempt: AbortController): boolean
  markUnknown(attempt: AbortController): void
  finish(attempt: AbortController): void
  invalidate(): void
  unlock(): boolean
  dispose(): void
}
export function createWriteGate(onChange?: (state: WriteGateState) => void): WriteGate
