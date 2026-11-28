import assert from 'node:assert/strict'
import {afterEach} from 'node:test'

// A real transport handler may deliberately convert an exception into HTTP 502.
// That must never hide a fixture's assertion or an unexpected HTTP interaction.
const violations=[]
afterEach(()=>{
 const failures=violations.splice(0)
 assert.deepEqual(failures,[],'unexpected fixture interaction, even if production handled the exception')
})
export function observeHttp(fetcher){
 return async function(address,init){
  try{return await fetcher.call(this,address,init)}
  catch(error){
   if(error?.code==='ERR_ASSERTION'||/^(unexpected\b|wrong raw commit\b)/i.test(error?.message||''))
    violations.push({address:String(address),method:init?.method||'GET',message:error.message})
   throw error
  }
 }
}
