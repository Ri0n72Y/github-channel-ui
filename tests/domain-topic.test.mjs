import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTopicYaml, readmeFields, validTopicSlug, validTopicRepository,
  safeTopicCoverUrl, accumulateTopicProjects } from '../plugins/topic-page/src/domain.mjs'
import { layoutMasonry } from '../plugins/topic-page/src/masonry.mjs'

test('Topic and project declarations validate identifiers without broadening the default whitelist',()=>{
  assert.deepEqual(parseTopicYaml('topic: LabourChain\n'),{topic:'labourchain',whitelist:true})
  assert.deepEqual(parseTopicYaml('topic: labourchain\nwhitelist: false\n'),{topic:'labourchain',whitelist:false})
  assert.deepEqual(parseTopicYaml('repository: Me/Repo\n','project'),{repository:'me/repo'})
  for(const source of ['topic: abc\nother: unsafe','topic: abc\nwhitelist: yes',
    'topic: abc\nwhitelist: false\nwhitelist: false','topic: abc\nrepository: me/repo'])
    assert.throws(()=>parseTopicYaml(source))
  assert.throws(()=>parseTopicYaml('repository: me/../repo','project'))
  for(const value of ['a','a'.repeat(50)])assert.equal(validTopicSlug(value),true)
  for(const value of ['','a-','a'.repeat(51),'a/b'])assert.equal(validTopicSlug(value),false)
  assert.equal(validTopicRepository('sample','repo'),true)
  assert.equal(validTopicRepository('../escape','repo'),false)
})

test('configured cover requires a trusted direct image URL and immutable raw repository reference',()=>{
  const url='https://raw.githubusercontent.com/sample/repo/'+'a'.repeat(40)+'/poster.png'
  assert.equal(safeTopicCoverUrl(url),url)
  assert.equal(parseTopicYaml('topic: activity\ncover: '+url).cover,url)
  for(const value of [url.replace('raw.githubusercontent.com','evil.invalid'),
    url.replace('a'.repeat(40),'main'),url+'?download=1',url.replace('/poster','/../poster'),
    url.replace('.png','.svg'),'javascript:alert(1)']){
    assert.equal(safeTopicCoverUrl(value),null)
    assert.throws(()=>parseTopicYaml('topic: activity\ncover: '+value))
  }
})

test('Topic README keeps description lines separate from contact metadata after the first H1',()=>{
  assert.deepEqual(readmeFields('preamble\n# Activity\nLine A\nLine B\nemail: a@example.org\ndatetime: 2026-11-12'),
    {title:'Activity',description:'Line A\nLine B',email:'a@example.org',datetime:'2026-11-12'})
  assert.equal(readmeFields('no heading').description,'')
})

test('project aggregation excludes source, applies whitelist and distinguishes window exhaustion',()=>{
  const project=full_name=>({full_name,html_url:'https://github.com/'+full_name})
  const meta={repository:{full_name:'sample/repo'},config:{whitelist:true},allowedRepositories:['member/a','member/b']}
  const pages=[{hasNext:true,items:['member/a','MEMBER/A','sample/repo','outside/c'].map(project)},
    {hasNext:false,windowExhausted:true,items:[project('member/b')]}]
  const filtered=accumulateTopicProjects(meta,pages)
  assert.deepEqual(filtered.items.map(x=>x.full_name),['member/a','member/b'])
  assert.equal(filtered.ended,true)
  assert.equal(filtered.windowExhausted,true)
  const open=accumulateTopicProjects({...meta,config:{whitelist:false}},pages)
  assert.deepEqual(open.items.map(x=>x.full_name),['member/a','outside/c','member/b'])
  assert.equal(accumulateTopicProjects(meta,[{...pages[1],windowExhausted:false}]).windowExhausted,false)
})

test('Masonry preserves existing geometry on append and reflows only the affected column',()=>{
  const keys=['a','b','c','d','e','f','g','h','i','j']
  const heights=[220,270,240,230,200,160,160,160,160,160]
  const width=1288,gap=7
  const first=layoutMasonry({keys,heights,width,gap})
  assert.ok(first.columns>1)
  const appended=layoutMasonry({keys:[...keys,'k'],heights:[...heights,210],width,gap,previous:first})
  assert.deepEqual(appended.positions.slice(0,keys.length),first.positions)
  assert.deepEqual(appended.keys,[...keys,'k'])
  const bottom=Math.min(...Array.from({length:first.columns},(_,column)=>Math.max(0,
    ...first.positions.flatMap((p,i)=>first.assignments[i]===column?[p.top+heights[i]+gap]:[]))))
  assert.equal(appended.positions.at(-1).top,bottom)
  const affected=first.assignments[0]
  assert.ok(first.assignments.slice(1).includes(affected))
  for(const delta of [-80,160]){
    const next=layoutMasonry({keys,heights:heights.map((h,i)=>i===0?h+delta:h),width,gap,previous:first})
    assert.deepEqual(next.assignments,first.assignments)
    for(const [i,p] of next.positions.entries())
      assert.deepEqual(p,{...first.positions[i],top:first.positions[i].top+
        (i>0&&first.assignments[i]===affected?delta:0)})
  }
})

test('Masonry geometry is nonoverlapping and contained at measured widths',()=>{
  const keys=Array.from({length:8},(_,i)=>String(i)),heights=[200,100,320,180,290,250,60,155]
  for(const width of [320,520,716,950,1288]){
    const layout=layoutMasonry({keys,heights,width})
    for(const [i,p] of layout.positions.entries()){
      assert.ok(p.left>=0&&p.width>0&&p.left+p.width<=width+1e-8)
      assert.ok(p.top>=0&&p.top+heights[i]<=layout.height)
      for(let j=0;j<i;j++){
        const q=layout.positions[j]
        assert.ok(p.left+p.width<=q.left||q.left+q.width<=p.left||
          p.top+heights[i]<=q.top||q.top+heights[j]<=p.top)
      }
    }
  }
  assert.equal(layoutMasonry({keys:[],heights:[],width:320}).height,0)
  for(const width of [0,-1,Infinity,NaN])assert.throws(()=>layoutMasonry({keys,heights,width}),RangeError)
  assert.throws(()=>layoutMasonry({keys,heights:[],width:320}),RangeError)
})
