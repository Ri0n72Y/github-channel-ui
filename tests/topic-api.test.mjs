import test from 'node:test'
import assert from 'node:assert/strict'
import { readmeFields, parseTopicYaml, accumulateTopicProjects,
  validTopicRepository } from '../plugins/topic-page/src/domain.mjs'
import { createTopicPageEndpoint } from '../api/_topic-page.mjs'
import { topicReadFixture, HEAD } from './helpers/topic-read-fixture.mjs'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'

const respond = (code,body,headers={})=>Response.json(body,{status:code,headers})
function fixture(options={}){
  const errors=[]
  const m=topicReadFixture({privateRepo:options.private===true,config:options.config||'topic: labourchain\nwhitelist: true\n',
    search:()=>options.rateLimit?respond(403,{}, {'x-ratelimit-remaining':'0'}):{
      total_count:options.totalCount??1200,incomplete_results:false,
      items:[{id:42,full_name:'Member/Project',name:'Project',owner:{login:'Member'},
        html_url:'https://github.com/Member/Project',private:false}]}})
  return {...m,errors,projectFileCalls:()=>m.calls.filter(c=>c.host==='raw.githubusercontent.com'&&c.path.includes('/projects/')).length,
    logger:{error:(...args)=>errors.push(args)}}
}
const url = endpoint => 'https://example.test/api/' + endpoint + '?owner=sample&repo=repo'

test('#31 README description starts strictly below first H1 and removes only approved footnotes', () => {
  const fields = readmeFields('preamble\nfront matter\n# Actual title\nline A\nline B\nemail: a@example.org\ndatetime: 2026-11-12')
  assert.deepEqual(fields, { title: 'Actual title', description: 'line A\nline B',
    email: 'a@example.org', datetime: '2026-11-12' })
  assert.equal(readmeFields('no heading').description, '')
})

test('#31 Topic YAML is restricted, has whitelist enabled by default, and rejects unknown fields', () => {
  assert.deepEqual(parseTopicYaml('topic: labourchain\n'),
    { topic: 'labourchain', whitelist: true })
  assert.deepEqual(parseTopicYaml('topic: labourchain\nwhitelist: false\n'),
    { topic: 'labourchain', whitelist: false })
  assert.deepEqual(parseTopicYaml('repository: Me/Repo\n', 'project'), {
    repository: 'me/repo' })
  for(const source of ['topic: name\nother: unsafe\n','topic: abc\nwhitelist: yes\n',
    'topic: value\nwhitelist: false\nwhitelist: false\n']) {
    assert.throws(() => parseTopicYaml(source))
  }
  assert.equal(validTopicRepository('a','repo'), true)
  assert.equal(validTopicRepository('../escape', 'repo'), false)
})

test('#31 read-only metadata endpoint logs failed whitelist file without leaking headers', async () => {
  const m = fixture()
  const response = await createTopicPageEndpoint({
    fetcher: m.fetcher, logger: m.logger,
  }).fetch(new Request(url('topic-page')))
  assert.equal(response.status, 200)
  const value = await response.json()
  assert.deepEqual(value.allowedRepositories, ['member/project'])
  assert.equal(value.coverUrl, null)
  assert.equal(m.projectFileCalls(), 2)
  assert.equal(m.errors.length, 1)
  assert.ok(m.errors[0].join(' ').includes('projects/broken.yml'))
  assert.ok(!m.errors[0].join(' ').includes('Bearer'))
  assert.ok(m.calls.every(call => !call.auth), 'public GitHub fetch must not expose OAuth')
  assert.equal(m.calls.some(call => call.path.includes('/issues')), false)
})

test('legacy exported aggregation excludes source and deduplicates case-insensitive names', () => {
  const meta = { repository: { full_name: 'sample/repo' },
    config: { whitelist: true }, allowedRepositories: Array.from(
      { length: 12 }, (_, i) => 'member/p' + i) }
  const make = name => ({ full_name: name, html_url: 'https://github.com/' + name })
  const pages = [{ hasNext: true, windowExhausted: false, items: [
    make('other/ignored'), make('member/p0'), make('MEMBER/P0'), make('sample/repo')] },
  { hasNext: false, windowExhausted: true, items: Array.from({ length: 8 },
    (_, i) => make('member/p' + (i + 1))) }]
  const result = accumulateTopicProjects(meta, pages)
  assert.deepEqual(result.items.map(item=>item.full_name),Array.from({length:9},(_,i)=>'member/p'+i))
  assert.equal(result.windowExhausted, true)
  assert.equal(result.ended, true)
})

test('private source repository cannot expose Topic metadata',async()=>{
  const privateRepo=fixture({private:true})
  const invalid=await createTopicPageEndpoint({fetcher:privateRepo.fetcher}).fetch(new Request(url('topic-page')))
  assert.equal(invalid.status,404)
})

test('#31 Topic API POST is rejected and source target validation occurs before GitHub', async () => {
  const m = fixture()
  const p = createTopicPageEndpoint({ fetcher: m.fetcher })
  const get = createTopicProjectsEndpoint({ fetcher: m.fetcher })
  assert.equal((await p.fetch(new Request(url('topic-page'), { method: 'POST' }))).status, 405)
  assert.equal((await get.fetch(new Request(url('topic-projects'), { method: 'POST' }))).status, 405)
  const invalidUrl = new URL(url('topic-page'))
  invalidUrl.searchParams.set('repo', '../../evil')
  assert.equal((await p.fetch(new Request(invalidUrl))).status, 400)
  assert.equal(m.calls.length, 0)
})


test('#69 Topic Search forwards only original trusted GitHub image metadata', async () => {
  const fixtureData = fixture()
  const endpoint = createTopicProjectsEndpoint({
    fetcher: (url, init) => new URL(url).pathname === '/search/repositories'
      ? respond(200, { total_count: 1, items: [{
        id:42, full_name: 'member/project', name: 'project',
        html_url: 'https://github.com/member/project', private: false,
        owner: { login: 'member', avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4' },
        open_graph_image_url: 'https://repository-images.githubusercontent.com/42/cover.png',
      }] }) : fixtureData.fetcher(url, init),
  })
  const response = await endpoint.fetch(new Request(url('topic-projects') + '&page=1'))
  assert.equal(response.status, 200)
  const item = (await response.json()).items[0]
  assert.equal(item.owner_avatar_url, 'https://avatars.githubusercontent.com/u/42?v=4')
  assert.equal(item.cover_url, 'https://repository-images.githubusercontent.com/42/cover.png')

  const rejected = createTopicProjectsEndpoint({
    fetcher: (url, init) => new URL(url).pathname === '/search/repositories'
      ? respond(200, { total_count: 1, items: [{
        id:42, full_name: 'member/project', name: 'project',
        html_url: 'https://github.com/member/project', private: false,
        owner: { login: 'member', avatar_url: 'https://evil.invalid/avatar.png' },
        open_graph_image_url: 'javascript:alert(1)',
      }] }) : fixtureData.fetcher(url, init),
  })
  const denied = (await (await rejected.fetch(new Request(url('topic-projects') + '&page=1'))).json()).items[0]
  assert.equal(Object.hasOwn(denied, 'cover_url'), false)
  assert.equal(Object.hasOwn(denied, 'owner_avatar_url'), false)
})
