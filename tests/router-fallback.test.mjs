import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PLAYGROUND_PLUGINS, resolvePlaygroundPath } from '../apps/playground/src/playground-paths.mjs'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const rewrite = config.rewrites[0]
const matches = new RegExp(`^${rewrite.source}$`)

test('SPA routes fall back to the index without changing the URL', () => {
  assert.equal(rewrite.destination, '/index.html')
  for (const path of ['/alice/project', '/alice/project/kanban',
    '/alice/project/issues/12', '/__route-test/alice/project', '/unknown/route/path',
    '/playground', '/playground/', ...PLAYGROUND_PLUGINS.map(p => '/playground/' + p.slug),
    '/playground/repo-home/sample/repo', '/playground/unknown']) {
    assert.equal(matches.test(path), true, path)
  }
})

test('reserved API, callback and asset paths are not rewritten', () => {
  for (const path of ['/api', '/api/issues', '/api/github-callback',
    '/api/not-found', '/assets/index-abc123.js', '/installation-probe.html',
    '/favicon.ico', '/robots.txt']) {
    assert.equal(matches.test(path), false, path)
  }
})

test('#94 six stable public Playground entry paths and their plugin-owned internal routes', () => {
  assert.equal(PLAYGROUND_PLUGINS.length, 6)
  assert.equal(new Set(PLAYGROUND_PLUGINS.map(item => item.slug)).size, 6)
  assert.equal(resolvePlaygroundPath('/').kind, 'home')
  assert.equal(resolvePlaygroundPath('/playground').kind, 'catalog')
  assert.equal(resolvePlaygroundPath('/playground/').kind, 'catalog')
  for (const plugin of PLAYGROUND_PLUGINS) {
    const route = resolvePlaygroundPath('/playground/' + plugin.slug)
    assert.equal(route.kind, 'plugin')
    assert.equal(route.plugin.slug, plugin.slug)
    assert.equal(route.basename, '/playground/' + plugin.slug)
    assert.equal(plugin.initialPath.startsWith('/'), true)
    const nested = resolvePlaygroundPath('/playground/' + plugin.slug + plugin.initialPath)
    assert.equal(nested.kind, 'plugin')
    assert.equal(nested.plugin.slug, plugin.slug)
  }
  for (const path of ['/playground/unknown', '/playground/bad/branch', '/playground//repo-home'])
    assert.equal(resolvePlaygroundPath(path).kind, 'not-found')
  for (const path of ['/sample/repo', '/topic/sample/repo', '/__route-test/sample/repo'])
    assert.equal(resolvePlaygroundPath(path).kind, 'legacy')
})

test('#94 public directory keeps API, legacy entry and SPA compatibility', () => {
  const main = readFileSync(new URL('../apps/playground/src/main.tsx', import.meta.url), 'utf8')
  const single = readFileSync(new URL('../apps/playground/src/single-plugin-runtime.ts', import.meta.url), 'utf8')
  assert.match(main, /pathname\.kind === 'home' && !legacyQuery/)
  assert.match(main, /startSinglePluginRuntime\(pathname\.plugin\.slug\)/)
  assert.match(main, /BrowserRouter basename=\{pathname\.basename\}/)
  assert.match(single, /selectedOverride \?\? query\.get\('plugin'\)/)
  assert.match(single, /createRepoPanelFixturePlugin\(query\)/)
  assert.ok(config.rewrites.slice(1).every(item => item.source.startsWith('/api/')))
  assert.equal(config.rewrites.length, 16)
})
