import { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { SESSION_COOKIE, sessionCookie } from '../../api/_oauth.mjs'

// Replace only external HTTP; real signed cookies, App JWTs and authorization run.
export function githubHttpFixture(origin, token) {
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
  const key=randomBytes(32)
  const env={GITHUB_APP_ID:'123456',
    GITHUB_APP_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}),
    GITHUB_APP_CLIENT_ID:'Iv1234567.fixture',GITHUB_APP_CLIENT_SECRET:'fixture-secret',
    GITHUB_OAUTH_CALLBACK_URL:origin+'/api/github-callback',
    GITHUB_OAUTH_COOKIE_KEY:key.toString('base64url')}
  const names=[...Object.keys(env),'GITHUB_INSTALLATION_ID']
  let previous,originalFetch
  beforeEach(()=>{
    previous=Object.fromEntries(names.map(name=>[name,process.env[name]]))
    originalFetch=globalThis.fetch
    Object.assign(process.env,env)
    delete process.env.GITHUB_INSTALLATION_ID
    globalThis.fetch=async()=>{throw Error('Unexpected external request: no fixture selected')}
  })
  afterEach(()=>{
    globalThis.fetch=originalFetch
    for(const name of names){
      if(previous[name]===undefined)delete process.env[name]
      else process.env[name]=previous[name]
    }
  })
  function use(fetcher){globalThis.fetch=fetcher;return fetcher}
  function post(path,body,{loggedIn=true,requestOrigin=origin}={}){
    const cookie=sessionCookie(token,3600,key).split(';')[0]
    assert.ok(cookie.startsWith(SESSION_COOKIE+'='))
    return new Request(origin+path,{method:'POST',headers:{
      origin:requestOrigin,'content-type':'application/json','x-labourchain-write':'1',
      ...(loggedIn?{cookie}:{})},body:JSON.stringify(body)})
  }
  function assertApp(auth){
    assert.ok(typeof auth==='string'&&auth.startsWith('Bearer '))
    const [header,payload,signature,...rest]=auth.slice(7).split('.')
    assert.equal(rest.length,0)
    assert.equal(JSON.parse(Buffer.from(payload,'base64url')).iss,env.GITHUB_APP_ID)
    assert.ok(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')))
  }
  return {use,post,assertApp}
}
