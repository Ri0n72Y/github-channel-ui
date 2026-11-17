import { createHash } from 'node:crypto'
import { writeContext } from './_issue-interaction.mjs'
import { resolveInstalledRepository, ProbeError, isGitHubRateLimited } from './_installation-probe.mjs'
import { parseTopicYaml } from '../plugins/topic-page/src/domain.mjs'
import { reply, encodedContent, TopicFetchError } from './_topic.mjs'

const GH = 'https://api.github.com'
const SHA = /^[a-f\d]{40}$/i
const BRANCH = /^[a-z\d._/-]{1,180}$/i
const LIMIT = 64 * 1024
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'LabourChain-TopicConfig',
}
function error(message, status = 502, stage = 'config-write', outcomeUnknown = false) {
  return Object.assign(new Error(message), { status, stage, outcomeUnknown })
}
const pathFor = (owner, repo) => '/repos/' + encodeURIComponent(owner) +
  '/' + encodeURIComponent(repo)
async function requestGitHub(fetcher, path, token, init = {}) {
  let response
  try {
    response = await fetcher(GH + path, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { ...HEADERS, Authorization: 'Bearer ' + token, ...init.headers },
    })
  } catch {
    throw error(init.method && init.method !== 'GET' ?
      'GitHub 写入结果未知；请先在 GitHub 核查，再决定是否重试' :
      'GitHub 权限或仓库读取暂不可用', 502, 'config-write',
      Boolean(init.method && init.method !== 'GET'))
  }
  if (!response.ok) {
    const limited = await isGitHubRateLimited(response)
    throw error(limited ? 'GitHub API 限流' :
      'GitHub 拒绝操作，HTTP ' + response.status,
    limited ? 429 : [401,403,404,409,422].includes(response.status) ?
      response.status : 502, 'config-write',
    Boolean(init.method && init.method !== 'GET' && response.status >= 500))
  }
  let data
  try { data = await response.json() }
  catch { throw error(init.method && init.method !== 'GET' ?
    'GitHub 写入响应无法核验，请先检查 GitHub' : 'GitHub 返回无效 JSON',
    502, 'config-write', Boolean(init.method && init.method !== 'GET')) }
  return data
}
function assertSha(sha, field) {
  if (typeof sha !== 'string' || !SHA.test(sha))
    throw error('GitHub ' + field + ' 无效', 502)
  return sha
}
async function sourceState(fetcher, base, branch, token) {
  const branchData = await requestGitHub(fetcher,
    base + '/branches/' + encodeURIComponent(branch), token)
  if (branchData?.name !== branch)
    throw error('默认分支身份不一致', 502)
  const headSha = assertSha(branchData.commit?.sha, 'HEAD')
  let file = null
  let response
  try {
    response = await fetcher(GH + base + '/contents/topics.config.yaml?ref=' +
      encodeURIComponent(branch), {
      redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { ...HEADERS, Authorization: 'Bearer ' + token },
    })
  } catch { throw error('读取 Topic 配置暂不可用') }
  if (response.status !== 404) {
    if (!response.ok) {
      if (await isGitHubRateLimited(response)) throw error('GitHub API 限流', 429)
      throw error('Topic Config 读取失败', response.status === 403 ? 403 : 502)
    }
    let item
    try { item = await response.json() }
    catch { throw error('Topic 文件响应无效') }
    const sha = assertSha(item.sha, '文件 SHA')
    let text
    try { text = encodedContent(item, 'config') }
    catch { throw error('Topic YAML 文件格式无效', 422) }
    try { parseTopicYaml(text) }
    catch { throw error('现有 Topic YAML 包含不支持字段，拒绝覆盖', 409) }
    file = { sha, text }
  }
  return { headSha, file, protected: branchData.protected === true }
}
async function effectiveRules(fetcher, base, branch, token) {
  const rules = await requestGitHub(fetcher,
    base + '/rules/branches/' + encodeURIComponent(branch) + '?per_page=100&page=1', token)
  if (!Array.isArray(rules) || rules.length >= 100 ||
      rules.some(rule => !rule || typeof rule.type !== 'string'))
    throw error('分支规则无法完整核验，拒绝写入', 409)
  return rules
}
async function verifyActor(fetcher, owner, repo, token, installationResolver) {
  const base = pathFor(owner, repo)
  const installed = await installationResolver({ owner, repo, fetcher })
  const app = await requestGitHub(fetcher,
    '/app/installations/' + installed.installationId, installed.jwt)
  if (app.id !== installed.installationId ||
      app.account?.login?.toLowerCase() !== owner.toLowerCase() ||
      app.suspended_at || app.permissions?.contents !== 'write')
    throw error('App Installation 尚无 Contents:write 授权', 403)
  const actor = await requestGitHub(fetcher, '/user', token)
  if (!Number.isSafeInteger(actor?.id) ||
      !/^[a-z\d-]{1,39}$/i.test(actor?.login || ''))
    throw error('无法核实 GitHub OAuth 用户身份', 401)
  const target = await requestGitHub(fetcher, base, token)
  if (target?.private !== false ||
      target.full_name?.toLowerCase() !== (owner + '/' + repo).toLowerCase() ||
      target.id !== installed.repositoryId ||
      !(target.permissions?.push === true || target.permissions?.maintain === true ||
        target.permissions?.admin === true))
    throw error('当前 GitHub 用户无目标仓库写入权限', 403)
  if (typeof target.default_branch !== 'string' ||
      !BRANCH.test(target.default_branch) || target.default_branch.startsWith('/') ||
      target.default_branch.includes('..') || target.default_branch.endsWith('/'))
    throw error('仓库默认分支无效', 502)
  return { base, branch: target.default_branch, appPermissions:app.permissions }
}
async function putYaml(fetcher, base, branch, text, token, oldFile) {
  const payload = { branch, content: Buffer.from(text, 'utf8').toString('base64'),
    message: 'chore(topic): maintain topics.config.yaml',
    ...(oldFile ? { sha: oldFile.sha } : {}) }
  const result = await requestGitHub(fetcher,
    base + '/contents/topics.config.yaml', token, {
      method:'PUT', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    })
  assertSha(result?.commit?.sha, '提交 SHA')
  const fileSha = assertSha(result?.content?.sha, '写入文件 SHA')
  return { commitSha: result.commit.sha, fileSha }
}
/** @summary Any read/parse/rate-limit failure after a successful PUT is an unknown write outcome. */
async function verifyWritten(fetcher, base, branch, token, sha, text) {
  try {
    const state = await sourceState(fetcher, base, branch, token)
    if (state.file?.sha !== sha || state.file.text !== text)
      throw error('已提交但回读不一致；请先手工核验 GitHub', 502,
        'config-write', true)
    return state
  } catch {
    throw error('已执行 GitHub PUT，但回读无法确认；请先检查 GitHub 后再继续',
      502, 'config-write', true)
  }
}
function safePR(value, owner, repo) {
  if (!Number.isSafeInteger(value?.number) || value.number <= 0 ||
      typeof value.html_url !== 'string') return false
  try {
    const url = new URL(value.html_url)
    return url.origin === 'https://github.com' && !url.search && !url.hash &&
      url.pathname.toLowerCase() === ('/' + owner + '/' + repo + '/pull/' +
        value.number).toLowerCase()
  } catch { return false }
}
/** @summary Stable branch names serialize same base version and YAML across retries. */
function topicWorkBranch(owner, repo, baseBranch, headSha, fileSha, yaml) {
  const key = JSON.stringify([owner.toLowerCase(), repo.toLowerCase(), baseBranch,
    headSha, fileSha, yaml])
  return 'labourchain/topic-' + createHash('sha256').update(key).digest('hex').slice(0,24)
}
/** @summary An existing open PR is reusable only after its branch YAML is revalidated. */
async function findPendingTopicPull(fetcher, base, owner, repo, branch, workBranch,
  text, token) {
  const query = new URLSearchParams({
    state:'open', head:owner+':'+workBranch, base:branch, per_page:'100', page:'1',
  })
  const pulls = await requestGitHub(fetcher, base+'/pulls?'+query, token)
  if (!Array.isArray(pulls) || pulls.length>1)
    throw error('无法可靠核验已有 Topic 维护 PR', 502)
  if (!pulls.length) return null
  const pr = pulls[0]
  if (!safePR(pr,owner,repo) || pr.state!=='open' ||
      pr.head?.ref!==workBranch || pr.base?.ref!==branch ||
      pr.head?.repo?.full_name?.toLowerCase()!==(owner+'/'+repo).toLowerCase())
    throw error('已有 Topic 维护 PR 身份不匹配，拒绝重复创建', 409)
  const saved = await sourceState(fetcher,base,workBranch,token)
  if (saved.file?.text !== text)
    throw error('已有维护 PR 的文件与当前草稿不同，拒绝重复创建', 409)
  return {pr,fileSha:saved.file.sha}
}
/** @summary Direct commit only on verified unprotected branches; PR elsewhere. */
async function save({ body, token, fetcher, installationResolver }) {
  const text = body.content
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > LIMIT)
    throw error('Topic YAML 内容为空或超出 64 KiB', 400)
  let parsed
  try { parsed = parseTopicYaml(text) }
  catch { throw error('Topic YAML 只能包含 topic 与 whitelist', 422) }
  if (body.confirmed !== true || !SHA.test(body.expectedHeadSha || '') ||
      body.expectedFileSha !== null && !SHA.test(body.expectedFileSha || ''))
    throw error('必须确认写入并携带当前 HEAD/文件 SHA', 400)
  const { base, branch, appPermissions } = await verifyActor(fetcher, body.owner, body.repo,
    token, installationResolver)
  const current = await sourceState(fetcher, base, branch, token)
  const rules = await effectiveRules(fetcher, base, branch, token)
  if (current.headSha !== body.expectedHeadSha ||
      (current.file?.sha || null) !== body.expectedFileSha)
    throw error('仓库配置已变化；请刷新后重新确认', 409)
  if (current.file?.text === text)
    return { state:'unchanged', branch, effective:true,
      headSha:current.headSha, config:parsed }
  const protectedBranch = current.protected || rules.length > 0
  if (!protectedBranch) {
    const saved = await putYaml(fetcher, base, branch, text, token, current.file)
    await verifyWritten(fetcher, base, branch, token, saved.fileSha, text)
    return { state:'committed', branch, effective:true,
      ...saved, config:parsed }
  }
  if (appPermissions.pull_requests !== 'write')
    throw error('App Installation 尚无 Pull requests:write 授权', 403)
  const workBranch = topicWorkBranch(body.owner,body.repo,branch,
    current.headSha,current.file?.sha || null,text)
  const branchUrl = 'https://github.com/' + body.owner + '/' + body.repo +
    '/tree/' + workBranch
  const existing = await findPendingTopicPull(fetcher,base,body.owner,body.repo,
    branch,workBranch,text,token)
  if (existing) return {state:'pending_pr',effective:false,branch:workBranch,
    branchUrl,prUrl:existing.pr.html_url,prNumber:existing.pr.number,
    fileSha:existing.fileSha,config:parsed,reused:true}
  let branchCreated = false
  try {
    const created = await requestGitHub(fetcher, base + '/git/refs', token, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ ref:'refs/heads/' + workBranch, sha:current.headSha }),
    })
    if (created?.ref !== 'refs/heads/' + workBranch)
      throw error('维护分支创建状态未知；请先检查 GitHub', 502,
        'config-write', true)
    branchCreated = true
    const workRules = await effectiveRules(fetcher, base, workBranch, token)
    if (workRules.length > 0) throw error('维护分支也受到规则保护', 409)
    const headNow = await sourceState(fetcher, base, branch, token)
    if (headNow.headSha !== current.headSha ||
        (headNow.file?.sha || null) !== (current.file?.sha || null))
      throw error('主分支已变更，维护分支不能安全提交', 409)
    const saved = await putYaml(fetcher, base, workBranch, text, token, current.file)
    await verifyWritten(fetcher, base, workBranch, token, saved.fileSha, text)
    const pr = await requestGitHub(fetcher, base + '/pulls', token, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ title:'Maintain TopicPage configuration',
        head:workBranch, base:branch,
        body:'Update topics.config.yaml after explicit user confirmation.' }),
    })
    if (!safePR(pr, body.owner, body.repo))
      throw error('PR 创建状态无法确认；请先手工核验 GitHub',502,
        'config-write',true)
    // The source remains at the old config until this PR is merged.
    return { state:'pending_pr', effective:false, branch:workBranch,
      branchUrl, prUrl:pr.html_url, prNumber:pr.number, ...saved, config:parsed }
  } catch (caught) {
    const failure = caught instanceof Error ? caught.message : '未知写入结果'
    return { state:'partial_failure', effective:false, branch:workBranch,
      branchUrl, error:failure,
      outcomeUnknown:branchCreated || Boolean(caught?.outcomeUnknown) }
  }
}
/** @summary Reuse one grouped Function and existing user OAuth installation checks. */
export function createTopicConfigEndpoint({
  fetcher = fetch, installationResolver = resolveInstalledRepository,
  writeContextFn = writeContext,
} = {}) {
  return Object.freeze({
    async fetch(request) {
      if (request.method !== 'POST')
        return reply({ error:'Method not allowed' }, 405)
      const context = await writeContextFn(request, {dynamicInstallation:true})
      if (context.error) return context.error
      try {
        const result = await save({body:context.body,token:context.token,
          fetcher,installationResolver})
        return reply(result)
      } catch (caught) {
        const status = Number.isSafeInteger(caught?.status) ? caught.status : 502
        return reply({state:'rejected',
          error:caught instanceof Error ? caught.message : 'Topic Config 不可用',
          stage:'config-write',outcomeUnknown:caught?.outcomeUnknown === true},
        status >= 400 && status <= 599 ? status : 502)
      }
    },
  })
}
export default createTopicConfigEndpoint()
