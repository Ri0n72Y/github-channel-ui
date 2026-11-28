import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTeamFile, validateMemberInput, appendMemberFile, summarizeReadme,
  previewMarkdown } from '../plugins/repo-home/src/domain.mjs'

const existing=[
  {id:'member-7',name:'Mira',githubUsername:'mira',role:'Maintainer',bio:'Original profile',custom:'retain'},
  {id:'member-2',name:'Ren',links:[{label:'Profile',url:'https://example.org/ren'}]},
]
const file=members=>JSON.stringify({version:1,members})
const website={label:'Website',url:'https://example.org/new'}

test('registration appends normalized data to the actual member document without replacing manual profiles or ordering',()=>{
  const entry=validateMemberInput({name:'  Lin ',githubUsername:'lin',role:' Reviewer ',bio:' ',
    links:[{label:' Website ',url:' https://example.org/new '},{label:'',url:''}]})
  assert.deepEqual(entry,{name:'Lin',githubUsername:'lin',role:'Reviewer',links:[website]})
  const written=appendMemberFile(file(existing),entry,'member-9')
  assert.deepEqual(JSON.parse(written),{version:1,members:[...existing,
    {id:'member-9',name:'Lin',githubUsername:'lin',role:'Reviewer',links:[website]}]})
  assert.equal(parseTeamFile(written).state,'ready')
  const first=appendMemberFile(null,{name:'Lin'},'member-9')
  assert.deepEqual(JSON.parse(first),{version:1,members:[{id:'member-9',name:'Lin'}]})
})

test('a missing member document, an empty team and an invalid document have distinct read and write consequences',()=>{
  assert.deepEqual(parseTeamFile(null),{state:'missing',members:[]})
  assert.deepEqual(parseTeamFile(file([])),{state:'empty',members:[]})
  for(const corrupt of ['{broken',JSON.stringify({version:2,members:[]}),
    file([existing[0],{id:'member-7',name:'Other'}]),
    file([existing[0],{id:'new',name:'Other',githubUsername:'MIRA'}]),
    file([{id:'new',name:'Other',avatarUrl:'javascript:alert(1)'}])]){
    assert.equal(parseTeamFile(corrupt).state,'invalid')
    assert.deepEqual(parseTeamFile(corrupt).members,[])
    assert.throws(()=>appendMemberFile(corrupt,{name:'Lin'},'member-9'))
  }
  assert.throws(()=>appendMemberFile(file(existing),{name:'Lin'},'member-7'),/冲突/)
  assert.throws(()=>appendMemberFile(file(existing),{name:'Lin',githubUsername:'MIRA'},'member-9'),/已经登记/)
})

test('registration accepts the published field capacities and refuses values exceeding them',()=>{
  const maximum={name:'n'.repeat(60),role:'r'.repeat(40),bio:'b'.repeat(280),
    githubUsername:'g'.repeat(39),links:[{label:'w'.repeat(24),url:website.url},website,website]}
  assert.deepEqual(validateMemberInput(maximum),maximum)
  for(const [key,bad] of [['name','n'.repeat(61)],['role','r'.repeat(41)],['bio','b'.repeat(281)],
    ['githubUsername','g'.repeat(40)],['links',[...maximum.links,website]]]){
    assert.throws(()=>validateMemberInput({...maximum,[key]:bad}),undefined,key)
  }
  assert.throws(()=>validateMemberInput({...maximum,links:[{...website,label:'w'.repeat(25)}]}))
})

test('member input rejects unsafe destinations and incomplete link pairs before persistence',()=>{
  for(const change of [{name:' '},{githubUsername:'bad--login'},
    {avatarUrl:'http://example.org/avatar'},{avatarUrl:'https://user:pass@example.org/avatar'},
    {links:[{label:'Website',url:'javascript:alert(1)'}]},
    {links:[{label:'',url:website.url}]},{links:[{label:'Website',url:''}]}])
    assert.throws(()=>validateMemberInput({name:'Lin',...change}))
  assert.deepEqual(validateMemberInput({name:'Lin',avatarUrl:'https://example.org/avatar',links:[website]}),
    {name:'Lin',avatarUrl:'https://example.org/avatar',links:[website]})
})

test('README fallback uses readable prose instead of the repository title, badge, navigation or code',()=>{
  const readme=['# ledger','![build](https://example.org/badge.svg)','## Contents','- [Setup](#setup)',
    '## About','Maintain **shared records** with [documentation](https://example.org).',
    '~~~sh','echo "not a description"','~~~'].join('\n')
  assert.equal(summarizeReadme(readme,'ledger'),'Maintain shared records with documentation.')
  assert.equal(summarizeReadme('# ledger\n![build](https://example.org/badge.svg)','ledger'),'')
})

test('collapsed feed preserves complete Markdown links and media without exposing the hidden continuation',()=>{
  const link='[release](https://example.org/release)'
  const image='![photo](https://example.org/photo.png)'
  const video='@[video](https://example.org/watch)'
  const visible=[link,image,video].join('\n\n')
  const body=visible+'\n\n'+'x'.repeat(1000)+'\n\nprivate continuation'
  const preview=previewMarkdown(body,460)
  assert.ok(preview.startsWith(visible))
  assert.ok(preview.endsWith('…'))
  assert.ok(!preview.includes('private continuation'))
  assert.equal(previewMarkdown(image+'\n\nhidden',100),image+'\n\n…')
  const longLink='[release](https://example.org/'+'a'.repeat(220)+')'
  assert.equal(previewMarkdown(longLink+'\n\nhidden',100),longLink+'\n\n…')
})

test('long unbroken prose obeys the preview budget in both narrow and wide characters',()=>{
  assert.equal(previewMarkdown('A'.repeat(160),160),'A'.repeat(160))
  assert.equal(previewMarkdown('A'.repeat(161),160),'A'.repeat(160)+'\n\n…')
  assert.equal(previewMarkdown('中'.repeat(80),160),'中'.repeat(80))
  assert.equal(previewMarkdown('中'.repeat(81),160),'中'.repeat(80)+'\n\n…')
})
