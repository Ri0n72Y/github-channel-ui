import test from 'node:test'
import assert from 'node:assert/strict'
import { loadIssueContent } from '../plugins/issue-detail/src/load-issue.mjs'

const issue = (number = 1, labels = [], state = 'open') => ({
  number, title: 'Issue ' + number, state, labels, comments: 1,
})
const labour = id => ({ id, body: '```yaml\nlabour:\n  work: issue record\n  hr: ~0.5\n```' })

function fakeApi(value, options = {}) {
  const calls = []
  const service = {
    async getIssue(owner, repo, number, signal) {
      calls.push('issue:' + owner + '/' + repo + '/' + number)
      if (signal.aborted) throw new Error('aborted')
      if (options.fail) throw options.fail
      return { ...value }
    },
    async getComments(owner, repo, number, page, signal) {
      calls.push('comments:' + owner + '/' + repo + '/' + number + '/' + page)
      if (signal.aborted) throw new Error('aborted')
      return { items: [labour(number)], hasMore: false }
    },
    async getConfig() {
      calls.push('config')
      throw Object.assign(new Error('Missing repository config'), { status: 422 })
    },
  }
  return { service, calls }
}

test('generic Issue loading does not depend on Config', async () => {
  for (const labels of [[], ['channel:discussion', 'channel:other']]) {
    const { service, calls } = fakeApi(issue(28, labels))
    const loaded = await loadIssueContent(service, 'sample', 'repo', 28, new AbortController().signal)
    assert.equal(loaded.issue.number, 28)
    assert.deepEqual(loaded.first,{items:[labour(28)],hasMore:false})
    assert.deepEqual(calls, ['issue:sample/repo/28', 'comments:sample/repo/28/1'])
  }
})

test('wrong number, Pull Request and unsupported state do not request comments', async () => {
  for (const object of [issue(99), { ...issue(28), pull_request: {} }, issue(28, [], 'draft')]) {
    const { service, calls } = fakeApi(object)
    assert.equal(await loadIssueContent(service, 'sample', 'repo', 28,
      new AbortController().signal), null)
    assert.deepEqual(calls, ['issue:sample/repo/28'])
  }
})

test('GitHub errors preserve 404, 403, 429 and 502 without Config conversion', async () => {
  for (const status of [404, 403, 429, 502]) {
    const failure = Object.assign(new Error('GitHub error'), { status })
    const { service, calls } = fakeApi(issue(), { fail: failure })
    await assert.rejects(loadIssueContent(service, 'sample', 'repo', 1,
      new AbortController().signal), error => error === failure)
    assert.deepEqual(calls, ['issue:sample/repo/1'])
  }
})

test('Issue loader forwards cancellation to its read dependency and stops before comments', async () => {
  const controller = new AbortController()
  const delayed = {
    getIssue(owner, repo, number, signal) {
      assert.deepEqual([owner, repo, number], ['old-owner','old-repo',1])
      assert.equal(signal, controller.signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
      })
    },
    getComments() { throw new Error('old target comments must not be requested') },
    getConfig() { throw new Error('config must not be requested') },
  }
  const pending = loadIssueContent(delayed, 'old-owner', 'old-repo', 1, controller.signal)
  controller.abort()
  await assert.rejects(pending, /request aborted/)

})
