import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PaintEditor } from './PaintEditor';
import type { PaintSessionSnapshot } from '../../types/paint';

it('uses the source image aspect ratio to fit the drawing area', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const snapshot: PaintSessionSnapshot = {
    sessionId: 's', channelId: 1, hostUserId: 1, status: 'active', expiresAt: '',
    source: { mimeType: 'image/png', width: 400, height: 800, sizeBytes: 1 },
    participants: [], strokes: [], generation: 0, revision: 0,
  };
  const api = { getSource: vi.fn(() => new Promise<Blob>(() => {})), commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
  render(<PaintEditor sessionId="s" paintApi={api} snapshot={snapshot} currentUserId={1} />);
  expect(screen.getByTestId('paint-source-canvas').parentElement).toHaveStyle({ '--paint-aspect-ratio': '0.5' });
  vi.restoreAllMocks();
});
