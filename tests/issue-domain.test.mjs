import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLabourComment, formatLabourComment, summarizeIssueComments,
  parseIssueLabels, validIssueTarget } from '../plugins/issue-detail/src/domain.mjs'

import { createQuoteReply, buildCommentReply, commentPermalink } from '../plugins/issue-detail/src/quote-reply.mjs'

const sha = 'a'.repeat(40)
const labour = (hours, tail = '') => '```yaml\nlabour:\n  work: 测试工时\n  hr: ~' +
  hours + tail + '\n```'
const comment = (id, body) => ({ id, body, created_at: '2026-11-01T00:00:00Z',
  html_url: 'https://github.com/example/repo/issues/1#issuecomment-' + id,
  user: { login: 'worker' } })

test('labour hours accept positive safe half-hour units and reject adjacent invalid values', () => {
  const max = Number.MAX_SAFE_INTEGER / 2
  for (const hours of [0.5, 1, 1.5, max]) {
    for (const suffix of ['', 'h']) assert.equal(parseLabourComment(labour(hours, suffix))?.hours, hours)
    assert.equal(parseLabourComment(formatLabourComment({work:'x',hr:hours}))?.hours,hours)
  }
  for (const hours of [-0.5, 0, 0.25, 0.75, 1.25, max + 0.5]) {
    assert.equal(parseLabourComment(labour(hours)),null)
    assert.throws(()=>formatLabourComment({work:'x',hr:hours}),/Invalid labour record/)
  }
  for (const hr of [NaN, Infinity, '0.5']) assert.throws(()=>formatLabourComment({work:'x',hr}),/Invalid labour record/)
})

test('§9.4 multiline work, outcome, commits and RFC 3339 timestamps round-trip', () => {
  const body = formatLabourComment({ work: '第一行\n第二行', hr: 1.5,
    outcome: '结果已验证', commits: [sha], start: '2026-10-22T09:00:00Z',
    end: '2026-10-22T11:00:00Z' })
  assert.deepEqual(parseLabourComment(body), { work: '第一行\n第二行', hours: 1.5,
    outcome: '结果已验证', commits: [sha],
    startEnd: { start: '2026-10-22T09:00:00Z', end: '2026-10-22T11:00:00Z' } })
})

test('invalid YAML, extra fields, bad hour steps and dates remain ordinary discussion', () => {
  for (const body of [
    labour('abc'), labour(1, 'hours'),
    labour(1,'\n  hr: ~2'),
    '```yaml\nlabour:\n  work: x\n  hr: ~1h\n  author: forged\n```',
    'prefix\n' + labour(1),
    '```yaml\nlabour:\n  hr: ~1h\n```',
    '```yaml\nlabour:\n  work: x\n  commits:\n    - not-a-sha\n  hr: ~1h\n```',
    '```yaml\nlabour:\n  work: x\n  hr: ~1h\n  start-end:\n    start: "2026-10-22T11:00:00Z"\n    end: "2026-10-22T09:00:00Z"\n```',
  ]) assert.equal(parseLabourComment(body), null, body)
  const result = summarizeIssueComments([comment(1, labour(0.3)), comment(2, '普通聊天')], true)
  assert.equal(result.records.length, 0)
  assert.deepEqual(result.discussion.map(c=>c.id),[1,2])
  assert.deepEqual(result.invalidCandidates,[1])
  assert.equal(result.complete, false)
})

test('one comment with multiple SHAs is one labour record; repeated SHA conflicts exclude hours', () => {
  const a = formatLabourComment({ work: '记录 A', hr: 2, commits: [sha, 'b'.repeat(40)] })
  const b = formatLabourComment({ work: '记录 B', hr: 3, commits: [sha] })
  const c = formatLabourComment({ work: '无 Commit', hr: 0.5 })
  const independent=[comment(1,a),comment(3,c),comment(3,c),comment(4,'discussion')]
  for(const complete of [true,false]){
    const sum=summarizeIssueComments(independent,complete)
    assert.deepEqual(sum.records.map(r=>r.comment.id),[1,3])
    assert.equal(sum.hours,2.5)
    assert.deepEqual(sum.conflicts,[])
    assert.deepEqual(sum.discussion.map(c=>c.id),[4])
    assert.equal(sum.complete,complete)
  }
  const result = summarizeIssueComments([comment(1, a), comment(2, b),
    comment(3, c), comment(3, c)], true)
  assert.equal(result.records.length, 3)
  assert.deepEqual(result.conflicts, [sha])
  assert.equal(result.records.filter(r => r.conflicted).length, 2)
  assert.equal(result.hours, 0.5)
  assert.equal(result.complete, false)
})

