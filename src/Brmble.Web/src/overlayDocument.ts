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
}
