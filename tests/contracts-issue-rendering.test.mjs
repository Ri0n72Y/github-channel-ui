import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, View
const actions = {
  onRetry() {}, onRefresh() {}, onLoadMore() {},
  onCommentChange() {}, onQuoteComment() {}, onCancelQuote() {}, onLabourChange() {}, onSubmitComment() {}, onSubmitLabour() {},
}
const model = {
  routeKey: 'sample/repo/issues/1',
  navigation: { homeHref: '/', repositoryHref: '/sample/repo', repository: 'sample/repo' },
  load: { phase: 'ready', error: null, statusCode: null },
  issue: {
    number: 1, title: '原始 Issue 标题', state: 'Open',
    author: 'issue-author', created: '2026-11-01T00:00:00Z', updated: '2026-11-03T00:00:00Z',
    body: '原始 Issue 正文', sourceUrl: 'https://github.com/sample/repo/issues/1',
    labourSummary: {
      hours: 1.5, complete: false,
      statusText: '仅为已读取的主观登记工时，非完整汇总。',
      outcome: { text: '实现了讨论组件', author: 'labour-author',
        time: '2026-11-02T00:00:00Z',
        sourceUrl: 'https://github.com/sample/repo/issues/1#issuecomment-7' },
      outcomeEmptyText: '暂无已确认成果',
    },
    pagination: {
      loaded: 1, expected: 101, hasMore: true, fetchingMore: false,
      error: '', lastRead: '2026-11-05T12:00:00Z', warnings: [],
      complete: false,
    },
    discussion: {
      comments: [{
        id: 6, author: 'speaker', time: '2026-11-02T00:00:00Z',
        body: '普通评论',
        sourceUrl: 'https://github.com/sample/repo/issues/1#issuecomment-6',
      }],
      emptyText: '暂无讨论',
    },
    labour: {
      records: [{ id: 7, author: 'labour-author', time: '2026-11-02T00:00:00Z',
        work: '代码维护', hours: 1.5, outcome: '实现了讨论组件',
        conflicted: false, occurrence: '未登记',
        sourceUrl: 'https://github.com/sample/repo/issues/1#issuecomment-7', commits: [] }],
      emptyText: '暂无劳动历史', invalidCount: 0,
    },
  },
  form: {
    draft: '当前评论内容', quote: null, commentLength: 9, refreshing: false,
    labour: { work: '', hours: '0.5', outcome: '', commits: '', start: '', end: '' },
    pending: false, pendingKind: null, notices: { comment: null, labour: null },
    permission: { state: 'authorized', allowed: true,
      reason: '',loginHref: null,loginText: '' },
    unknownKinds: [],
  },
}

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true },
  })
  const loaded = await server.ssrLoadModule('/plugins/issue-detail/src/IssueDetailView.tsx')
  View = loaded.default
})
after(async () => { await server?.close() })

test('central discussion renders complete shared Markdown and preserves labour text semantics',async()=>{
  const shared=(await server.ssrLoadModule('/plugins/shared/src/SafeMarkdown.tsx')).SafeMarkdown
  const compatible=(await server.ssrLoadModule('/plugins/repo-home/src/SafeMarkdown.tsx')).SafeMarkdown
  const payload=structuredClone(model)
  const body=['# Topic heading','**real emphasis** [reference](https://github.com/sample/repo)',
    '> exact quotation','- first entry','- second entry','```js','const example = "<script>"','```',
    '![poster](https://example.com/poster.png)','@[video](https://example.com/watch)',
    '<script>alert(1)</script>','<iframe src="https://evil.invalid"></iframe>',
    '[bad scheme](javascript:alert(1))','![bad image](data:image/png;base64,AA)',
    '![plain HTTP](http://example.com/x.png)','[credentials](https://user:pass@example.com)',
    'FINAL BODY MARKER'].join('\n\n')
  payload.issue.body=body
  payload.issue.discussion.comments=[
    {...model.issue.discussion.comments[0],body:'## First comment\n\n**comment emphasis**\n\n![comment image](https://example.com/comment.png)'},
    {...model.issue.discussion.comments[0],id:8,author:'second-speaker',body:'SECOND COMMENT END'},
  ]
  payload.issue.labour.records[0].work='**literal labour work**'
  payload.issue.labour.records[0].outcome='# literal outcome'
  const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
  for(const pattern of [/role="heading" aria-level="1"[^>]*>Topic heading/,
    /<strong>real emphasis<\/strong>/,/<blockquote>/,/<ul>/,/<pre><code>/,
    /src="https:\/\/example\.com\/poster\.png"/,/src="https:\/\/example\.com\/comment\.png"/,
    /referrerPolicy="no-referrer"/i,/打开视频/,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
    /图片链接不可用：bad image/,/图片链接不可用：plain HTTP/,
    /FINAL BODY MARKER/,/<strong>comment emphasis<\/strong>/,
    /\*\*literal labour work\*\*/,/# literal outcome/]) assert.match(html,pattern)
  assert.doesNotMatch(html,/<(?:script|iframe|object|embed)\b|(?:href|src)="(?:javascript:|data:|file:|blob:|http:\/\/example\.com\/x\.png|https:\/\/user:pass@)/i)
  assert.equal((html.match(/<img\b/g)||[]).length,2)
  assert.ok(html.includes('aria-hidden="true">S</span>'))
  assert.match(html,/<textarea\b[^>]*maxLength="20000"/i)
})
test('incomplete discussion and conflicted labour remain explicit; labour fields stay available',()=>{
  const payload=structuredClone(model)
  payload.issue.body='   '
  payload.issue.discussion.comments=[]
  payload.issue.labour.records[0].conflicted=true
  payload.issue.labour.invalidCount=2
  payload.issue.pagination.error='read failed'
  payload.issue.pagination.warnings=['partial results']
  const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
  for(const label of ['此 Issue 暂无正文','暂无讨论','Commit 冲突','2 条候选劳动评论格式无效',
    'partial results','read failed','重试本页','非完整汇总'])
    assert.ok(html.includes(label),label)
  for(const label of ['开始时间','结束时间','关联 Commit SHA','工作内容','成果（可选）','主观估时'])
    assert.ok(html.includes(label),label)
})

test('complete reading keeps counts and exact times in diagnostics; invalid times safely fall back',()=>{
 const payload=structuredClone(model)
 payload.issue.state='Closed'
 payload.issue.created='unavailable'
 payload.issue.pagination.complete=true
 payload.issue.pagination.hasMore=false
 payload.issue.pagination.loaded=101
 const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
 assert.match(html,/已关闭/)
 assert.match(html,/title="unavailable">unavailable/)
 assert.doesNotMatch(html,/还有未加载的评论|加载下一页评论/)
 assert.match(html,/<details[^>]*><summary>读取时间与来源<\/summary><p>已读取 101 \/ 101 条评论/)
 assert.equal((html.match(/aria-label="从 GitHub 重新加载此 Issue"/g)||[]).length,0)
})