test('Issue target rejects invalid numbers and Channel labels parse from supported YAML', () => {
  for (const number of ['1', String(Number.MAX_SAFE_INTEGER)]) assert.equal(validIssueTarget('sample','repo',number),true)
  for (const number of ['0', '-1', '01', '1.5', 'abc', '9007199254740992']) {
    assert.equal(validIssueTarget('sample', 'repo', number), false)
  }
  assert.deepEqual(parseIssueLabels('channel: [wishlist, discussion]'),
    ['channel:wishlist', 'channel:discussion'])
  assert.deepEqual(parseIssueLabels('namespaces:\n  channel:\n    - discussion\n'),
    ['channel:discussion'])

})

test('external fenced YAML preserves block and inline text without relying on the formatter',()=>{
  const block='\x60\x60\x60yaml\nlabour:\n  work: |\n    first line\n    second line\n  hr: ~0.5\n  outcome: |\n    [result](https://example.org/result)\n\x60\x60\x60'
  const inline='\x60\x60\x60yml\nlabour:\n  work: single line\n  hr: ~1\n  outcome: [result](https://example.org/result)\n\x60\x60\x60'
  assert.deepEqual(parseLabourComment(block),{work:'first line\nsecond line',hours:0.5,
    outcome:'[result](https://example.org/result)',commits:[],startEnd:null})
  assert.deepEqual(parseLabourComment(inline),{work:'single line',hours:1,
    outcome:'[result](https://example.org/result)',commits:[],startEnd:null})
})

test('#69 quote replies bind permalink to owner/repo/issue/comment and never count quoted labour',()=>{
 const target='https://github.com/example/repo/issues/1#issuecomment-1'
 assert.equal(commentPermalink(target,'example','repo',1,1),target)
 assert.equal(commentPermalink('https://github.com/EXAMPLE/REPO/issues/1#issuecomment-1','example','repo',1,1),target)
 for(const url of [null,'javascript:alert(1)',target+'?x',target+'\n',
  target.replace('github.com','github.com.evil.invalid'),target.replace('github.com','evil@github.com'),
  target.replace('/example/','/other/'),target.replace('/repo/','/other/'),
  target.replace('/issues/1','/issues/2'),target.replace('issuecomment-1','issuecomment-2'),
  target.replace('/issues/','/pull/'),target.replace('/repo/','/%72epo/')])
  assert.equal(commentPermalink(url,'example','repo',1,1),null,String(url))
 for(const original of [labour(1),labour(0.3),'\x60\x60\x60yaml\nlabour:\n  hr: ~1\n\x60\x60\x60',
  '@alice <script>bad</script>\r\n\r\nother']){
  const q=createQuoteReply(comment(1,original),'example','repo',1)
  const reply=buildCommentReply('reply',q)
  assert.ok(reply.startsWith('回复 [worker]('+target+')\n\n> '))
  const lines=reply.split('\n').slice(2,-2)
  assert.ok(lines.every(line=>line.startsWith('> ')))
  assert.doesNotMatch(reply,/(?:^|\n)labour:/)
  if(original.includes('<script>')){
   assert.ok(reply.includes('\\<script>'))
   assert.doesNotMatch(reply,/(^|[^\\])<script>/)
  }
  const result=summarizeIssueComments([comment(10,labour(2)),comment(11,reply)],true)
  assert.equal(result.hours,2);assert.equal(result.records.length,1)
  assert.deepEqual(result.invalidCandidates,[]);assert.equal(result.complete,true)
 }
 const forged=createQuoteReply({...comment(1,'@person <img>'),user:{login:'x](javascript:alert(1))\n@evil'},
   html_url:'https://github.com/example/repo/issues/9#issuecomment-1'},'example','repo',1)
 const reply=buildCommentReply('my draft',forged)
 assert.equal(forged.sourceUrl,null)
 assert.doesNotMatch(reply,/\]\(javascript:/)
 assert.ok(reply.includes('\\@person'))
 assert.ok(reply.includes('\\<img>'))
 for(const size of [999,1000,1001]){
  const bounded=createQuoteReply(comment(1,'😀'.repeat(size)),'example','repo',1)
  assert.equal(bounded.excerpt,'😀'.repeat(Math.min(size,1000)))
  assert.equal(bounded.truncated,size>1000)
  assert.equal(buildCommentReply('draft',bounded).includes('引用已截取'),size>1000)
 }
 for(const size of [11,12,13]){
  const lines=Array.from({length:size},(_,i)=>'line '+i)
  const bounded=createQuoteReply(comment(1,lines.join('\n')),'example','repo',1)
  assert.equal(bounded.excerpt,lines.slice(0,12).join('\n'))
  assert.equal(bounded.truncated,size>12)
 }
})
