import endpoint1 from '../plugins/repo-home/server/_repo-home.mjs'
import endpoint2 from '../plugins/repo-home/server/_repo-feed.mjs'
import endpoint3 from '../plugins/repo-home/server/_repo-member-permission.mjs'
import endpoint4 from '../plugins/repo-home/server/_repo-member-register.mjs'
import endpoint5 from '../plugins/github-access/server/_github-installation-probe.mjs'
import endpoint6 from '../plugins/repo-config/server/_repo-config.mjs'
import endpoint7 from '../plugins/channel/server/_repo-channels.mjs'
import topicPage from '../plugins/topic-page/server/_topic-page.mjs'
import topicProjects from '../plugins/topic-page/server/_topic-projects.mjs'
import topicReport from '../plugins/topic-page/server/_topic-report.mjs'
import topicConfig from '../plugins/topic-page/server/_topic-config.mjs'

const handlers = Object.freeze({
  'repo-home': endpoint1,
  'repo-feed': endpoint2,
  'repo-member-permission': endpoint3,
  'repo-member-register': endpoint4,
  'github-installation-probe': endpoint5,
  'repo-config': endpoint6,
  'repo-channels': endpoint7,
  'topic-page': topicPage,
  'topic-projects': topicProjects,
  'topic-report': topicReport,
  'topic-config': topicConfig,
})

/** @summary Preserve each original API handler while sharing one Vercel Function slot. */
export default {
  fetch(request) {
    const route = new URL(request.url).searchParams.get('__lc_route')
    const handler = Object.hasOwn(handlers, route) ? handlers[route] : null
    return handler ? handler.fetch(request) :
      Response.json({ error: 'API route not found' }, { status: 404 })
  },
}
