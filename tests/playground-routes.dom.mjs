import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { MemoryRouter, matchRoutes, useNavigate } from 'react-router'
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
let vite, App, ThemeToggle, catalog, start, createRoot
const h = React.createElement
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

before(async () => {
  ;({ createRoot } = await import('react-dom/client'))
  vite = await createServer({ root: process.cwd(), configFile: false,
    logLevel: 'silent', plugins: [react()], server: { middlewareMode: true } })
  ;({App,ThemeToggle} = await vite.ssrLoadModule('/plugins/react-ui/src/index.tsx'))
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

async function expectMasonry(host, label) {
  for (let i = 0; i < 40; i++) {
    const list = host.querySelector('[role="list"][aria-label="Topic 项目"]')
    if (list?.querySelector('[data-topic-masonry-item]')) return list
    await act(async () => { await sleep(50) })
  }
  assert.fail('Topic projects did not finish loading: ' + label)
}

test('#94 public catalog renders six independent deep links and a working directory return', async () => {
  const view = await mounted(h(catalog.PlaygroundCatalog))
  try {
    const links = [...view.host.querySelectorAll('a[href^="/playground/"]')]
    assert.equal(links.length, 6)
    assert.deepEqual(links.map(link => link.getAttribute('href')),
      PLAYGROUND_PLUGINS.map(plugin => '/playground/' + plugin.slug))
  } finally { await view.close() }

  const home = await mounted(h(MemoryRouter,null,h(catalog.PlaygroundLanding,{sessionRequest:async()=>Response.json({authenticated:false})})))
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
  'repo-panel': ['/:owner/:repo/issues'],
  'repo-home': ['/:owner/:repo','/:owner/:repo/members','/:owner/:repo/members/register',
    '/:owner/:repo/issues/new'],
  'repo-config': ['/:owner/:repo/config'],
  'issue-detail': ['/:owner/:repo/issues/:number'],
  'channel': ['/:owner/:repo/channels'],
  'topic-page': ['/topic/:owner/:repo', '/topic/:slug'],
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
      const deepLink = '/playground/' + plugin.slug +
        (plugin.initialPath === '/' ? '/' : plugin.initialPath)
      const deep = await mounted(h(MemoryRouter, {
        initialEntries: [deepLink], basename: '/playground/' + plugin.slug,
      }, h(App, { ui: runtime.ui })))
      try {
        await expectLoaded(deep.host, visible[plugin.slug], 'refresh ' + plugin.slug)
        if (plugin.slug === 'channel') {
          await expectLoaded(deep.host, /暂无进行中的讨论/, 'selected Channel Issue')
          const cards=[...deep.host.querySelectorAll('li')].filter(li=>li.querySelector('h2'))
          assert.deepEqual(cards.map(li=>li.querySelector('h2').textContent),['discussion','wishlist'])
          const main=[...cards[0].querySelectorAll('a')].filter(a=>a.querySelector('h2')&&a.querySelector('h3'))
          assert.equal(main.length,1)
          assert.equal(cards[0].querySelectorAll('a').length,1,'one discussion action per channel')
          assert.equal(main[0].getAttribute('href'),'/playground/channel'+'/sample/repo/issues/1')
          assert.equal(cards[1].querySelector('a'),null)
          assert.match(cards[0].textContent,/fixture-author/)
          assert.match(cards[1].textContent,/暂无进行中的讨论/)
        }
      } finally { await deep.close() }
    } finally { await runtime.dispose() }
  })
}


