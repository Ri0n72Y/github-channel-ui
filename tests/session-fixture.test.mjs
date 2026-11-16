import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'node:path'
let server, createSessionFixture
before(async()=>{
  server=await createServer({root:resolve(import.meta.dirname,'..'),configFile:false,
    logLevel:'silent',plugins:[react()],server:{middlewareMode:true}})
  createSessionFixture=(await server.ssrLoadModule(
    '/apps/playground/src/session-fixture.ts')).createSessionFixture
})
after(async()=>await server?.close())
const params=caseName=>new URLSearchParams({sessionFixture:'1',sessionCase:caseName})
const get=fn=>fn('/api/github-session',{method:'GET',signal:new AbortController().signal})
const post=fn=>fn('/api/github-logout',{method:'POST',
  headers:{'X-LabourChain-Write':'1'}})
test('#76 Playground Session scenarios are explicit and never call real GitHub',async()=>{
  const guest=createSessionFixture(params('anonymous')).request
  assert.deepEqual(await (await get(guest)).json(),{authenticated:false})
  const live=createSessionFixture(params('authenticated')).request
  const first=await (await get(live)).json()
  assert.equal(first.user.login,'fixture-user')
  assert.equal(first.authenticated,true)
  assert.deepEqual(await (await post(live)).json(),{authenticated:false})
  assert.deepEqual(await (await get(live)).json(),{authenticated:false})
  const failed=createSessionFixture(params('network')).request
  assert.equal((await get(failed)).status,503)
  const logoutError=createSessionFixture(params('logout-error')).request
  assert.equal((await post(logoutError)).status,503)
  assert.equal((await (await get(logoutError)).json()).authenticated,true)
  const noHeader=await logoutError('/api/github-logout',{method:'POST'})
  assert.equal(noHeader.status,403)
  const avatarFail=createSessionFixture(params('avatar-fail')).request
  assert.match((await (await get(avatarFail)).json()).user.avatarUrl,
    /avatars\.githubusercontent\.com/)
})
test('#76 Runtime never overrides global fetch for a Session fixture',async()=>{
  const {readFileSync}=await import('node:fs')
  const source=readFileSync(new URL('../apps/playground/src/runtime.tsx',import.meta.url),'utf8')
  assert.match(source,/sessionFixture/)
  assert.match(source,/createSessionFixture/)
  assert.doesNotMatch(source,/globalThis\.fetch\s*=|window\.fetch\s*=/)
})
