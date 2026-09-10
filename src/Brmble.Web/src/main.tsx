import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/headings.css'
import './themes/classic.css'
import './themes/clean.css'
import './themes/blue-lagoon.css'
import './themes/cosmopolitan.css'
import './themes/aperol-spritz.css'
import './themes/midori-sour.css'
import './themes/lemon-drop.css'
import './themes/retro-terminal.css'
import './themes/windows-2000-theme.css'
import { applyTheme } from './themes/theme-loader'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ServiceStatusProvider } from './hooks/useServiceStatus'
import { signalAppReadyAfterPaint } from './startupReady'
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

function AppReadySignal() {
  useEffect(signalAppReadyAfterPaint, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <ServiceStatusProvider>
        <App />
      </ServiceStatusProvider>
    </ErrorBoundary>
    <AppReadySignal />
  </StrictMode>,
)
