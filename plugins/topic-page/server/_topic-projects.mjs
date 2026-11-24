import { requireTopicTarget, github, topicError, reply, TopicFetchError } from './_topic.mjs'
import { createTopicSourceStore, topicSourceStore } from './_topic-source.mjs'
import { validTopicRepository } from '../src/domain.mjs'

/** @summary Keep only original image URLs hosted by GitHub itself. */
function trustedGitHubImage(value, hosts) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.includes(url.hostname) &&
      !url.username && !url.password ? url.href : null
  } catch { return null }
}
/** @summary Require exact public GitHub Search identity and canonical repository URL. */
function candidateIdentity(item) {
  if (!Number.isSafeInteger(item?.id) || item.id <= 0 || item.private !== false ||
      typeof item.full_name !== 'string' || typeof item.name !== 'string' ||
      typeof item.owner?.login !== 'string' || typeof item.html_url !== 'string') return null
  const owner = item.owner.login, name = item.name
  if (!validTopicRepository(owner, name) ||
      item.full_name.toLowerCase() !== (owner + '/' + name).toLowerCase() ||
      !item.html_url.toLowerCase().startsWith('https://github.com/' +
        item.full_name.toLowerCase())) return null
  try {
    const url = new URL(item.html_url)
    if (url.origin !== 'https://github.com' || url.username || url.password ||
        url.search || url.hash ||
        url.pathname.toLowerCase() !== ('/' + item.full_name).toLowerCase()) return null
  } catch { return null }
  return { owner, repo: name }
}
/** @summary Project only public Search metadata; no App Installation lookup or credentials. */
function publicProject(item) {
  const identity = candidateIdentity(item)
  if (!identity) return null
  const ownerAvatar = trustedGitHubImage(item.owner?.avatar_url,
    ['avatars.githubusercontent.com'])
  const cover = trustedGitHubImage(item.open_graph_image_url,
    ['opengraph.githubassets.com', 'repository-images.githubusercontent.com'])
  return {
    id: item.id, full_name: item.full_name, name: item.name, owner: identity.owner,
    description: typeof item.description === 'string' ? item.description : '',
    html_url: item.html_url,
    stargazers_count: Number.isSafeInteger(item.stargazers_count) ?
      item.stargazers_count : 0,
    language: typeof item.language === 'string' ? item.language : null,
    ...(ownerAvatar ? { owner_avatar_url: ownerAvatar } : {}),
    ...(cover ? { cover_url: cover } : {}),
  }
}
/** @summary Search only the configured source Topic and return one complete filtered Search page. */
export function createTopicProjectsEndpoint({ fetcher = fetch,
  store = fetcher === fetch ? topicSourceStore : createTopicSourceStore({fetcher}) } = {}) {
  return Object.freeze({
    async fetch(request) {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405)
      try {
        const query = new URL(request.url).searchParams
        // The production API never accepts an arbitrary Topic slug, including mixed requests.
        if (query.has('topic') || query.getAll('owner').length !== 1 ||
            query.getAll('repo').length !== 1 || query.getAll('page').length > 1 ||
            query.getAll('offset').length > 1) throw new TopicFetchError(
          '必须指定唯一的 Topic 来源仓库', 400, 'route')
        if (query.has('offset') && query.get('offset') !== '0' ||
            query.getAll('head').length > 1 || query.has('head') &&
            !/^[a-f0-9]{40}$/i.test(query.get('head'))) throw new TopicFetchError(
          '无效的 Topic Search 游标',400,'topic-search')
        const {owner,repo,page} = requireTopicTarget(request,true)
        const expected = query.get('head')
        if (page>1 && !expected) throw new TopicFetchError('分页需要来源快照，请刷新',409,'snapshot')
        const snapshot = await store.snapshot(owner,repo)
        if (expected && expected !== snapshot.headSha)
          throw new TopicFetchError('来源仓库已更新，请刷新 TopicPage',409,'snapshot')
        const {config,repository,headSha} = snapshot
        if (!config) throw new TopicFetchError('topics.config.yaml 尚未初始化',404,'config')
        const allowedNames = config.whitelist ? new Set(snapshot.allowedRepositories) : null
        if (allowedNames?.size === 0) return reply({page,offset:0,perPage:100,totalCount:0,
          hasNext:false,nextPage:null,nextOffset:null,windowExhausted:false,items:[]})
        const topic = config.topic
        const result = await store.page(owner,repo,headSha,page,async()=>{
        const data = await github('/search/repositories?q=topic:' +
          encodeURIComponent(topic + ' is:public') + '&sort=updated&order=desc&per_page=100&page=' +
          page, { fetcher, stage: 'topic-search' })
        if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
            !Array.isArray(data.items) || data.items.length > 100) throw new TopicFetchError(
          'GitHub Topic Search 响应无效', 502, 'topic-search')
        if (data.incomplete_results === true) throw new TopicFetchError(
          'GitHub Topic Search 结果不完整，请重试读取', 502, 'topic-search')
        const accessible = Math.min(data.total_count, 1000)
        const searched = data.items
        const sourceName = repository.full_name.toLowerCase()
        const items = searched.filter(item => {
          const name = typeof item?.full_name === 'string' ? item.full_name.toLowerCase() : ''
          return name !== sourceName && (allowedNames === null || allowedNames.has(name))
        }).map(publicProject).filter(Boolean)
        const hasNext = page * 100 < accessible
        return {page,offset:0,perPage:100,totalCount:data.total_count,hasNext,
          nextPage:hasNext?page+1:null,nextOffset:hasNext?0:null,
          windowExhausted:!hasNext&&data.total_count>1000&&page===10,items}
        })
        return reply(result)
      } catch (error) { return topicError(error) }
    },
  })
}
export default createTopicProjectsEndpoint()
