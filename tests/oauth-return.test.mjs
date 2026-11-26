import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { repositoryLinkPath } from '../plugins/repo-issues/src/target.mjs'
import { FLOW_COOKIE, newFlow, readFlow, validLoginReturnPath } from '../api/_oauth.mjs'

test('OAuth return targets are explicitly allowlisted', () => {
  assert.equal(validLoginReturnPath('/installation-probe.html'), '/installation-probe.html')
  assert.equal(validLoginReturnPath('/sample/repo/issues/28'), '/sample/repo/issues/28')
  assert.equal(validLoginReturnPath('/topic/sample/repo'), '/topic/sample/repo')
  assert.equal(validLoginReturnPath('/sample/repo/issues/new'),'/sample/repo/issues/new')
  assert.equal(validLoginReturnPath('/sample/repo/issues'),'/sample/repo/issues')
  assert.equal(validLoginReturnPath('/sample/..'),'/')
  for (const input of ['//evil.example', 'https://evil.example', '/api/github-callback', '/assets/repo', '/assets/repo/issues/1', '/installation-probe.html?next=evil', '/sample/repo/issues/28?next=evil',
    '/sample/repo/issues/0', '/sample/repo/issues/a', '/sample/repo/issues/28/extra', '/topic/bad/name/extra',
    '/topic/sample/repo?next=evil', null]) {
    assert.equal(validLoginReturnPath(input), '/')
  }
})

test('OAuth flow preserves safe return path inside sealed cookie', () => {
  const key = randomBytes(32)
  const flow = newFlow(key, '/installation-probe.html')
  const request = new Request('https://example.test/api/github-callback', {
    headers: { cookie: FLOW_COOKIE + '=' + flow.cookie },
  })
  const details = readFlow(request, key, flow.state)
  assert.equal(details.returnPath, '/installation-probe.html')
  assert.equal(readFlow(request, key, 'invalid'), null)
})

test('default OAuth flow still returns to the home page', () => {
  const key = randomBytes(32)
  const flow = newFlow(key)
  const request = new Request('https://example.test/api/github-callback', {
    headers: { cookie: FLOW_COOKIE + '=' + flow.cookie },
  })
  assert.equal(readFlow(request, key, flow.state).returnPath, '/')
})

test('OAuth flow preserves a validated Issue deep link, not a caller-controlled URL', () => {
  const key = randomBytes(32)
  const flow = newFlow(key, '/sample/repo/issues/28')
  const request = new Request('https://example.test/api/github-callback', {
    headers: { cookie: FLOW_COOKIE + '=' + flow.cookie },
  })
  assert.equal(readFlow(request, key, flow.state).returnPath, '/sample/repo/issues/28')
})

test('#115 OAuth canonicalizes only static route segments and preserves repository identity', () => {
  const cases = [
    ['/OwNeR/RePo','/OwNeR/RePo'],
    ['/OwNeR/ISSUES','/OwNeR/ISSUES'],
    ['/OwNeR/RePo/ISSUES','/OwNeR/RePo/issues'],
    ['/OwNeR/RePo/iSsUeS/NeW','/OwNeR/RePo/issues/new'],
    ['/OwNeR/RePo/ISSUES/28','/OwNeR/RePo/issues/28'],
    ['/OwNeR/RePo/MeMbErS','/OwNeR/RePo/members'],
    ['/OwNeR/RePo/MEMBERS/REGISTER','/OwNeR/RePo/members/register'],
    ['/OwNeR/RePo/CONFIG','/OwNeR/RePo/config'],
    ['/OwNeR/RePo/CHANNELS','/OwNeR/RePo/channels'],
    ['/OwNeR/RePo/ISSUES/','/OwNeR/RePo/issues/'],
    ['/Topic/OwNeR/RePo','/topic/OwNeR/RePo'],
    ['/TOPIC/OwNeR/CONFIG','/topic/OwNeR/CONFIG'],
    ['/TOPIC/Api/Repo','/topic/Api/Repo'],
    ['/Topic/RePo','/Topic/RePo'],
    ['/Topic/RePo/ISSUES/28','/Topic/RePo/issues/28'],
    ['/Topic/RePo/MEMBERS/REGISTER','/Topic/RePo/members/register'],
  ]
  const key = randomBytes(32)
  for (const [input, expected] of cases) {
    assert.equal(validLoginReturnPath(input), expected, input)
    assert.equal(validLoginReturnPath(expected), expected, 'idempotence: '+input)
    const flow = newFlow(key,input)
    const request = new Request('https://example.test/api/github-callback', {
      headers: {cookie: FLOW_COOKIE+'='+flow.cookie},
    })
    assert.equal(readFlow(request,key,flow.state).returnPath,expected,input)
  }
  for (const input of [
    '/API/RePo','/AsSeTs/RePo/ISSUES/1','/PLAYGROUND/RePo','/OwNeR/RePo/UNKNOWN',
    '/OwNeR/RePo/REPOSITORY','/OwNeR/RePo/TOPIC','/OwNeR/RePo/ISSUE',
    '/OwNeR/RePo/ISSUES/01','/OwNeR/RePo/ISSUES/9007199254740992',
    '/OwNeR/RePo/MEMBERS/UNKNOWN','/OwNeR/RePo/ISSUES/NEW/extra',
    '/OwNeR/RePo/ISSUES//','/OwNeR//ISSUES','//evil.example/ISSUES',
    '/OwNeR/RePo/ISSUES?next=evil','/OwNeR/RePo/ISSUES#evil',
    '/OwNeR/RePo/%49SSUES','/OwNeR/RePo/ISSUES%2F1','/OwNeR/RePo/ISSUES\\1',
    '/OwNeR/../ISSUES','/OwNeR/RePo/ISSUES/1\n','/INSTALLATION-PROBE.HTML',
  ]) assert.equal(validLoginReturnPath(input),'/',input)
})

test('#115 ordinary link intent remains distinct from Topic navigation', () => {
  for (const kind of ['CONFIG','CHANNELS','MEMBERS','ISSUES']) {
    const input='/ToPiC/RePo/'+kind
    assert.equal(repositoryLinkPath(input),null,input)
    assert.equal(validLoginReturnPath(input),'/topic/RePo/'+kind,input)
  }
  for (const [input,expected] of [
    ['/OwNeR/RePo/ISSUES/NEW','/OwNeR/RePo/issues/new'],
    ['/OwNeR/RePo/CONFIG','/OwNeR/RePo/config'],
    ['/OwNeR/RePo/CHANNELS','/OwNeR/RePo/channels'],
    ['/OwNeR/RePo/MEMBERS','/OwNeR/RePo/members'],
    ['/ToPiC/RePo/MEMBERS/REGISTER','/ToPiC/RePo/members/register'],
    ['/ToPiC/RePo/ISSUES/28','/ToPiC/RePo/issues/28'],
  ]) assert.equal(repositoryLinkPath(input),expected,input)
  for (const input of ['/API/RePo/ISSUES','/ASSETS/RePo/ISSUES/1','/Playground/RePo',
    '/OwNeR/RePo/ISSUES/0','/OwNeR/RePo/ISSUES/1?next=evil',
    '/OwNeR/RePo/%49SSUES','//evil.example/ISSUES','/OwNeR/RePo/ISSUES/']) {
    assert.equal(repositoryLinkPath(input),null,input)
  }
})
