import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = p => readFileSync(resolve(root,p), 'utf8')
const modules = [
  'plugins/repo-home/src/RepoHome.module.css',
  'plugins/repo-home/src/SafeMarkdown.module.css',
  'plugins/issue-detail/src/IssueDetailView.module.css',
  'plugins/repo-config/src/ConfigPage.module.css',
  'plugins/channel/src/ChannelView.module.css',
  'plugins/topic-page/src/topic-page.module.css',
  'plugins/repo-panel/src/RepoPanel.module.css',
  'plugins/repo-panel/src/IssueWorkspace.module.css',
]

test('#69 B+C every mounted page consumes the shared semantic theme palette', () => {
  const tokens = read('plugins/react-ui/src/theme.css')
  for (const name of ['dark','light']) {
    assert.ok(tokens.includes('[data-lc-theme="' + name + '"]'))
  }
  for (const path of modules) {
    const css = read(path)
    assert.match(css, /var\(--lc-(?:text|surface|canvas|primary|link)/, path)
    assert.doesNotMatch(css, /#[a-f\d]{3,8}(?![a-z\d])/i,
      path + ' must not reintroduce hard-coded legacy or mixed brand hues')
    assert.doesNotMatch(css, /!important\b/, path + ' must use scoped specificity')
  }
  assert.doesNotMatch(read('apps/playground/src/style.css'), /\.(?:shell|editor|issue-detail)/,
    'prototype component styling has moved to RepoPanel modules')
})

test('#69 B+C retain established page structures while applying real responsive layouts', () => {
  const repo = read('plugins/repo-home/src/RepoHome.module.css')
  assert.match(repo, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(repo, /max-width:640px/)
  assert.match(repo, /@media\(max-width:680px\)/)
  assert.match(repo, /grid-template-columns:minmax\(0,1fr\)/)
  assert.match(repo, /max-width:760px/)
  assert.match(repo, /overflow-x:auto/)
  const issue = read('plugins/issue-detail/src/IssueDetailView.module.css')
  assert.match(issue, /\.tabs button\[aria-selected="true"\]/)
  assert.match(issue, /color: var\(--lc-on-primary\)/)
  assert.match(issue, /@media \(max-width: 380px\)/)
  const topic = read('plugins/topic-page/src/topic-page.module.css')
  for (const name of ['projectCover','ownerAvatar','projectDescription','dialog','windowWarning']) {
    assert.ok(topic.includes('.' + name), name)
  }
  assert.match(topic, /object-fit:contain/)
  assert.match(topic, /flex-wrap: wrap/)
  assert.match(topic, /@media \(max-width: 700px\)/)
  assert.match(topic, /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/)
})

test('#69 B+C only changes presentation data for cover/avatar, not GitHub write contracts', () => {
  const project = read('plugins/topic-page/src/TopicProjectCard.tsx')
  const api = read('api/_topic-projects.mjs')
  assert.match(project, /暂无可用项目封面/)
  assert.match(project, /project\.owner_avatar_url/)
  assert.match(project, /project\.cover_url/)
  assert.match(api, /trustedGitHubImage/)
  assert.match(api, /avatars\.githubusercontent\.com/)
  assert.match(api, /repository-images\.githubusercontent\.com/)
  assert.match(api, /item\.open_graph_image_url/)
  assert.doesNotMatch(project, /api\/|fetch\(|localStorage|opengraph\.githubassets\.com\//)
  const repoPanel = read('plugins/repo-panel/src/index.tsx')
  assert.match(repoPanel, /RepoPanel\.module\.css/)
  assert.match(repoPanel, /styles\.shell/)
  assert.match(repoPanel, /IssueWorkspace/)
  const host = read('plugins/react-ui/src/index.tsx')
  assert.match(host, /data-lc-theme=\{theme\}/)
  assert.match(host, /persistTheme\(next\)/)
})