test('#83 production registers source route only; direct slug is confined to Playground', async () => {
  const {createTopicPagePlugin}=await vite.ssrLoadModule('/plugins/topic-page/src/index.tsx')
  const {createTopicPageApi}=await vite.ssrLoadModule('/plugins/topic-page/src/service.ts')
  const registered=[]
  createTopicPagePlugin().apply({effect: fn=>fn(),
    reactUI:{registerPage: row=>{registered.push(row.path);return ()=>{}}}})
  assert.deepEqual(registered,['/topic/:owner/:repo'])
  const routes=registered.map(path=>({path}))
  assert.equal(matchRoutes(routes,'/topic/dsh-plugin'),null)
  assert.equal(matchRoutes(routes,'/topic/sample/repo')?.at(-1)?.route.path,
    '/topic/:owner/:repo')
  let requests=0
  const api=createTopicPageApi(async()=>{requests++;throw Error('unexpected network')})
  await assert.rejects(api.getProjects({topic:'dsh-plugin'},1,new AbortController().signal),
    {status:400,stage:'route'})
  assert.equal(requests,0)
})

test('#83 Topic slug direct/refresh/back/forward and invalid slug remain isolated', async () => {
  const runtime = await start('topic-page')
  const basename = '/playground/topic-page'
  const slugPath = basename + '/topic/dsh-plugin'
  const props = { ui: runtime.ui }
  function Controls() {
    const navigate = useNavigate()
    return h('div', null,
      h('button', { id: 'source-nav',
        onClick: () => navigate('/topic/sample/repo') }, '来源模式'),
      h('button', { id: 'back-nav', onClick: () => navigate(-1) }, '上一页'),
      h('button', { id: 'forward-nav', onClick: () => navigate(1) }, '下一页'))
  }
  try {
    const direct = await mounted(h(MemoryRouter, {
      initialEntries: [slugPath], basename,
    }, h(Controls), h(App, props)))
    try {
      await expectLoaded(direct.host, /GitHub Topic：dsh-plugin/, 'slug direct')
      assert.doesNotMatch(direct.host.textContent, /确认提交配置|编辑问题报告/)
      const slugList=await expectMasonry(direct.host, 'source-less Topic Masonry')
      assert.ok(slugList.querySelectorAll('[data-topic-masonry-item]').length > 0)
      assert.ok([...slugList.children].every(child => child.getAttribute('role') === 'listitem'))
      assert.equal(direct.host.querySelector('details'), null,
        'source-less Topic must not expose source configuration')
      assert.equal(direct.host.querySelectorAll('h1').length, 1)
      await act(async () => {
        direct.host.querySelector('#source-nav').click()
        await sleep(80)
      })
      await expectLoaded(direct.host, /Topic 样例活动/, 'source navigation')
      const sourceList=await expectMasonry(direct.host, 'source Topic Masonry')
      assert.ok(sourceList.querySelectorAll('[data-topic-masonry-item]').length > 0)
      const maintenance=direct.host.querySelector('details')
      assert.ok(maintenance,'source Topic keeps its management entry')
      assert.equal(maintenance.open,false,'source configuration is secondary by default')
      await act(async () => {
        direct.host.querySelector('#back-nav').click()
        await sleep(80)
      })
      await expectLoaded(direct.host, /GitHub Topic：dsh-plugin/, 'back to slug')
      await act(async () => {
        direct.host.querySelector('#forward-nav').click()
        await sleep(80)
      })
      await expectLoaded(direct.host, /Topic 样例活动/, 'forward to source')
    } finally { await direct.close() }
    const refresh = await mounted(h(MemoryRouter, {
      initialEntries: [slugPath], basename,
    }, h(App, props)))
    try {
      await expectLoaded(refresh.host, /GitHub Topic：dsh-plugin/, 'slug refresh')
    } finally { await refresh.close() }
    const invalid = await mounted(h(MemoryRouter, {
      initialEntries: [basename + '/topic/bad_slug'], basename,
    }, h(App, props)))
    try {
      await expectLoaded(invalid.host, /GitHub Topic slug 无效/, 'invalid slug')
      assert.doesNotMatch(invalid.host.textContent, /确认提交配置|编辑问题报告/)
    } finally { await invalid.close() }
  } finally { await runtime.dispose() }
})

