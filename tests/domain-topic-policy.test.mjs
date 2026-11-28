import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTopicYaml, validTopicSlug, validTopicRepository, safeTopicCoverUrl,
  readmeFields, loadInstalledTopicBatch } from '../plugins/topic-page/src/domain.mjs'
import { layoutMasonry } from '../plugins/topic-page/src/masonry.mjs'

test('Topic declaration defaults to a closed whitelist and only an explicit false opens it',()=>{
  assert.deepEqual(parseTopicYaml('topic: Review-Day\n'),{topic:'review-day',whitelist:true})
  assert.deepEqual(parseTopicYaml('topic: Review-Day\nwhitelist: false\n'),{topic:'review-day',whitelist:false})
  assert.deepEqual(parseTopicYaml('repository: Collective/Ledger\n','project'),{repository:'collective/ledger'})
  for(const document of ['topic: review\nwhitelist: yes','topic: review\nwhitelist: false\nwhitelist: true',
    'topic: review\nrepository: collective/ledger','topic: review\nunexpected: x'])
    assert.throws(()=>parseTopicYaml(document))
  assert.throws(()=>parseTopicYaml('repository: collective/../ledger','project'))
  assert.equal(validTopicRepository('collective','ledger'),true)
  assert.equal(validTopicRepository('../escape','ledger'),false)
  for(const slug of ['a','review-day','x'.repeat(50)])assert.equal(validTopicSlug(slug),true)
  for(const slug of ['','-review','review-','review_day','review/day','x'.repeat(51)])
    assert.equal(validTopicSlug(slug),false)
})

test('a Topic cover is a trusted HTTPS raster image; a raw repository cover must identify an immutable commit',()=>{
  const cover='https://raw.githubusercontent.com/collective/ledger/'+'a'.repeat(40)+'/poster.webp'
  assert.deepEqual(parseTopicYaml('topic: review\ncover: '+cover),{topic:'review',whitelist:true,cover})
  assert.equal(safeTopicCoverUrl('https://user-images.githubusercontent.com/42/poster.png'),
    'https://user-images.githubusercontent.com/42/poster.png')
  for(const invalid of [cover.replace('a'.repeat(40),'main'),
    cover.replace('raw.githubusercontent.com','raw.githubusercontent.com.evil.invalid'),
    cover.replace('raw.githubusercontent.com','raw.githubusercontent.com@evil.invalid'),
    cover.replace('raw.githubusercontent.com','raw.githubusercontent.com:8443'),
    cover.replace('https:','http:'),cover.replace('.webp','.svg'),cover+'?x=1',cover+'#x',
    cover.replace('/poster','/../poster'),cover.replace('/poster','/%2e%2e/poster'),
    cover+'\u0000','javascript:alert(1)','data:image/png;base64,AA','//raw.githubusercontent.com/a.png'])
    assert.equal(safeTopicCoverUrl(invalid),null,invalid)
  assert.throws(()=>parseTopicYaml('topic: review\ncover: '+cover.replace('a'.repeat(40),'main')))
})

test('Topic README description retains its line breaks and excludes contact metadata',()=>{
  assert.deepEqual(readmeFields('preamble\n# Review day\nFirst line\nSecond line\nemail: team@example.org\ndatetime: 2026-09-18'),
    {title:'Review day',description:'First line\nSecond line',email:'team@example.org',datetime:'2026-09-18'})
  assert.deepEqual(readmeFields('No H1'),{title:'Topic Page',description:'',email:'',datetime:''})
})

const project=(id,name)=>({id,full_name:name,html_url:'https://github.com/'+name})
const metadata={repository:{full_name:'collective/ledger'},config:{whitelist:true},
  allowedRepositories:['members/a','members/b','members/c']}
const first=[project(1,'collective/ledger'),project(2,'members/a'),project(3,'outside/x')]
const second=[project(2,'MEMBERS/A'),project(4,'members/b'),project(5,'members/c')]

test('a sparse whitelist advances the actual cursor, excludes the source and duplicate IDs, and preserves the remaining page',async()=>{
  const calls=[]
  const pages=[
    {page:1,offset:0,perPage:100,items:first,hasNext:true,nextPage:1,nextOffset:25,windowExhausted:false},
    {page:1,offset:25,perPage:100,items:second,hasNext:true,nextPage:2,nextOffset:0,windowExhausted:false},
  ]
  const result=await loadInstalledTopicBatch(metadata,async(page,offset)=>{
    calls.push([page,offset])
    const response=pages[calls.length-1]
    if(!response)throw Error('Unexpected page')
    return response
  },new AbortController().signal,{page:1,offset:0},[4],2)
  assert.deepEqual(calls,[[1,0],[1,25]])
  assert.deepEqual(result.items.map(p=>p.id),[2,5])
  assert.deepEqual(result.cursor,{page:2,offset:0})
  assert.equal(result.ended,false)
  assert.equal(result.windowExhausted,false)
})

test('Masonry keeps existing cards stationary when appending and only shifts cards below a resized card in the same column',()=>{
  const keys=['a','b','c','d','e']
  const heights=[100,180,90,70,60]
  const input={keys,heights,width:500,gap:10}
  const before=layoutMasonry(input)
  // At a measured 500px width the approved two-column layout has 245px cards.
  assert.deepEqual(before.positions,[
    {left:0,top:0,width:245},{left:255,top:0,width:245},
    {left:0,top:110,width:245},{left:255,top:190,width:245},{left:0,top:210,width:245},
  ])
  const appended=layoutMasonry({...input,keys:[...keys,'f'],heights:[...heights,40],previous:before})
  assert.deepEqual(appended.positions.slice(0,5),before.positions)
  assert.deepEqual(appended.positions[5],{left:255,top:270,width:245})
  const resized=layoutMasonry({...input,heights:[140,180,90,70,60],previous:before})
  assert.deepEqual(resized.positions,[
    {left:0,top:0,width:245},{left:255,top:0,width:245},
    {left:0,top:150,width:245},{left:255,top:190,width:245},{left:0,top:250,width:245},
  ])
})

test('Masonry geometry contains every card and does not overlap across measured viewport widths',()=>{
  const keys=['a','b','c','d','e','f','g']
  const heights=[100,70,240,25,310,50,95]
  for(const width of [320,500,700,900,1200]){
    const result=layoutMasonry({keys,heights,width})
    assert.equal(result.positions.length,keys.length)
    for(const [i,box] of result.positions.entries()){
      assert.ok(box.width>0&&box.left>=0&&box.left+box.width<=width+1e-8)
      assert.ok(box.top>=0&&box.top+heights[i]<=result.height)
      for(const [j,other] of result.positions.slice(0,i).entries()){
        assert.ok(box.left+box.width<=other.left||other.left+other.width<=box.left||
          box.top+heights[i]<=other.top||other.top+heights[j]<=box.top)
      }
    }
  }
  assert.equal(layoutMasonry({keys:[],heights:[],width:320}).height,0)
  assert.throws(()=>layoutMasonry({keys,heights,width:0}),RangeError)
  assert.throws(()=>layoutMasonry({keys,heights:[],width:500}),RangeError)
})
