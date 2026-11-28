import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLabourComment, formatLabourComment, summarizeIssueComments,
  validIssueForPage, validIssueTarget, validChannelIssue, parseIssueLabels } from '../plugins/issue-detail/src/domain.mjs'
import { commentPermalink, createQuoteReply, buildCommentReply } from '../plugins/issue-detail/src/quote-reply.mjs'

const fence = '\x60\x60\x60'
const record = (...lines) => [fence+'yaml', 'labour:', ...lines, fence].join('\n')
const at = '2026-09-18T09:00:00Z'
const until = '2026-09-18T09:30:00Z'
const sha = '0123456789abcdef0123456789abcdef01234567'
const item = (id, body) => ({id, body, user:{login:'mira'},
  html_url:'https://github.com/collective/ledger/issues/8#issuecomment-'+id})

test('imported labour uses the subjective half-hour estimate rather than the elapsed interval',()=>{
  const body = record('  work: |','    Audit ledger','    Reconcile records',
    '  commits:','    - '+sha.toUpperCase(),'  outcome: Verified entries','  hr: ~2.5h',
    '  start-end:','    start: "'+at+'"','    end: "'+until+'"')
  assert.deepEqual(parseLabourComment(body),{
    work:'Audit ledger\nReconcile records',hours:2.5,commits:[sha],
    outcome:'Verified entries',startEnd:{start:at,end:until},
  })
})

test('the smallest valid estimate and largest safe half-hour count are accepted; invalid hours are refused on both boundaries',()=>{
  const last = Number.MAX_SAFE_INTEGER / 2
  for(const hours of [0.5,last]){
    assert.equal(parseLabourComment(record('  work: Audit','  hr: ~'+hours)).hours,hours)
    assert.equal(formatLabourComment({work:'Audit',hr:hours}),
      record('  work: |','    Audit','  hr: ~'+hours+'h'))
  }
  for(const hours of [-0.5,0,0.25,1.25,last+0.5]){
    assert.equal(parseLabourComment(record('  work: Audit','  hr: ~'+hours)),null,String(hours))
    assert.throws(()=>formatLabourComment({work:'Audit',hr:hours}),/Invalid labour record/)
  }
  for(const hr of ['0.5',NaN,Infinity])assert.throws(()=>formatLabourComment({work:'Audit',hr}))
})

test('a new registration writes an independently specified complete GitHub comment',()=>{
  const submitted={work:' Audit\nReconcile ',hr:1.5,outcome:'Verified',
    commits:[sha.toUpperCase()],start:at,end:until}
  assert.equal(formatLabourComment(submitted),record('  work: |','    Audit','    Reconcile',
    '  commits:','    - '+sha,'  outcome: |','    Verified','  hr: ~1.5h',
    '  start-end:','    start: "'+at+'"','    end: "'+until+'"'))
  for(const change of [{work:' '},{commits:[sha,sha.toUpperCase()]},{commits:['bad']},
    {start:until,end:at},{end:''}]){
    assert.throws(()=>formatLabourComment({...submitted,...change}),/Invalid labour record/)
  }
})

test('ambiguous or malformed candidate comments remain discussion and make the total incomplete',()=>{
  const valid=record('  work: Audit','  hr: ~1')
  const invalid=[
    record('  hr: ~1'),
    record('  work: Audit','  hr: ~1','  hr: ~3'),
    record('  work: Audit','  hr: ~1','  author: forged'),
    record('  work: Audit','  hr: ~abc'),
    record('  work: Audit','  hr: ~1hours'),
    record('  work: Audit','  hr: ~1','  commits:','    - bad'),
    record('  work: Audit','  hr: ~1','  commits:','    - '+sha,'    - '+sha.toUpperCase()),
    record('  work: Audit','  hr: ~1','  start-end:','    start: '+until,'    end: '+at),
    'copied example\n'+valid,
  ]
  for(const [index,body] of invalid.entries()){
    const result=summarizeIssueComments([item(1,valid),item(2,body),item(3,'ordinary discussion')],true)
    assert.equal(result.hours,1,'invalid candidate '+index)
    assert.deepEqual(result.records.map(row=>row.comment.id),[1])
    assert.deepEqual(result.discussion.map(row=>row.id),[2,3])
    assert.deepEqual(result.invalidCandidates,[2])
    assert.equal(result.complete,false)
  }
})

test('the labour total excludes every owner of a conflicting commit and counts duplicate comment IDs once',()=>{
  const first=item(101,record('  work: Review','  hr: ~2','  commits:','    - '+sha))
  const second=item(102,record('  work: Implement','  hr: ~4','  commits:','    - '+sha.toUpperCase()))
  const independent=item(103,record('  work: Discuss','  hr: ~0.5'))
  const ordinary=item(104,'Decision recorded')
  const partial=summarizeIssueComments([first,independent,independent,ordinary],false)
  assert.equal(partial.hours,2.5)
  assert.equal(partial.complete,false)
  assert.equal(summarizeIssueComments([first,independent,ordinary],true).complete,true)
  const result=summarizeIssueComments([first,second,independent,independent,ordinary],true)
  assert.deepEqual(result.records.map(row=>[row.comment.id,row.conflicted]),[[101,true],[102,true],[103,false]])
  assert.deepEqual(result.conflicts,[sha])
  assert.deepEqual(result.discussion,[ordinary])
  assert.equal(result.hours,0.5)
  assert.equal(result.complete,false)
})

