import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
const source = file => readFileSync(resolve(root, file), 'utf8')
let vite, theme, App, ThemeToggle
before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true } })
  theme = await vite.ssrLoadModule('/plugins/react-ui/src/theme.ts')
  ;({App,ThemeToggle}=await vite.ssrLoadModule('/plugins/react-ui/src/index.tsx'))
})
after(async () => { await vite?.close() })

function mockStorage(initial) {
  const values = new Map(initial == null ? [] : [[theme.THEME_STORAGE_KEY, initial]])
  return {
    values,
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
  }
}

test('#69 Theme preference defaults dark, accepts only dark/light and saves one stable key', () => {
  assert.equal(theme.THEME_STORAGE_KEY, 'labourchain.theme')
  assert.equal(theme.readStoredTheme(null), 'dark')
  for (const [stored, expected] of [
    [undefined, 'dark'], ['light', 'light'], ['dark', 'dark'],
    ['LIGHT', 'dark'], ['system', 'dark'], ['invalid', 'dark'], ['', 'dark'],
  ]) {
    const storage = mockStorage(stored)
    assert.equal(theme.readStoredTheme(storage), expected)
    theme.persistTheme('light', storage)
    assert.equal(storage.values.get('labourchain.theme'), 'light')
    assert.equal(theme.readStoredTheme(storage), 'light')
    theme.persistTheme('dark', storage)
    assert.equal(theme.readStoredTheme(storage), 'dark')
    assert.deepEqual([...storage.values.keys()], ['labourchain.theme'])
  }
})

test('#69 Storage read/write failures fail safely; caller can keep in-memory state', () => {
  let readCount = 0, writeCount = 0
  const unavailable = {
    getItem() { readCount++; throw Error('SecurityError') },
    setItem() { writeCount++; throw Error('QuotaExceededError') },
  }
  assert.equal(theme.readStoredTheme(unavailable), 'dark')
  assert.doesNotThrow(() => theme.persistTheme('light', unavailable))
  assert.equal(readCount, 1)
  assert.equal(writeCount, 1)
})

const paths = ['/', '/sample/repo', '/sample/repo/members',
  '/sample/repo/members/register', '/sample/repo/issues/2',
  '/topic/sample/repo', '/sample/repo/config', '/sample/repo/channels',
  '/totally-missing']

function renderApp(path) {
  const registrations = paths.filter(x => x !== '/' && x !== '/totally-missing')
    .map((name, index) => ({ id: String(index), path: name,
      Component: () => createElement('p', null, '测试业务区域 ' + name) }))
  const ui = { subscribe: () => () => {}, getSnapshot: () => registrations }
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(App, { ui }, createElement(ThemeToggle))))
}

test('#69 one Host renders keyboard theme control on all routes including NotFound', () => {
  for (const path of paths) {
    const html = renderApp(path)
    assert.match(html, /data-lc-theme="dark"/)
    assert.match(html, /type="button"/)
    assert.doesNotMatch(html, /<header/)
    assert.match(html, /切换为浅色模式/)
    assert.match(html, /aria-label="当前为深色模式，切换为浅色模式"/)
    assert.match(html, /<main/)
    if (path === '/' || path === '/totally-missing') {
      assert.match(html, /页面不存在或暂未提供/)
    } else {
      assert.match(html, /测试业务区域/)
    }
  }
})

test('shared theme defines the same semantic token interface for dark and light', () => {
  const tokens = source('plugins/react-ui/src/theme.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const required = ['canvas', 'surface', 'surface-raised', 'surface-input', 'stroke',
    'stroke-strong', 'text', 'text-secondary', 'text-muted', 'primary', 'primary-hover',
    'on-primary', 'link', 'focus', 'accent-soft', 'accent-ink', 'error', 'success', 'warning']
  const declarations = mode => {
    const rule = [...tokens.matchAll(/\[data-lc-theme\s*=\s*["'](dark|light)["']\]\s*\{([^{}]*)\}/g)]
      .filter(match => match[1] === mode)
    assert.equal(rule.length, 1, mode + ' palette')
    return new Map([...rule[0][2].matchAll(/(--lc-[\w-]+)\s*:\s*([^;{}]+);/g)]
      .map(match => [match[1], match[2].trim()]))
  }
  const dark = declarations('dark'), light = declarations('light')
  assert.deepEqual([...dark.keys()].sort(), [...light.keys()].sort())
  for (const name of required) {
    assert.ok(dark.get('--lc-' + name), name + ' missing in Dark')
    assert.ok(light.get('--lc-' + name), name + ' missing in Light')
  }
})

test('reusable UI does not instantiate another application runtime', () => {
  const app = source('plugins/react-ui/src/index.tsx')
  assert.doesNotMatch(app, /\bnew\s+Context\s*\(|\bcreateRoot\s*\(/)
})
