import { requireTopicTarget, github, topicConfig, topicError, reply,
  publicRepository, TopicFetchError } from './_topic.mjs'
import { loadTopicWhitelist } from './_topic-whitelist.mjs'
import { validTopicRepository } from '../src/domain.mjs'

const BATCH = 25

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
/** @summary Search only the configured source Topic and return a bounded public candidate slice. */
export function createTopicProjectsEndpoint({ fetcher = fetch } = {}) {
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
        const rawOffset = query.get('offset') || '0'
        if (!/^(?:0|25|50|75)$/.test(rawOffset)) throw new TopicFetchError(
          '无效的 Topic Search 游标', 400, 'topic-search')
        const offset = Number(rawOffset), args = { fetcher }
        const target = requireTopicTarget(request, true)
        const page = target.page
        const repository = await publicRepository(target.owner, target.repo, args)
        const config = await topicConfig(target.owner, target.repo, args)
        const sourceAllow = await loadTopicWhitelist(target.owner, target.repo,
          config, { fetcher })
        const allowedNames = sourceAllow === null ? null : new Set(sourceAllow)
        const topic = config.topic
        const data = await github('/search/repositories?q=topic:' +
          encodeURIComponent(topic + ' is:public') + '&sort=updated&order=desc&per_page=100&page=' +
          page, { ...args, stage: 'topic-search' })
        if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
            !Array.isArray(data.items) || data.items.length > 100) throw new TopicFetchError(
          'GitHub Topic Search 响应无效', 502, 'topic-search')
        if (data.incomplete_results === true) throw new TopicFetchError(
          'GitHub Topic Search 结果不完整，请重试读取', 502, 'topic-search')
        const accessible = Math.min(data.total_count, 1000)
        const searched = data.items.slice(offset, offset + BATCH)
        const sourceName = repository.full_name.toLowerCase()
        const items = searched.filter(item => {
          const name = typeof item?.full_name === 'string' ? item.full_name.toLowerCase() : ''
          return name !== sourceName && (allowedNames === null || allowedNames.has(name))
        }).map(publicProject).filter(Boolean)
        const end = offset + searched.length
        const moreOnPage = end < data.items.length
        const morePages = page * 100 < accessible
        const hasNext = moreOnPage || morePages
        const nextPage = moreOnPage ? page : Math.min(page + 1, 10)
        const nextOffset = moreOnPage ? offset + BATCH : 0
        const windowExhausted = !hasNext && data.total_count > 1000 &&
          page === 10
        return reply({
          page, offset, perPage: 100, totalCount: data.total_count,
          hasNext, nextPage: hasNext ? nextPage : null,
          nextOffset: hasNext ? nextOffset : null, windowExhausted,
          items,
        })
      } catch (error) { return topicError(error) }
    },
  })
}
export default createTopicProjectsEndpoint()
