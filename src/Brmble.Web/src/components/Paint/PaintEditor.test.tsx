import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintEditor } from './PaintEditor';
import type { PaintSessionSnapshot } from '../../types/paint';

const activeSnapshot: PaintSessionSnapshot = {
  sessionId: 'session-1', channelId: 5, hostUserId: 1, matrixRoomId: '!paint:server', sourceEventId: '$source', status: 'active', expiresAt: '',
  source: { matrixRoomId: '!paint:server', sourceEventId: '$source', mxcUrl: 'mxc://server/source', mimeType: 'image/png', width: 100, height: 100, sizeBytes: 1 },
  participants: [], strokes: [], generation: 0, revision: 0,
};

function fakePaintApi() {
  return {
    commitStroke: vi.fn(),
    sendPreview: vi.fn(),
    undo: vi.fn(),
    clear: vi.fn(),
    end: vi.fn(),
  };
}

async function renderLoadedEditor(onSave: (png: Blob) => Promise<void>) {
  const matrixClient = { getAccessToken: () => 'token', mxcUrlToHttp: () => 'https://matrix/source' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), drawImage, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));

  render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} matrixClient={matrixClient} onSave={onSave} />);
  await waitFor(() => expect(drawImage).toHaveBeenCalled());
}

describe('PaintEditor', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reuses one correlation ID for every preview and commit in a pointer gesture', () => {
    const paintApi = { commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(paintApi.sendPreview).toHaveBeenCalledTimes(2);
    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({ generation: 0, tool: 'pen', color: '#111827', width: 6, points: expect.arrayContaining([expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })]) }));
    const correlationIds = [...paintApi.sendPreview.mock.calls, ...paintApi.commitStroke.mock.calls].map(([, stroke]) => stroke.correlationId);
    expect([...new Set(correlationIds)]).toHaveLength(1);
    expect(correlationIds[0]).toEqual(expect.any(String));
    expect(correlationIds[0]).not.toBe('');
  });

  it('ignores overlapping pointers so the active gesture keeps its correlation ID', () => {
    const paintApi = { commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    const activeCorrelationId = paintApi.sendPreview.mock.calls[0][1].correlationId;

    fireEvent.pointerDown(canvas, { clientX: 70, clientY: 70, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 80, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 90, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 80, clientY: 80, pointerId: 1 });

    expect(paintApi.sendPreview).toHaveBeenCalledTimes(2);
    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    const correlationIds = [...paintApi.sendPreview.mock.calls, ...paintApi.commitStroke.mock.calls].map(([, stroke]) => stroke.correlationId);
    expect(correlationIds).toEqual([activeCorrelationId, activeCorrelationId, activeCorrelationId]);
  });

  it('cleans up a cancelled gesture so a later gesture can commit', () => {
    const paintApi = { commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() };
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    fireEvent.pointerDown(canvas, { clientX: 60, clientY: 60, pointerId: 2 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 80, pointerId: 2 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, pointerId: 2 });

    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({ points: [{ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.8 }] }));
  });

  it('hides host-only actions from participants', () => {
    render(<PaintEditor sessionId="session-1" paintApi={{ commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() }} snapshot={activeSnapshot} currentUserId={2} />);

    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save to chat/i })).toBeNull();
  });

  it('redraws committed strokes and previews after the source image loads', async () => {
    const matrixClient = { getAccessToken: () => 'token', mxcUrlToHttp: () => 'https://matrix/source' };
    const strokes = [{ ...activeSnapshot.strokes[0], id: 'stroke-1', authorUserId: 1, authorMatrixUserId: '@one:server', sequence: 1, active: true, correlationId: 'one', generation: 0, tool: 'pen' as const, width: 2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const preview = { correlationId: 'two', generation: 0, tool: 'pen' as const, width: 2, points: [{ x: 0, y: 1 }, { x: 1, y: 0 }], sessionId: 'session-1', authorUserId: 2, authorMatrixUserId: '@two:server' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage: draw, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D);

    render(<PaintEditor sessionId="session-1" paintApi={{ commitStroke: vi.fn(), sendPreview: vi.fn(), undo: vi.fn(), clear: vi.fn(), end: vi.fn() }} snapshot={{ ...activeSnapshot, strokes }} previews={[preview]} currentUserId={1} matrixClient={matrixClient} />);

    await waitFor(() => expect(draw).toHaveBeenCalled());
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
  });

  it('keeps save disabled while a save operation is in progress', async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    await renderLoadedEditor(onSave);

    await userEvent.click(screen.getByRole('button', { name: 'Save to chat' }));
    await userEvent.click(screen.getByRole('button', { name: 'Saving...' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved to chat' })).toBeDisabled());
  });

  it('shows a retryable error and does not mark saved when save fails', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Upload failed'));
    await renderLoadedEditor(onSave);

    await userEvent.click(screen.getByRole('button', { name: 'Save to chat' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed');
    expect(screen.getByRole('button', { name: 'Save to chat' })).toBeEnabled();
  });

  it('reuses the same composed PNG when retrying a failed save lifecycle', async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new Error('Chat post failed'))
      .mockResolvedValueOnce(undefined);
    await renderLoadedEditor(onSave);

    await userEvent.click(screen.getByRole('button', { name: 'Save to chat' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chat post failed');
    await userEvent.click(screen.getByRole('button', { name: 'Save to chat' }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][0]).toBe(onSave.mock.calls[0][0]);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);
  });
});
