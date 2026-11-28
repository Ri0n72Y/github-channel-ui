import {observeHttp} from './observe-http.mjs'
import {createHash} from 'node:crypto'
export const HEAD='b'.repeat(40),ROOT_TREE='c'.repeat(40),PROJECT_TREE='d'.repeat(40)
export const blobSha=value=>{const bytes=Buffer.from(value);return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')}
export const json=(data,status=200,headers={})=>Response.json(data,{status,headers})
export function topicReadFixture({owner='sample',repo='repo',head=HEAD,config='topic: labourchain\n',
  readme='# Real Title\nDescription one\nDescription two\nemail: hi@example.org\ndatetime: Friday',
  projects={'valid.yaml':'repository: Member/Project\n','broken.yml':'unrecognized: broken\n'},
  cover=null,privateRepo=false,search=()=>({total_count:0,incomplete_results:false,items:[]}),
  intercept=()=>undefined}={}){
  const calls=[],root='/repos/'+owner+'/'+repo
  const files={'README.md':readme,...(config===null?{}:{'topics.config.yaml':config}),
    ...(cover===null?{}:{'cover.jpg':cover})}
  const blob=(path,value)=>({path,type:'blob',mode:'100644',size:Buffer.byteLength(value),sha:blobSha(value)})
  const entries=Object.entries(files).map(([path,value])=>blob(path,value))
  if(projects!==null)entries.push({path:'projects',type:'tree',mode:'040000',sha:PROJECT_TREE})
  const fetcher=observeHttp(async(url,init={})=>{
    const u=new URL(url),path=u.pathname
    calls.push({host:u.hostname,path,search:u.search,auth:init.headers?.Authorization,method:init.method||'GET'})
    const altered=await intercept(u,init)
    if(altered!==undefined)return altered
    if(u.hostname==='raw.githubusercontent.com'){
      const prefix='/'+owner+'/'+repo+'/'+head+'/'
      if(!path.startsWith(prefix))throw Error('Wrong Raw commit: '+path)
      const name=decodeURIComponent(path.slice(prefix.length))
      const value=name.startsWith('projects/')?projects?.[name.slice(9)]:files[name]
      return value===undefined?new Response('',{status:404}):new Response(value)
    }
    if(u.hostname!=='api.github.com')throw Error('Unexpected host '+u.hostname)
    if(path===root)return json({private:privateRepo,full_name:owner+'/'+repo,default_branch:'main'})
    if(path===root+'/branches/main')return json({commit:{sha:head,commit:{tree:{sha:ROOT_TREE}}}})
    if(path===root+'/git/trees/'+ROOT_TREE)return json({sha:ROOT_TREE,truncated:false,tree:entries})
    if(path===root+'/git/trees/'+PROJECT_TREE)return json({sha:PROJECT_TREE,truncated:false,
      tree:Object.entries(projects||{}).map(([name,value])=>blob(name,value))})
    if(path==='/search/repositories'){
      const result=await search(u,init)
      return result instanceof Response?result:json(result)
    }
    throw Error('Unexpected GitHub GET '+path)
  })
  return {fetcher,calls,root}
}
