import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/classic.css'
import './themes/clean.css'
import './themes/blue-lagoon.css'
import './themes/cosmopolitan.css'
import './themes/aperol-spritz.css'
import './themes/midori-sour.css'
import { applyTheme } from './themes/theme-loader'
import App from './App.tsx'

// Apply theme before render to prevent flash
try {
  const stored = localStorage.getItem('brmble-settings');
  if (stored) {
    const settings = JSON.parse(stored);
    if (settings?.appearance?.theme) {
      applyTheme(settings.appearance.theme);
    }
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
