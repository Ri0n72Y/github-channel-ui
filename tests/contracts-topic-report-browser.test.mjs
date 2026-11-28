import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
let vite, createTopicPageApi
before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true } })
  createTopicPageApi = (await vite.ssrLoadModule('/plugins/topic-page/src/service.ts'))
    .createTopicPageApi
})
after(async () => { await vite?.close() })

const route = { owner: 'sample', repo: 'repo' }
const report = { title: 'Fixture report', body: 'Read failed' }
const signal = () => new AbortController().signal

test('Report browser service rejects an invalid created issue link as an uncertain write', async () => {
  let posts=0
  const api=createTopicPageApi(async(url,init)=>{
    assert.equal(url,'/api/topic-report')
    assert.equal(init.method,'POST')
    posts++
    return Response.json({state:'created',issue:{number:71,html_url:'https://evil.example/issues/71'}},{status:201})
  })
  await assert.rejects(api.submitReport(route,report,'proof',signal()),{outcomeUnknown:true})
  assert.equal(posts,1)
})
