import { Context } from '@deepseek-ai/cordis'
import { ReactUIService } from '../../../plugins/react-ui/src/index'

/** @summary Mount one selected public plugin with controlled fixtures; never launch hosted composition. */
export async function startSinglePluginRuntime(selectedOverride?: string) {
  const ctx = new Context()
  const fibers: Array<{ dispose(): Promise<void> }> = []
  async function mount(plugin: Parameters<typeof ctx.plugin>[0]) {
    const fiber = ctx.plugin(plugin)
    fibers.push(fiber)
    await fiber
  }
  const dispose = async () => { while (fibers.length) await fibers.pop()!.dispose() }
  try {
    await mount(ReactUIService)
    const query = new URLSearchParams(window.location.search)
    const selected = selectedOverride ?? query.get('plugin')
    const session = selectedOverride || query.get('sessionFixture') === '1'
      ? (await import('./session-fixture')).createSessionFixture(query) : undefined
    switch (selected) {
      case 'repo-panel':
        if (selectedOverride) {
          await mount((await import('./repo-panel-fixture')).createRepoPanelFixturePlugin(query))
        } else {
          const { RepoIssuesService } = await import('../../../plugins/repo-issues/src/index')
          const { repoPanel } = await import('../../../plugins/repo-panel/src/index')
          await mount(RepoIssuesService)
          await mount(repoPanel)
        }
        break
      case 'repo-home':
        await mount((await import('../../../plugins/repo-home/src/index')).createRepoHomePlugin((await import('./repo-fixture'))
          .createRepoFixtureService(query, session?.isAuthenticated)))
        break
      case 'repo-config':
        await mount((await import('../../../plugins/repo-config/src/index')).createRepoConfigPlugin((await import('./config-fixture'))
          .createRepoConfigFixtureService(query)))
        break
      case 'issue-detail':
        await mount((await import('../../../plugins/issue-detail/src/index')).createIssueDetailPlugin((await import('./issue-fixture'))
          .createIssueFixtureService(query.get('fixtureAuth') === '1')))
        break
      case 'channel':
        await mount((await import('../../../plugins/channel/src/index')).createChannelPlugin((await import('./channel-fixture'))
          .createChannelFixtureService(query)))
        break
      case 'topic-page':
        await mount((await import('../../../plugins/topic-page/src/index')).createTopicPagePlugin((await import('./topic-fixture'))
          .createTopicFixtureService(query)))
        break
      default:
        throw new Error('Unknown standalone plugin: ' + selected)
    }
    return { ui: ctx.reactUI, sessionRequest: session?.request, dispose }
  } catch (error) { await dispose(); throw error }
}
