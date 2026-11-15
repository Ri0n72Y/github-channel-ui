import { requireTopicTarget, github, topicConfig, topicError, reply,
  publicRepository, TopicFetchError } from './_topic.mjs'

/** @summary Use only original GitHub-hosted imagery when Search includes it. */
function trustedGitHubImage(value, hosts) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && hosts.includes(url.hostname) &&
      !url.username && !url.password ? url.href : null
  } catch { return null }
}

/** @summary Fetch one public GitHub Topic Search page, exposing the 1000-result window boundary. */
export function createTopicProjectsEndpoint({ fetcher = fetch } = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405)
      try {
        const { owner, repo, page } = requireTopicTarget(request, true)
        const args = { fetcher }
        await publicRepository(owner, repo, args)
        const config = await topicConfig(owner, repo, args)
        const data = await github('/search/repositories?q=topic:' +
          encodeURIComponent(config.topic) + '&sort=updated&order=desc&per_page=100&page=' +
          page, { ...args, stage: 'topic-search' })
        if (!data || !Number.isSafeInteger(data.total_count) || data.total_count < 0 ||
            !Array.isArray(data.items)) throw new TopicFetchError(
          'GitHub Topic Search 响应无效', 502, 'topic-search')
        // GitHub may return HTTP 200 with incomplete_results on a timed-out Search.
        // Never interpret a partial candidate set as a complete or empty result.
        if (data.incomplete_results === true) throw new TopicFetchError(
          'GitHub Topic Search 结果不完整，请重试读取', 502, 'topic-search')
        const accessible = Math.min(data.total_count, 1000)
        const hasNext = page * 100 < accessible
        return reply({
          page, perPage: 100, totalCount: data.total_count, hasNext,
          windowExhausted: data.total_count > 1000 && !hasNext,
          items: data.items.filter(item =>
            item && typeof item.full_name === 'string' && typeof item.name === 'string' &&
            typeof item.html_url === 'string' && item.private !== true).map(item => ({
            full_name: item.full_name, name: item.name, owner: item.owner?.login || null,
            description: item.description || '', html_url: item.html_url,
            stargazers_count: item.stargazers_count || 0,
            language: item.language || null,
            ...(() => {
              const ownerAvatar = trustedGitHubImage(item.owner?.avatar_url,
                ['avatars.githubusercontent.com'])
              const cover = trustedGitHubImage(item.open_graph_image_url,
                ['opengraph.githubassets.com', 'repository-images.githubusercontent.com'])
              return {
                ...(ownerAvatar ? { owner_avatar_url: ownerAvatar } : {}),
                ...(cover ? { cover_url: cover } : {}),
              }
            })(),
          })),
        })
      } catch (error) { return topicError(error) }
    },
  }
}
export default createTopicProjectsEndpoint()
