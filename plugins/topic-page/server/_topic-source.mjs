import { createHash } from 'node:crypto'
import { github, repoPath, publicRepository, TopicFetchError } from './_topic.mjs'
import { parseTopicYaml, validTopicRepository } from '../src/domain.mjs'
import { createTopicReadCache } from '../src/topic-read-cache.mjs'

const SHA = /^[a-f0-9]{40}$/i
const MAX_YAML = 64 * 1024
const MAX_README = 1024 * 1024
const MAX_FILES = 50
const RAW = 'https://raw.githubusercontent.com/'
const keyFor = (owner,repo) => owner.toLowerCase() + '/' + repo.toLowerCase() + '|'
const fail = (message,status,stage) => new TopicFetchError(message,status,stage)

function rawUrl(owner,repo,head,path) {
  return RAW + [owner,repo,head,...path.split('/')].map(encodeURIComponent).join('/')
}
function regular(entry) {
  return entry?.type === 'blob' && ['100644','100755'].includes(entry.mode) &&
    SHA.test(entry.sha || '') && Number.isSafeInteger(entry.size) && entry.size >= 0
}
async function tree(owner,repo,sha,fetcher,stage) {
  if (!SHA.test(sha || '')) throw fail('Git Tree SHA 无效',502,stage)
  const value = await github(repoPath(owner,repo,'/git/trees/'+sha),{fetcher,stage})
  if (value?.sha !== sha || value.truncated !== false || !Array.isArray(value.tree))
    throw fail('Git Tree 无效或不完整',502,stage)
  const entries = new Map()
  for (const entry of value.tree) {
    if (typeof entry?.path !== 'string' || !entry.path || entry.path.includes('/') ||
        entries.has(entry.path)) throw fail('Git Tree 文件索引无效',502,stage)
    entries.set(entry.path,entry)
  }
  return entries
}
async function rawText(owner,repo,head,path,entry,limit,fetcher,stage) {
  if (!regular(entry) || entry.size > limit) throw fail('Raw 文件类型或大小无效',422,stage)
  const signal = AbortSignal.timeout(10000)
  let response
  try {
    response = await fetcher(rawUrl(owner,repo,head,path),{redirect:'error',signal,
      headers:{Accept:'text/plain'}})
  } catch { throw fail('Raw CDN 网络请求未完成',502,stage) }
  if (!response.ok) {
    const limited = response.status === 429 || response.status === 403 &&
      response.headers.get('x-ratelimit-remaining') === '0'
    throw fail(limited?'Raw CDN 限流，请稍后重试':'Raw CDN HTTP '+response.status,
      limited?429:[403,404].includes(response.status)?response.status:502,stage)
  }
  const reader = response.body?.getReader()
  if (!reader) throw fail('Raw CDN 响应无效',502,stage)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const {done,value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit || size > entry.size) {
        await reader.cancel()
        throw fail('Raw 文件超过索引大小',422,stage)
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error instanceof TopicFetchError) throw error
    throw fail('Raw CDN 读取失败',502,stage)
  } finally { reader.releaseLock() }
  const bytes = Buffer.concat(chunks)
  if (size !== entry.size || createHash('sha1').update('blob '+size+'\0').update(bytes).digest('hex') !== entry.sha.toLowerCase())
    throw fail('Raw 内容与 Git Tree blob 不一致',502,stage)
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes) }
  catch { throw fail('Raw 文件编码无效',422,stage) }
}
async function readSource(owner,repo,fetcher,logger) {
  const repository = await publicRepository(owner,repo,{fetcher})
  const branch = repository.default_branch
  if (typeof branch !== 'string' || !branch || branch.length > 250)
    throw fail('仓库默认分支无效',502,'config')
  const branchData = await github(repoPath(owner,repo,'/branches/'+encodeURIComponent(branch)),
    {fetcher,stage:'config'})
  const headSha = branchData?.commit?.sha
  if (!SHA.test(headSha || '')) throw fail('仓库 HEAD 无效',502,'config')
  const root = await tree(owner,repo,branchData?.commit?.commit?.tree?.sha,fetcher,'config')
  const readmeEntry = root.get('README.md')
  if (!readmeEntry) throw fail('README.md 不存在',404,'readme')
  const configEntry = root.get('topics.config.yaml')
  const readme = await rawText(owner,repo,headSha,'README.md',readmeEntry,MAX_README,fetcher,'readme')
  let configText = null,config = null
  if (configEntry) {
    configText = await rawText(owner,repo,headSha,'topics.config.yaml',configEntry,MAX_YAML,fetcher,'config')
    try { config = parseTopicYaml(configText) }
    catch { throw fail('topics.config.yaml 格式或字段无效',422,'config') }
  }
  const names = []
  const projects = root.get('projects')
  if (config?.whitelist && projects) {
    if (projects.type !== 'tree' || projects.mode !== '040000')
      throw fail('projects 目录格式无效',422,'whitelist')
    const entries = await tree(owner,repo,projects.sha,fetcher,'whitelist')
    const files = [...entries.values()].filter(entry => /\.ya?ml$/i.test(entry.path))
    if (files.length > MAX_FILES) throw fail('projects 白名单文件超过50个核验上限',422,'whitelist')
    let next = 0, failure = null
    const results = Array(files.length)
    async function worker() {
      while (!failure && next < files.length) {
        const i = next++, entry = files[i], path = 'projects/'+entry.path
        if (!regular(entry) || !/^[a-z\d._-]+\.ya?ml$/i.test(entry.path)) {
          logger.error('Topic whitelist file rejected:',path.slice(0,150)); continue
        }
        let value
        try { value = await rawText(owner,repo,headSha,path,entry,MAX_YAML,fetcher,'whitelist') }
        catch (error) { failure = error; break }
        try { results[i] = parseTopicYaml(value,'project').repository }
        catch { logger.error('Topic whitelist file skipped:',path.slice(0,150)) }
      }
    }
    await Promise.all(Array.from({length:Math.min(5,files.length)},worker))
    if (failure) throw failure
    names.push(...results.filter(Boolean))
  }
  const cover = root.get('cover.jpg')
  const full = repository.full_name
  return {repository:{owner,name:repo,full_name:full,html_url:'https://github.com/'+full},
    readme,coverUrl:regular(cover)?rawUrl(owner,repo,headSha,'cover.jpg'):null,
    config,configState:config?'ready':'missing',configText,configSha:configEntry?.sha ?? null,
    headSha,defaultBranch:branch,allowedRepositories:[...new Set(names)]}
}
export function createTopicSourceStore({fetcher=fetch,logger=console,now=Date.now}={}) {
  const sources = createTopicReadCache({ttl:300000,limit:16,now})
  const pages = createTopicReadCache({ttl:120000,limit:80,now})
  function invalidate(owner,repo) {
    if (!validTopicRepository(owner,repo)) return
    const key = keyFor(owner,repo)
    sources.invalidate(key);pages.invalidate(key)
  }
  return Object.freeze({
    invalidate,
    snapshot(owner,repo,refresh=false) {
      const key = keyFor(owner,repo)
      return sources.get(key,()=>readSource(owner,repo,fetcher,logger),refresh,
        ()=>pages.invalidate(key))
    },
    isCurrent(owner,repo,snapshot) {
      return sources.peek(keyFor(owner,repo)) === snapshot
    },
    async page(owner,repo,snapshot,page,load) {
      const key = keyFor(owner,repo)
      const ensureCurrent = () => {
        if (sources.peek(key) !== snapshot)
          throw fail('来源快照已失效，请刷新 TopicPage',409,'snapshot')
      }
      // An old source request must not start Search in a new generation,
      // even if the source commit SHA is unchanged.
      ensureCurrent()
      const value = await pages.get(key+snapshot.headSha+'|'+page,load)
      ensureCurrent()
      return value
    }
  })
}
export const topicSourceStore = createTopicSourceStore()
