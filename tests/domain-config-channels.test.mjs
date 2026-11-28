import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfigNamespaces, planLabelChanges } from '../plugins/repo-config/src/domain.mjs'
import { selectChannelIssues } from '../plugins/channel/src/domain.mjs'

const config = text => parseConfigNamespaces('namespaces:\n'+text)
const item = (number, labels, extras={}) => ({number, labels:labels.map(name=>({name})),
  state:'open', title:'Discussion '+number, created_at:'2026-11-01T09:00:00Z',
  html_url:'https://github.com/sample/repo/issues/'+number, comments:0, ...extras})

test('Config distinguishes absent configuration, managed empty lists and normalized labels',()=>{
  const missing = parseConfigNamespaces(null)
  assert.equal(missing.state,'config_missing')
  assert.equal(parseConfigNamespaces(missing.defaultPreview).state,'ready')
  const expected={state:'ready',namespaces:{status:['status:todo','status:done'],channel:[]}}
  assert.deepEqual(config('  status: [TODO, status:done]\n  channel: []\n'),expected)
  assert.deepEqual(config('  status:\r\n    - todo\r\n    - done\r\n  channel: []\r\n'),expected)
  for(const source of ['  status:','  status:[]','  status: [a,A]',
    '  status: [a]\n  STATUS: [b]','  status: &x [a]','  status:\n    - *x',
    '  status: [other:a]','  status: [a','  status: [] # comment','  status:\u00a0[]',
    '  status: [a]\nother: x','  status:\n    - a\n      child: x'])
    assert.equal(config(source).state,'invalid_config',source)
})

test('Config length guard rejects an otherwise valid document only beyond capacity',()=>{
  const base='namespaces:\n  status: [todo]\n'
  const document=n=>base+'#'+'a'.repeat(n-base.length-1)
  const limit=256*1024
  for(const n of [limit-1,limit])assert.equal(parseConfigNamespaces(document(n)).state,'ready')
  assert.equal(parseConfigNamespaces(document(limit+1)).state,'invalid_config')
})

test('label planning limits mutations to missing definitions and obsolete managed Issue associations',()=>{
  const parsed=config('  status: [todo,done]\n  foo: []\n')
  const labels=['STATUS:TODO','foo:old','foobar:legacy']
  const issues=[item(1,['status:obsolete','foo:old','foobar:legacy','channel:other']),
    item(2,['status:done','foo:old'],{state:'closed'}),
    item(3,['foo:old'],{pull_request:{}})]
  const plan=planLabelChanges(parsed,labels,issues,{complete:true})
  assert.deepEqual(plan.createLabels,[{name:'status:done'}])
  assert.deepEqual(plan.removeIssueLabels,[{number:1,labels:['status:obsolete','foo:old']},
    {number:2,labels:['foo:old']}])
  assert.deepEqual(plan.impact,{definitions:1,issues:2,removals:3})
  assert.equal(plan.requiresConfirmation,true)
  const unmodified=planLabelChanges(config('  status: [todo,done]\n'),[...labels,'status:done'],
    [item(1,['status:todo','foo:old','foobar:legacy'])],{complete:true})
  assert.equal(unmodified.state,'no_changes')
  assert.deepEqual(unmodified.createLabels,[])
  assert.deepEqual(unmodified.removeIssueLabels,[])
  assert.equal(unmodified.requiresConfirmation,false)
})

test('an incomplete or ambiguous snapshot authorizes no destructive label plan',()=>{
  const ready=config('  foo: []\n')
  const issues=[item(1,['foo:obsolete'])]
  for(const [source,complete,state] of [[ready,false,'snapshot_incomplete'],
    [parseConfigNamespaces(null),true,'config_missing'],
    [config('  foo:'),true,'invalid_config']]){
    const plan=planLabelChanges(source,[],issues,{complete})
    assert.equal(plan.state,state)
    assert.deepEqual(plan.createLabels,[])
    assert.deepEqual(plan.removeIssueLabels,[])
    assert.equal(plan.hasChanges,false)
  }
  assert.throws(()=>planLabelChanges(ready,[],[...issues,...issues],{complete:true}),/repeated/)
  assert.throws(()=>planLabelChanges(ready,[],[item(1,['foo:old'],{state:'draft'})],{complete:true}),/Incomplete/)
})

test('Channel winner is deterministic by creation time then Issue number, excluding ambiguous or closed items',()=>{
  const parsed=config('  channel: [discussion,wishlist]\n')
  const candidates=[
    item(1,['channel:discussion'],{updated_at:'2026-11-30T00:00:00Z'}),
    item(2,['CHANNEL:DISCUSSION'],{created_at:'2026-11-02T00:00:00Z'}),
    item(3,['channel:discussion'],{created_at:'2026-11-02T00:00:00Z'}),
    item(4,['channel:discussion'],{created_at:'2026-11-03T00:00:00Z',state:'closed'}),
    item(5,['channel:discussion'],{created_at:'2026-11-03T00:00:00Z',pull_request:{}}),
    item(6,['channel:discussion','channel:unknown'],{created_at:'2026-11-03T00:00:00Z'}),
    item(7,['channel:unknown'])]
  const expected=[['channel:discussion',3],['channel:wishlist',null]]
  for(const records of [candidates,[...candidates].reverse()])
    assert.deepEqual(selectChannelIssues(parsed,records).map(x=>[x.label,x.issue?.number??null]),expected)
  assert.throws(()=>selectChannelIssues(parsed,[candidates[0],candidates[0]]),/Duplicate/)
  assert.throws(()=>selectChannelIssues(parsed,[item(1,['channel:discussion'],{created_at:'invalid'})]),/metadata/)
})
