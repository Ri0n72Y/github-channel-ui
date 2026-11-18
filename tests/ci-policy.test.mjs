import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8')
test('existing required Build & test check and basic tests remain', () => {
  assert.match(workflow,/\n  checks:\n    name: Build & test\n/)
  for (const command of ['npm run build','npm run test:installation','tests/router-fallback.test.mjs'])
    assert.ok(workflow.includes(command),command)
})
test('full Node regression is manual and requires approval', () => {
  const [light,full]=workflow.split(/\n  full-regression:\n/)
  assert.ok(full?.includes('node --test tests/*.test.mjs'))
  assert.ok(!light.includes('node --test tests/*.test.mjs'))
  assert.ok(full.includes("github.event_name == 'workflow_dispatch' && inputs.full_regression && inputs.approval_reference != ''"))
})
test('PR stale runs cancel, main does not, no deploy', () => {
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"))
  assert.ok(workflow.includes('contents: read'))
  assert.doesNotMatch(workflow,/vercel deploy|secrets\.VERCEL_TOKEN/)
})
test('governance branch cannot generate Preview', () => {
  const v=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'))
  assert.equal(v.git.deploymentEnabled['ci-governance-budget-20261118'],false)
  assert.notEqual(v.git.deploymentEnabled.main,false)
  assert.equal(v.rewrites.length,16)
  assert.match(agents,/CI 配额与自动化约束/)
  assert.match(agents,/本地.*验证/)
})

// Evaluate the workflow expression using the GitHub `format()` semantics with
// controlled event contexts. GitHub replaces pending runs with the same group
// even when `cancel-in-progress` is false.
function concurrencyFor(event_name, run_id, { number = undefined, run_attempt = 1 } = {}) {
  const group = workflow.match(/^  group: (public-ci-)\$\{\{\s*(.+?)\s*\}\}$/m)
  const cancel = workflow.match(/^  cancel-in-progress: \$\{\{\s*(.+?)\s*\}\}$/m)
  assert.ok(group, 'workflow concurrency group expression missing')
  assert.ok(cancel, 'workflow concurrency cancellation expression missing')
  const github = { event_name, event: { pull_request: { number } }, run_id, run_attempt, ref: 'refs/heads/main' }
  const format = (template, ...values) => template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)]))
  return {
    group: group[1] + runInNewContext(group[2], { github, format }),
    cancelInProgress: runInNewContext(cancel[1], { github, format }),
  }
}

test('concurrency: the same PR update shares one cancelable group, other PRs do not', () => {
  const first = concurrencyFor('pull_request', 100, { number: 7 })
  const next = concurrencyFor('pull_request', 101, { number: 7 })
  const other = concurrencyFor('pull_request', 102, { number: 8 })
  assert.equal(first.group, next.group)
  assert.notEqual(first.group, other.group)
  assert.equal(first.cancelInProgress, true)
  assert.equal(next.cancelInProgress, true)
})

test('concurrency: main and approved manual pending runs cannot replace each other', () => {
  const runningMain = concurrencyFor('push', 200)
  const pendingMain = concurrencyFor('push', 201)
  const laterMain = concurrencyFor('push', 202)
  const manual = concurrencyFor('workflow_dispatch', 203)
  const nextManual = concurrencyFor('workflow_dispatch', 204)
  const rerunAttempt = concurrencyFor('push', 202, { run_attempt: 2 })
  const all = [runningMain, pendingMain, laterMain, manual, nextManual, rerunAttempt]
  assert.equal(new Set(all.map(x => x.group)).size, all.length,
    'same group lets GitHub queue:single replace an existing pending run')
  for (const item of all) assert.equal(item.cancelInProgress, false)
  const pendingReplaced = (pending, incoming) => pending.group === incoming.group
  assert.equal(pendingReplaced(pendingMain, laterMain), false)
  assert.equal(pendingReplaced(pendingMain, manual), false)
  assert.equal(pendingReplaced(manual, nextManual), false)
})
