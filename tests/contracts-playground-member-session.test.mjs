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

test('Playground Session logout revokes the same Repo capability without blocking public team',async()=>{
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
