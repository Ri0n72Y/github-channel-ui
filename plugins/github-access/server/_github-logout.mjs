import { FLOW_COOKIE, SESSION_COOKIE, cookieHeader, oauthConfig,
  oauthHeaders, validOrigin } from './_oauth.mjs'

/** @summary Clear only LabourChain cookies after a verified same-origin POST. */
export function createGithubLogoutHandler({ config = oauthConfig } = {}) {
  return Object.freeze({
    async fetch(request) {
      const headers = oauthHeaders()
      if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' },
        { status: 405, headers })
      let origin
      try { origin = config().origin }
      catch { return Response.json({ error: 'GitHub logout unavailable' },
        { status: 503, headers }) }
      const requestOrigin = request.headers.get('origin')
      if (!validOrigin(request, origin) || requestOrigin !== origin ||
          request.headers.get('x-labourchain-write') !== '1' ||
          request.headers.get('sec-fetch-site') === 'cross-site') {
        return Response.json({ error: 'Logout origin denied' }, { status: 403, headers })
      }
      headers.append('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0))
      headers.append('Set-Cookie', cookieHeader(FLOW_COOKIE, '', 0))
      return Response.json({ authenticated: false }, { headers })
    },
  })
}
export default createGithubLogoutHandler()
