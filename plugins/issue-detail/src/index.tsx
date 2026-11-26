import { resourcePath } from '../../repo-issues/src/target.mjs'
import { UnsupportedRepositoryRoute } from '../../repo-issues/src/RepositoryLink'
import type { Context } from '@deepseek-ai/cordis'
import { lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import { issueDetailApi, type IssueDetailApi } from './service'

const IssueDetailPage = lazy(() => import('./IssueDetailPage'))

/** @summary Register a lazy, independently removable Issue detail page in the shared UI host. */
export function createIssueDetailPlugin(service: IssueDetailApi = issueDetailApi) {
  return {
    name: 'issue-detail',
    inject: ['reactUI'],
    apply(ctx: Context) {
      function IssueDetailEntry() {
        const { owner = '', repo = '', number = '' } = useParams<'owner' | 'repo' | 'number'>()
        const routeKey = owner + '/' + repo + '/issues/' + number
        if(!resourcePath(owner,repo,'issue',Number(number))||!/^[1-9]\d*$/.test(number))return <UnsupportedRepositoryRoute/>
        return <Suspense fallback={<p role="status">正在加载讨论…</p>}>
          <IssueDetailPage key={routeKey} service={service} />
        </Suspense>
      }
      ctx.effect(() => ctx.reactUI.registerPage({
        id: 'issue-detail',
        path: '/:owner/:repo/issues/:number',
        Component: IssueDetailEntry,
      }))
    },
  }
}
