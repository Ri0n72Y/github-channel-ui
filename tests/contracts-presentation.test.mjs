import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let server, validateVisibleFields, trustedMemberResultUrl

before(async () => {
  server = await createServer({
    root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true },
  })
  const registration = await server.ssrLoadModule('/plugins/repo-home/src/MemberRegisterPage.tsx')
  validateVisibleFields = registration.validateVisibleFields
  trustedMemberResultUrl = registration.trustedMemberResultUrl
})
after(async () => { await server?.close() })

const draft = () => ({
  name: 'Alice', githubUsername: '', role: '', bio: '', avatarUrl: '',
  links: [{ label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' }],
})


test('member registration exposes only exact GitHub PR and Commit destinations', () => {
  const result = {status:'pending_pr',url:'https://github.com/sample/repo/pull/17'}
  assert.equal(trustedMemberResultUrl(result,'sample','repo'),result.url)
  const sha = 'a'.repeat(40)
  const committed = {status:'committed',url:'https://github.com/sample/repo/commit/'+sha}
  assert.equal(trustedMemberResultUrl(committed,'sample','repo'),committed.url)
  for(const url of [
    'https://github.com/other/repo/pull/17','https://github.com/sample/repo/issues/17',
    'https://github.com.evil.test/sample/repo/pull/17','http://github.com/sample/repo/pull/17',
    'https://github.com/sample/repo/pull/17?next=other','javascript:alert(1)',
  ]) assert.equal(trustedMemberResultUrl({...result,url},'sample','repo'),null,url)
  assert.equal(trustedMemberResultUrl({...committed,url:'https://github.com/sample/repo/commit/a'},'sample','repo'),null)
})
test('Repo title cover accepts only trusted immutable repository image URLs',async()=>{
 const mod=await server.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')
 const sha='a'.repeat(40),base='https://raw.githubusercontent.com/sample/repo/'+sha+'/'
 assert.equal(mod.safeRepoTitleCover(base+'banner.png','sample','repo'),base+'banner.png')
 for(const url of ['javascript:alert(1)','data:image/png;base64,AA','http://raw.githubusercontent.com/sample/repo/'+sha+'/a.png',
   base+'a.svg',base+'a.png?x=1',base+'a.png#x',base+'../a.png',base+'%2e%2e/a.png',base+'a.png\n',
   'https://raw.githubusercontent.com/sample/repo/main/a.png','https://raw.githubusercontent.com/other/repo/'+sha+'/a.png',
   'https://raw.githubusercontent.com.evil.invalid/sample/repo/'+sha+'/a.png'])
   assert.equal(mod.safeRepoTitleCover(url,'sample','repo'),null,url)
})
