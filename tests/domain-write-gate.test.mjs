import test from 'node:test'
import assert from 'node:assert/strict'
import { createWriteGate } from '../plugins/shared/src/write-gate.mjs'

function setup() {
  const states = []
  const gate = createWriteGate(state => states.push(state))
  return { gate, states, last: () => states.at(-1) }
}

test('a repository write is single-flight even before the page rerenders', () => {
  const { gate, states } = setup()
  const first = gate.begin()
  assert.ok(first)
  assert.equal(first.signal.aborted, false)
  assert.equal(gate.begin(), null)
  gate.finish(first)
  const second = gate.begin()
  assert.ok(second)
  assert.notEqual(second, first)
  assert.equal(gate.isCurrent(first), false)
  gate.finish(first)
  assert.equal(gate.begin(), null)
  assert.equal(gate.isCurrent(second), true)
  gate.finish(second)
  assert.deepEqual(states, [
    { pending: true, unknown: false }, { pending: false, unknown: false },
    { pending: true, unknown: false }, { pending: false, unknown: false },
  ])
})

test('an uncertain response locks every write until the user explicitly unlocks an idle gate', () => {
  const { gate, last } = setup()
  const first = gate.begin()
  assert.ok(first)
  gate.markUnknown(first)
  assert.deepEqual(last(), { pending: true, unknown: true })
  assert.equal(gate.unlock(), false)
  gate.finish(first)
  assert.deepEqual(last(), { pending: false, unknown: true })
  assert.equal(gate.begin(), null)
  assert.equal(gate.unlock(), true)
  const next = gate.begin()
  assert.ok(next)
  gate.markUnknown(first)
  gate.finish(first)
  assert.deepEqual(last(), { pending: true, unknown: false })
  assert.equal(gate.isCurrent(next), true)
  gate.finish(next)
  assert.ok(gate.begin())
})

test('session invalidation aborts the actual pending request and ignores its late completion', async () => {
  const { gate, last, states } = setup()
  gate.invalidate()
  assert.deepEqual(states, [])
  const first = gate.begin()
  assert.ok(first)
  let aborted = 0
  first.signal.addEventListener('abort', () => {
    aborted++
    assert.equal(gate.begin(), null)
    assert.equal(gate.isCurrent(first), false)
  })
  gate.invalidate()
  assert.equal(first.signal.aborted, true)
  assert.equal(aborted, 1)
  assert.deepEqual(last(), { pending: false, unknown: true })
  gate.finish(first)
  assert.equal(gate.begin(), null)
  assert.equal(gate.unlock(), true)
  const next = gate.begin()
  assert.ok(next)
  await Promise.resolve().then(() => {
    gate.markUnknown(first)
    gate.finish(first)
  })
  assert.equal(gate.isCurrent(next), true)
  assert.deepEqual(last(), { pending: true, unknown: false })
  gate.finish(next)
})

test('unmount aborts and detaches a request without notifying the unmounted page', () => {
  const { gate, states } = setup()
  const first = gate.begin()
  assert.ok(first)
  gate.dispose()
  assert.equal(first.signal.aborted, true)
  assert.equal(gate.isCurrent(first), false)
  gate.markUnknown(first)
  gate.finish(first)
  assert.deepEqual(states, [{ pending: true, unknown: false }])
  const independent = createWriteGate()
  assert.ok(independent.begin())
})
