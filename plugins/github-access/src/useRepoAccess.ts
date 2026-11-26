import {useCallback,useState} from 'react'
import {repoAccessReason,type RepoAccessReason} from './access'
/** Scope state to current read generation; duplicate failures produce one notice. */
export function useRepoAccess(scope:string){
  const [failure,setFailure]=useState<{scope:string;reason:RepoAccessReason}|null>(null)
  const report=useCallback((error:unknown)=>{
    const reason=repoAccessReason(error)
    if(!reason)return false
    setFailure(old=>old?.scope===scope?old:{scope,reason})
    return true
  },[scope])
  return {reason:failure?.scope===scope?failure.reason:null,report}
}
