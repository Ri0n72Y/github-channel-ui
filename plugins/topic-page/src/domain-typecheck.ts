import { accumulateTopicProjects, loadTopicProjectCandidates, parseTopicYaml } from './domain.mjs'
import type { TopicProjectsPage, TopicRepository, TopicSnapshot } from './service'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Expect<T extends true> = T

/**
 * @summary Compile-only regression for exact Topic YAML modes and untruncated search records.
 * The existing npm run build type-checks plugin TypeScript sources; this function is never invoked.
 */
export async function checkTopicDomainTypes(
  snapshot: TopicSnapshot, page: TopicProjectsPage, signal: AbortSignal
) {
  const config = parseTopicYaml('topic: labourchain', 'config')
  const defaultConfig = parseTopicYaml('topic: labourchain')
  const project = parseTopicYaml('repository: owner/repo', 'project')
  const topic: string = config.topic
  const whitelist: boolean = defaultConfig.whitelist
  const repository: string = project.repository
  const cover: string | undefined = config.cover

  // @ts-expect-error project YAML does not return topic or whitelist.
  project.topic
  // @ts-expect-error project declarations do not accept activity cover.
  project.cover
  // @ts-expect-error config YAML does not return a repository.
  config.repository
  type _ProjectResultExact = Expect<Equal<typeof project, { repository: string }>>
  type _ConfigResultExact = Expect<Equal<typeof config, { topic: string; whitelist: boolean; cover?: string }>>
  type _DefaultConfigResultExact = Expect<Equal<typeof defaultConfig, typeof config>>
  type _SnapshotConfigExact = Expect<Equal<NonNullable<TopicSnapshot['config']>, typeof config>>

  const summary = accumulateTopicProjects(snapshot, [page])
  const loaded = await loadTopicProjectCandidates(snapshot, async () => page, signal)
  type _AccumulatorPreservesRecords = Expect<Equal<(typeof summary.items)[number], TopicRepository>>
  type _LoaderPreservesRecords = Expect<Equal<(typeof loaded.items)[number], TopicRepository>>

  const firstProject: TopicRepository = loaded.items[0]
  const stars: number = firstProject.stargazers_count
  const language: string | null = firstProject.language
  const pagesRead: number = loaded.pagesRead
  return { topic, whitelist, cover, repository, stars, language, pagesRead }
}
