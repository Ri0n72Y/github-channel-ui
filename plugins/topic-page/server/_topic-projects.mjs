import { requireTopicTarget, github, topicConfig, topicError, reply,
  publicRepository, TopicFetchError } from './_topic.mjs'
import { resolveInstalledRepository, ProbeError } from '../../github-access/server/_installation-probe.mjs'
import { loadTopicWhitelist } from './_topic-whitelist.mjs'

const BATCH = 25
const WORKERS = 5
const OWNER = /^[a-z\d-]{1,39}$/i
const REPO = /^[a-z\d._-]{1,100}$/i

/** @summary Keep only original image URLs hosted by GitHub itself. */
function trustedGitHubImage(value, hosts) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.includes(url.hostname) &&
      !url.username && !url.password ? url.href : null
  } catch { return null }
}
/** @summary Search IDs, public metadata and exact installation IDs must agree. */
function candidateIdentity(item) {
  if (!Number.isSafeInteger(item?.id) || item.id <= 0 || item.private !== false ||
      typeof item.full_name !== 'string' || typeof item.name !== 'string' ||
      typeof item.owner?.login !== 'string' || typeof item.html_url !== 'string') return null
  const owner = item.owner.login, name = item.name
  if (!OWNER.test(owner) || !REPO.test(name) ||
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
function notInstalled(error) {
  return error instanceof ProbeError && (
    error.message === 'Repository is not authorized for this App' ||
    error.message === 'Repository App installation is suspended' ||
    error.message === 'Public repository not found'
  )
}
/** @summary Never convert verification throttling, 403 denial or network failure to an empty result. */
async function verify(item, { fetcher, installationResolver, env }) {
  const identity = candidateIdentity(item)
  if (!identity) return null
  let installation
  try {
    installation = await installationResolver({ ...identity, env, fetcher })
  } catch (error) {
    if (notInstalled(error)) return null
    if (error instanceof ProbeError) throw new TopicFetchError(
      error.status === 429 ? 'Installation 核验限流，请稍后重试' :
        'Installation 核验暂不可用',
      error.status === 429 ? 429 : error.status === 503 ? 503 : 502, 'installation')
    throw new TopicFetchError('Installation 核验暂不可用', 502, 'installation')
  }
  if (installation?.repositoryId !== item.id ||
      !Number.isSafeInteger(installation.installationId) ||
      installation.installationId <= 0) throw new TopicFetchError(
    'Installation 核验仓库身份不一致', 502, 'installation')
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
/** @summary At most 25 candidate checks / 5 concurrent; each normal check uses 2 GitHub GETs. */
async function verifyBatch(items, args) {
  const results = Array(items.length)
  let cursor = 0
  let failed = null
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const i = cursor++
      try { results[i] = await verify(items[i], args) }
      catch (error) { failed = error }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKERS, items.length) },
    () => worker()))
  if (failed) throw failed
  return results.filter(Boolean)
}
/** @summary Search one 100-result GitHub page and verify one bounded candidate slice. */
export function createTopicProjectsEndpoint({
  fetcher = fetch, env = process.env, installationResolver = resolveInstalledRepository,
} = {}) {
  return Object.freeze({
    async fetch(request) {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405)
      try {
        const { owner, repo, page } = requireTopicTarget(request, true)
        const query = new URL(request.url).searchParams
        const rawOffset = query.get('offset') || '0'
        if (!/^(?:0|25|50|75)$/.test(rawOffset)) throw new TopicFetchError(
          '无效的 Topic Search 游标', 400, 'topic-search')
        const offset = Number(rawOffset), args = { fetcher }
        await publicRepository(owner, repo, args)
        const config = await topicConfig(owner, repo, args)
        // Whitelist constrains already-installed candidates; disabling it never
        // disables the App Installation check or public repository verification.
        const sourceAllow = await loadTopicWhitelist(owner,repo,config,{fetcher})
        const allowedNames = sourceAllow ? new Set(sourceAllow) : null
        const data = await github('/search/repositories?q=topic:' +
          encodeURIComponent(config.topic) + '&sort=updated&order=desc&per_page=100&page=' +
          page, { ...args, stage: 'topic-search' })
        if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
            !Array.isArray(data.items) || data.items.length > 100) throw new TopicFetchError(
          'GitHub Topic Search 响应无效', 502, 'topic-search')
        if (data.incomplete_results === true) throw new TopicFetchError(
          'GitHub Topic Search 结果不完整，请重试读取', 502, 'topic-search')
        const accessible = Math.min(data.total_count, 1000)
        const searched = data.items.slice(offset, offset + BATCH)
        const candidates = searched.filter(item=>
          !allowedNames || (typeof item?.full_name==='string' &&
            allowedNames.has(item.full_name.toLowerCase())))
        // Missing or invalid metadata is never grounds to infer an installation.
        const items = await verifyBatch(candidates, {
          fetcher, env, installationResolver,
        })
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
