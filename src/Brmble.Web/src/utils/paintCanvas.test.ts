import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCanvasPoint, applyPaintStrokeToContext, loadPaintSourceImage } from './paintCanvas';

describe('paintCanvas', () => {
  it('normalizes pointer coordinates into clamped unit canvas space', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 } as DOMRect;

    expect(normalizeCanvasPoint(110, 70, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(normalizeCanvasPoint(-10, 140, rect)).toEqual({ x: 0, y: 1 });
  });

  it('uses destination-out for eraser so only annotation pixels are cleared', () => {
    const operations: string[] = [];
    const ctx = {
      beginPath: () => operations.push('beginPath'),
      moveTo: () => operations.push('moveTo'),
      lineTo: () => operations.push('lineTo'),
      stroke: () => operations.push('stroke'),
      set globalCompositeOperation(value: string) { operations.push(value); },
      set strokeStyle(value: string) { operations.push(value); },
      set lineWidth(value: number) { operations.push(String(value)); },
      lineCap: 'round',
      lineJoin: 'round',
    } as unknown as CanvasRenderingContext2D;

    applyPaintStrokeToContext(ctx, 100, 100, {
      id: 'stroke-1',
      correlationId: 'corr-1',
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      sequence: 1,
      generation: 0,
      tool: 'eraser',
      width: 6,
      points: [{ x: 0.1, y: 0.2 }],
      active: true,
    });

    expect(operations).toContain('destination-out');
  });

  it('downloads source media through the authenticated Matrix media route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(new Blob(['image'])) });
    const createObjectUrl = vi.fn().mockReturnValue('blob:paint-source');
    const revokeObjectUrl = vi.fn();
    const decode = vi.fn().mockResolvedValue(undefined);
    const mxcUrlToHttp = vi.fn().mockReturnValue('https://matrix.example/media');
    const OriginalImage = globalThis.Image;

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', class {
      set src(_value: string) {}
      decode = decode;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });

    await loadPaintSourceImage({
      getAccessToken: () => 'matrix-token',
      mxcUrlToHttp,
    }, {
      matrixRoomId: '!paint:example',
      sourceEventId: '$source',
      mxcUrl: 'mxc://example/source',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      sizeBytes: 123,
    });

    expect(fetchMock).toHaveBeenCalledWith('https://matrix.example/media', {
      headers: { Authorization: 'Bearer matrix-token' },
    });
    expect(mxcUrlToHttp).toHaveBeenCalledWith('mxc://example/source', undefined, undefined, undefined, false, true, true);
    expect(decode).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:paint-source');
    vi.stubGlobal('Image', OriginalImage);
  });
});

afterEach(() => vi.unstubAllGlobals());
