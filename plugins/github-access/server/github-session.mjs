import { oauthHeaders, readSession } from './_oauth.mjs'
import { github } from './_issue-interaction.mjs'
import { createGithubLogoutHandler } from './_github-logout.mjs'
const LOGIN = /^[a-z\d-]{1,39}$/i

/** @summary Validate only public GitHub identity fields; never forward OAuth credentials. */
export function publicGitHubProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.login !== 'string' || !LOGIN.test(value.login)) return null
  let avatarUrl = null
  if (typeof value.avatar_url === 'string') {
    try {
      const url = new URL(value.avatar_url)
      if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' &&
          !url.username && !url.password) avatarUrl = url.href
    } catch { /* Absent or unsafe avatars get a text fallback. */ }
  }
  return { login: value.login, avatarUrl }
}

/** @summary Report server-verified GitHub session identity without exposing a token. */
export function createGithubSessionHandler({ read = readSession, getUser = github } = {}) {
  return Object.freeze({
    async fetch(request) {
      const headers = oauthHeaders()
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers })
      let session
      try { session = read(request) }
      catch { return Response.json({ error: 'Session check unavailable' }, { status: 503, headers }) }
      if (!session) return Response.json({ authenticated: false }, { headers })
      try {
        const response = await getUser('/user', session.token)
        if (response.status === 401) return Response.json({ authenticated: false }, { headers })
        if (!response.ok) return Response.json({ error: 'GitHub Session service unavailable' },
          { status: response.status === 429 ? 429 : 503, headers })
        const user = publicGitHubProfile(await response.json())
        if (!user) return Response.json({ error: 'Invalid GitHub user profile' },
          { status: 502, headers })
        return Response.json({ authenticated: true, user }, { headers })
      } catch {
        return Response.json({ error: 'GitHub Session service unavailable' },
          { status: 503, headers })
      }
    },
  })
}
const sessionHandler = createGithubSessionHandler()
const logoutHandler = createGithubLogoutHandler()
/** @summary Share one Vercel function slot for OAuth session GET and isolated logout POST. */
export default Object.freeze({
  fetch(request) {
    const route = new URL(request.url).searchParams.get('__lc_route')
    return route === 'logout' ? logoutHandler.fetch(request) : sessionHandler.fetch(request)
  },
})
