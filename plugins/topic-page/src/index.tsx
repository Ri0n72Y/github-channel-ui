import type { Context } from '@deepseek-ai/cordis'
import { lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import { topicPageApi, type TopicPageApi } from './service'
import { topicTargetKey } from './domain.mjs'

const TopicPageContainer = lazy(() => import('./TopicPageContainer'))
const TopicSlugPage = lazy(() => import('./TopicSlugPage'))

/** @summary Register TopicPage as an independent route in the existing shared Router. */
export function createTopicPagePlugin(api: TopicPageApi = topicPageApi) {
  return {
    name: 'topic-page',
    inject: ['reactUI'],
    apply(ctx: Context) {
      function TopicEntry() {
        const { owner = '', repo = '' } = useParams<'owner' | 'repo'>()
        return <Suspense fallback={<p role="status">正在加载 TopicPage…</p>}>
          <TopicPageContainer key={topicTargetKey(owner, repo)} owner={owner}
            repo={repo} api={api}/>
        </Suspense>
      }
      function TopicSlugEntry() {
        const { slug = '' } = useParams<'slug'>()
        return <Suspense fallback={<p role="status">正在加载 GitHub Topic…</p>}>
          <TopicSlugPage key={slug.toLowerCase()} slug={slug} api={api}/>
        </Suspense>
      }
      ctx.effect(() => ctx.reactUI.registerPage({
        id: 'topic-page', path: '/topic/:owner/:repo', Component: TopicEntry,
      }))
      ctx.effect(() => ctx.reactUI.registerPage({
        id: 'topic-slug', path: '/topic/:slug', Component: TopicSlugEntry,
      }))
    },
  }
}
export const topicPage = createTopicPagePlugin()
