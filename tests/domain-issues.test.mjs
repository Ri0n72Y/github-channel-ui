import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLabourComment, formatLabourComment, summarizeIssueComments,
  validIssueForPage, validChannelIssue, validIssueTarget, parseIssueLabels } from '../plugins/issue-detail/src/domain.mjs'
import { commentPermalink, createQuoteReply, buildCommentReply } from '../plugins/issue-detail/src/quote-reply.mjs'

const sha = 'a'.repeat(40)
const labour = (hours, extra = '') => '\x60\x60\x60yaml\nlabour:\n  work: review\n  hr: ~' + hours + extra + '\n\x60\x60\x60'
const comment = (id, body) => ({ id, body, user: { login: 'worker' },
  html_url: 'https://github.com/sample/repo/issues/7#issuecomment-' + id })

test('external records and new submissions require positive safe half-hour units', () => {
  const upper = Number.MAX_SAFE_INTEGER / 2
  for (const hr of [0.5, 1, 1.5, upper]) {
    assert.equal(parseLabourComment(labour(hr))?.hours, hr)
    assert.equal(parseLabourComment(labour(hr, 'h'))?.hours, hr)
    assert.equal(parseLabourComment(formatLabourComment({ work: 'review', hr }))?.hours, hr)
  }
  for (const hr of [-0.5, 0, 0.25, 0.75, upper + 0.5]) {
    assert.equal(parseLabourComment(labour(hr)), null)
    assert.throws(() => formatLabourComment({ work: 'review', hr }), /Invalid labour record/)
  }
  for (const hr of [NaN, Infinity, '0.5']) {
    assert.throws(() => formatLabourComment({ work: 'review', hr }), /Invalid labour record/)
  }
})

test('externally authored labour preserves text, commit identity and timestamps', () => {
  const external = '\x60\x60\x60yaml\nlabour:\n  work: |\n    first\n    second\n  commits:\n    - '+sha.toUpperCase()+
    '\n  outcome: [result](https://example.org/result)\n  hr: ~1.5h\n  start-end:\n    start: "2026-11-01T09:00:00Z"\n    end: "2026-11-01T11:00:00Z"\n\x60\x60\x60'
  const expected = { work: 'first\nsecond', hours: 1.5, commits: [sha],
    outcome: '[result](https://example.org/result)', startEnd: {
      start: '2026-11-01T09:00:00Z', end: '2026-11-01T11:00:00Z' } }
  assert.deepEqual(parseLabourComment(external), expected)
  assert.deepEqual(parseLabourComment(formatLabourComment({ work: expected.work, hr: 1.5,
    commits: [sha], outcome: expected.outcome, ...expected.startEnd })), expected)
})

test('malformed or ambiguous labour contributes no hours and prevents a complete summary', () => {
  const invalid = [
    labour('abc'), labour(1, 'hours'), labour(1, '\n  hr: ~2'),
    labour(1, '\n  author: forged'), labour(1, '\n  commits:\n    - invalid'),
    labour(1, '\n  commits:\n    - '+sha+'\n    - '+sha.toUpperCase()),
    labour(1, '\n  start-end:\n    start: "2026-11-01T11:00:00Z"\n    end: "2026-11-01T09:00:00Z"'),
    labour(1).replace('  work: review\n', ''), 'prefix\n'+labour(1),
  ]
  for (const body of invalid) assert.equal(parseLabourComment(body), null, body)
  const result = summarizeIssueComments([comment(1, invalid[2]), comment(2, 'discussion')], true)
  assert.equal(result.hours, 0)
  assert.deepEqual(result.records, [])
  assert.deepEqual(result.discussion.map(c => c.id), [1,2])
  assert.deepEqual(result.invalidCandidates, [1])
  assert.equal(result.complete, false)
})

test('labour totals deduplicate comments and exclude all owners of a conflicting commit', () => {
  const a = comment(1, labour(2, '\n  commits:\n    - '+sha+'\n    - '+'b'.repeat(40)))
  const b = comment(2, labour(3, '\n  commits:\n    - '+sha.toUpperCase()))
  const c = comment(3, labour(0.5))
  for (const complete of [true,false]) {
    const result = summarizeIssueComments([a,c,c,comment(4,'discussion')], complete)
    assert.deepEqual(result.records.map(x=>x.comment.id), [1,3])
    assert.equal(result.hours, 2.5)
    assert.equal(result.complete, complete)
  }
  const result = summarizeIssueComments([a,b,c,c], true)
  assert.deepEqual(result.conflicts, [sha])
  assert.deepEqual(result.records.filter(x=>x.conflicted).map(x=>x.comment.id), [1,2])
  assert.equal(result.hours, 0.5)
  assert.equal(result.complete, false)
})

