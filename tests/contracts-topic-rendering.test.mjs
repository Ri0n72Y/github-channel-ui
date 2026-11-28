import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, View
before(async () => {
  server = await createServer({ root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true } })
  View = (await server.ssrLoadModule('/plugins/topic-page/src/TopicPageView.tsx')).default
})
after(async () => { await server?.close() })

function render(options = {}) {
  return renderToStaticMarkup(createElement(View, {
    owner: 'sample', repo: 'repo', snapshot: options.snapshot || null,
    projects: options.projects || [], loading: options.loading || false,
    error: options.error || null, windowExhausted: options.windowExhausted || false,
    report: options.report || { open: false, title: '', body: '',
      message: '', pending: false, checking: false, uncertain: false, url: '' },
    canReport: options.canReport || false, writeEnabled: options.writeEnabled || false,
    onRetry() {}, onOpenReport() {}, onCloseReport() {},
    onReportTitleChange() {}, onReportBodyChange() {}, onSubmitReport() {},
  }))
}
const meta = {
  repository: { owner: 'sample', name: 'repo', full_name: 'sample/repo',
    html_url: 'https://github.com/sample/repo' },
  readme: 'Before H1\n# Real Topic\nDescription\nemail: team@example.org\ndatetime: November',
  coverUrl: null,
  config: { topic: 'labourchain', whitelist: true },
  allowedRepositories: ['member/project'],
}
const project = { full_name: 'member/project', name: 'project',
  owner: 'member', description: 'Project', html_url: 'https://github.com/member/project',
  stargazers_count: 1, language: 'TypeScript' }

test('Search window exhaustion renders an explicit non-terminal warning', () => {
  const html = render({ snapshot: meta, projects: [project], windowExhausted: true })
  assert.match(html, /1000 条可访问上限/)
  assert.match(html, /无法确认是否还有更多项目/)
  assert.doesNotMatch(html, /当前可访问搜索范围没有符合配置/)
})

test('B1-1 incomplete GitHub Search renders retryable failure, never an empty result', () => {
  const html = render({ error: Object.assign(
    new Error('GitHub Topic Search 结果不完整，请重试读取'),
    { stage: 'topic-search', status: 502 }) })
  assert.match(html, /项目读取失败/)
  assert.match(html, /GitHub Topic Search 结果不完整/)
  assert.match(html, /重新加载/)
  assert.doesNotMatch(html, /aria-label="刷新项目"/)
  assert.doesNotMatch(html, /当前可访问搜索范围没有符合配置的项目/)
  assert.doesNotMatch(html, /1000 条可访问上限/)
})


