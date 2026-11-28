import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'
import { loadInstalledTopicBatch, validTopicSlug } from '../plugins/topic-page/src/domain.mjs'

test('#83 production refuses all source-less, mixed and ambiguous Topic requests before GitHub',async()=>{
  let calls=0
  const endpoint=createTopicProjectsEndpoint({fetcher:async()=>{calls++;throw Error('unexpected GitHub read')}})
  for(const suffix of ['?topic=dsh-plugin','?topic=bad_slug','?topic=',
    '?topic=dsh-plugin&topic=other','?topic=dsh-plugin&owner=sample&repo=repo',
    '?owner=sample&repo=repo&topic=dsh-plugin','?owner=sample&owner=other&repo=repo',
    '?owner=sample&repo=repo&repo=other','?owner=sample&repo=repo&page=1&page=2',
    '?owner=sample&repo=repo&offset=0&offset=25','?owner=sample','']){
    const result=await endpoint.fetch(new Request('https://labour.test/api/topic-projects'+suffix))
    assert.equal(result.status,400,suffix)
    assert.equal((await result.json()).stage,'route',suffix)
  }
  assert.equal(calls,0)
  for(const value of ['bad_slug','-bad','bad-','','a'.repeat(51)])assert.equal(validTopicSlug(value),false)
  assert.equal(validTopicSlug('dsh-plugin'),true)
})

test('#83 Playground source-less pagination keeps exact repository IDs and no source whitelist', async () => {
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
