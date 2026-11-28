import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
test('existing required Build & test check and basic tests remain', () => {
  assert.match(workflow,/\n  checks:\n    name: Build & test\n/)
  for (const command of ['npm run build','npm run test:installation','npm run test:critical','npm run test:dom','tests/router-fallback.test.mjs'])
    assert.ok(workflow.includes(command),command)
})
test('full Node regression is manual and requires an approval reference', () => {
  const [light,full]=workflow.split(/\n  full-regression:\n/)
  assert.ok(full?.includes('npm run test:full'))
  assert.ok(full.includes('npm run test:dom'))
  assert.ok(!light.includes('npm run test:full'))
  assert.ok(!light.includes('node --test tests/*.test.mjs'))
  assert.equal(pkg.scripts['test:full'], 'node --test tests/*.test.mjs')
  assert.ok(full.includes("github.event_name == 'workflow_dispatch' && inputs.full_regression && inputs.approval_reference != ''"))
})

test('light CI selects explicit, non-overlapping business scenarios without hidden test imports', () => {
  const selections = ['test:installation', 'test:critical', 'test:dom']
  const selected = []
  for (const name of selections) {
    const script = pkg.scripts[name]
    assert.ok(script?.startsWith('node --test '), name)
    assert.ok(!script.includes('*'), name + ' must not discover full regression')
    const targets = script.slice('node --test '.length).trim().split(/\s+/)
    for (const target of targets) {
      assert.ok(target.startsWith('tests/') && target.endsWith('.mjs'), target)
      selected.push(target)
    }
  }
  assert.equal(new Set(selected).size, selected.length, 'light CI must not run the same suite twice')
  const entries = new Set(readdirSync(new URL('.', import.meta.url)).map(file=>'tests/'+file))
  for (const target of selected) assert.ok(entries.has(target), 'missing test entry: '+target)
  // Domain suites exercise real production functions and belong to routine CI.
  for (const entry of entries) {
    if (/^tests\/domain-.*\.test\.mjs$/.test(entry)) assert.ok(selected.includes(entry),entry)
  }
  for (const file of readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs') || f.endsWith('.dom.mjs'))) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /^\s*import\s+(?:[^'"]+\s+from\s+)?['"]\.\/[^'"]+\.test\.mjs['"]/m,
      file + ' must not import a test entry point')
  }
  for (const name of selections) {
    assert.ok(workflow.includes('run: npm run ' + name), 'workflow omitted ' + name)
  }
})

test('routine CI uses read-only repository permissions and has no deploy command', () => {
  assert.ok(workflow.includes('contents: read'))
  assert.doesNotMatch(workflow,/vercel deploy|secrets\.VERCEL_TOKEN/)
})
test('CI only supersedes pending or running work within the same pull request',()=>{
  // These are approved Actions configuration values, not a reimplementation of its scheduler.
  assert.match(workflow,/group: public-ci-\$\{\{ github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| format\('run-\{0\}-\{1\}', github\.run_id, github\.run_attempt\) \}\}/)
  assert.match(workflow,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
})
