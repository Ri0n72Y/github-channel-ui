import type { Context } from '@deepseek-ai/cordis'
import { lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import { createTopicPagePlugin } from '../../../plugins/topic-page/src/index'
import { createTopicFixtureService } from './topic-fixture'

const TopicSlugPage = lazy(() => import('../../../plugins/topic-page/src/TopicSlugPage'))

/** @summary The source-less slug route is available exclusively with the in-memory Playground service. */
export function createTopicFixturePlugin(query: URLSearchParams) {
  const api = createTopicFixtureService(query)
  const base = createTopicPagePlugin(api)
  return {
    ...base,
    apply(ctx: Context) {
      base.apply(ctx)
      function TopicSlugEntry() {
        const { slug = '' } = useParams<'slug'>()
        return <Suspense fallback={<p role="status">正在加载 Topic 样例…</p>}>
          <TopicSlugPage key={slug.toLowerCase()} slug={slug} api={api}/>
        </Suspense>
      }
      ctx.effect(() => ctx.reactUI.registerPage({
        id: 'topic-slug', path: '/topic/:slug', Component: TopicSlugEntry,
      }))
    },
  }
}
