import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTeamFile, validateMemberInput, appendMemberFile, summarizeReadme,
  previewMarkdown } from '../plugins/repo-home/src/domain.mjs'

const file=members=>JSON.stringify({version:1,members})
const alice={id:'old',name:'Alice',githubUsername:'alice',bio:'Original'}
const link={label:'Website',url:'https://example.org/profile'}

test('member documents preserve ordered data and reject ambiguous identities',()=>{
  assert.deepEqual(parseTeamFile(null),{state:'missing',members:[]})
  assert.deepEqual(parseTeamFile(file([])),{state:'empty',members:[]})
  assert.deepEqual(parseTeamFile(file([alice])),{state:'ready',members:[alice]})
  for(const text of ['{invalid',JSON.stringify({version:2,members:[]}),
    file([alice,{id:'old',name:'Bob'}]),file([alice,{id:'other',name:'Bob',githubUsername:'ALICE'}]),
    file([{id:'bad',name:'Bob',avatarUrl:'javascript:alert(1)'}])]){
    const parsed=parseTeamFile(text)
    assert.equal(parsed.state,'invalid')
    assert.deepEqual(parsed.members,[])
  }
})

test('registration validates input constraints and appends without discarding existing profile data',()=>{
  const input=validateMemberInput({name:'  Bob  ',role:' developer ',bio:' Hi ',
    githubUsername:'bob',links:[link,{label:'',url:''}]})
  assert.deepEqual(input,{name:'Bob',role:'developer',bio:'Hi',githubUsername:'bob',links:[link]})
  assert.deepEqual(parseTeamFile(appendMemberFile(file([alice]),input,'new')),
    {state:'ready',members:[alice,{id:'new',...input}]})
  assert.throws(()=>appendMemberFile(file([alice]),input,'old'),/冲突/)
  assert.throws(()=>appendMemberFile(file([alice]),{name:'Other',githubUsername:'ALICE'},'new'),/已经登记/)
  assert.throws(()=>appendMemberFile('{invalid',input,'new'),/JSON/)
  for(const [field,limit] of [['name',60],['role',40],['bio',280]]){
    assert.equal(validateMemberInput({name:'Bob',[field]:'a'.repeat(limit)})[field].length,limit)
    assert.throws(()=>validateMemberInput({name:'Bob',[field]:'a'.repeat(limit+1)}),/超长/)
  }
  assert.equal(validateMemberInput({name:'Bob',links:[link,link,link]}).links.length,3)
  assert.throws(()=>validateMemberInput({name:'Bob',links:[link,link,link,link]}),/最多/)
  for(const raw of [{name:' '},{name:'Bob',avatarUrl:'http://example.org/avatar'},
    {name:'Bob',avatarUrl:'https://user:pass@example.org/avatar'},
    {name:'Bob',links:[{label:'Bad',url:'javascript:alert(1)'}]},
    {name:'Bob',links:[{label:'',url:link.url}]}]) assert.throws(()=>validateMemberInput(raw))
})

test('README fallback excludes navigation, badges and code while retaining readable prose',()=>{
  const readme='# sample\n![badge](https://example.org/badge.svg)\n## Contents\n- [Navigation](#nav)\n'+
    '## About\nReadable **introduction** with [documentation](https://example.org).\n~~~js\nalert(1)\n~~~'
  assert.equal(summarizeReadme(readme,'sample'),'Readable introduction with documentation.')
  assert.equal(summarizeReadme('# sample\n![badge](https://example.org/badge.svg)','sample'),'')
})

test('collapsed Markdown retains complete ordered media and hides continuation at budget boundaries',()=>{
  for(const [char,capacity] of [['A',160],['中',80]]){
    for(const size of [capacity-1,capacity,capacity+1])
      assert.equal(previewMarkdown(char.repeat(size),160),char.repeat(Math.min(size,capacity))+
        (size>capacity?'\n\n…':''))
  }
  const tokens=['[release](https://example.org/release)','![photo](https://example.org/pic.jpg)',
    '@[video](https://youtu.be/example)']
  const hidden='[hidden](https://example.org/hidden)'
  const preview=previewMarkdown(tokens.join('\n\n')+'\n\n'+'x'.repeat(1000)+'\n\n'+hidden,460)
  let previous=-1
  for(const token of tokens){const index=preview.indexOf(token);assert.ok(index>previous);previous=index}
  assert.ok(!preview.includes(hidden))
  assert.ok(preview.endsWith('…'))
  for(const token of [tokens[1],'[result](https://example.org/'+'a'.repeat(220)+')'])
    assert.equal(previewMarkdown(token+'\n\n'+hidden,100),token+'\n\n…')
})
