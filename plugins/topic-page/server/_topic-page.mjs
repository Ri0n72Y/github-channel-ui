import { requireTopicTarget, github, repoPath, content, publicRepository,
  encodedContent, topicError, TopicFetchError, reply } from './_topic.mjs'
import { parseTopicYaml } from '../src/domain.mjs'
import { loadTopicWhitelist } from './_topic-whitelist.mjs'

/** @summary Read a public Topic source and safely diagnose malformed project declarations. */
export function createTopicPageEndpoint({ fetcher = fetch, logger = console } = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405)
      try {
        const { owner, repo } = requireTopicTarget(request)
        const args = { fetcher }
        const repository = await publicRepository(owner, repo, args)
        const readme = await content(owner, repo, 'README.md', { ...args, stage: 'readme' })
        const branch = repository.default_branch
        if (typeof branch !== 'string' || !branch || branch.length > 250)
          throw new TopicFetchError('仓库默认分支无效', 502, 'config')
        const branchData = await github(repoPath(owner, repo,
          '/branches/' + encodeURIComponent(branch)), { ...args, stage: 'config' })
        const headSha = branchData?.commit?.sha
        if (!/^[a-f\d]{40}$/i.test(headSha || ''))
          throw new TopicFetchError('仓库 HEAD 无效', 502, 'config')
        let config = null, configText = null, configSha = null
        try {
          const source = await github(repoPath(owner, repo,
            '/contents/topics.config.yaml?ref=' + encodeURIComponent(branch)),
            { ...args, stage: 'config' })
          configText = encodedContent(source, 'config')
          configSha = source.sha
          if (!/^[a-f\d]{40}$/i.test(configSha || ''))
            throw new TopicFetchError('Topic 文件 SHA 无效', 502, 'config')
          try { config = parseTopicYaml(configText) }
          catch { throw new TopicFetchError('topics.config.yaml 格式或字段无效', 422, 'config') }
        } catch (error) {
          if (!(error instanceof TopicFetchError &&
            error.status === 404 && error.stage === 'config')) throw error
        }
        let coverUrl = null
        try {
          const cover = await github(repoPath(owner, repo, '/contents/cover.jpg'),
            { ...args, stage: 'cover' })
          if (cover?.type === 'file' && typeof cover.download_url === 'string') {
            const u = new URL(cover.download_url)
            if (u.protocol === 'https:' &&
                ['raw.githubusercontent.com', 'github.com'].includes(u.hostname)) {
              coverUrl = u.href
            }
          }
        } catch (error) {
          if (!(error instanceof TopicFetchError && error.status === 404)) throw error
        }
        const allowedRepositories = await loadTopicWhitelist(owner,repo,config,
          {fetcher,logger}) || []
        return reply({
          repository: { owner, name: repo, full_name: repository.full_name,
            html_url: repository.html_url },
          readme, coverUrl, config, configState: config ? 'ready' : 'missing',
          configText, configSha, headSha, defaultBranch: branch,
          allowedRepositories: [...new Set(allowedRepositories)],
        })
      } catch (error) { return topicError(error) }
    },
  }
}
export default createTopicPageEndpoint()
