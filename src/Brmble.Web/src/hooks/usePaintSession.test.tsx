import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import * as paintApi from '../api/paint';
import { usePaintSession } from './usePaintSession';

vi.mock('../bridge', () => ({
  default: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('../api/paint', () => ({
  paintApi: { getSnapshot: vi.fn() },
}));

const sessionId = 'session-1';
const handlers = new Map<string, (data: unknown) => void>();

function initialSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    channelId: 7,
    hostUserId: 1,
    matrixRoomId: '!paint:server',
    status: 'active' as const,
    source: null,
    participants: [],
    strokes: [],
    generation: 0,
    revision: 0,
    ...overrides,
  };
}

function preview(overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    generation: 0,
    authorUserId: 1,
    authorMatrixUserId: '@alice:server',
    correlationId: 'preview-1',
    tool: 'pen' as const,
    color: '#ef4444',
    width: 6,
    points: [{ x: 0.1, y: 0.2 }],
    ...overrides,
  };
}

function committed(overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    revision: 1,
    generation: 0,
    stroke: {
      id: 'server-stroke',
      correlationId: 'preview-1',
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      sequence: 1,
      generation: 0,
      tool: 'pen' as const,
      color: '#ef4444',
      width: 6,
      points: [{ x: 0.1, y: 0.2 }],
      active: true,
    },
    ...overrides,
  };
}

function renderPaintSessionHook(snapshot = initialSnapshot()) {
  vi.mocked(paintApi.paintApi.getSnapshot).mockResolvedValue(snapshot);
  const hook = renderHook(() => usePaintSession(sessionId));
  return {
    ...hook,
    emit: (event: string, data: unknown) => handlers.get(event)?.(data),
  };
}

describe('usePaintSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    vi.mocked(bridge.on).mockImplementation((event, handler) => {
      handlers.set(event, handler);
    });
  });

  it('replaces a matching preview when the committed stroke arrives', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());

    act(() => harness.emit('paint.previewUpdated', preview({ correlationId: 'corr-1', authorUserId: 1 })));
    act(() => harness.emit('paint.strokeCommitted', committed({
      revision: 1,
      stroke: { ...committed().stroke, correlationId: 'corr-1', id: 'server-1' },
    })));

    expect(harness.result.current.previews).toHaveLength(0);
    expect(harness.result.current.strokes.map(stroke => stroke.id)).toEqual(['server-1']);
  });

  it('requests a fresh snapshot when a permanent revision gap is detected', async () => {
    const harness = renderPaintSessionHook(initialSnapshot({ revision: 4 }));
    await waitFor(() => expect(harness.result.current.snapshot?.revision).toBe(4));
    vi.mocked(paintApi.paintApi.getSnapshot).mockClear();

    act(() => harness.emit('paint.strokeCommitted', committed({ revision: 6, stroke: { ...committed().stroke, id: 'server-2' } })));

    await waitFor(() => expect(paintApi.paintApi.getSnapshot).toHaveBeenCalledWith(sessionId));
  });

  it('ignores events from an old generation after clear', async () => {
    const harness = renderPaintSessionHook(initialSnapshot({ generation: 1, revision: 3 }));
    await waitFor(() => expect(harness.result.current.snapshot?.generation).toBe(1));

    act(() => harness.emit('paint.previewUpdated', preview({ generation: 0, correlationId: 'old' })));

    expect(harness.result.current.previews).toHaveLength(0);
  });
});
