import test from 'node:test'
import assert from 'node:assert/strict'
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {spawnSync} from 'node:child_process'

test('RepoPanel recheck regression probes detect unmount and missing authorization gate', {timeout:120000},()=>{
 const root=resolve(import.meta.dirname,'..'), work=mkdtempSync(join(tmpdir(),'lc-recheck-'))
 const name='RepoPanel publication preserves draft and write lock through delayed same-target rechecks'
 const env={...process.env};delete env.NODE_TEST_CONTEXT
 const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+name,'tests/react-lifecycle-86.dom.mjs'],
  {cwd:work,env,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024})
 try{
  for(const path of ['api','apps','plugins','tests','package.json','tsconfig.json'])
   cpSync(join(root,path),join(work,path),{recursive:true})
  symlinkSync(join(root,'node_modules'),join(work,'node_modules'),'dir')
  const baseline=run()
  const clean=baseline.stdout+baseline.stderr
  assert.equal(baseline.status,0,clean)
  assert.ok(clean.includes('ok 1 - '+name),clean)
  assert.match(clean,/# pass 1\b/)
  for(const [label,path,from,to,marker] of [
   ['same-target read unmounts writer','plugins/repo-panel/src/index.tsx','{workspaceTarget && <IssueWorkspace','{workspaceTarget && workspaceAvailable && <IssueWorkspace','same-target recheck must preserve publication form'],
   ['unverified repository permits write','plugins/repo-panel/src/issue-workspace.tsx','const canWrite=available&&loggedIn','const canWrite=loggedIn','false !== true'],
  ]){
   const location=join(work,path),source=readFileSync(location,'utf8')
   assert.ok(source.includes(from))
   writeFileSync(location,source.replace(from,()=>to))
   try{
    const fault=run(),output=fault.stdout+fault.stderr
    assert.equal(fault.status,1,output)
    assert.ok(output.includes('not ok 1 - '+name),output)
    assert.match(output,/ERR_ASSERTION/,output)
    assert.ok(output.includes(marker),output)
    console.log('REVIEW FAULT DETECTED: '+label)
   }finally{writeFileSync(location,source)}
  }
 }finally{rmSync(work,{recursive:true,force:true})}
})
