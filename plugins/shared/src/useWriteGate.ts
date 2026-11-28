import { useEffect, useState } from 'react'
import { createWriteGate, type WriteGateState } from './write-gate.mjs'

/** Bind the shared write lifecycle to a mounted page. Session changes are owned by the caller. */
export function useWriteGate() {
  const [state, setState] = useState<WriteGateState>({ pending: false, unknown: false })
  const [gate] = useState(() => createWriteGate(setState))
  useEffect(() => () => gate.dispose(), [gate])
  return { gate, ...state }
}
