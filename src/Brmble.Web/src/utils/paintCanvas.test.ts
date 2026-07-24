import { describe, expect, it } from 'vitest';
import { normalizeCanvasPoint, applyPaintStrokeToContext } from './paintCanvas';

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
});
