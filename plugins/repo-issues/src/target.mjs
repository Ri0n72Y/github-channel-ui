/** @summary Parse only an exact public GitHub repository URL; never accept credentials or URL subpaths. */
export function parseGitHubRepositoryUrl(input) {
  if (typeof input !== 'string') return null
  const value = input.trim()
  // Validate the original spelling before URL() can normalize dot-segments,
  // escaped slashes, default ports, credentials or a misleading query/hash.
  const match = /^https:\/\/github\.com\/([a-z\d-]{1,39})\/([a-z\d._-]{1,100})\/?$/i.exec(value)
  if (!match) return null
  const [, owner, repo] = match
  if (owner.startsWith('-') || owner.endsWith('-') || repo === '.' || repo === '..') return null
  return Object.freeze({ owner, name: repo, full_name: owner + '/' + repo,
    url: 'https://github.com/' + owner + '/' + repo })
}
