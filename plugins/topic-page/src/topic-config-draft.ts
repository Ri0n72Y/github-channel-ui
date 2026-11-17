import type { TopicSnapshot } from './service'

export const NEW_TOPIC_DRAFT = 'topic: your-topic\nwhitelist: true\n'
export type TopicConfigBase = Pick<TopicSnapshot, 'headSha' | 'configSha'>

/** @summary A late or retried metadata read cannot replace a user-edited draft. */
export function reconcileTopicDraft(existing:string, incoming:string|null, dirty:boolean){
  return dirty ? existing : (incoming ?? NEW_TOPIC_DRAFT)
}

/** @summary Pending PR remains locked until a later read proves main changed. */
export function sameTopicConfigBase(baseline:TopicConfigBase|null,
  latest:TopicConfigBase):boolean {
  return baseline!==null && baseline.headSha===latest.headSha &&
    baseline.configSha===latest.configSha
}
