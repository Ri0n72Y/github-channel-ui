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

/** Strict original spelling; no credential, port, encoded path, query or fragment. */
export function resourcePath(owner, repo, kind = 'repository', number) {
  const target = parseGitHubRepositoryUrl('https://github.com/' + owner + '/' + repo)
  if (!target || target.owner !== owner || target.name !== repo) return null
  if (kind !== 'topic' && /^(api|playground)$/i.test(owner)) return null
  if (owner.toLowerCase() === 'topic' && ['config','channels','members','issues'].includes(kind)) return null
  const base = '/' + owner + '/' + repo
  if (kind === 'repository') return base
  if (kind === 'issue') return Number.isSafeInteger(number) && number > 0 ? base + '/issues/' + number : null
  if (kind === 'topic') return '/topic' + base
  if (['config','channels','members','members/register','issues/new','issues'].includes(kind)) return base + '/' + kind
  return null
}
export function parseGitHubResourceUrl(input) {
  const repository = parseGitHubRepositoryUrl(input)
  if (repository) {
    const path=resourcePath(repository.owner,repository.name)
    return path?{...repository,kind:'repository',path}:null
  }
  if (typeof input !== 'string') return null
  const m = /^(https:\/\/github\.com\/[a-z\d-]{1,39}\/[a-z\d._-]{1,100})\/issues\/([1-9]\d*)\/?$/i.exec(input.trim())
  if (!m) {
    const other=/^(https:\/\/github\.com\/[a-z\d-]{1,39}\/[a-z\d._-]{1,100})\/(issues(?:\/new)?|blob\/main\/(?:labourchain\.config\.yaml|topics\.config\.yaml))\/?$/i.exec(input.trim())
    if(!other)return null
    const target=parseGitHubRepositoryUrl(other[1])
    if(!target)return null
    const kind=other[2]==='blob/main/labourchain.config.yaml'?'config':other[2]==='blob/main/topics.config.yaml'?'topic':other[2]
    const path=resourcePath(target.owner,target.name,kind)
    return path?{...target,kind,path}:null
  }
  const target = parseGitHubRepositoryUrl(m[1]), number = Number(m[2])
  if (!target || !Number.isSafeInteger(number)) return null
  const path=resourcePath(target.owner,target.name,'issue',number)
  return path?{...target,kind:'issue',number,path}:null
}
export function validLoginReturnPath(path) {
  if (path === '/installation-probe.html') return path
  if (typeof path !== 'string' || /[\s%\\?#]/u.test(path) || /^\/(?:api|playground)(?:\/|$)/i.test(path)) return '/'
  const parts = path.replace(/\/$/,'').split('/')
  if (parts[0] !== '') return '/'
  const [,a,b,c,d] = parts
  let canonical = null
  if (parts.length === 4 && a === 'topic') canonical = resourcePath(b,c,'topic')
  else if (parts.length === 3) canonical = resourcePath(a,b)
  else if (parts.length === 4) canonical = resourcePath(a,b,c)
  else if (parts.length === 5 && c === 'members' && d === 'register') canonical = resourcePath(a,b,'members/register')
  else if (parts.length === 5 && c === 'issues') canonical = d === 'new' ? resourcePath(a,b,'issues/new') :
    /^[1-9]\d*$/.test(d) ? resourcePath(a,b,'issue',Number(d)) : null
  return canonical && (path === canonical || path === canonical + '/') ? path : '/'
}
