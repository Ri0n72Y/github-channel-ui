import { requireTopicTarget, topicError, TopicFetchError, reply } from './_topic.mjs'
import { createTopicSourceStore, topicSourceStore } from './_topic-source.mjs'

export function createTopicPageEndpoint({fetcher=fetch,logger=console,
  store=fetcher===fetch && logger===console?topicSourceStore:createTopicSourceStore({fetcher,logger})}={}) {
  return Object.freeze({
    async fetch(request) {
      if (request.method !== 'GET') return reply({error:'Method not allowed'},405)
      try {
        const {owner,repo}=requireTopicTarget(request)
        const query=new URL(request.url).searchParams
        if (query.getAll('owner').length!==1 || query.getAll('repo').length!==1 ||
            query.has('topic') || query.getAll('refresh').length>1 ||
            query.has('refresh') && query.get('refresh')!=='1')
          throw new TopicFetchError('Topic 来源参数无效',400,'route')
        return reply(await store.snapshot(owner,repo,query.get('refresh')==='1'))
      } catch(error) { return topicError(error) }
    }
  })
}
export default createTopicPageEndpoint()
