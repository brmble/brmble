import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PaintEditor } from './PaintEditor';
import type { PaintSessionSnapshot } from '../../types/paint';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the source image aspect ratio to fit the drawing area', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const snapshot: PaintSessionSnapshot = {
    sessionId: 's', channelId: 1, hostUserId: 1, status: 'active', expiresAt: '',
    source: { mimeType: 'image/png', width: 400, height: 800, sizeBytes: 1 },
    participants: [], strokes: [], generation: 0, revision: 0,
  };
  const api = { getSource: vi.fn(() => new Promise<Blob>(() => {})), getSnapshot: vi.fn().mockResolvedValue(snapshot), commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
  render(<PaintEditor sessionId="s" paintApi={api} snapshot={snapshot} currentUserId={1} />);
  expect(screen.getByTestId('paint-source-canvas').parentElement).toHaveStyle({ '--paint-aspect-ratio': '0.5' });
  vi.restoreAllMocks();
});

it('fits the decoded image when its orientation differs from its metadata', async () => {
  const snapshot: PaintSessionSnapshot = {
    sessionId: 's', channelId: 1, hostUserId: 1, status: 'active', expiresAt: '',
    source: { mimeType: 'image/jpeg', width: 400, height: 800, sizeBytes: 1 },
    participants: [], strokes: [], generation: 0, revision: 0,
  };
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(400);
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D);
  const api = { getSource: vi.fn().mockResolvedValue(new Blob(['image'])), getSnapshot: vi.fn().mockResolvedValue(snapshot), commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
  render(<PaintEditor sessionId="s" paintApi={api} snapshot={snapshot} currentUserId={1} />);
  await waitFor(() => expect(screen.getByTestId('paint-source-canvas').parentElement).toHaveStyle({ '--paint-aspect-ratio': '2' }));
});
