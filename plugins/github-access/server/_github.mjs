/** @summary Compatibility response helper; never mint a global App Installation token. */
export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}
/** @deprecated Explicit repository targeting is mandatory for public reads. */
function globalInstallationUnavailable() {
  throw Object.assign(new Error('An exact public GitHub repository target is required'),
    { status: 400, state: 'target_required' })
}
export async function auth() { return globalInstallationUnavailable() }
export async function repos() { return globalInstallationUnavailable() }
export async function issues() { return globalInstallationUnavailable() }
