import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { ProbeError } from '../api/_installation-probe.mjs'
import { loadInstalledTopicBatch, validTopicSlug } from '../plugins/topic-page/src/domain.mjs'

const base = 'https://labour.test/api/topic-projects?topic=dsh-plugin'
const project = id => ({
  id, full_name: 'member/project-' + id, name: 'project-' + id,
  owner: { login: 'member', avatar_url: 'https://avatars.githubusercontent.com/u/9' },
  private: false, html_url: 'https://github.com/member/project-' + id,
  description: 'GitHub 原始项目', stargazers_count: id, language: 'TypeScript',
})
function fakeGitHub({ count = 100, total = 110, incomplete = false } = {}) {
  const calls = []
  const items = Array.from({ length: count }, (_, index) => project(index + 1))
  const fetcher = async (url, init = {}) => {
    const u = new URL(url)
    calls.push({ pathname: u.pathname, search: u.search, method: init.method || 'GET' })
    if (u.pathname !== '/search/repositories') throw Error('source GET must not happen: ' + u.pathname)
    return Response.json({ total_count: total, items,
      incomplete_results: incomplete })
  }
  return { calls, fetcher }
}
const installed = async ({ repo }) => ({
  repositoryId: Number(repo.slice('project-'.length)),
  installationId: 77,
})

test('#83 slug mode reads only a specific GitHub Topic, with 25/5 budget and no source GET', async () => {
  const mock = fakeGitHub()
  let checks = 0, active = 0, peak = 0
  const handler = createTopicProjectsEndpoint({ fetcher: mock.fetcher,
    installationResolver: async args => {
      checks++; active++; peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return installed(args)
    } })
  const response = await handler.fetch(new Request(base))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual([result.page, result.offset, result.items.length,
    result.nextPage, result.nextOffset], [1, 0, 25, 1, 25])
  assert.equal(checks, 25)
  assert.ok(peak <= 5)
  assert.deepEqual(mock.calls.map(x => x.pathname), ['/search/repositories'])
  assert.match(mock.calls[0].search, /topic:dsh-plugin/)
  assert.ok(mock.calls.every(x => x.method === 'GET'))
  assert.ok(result.items.every(x => Number.isSafeInteger(x.id) && x.id > 0))
})

test('#83 invalid or ambiguous Topic slugs fail before any GitHub query', async () => {
  const mock = fakeGitHub()
  const handler = createTopicProjectsEndpoint({ fetcher: mock.fetcher,
    installationResolver: installed })
  for (const suffix of [
    '?topic=bad_slug', '?topic=-bad', '?topic=bad-', '?topic=%E4%B8%AD',
    '?topic=dsh-plugin&topic=other', '?topic=dsh-plugin&owner=sample',
    '?topic=dsh-plugin&repo=repo', '?topic=dsh-plugin&page=11',
    '?topic=dsh-plugin&offset=1',
  ]) {
    const response = await handler.fetch(new Request(
      'https://labour.test/api/topic-projects' + suffix))
    assert.equal(response.status, 400, suffix)
  }
  assert.equal(mock.calls.length, 0)
  for (const invalid of ['bad_slug', '-bad', '', 'a'.repeat(51)]) {
    assert.equal(validTopicSlug(invalid), false)
  }
  assert.equal(validTopicSlug('dsh-plugin'), true)
})

test('#83 direct discovery rejects revoked, suspended, private and failed verification', async () => {
  for (const [failure, status, expected] of [
    ['removed', 200, 0], ['suspended', 200, 0],
    ['limited', 429, null], ['denied', 502, null],
  ]) {
    const mock = fakeGitHub({ count: 1, total: 1 })
    const handler = createTopicProjectsEndpoint({ fetcher: mock.fetcher,
      installationResolver: async () => {
        if (failure === 'removed') throw new ProbeError(
          'Repository is not authorized for this App', 403)
        if (failure === 'suspended') throw new ProbeError(
          'Repository App installation is suspended', 403)
        if (failure === 'limited') throw new ProbeError('API rate limited', 429)
        throw new ProbeError('Permission denied', 403)
      } })
    const response = await handler.fetch(new Request(base))
    assert.equal(response.status, status, failure)
    const body = await response.json()
    if (expected !== null) assert.equal(body.items.length, expected)
    else assert.equal(body.stage, 'installation')
    assert.ok(mock.calls.every(x => x.method === 'GET'))
  }
  const incomplete = fakeGitHub({ incomplete: true })
  const response = await createTopicProjectsEndpoint({
    fetcher: incomplete.fetcher, installationResolver: installed,
  }).fetch(new Request(base))
  assert.equal(response.status, 502)
  assert.equal((await response.json()).stage, 'topic-search')
})

test('#83 source-less pagination keeps exact repository IDs and no source whitelist', async () => {
  const sample = { id: 1, full_name: 'member/project-1',
    html_url: 'https://github.com/member/project-1' }
  const meta = { repository: null,
    config: { topic: 'dsh-plugin', whitelist: false }, allowedRepositories: [] }
  const result = await loadInstalledTopicBatch(meta, async (page, offset) => ({
    page, offset, perPage: 100, totalCount: 1, items: [sample, sample],
    hasNext: false, nextPage: null, nextOffset: null, windowExhausted: false,
  }), new AbortController().signal)
  assert.deepEqual(result.items.map(item => item.id), [1])
  assert.equal(result.ended, true)
  assert.equal(result.cursor, null)
})
