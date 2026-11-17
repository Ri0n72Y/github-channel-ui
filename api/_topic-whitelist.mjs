import { github, content, repoPath, TopicFetchError } from './_topic.mjs'
import { parseTopicYaml } from '../plugins/topic-page/src/domain.mjs'

const MAX_FILES=50
const WORKERS=5
/** @summary Read the authoritative source whitelist with a strict file/worker budget. */
export async function loadTopicWhitelist(owner,repo,config,
  {fetcher=fetch,logger=console}={}){
  if(!config?.whitelist)return null
  let directory
  try{directory=await github(repoPath(owner,repo,'/contents/projects'),
    {fetcher,stage:'whitelist'})}
  catch(error){
    if(error instanceof TopicFetchError&&error.status===404)return []
    throw error
  }
  if(!Array.isArray(directory))throw new TopicFetchError(
    'projects 目录格式无效',422,'whitelist')
  const files=directory.filter(item=>item&&typeof item.name==='string'&&
    /\.ya?ml$/i.test(item.name))
  if(files.length>MAX_FILES)throw new TopicFetchError(
    'projects 白名单文件超过50个核验上限',422,'whitelist')
  const results=Array(files.length)
  let index=0,failure=null
  async function worker(){
    while(!failure&&index<files.length){
      const position=index++,entry=files[position]
      const path=entry.path
      if(typeof path!=='string'||!/^projects\/[a-z\d._-]+\.ya?ml$/i.test(path)){
        logger.error('Topic whitelist file rejected:',String(path).slice(0,150))
        continue
      }
      try{
        const text=await content(owner,repo,path,{fetcher,stage:'whitelist'})
        results[position]=parseTopicYaml(text,'project').repository
      }catch(error){
        if(error instanceof TopicFetchError&&![404,422].includes(error.status)){
          failure=error
          break
        }
        if(error instanceof TopicFetchError&&error.status===429){
          failure=error
          break
        }
        // Invalid individual declarations are skipped and safely diagnosed.
        if(!(error instanceof TopicFetchError)&&!(error instanceof Error)){
          failure=new TopicFetchError('projects 声明无法核验',502,'whitelist')
          break
        }
        logger.error('Topic whitelist file skipped:',path,
          error instanceof Error?error.message:'Invalid project file')
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(WORKERS,files.length)},
    ()=>worker()))
  if(failure)throw failure
  return [...new Set(results.filter(Boolean))]
}