test('generic UI owns no Header; host may explicitly place theme and session controls',async()=>{
 const runtime=await start('repo-home',true)
 try{
  const wrap=element=>h(MemoryRouter,{initialEntries:['/playground/repo-home/sample/repo'],
    basename:'/playground/repo-home'},element)
  const plain=await mounted(wrap(h(App,{ui:runtime.ui})))
  try{
   await expectLoaded(plain.host,/项目频道/,'composed fixture')
   assert.equal(plain.host.querySelector('nav[aria-label="平台导航"]'),null)
   assert.equal(plain.host.querySelector('button[aria-label*="切换为"]'),null)
   const link=plain.host.querySelector('a[href="/playground/repo-home/sample/repo/channels"]')
   assert.ok(link)
   await act(async()=>link.click())
   await expectLoaded(plain.host,/暂无进行中的讨论/,'cross plugin fixture link')
  }finally{await plain.close()}
  const withHost=await mounted(wrap(h(App,{ui:runtime.ui},h('header',null,h(ThemeToggle)))))
  try{assert.ok(withHost.host.querySelector('button[aria-label*="切换为"]'))}
  finally{await withHost.close()}
 }finally{await runtime.dispose()}
})

test('#115 real Public runtime deep link NotFound -> root -> resource -> back, same mounted host',async()=>{
 const {startRuntime}=await vite.ssrLoadModule('/apps/playground/src/runtime.tsx')
 const original=globalThis.fetch
 const requests=[]
 globalThis.fetch=async(url,init)=>{
  const path=String(url)
  requests.push(path)
  assert.notEqual(init?.method,'POST')
  if(path==='/api/github-session')return Response.json({authenticated:false})
  if(path==='/api/issues?owner=sample&repo=repo')return Response.json({issues:[
    {number:1,title:'Real runtime controlled read',comments:0,html_url:'https://github.com/sample/repo/issues/1'}]})
  throw Error('Unexpected request '+path)
 }
 let runtime,view
 try{
  runtime=await startRuntime()
  function Back(){const nav=useNavigate();return h('button',{id:'history-back',onClick:()=>nav(-1)},'测试返回')}
  view=await mounted(h(MemoryRouter,{initialEntries:['/unknown/path/missing/extra']},h(Back),h(App,{ui:runtime.ui})))
  assert.match(view.host.textContent,/页面不存在或暂未提供/)
  await act(async()=>view.host.querySelector('a[href="/"]').click())
  await expectLoaded(view.host,/公开插件 Playground/,'real root after NotFound')
  const field=view.host.querySelector('input[type="url"]')
  await act(async()=>{
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'https://github.com/sample/repo/issues')
   field.dispatchEvent(new Event('input',{bubbles:true}))
  })
  await act(async()=>view.host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  await expectLoaded(view.host,/Real runtime controlled read/,'resource from real root')
  assert.ok(requests.includes('/api/issues?owner=sample&repo=repo'))
  assert.ok(!requests.some(url=>url.includes('installation-probe')))
  await act(async()=>view.host.querySelector('#history-back').click())
  await expectLoaded(view.host,/公开插件 Playground/,'back to real root')
 }finally{await view?.close();await runtime?.dispose();globalThis.fetch=original}
})
test('#115 ordinary links never reinterpret a Topic namespace collision',async()=>{
 const {RepositoryLink}=await vite.ssrLoadModule('/plugins/repo-issues/src/RepositoryLink.tsx')
 const view=await mounted(h(MemoryRouter,null,h('div',null,
  h(RepositoryLink,{to:'/topic/repo/config'},'配置'),
  h(RepositoryLink,{to:'/topic/repo/issues'},'列表'),
  h(RepositoryLink,{to:'/topic/repo/issues/1'},'Issue'),
  h(RepositoryLink,{to:'/topic/repo'},'项目'),
  h(RepositoryLink,{to:'/assets/repo'},'静态路径'))))
 try{
  assert.deepEqual([...view.host.querySelectorAll('a')].map(a=>a.getAttribute('href')),['/topic/repo/issues/1','/topic/repo'])
  assert.equal((view.host.textContent.match(/站内路径不可用/g)||[]).length,3)
 }finally{await view.close()}
})
