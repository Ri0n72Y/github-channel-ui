import { inspectInstallation, ProbeError, validRepository } from './_installation-probe.mjs'
import { json } from './_github.mjs'

/** @summary Inspect exactly the requested public repository, never enumerate an installation. */
export function createReposHandler({ inspect = inspectInstallation } = {}) {
  return {
    async fetch(request) {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
      const p = new URL(request.url).searchParams
      const owner = p.get('owner'), repo = p.get('repo')
      if (!validRepository(owner, repo)) {
        return json({ state: 'target_required',
          error: 'Provide an exact GitHub repository owner and name' }, 400)
      }
      try {
        const result = await inspect({ owner, repo })
        const name = typeof result?.repository === 'string' ? result.repository : ''
        if (result?.state === 'connected') {
          const parts = name.split('/')
          if (parts.length !== 2 || parts[0].toLowerCase() !== owner.toLowerCase() ||
              parts[1].toLowerCase() !== repo.toLowerCase() ||
              !validRepository(parts[0], parts[1])) {
            return json({ error: 'Installation repository identity mismatch' }, 502)
          }
          return json({ state: 'connected', repository: {
            owner: parts[0], name: parts[1], full_name: name,
          } })
        }
        if (['repository_unavailable', 'installation_suspended',
          'needs_installation', 'needs_repository_authorization'].includes(result?.state) &&
            (result.state === 'repository_unavailable' ||
             name.toLowerCase() === (owner + '/' + repo).toLowerCase())) {
          return json({ state: result.state,
            ...(typeof result.action_url === 'string' ?
              { action_url: result.action_url } : {}) })
        }
        return json({ error: 'Installation verification response invalid' }, 502)
      } catch (error) {
        if (error instanceof ProbeError) return json({ error: error.message }, error.status)
        return json({ error: 'GitHub Installation verification unavailable' }, 502)
      }
    },
  }
}
export default createReposHandler()
