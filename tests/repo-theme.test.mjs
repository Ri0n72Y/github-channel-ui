import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '..')
let vite, Home, fixture, SafeMarkdown

before(async () => {
  vite = await createServer({ root, configFile: false, logLevel: 'silent',
    plugins: [react()], server: { middlewareMode: true } })
  Home = (await vite.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')).default
  fixture = (await vite.ssrLoadModule('/apps/playground/src/repo-fixture.ts'))
    .createRepoFixtureService
  SafeMarkdown = (await vite.ssrLoadModule('/plugins/repo-home/src/SafeMarkdown.tsx')).SafeMarkdown
})
after(async () => { await vite?.close() })

function renderHome(theme) {
  const api = fixture(new URLSearchParams({ repoFixture: '1', fixtureCase: 'description' }))
  return renderToStaticMarkup(createElement(MemoryRouter, {
    initialEntries: ['/sample/repo'],
  }, createElement(Routes, null, createElement(Route, {
    path: '/:owner/:repo', element: createElement(Home, { api, theme }),
  }))))
}

test('Repo Home SSR uses the supplied theme without inventing a default', () => {
  for (const theme of ['dark', 'light']) {
    const html = renderHome(theme)
    assert.match(html, new RegExp('data-lc-theme="' + theme + '"'))
    assert.match(html, /团队成员/)
    assert.match(html, /项目动态/)
    assert.match(html, /查看全部成员/)
  }
  const noTheme = renderHome(undefined)
  assert.doesNotMatch(noTheme, /data-lc-theme=/)
})

test('#67 fixture theme parameters never change GitHub data or issue ordering', async () => {
  const signal = new AbortController().signal
  const q = name => new URLSearchParams({
    repoFixture: '1', repoTheme: name, fixtureCase: 'description', fixtureCount: '2',
  })
  const dark = fixture(q('dark')), light = fixture(q('light'))
  assert.deepEqual(await dark.getHome('sample','repo','main',signal),
    await light.getHome('sample','repo','main',signal))
  const a = await dark.getFeed('sample','repo',1,signal)
  const b = await light.getFeed('sample','repo',1,signal)
  assert.deepEqual(a,b)
  assert.deepEqual(a.items.map(x => x.state), ['open','closed'])
  assert.ok(a.items.every(x => !x.pull_request))
})

test('Markdown renders complete content in source order without executable markup', () => {
  const body = '# Real heading\n\nbody [link](https://github.com)\n\n' +
    '```js\nconst x=1\n```\n\n' +
    '![image](https://example.com/p.png)\n\n@[video](https://example.com/v)'
  const html = renderToStaticMarkup(createElement(SafeMarkdown, { body, article: true }))
  for(const label of ['Real heading','body','const x=1','查看图片来源','打开视频']) {
    assert.ok(html.includes(label))
  }
  const indexes = ['Real heading','body','const x=1','查看图片来源','打开视频']
    .map(label => html.indexOf(label))
  assert.deepEqual(indexes,[...indexes].sort((a,b) => a-b))
  assert.doesNotMatch(html, /<iframe|<script/)
})

test('Repo title cover accepts only trusted immutable repository image URLs',async()=>{
 const mod=await vite.ssrLoadModule('/plugins/repo-home/src/RepoHomePage.tsx')
 const sha='a'.repeat(40),base='https://raw.githubusercontent.com/sample/repo/'+sha+'/'
 assert.equal(mod.safeRepoTitleCover(base+'banner.png','sample','repo'),base+'banner.png')
 for(const url of ['javascript:alert(1)','data:image/png;base64,AA','http://raw.githubusercontent.com/sample/repo/'+sha+'/a.png',
   base+'a.svg',base+'a.png?x=1',base+'a.png#x',base+'../a.png',base+'%2e%2e/a.png',base+'a.png\n',
   'https://raw.githubusercontent.com/sample/repo/main/a.png','https://raw.githubusercontent.com/other/repo/'+sha+'/a.png',
   'https://raw.githubusercontent.com.evil.invalid/sample/repo/'+sha+'/a.png'])
   assert.equal(mod.safeRepoTitleCover(url,'sample','repo'),null,url)
})
