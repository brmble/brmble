import { describe, expect, it } from 'vitest';
import { applyOverlayDocumentChrome } from './overlayDocument';

describe('applyOverlayDocumentChrome', () => {
  it('makes the overlay page transparent and non-interactive outside the overlay UI', () => {
    document.documentElement.style.cssText = '';
    document.body.style.cssText = '';
    document.body.innerHTML = '<div id="root"></div>';

    applyOverlayDocumentChrome(document);

    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
    expect(document.body.style.pointerEvents).toBe('none');
    expect(document.getElementById('root')?.style.pointerEvents).toBe('none');
  });
});
