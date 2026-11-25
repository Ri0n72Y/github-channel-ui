import { ProbeError, resolveInstalledRepository, validRepository, isGitHubRateLimited } from './_installation-probe.mjs'

const GH = 'https://api.github.com'
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'LabourChain-IssueDetail' }

export class IssueAccessError extends Error {
  constructor(message, status = 502, state) {
    super(message)
    this.status = status
    if(state)this.state=state
  }
}

async function upstreamStatus(response) {
  if (await isGitHubRateLimited(response)) return 429
  if ([400, 401, 403, 404, 409, 410, 422, 429].includes(response.status)) return response.status
  return response.status >= 500 ? 503 : 502
}

function upstreamMessage(status) {
  if (status === 429) return 'GitHub API rate limit reached'
  if (status === 403) return 'GitHub App lacks permission for this repository'
  if (status === 404) return 'Repository or Issue not found'
  if (status === 401) return 'GitHub App authorization expired'
  if (status === 503 || status === 502) return 'GitHub is temporarily unavailable'
  return 'GitHub request failed'
}

export function issueError(error) {
  const status = error instanceof ProbeError || error instanceof IssueAccessError
    ? error.status : 502
  return Response.json({ error: error instanceof ProbeError || error instanceof IssueAccessError
    ? error.message : 'Issue service temporarily unavailable',
    ...((error instanceof ProbeError || error instanceof IssueAccessError) && error.state ? { state: error.state } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } })
}

async function makeRequest(fetcher, url, init) {
  try {
    return await fetcher(url, { ...init, redirect: 'manual',
      signal: AbortSignal.timeout(10000) })
  } catch {
    throw new IssueAccessError('GitHub request could not be completed', 502)
  }
}

/** @summary Verify the current App installation independently of optional read grants. */
async function inspectInstallationReadGrants(fetcher, resolved, owner) {
  const response = await makeRequest(fetcher,
    GH + '/app/installations/' + resolved.installationId, {
      headers: { ...HEADERS, Authorization: 'Bearer ' + resolved.jwt },
    })
  if (response.status !== 200) {
    const status = await upstreamStatus(response)
    throw new IssueAccessError(status === 404 ?
      'Repository App installation is no longer available' : upstreamMessage(status),
      status === 404 ? 403 : status, status===404?'repo_access_required':undefined)
  }
  let installation
  try { installation = await response.json() }
  catch { throw new IssueAccessError('Invalid GitHub App installation response') }
  if (installation?.id !== resolved.installationId ||
      typeof installation.account?.login !== 'string' ||
      installation.account.login.toLowerCase() !== owner.toLowerCase()) {
    throw new IssueAccessError('Repository App installation is invalid or suspended', 403)
  }
  if(installation.suspended_at)throw new IssueAccessError('Repository App installation is suspended',403,'installation_suspended')
  // A missing individual grant means public GET must not request it.
  // An unreadable permissions object makes the Installation check inconclusive.
  if (!installation.permissions || typeof installation.permissions !== 'object' ||
      Array.isArray(installation.permissions)) {
    throw new IssueAccessError('GitHub App installation permission check failed', 502)
  }
  return installation.permissions
}

/** @summary Permit only known public GitHub GET resources under the verified repository. */
export function readAuthorizationHeaders(access, path) {
  if (typeof access?.token === 'string' && access.token) {
    return { Authorization: 'Bearer ' + access.token }
  }
  if (access?.anonymous !== true || typeof access.owner !== 'string' ||
      typeof access.repo !== 'string' || typeof path !== 'string' || !path.startsWith('/')) {
    throw new IssueAccessError('Public repository read authorization unavailable', 403)
  }
  let uri
  try { uri = new URL(GH + path) }
  catch { throw new IssueAccessError('Invalid public repository read path', 400) }
  const base = '/repos/' + encodeURIComponent(access.owner) + '/' +
    encodeURIComponent(access.repo)
  const suffix = uri.pathname.startsWith(base) ? uri.pathname.slice(base.length) : null
  const allowed = suffix === '' || suffix === '/readme' || suffix === '/issues' ||
    suffix === '/labels' ||
    /^\/branches\/[^/]+$/.test(suffix || '') ||
    /^\/contents\/[a-z\d._/%-]+$/i.test(suffix || '') ||
    /^\/issues\/[1-9]\d*(?:\/comments)?$/.test(suffix || '')
  if (!allowed || uri.origin !== GH || uri.hash || uri.username || uri.password) {
    throw new IssueAccessError('Public read path is outside the verified repository', 403)
  }
  return {}
}

