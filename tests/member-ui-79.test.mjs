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
const read = path => readFileSync(resolve(root, path), 'utf8')
let server, TeamStatus, MemberManagementLink, MembersPage, MemberRegisterPage

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent', plugins: [react()],
    server: { middlewareMode: true },
  })
  const team = await server.ssrLoadModule('/plugins/repo-home/src/Team.tsx')
  TeamStatus = team.TeamStatus
  MemberManagementLink = team.MemberManagementLink
  MembersPage = (await server.ssrLoadModule('/plugins/repo-home/src/MembersPage.tsx')).default
  MemberRegisterPage = (await server.ssrLoadModule(
    '/plugins/repo-home/src/MemberRegisterPage.tsx')).default
})
after(async () => { await server?.close() })
const render = (component, url = '/sample/repo') =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, component))
const base = '/sample/repo'

test('#79 TeamStatus missing/empty displays public read-only state without manager CTA', () => {
  for (const state of ['missing', 'empty']) {
    const html = render(createElement(TeamStatus, {
      team: {state, members: []}, base, branch:'main',
    }))
    assert.match(html, state === 'missing' ? /尚未添加团队成员/ : /暂无成员/)
    assert.doesNotMatch(html, /href="[^"]*members\/register/)
  }
  const error = render(createElement(TeamStatus, {
    team: {state:'invalid', members:[],error:'Malformed JSON'},base,branch:'main',
  }))
  assert.match(error,/Malformed JSON/)
  assert.match(error,/查看 GitHub 成员文件/)
  assert.doesNotMatch(error,/members\/register/)
})

test('#79 registration CTA exists only for the successfully verified capability state', () => {
  for (const state of ['checking','anonymous','denied','error']) {
    const html = render(createElement(MemberManagementLink, {base,state}))
    assert.doesNotMatch(html,/members\/register/,state)
    assert.doesNotMatch(html,/添加成员/,state)
  }
  const allowed = render(createElement(MemberManagementLink, {base,state:'allowed'}))
  assert.match(allowed,/href="\/sample\/repo\/members\/register"/)
  assert.match(allowed,/添加成员/)
})

test('#79 Member Home and Members do not briefly render a write CTA before capability resolves', () => {
  const api = Object.freeze({
    getHome:async()=>{throw Error('not called in SSR')},
    getCapability:async()=>{throw Error('not called in SSR')},
    getFeed:async()=>{throw Error('not called in SSR')},
    register:async()=>{throw Error('not called in SSR')},
  })
  const members = render(createElement(MembersPage,{api}),'/sample/repo/members')
  assert.doesNotMatch(members,/href="[^"]*members\/register/)
  assert.doesNotMatch(members,/登录后添加成员/)
  const register = render(createElement(MemberRegisterPage,{api}),'/sample/repo/members/register')
  assert.doesNotMatch(register,/<form/)
  const src = read('plugins/repo-home/src/MemberRegisterPage.tsx')
  assert.match(src,/authStatus === 401 && <a href=\{login\}>登录 GitHub 后返回此表单/)
  assert.match(src,/\{capability && <>/)
  assert.match(read('plugins/repo-home/src/RepoHomePage.tsx'),
    /<MemberManagementLink base=\{base\} state=\{memberWrite\.state\}/)
  assert.match(read('plugins/repo-home/src/MembersPage.tsx'),
    /<MemberManagementLink base=\{base\} state=\{memberWrite\.state\}/)
})

test('#79 capability uses exact owner/repo/branch and revokes stale or logged-out permission', () => {
  const hook = read('plugins/repo-home/src/useMemberWriteAccess.ts')
  assert.match(hook,/JSON\.stringify\(\[owner, repo, branch, refresh, sessionRevision, attempt\]\)/)
  assert.match(hook,/subscribeSessionChanged/)
  assert.match(hook,/const abort = new AbortController\(\)/)
  assert.match(hook,/return \(\) => abort\.abort\(\)/)
  assert.match(hook,/if \(value\.branch !== branch\)/)
  assert.match(hook,/snapshot\.key === key \? snapshot : CHECKING/)
  assert.match(hook,/state: status === 401 \? 'anonymous' : status === 403 \? 'denied' : 'error'/)
  assert.doesNotMatch(hook,/this\.fetcher|new .*Service/)
})

test('#79 64px desktop toolbar and 44px controls survive semantic and mobile states', () => {
  const app = read('plugins/react-ui/src/App.module.css')
  const account = read('plugins/react-ui/src/SessionMenu.module.css')
  const desktop = app.split('@media')[0]
  const toolbar = desktop.match(/\.toolbar\s*\{([^}]*)\}/)?.[1]
  const login = account.match(/\.login\s*\{([^}]*)\}/)?.[1]
  assert.ok(toolbar)
  assert.match(toolbar,/box-sizing:\s*border-box/)
  assert.match(toolbar,/height:\s*64px/)
  assert.match(toolbar,/min-height:\s*64px/)
  assert.match(toolbar,/padding:\s*0 clamp\(/)
  assert.match(toolbar,/flex-wrap:\s*nowrap/)
  assert.ok(login)
  assert.match(login,/box-sizing:\s*border-box/)
  assert.match(login,/min-height:\s*44px/)
  assert.match(login,/padding:\s*0 16px/)
  assert.match(app,/@media \(max-width: 680px\)/)
  assert.match(app,/height:\s*auto/)
  assert.match(app,/flex-wrap:\s*wrap/)
  assert.match(account,/@media\(max-width:680px\)/)
  assert.match(account,/:focus-visible/)
  const host = read('plugins/react-ui/src/index.tsx')
  assert.match(host,/<SessionMenu request=\{sessionRequest\}/)
  assert.match(host,/className=\{styles\.themeButton\}/)
})
