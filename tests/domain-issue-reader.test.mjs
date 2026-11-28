import test from 'node:test'
import assert from 'node:assert/strict'
import {loadIssueContent} from '../plugins/issue-detail/src/load-issue.mjs'

const route=['collective','ledger',8]
const item={number:8,title:'Review ledger',state:'open',labels:[],comments:1}
const comment={id:21,body:'Confirmed'}
function port(readIssue,readComments=async()=>({items:[comment],hasMore:false})){
  const requests=[]
  return {requests,service:{
    getIssue(...args){requests.push(['issue',...args]);return readIssue(...args)},
    getComments(...args){requests.push(['comments',...args]);return readComments(...args)},
  }}
}
test('ordinary Issue reads are independent of Channel configuration and retain the correct first comment page',async()=>{
  for(const labels of [[],['channel:review','channel:other']]){
    const signal=new AbortController().signal
    const value={...item,labels}
    const {service,requests}=port(async()=>value)
    assert.deepEqual(await loadIssueContent(service,...route,signal),{issue:value,first:{items:[comment],hasMore:false}})
    assert.deepEqual(requests,[['issue',...route,signal],['comments',...route,1,signal]])
  }
})
test('wrong identity, Pull Request or unsupported state never triggers a comment read',async()=>{
  for(const value of [{...item,number:9},{...item,pull_request:{}},{...item,state:'draft'}]){
    const signal=new AbortController().signal
    const {service,requests}=port(async()=>value)
    assert.equal(await loadIssueContent(service,...route,signal),null)
    assert.deepEqual(requests,[['issue',...route,signal]])
  }
})
test('upstream read errors retain their status and stop the next read',async()=>{
  for(const status of [404,403,429,502]){
    const signal=new AbortController().signal
    const error=Object.assign(Error('GitHub read failed'),{status})
    const {service,requests}=port(async()=>{throw error})
    await assert.rejects(loadIssueContent(service,...route,signal),{status,message:'GitHub read failed'})
    assert.deepEqual(requests,[['issue',...route,signal]])
  }
})
test('a canceled route does not fetch comments even if the earlier Issue request still resolves successfully',async()=>{
  const controller=new AbortController()
  const canceled=new AbortController()
  canceled.abort()
  const skipped=port(async()=>item)
  await assert.rejects(loadIssueContent(skipped.service,...route,canceled.signal),{name:'AbortError'})
  assert.deepEqual(skipped.requests,[])
  let complete
  const first=new Promise(resolve=>{complete=resolve})
  const {service,requests}=port(()=>first)
  const reading=loadIssueContent(service,...route,controller.signal)
  controller.abort()
  complete(item)
  await assert.rejects(reading,{name:'AbortError'})
  assert.deepEqual(requests,[['issue',...route,controller.signal]])
})
test('a route canceled during the final comment read cannot return a successful late page',async()=>{
  const controller=new AbortController()
  let complete,started
  const waiting=new Promise(resolve=>{started=resolve})
  const comments=new Promise(resolve=>{complete=resolve})
  const {service,requests}=port(async()=>item,()=>{started();return comments})
  const reading=loadIssueContent(service,...route,controller.signal)
  await waiting
  controller.abort()
  complete({items:[comment],hasMore:false})
  await assert.rejects(reading,{name:'AbortError'})
  assert.deepEqual(requests,[['issue',...route,controller.signal],['comments',...route,1,controller.signal]])
})
