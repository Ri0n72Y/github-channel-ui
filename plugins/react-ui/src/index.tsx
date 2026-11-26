import { Service, type Context } from '@deepseek-ai/cordis'
import { createContext, useContext, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { Link, useRoutes } from 'react-router'
import styles from './App.module.css'
import { persistTheme, readStoredTheme, type ThemeMode } from './theme'
import './theme.css'

type Registration = { id: string; Component: ComponentType }
export type PageRegistration = Registration & { path: string }
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

function NotFound() {
  return <section className={styles.notFound}>
    <h1>页面不存在或暂未提供</h1>
    <p>此 URL 没有可用页面。对应插件可能尚未装配或已卸载。</p>
    <Link to="/">返回首页</Link>
  </section>
}
const ThemeContext = createContext<{theme: ThemeMode; toggle(): void} | null>(null)
export function ThemeToggle() {
  const value = useContext(ThemeContext)
  if (!value) return null
  const current = value.theme === 'dark' ? '深色' : '浅色'
  const next = value.theme === 'dark' ? '浅色' : '深色'
  return <button className={styles.themeButton} type="button" onClick={value.toggle}
    aria-label={'当前为' + current + '模式，切换为' + next + '模式'} title={'切换为' + next + '模式'}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {value.theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></> :
        <path d="M20.5 14.1A9 9 0 0 1 9.9 3.5 9 9 0 1 0 20.5 14.1Z"/>}
    </svg>
  </button>
}
export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme)
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next); persistTheme(next)
  }
  return <ThemeContext.Provider value={{theme,toggle}}>
    <div className={styles.app} data-lc-theme={theme}>{children}</div>
  </ThemeContext.Provider>
}
/** Generic renderer: host may place its own content, without a product header policy. */
export function App({ui, children}: {ui: ReactUIService; children?: ReactNode}) {
  const entries = useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)
  const routes = entries.flatMap(entry => 'path' in entry
    ? [{path:entry.path, element:<entry.Component key={entry.id}/>}] : [])
  const page = useRoutes([...routes,{path:'*',element:<NotFound/>}])
  return <ThemeProvider>{children}<main className={styles.content}>{page}</main></ThemeProvider>
}
