import type { Context } from '@deepseek-ai/cordis'
import { RepoPanel } from '../../../plugins/repo-panel/src/index'
import { createRepoIssuesStore } from '../../../plugins/repo-issues/src/index'
import type { Repo, Issue, RepoIssuesApi } from '../../../plugins/repo-issues/src/api'

/** @summary Render the existing Repo Panel with in-memory data only. */
export function createRepoPanelFixturePlugin(query: URLSearchParams) {
  return {
    name: 'repo-panel-fixture',
    inject: ['reactUI'],
    apply(ctx: Context) {
      const repos: readonly Repo[] = [
        { owner: 'sample', name: 'repo', full_name: 'sample/repo' },
        { owner: 'sample', name: 'second', full_name: 'sample/second' },
      ]
      const issues: Record<string, Issue[]> = {
        repo: [
          { number: 1, title: '受控 Issue：劳动记录', comments: 3,
            html_url: 'https://github.com/octocat/Hello-World/issues/1' },
          { number: 2, title: '受控 Issue：需求讨论', comments: 1,
            html_url: 'https://github.com/octocat/Hello-World/issues/2' },
        ],
        second: [{ number: 3, title: '第二仓库的受控 Issue', comments: 0,
          html_url: 'https://github.com/octocat/Hello-World/issues/3' }],
      }
      const authorized = query.get('fixtureAuth') === '1'
      const api: Readonly<RepoIssuesApi> = Object.freeze({
        async getRepositories(signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          return repos
        },
        async getIssues(_owner: string, name: string, signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          return [...(issues[name] || [])]
        },
        async getSession(signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          return authorized
        },
        async verify(owner: string, name: string, signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          return { user: { id: 1, login: 'fixture-user' },
            repository: { full_name: owner + '/' + name, accessible: true,
              permissions: { admin: false, maintain: false, push: false,
                triage: true, pull: true } } }
        },
        async createIssue(target: Repo, title: string, _body: string, signal: AbortSignal) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
          if (!authorized) throw new Error('Fixture 未授权，不能创建 Issue')
          const list = issues[target.name] || (issues[target.name] = [])
          const number = list.reduce((max, item) => Math.max(max, item.number), 0) + 1
          list.push({ number, title, comments: 0,
            html_url: 'https://github.com/octocat/Hello-World/issues/' + number })
          return { number, html_url: 'https://github.com/octocat/Hello-World/issues/' + number }
        },
      })
      const store = createRepoIssuesStore(api)
      function Entry() {
        return <RepoPanel store={store} />
      }
      ctx.effect(() => ctx.reactUI.registerPage({
        id: 'repo-panel', path: '/', Component: Entry,
      }))
      ctx.effect(() => () => store.dispose())
    },
  }
}
