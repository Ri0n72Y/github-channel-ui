import type { ReactNode } from 'react'
import { PLAYGROUND_PLUGINS, type PlaygroundPlugin } from './playground-paths.mjs'
import styles from './playground-catalog.module.css'

/** @summary Public landing, directory and error pages, independent of the hosted composition. */
export function PlaygroundLanding() {
  return <main className={styles.page}>
    <p className={styles.eyebrow}>LabourChain</p>
    <h1>公开插件 Playground</h1>
    <p>选择一个插件，在独立页面查看受控 Fixture 交互。示例数据不会修改 GitHub 仓库。</p>
    <p><a className={styles.primary} href="/playground">进入插件目录</a></p>
  </main>
}
export function PlaygroundCatalog() {
  return <main className={styles.page}>
    <p className={styles.eyebrow}>LabourChain / Playground</p>
    <h1>插件目录</h1>
    <p>每个入口仅装配选中的插件和必要运行依赖。六个示例均使用受控 Fixture。</p>
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
  return <div className={styles.pluginPage}>
    <nav className={styles.back} aria-label="Playground 导航">
      <a href="/playground">返回插件目录</a>
      <span aria-hidden="true">/</span><span>{plugin.name}</span>
    </nav>
    <p className={styles.fixtureNote}>受控 Fixture 演示 · 仅运行 {plugin.name} 插件；不对真实 GitHub 数据写入。</p>
    {children}
  </div>
}
