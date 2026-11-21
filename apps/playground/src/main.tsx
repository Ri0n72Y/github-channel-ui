import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from '../../../plugins/react-ui/src/index'
import { resolvePlaygroundPath } from './playground-paths.mjs'
import { PlaygroundLanding, PlaygroundCatalog, PlaygroundNotFound,
  PlaygroundPluginFrame, PlaygroundStartupError } from './playground-catalog'
import './style.css'

const root = createRoot(document.getElementById('root')!)
const pathname = resolvePlaygroundPath(window.location.pathname)
const query = new URLSearchParams(window.location.search)
const legacyQuery = ['plugin', 'repoOnly', 'repoFixture', 'configFixture',
  'channelFixture', 'topicFixture', 'issueFixture', 'routeFixture', 'sessionFixture']
  .some(key => query.has(key))

function showStatic(Page: typeof PlaygroundLanding) {
  root.render(<StrictMode><Page /></StrictMode>)
}
if (pathname.kind === 'catalog') {
  showStatic(PlaygroundCatalog)
} else if (pathname.kind === 'not-found') {
  showStatic(PlaygroundNotFound)
} else if (pathname.kind === 'home' && !legacyQuery) {
  showStatic(PlaygroundLanding)
} else {
  const runtime = pathname.kind === 'plugin'
    ? import('./single-plugin-runtime').then(module =>
      module.startSinglePluginRuntime(pathname.plugin.slug))
    : query.has('plugin')
      ? import('./single-plugin-runtime').then(module => module.startSinglePluginRuntime())
      : import('./runtime').then(module => module.startRuntime())
  void runtime.then(({ ui, sessionRequest, dispose }) => {
    if (pathname.kind === 'plugin') {
      root.render(<StrictMode><BrowserRouter basename={pathname.basename}>
        <PlaygroundPluginFrame plugin={pathname.plugin}>
          <App ui={ui} sessionRequest={sessionRequest}
            initialPath={pathname.plugin.initialPath} />
        </PlaygroundPluginFrame>
      </BrowserRouter></StrictMode>)
    } else {
      root.render(<StrictMode><BrowserRouter>
        <App ui={ui} sessionRequest={sessionRequest} />
      </BrowserRouter></StrictMode>)
    }
    window.addEventListener('pagehide', () => { void dispose() }, { once: true })
  }).catch(error => {
    console.error(error)
    showStatic(PlaygroundStartupError)
  })
}
