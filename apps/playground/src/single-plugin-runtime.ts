import { Context } from '@deepseek-ai/cordis'
import { ReactUIService } from '../../../plugins/react-ui/src/index'
import { PLAYGROUND_PLUGINS } from './playground-paths.mjs'

/** Selected-plugin tests can stay isolated; browser fixture links mount only mock adapters. */
export async function startSinglePluginRuntime(selected: string, includeLinked = false) {
  const ctx = new Context()
  const fibers: Array<{dispose(): Promise<void>}> = []
  async function mount(plugin: Parameters<typeof ctx.plugin>[0]) {
    const fiber=ctx.plugin(plugin);fibers.push(fiber);await fiber
  }
  const dispose=async()=>{while(fibers.length)await fibers.pop()!.dispose()}
  try {
    if (!PLAYGROUND_PLUGINS.some(p=>p.slug===selected)) throw Error('Unknown fixture')
    await mount(ReactUIService)
    const query=new URLSearchParams(window.location.search)
    const session=(await import('./session-fixture')).createSessionFixture(query)
    const fixture=await import('./repo-panel-fixture')
    const issueApi=fixture.createRepoPanelFixtureApi(query)
    for(const slug of includeLinked ? PLAYGROUND_PLUGINS.map(p=>p.slug) : [selected]) {
      switch(slug) {
        case 'repo-panel': await mount(fixture.createRepoPanelFixturePlugin(query,issueApi));break
        case 'repo-home': await mount((await import('../../../plugins/repo-home/src/index')).createRepoHomePlugin(
          (await import('./repo-fixture')).createRepoFixtureService(query,session.isAuthenticated),{issueApi,theme:query.get('repoTheme')==='dark'?'dark':query.get('repoTheme')==='light'?'light':undefined}));break
        case 'repo-config': await mount((await import('../../../plugins/repo-config/src/index')).createRepoConfigPlugin(
          (await import('./config-fixture')).createRepoConfigFixtureService(query)));break
        case 'issue-detail': await mount((await import('../../../plugins/issue-detail/src/index')).createIssueDetailPlugin(
          (await import('./issue-fixture')).createIssueFixtureService(query.get('fixtureAuth')==='1')));break
        case 'channel': await mount((await import('../../../plugins/channel/src/index')).createChannelPlugin(
          (await import('./channel-fixture')).createChannelFixtureService(query)));break
        case 'topic-page': await mount((await import('./topic-fixture-plugin')).createTopicFixturePlugin(query));break
      }
    }
    return {ui:ctx.reactUI,sessionRequest:session.request,dispose}
  }catch(error){await dispose();throw error}
}
