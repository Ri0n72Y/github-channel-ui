import { parseTeamFile } from '../src/domain.mjs'
import { readText } from '../../github-access/server/_repository-access.mjs'
export * from '../../github-access/server/_repository-access.mjs'
export async function readTeam(access, base, branch) {
  try {
    const data = await readText(access, base + '/contents/team-member.json?ref=' + encodeURIComponent(branch))
    return { ...parseTeamFile(data?.text ?? null), sha: data?.sha || null }
  } catch (error) { return { state: 'error', members: [], error: error.message || '成员文件读取失败' } }
}
