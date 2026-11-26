import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
const viewPath = resolve(root, 'plugins/issue-detail/src/IssueDetailView.tsx')
const controllerPath = resolve(root, 'plugins/issue-detail/src/IssueDetailPage.tsx')
const viewSource = readFileSync(viewPath, 'utf8')
const controllerSource = readFileSync(controllerPath, 'utf8')
let server, View, issueTabForKey
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
    draft: '草稿不会自动提交', quote: null, commentLength: 9, refreshing: false,
    labour: { work: '', hours: '0.5', outcome: '', commits: '', start: '', end: '' },
    pending: false, pendingKind: null, notice: null,
    permission: { state: 'authorized', allowed: true,
      reason: '',loginHref: null,loginText: '' },
  },
}

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true },
  })
  const loaded = await server.ssrLoadModule('/plugins/issue-detail/src/IssueDetailView.tsx')
  View = loaded.default
  issueTabForKey = loaded.issueTabForKey
})
after(async () => { await server?.close() })

test('View/Controller import boundary: View does not reference Router, Cordis, Service or labour domain', () => {
  const imports = [...viewSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
  assert.ok(imports.includes('./view-model'))
  for (const forbidden of ['react-router', '@deepseek-ai/cordis', './service', './domain.mjs']) {
    assert.ok(!imports.includes(forbidden), forbidden)
  }
  assert.doesNotMatch(viewSource, /\bfetch\s*\(|\buseParams\s*\(|\buseLocation\s*\(|\bservice\s*\./)
  assert.match(controllerSource, /useParams/)
  assert.match(controllerSource, /summarizeIssueComments/)
  assert.match(controllerSource, /service\.postComment/)
})

test('pure View renders identity, outcome, scoped hours and tab relationships without Router or API', () => {
  const html = renderToStaticMarkup(createElement(View, { model, actions }))
  assert.match(html, /原始 Issue 标题/)
  assert.match(html, /实现了讨论组件/)
  assert.match(html, /登记者：labour-author/)
  assert.match(html, /1\.5/)
  assert.match(html, /非完整汇总/)
  assert.match(html, /role="tablist"/)
  assert.match(html, /role="tab"/)
  assert.match(html, /role="tabpanel"/)
  assert.match(html, /aria-controls=/)
  assert.match(html, /aria-labelledby=/)
  assert.match(html, /aria-selected="true"/)
  assert.match(html, /tabindex="-1"/)
  assert.match(html, /hidden=""/)
  assert.doesNotMatch(html, /刷新 Issue 与评论/)
  assert.match(html, /aria-label="GitHub 来源"/)
  assert.match(html, /dateTime="2026-11-02T00:00:00Z"/i)
  assert.match(html, /开放中/)
  assert.match(html, /返回项目/)
  assert.doesNotMatch(html, /返回首页/)
  assert.match(html, /加载下一页评论/)
})

test('anonymous View provides login-only participation, never an editable draft', () => {
  const anonymous=structuredClone(model)
  anonymous.form.permission={state:'anonymous',allowed:false,reason:'登录后参与',
    loginHref:'/api/github-login?return_to=%2Fsample%2Frepo%2Fissues%2F1',loginText:'GitHub 登录'}
  const html = renderToStaticMarkup(createElement(View, { model:anonymous, actions }))
  assert.doesNotMatch(html, /草稿不会自动提交|草稿仅保存在当前浏览器|<textarea|引用回复 speaker/)
  assert.match(html, /登录后即可发表评论/)
  assert.match(html, /登录后即可登记劳动/)
  assert.match(html, /未加载的评论/)
  assert.match(html, /role="status"/)
})

test('pure View renders authorized write controls and contextual failure status', () => {
  const ready = {
    ...model,
    form: { ...model.form, draft: '已经填写',
      labour: { ...model.form.labour, work: '修复表单' },
      notice: { kind: 'comment', tone: 'error', message: 'GitHub 提交失败，草稿已保留。' },
      permission: { state: 'authorized', allowed: true, reason: '',
        loginHref: null, loginText: '' } },
  }
  const html = renderToStaticMarkup(createElement(View, { model: ready, actions }))
  assert.match(html, /GitHub 提交失败，草稿已保留/)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /匿名用户只能阅读/)
  assert.doesNotMatch(html, /disabled=""/)
})


test('tab keyboard intent maps Left/Right/Home/End and ignores other keys', () => {
  assert.equal(issueTabForKey('discussion', 'ArrowRight'), 'labour')
  assert.equal(issueTabForKey('labour', 'ArrowLeft'), 'discussion')
  assert.equal(issueTabForKey('labour', 'ArrowRight'), 'discussion')
  assert.equal(issueTabForKey('discussion', 'ArrowLeft'), 'labour')
  assert.equal(issueTabForKey('labour', 'Home'), 'discussion')
  assert.equal(issueTabForKey('discussion', 'End'), 'labour')
  assert.equal(issueTabForKey('discussion', 'Tab'), null)
  assert.equal(issueTabForKey('labour', 'Enter'), null)
})

test('tab ARIA controls and labelledby IDs resolve to the correct mounted panels', () => {
  const html = renderToStaticMarkup(createElement(View, { model, actions }))
  for (const tab of ['discussion', 'labour']) {
    const tabMatch = html.match(new RegExp('id="([^"]+-tab-' + tab +
      ')" role="tab"[^>]*aria-controls="([^"]+)"[^>]*aria-selected="(true|false)"[^>]*tabindex="(-?[0-9]+)"'))
    assert.ok(tabMatch, 'expected ' + tab + ' tab metadata')
    assert.ok(tabMatch[2].endsWith('-panel-' + tab))
    assert.ok(html.includes('role="tabpanel" id="' + tabMatch[2] +
      '" aria-labelledby="' + tabMatch[1] + '"'))
    assert.equal(tabMatch[4], tab === 'discussion' ? '0' : '-1')
  }
})

test('#69 central discussion renders complete shared Markdown and preserves labour text semantics',async()=>{
  const shared=(await server.ssrLoadModule('/plugins/shared/src/SafeMarkdown.tsx')).SafeMarkdown
  const compatible=(await server.ssrLoadModule('/plugins/repo-home/src/SafeMarkdown.tsx')).SafeMarkdown
  assert.equal(compatible,shared,'one parser behind both public presentation entries')
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
  assert.ok(html.indexOf('最近已登记成果')>html.indexOf('话题背景'))
  assert.ok(html.indexOf('最近已登记成果')>html.indexOf('First comment'))
  assert.ok(html.indexOf('加载下一页评论')>html.indexOf('SECOND COMMENT END'))
  assert.ok(html.indexOf('First comment')<html.indexOf('SECOND COMMENT END'))
  assert.ok(html.includes('aria-hidden="true">S</span>'))
  assert.match(html,/textarea rows="3" maxLength="20000"/i)
})
test('#69 empty and incomplete discussion states are explicit; labour fields stay mounted',()=>{
  const payload=structuredClone(model)
  payload.issue.body='   '
  payload.issue.discussion.comments=[]
  payload.issue.labour.records[0].conflicted=true
  payload.issue.labour.invalidCount=2
  payload.issue.pagination.error='read failed'
  payload.issue.pagination.warnings=['partial results']
  const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
  for(const label of ['此 Issue 暂无正文','暂无讨论','Commit 冲突','2 条候选劳动评论格式无效',
    'partial results','read failed','重试本页','非完整汇总','草稿不会自动提交'])
    assert.ok(html.includes(label),label)
  for(const label of ['开始时间','结束时间','关联 Commit SHA','工作内容','成果（可选）','主观估时'])
    assert.ok(html.includes(label),label)
  const css=readFileSync(resolve(root,'plugins/issue-detail/src/IssueDetailView.module.css'),'utf8')
  assert.match(css,/\.tabs \{[^}]*flex-wrap:\s*wrap[^}]*padding:\s*6px/s)
  assert.match(css,/\.page button \{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/s)
  assert.match(css,/\.commentCard \{[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\)/s)
  assert.doesNotMatch(css,/position:\s*sticky|line-clamp|text-overflow/)
})

test('#69 one conversation shell has early tabs and a separate bounded composer with visible quote',()=>{
  const payload=structuredClone(model)
  payload.form.quote={id:6,author:'speaker',sourceUrl:payload.issue.discussion.comments[0].sourceUrl,
    excerpt:'真实引用内容',truncated:true}
  payload.form.commentLength=20001
  const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
  assert.equal((html.match(/aria-label="Issue 正文"/g)||[]).length,1)
  assert.ok(html.indexOf('role="tablist"')<html.indexOf('aria-label="Issue 正文"'))
  assert.ok(html.indexOf('aria-label="Issue 阅读区"')<html.indexOf('aria-label="参与讨论"'))
  assert.match(html,/aria-label="引用回复 speaker"/)
  assert.match(html,/回复 speaker/)
  assert.match(html,/引用已截取/)
  assert.match(html,/取消引用/)
  assert.match(html,/20001 \/ 20000 字符（含引用）/)
  assert.match(html,/超过 20000 字符/)
  assert.match(html,/href="https:\/\/github\.com\/sample\/repo\/issues\/1#issuecomment-6"/)
  const css=readFileSync(resolve(root,'plugins/issue-detail/src/IssueDetailView.module.css'),'utf8')
  assert.match(css,/\.conversationShell\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\) auto/s)
  assert.match(css,/\.conversationScroll\s*\{[^}]*overflow-y:\s*auto/s)
  assert.match(css,/\.commentComposer\[hidden\]\s*\{\s*display:\s*none/)
  assert.match(css,/safe-area-inset-bottom/)
  assert.match(viewSource,/visualViewport/)
  assert.match(viewSource,/getBoundingClientRect\(\)\.top/)
})

test('#69 B2 complete composer budget and compact single-scroll fallback retain all controls and feedback',()=>{
 const payload=structuredClone(model)
 payload.form.quote={id:6,author:'长'.repeat(100),excerpt:'引用内容'.repeat(400),truncated:true,sourceUrl:model.issue.discussion.comments[0].sourceUrl}
 payload.form.draft='长'.repeat(20000)
 payload.form.commentLength=21000
 payload.form.notice={kind:'comment',tone:'error',message:'提交反馈'.repeat(100)}
 payload.issue.pagination.hasMore=true
 payload.issue.discussion.comments.push({...payload.issue.discussion.comments[0],id:9,body:'最后一条评论'})
 const html=renderToStaticMarkup(createElement(View,{model:payload,actions}))
 for(const label of ['Issue 讨论面板','Issue 阅读区','最后一条评论','加载下一页评论','取消引用','发表评论','超过 20000 字符','提交反馈'])
  assert.ok(html.includes(label),label)
 assert.ok(html.indexOf('最后一条评论')<html.indexOf('aria-label="参与讨论"'))
 const css=readFileSync(resolve(root,'plugins/issue-detail/src/IssueDetailView.module.css'),'utf8')
 assert.match(css,/\.commentComposer \{[^}]*max-height:\s*calc\(var\(--issue-available-height, 100dvh\) \* \.5\)[^}]*overflow-y:\s*auto[^}]*grid-auto-rows:\s*max-content/s)
 assert.match(css,/\.page\[data-height-mode='compact'\] \.conversationShell \{[^}]*display:\s*block;[^}]*overflow-y:\s*auto/s)
 assert.match(css,/\.page\[data-height-mode='compact'\] \.conversationScroll \{[^}]*overflow:\s*visible/s)
 assert.match(css,/\.page\[data-height-mode='compact'\] \.commentComposer \{[^}]*max-height:\s*none;[^}]*overflow:\s*visible/s)
 assert.match(viewSource,/available < 480 \? 'compact' : 'split'/)
})


test('#20 complete reading keeps counts and exact times in diagnostics; invalid times safely fall back',()=>{
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