test('ordinary Issue identity is independent of Channel assignment',()=>{
  for(const state of ['open','closed']){
    assert.equal(validIssueForPage({number:8,state,labels:[]}),true)
    assert.equal(validIssueForPage({number:8,state,labels:['channel:a','channel:b']}),true)
  }
  for(const issue of [null,{number:0,state:'open'},{number:1.5,state:'open'},
    {number:8,state:'draft'},{number:8,state:'open',pull_request:{}}])
    assert.equal(validIssueForPage(issue),false)
  assert.equal(validIssueTarget('collective','ledger','8'),true)
  assert.equal(validIssueTarget('collective','ledger','9007199254740991'),true)
  for(const n of ['0','08','-1','1.5','9007199254740992'])
    assert.equal(validIssueTarget('collective','ledger',n),false)
  for(const [owner,repo] of [['-org','ledger'],['a/b','ledger'],['org','..']])
    assert.equal(validIssueTarget(owner,repo,'8'),false)
})

test('legacy Channel membership accepts exactly one declared label',()=>{
  const labels=parseIssueLabels('namespaces:\n  channel: [Review, planning]\n')
  assert.deepEqual(labels,['channel:review','channel:planning'])
  assert.deepEqual(parseIssueLabels('channel:\n  - review\n'),['channel:review'])
  assert.throws(()=>parseIssueLabels('channel: [one]\nnamespaces:\n  channel: [two]'),/Ambiguous/)
  for(const [tags,expected] of [[['CHANNEL:REVIEW'],true],[[],false],
    [['channel:other'],false],[['channel:review','channel:other'],false]])
    assert.equal(validChannelIssue({number:8,state:'open',labels:tags},labels),expected)
})

test('a quoted labour registration becomes ordinary discussion rather than an additional registration',()=>{
  const original=item(20,record('  work: Audit','  hr: ~1.5'))
  const quote=createQuoteReply(original,'collective','ledger',8)
  const reply=buildCommentReply('Confirmed',quote)
  assert.equal(reply,'回复 [mira](https://github.com/collective/ledger/issues/8#issuecomment-20)\n\n'+
    '> '+fence+'yaml\n> labour:\n>   work: Audit\n>   hr: ~1.5\n> '+fence+'\n\nConfirmed')
  const summary=summarizeIssueComments([original,item(21,reply)],true)
  assert.equal(summary.hours,1.5)
  assert.deepEqual(summary.discussion.map(row=>row.id),[21])
  assert.equal(summary.complete,true)
})

test('a reply links only to its own repository, issue and comment and escapes untrusted text',()=>{
  const exact='https://github.com/collective/ledger/issues/8#issuecomment-20'
  assert.equal(commentPermalink(exact,'collective','ledger',8,20),exact)
  for(const wrong of [
    'https://github.com/elsewhere/ledger/issues/8#issuecomment-20',
    'https://github.com/collective/other/issues/8#issuecomment-20',
    'https://github.com/collective/ledger/issues/9#issuecomment-20',
    'https://github.com/collective/ledger/issues/8#issuecomment-21',
    exact.replace('github.com','github.com.evil.invalid'),exact.replace('github.com','user@github.com'),
    exact.replace('/issues/','/pull/'),exact+'?x',exact+'\n',exact.replace('ledger','%6cedger'),
  ])assert.equal(commentPermalink(wrong,'collective','ledger',8,20),null,wrong)
  const untrusted=createQuoteReply({...item(20,'@staff <script>'),
    user:{login:'x](javascript:alert(1))'},html_url:'https://evil.invalid'},'collective','ledger',8)
  const reply=buildCommentReply('Review',untrusted)
  assert.equal(untrusted.sourceUrl,null)
  assert.ok(reply.includes('\\@staff \\<script>'))
  assert.doesNotMatch(reply,/\]\(javascript:|(^|[^\\])<script>/)
})

test('quote excerpt limits preserve whole Unicode code points and lines',()=>{
  const exact='😀'.repeat(1000)
  for(const [body,expected,truncated] of [[exact,exact,false],[exact+'Z',exact,true],
    [Array(12).fill('entry').join('\n'),Array(12).fill('entry').join('\n'),false],
    [Array(13).fill('entry').join('\n'),Array(12).fill('entry').join('\n'),true]]){
    const quote=createQuoteReply(item(20,body),'collective','ledger',8)
    assert.equal(quote.excerpt,expected)
    assert.equal(quote.truncated,truncated)
    assert.equal(buildCommentReply('OK',quote).includes('引用已截取'),truncated)
  }
})
