import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCanvasPoint, applyPaintStrokeToContext, composePaintPng, loadPaintSourceImage } from './paintCanvas';

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
      arc: (...args: number[]) => operations.push(`arc:${args.join(',')}`),
      fill: () => operations.push('fill'),
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
    expect(operations).toContain('arc:10,20,3,0,6.283185307179586');
    expect(operations).toContain('fill');
  });

  it('renders a one-point pen stroke as a filled dot', () => {
    const operations: string[] = [];
    const ctx = {
      beginPath: () => operations.push('beginPath'),
      moveTo: () => operations.push('moveTo'),
      arc: (...args: number[]) => operations.push(`arc:${args.join(',')}`),
      fill: () => operations.push('fill'),
      set globalCompositeOperation(value: string) { operations.push(value); },
      set fillStyle(value: string) { operations.push(value); },
      set strokeStyle(_value: string) {}, set lineWidth(_value: number) {}, lineCap: 'round', lineJoin: 'round',
    } as unknown as CanvasRenderingContext2D;

    applyPaintStrokeToContext(ctx, 100, 50, {
      id: 'stroke-pen-dot', correlationId: 'corr-pen-dot', authorUserId: 1, authorMatrixUserId: '@alice:server',
      sequence: 1, generation: 0, tool: 'pen', color: '#ef4444', width: 6,
      points: [{ x: 0.1, y: 0.2 }], active: true,
    });

    expect(operations).toContain('source-over');
    expect(operations).toContain('arc:10,10,3,0,6.283185307179586');
    expect(operations).toContain('fill');
  });

  it('keeps the source layer intact when composing an erased annotation into a PNG', async () => {
    const compositionOperations: string[] = [];
    const annotationOperations: string[] = [];
    const compositionContext = {
      drawImage: vi.fn(),
      set globalCompositeOperation(value: string) { compositionOperations.push(value); },
    } as unknown as CanvasRenderingContext2D;
    const annotationContext = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
      set globalCompositeOperation(value: string) { annotationOperations.push(value); },
      set strokeStyle(_value: string) {}, set fillStyle(_value: string) {}, set lineWidth(_value: number) {}, lineCap: 'round', lineJoin: 'round',
    } as unknown as CanvasRenderingContext2D;
    const output = { width: 0, height: 0, getContext: vi.fn(() => compositionContext), toBlob: (callback: BlobCallback) => callback(new Blob(['png'])) } as unknown as HTMLCanvasElement;
    const annotations = { width: 0, height: 0, getContext: vi.fn(() => annotationContext) } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValueOnce(output).mockReturnValueOnce(annotations);

    await composePaintPng({} as CanvasImageSource, 100, 50, [{
      id: 'eraser', correlationId: 'eraser', authorUserId: 1, authorMatrixUserId: '@me:server', sequence: 1,
      generation: 0, tool: 'eraser', width: 4, points: [{ x: 0.2, y: 0.2 }], active: true,
    }]);

    expect(annotationOperations).toContain('destination-out');
    expect(compositionOperations).not.toContain('destination-out');
    expect(compositionContext.drawImage).toHaveBeenNthCalledWith(1, expect.anything(), 0, 0, 100, 50);
    expect(compositionContext.drawImage).toHaveBeenNthCalledWith(2, annotations, 0, 0, 100, 50);
  });

  it('loads a paint source from a Blob object URL without Matrix credentials', async () => {
    const source = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const createObjectUrl = vi.fn().mockReturnValue('blob:paint-source');
    const revokeObjectUrl = vi.fn();
    const decode = vi.fn().mockResolvedValue(undefined);
    const OriginalImage = globalThis.Image;

    vi.stubGlobal('Image', class {
      set src(_value: string) {}
      decode = decode;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });

    await loadPaintSourceImage(source);

    expect(createObjectUrl).toHaveBeenCalledWith(source);
    expect(decode).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:paint-source');
    vi.stubGlobal('Image', OriginalImage);
  });
});

afterEach(() => vi.unstubAllGlobals());
