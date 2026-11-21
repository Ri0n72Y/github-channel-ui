import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { MemoryRouter } from 'react-router'
import { PLAYGROUND_PLUGINS } from '../apps/playground/src/playground-paths.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://local.test/playground',
})
for (const key of ['window','document','HTMLElement','Node','Event','MouseEvent',
  'localStorage','HTMLInputElement','HTMLTextAreaElement'])
  globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.IntersectionObserver = class { observe() {} disconnect() {} }
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.confirm = () => true
let vite, App, catalog, start, createRoot
const h = React.createElement
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

before(async () => {
  ;({ createRoot } = await import('react-dom/client'))
  vite = await createServer({ root: process.cwd(), configFile: false,
    logLevel: 'silent', plugins: [react()], server: { middlewareMode: true } })
  App = (await vite.ssrLoadModule('/plugins/react-ui/src/index.tsx')).App
  catalog = await vite.ssrLoadModule('/apps/playground/src/playground-catalog.tsx')
  start = (await vite.ssrLoadModule('/apps/playground/src/single-plugin-runtime.ts'))
    .startSinglePluginRuntime
})
after(async () => { await vite?.close(); dom.window.close() })

async function mounted(element) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  return { host, close: async () => {
    await act(async () => root.unmount())
    host.remove()
  } }
}

async function expectLoaded(host, matcher, label) {
  for (let i = 0; i < 40; i++) {
    if (matcher.test(host.textContent) &&
        !host.textContent.includes('页面不存在或暂未提供')) return
    await act(async () => { await sleep(50) })
  }
  assert.match(host.textContent, matcher, 'Fixture did not load: ' + label)
  assert.doesNotMatch(host.textContent, /页面不存在或暂未提供/,
    'Plugin route not registered: ' + label)
}

test('#94 public catalog renders six independent deep links and a working directory return', async () => {
  const view = await mounted(h(catalog.PlaygroundCatalog))
  try {
    const links = [...view.host.querySelectorAll('a[href^="/playground/"]')]
    assert.equal(links.length, 6)
    assert.deepEqual(links.map(link => link.getAttribute('href')),
      PLAYGROUND_PLUGINS.map(plugin => '/playground/' + plugin.slug))
  } finally { await view.close() }

  const home = await mounted(h(catalog.PlaygroundLanding))
  try { assert.ok(home.host.querySelector('a[href="/playground"]')) }
  finally { await home.close() }

  const shell = await mounted(h(catalog.PlaygroundPluginFrame, {
    plugin: PLAYGROUND_PLUGINS[0],
  }, h('div', null, '示例内容')))
  try { assert.ok(shell.host.querySelector('a[href="/playground"]')) }
  finally { await shell.close() }

  const unknown = await mounted(h(catalog.PlaygroundNotFound))
  try {
    assert.match(unknown.host.textContent, /插件页面不存在/)
    assert.ok(unknown.host.querySelector('a[href="/playground"]'))
  } finally { await unknown.close() }
})

const expected = {
  'repo-panel': ['/'],
  'repo-home': ['/:owner/:repo','/:owner/:repo/members','/:owner/:repo/members/register',
    '/:owner/:repo/issues/new'],
  'repo-config': ['/:owner/:repo/config'],
  'issue-detail': ['/:owner/:repo/issues/:number'],
  'channel': ['/:owner/:repo/channels'],
  'topic-page': ['/topic/:owner/:repo'],
}
const visible = {
  'repo-panel': /LabourChain/,
  'repo-home': /sample\/repo|仓库主页|项目主页/i,
  'repo-config': /仓库配置与 Labels/,
  'issue-detail': /受控 Issue|Issue #1|Issue 详情/,
  'channel': /频道/,
  'topic-page': /Topic 样例活动/,
}

for (const plugin of PLAYGROUND_PLUGINS) {
  test('#94 deep link mounts only ' + plugin.slug + ' and renders its controlled plugin page', async () => {
    const runtime = await start(plugin.slug)
    const registered = runtime.ui.getSnapshot().filter(row => 'path' in row)
      .map(row => row.path).sort()
    assert.deepEqual(registered, expected[plugin.slug].slice().sort(),
      'unexpected plugin routes for ' + plugin.slug)
    try {
      const view = await mounted(h(MemoryRouter, {
        initialEntries: ['/playground/' + plugin.slug],
        basename: '/playground/' + plugin.slug,
      }, h(App, { ui: runtime.ui, sessionRequest: runtime.sessionRequest,
        initialPath: plugin.initialPath })))
      try {
        await expectLoaded(view.host, visible[plugin.slug], 'root ' + plugin.slug)
      } finally { await view.close() }

      const deepLink = '/playground/' + plugin.slug +
        (plugin.initialPath === '/' ? '/' : plugin.initialPath)
      const deep = await mounted(h(MemoryRouter, {
        initialEntries: [deepLink], basename: '/playground/' + plugin.slug,
      }, h(App, { ui: runtime.ui, sessionRequest: runtime.sessionRequest,
        initialPath: plugin.initialPath })))
      try {
        await expectLoaded(deep.host, visible[plugin.slug], 'refresh ' + plugin.slug)
      } finally { await deep.close() }
    } finally { await runtime.dispose() }
  })
}

test('#15 Header Brand is opt-in and keeps Theme / Session in the same UI host',async()=>{
 const runtime=await start('repo-home')
 try{
  const wrap=element=>h(MemoryRouter,{initialEntries:['/playground/repo-home'],
    basename:'/playground/repo-home'},element)
  const brand={label:'LabourChain',home:'/',links:[{label:'用户手册',href:'/docs/'}]}
  const withBrand=await mounted(wrap(h(App,{ui:runtime.ui,headerBrand:brand,
    sessionRequest:runtime.sessionRequest,initialPath:runtime.initialPath})))
  try{
   assert.ok(withBrand.host.querySelector('nav[aria-label="平台导航"]'))
   assert.ok(withBrand.host.querySelector('a[href="/docs/"]'))
   const brandHome=withBrand.host.querySelector('nav[aria-label="平台导航"] a')
   assert.ok(brandHome?.getAttribute('href')?.startsWith('/playground/repo-home'))
   assert.ok(withBrand.host.querySelector('button[aria-label*="切换为"]'))
  }finally{await withBrand.close()}
  const plain=await mounted(wrap(h(App,{ui:runtime.ui,
    sessionRequest:runtime.sessionRequest,initialPath:runtime.initialPath})))
  try{
   assert.equal(plain.host.querySelector('nav[aria-label="平台导航"]'),null)
   assert.ok(plain.host.querySelector('button[aria-label*="切换为"]'))
  }finally{await plain.close()}
 }finally{await runtime.dispose()}
})
