import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfigNamespaces, planLabelChanges } from '../plugins/repo-config/src/domain.mjs'
import { selectChannelIssues } from '../plugins/channel/src/domain.mjs'

const source='namespaces:\n  status: [todo, done]\n  obsolete: []\n'
const issue=(number,labels,more={})=>({number,state:'open',labels:labels.map(name=>({name})),
  title:'Discussion '+number,created_at:'2026-09-01T00:00:00Z',
  html_url:'https://github.com/collective/ledger/issues/'+number,comments:2,user:{login:'mira'},...more})

test('a managed empty namespace authorizes cleanup; a missing or malformed document does not',()=>{
  const missing=parseConfigNamespaces(null)
  assert.equal(missing.state,'config_missing')
  assert.equal(parseConfigNamespaces(missing.defaultPreview).state,'ready')
  assert.deepEqual(parseConfigNamespaces('namespaces:\r\n  STATUS:\r\n    - TODO\r\n    - status:done\r\n  obsolete: []\r\n'),
    {state:'ready',namespaces:{status:['status:todo','status:done'],obsolete:[]}})
  const possibleRemoval=[issue(1,['obsolete:legacy'])]
  const ready=planLabelChanges(parseConfigNamespaces(source),[],possibleRemoval,{complete:true})
  assert.deepEqual(ready.removeIssueLabels,[{number:1,labels:['obsolete:legacy']}])
  for(const [text,state] of [[null,'config_missing'],['namespaces:\n  obsolete:','invalid_config'],
    ['namespaces:\n  obsolete:[]','invalid_config'],['namespaces:\n  obsolete: []\nunknown: x','invalid_config']]){
    const plan=planLabelChanges(parseConfigNamespaces(text),[],possibleRemoval,{complete:true})
    assert.equal(plan.state,state)
    assert.deepEqual(plan.createLabels,[])
    assert.deepEqual(plan.removeIssueLabels,[])
    assert.equal(plan.hasChanges,false)
  }
})

test('Config parsing fails closed for ambiguous mappings and unsupported YAML',()=>{
  const prefix='namespaces:\n'
  for(const value of ['  status: [a,A]','  status: [a]\n  STATUS: [b]',
    '  status: &x [a]','  status:\n    - *x','  status: [other:a]','  status: [a',
    '  status: [] # comment','  status:\u00a0[]','  status:\n    - a\n      child: x']){
    assert.equal(parseConfigNamespaces(prefix+value).state,'invalid_config',value)
  }
  const base='namespaces:\n  status: [todo]\n'
  const atLimit=base+'#'+'x'.repeat(256*1024-base.length-1)
  assert.equal(parseConfigNamespaces(atLimit).state,'ready')
  assert.equal(parseConfigNamespaces(atLimit+'x').state,'invalid_config')
})

test('Label plan targets only missing definitions and obsolete managed Issue associations, never PRs or similarly named namespaces',()=>{
  const config=parseConfigNamespaces(source)
  const definitions=['STATUS:TODO','obsolete:legacy','obsolete-other:legacy','custom:manual']
  const issues=[
    issue(7,['obsolete:legacy','obsolete-other:legacy','custom:manual','status:old']),
    issue(3,['status:done','obsolete:legacy'],{state:'closed'}),
    issue(9,['obsolete:legacy'],{pull_request:{url:'https://api.github.com/pulls/9'}}),
  ]
  const plan=planLabelChanges(config,definitions,issues,{complete:true})
  assert.deepEqual(plan,{state:'changes',createLabels:[{name:'status:done'}],
    removeIssueLabels:[{number:3,labels:['obsolete:legacy']},{number:7,labels:['obsolete:legacy','status:old']}],
    impact:{definitions:1,issues:2,removals:3},hasChanges:true,requiresConfirmation:true})
  // Independently specified state after the user applies the plan.
  const after=[issue(7,['obsolete-other:legacy','custom:manual']),issue(3,['status:done'],{state:'closed'}),issues[2]]
  assert.deepEqual(planLabelChanges(config,[...definitions,'status:done'],after,{complete:true}),
    {state:'no_changes',createLabels:[],removeIssueLabels:[],impact:{definitions:0,issues:0,removals:0},
      hasChanges:false,requiresConfirmation:false})
})

test('incomplete or contradictory snapshots never authorize a destructive plan',()=>{
  const config=parseConfigNamespaces(source)
  const target=issue(5,['obsolete:legacy'])
  const plan=planLabelChanges(config,[],[target],{complete:false})
  assert.equal(plan.state,'snapshot_incomplete')
  assert.deepEqual(plan.createLabels,[])
  assert.deepEqual(plan.removeIssueLabels,[])
  assert.equal(plan.requiresConfirmation,false)
  assert.throws(()=>planLabelChanges(config,[],[target,target],{complete:true}),/repeated/)
  assert.throws(()=>planLabelChanges(config,[],[{...target,state:'draft'}],{complete:true}),/Incomplete/)
})

test('Channel selects newest eligible open Issue by creation time and number, independently of pagination order',()=>{
  const config=parseConfigNamespaces('namespaces:\n  channel: [review, planning]\n')
  const candidates=[
    issue(1,['channel:review'],{updated_at:'2026-12-01T00:00:00Z'}),
    issue(4,['CHANNEL:REVIEW'],{created_at:'2026-09-02T00:00:00Z'}),
    issue(5,['channel:review'],{created_at:'2026-09-02T00:00:00Z',title:'Final review'}),
    issue(6,['channel:review'],{created_at:'2026-09-03T00:00:00Z',state:'closed'}),
    issue(7,['channel:review'],{created_at:'2026-09-03T00:00:00Z',pull_request:{}}),
    issue(8,['channel:review','channel:unknown'],{created_at:'2026-09-03T00:00:00Z'}),
    issue(9,['channel:unknown']),
  ]
  const expected=[{label:'channel:review',name:'review',issue:{number:5,title:'Final review',
    createdAt:'2026-09-02T00:00:00Z',comments:2,author:'mira'}},
    {label:'channel:planning',name:'planning',issue:null}]
  assert.deepEqual(selectChannelIssues(config,candidates),expected)
  assert.deepEqual(selectChannelIssues(config,[...candidates].reverse()),expected)
  assert.throws(()=>selectChannelIssues(config,[candidates[0],candidates[0]]),/Duplicate/)
  assert.throws(()=>selectChannelIssues(config,[{...candidates[0],created_at:'invalid'}]),/metadata/)
})
