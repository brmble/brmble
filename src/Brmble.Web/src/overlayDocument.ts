export function applyOverlayDocumentChrome(doc: Document = document) {
  doc.documentElement.style.background = 'transparent';
  doc.documentElement.style.overflow = 'hidden';

  doc.body.style.margin = '0';
  doc.body.style.background = 'transparent';
  doc.body.style.pointerEvents = 'none';
  doc.body.style.overflow = 'hidden';

  const root = doc.getElementById('root');
  if (root) {
    root.style.minHeight = '0';
    root.style.pointerEvents = 'none';
    root.style.background = 'transparent';
  }

  // Inject a style block to hide pseudo-elements and any rogue backgrounds
  // since inline styles cannot target pseudo-elements like body::before
  const style = doc.createElement('style');
  style.id = 'overlay-chrome-overrides';
  style.textContent = `
    html, body {
      background-image: none !important;
      background-color: transparent !important;
    }
    body::before {
      display: none !important;
    }
  `;
  doc.head.appendChild(style);
}
