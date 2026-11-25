import test from 'node:test'
import assert from 'node:assert/strict'
import { createGithubSessionHandler, publicGitHubProfile } from '../api/github-session.mjs'
import { createGithubLogoutHandler } from '../api/_github-logout.mjs'
import { validLoginReturnPath } from '../api/_oauth.mjs'

const origin = 'https://labour.test'
const req = (path, init = {}) => new Request(origin + path, init)
const csrf = { origin, 'x-labourchain-write': '1', 'sec-fetch-site': 'same-origin' }

test('#76 GitHub session never returns OAuth token and validates real public identity', async () => {
  const handler = createGithubSessionHandler({
    read: () => ({ token: 'private-secret-token' }),
    getUser: async (path, token) => {
      assert.equal(path, '/user')
      assert.equal(token, 'private-secret-token')
      return Response.json({ id: 1234, login: 'Ri0n72Y',
        avatar_url: 'https://avatars.githubusercontent.com/u/16500109?v=4',
        email: 'secret@example.com', access_token: 'private-secret-token' })
    },
  })
  const response = await handler.fetch(req('/api/github-session'))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { authenticated: true,
    user: { login: 'Ri0n72Y',
      avatarUrl: 'https://avatars.githubusercontent.com/u/16500109?v=4' } })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), null)
  const anonymous = await createGithubSessionHandler({ read: () => null }).fetch(
    req('/api/github-session'))
  assert.deepEqual(await anonymous.json(), { authenticated: false })
})

test('#76 session distinguishes expired tokens, invalid public data and upstream failures', async () => {
  for (const [code, expected] of [[401,200],[403,503],[429,429],[503,503]]) {
    const handler = createGithubSessionHandler({
      read: () => ({token:'private'}),
      getUser: async () => new Response(null,{status:code}),
    })
    const result = await handler.fetch(req('/api/github-session'))
    assert.equal(result.status, expected)
    const body = await result.json()
    if(code===401)assert.equal(body.authenticated,false)
    else assert.equal(body.authenticated,undefined)
    assert.doesNotMatch(JSON.stringify(body), /private/)
  }
  const invalid = await createGithubSessionHandler({
    read: () => ({ token:'private' }),
    getUser: async () => Response.json({login:'bad/slash',avatar_url:'http://bad.test'}),
  }).fetch(req('/api/github-session'))
  assert.equal(invalid.status,502)
  const unavailable = await createGithubSessionHandler({
    read: () => {throw Error('oauth-secret')},
  }).fetch(req('/api/github-session'))
  assert.equal(unavailable.status,503)
  assert.doesNotMatch(await unavailable.text(),/oauth-secret/)
  assert.deepEqual(publicGitHubProfile({login:'octocat',avatar_url:'https://evil.invalid'}),{
    login:'octocat',avatarUrl:null,
  })
})

test('#76 logout requires explicit same-origin POST and clears only local secure cookies', async () => {
  const logout = createGithubLogoutHandler({ config: () => ({origin}) })
  for(const [method,headers,status] of [
    ['GET',csrf,405], ['POST',{},403],
    ['POST',{...csrf,origin:'https://evil.invalid'},403],
    ['POST',{...csrf,'x-labourchain-write':'0'},403],
    ['POST',{...csrf,'sec-fetch-site':'cross-site'},403],
  ]) {
    const response = await logout.fetch(req('/api/github-logout',{method,headers}))
    assert.equal(response.status,status)
    assert.equal(response.headers.get('set-cookie'),null)
  }
  const response = await logout.fetch(req('/api/github-logout',{
    method:'POST',headers:{...csrf,cookie:'__Host-lc-session=sealed-token'},
  }))
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{authenticated:false})
  const setCookies = response.headers.getSetCookie?.() || []
  assert.equal(setCookies.length,2)
  assert.ok(setCookies.some(c=>c.startsWith('__Host-lc-session=;')))
  assert.ok(setCookies.some(c=>c.startsWith('__Host-lc-oauth=;')))
  for(const cookie of setCookies) {
    assert.match(cookie,/Max-Age=0/)
    assert.match(cookie,/HttpOnly/)
    assert.match(cookie,/Secure/)
    assert.match(cookie,/SameSite=Lax/)
  }
  assert.equal(response.headers.get('cache-control'),'no-store')
})

test('#76 Github login return targets allow only real page paths, never API or open URLs', () => {
  const valid=['/sample/repo','/sample/repo/members','/sample/repo/members/register',
    '/sample/repo/issues/2','/sample/repo/config','/sample/repo/channels',
    '/topic/sample/repo']
  for(const path of valid)assert.equal(validLoginReturnPath(path),path)
  for(const path of ['//evil.invalid','/api/github-callback','/api/github-logout',
    'https://evil.invalid','/sample/repo?next=evil','/sample/repo/../../api/github-callback',
    '/sample/repo/channels?unsafe=1'])assert.equal(validLoginReturnPath(path),'/')
})

test('#76 Header is mounted once, provides keyboard/touch menu and exposes retry states', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const root=resolve(import.meta.dirname,'..')
  const source=path=>readFileSync(resolve(root,path),'utf8')
  const app=source('plugins/react-ui/src/index.tsx')
  const header=source('plugins/react-ui/src/SessionMenu.tsx')
  const css=source('plugins/react-ui/src/SessionMenu.module.css')
  assert.doesNotMatch(app,/SessionMenu|headerBrand|<header/)
  assert.doesNotMatch(header,/aria-haspopup="menu"|role="menuitem"/)
  assert.match(header,/role="group"/)
  assert.match(header,/aria-controls="lc-account-menu"/)
  assert.match(header,/aria-expanded=\{open\}/)
  assert.match(header,/onFocus=\{\(\)=>setOpen\(true\)\}/)
  assert.match(header,/onMouseEnter=/)
  assert.match(header,/document\.addEventListener\('pointerdown'/)
  assert.match(header,/event\.key==='Escape'/)
  assert.match(header,/使用 GitHub 登录/)
  assert.match(header,/退出登录/)
  assert.match(header,/emitSessionChanged\(\)/)
  assert.match(header,/state:'error'/)
  assert.match(css,/:focus-visible/)
  assert.match(css,/@media\(max-width:375px\)/)
  assert.doesNotMatch(header,/new .*Service|this\.fetcher/)
})
