import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, SafeMarkdown, validateVisibleFields, trustedMemberResultUrl

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true },
  })
  SafeMarkdown = (await server.ssrLoadModule('/plugins/shared/src/SafeMarkdown.tsx')).SafeMarkdown
  const registration = await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')
  validateVisibleFields = registration.validateVisibleFields
  trustedMemberResultUrl = registration.trustedMemberResultUrl
})
after(async () => { await server?.close() })

const draft = () => ({
  name: 'Alice', githubUsername: '', role: '', bio: '', avatarUrl: '',
  links: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }],
})

test('safe Markdown exposes accessible H1–H6 headings and inert markup', () => {
  const markdown = ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n\n')
  const html = renderToStaticMarkup(createElement(SafeMarkdown, { body: markdown }))
  for (let level = 1; level <= 6; level++) {
    assert.match(html, new RegExp('role="heading" aria-level="' + level + '"'))
  }
})

test('#51 V2: field errors point to name, avatar and the third personal link URL', () => {
  let value = draft()
  value.name = ' '
  assert.match(validateVisibleFields(value).name, /姓名/)
  value = draft()
  value.avatarUrl = 'http://example.com/avatar.png'
  assert.match(validateVisibleFields(value).avatarUrl, /HTTPS/)
  value = draft()
  value.links[2] = { label: 'Website', url: 'javascript:alert(1)' }
  assert.match(validateVisibleFields(value)['links.2.url'], /HTTPS/)
  assert.equal(validateVisibleFields(draft()).name, undefined)
  const valid = draft()
  valid.links[2] = { label: 'Website', url: 'https://example.com' }
  assert.deepEqual(validateVisibleFields(valid), {})
})

test('#99 member registration exposes only exact GitHub PR and Commit destinations', () => {
  const result = {status:'pending_pr',url:'https://github.com/sample/repo/pull/17'}
  assert.equal(trustedMemberResultUrl(result,'sample','repo'),result.url)
  const sha = 'a'.repeat(40)
  const committed = {status:'committed',url:'https://github.com/sample/repo/commit/'+sha}
  assert.equal(trustedMemberResultUrl(committed,'sample','repo'),committed.url)
  for(const url of [
    'https://github.com/other/repo/pull/17','https://github.com/sample/repo/issues/17',
    'https://github.com.evil.test/sample/repo/pull/17','http://github.com/sample/repo/pull/17',
    'https://github.com/sample/repo/pull/17?next=other','javascript:alert(1)',
  ]) assert.equal(trustedMemberResultUrl({...result,url},'sample','repo'),null,url)
  assert.equal(trustedMemberResultUrl({...committed,url:'https://github.com/sample/repo/commit/a'},'sample','repo'),null)
})