test('generic Issue visibility is independent of Channel assignment', () => {
  for (const state of ['open','closed']) {
    for (const labels of [[], ['channel:discussion','channel:other']]) {
      assert.equal(validIssueForPage({number:1,state,labels}),true)
    }
  }
  for (const value of [null,{number:1,state:'draft'},{number:1,state:'open',pull_request:{}},
    {number:0,state:'open'},{number:1.5,state:'open'}]) assert.equal(validIssueForPage(value),false)
  for (const n of ['1',String(Number.MAX_SAFE_INTEGER)]) assert.equal(validIssueTarget('sample','repo',n),true)
  for (const n of ['0','01','-1','1.5','9007199254740992']) assert.equal(validIssueTarget('sample','repo',n),false)
  for (const [owner,repo] of [['-owner','repo'],['a/b','repo'],['owner','..']])
    assert.equal(validIssueTarget(owner,repo,'1'),false)
})

test('Channel membership requires one configured tag, not merely a valid Issue', () => {
  const labels = parseIssueLabels('namespaces:\n  channel: [Discussion, wishlist]\n')
  assert.deepEqual(labels,['channel:discussion','channel:wishlist'])
  assert.deepEqual(parseIssueLabels('channel:\n  - discussion\n'),['channel:discussion'])
  assert.throws(()=>parseIssueLabels('channel: [one]\nnamespaces:\n  channel: [two]'),/Ambiguous/)
  const record = names => ({number:1,state:'open',labels:names})
  assert.equal(validChannelIssue(record(['CHANNEL:DISCUSSION']),labels),true)
  for (const names of [[],['channel:unknown'],['channel:discussion','channel:unknown']])
    assert.equal(validChannelIssue(record(names),labels),false)
})

test('quoted replies bind the source permalink and cannot create extra labour or executable markup', () => {
  const url = 'https://github.com/sample/repo/issues/7#issuecomment-1'
  assert.equal(commentPermalink(url,'sample','repo',7,1),url)
  for (const other of [url.replace('github.com','github.com.evil.invalid'),
    url.replace('github.com','user@github.com'),url.replace('/sample/','/other/'),
    url.replace('/repo/','/other/'),url.replace('/7#','/8#'),url.replace('-1','-2'),
    url.replace('/issues/','/pull/'),url+'?x',url+'\n',url.replace('/repo/','/%72epo/')])
    assert.equal(commentPermalink(other,'sample','repo',7,1),null,other)
  const reply = buildCommentReply('Thanks',createQuoteReply(comment(1,labour(2)), 'sample','repo',7))
  const result = summarizeIssueComments([comment(1,labour(2)),comment(2,reply)],true)
  assert.equal(result.hours,2)
  assert.deepEqual(result.discussion.map(c=>c.id),[2])
  assert.equal(result.complete,true)
  const untrusted = createQuoteReply({...comment(1,'@someone <script>'),
    user:{login:'x](javascript:alert(1))'},html_url:'https://evil.invalid'},'sample','repo',7)
  const safe = buildCommentReply('Thanks',untrusted)
  assert.equal(untrusted.sourceUrl,null)
  assert.doesNotMatch(safe,/\]\(javascript:|(^|[^\\])<script>/)
  assert.ok(safe.includes('\\@someone'))
})

test('reply excerpt preserves code points and lines at both truncation limits', () => {
  for (const n of [999,1000,1001]) {
    const quote = createQuoteReply(comment(1,'😀'.repeat(n)),'sample','repo',7)
    assert.equal(quote.excerpt,'😀'.repeat(Math.min(n,1000)))
    assert.equal(quote.truncated,n>1000)
    assert.equal(buildCommentReply('draft',quote).includes('引用已截取'),n>1000)
  }
  for (const n of [11,12,13]) {
    const lines = Array.from({length:n},(_,i)=>'line '+i)
    const quote = createQuoteReply(comment(1,lines.join('\n')),'sample','repo',7)
    assert.equal(quote.excerpt,lines.slice(0,12).join('\n'))
    assert.equal(quote.truncated,n>12)
  }
})
