import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Тема: data-theme на <html> (его ставит вьюер артефакта) приоритетнее OS-настройки
const rootEl = document.documentElement
const media = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => {
  const forced = rootEl.dataset.theme
  const dark = forced ? forced === 'dark' : media.matches
  rootEl.classList.toggle('dark', dark)
}
applyTheme()
media.addEventListener('change', applyTheme)
new MutationObserver(applyTheme).observe(rootEl, { attributes: true, attributeFilter: ['data-theme'] })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
