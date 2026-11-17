import type { TopicPageApi, TopicSnapshot, TopicProjectsPage, TopicRoute,
  ReportIssue } from '../../../plugins/topic-page/src/service'

const project = (name: string) => ({
  id: [...name.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 2147483647, 7),
  full_name: name, name: name.split('/')[1], owner: name.split('/')[0],
  description: '受控公开 GitHub Topic 项目', html_url: 'https://github.com/' + name,
  stargazers_count: 1, language: 'TypeScript',
})
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
  const t = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, 25)
  function cancel() { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
  signal.addEventListener('abort', cancel, { once: true })
})

/** @summary Exercise Topic pagination, whitelist, search-window and report failures entirely in memory. */
export function createTopicFixtureService(query: URLSearchParams): TopicPageApi {
  const mode = query.get('topicCase') || 'ready'
  const authenticated = query.get('fixtureAuth') === '1'
  const routeCheck = (route: TopicRoute) => {
    if (route.owner !== 'sample' || route.repo !== 'repo') throw Object.assign(
      new Error('Fixture repository not found'), { status: 404, stage: 'repository' })
  }
  return {
    reportAvailable: true, // Matches the production adapter; server App×User checks still govern writes.
    async getSnapshot(route, signal): Promise<TopicSnapshot> {
      await wait(signal); routeCheck(route)
      if (['missing', 'readme-error', 'report-fail', 'report-success'].includes(mode)) {
        throw Object.assign(new Error('Fixture README 读取失败'), { status: 502, stage: 'readme' })
      }
      if (mode === 'bad-config') throw Object.assign(
        new Error('Fixture Topic Config 无效'), { status: 422, stage: 'config' })
      return {
        repository: { owner: 'sample', name: 'repo',
          full_name: 'sample/repo', html_url: 'https://github.com/sample/repo' },
        readme: '封面说明（必须排除）\n# Topic 样例活动\n第一段简介\n第二段简介\nemail: team@example.org\ndatetime: 2026-11-12\n',
        coverUrl: null,
        config: mode === 'config-missing' ? null :
          { topic: 'labourchain', whitelist: mode !== 'no-whitelist' },
        configState: mode === 'config-missing' ? 'missing' : 'ready',
        configText: mode === 'config-missing' ? null : 'topic: labourchain\nwhitelist: true\n',
        configSha: mode === 'config-missing' ? null : 'a'.repeat(40),
        headSha: 'b'.repeat(40), defaultBranch: 'main',
        allowedRepositories: Array.from({ length: 12 }, (_, i) => 'member/project-' + (i + 1)),
      }
    },
    async getProjects(route, page, signal, offset = 0): Promise<TopicProjectsPage> {
      await wait(signal); routeCheck(route)
      const cursor = (total: number, end: boolean) => ({
        page, offset, perPage: 100, totalCount: total,
        hasNext: !end, nextPage: end ? null : page + 1,
        nextOffset: end ? null : 0, windowExhausted: end && total > 1000,
      })
      if (mode === 'rate-limit' && page === 2) throw Object.assign(
        new Error('Fixture rate-limited'), { status: 429, stage: 'topic-search' })
      if (mode === 'window') return {
        ...cursor(1500, page === 10),
        items: Array.from({ length: 25 }, (_, i) =>
          project(page === 1 && i === 0 ? 'member/project-1' :
            'outside/candidate-' + page + '-' + i)),
      }
      if (mode === 'empty') return { ...cursor(0, true), items: [] }
      if (mode === 'sparse' && page === 1 && offset < 75) {
        return {page, offset, perPage:100,totalCount:200,hasNext:true,
          nextPage:1,nextOffset:offset+25,windowExhausted:false,items:[]}
      }
      if (mode === 'sparse' && page === 1) {
        return {page, offset, perPage:100,totalCount:200,hasNext:true,
          nextPage:2,nextOffset:0,windowExhausted:false,
          items:[project('member/project-1')]}
      }
      return {
        ...cursor(200, page >= 2),
        items: page === 1 ? [
          project('other/blocked'), project('member/project-1'),
          project('MEMBER/PROJECT-1'), project('sample/repo'),
        ] : Array.from({ length: 11 }, (_, i) => project('member/project-' + (i + 2))),
      }
    },
    async saveConfig(route, content, headSha, configSha, signal) {
      await wait(signal); routeCheck(route)
      if (!authenticated) throw Object.assign(new Error('请先登录 GitHub'), {
        status:401,stage:'config-write',
      })
      if(headSha!=='b'.repeat(40) ||
          (mode==='config-missing'?configSha!==null:configSha!=='a'.repeat(40)))
        throw Object.assign(new Error('配置 HEAD 已改变'), {status:409,stage:'config-write'})
      if (!/^topic:\\s+[a-z\\d-]+/m.test(content))
        throw Object.assign(new Error('配置无效'), {status:422,stage:'config-write'})
      if (mode==='config-denied')throw Object.assign(new Error('Contents 写权限不足'),
        {status:403,stage:'config-write'})
      if (mode==='config-unknown')throw Object.assign(new Error('响应未知，请先核查 GitHub'),
        {status:502,stage:'config-write',outcomeUnknown:true})
      if (mode==='config-pr')return {
        state:'pending_pr' as const,effective:false,branch:'labourchain/topic-fixture',
        prUrl:'https://github.com/sample/repo/pull/81',
      }
      return {state:'committed' as const,effective:true,branch:'main',
        commitSha:'c'.repeat(40)}
    },
    async getSession(signal) { await wait(signal); return authenticated },
    async getReportTarget(route: TopicRoute, signal: AbortSignal) {
      await wait(signal); routeCheck(route)
      if (!authenticated) throw Object.assign(new Error('Fixture: 请先登录'), {
        status: 401, stage: 'permission',
      })
      return 'fixture-target-proof'
    },
    async submitReport(route: TopicRoute, _report: ReportIssue,
      proof: string, signal: AbortSignal) {
      await wait(signal); routeCheck(route)
      if (!authenticated || proof !== 'fixture-target-proof') throw Object.assign(
        new Error('Fixture: 权限或目标凭证不足'), { status: 403, stage: 'report' })
      if (mode === 'report-fail') throw Object.assign(
        new Error('Fixture 403：提交失败，请检查仓库权限'), { status: 403, stage: 'report' })
      if (mode === 'report-unknown') throw Object.assign(
        new Error('Fixture：响应中断，先去 GitHub 核查'), {
          status: 502, stage: 'report', outcomeUnknown: true,
        })
      return 'https://github.com/sample/repo/issues/77'
    },
  }
}
