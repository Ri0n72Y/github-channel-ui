import { Service, type Context } from '@deepseek-ai/cordis'
import { useState, useSyncExternalStore, type ComponentType } from 'react'
import { Link, useLocation, useRoutes } from 'react-router'
import styles from './App.module.css'
import { persistTheme, readStoredTheme, type ThemeMode } from './theme'
import './theme.css'
import SessionMenu from './SessionMenu'
import type { RequestFn } from '../../shared/src/browser-http'

type Registration = { id: string; Component: ComponentType }
export type PageRegistration = Registration & { path: string }
export type HeaderBrand = Readonly<{
  label: string
  home: string
  links?: readonly Readonly<{ label: string; href: string }>[]
}>
type UIRegistration = Registration | PageRegistration

declare module '@deepseek-ai/cordis' {
  interface Context {
    reactUI: ReactUIService
  }
}

/** @summary Own the Cordis UI registry and publish stable snapshots for React subscribers. */
export class ReactUIService extends Service {
  private registry = new Map<string, UIRegistration>()
  private listeners = new Set<() => void>()
  private snapshot: UIRegistration[] = []

  constructor(ctx: Context) {
    super(ctx, 'reactUI')
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  register(id: string, Component: ComponentType) {
    return this.add({ id, Component })
  }

  registerPage(entry: PageRegistration) {
    if (!entry.path.startsWith('/') || entry.path === '/*' ||
      entry.path === '/api' || entry.path.startsWith('/api/')) {
      throw new Error('invalid page path: ' + entry.path)
    }
    if ([...this.registry.values()].some(current =>
      'path' in current && current.path === entry.path)) {
      throw new Error('duplicate page path: ' + entry.path)
    }
    return this.add(entry)
  }

  private add(entry: UIRegistration) {
    if (!entry.id.trim()) throw new Error('empty UI id')
    if (this.registry.has(entry.id)) throw new Error('duplicate UI: ' + entry.id)
    this.registry.set(entry.id, entry)
    this.publish()
    return () => {
      if (this.registry.get(entry.id) === entry) {
        this.registry.delete(entry.id)
        this.publish()
      }
    }
  }

  private publish() {
    this.snapshot = [...this.registry.values()]
    this.listeners.forEach(listener => listener())
  }
}

/** @summary Explain unmatched paths, including routes removed when a plugin unloads. */
function NotFound({ branded = false }: { branded?: boolean }) {
  return <section className={styles.notFound}>
    <h1>页面不存在或暂未提供</h1>
    <p>此 URL 没有可用页面。对应插件可能尚未装配或已卸载。</p>
    <Link to="/">{branded ? '返回平台首页' : '返回 Playground'}</Link>
  </section>
}

/** @summary Match plugin-registered pages inside the application's single React Router. */
export function App({ ui, sessionRequest, initialPath, headerBrand }: {
  ui: ReactUIService; sessionRequest?: RequestFn; initialPath?: string
  headerBrand?: HeaderBrand
}) {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme)
  const entries = useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)
  const routes = entries.flatMap(entry => 'path' in entry
    ? [{ path: entry.path, element: <entry.Component key={entry.id} /> }]
    : [])
  const location = useLocation()
  // Only the Public Playground selects a plugin entry at its stable root URL.
  // Hosted and legacy routes keep the normal browser location unchanged.
  const page = useRoutes([...routes, { path: '*', element: <NotFound branded={Boolean(headerBrand)} /> }],
    initialPath && location.pathname === '/' ? initialPath : undefined)
  const next = theme === 'dark' ? 'light' : 'dark'
  const currentLabel = theme === 'dark' ? '深色' : '浅色'
  const nextLabel = next === 'dark' ? '深色' : '浅色'
  function toggleTheme() {
    setTheme(next)
    persistTheme(next)
  }
  return <div className={styles.app} data-lc-theme={theme}>
    <header className={headerBrand ? styles.toolbar + ' ' + styles.toolbarWithBrand : styles.toolbar}
      aria-label="站点主题和 GitHub 账户">
      {headerBrand && <nav className={styles.brandNavigation} aria-label="平台导航">
        <Link className={styles.brandLink} to={headerBrand.home}>{headerBrand.label}</Link>
        {headerBrand.links?.map(item => <a key={item.href} className={styles.brandNavLink}
          href={item.href}>{item.label}</a>)}
      </nav>}
      <div className={styles.toolbarControls}>
        <span className={styles.themeStatus}>当前：{currentLabel}模式</span>
        <button className={styles.themeButton} type="button" onClick={toggleTheme}
          aria-label={'当前为' + currentLabel + '模式，切换为' + nextLabel + '模式'}>
          切换为{nextLabel}模式
        </button>
        <SessionMenu request={sessionRequest} />
      </div>
    </header>
    <main className={styles.content}>{page}</main>
  </div>
}
