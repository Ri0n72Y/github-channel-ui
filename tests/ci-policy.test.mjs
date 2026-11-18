import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
