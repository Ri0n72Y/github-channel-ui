import type { Context } from '@deepseek-ai/cordis'
import { lazy, Suspense, type ComponentType } from 'react'
import { useParams } from 'react-router'
import { memberRegistrationScope } from './domain.mjs'
import type { RepoHomeTheme } from './RepoHomePage'
import { repoHomeApi, memberWriteBranch, type RepoHomeApi } from './service'
const RepoHomePage = lazy(() => import('./RepoHomePage'))
const MembersPage = lazy(() => import('./MembersPage'))
const MemberRegisterPage = lazy(() => import('./MemberRegisterPage'))
const RepoIssueCreatePage = lazy(() => import('./RepoIssueCreatePage'))
/** @summary Remount the registration draft by repository and authorized member-write branch. */
function ScopedMemberRegisterPage({ api }: { api: RepoHomeApi }) {
  const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
  const scope = memberRegistrationScope(owner, repo, memberWriteBranch)
  return <MemberRegisterPage key={scope} api={api} />
}
/** @summary Register the independently testable Repo homepage, team listing and registration routes. */
export function createRepoHomePlugin(api: RepoHomeApi = repoHomeApi,
  options: { theme?: RepoHomeTheme } = {}) {
  return { name: 'repo-home', inject: ['reactUI'], apply(ctx: Context) {
    const register = (id: string, path: string, Component: ComponentType<{ api: RepoHomeApi }>) => {
      function Entry() {
        return <Suspense fallback={<p role="status">正在加载项目页面…</p>}><Component api={api} /></Suspense>
      }
      ctx.effect(() => ctx.reactUI.registerPage({ id, path, Component: Entry }))
    }
    function HomeWithVisualTheme({ api }: { api: RepoHomeApi }) {
      const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
      return <RepoHomePage key={owner + '/' + repo} api={api} theme={options.theme} />
    }
    register('repo-home', '/:owner/:repo', HomeWithVisualTheme)
    register('repo-home-members', '/:owner/:repo/members', MembersPage)
    register('repo-home-register', '/:owner/:repo/members/register', ScopedMemberRegisterPage)

    function ScopedIssueCreatePage() {
      const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
      return <RepoIssueCreatePage key={owner + '/' + repo} owner={owner} repo={repo} />
    }
    ctx.effect(() => ctx.reactUI.registerPage({
      id: 'repo-home-issue-create',
      path: '/:owner/:repo/issues/new',
      Component: () => <Suspense fallback={<p role="status">正在加载创建 Issue 页面…</p>}>
        <ScopedIssueCreatePage />
      </Suspense>,
    }))

  } }
}
export const repoHome = createRepoHomePlugin()
