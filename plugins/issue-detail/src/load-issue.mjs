import { validIssueForPage } from './domain.mjs'

/** @summary Load one universal GitHub Issue and its first comment page without Config reads. */
export async function loadIssueContent(service, owner, repo, number, signal) {
  signal.throwIfAborted()
  const issue = await service.getIssue(owner, repo, number, signal)
  signal.throwIfAborted()
  if (!validIssueForPage(issue) || issue.number !== number) return null
  const first = await service.getComments(owner, repo, number, 1, signal)
  signal.throwIfAborted()
  return { issue, first }
}
