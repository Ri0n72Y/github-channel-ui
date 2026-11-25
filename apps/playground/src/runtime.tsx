import { Context } from '@deepseek-ai/cordis'
import { ReactUIService } from '../../../plugins/react-ui/src/index'
import { RepoIssuesService } from '../../../plugins/repo-issues/src/index'
import { repoPanel } from '../../../plugins/repo-panel/src/index'
import { repoHome } from '../../../plugins/repo-home/src/index'
import { repoConfig } from '../../../plugins/repo-config/src/index'
import { createIssueDetailPlugin } from '../../../plugins/issue-detail/src/index'
import { channel } from '../../../plugins/channel/src/index'
import { topicPage } from '../../../plugins/topic-page/src/index'

/** Real resource composition; URL query never selects a fixture. */
export async function startRuntime() {
  const ctx = new Context()
  const fibers: Array<{dispose(): Promise<void>}> = []
  const dispose=async()=>{while(fibers.length)await fibers.pop()!.dispose()}
  try {
    async function mount(plugin: Parameters<typeof ctx.plugin>[0]){const fiber=ctx.plugin(plugin);fibers.push(fiber);await fiber}
    await mount(ReactUIService);await mount(RepoIssuesService);await mount(repoPanel);await mount(repoHome)
    await mount(repoConfig);await mount(createIssueDetailPlugin());await mount(channel);await mount(topicPage)
    return {ui:ctx.reactUI,dispose}
  }catch(error){await dispose();throw error}
}
