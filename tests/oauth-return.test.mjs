import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { FLOW_COOKIE, newFlow, readFlow, validLoginReturnPath } from '../api/_oauth.mjs'

test('OAuth return targets are explicitly allowlisted', () => {
  assert.equal(validLoginReturnPath('/installation-probe.html'), '/installation-probe.html')
  for (const path of ['/sample/repo','/sample/repo/members','/sample/repo/members/register',
    '/sample/repo/config','/sample/repo/channels','/sample/repo/issues/28']) {
    assert.equal(validLoginReturnPath(path), path)
  }
  assert.equal(validLoginReturnPath('/topic/sample/repo'), '/topic/sample/repo')
  assert.equal(validLoginReturnPath('/sample/repo/issues/new'),'/sample/repo/issues/new')
  assert.equal(validLoginReturnPath('/sample/repo/issues'),'/sample/repo/issues')
  assert.equal(validLoginReturnPath('/sample/..'),'/')
  for (const input of ['//evil.example', 'https://evil.example', '/api/github-callback', '/assets/repo', '/assets/repo/issues/1', '/installation-probe.html?next=evil', '/sample/repo/issues/28?next=evil',
    '/sample/repo/issues/0', '/sample/repo/issues/a', '/sample/repo/issues/28/extra', '/topic/bad/name/extra',
    '/topic/sample/repo?next=evil', '/api/github-logout', '/sample/repo?next=evil',
    '/sample/repo/../../api/github-callback', '/sample/repo/channels?unsafe=1', null]) {
    assert.equal(validLoginReturnPath(input), '/')
  }
})

test('OAuth flow seals a validated return target and rejects mismatched state', () => {
  const key = randomBytes(32)
  for (const [input, expected] of [
    [undefined, '/'],
    ['/installation-probe.html', '/installation-probe.html'],
    ['/sample/repo/issues/28', '/sample/repo/issues/28'],
    ['/OwNeR/RePo/ISSUES/28', '/OwNeR/RePo/issues/28'],
    ['https://evil.example', '/'],
  ]) {
    const flow = newFlow(key, input)
    const request = new Request('https://example.test/api/github-callback', {
      headers: { cookie: FLOW_COOKIE + '=' + flow.cookie },
    })
    assert.equal(readFlow(request, key, flow.state)?.returnPath, expected, input)
    assert.equal(readFlow(request, key, 'invalid'), null)
    assert.equal(readFlow(request, randomBytes(32), flow.state), null)
  }
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
    ['/ToPiC/RePo/CHANNELS','/topic/RePo/CHANNELS'],
    ['/ToPiC/RePo/MEMBERS','/topic/RePo/MEMBERS'],
    ['/ToPiC/RePo/ISSUES','/topic/RePo/ISSUES'],
    ['/TOPIC/Api/Repo','/topic/Api/Repo'],
    ['/Topic/RePo','/Topic/RePo'],
    ['/Topic/RePo/ISSUES/28','/Topic/RePo/issues/28'],
    ['/Topic/RePo/MEMBERS/REGISTER','/Topic/RePo/members/register'],
  ]
  for (const [input, expected] of cases) {
    assert.equal(validLoginReturnPath(input), expected, input)
    assert.equal(validLoginReturnPath(expected), expected, 'idempotence: '+input)
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

