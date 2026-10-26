import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const Panel = lazy(() => import('./Panel')) // o painel só é descarregado por quem o abre: /#painel
const isPanel = () => location.hash.startsWith('#painel')

function Root() {
  const [panel, setPanel] = useState(isPanel())
  useEffect(() => { const f = () => setPanel(isPanel()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return panel ? <Suspense fallback={null}><Panel /></Suspense> : <App />
}

createRoot(document.getElementById('root')!).render(<Root />)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
