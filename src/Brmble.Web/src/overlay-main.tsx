import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/headings.css';
import './themes/classic.css';
import './themes/clean.css';
import './themes/blue-lagoon.css';
import './themes/cosmopolitan.css';
import './themes/aperol-spritz.css';
import './themes/midori-sour.css';
import './themes/lemon-drop.css';
import './themes/retro-terminal.css';
import { applyTheme } from './themes/theme-loader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OverlayApp } from './components/CompanionOverlay/OverlayApp';
import { applyOverlayDocumentChrome } from './overlayDocument';

try {
  const stored = localStorage.getItem('brmble-settings');
  if (stored) {
    const settings = JSON.parse(stored);
    if (settings?.appearance?.theme) {
      applyTheme(settings.appearance.theme);
    }
  }
} catch {}

applyOverlayDocumentChrome();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="OverlayApp">
      <OverlayApp />
    </ErrorBoundary>
  </StrictMode>,
);
