import test from 'node:test'
import assert from 'node:assert/strict'
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'

test('temporary B2-5a probe detects missing pending-write cancellation on denied recheck',{timeout:120000},()=>{
 const root=resolve(import.meta.dirname,'..'),work=mkdtempSync(join(tmpdir(),'lc-pending-recheck-'))
 const name='RepoPanel denied same-target recheck cancels pending publication and rejects late success'
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+name,'tests/react-lifecycle-86.dom.mjs'],
  {cwd:work,env,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024})
 try{
  for(const path of ['api','apps','plugins','tests','package.json','tsconfig.json'])
   cpSync(join(root,path),join(work,path),{recursive:true})
  symlinkSync(join(root,'node_modules'),join(work,'node_modules'),'dir')
  const baseline=run(),clean=baseline.stdout+baseline.stderr
  assert.equal(baseline.status,0,clean)
  assert.ok(clean.includes('ok 1 - '+name),clean)
  assert.match(clean,/# pass 1\b/)
  const path=join(work,'plugins/repo-panel/src/issue-workspace.tsx')
  const source=readFileSync(path,'utf8'),anchor='if(!available&&!checking)gate.invalidate()'
  assert.ok(source.includes(anchor))
  writeFileSync(path,source.replace(anchor,'// temporary omission of denied-recheck invalidation'))
  try{
   const fault=run(),output=fault.stdout+fault.stderr
   assert.equal(fault.status,1,output)
   assert.ok(output.includes('not ok 1 - '+name),output)
   assert.match(output,/ERR_ASSERTION/,output)
   assert.ok(output.includes('denied recheck must abort pending POST'),output)
   console.log('REVIEW FAULT DETECTED: denied recheck fails to cancel pending POST')
  }finally{writeFileSync(path,source)}
  assert.equal(readFileSync(path,'utf8'),source)
 }finally{rmSync(work,{recursive:true,force:true})}
})