/** @summary Classify token 422 by allowlisted fields, never exposing GitHub messages or secrets. */
async function token422Reason(response) {
  let body
  try { body = await response.clone().json() }
  catch { return 'Installation token request rejected by GitHub (422)' }
  const fields = Array.isArray(body?.errors) ? body.errors.map(error => error?.field) : []
  if (fields.some(field => field === 'permissions')) {
    return 'Installation token permission scope rejected by GitHub (422)'
  }
  if (fields.some(field => field === 'repository_ids' || field === 'repositories')) {
    return 'Installation token repository scope rejected by GitHub (422)'
  }
  return 'Installation token request rejected by GitHub (422)'
}

/** @summary Read an installed public repository with minimal token grants or safe public GET. */
export async function issueReadAccess({
  owner, repo, env = process.env, fetcher = fetch,
  permissions = ['issues', 'contents'],
}) {
  if (!Array.isArray(permissions) || permissions.length < 1 ||
      permissions.some(p => p !== 'issues' && p !== 'contents') ||
      new Set(permissions).size !== permissions.length) {
    throw new IssueAccessError('Invalid public read permission selection', 400)
  }
  const resolved = await resolveInstalledRepository({ owner, repo, env, fetcher })
  const grants = await inspectInstallationReadGrants(fetcher, resolved, owner)
  // No App permission downgrade or blind token retry: publicly readable GitHub
  // resources can be fetched anonymously after the exact installation check.
  if (permissions.some(p => !['read', 'write'].includes(grants[p]))) {
    return { token: null, anonymous: true, owner, repo, fetcher }
  }
  const response = await makeRequest(fetcher,
    GH + '/app/installations/' + resolved.installationId + '/access_tokens', {
      method: 'POST',
      headers: { ...HEADERS, Authorization: 'Bearer ' + resolved.jwt,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ repository_ids: [resolved.repositoryId],
        // Metadata read is implicit for GitHub Apps; request only required scopes.
        permissions: Object.fromEntries(permissions.map(p => [p, 'read'])) }),
    })
  if (response.status !== 201) {
    const status = await upstreamStatus(response)
    throw new IssueAccessError(status === 422 ?
      await token422Reason(response) : upstreamMessage(status), status)
  }
  let result
  try { result = await response.json() }
  catch { throw new IssueAccessError('Invalid GitHub App token response') }
  if (typeof result?.token !== 'string' || !result.token) {
    throw new IssueAccessError('Invalid GitHub App token response')
  }
  // Reject any conflicting repository listing rather than using a broader token.
  if (Array.isArray(result.repositories) &&
      (result.repositories.length !== 1 ||
        result.repositories[0]?.id !== resolved.repositoryId)) {
    throw new IssueAccessError('Installation token repository scope mismatch', 502)
  }
  return { token: result.token, fetcher }
}

/** @summary Relay the unchanged GitHub resource and pagination headers through the trusted Function. */
export async function issueGitHubGet(access, path) {
  const response = await makeRequest(access.fetcher, GH + path, {
    headers: { ...HEADERS, ...readAuthorizationHeaders(access, path) },
  })
  if (!response.ok) {
    const status = await upstreamStatus(response)
    throw new IssueAccessError(upstreamMessage(status), status)
  }
  let data
  try { data = await response.json() }
  catch { throw new IssueAccessError('Invalid GitHub response') }
  return { data, link: response.headers.get('link') || '' }
}

export function issueQuery(request, { number = false, pagination = false } = {}) {
  const p = new URL(request.url).searchParams
  const owner = p.get('owner'), repo = p.get('repo'), n = p.get('number')
  if (!validRepository(owner, repo) || (number && (!/^[1-9]\d*$/.test(n || '') ||
      !Number.isSafeInteger(Number(n))))) {
    throw new IssueAccessError('Invalid repository or Issue number', 400)
  }
  let page = 1
  if (pagination) {
    const raw = p.get('page') || '1'
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) ||
        Number(raw) > 100000) throw new IssueAccessError('Invalid comments page', 400)
    page = Number(raw)
  }
  return { owner, repo, number: Number(n), page }
}

export function issueResponse(data, link = '') {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (link) headers.set('Link', link)
  return Response.json(data, { headers })
}
