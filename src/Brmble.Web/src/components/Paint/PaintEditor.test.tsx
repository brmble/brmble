import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaintEditor, PAINT_PREVIEW_THROTTLE_MS } from './PaintEditor';
import type { PaintSessionSnapshot } from '../../types/paint';

const activeSnapshot: PaintSessionSnapshot = {
  sessionId: 'session-1', channelId: 5, hostUserId: 1, status: 'active', expiresAt: '',
  source: { mimeType: 'image/png', width: 100, height: 100, sizeBytes: 1 },
  participants: [], strokes: [], generation: 0, revision: 0,
};

function fakePaintApi() {
  return {
    getSource: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' })),
    commitStroke: vi.fn(),
    sendPreview: vi.fn(),
    undo: vi.fn(),
    clear: vi.fn(),
    end: vi.fn(),
  };
}

async function renderLoadedEditor(onSave: (png: Blob) => Promise<void>) {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), drawImage, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));

  render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} onSave={onSave} />);
  await waitFor(() => expect(drawImage).toHaveBeenCalled());
}

describe('PaintEditor', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reuses one correlation ID for every preview and commit in a pointer gesture', () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(paintApi.sendPreview).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({ generation: 0, tool: 'pen', color: '#111827', width: 6, points: expect.arrayContaining([expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })]) }));
    const correlationIds = [...paintApi.sendPreview.mock.calls, ...paintApi.commitStroke.mock.calls].map(([, stroke]) => stroke.correlationId);
    expect([...new Set(correlationIds)]).toHaveLength(1);
    expect(correlationIds[0]).toEqual(expect.any(String));
    expect(correlationIds[0]).not.toBe('');
  });

  it('commits a Line gesture with only its start and end points', async () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    await userEvent.click(screen.getByRole('button', { name: 'Line' }));
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 70, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 80, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 90, pointerId: 1 });

    expect(paintApi.sendPreview).toHaveBeenCalledWith('session-1', expect.objectContaining({
      tool: 'line',
      points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.7 }],
    }));
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({
      tool: 'line',
      points: [{ x: 0.2, y: 0.2 }, { x: 0.9, y: 0.9 }],
    }));
  });

  it('uses the selected color for Line strokes', async () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    await userEvent.click(screen.getByRole('button', { name: 'Line' }));
    await userEvent.click(screen.getByRole('button', { name: 'Color Red' }));
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 90, pointerId: 1 });

    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({
      tool: 'line',
      color: '#ef4444',
      width: 6,
    }));
  });

  it('ignores overlapping pointers so the active gesture keeps its correlation ID', () => {
    const paintApi = fakePaintApi();
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

    expect(paintApi.sendPreview).toHaveBeenCalledTimes(1);
    expect(paintApi.commitStroke).toHaveBeenCalledTimes(1);
    const correlationIds = [...paintApi.sendPreview.mock.calls, ...paintApi.commitStroke.mock.calls].map(([, stroke]) => stroke.correlationId);
    expect(correlationIds).toEqual([activeCorrelationId, activeCorrelationId]);
  });

  it('cleans up a cancelled gesture so a later gesture can commit', () => {
    const paintApi = fakePaintApi();
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
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({ points: [{ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.8 }, { x: 1, y: 1 }] }));
  });

  it('renders the local stroke during pointer movement before server acknowledgement', () => {
    const stroke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke,
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });

    expect(stroke).toHaveBeenCalled();
    expect(paintApi.sendPreview).toHaveBeenCalledTimes(1);
  });

  it('throttles preview sends while retaining every committed point in order', () => {
    vi.useFakeTimers();
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 40, pointerId: 1 });
    expect(paintApi.sendPreview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PAINT_PREVIEW_THROTTLE_MS);
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60, pointerId: 1 });

    expect(paintApi.sendPreview).toHaveBeenCalledTimes(2);
    expect(paintApi.commitStroke).toHaveBeenCalledWith('session-1', expect.objectContaining({
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
        { x: 0.4, y: 0.4 },
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.6 },
      ],
    }));
  });

  it('caps an oversized gesture at 2,000 points', () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 3000, height: 3000 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    for (let coordinate = 1; coordinate <= 2000; coordinate++) {
      fireEvent.pointerMove(canvas, { clientX: coordinate, clientY: coordinate, pointerId: 1 });
    }
    fireEvent.pointerUp(canvas, { clientX: 2001, clientY: 2001, pointerId: 1 });

    expect(paintApi.commitStroke.mock.calls[0][1].points).toHaveLength(2000);
  });

  it('does not commit a cancelled pointer gesture', () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    expect(paintApi.commitStroke).not.toHaveBeenCalled();
  });

  it('does not commit a gesture after pointer capture is lost', () => {
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30, pointerId: 1 });

    expect(paintApi.commitStroke).not.toHaveBeenCalled();
  });

  it('does not redraw a cancelled gesture when its own preview echo arrives late', () => {
    const stroke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke,
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const paintApi = fakePaintApi();
    const { rerender } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} previews={[]} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    const cancelledCorrelationId = paintApi.sendPreview.mock.calls[0][1].correlationId;
    fireEvent.pointerCancel(canvas, { pointerId: 1 });

    stroke.mockClear();
    rerender(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} previews={[{
      sessionId: 'session-1',
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      correlationId: cancelledCorrelationId,
      generation: 0,
      tool: 'pen' as const,
      color: '#111827',
      width: 6,
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    }]} currentUserId={1} />);

    expect(stroke).not.toHaveBeenCalled();
  });

  it('keeps the pending local committed stroke visible while suppressing the echoed preview before the server commit arrives', () => {
    const stroke = vi.fn();
    const lineTo = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo,
      stroke,
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const paintApi = fakePaintApi();
    const { rerender } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} previews={[]} currentUserId={1} />);

    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
    const committedCorrelationId = paintApi.commitStroke.mock.calls[0][1].correlationId;

    stroke.mockClear();
    lineTo.mockClear();
    rerender(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} previews={[{
      sessionId: 'session-1',
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      correlationId: committedCorrelationId,
      generation: 0,
      tool: 'pen' as const,
      color: '#111827',
      width: 6,
      points: [{ x: 0.1, y: 0.1 }],
    }]} currentUserId={1} />);

    expect(stroke).toHaveBeenCalledTimes(1);
    expect(lineTo).toHaveBeenCalledTimes(2);
  });

  it('removes an optimistic stroke and reports a rejected commit', async () => {
    const stroke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke, arc: vi.fn(), fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const paintApi = { ...fakePaintApi(), commitStroke: vi.fn().mockRejectedValue(new Error('Stroke rejected')) };
    const { rerender } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);
    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30, pointerId: 1 });

    expect(await screen.findByRole('alert')).toHaveTextContent('Stroke rejected');
    const rejectedCorrelationId = paintApi.commitStroke.mock.calls[0][1].correlationId;
    stroke.mockClear();
    rerender(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={{ ...activeSnapshot, revision: 1 }} previews={[{
      sessionId: 'session-1', authorUserId: 1, authorMatrixUserId: '@alice:server', correlationId: rejectedCorrelationId,
      generation: 0, tool: 'pen' as const, color: '#111827', width: 6, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
    }]} currentUserId={1} />);
    expect(stroke).not.toHaveBeenCalled();
  });

  it.each(['Undo', 'Clear', 'End'])('reports a failed %s mutation', async (action) => {
    const paintApi = { ...fakePaintApi(), [action.toLowerCase()]: vi.fn().mockRejectedValue(new Error(`${action} rejected`)) };
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);

    await userEvent.click(screen.getByRole('button', { name: action }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`${action} rejected`);
  });

  it('drops pending local strokes when the server advances the generation', () => {
    const stroke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke, arc: vi.fn(), fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const paintApi = { ...fakePaintApi(), commitStroke: vi.fn(() => new Promise(() => {})) };
    const { rerender } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);
    const canvas = screen.getByTestId('paint-annotation-canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 30, clientY: 30, pointerId: 1 });
    stroke.mockClear();
    rerender(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={{ ...activeSnapshot, generation: 1, revision: 1 }} currentUserId={1} />);

    expect(stroke).not.toHaveBeenCalled();
  });

  it('hides host-only actions from participants', () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={2} />);

    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save to chat/i })).toBeNull();
  });

  it('uses shared button semantics for paint actions', () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} />);

    expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveClass('btn', 'btn-secondary');
    expect(screen.getByRole('button', { name: 'Clear' })).toHaveClass('btn', 'btn-danger');
    expect(screen.getByRole('button', { name: 'End' })).toHaveClass('btn', 'btn-danger');
    expect(screen.getByRole('button', { name: 'Save to chat' })).toHaveClass('btn', 'btn-primary');
  });

  it('shows zoom controls and starts at the fit scale', () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} />);

    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fit image' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('100%');
  });

  it('changes zoom with buttons and returns to fit', async () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} />);

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('status')).toHaveTextContent('125%');

    await userEvent.click(screen.getByRole('button', { name: 'Fit image' }));
    expect(screen.getByRole('status')).toHaveTextContent('100%');
  });

  it('zooms only with shift-wheel over the image and prevents page scrolling', async () => {
    const pendingSource = () => new Promise<Blob>(() => {});
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} loadSource={pendingSource} />);
    const viewport = screen.getByTestId('paint-viewport');
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 150, shiftKey: true, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await act(async () => viewport.dispatchEvent(event));

    expect(preventDefault).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('125%');
  });

  it('anchors shift-wheel zoom to the rendered image when the image is letterboxed', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const viewportSize = { width: 400, height: 200 };
    const snapshot = { ...activeSnapshot, source: { ...activeSnapshot.source!, width: 600, height: 400 } };
    const paintApi = fakePaintApi();
    render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={snapshot} currentUserId={1} />);

    const viewport = screen.getByTestId('paint-viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: viewportSize.width });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: viewportSize.height });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: viewportSize.width, height: viewportSize.height } as DOMRect);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('50%'));

    const canvas = screen.getByTestId('paint-annotation-canvas');
    let afterZoom = false;
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(() => (afterZoom
      ? { left: 0, top: 0, width: 450, height: 300 }
      : { left: 50, top: 50, width: 300, height: 200 }) as DOMRect);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      afterZoom = true;
      callback(0);
      return 0;
    });
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 100, shiftKey: true, bubbles: true, cancelable: true });

    await act(async () => viewport.dispatchEvent(event));

    expect(viewport.scrollLeft).toBe(75);
  });

  it('keeps normal wheel scrolling available without changing zoom', async () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} />);
    const viewport = screen.getByTestId('paint-viewport');
    const event = new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 150, bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    await act(async () => viewport.dispatchEvent(event));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('100%');
  });

  it('disables zoom controls at 25% and 400%', async () => {
    render(<PaintEditor sessionId="session-1" paintApi={fakePaintApi()} snapshot={activeSnapshot} currentUserId={1} />);
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });

    for (let i = 0; i < 12; i++) await userEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    for (let i = 0; i < 15; i++) await userEvent.click(zoomOut);
    expect(zoomOut).toBeDisabled();
  });

  it('redraws committed strokes and previews after the source image loads', async () => {
    const strokes = [{ ...activeSnapshot.strokes[0], id: 'stroke-1', authorUserId: 1, authorMatrixUserId: '@one:server', sequence: 1, active: true, correlationId: 'one', generation: 0, tool: 'pen' as const, width: 2, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    const preview = { correlationId: 'two', generation: 0, tool: 'pen' as const, width: 2, points: [{ x: 0, y: 1 }, { x: 1, y: 0 }], sessionId: 'session-1', authorUserId: 2, authorMatrixUserId: '@two:server' };
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 100 });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage: draw, beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D);

    render(<PaintEditor sessionId="session-1" paintApi={{ ...fakePaintApi(), getSource: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' })) }} snapshot={{ ...activeSnapshot, strokes }} previews={[preview]} currentUserId={1} />);

    await waitFor(() => expect(draw).toHaveBeenCalled());
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
  });

  it('does not refetch an unchanged source when snapshot metadata is reallocated', async () => {
    const paintApi = fakePaintApi();
    const { rerender } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);
    await waitFor(() => expect(paintApi.getSource).toHaveBeenCalledTimes(1));

    rerender(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={{ ...activeSnapshot, source: { ...activeSnapshot.source! } }} currentUserId={1} />);

    expect(paintApi.getSource).toHaveBeenCalledTimes(1);
  });

  it('ignores a source load that resolves after the editor unmounts', async () => {
    let resolveSource!: (source: Blob) => void;
    const paintApi = { ...fakePaintApi(), getSource: vi.fn(() => new Promise<Blob>(resolve => { resolveSource = resolve; })) };
    const initialize = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const { unmount } = render(<PaintEditor sessionId="session-1" paintApi={paintApi} snapshot={activeSnapshot} currentUserId={1} />);
    await waitFor(() => expect(paintApi.getSource).toHaveBeenCalledOnce());

    initialize.mockClear();
    unmount();
    resolveSource(new Blob(['image'], { type: 'image/png' }));
    await Promise.resolve();

    expect(initialize).not.toHaveBeenCalled();
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
