import test from 'node:test'
import assert from 'node:assert/strict'
import { createTopicProjectsEndpoint } from '../api/_topic-projects.mjs'

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
})

