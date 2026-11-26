import { useNavigate } from 'react-router'
import type { RequestFn } from '../../../plugins/shared/src/browser-http'
import { useState, type FormEvent, type ReactNode } from 'react'
import { PLAYGROUND_PLUGINS, type PlaygroundPlugin } from './playground-paths.mjs'
import { parseGitHubResourceUrl } from '../../../plugins/repo-issues/src/target.mjs'
import { ThemeToggle } from '../../../plugins/react-ui/src/index'
import SessionMenu from '../../../plugins/react-ui/src/SessionMenu'
import styles from './playground-catalog.module.css'

/** @summary Public landing, directory and error pages, independent of the hosted composition. */
export function PlaygroundLanding({sessionRequest}: {sessionRequest?:RequestFn} = {}) {
  const navigate=useNavigate()
  const [input,setInput]=useState('')
  const [error,setError]=useState('')
  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target=parseGitHubResourceUrl(input)
    if (!target) {setError('请输入完整且受支持的 GitHub 资源 HTTPS URL（保留路径不可用于仓库入口）');return}
    navigate(target.path)
  }
  return <section className={styles.page}>
    <h1>公开插件 Playground</h1>
    <form onSubmit={submit}>
      <label>GitHub 资源 URL <input type="url" required value={input} onChange={e=>setInput(e.target.value)} placeholder="https://github.com/owner/repo"/></label>
      <button type="submit">打开资源</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    <div><ThemeToggle/><SessionMenu request={sessionRequest}/></div>
    <p>真实资源使用 GitHub API；示例使用独立 Fixture。</p>
    <a className={styles.primary} href="/playground">进入插件目录</a>
    <PlaygroundCatalog/>
  </section>
}
export function PlaygroundCatalog() {
  return <main className={styles.page}>
    <p className={styles.eyebrow}>LabourChain / Playground</p>
    <h1>插件目录</h1>
    <p>六个示例使用受控 Fixture，业务跳转仍在示例环境内。</p>
    <ul className={styles.catalog}>{PLAYGROUND_PLUGINS.map(plugin =>
      <li key={plugin.slug}>
        <a href={'/playground/' + plugin.slug}>
          <strong>{plugin.name}</strong>
          <span>{plugin.summary}</span>
          <code>{'/playground/' + plugin.slug}</code>
        </a>
      </li>)}</ul>
    <p><a href="/">返回首页</a></p>
  </main>
}
export function PlaygroundNotFound() {
  return <main className={styles.page}>
    <h1>插件页面不存在</h1>
    <p>当前地址没有对应的 Playground 插件。请从目录选择可用演示。</p>
    <a className={styles.primary} href="/playground">返回插件目录</a>
  </main>
}
export function PlaygroundStartupError() {
  return <main className={styles.page}>
    <h1>插件装配失败</h1>
    <p>无法加载当前演示，请刷新页面；若问题持续，请返回目录选择其他插件。</p>
    <a className={styles.primary} href="/playground">返回插件目录</a>
  </main>
}
export function PlaygroundPluginFrame({ plugin, children }: {
  plugin: PlaygroundPlugin
  children: ReactNode
}) {
  return <div className={styles.pluginPage} onClickCapture={event=>{
    const target=event.target instanceof HTMLElement?event.target.closest('a'):null
    if(target?.getAttribute('href')?.startsWith('/api/')){event.preventDefault();event.stopPropagation()}
  }}>
    <nav className={styles.back} aria-label="Playground 导航">
      <a href="/playground">返回插件目录</a>
      <span aria-hidden="true">/</span><span>{plugin.name}</span>
    </nav>
    <p className={styles.fixtureNote}>受控 Fixture 演示 · {plugin.name} 入口；所有业务服务使用受控数据，不对真实 GitHub 数据写入。</p>
    {children}
  </div>
}
