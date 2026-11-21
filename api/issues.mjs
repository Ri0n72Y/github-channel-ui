import { issueReadAccess, issueGitHubGet, issueError, IssueAccessError } from './_issue-access.mjs'
import { validRepository } from './_installation-probe.mjs'
import { json } from './_github.mjs'

function exactIssue(item, owner, repo) {
  if (!Number.isSafeInteger(item?.number) || item.number < 1 ||
      typeof item?.title !== 'string' ||
      !Number.isSafeInteger(item?.comments) || item.comments < 0 ||
      typeof item?.html_url !== 'string') {
    throw new IssueAccessError('Invalid GitHub Issue response', 502)
  }
  try {
    const url = new URL(item.html_url)
    if (url.origin !== 'https://github.com' || url.username || url.password ||
        url.search || url.hash ||
        url.pathname.toLowerCase() !== ('/' + owner + '/' + repo + '/issues/' +
          item.number).toLowerCase()) throw Error('URL mismatch')
  } catch {
    throw new IssueAccessError('Invalid GitHub Issue URL', 502)
  }
  return { number: item.number, title: item.title,
    html_url: item.html_url, comments: item.comments }
}
const HAS_NEXT = /<[^>]+>;\s*rel="next"/i

/** @summary Read one explicitly selected installed public repo, with no fixed installation ID. */
export function createIssuesHandler({ readAccess = issueReadAccess,
  githubGet = issueGitHubGet } = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      const p = new URL(request.url).searchParams
      const owner = p.get('owner'), repo = p.get('repo')
      if (!validRepository(owner, repo)) {
        return json({ error: 'Provide an exact GitHub repository owner and name' }, 400)
      }
      try {
        const access = await readAccess({ owner, repo, permissions: ['issues'] })
        const issues = []
        const seen = new Set()
        for (let page = 1; page <= 5; page++) {
          const path = '/repos/' + encodeURIComponent(owner) + '/' +
            encodeURIComponent(repo) + '/issues?state=open&per_page=100&page=' + page
          const result = await githubGet(access, path)
          if (!Array.isArray(result?.data) || typeof result.link !== 'string') {
            throw new IssueAccessError('Invalid GitHub Issues page', 502)
          }
          for (const row of result.data) {
            if (row?.pull_request != null) continue
            const issue = exactIssue(row, owner, repo)
            if (seen.has(issue.number)) continue
            seen.add(issue.number)
            issues.push(issue)
          }
          if (!HAS_NEXT.test(result.link)) return json({ issues })
        }
        throw new IssueAccessError('GitHub Issues exceed the verified 500-item read window', 409)
      } catch (error) {
        return issueError(error)
      }
    },
  }
}
export default createIssuesHandler()
