import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply theme before render to prevent flash
try {
  const stored = localStorage.getItem('brmble-settings');
  if (stored) {
    const settings = JSON.parse(stored);
    if (settings?.appearance?.theme) {
      document.documentElement.setAttribute('data-theme', settings.appearance.theme);
    }
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
