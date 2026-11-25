import { RepoAccessRequestProvider } from '../../../plugins/github-access/src/RepoAccessNotice'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, useLocation } from 'react-router'
import { App, ThemeProvider, ThemeToggle } from '../../../plugins/react-ui/src/index'
import { resolvePlaygroundPath, type PlaygroundPlugin } from './playground-paths.mjs'
import { PlaygroundLanding, PlaygroundCatalog, PlaygroundNotFound, PlaygroundPluginFrame, PlaygroundStartupError } from './playground-catalog'
import './style.css'

const root=createRoot(document.getElementById('root')!)
const route=resolvePlaygroundPath(window.location.pathname)
const fixtureAccessRequest=async()=>Response.json({authenticated:false})
function FixtureRoute({ui,plugin}: {ui: Parameters<typeof App>[0]['ui'];plugin:PlaygroundPlugin}) {
  const location=useLocation()
  return location.pathname==='/' ? <Navigate replace to={plugin.initialPath+location.search}/> :
    <PlaygroundPluginFrame plugin={plugin}><RepoAccessRequestProvider request={fixtureAccessRequest}><App ui={ui}><ThemeToggle/></App></RepoAccessRequestProvider></PlaygroundPluginFrame>
}
function showStatic(Page: typeof PlaygroundLanding) {
  root.render(<StrictMode><BrowserRouter><ThemeProvider><Page/></ThemeProvider></BrowserRouter></StrictMode>)
}
if(route.kind==='home')showStatic(PlaygroundLanding)
else if(route.kind==='catalog')showStatic(PlaygroundCatalog)
else if(route.kind==='not-found')showStatic(PlaygroundNotFound)
else {
  const runtime=route.kind==='plugin'
    ? import('./single-plugin-runtime').then(m=>m.startSinglePluginRuntime(route.plugin.slug,true))
    : import('./runtime').then(m=>m.startRuntime())
  void runtime.then(({ui,dispose})=>{
    root.render(<StrictMode><BrowserRouter basename={route.kind==='plugin'?route.basename:undefined}>
      {route.kind==='plugin'?<FixtureRoute ui={ui} plugin={route.plugin}/>:<App ui={ui}/>}
    </BrowserRouter></StrictMode>)
    window.addEventListener('pagehide',()=>{void dispose()},{once:true})
  }).catch(error=>{console.error(error);showStatic(PlaygroundStartupError)})
}
