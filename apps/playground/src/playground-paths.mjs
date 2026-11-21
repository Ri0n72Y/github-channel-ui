/** @summary Canonical public Playground entries and their plugin-owned initial routes. */
export const PLAYGROUND_PLUGINS = Object.freeze([
  Object.freeze({ slug: 'repo-panel', name: '仓库面板', summary: '仓库与 Issue 列表，以及受控创建交互', initialPath: '/' }),
  Object.freeze({ slug: 'repo-home', name: '仓库主页', summary: 'README、成员与仓库动态', initialPath: '/sample/repo' }),
  Object.freeze({ slug: 'repo-config', name: '仓库配置', summary: 'Config 编辑与 Label 同步预览', initialPath: '/sample/repo/config' }),
  Object.freeze({ slug: 'issue-detail', name: 'Issue 详情', summary: 'Issue 正文、评论与劳动记录', initialPath: '/sample/repo/issues/1' }),
  Object.freeze({ slug: 'channel', name: '频道', summary: '受控频道列表与关联 Issue', initialPath: '/sample/repo/channels' }),
  Object.freeze({ slug: 'topic-page', name: 'Topic 页面', summary: 'Topic 简介、项目列表与分页', initialPath: '/topic/sample/repo' }),
])

/** @summary Resolve public paths without adding another routing dependency. */
export function resolvePlaygroundPath(pathname) {
  if (typeof pathname !== 'string') return { kind: 'not-found' }
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return { kind: 'home' }
  if (path === '/playground') return { kind: 'catalog' }
  if (path.startsWith('/playground/')) {
    const slug = path.slice('/playground/'.length).split('/')[0]
    const plugin = PLAYGROUND_PLUGINS.find(entry => entry.slug === slug)
    if (!plugin) return { kind: 'not-found' }
    return { kind: 'plugin', plugin, basename: '/playground/' + slug }
  }
  return { kind: 'legacy' }
}
