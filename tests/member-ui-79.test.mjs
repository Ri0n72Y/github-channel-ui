import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, TeamStatus, MemberManagementLink
let createSessionFixture, createRepoFixtureService

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent', plugins: [react()],
    server: { middlewareMode: true },
  })
  const team = await server.ssrLoadModule('/plugins/repo-home/src/Team.tsx')
  TeamStatus = team.TeamStatus
  MemberManagementLink = team.MemberManagementLink
  createSessionFixture = (await server.ssrLoadModule(
    '/apps/playground/src/session-fixture.ts')).createSessionFixture
  createRepoFixtureService = (await server.ssrLoadModule(
    '/apps/playground/src/repo-fixture.ts')).createRepoFixtureService
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

test('#79 Playground Session logout revokes the same Repo capability without blocking public team',async()=>{
  const query = new URLSearchParams({
    repoFixture:'1',sessionFixture:'1',sessionCase:'authenticated',fixtureTeam:'missing',
  })
  const session=createSessionFixture(query)
  const api=createRepoFixtureService(query,session.isAuthenticated)
  const capability=await api.getCapability('sample','repo','main',new AbortController().signal)
  assert.equal(capability.user.login,'fixture-operator')
  assert.equal((await api.getHome('sample','repo','main',new AbortController().signal))
    .team.state,'missing')
  assert.equal(session.isAuthenticated(),true)
  const response=await session.request('/api/github-logout',{method:'POST',
    headers:{'X-LabourChain-Write':'1'}})
  assert.equal(response.status,200)
  assert.equal(session.isAuthenticated(),false)
  await assert.rejects(api.getCapability('sample','repo','main',new AbortController().signal),
    error=>error?.status===401)
  assert.equal((await api.getHome('sample','repo','main',new AbortController().signal))
    .team.state,'missing')
  const guest=createSessionFixture(new URLSearchParams({sessionCase:'anonymous'}))
  const guestApi=createRepoFixtureService(new URLSearchParams({fixtureTeam:'empty'}),
    guest.isAuthenticated)
  await assert.rejects(guestApi.getCapability('sample','repo','main',new AbortController().signal),
    error=>error?.status===401)
  assert.equal((await guestApi.getHome('sample','repo','main',new AbortController().signal))
    .team.state,'empty')
})
