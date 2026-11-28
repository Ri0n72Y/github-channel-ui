import test from 'node:test'
import assert from 'node:assert/strict'
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'

// One-time Code QA evidence only. Never modify the candidate checkout;
// each defect is exercised inside an isolated copy with installed dependencies.
test('review fault probes reject the specific regression rather than a broken runner', {timeout:300000},()=>{
 const root=resolve(import.meta.dirname,'..')
 const work=mkdtempSync(join(tmpdir(),'lc-review-'))
 const cases=[
  ['Topic write file revision','plugins/topic-page/src/service.ts','expectedFileSha:configSha,confirmed:true','expectedFileSha:headSha,confirmed:true',
   'tests/contracts-topic-browser.test.mjs','Topic Config verifies the actual write outcome','expectedFileSha'],
  ['Topic write cache invalidation','plugins/topic-page/src/service.ts','snapshots.invalidate(sourceKey(route));pages.invalidate(sourceKey(route))','snapshots.invalidate(sourceKey(route))',
   'tests/contracts-topic-browser.test.mjs','Topic Config verifies the actual write outcome','Missing expected rejection'],
  ['Topic page version requirement','plugins/topic-page/server/_topic-projects.mjs',
   "if (page>1 && !expected) throw new TopicFetchError('分页需要来源快照，请刷新',409,'snapshot')",'// temporary omitted version requirement',
   'tests/topic-search-boundary.test.mjs','invalid raw page and offset','409'],
  ['Report default session wiring','plugins/topic-page/server/_topic-report.mjs','sessionReader = readSession','sessionReader = () => null',
   'tests/contracts-topic-report.test.mjs','a verified report creates exactly one Issue','401'],
  ['Playground unintended HTTP','apps/playground/src/single-plugin-runtime.ts','    await mount(ReactUIService)',
   "    await globalThis.fetch('/api/github-session').catch(()=>{})\n    await mount(ReactUIService)",
   'tests/playground-routes.dom.mjs','#94 deep link mounts only topic-page','fixture runtime must make no real HTTP requests'],
  ['Config session change during POST','plugins/repo-config/src/ConfigPage.tsx','    writeGate.invalidate()','    // temporary omitted cancellation',
   'tests/react-lifecycle-86.dom.mjs','Config uncertain Save or Label Sync','false !== true'],
  ['RepoPanel unverified write lock','plugins/repo-panel/src/issue-workspace.tsx','if(!url){gate.markUnknown(attempt);','if(!url){',
   'tests/react-lifecycle-86.dom.mjs','RepoPanel confirmed publication','发布结果尚未确认'],
  ['Issue initially aborted read','plugins/issue-detail/src/load-issue.mjs','  signal.throwIfAborted()\n  const issue','  const issue',
   'tests/domain-issue-reader.test.mjs','a canceled route does not fetch comments','getIssue'],
 ]
 const baseline=new Set()
 const run=(entry,name)=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+name,entry],
  {cwd:work,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024})
 try{
  for(const path of ['api','apps','plugins','tests','package.json','tsconfig.json'])
   cpSync(join(root,path),join(work,path),{recursive:true})
  symlinkSync(join(root,'node_modules'),join(work,'node_modules'),'dir')
  for(const [label,path,from,to,entry,name,marker] of cases){
   const key=entry+name
   if(!baseline.has(key)){
    const result=run(entry,name),output=result.stdout+result.stderr
    assert.equal(result.status,0,'baseline failed: '+label+'\n'+output)
    assert.ok(output.includes('ok ')&&output.includes(name),'baseline did not execute target: '+label+'\n'+output)
    assert.match(output,/# pass 1\b/,'baseline must execute precisely the chosen test')
    baseline.add(key)
   }
   const location=join(work,path),source=readFileSync(location,'utf8')
   assert.ok(source.includes(from),'fault anchor missing: '+label)
   writeFileSync(location,source.replace(from,()=>to))
   try{
    const result=run(entry,name),output=result.stdout+result.stderr
    assert.equal(result.status,1,'fault did not fail: '+label+'\n'+output)
    assert.ok(output.includes('not ok ')&&output.includes(name),'wrong test failed: '+label+'\n'+output)
    assert.match(output,/ERR_ASSERTION|AssertionError/,'must fail from a contract assertion: '+label+'\n'+output)
    assert.ok(output.includes(marker),'expected failure evidence missing: '+label+'\n'+output)
    console.log('REVIEW FAULT DETECTED: '+label)
   }finally{writeFileSync(location,source)}
   assert.equal(readFileSync(location,'utf8'),source)
  }
 }finally{rmSync(work,{recursive:true,force:true})}
})
