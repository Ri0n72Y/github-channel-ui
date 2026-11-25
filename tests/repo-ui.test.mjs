import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, SafeMarkdown, validateVisibleFields, trustedMemberResultUrl, TeamStrip

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true },
  })
  SafeMarkdown = (await server.ssrLoadModule('/plugins/repo-home/src/SafeMarkdown.tsx')).SafeMarkdown
  const registration = await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')
  validateVisibleFields = registration.validateVisibleFields
  trustedMemberResultUrl = registration.trustedMemberResultUrl
  TeamStrip = (await server.ssrLoadModule('/plugins/repo-home/src/Team.tsx')).TeamStrip
})
after(async () => { await server?.close() })

const draft = () => ({
  name: 'Alice', githubUsername: '', role: '', bio: '', avatarUrl: '',
  links: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }],
})

test('#51 V1: safe Markdown exposes H1–H6 with distinct scoped level styles', () => {
  const markdown = ['# One', '## Two', '### Three', '#### Four', '##### Five', '###### Six'].join('\n\n')
  const html = renderToStaticMarkup(createElement(SafeMarkdown, { body: markdown }))
  const styles = readFileSync(resolve(root, 'plugins/shared/src/SafeMarkdown.module.css'), 'utf8')
  for (let level = 1; level <= 6; level++) {
    assert.match(html, new RegExp('role="heading" aria-level="' + level + '"'))
    assert.ok(styles.includes('.heading[aria-level="' + level + '"]'))
  }
  assert.ok(styles.includes('font-size:1.65em'))
  assert.ok(styles.includes('font-size:1em'))
  const article = renderToStaticMarkup(createElement(SafeMarkdown, { body: markdown, article: true }))
  assert.match(article, /role="heading" aria-level="1"/)
  assert.match(article, /class="[^"]*article/)
  const cardCss = readFileSync(resolve(root, 'plugins/repo-home/src/RepoHome.module.css'), 'utf8')
  const cardTitleSize = Number(cardCss.match(/\.card h3\{font-size:([\d.]+)px/)?.[1])
  const bodySize = Number(styles.match(/\.markdown\{[^\n]*font-size:([\d.]+)px/)?.[1])
  const articleSize = Number(styles.match(/\.article \.heading\[aria-level="1"\]\{font-size:([\d.]+)em/)?.[1])
  assert.ok(bodySize * articleSize < cardTitleSize, 'Issue title should exceed article H1')
  assert.doesNotMatch(html, /<script|<iframe/)
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

test('#51 V2: invalid URLs remain marked through edits, clear after valid input', () => {
  const avatar = draft()
  avatar.avatarUrl = 'http://example.com/old.png'
  assert.match(validateVisibleFields(avatar).avatarUrl, /HTTPS/)
  avatar.avatarUrl = 'http://example.com/new.png'
  assert.match(validateVisibleFields(avatar).avatarUrl, /HTTPS/)
  avatar.avatarUrl = 'https://example.com/new.png'
  assert.equal(validateVisibleFields(avatar).avatarUrl, undefined)
  const links = draft()
  links.links[2] = { label: 'Website', url: 'javascript:alert(1)' }
  assert.match(validateVisibleFields(links)['links.2.url'], /HTTPS/)
  links.links[2].url = 'http://example.com'
  assert.match(validateVisibleFields(links)['links.2.url'], /HTTPS/)
  links.links[2].url = 'https://example.com'
  assert.deepEqual(validateVisibleFields(links), {})
})

test('#51 V2: form keeps inline accessibility links and focuses first invalid input', () => {
  const src = readFileSync(resolve(root, 'plugins/repo-home/src/MemberRegisterPage.tsx'), 'utf8')
  assert.match(src, /fieldRefs\.current\[first\]\?\.focus\(\)/)
  assert.match(src, /aria-invalid=\{Boolean\(fieldErrors\.name\)\}/)
  assert.match(src, /aria-describedby=\{fieldErrors\.name/)
  assert.match(src, /aria-describedby=\{fieldErrors\[urlKey\]/)
  const entry = readFileSync(resolve(root, 'plugins/repo-home/src/index.tsx'), 'utf8')
  assert.match(entry, /<MemberRegisterPage key=\{scope\}/)
  assert.doesNotMatch(src, /setFields\(initial\(\)\)/)
  assert.match(src, /submitAttempted \? validateVisibleFields\(fields\) : \{\}/)
  assert.doesNotMatch(src, /clearFieldError\(/)
  assert.match(src, /validateMemberInput\(fields\)/)
})


test('#99 Member Strip shows real name and role beside each avatar', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(TeamStrip, {base:'/sample/repo',
      members:[{id:'alice',name:'Alice',role:'Maintainer'},{id:'bob',name:'Bob'}]})))
  assert.match(html, /Alice/)
  assert.match(html, /Maintainer/)
  assert.match(html, /Bob/)
  assert.match(html, /全部成员/)
  assert.doesNotMatch(html, /undefined/)
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
