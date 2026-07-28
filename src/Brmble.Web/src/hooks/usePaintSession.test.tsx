import { act, render, renderHook, waitFor } from '@testing-library/react';
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
    sessionId,
    channelId: 7,
    hostUserId: 1,
    matrixRoomId: '!paint:server',
    sourceEventId: null,
    status: 'pendingSource' as const,
    expiresAt: '2026-07-24T12:00:00.000Z',
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

  it('filters the local user preview when their own committed stroke arrives', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());

    const previewInput = preview({ correlationId: 'corr-1', authorUserId: 1 });
    act(() => harness.emit('paint.previewUpdated', {
      sessionId,
      generation: 0,
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      input: previewInput,
    }));

    expect(harness.result.current.previews).toEqual([previewInput]);

    act(() => harness.emit('paint.strokeCommitted', committed({
      revision: 1,
      stroke: { ...committed().stroke, correlationId: 'corr-1', id: 'server-1' },
    })));

    expect(harness.result.current.previews).toHaveLength(0);
    expect(harness.result.current.strokes.map(stroke => stroke.id)).toEqual(['server-1']);
  });

  it('ignores a late preview that matches an already committed stroke', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());

    act(() => harness.emit('paint.strokeCommitted', committed({
      revision: 1,
      stroke: { ...committed().stroke, correlationId: 'corr-1', id: 'server-1' },
    })));
    act(() => harness.emit('paint.previewUpdated', {
      sessionId,
      generation: 0,
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      input: preview({ correlationId: 'corr-1', authorUserId: 1 }),
    }));

    expect(harness.result.current.previews).toHaveLength(0);
    expect(harness.result.current.strokes.map(stroke => stroke.id)).toEqual(['server-1']);
  });

  it('deduplicates repeated committed stroke ids', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());

    act(() => harness.emit('paint.strokeCommitted', committed({
      revision: 1,
      stroke: { ...committed().stroke, id: 'server-1' },
    })));
    act(() => harness.emit('paint.strokeCommitted', committed({
      revision: 2,
      stroke: { ...committed().stroke, id: 'server-1', sequence: 1 },
    })));

    expect(harness.result.current.strokes.map(stroke => stroke.id)).toEqual(['server-1']);
  });

  it('activates the local session when a source is attached', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());

    act(() => harness.emit('paint.sourceAttached', {
      sessionId,
      revision: 1,
      generation: 0,
      source: { sourceEventId: 'source-1' },
    }));

    expect(harness.result.current.snapshot).toMatchObject({
      status: 'active',
      revision: 1,
      sourceEventId: 'source-1',
      source: { sourceEventId: 'source-1' },
    });
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

  it('contains a failed automatic snapshot refresh after a revision gap', async () => {
    const harness = renderPaintSessionHook(initialSnapshot({ revision: 4 }));
    await waitFor(() => expect(harness.result.current.snapshot?.revision).toBe(4));
    vi.mocked(paintApi.paintApi.getSnapshot).mockRejectedValueOnce(new Error('network unavailable'));

    act(() => harness.emit('paint.strokeCommitted', committed({ revision: 6 })));

    await waitFor(() => expect(paintApi.paintApi.getSnapshot).toHaveBeenCalledTimes(2));
  });

  it('creates an unavailable terminal snapshot when no snapshot is available', async () => {
    vi.mocked(paintApi.paintApi.getSnapshot).mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(() => usePaintSession(sessionId));

    act(() => handlers.get('paint.sessionUnavailable')?.({
      sessionId,
      status: 'unavailable',
      revision: 0,
      generation: 0,
    }));

    expect(hook.result.current.snapshot).toMatchObject({
      sessionId,
      status: 'unavailable',
      revision: 0,
      generation: 0,
    });
  });

  it('does not restore a snapshot that resolves after an unavailable event', async () => {
    let resolveSnapshot: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    vi.mocked(paintApi.paintApi.getSnapshot).mockImplementationOnce(() => new Promise(resolve => {
      resolveSnapshot = resolve;
    }));
    const hook = renderHook(() => usePaintSession(sessionId));

    act(() => handlers.get('paint.sessionUnavailable')?.({
      sessionId,
      status: 'unavailable',
      revision: 0,
      generation: 0,
    }));
    await act(async () => { resolveSnapshot(initialSnapshot({ status: 'active' })); });

    expect(hook.result.current.snapshot).toMatchObject({
      sessionId,
      status: 'unavailable',
      revision: 0,
      generation: 0,
    });
  });

  it('marks a stale snapshot unavailable without requiring its next revision', async () => {
    const harness = renderPaintSessionHook(initialSnapshot({ revision: 5, generation: 2, status: 'active' }));
    await waitFor(() => expect(harness.result.current.snapshot?.revision).toBe(5));

    act(() => harness.emit('paint.sessionUnavailable', {
      sessionId,
      status: 'unavailable',
      revision: 0,
      generation: 0,
    }));

    expect(harness.result.current.snapshot).toMatchObject({
      status: 'unavailable',
      revision: 0,
      generation: 0,
    });
  });

  it('does not replace a newer event-applied snapshot with an older refresh response', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());
    let resolveRefresh: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    vi.mocked(paintApi.paintApi.getSnapshot).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));

    const pending = harness.result.current.refresh();
    act(() => harness.emit('paint.strokeCommitted', committed({ revision: 1 })));
    await act(async () => { resolveRefresh(initialSnapshot({ revision: 0 })); await pending; });

    expect(harness.result.current.snapshot?.revision).toBe(1);
  });

  it('coalesces refresh requests while a snapshot fetch is already pending', async () => {
    const harness = renderPaintSessionHook();
    await waitFor(() => expect(harness.result.current.snapshot).not.toBeNull());
    vi.mocked(paintApi.paintApi.getSnapshot).mockClear();
    vi.mocked(paintApi.paintApi.getSnapshot).mockImplementation(() => new Promise(() => {}));

    void harness.result.current.refresh();
    void harness.result.current.refresh();
    void harness.result.current.refresh();

    expect(paintApi.paintApi.getSnapshot).toHaveBeenCalledOnce();
  });

  it('surfaces an initial snapshot failure and clears it after retrying', async () => {
    vi.mocked(paintApi.paintApi.getSnapshot).mockRejectedValueOnce(new Error('Snapshot unavailable'));
    const hook = renderHook(() => usePaintSession(sessionId));

    await waitFor(() => expect(hook.result.current.error?.message).toBe('Snapshot unavailable'));
    vi.mocked(paintApi.paintApi.getSnapshot).mockResolvedValueOnce(initialSnapshot());
    await act(async () => { await hook.result.current.refresh(); });

    expect(hook.result.current.snapshot).not.toBeNull();
    expect(hook.result.current.error).toBeNull();
  });

  it('refreshes again when an event arrives before the first snapshot and the first response is stale', async () => {
    let resolveInitial: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    vi.mocked(paintApi.paintApi.getSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }))
      .mockResolvedValueOnce(initialSnapshot({ revision: 1, strokes: [committed().stroke] }));
    const hook = renderHook(() => usePaintSession(sessionId));

    act(() => handlers.get('paint.strokeCommitted')?.(committed({ revision: 1 })));
    await act(async () => { resolveInitial(initialSnapshot({ revision: 0 })); });

    await waitFor(() => expect(hook.result.current.snapshot?.revision).toBe(1));
    expect(paintApi.paintApi.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not display a previous session snapshot after the session id changes during a refresh', async () => {
    let resolveFirst: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    const nextSessionId = 'session-2';
    vi.mocked(paintApi.paintApi.getSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(initialSnapshot({ sessionId: nextSessionId }));
    const hook = renderHook(({ id }) => usePaintSession(id), { initialProps: { id: sessionId } });

    hook.rerender({ id: nextSessionId });
    await waitFor(() => expect(paintApi.paintApi.getSnapshot).toHaveBeenLastCalledWith(nextSessionId));
    await act(async () => { resolveFirst(initialSnapshot()); });

    expect(hook.result.current.snapshot?.sessionId).toBe(nextSessionId);
  });

  it('does not let queued work from an in-flight previous session request another previous-session snapshot', async () => {
    let resolveFirst: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    const nextSessionId = 'session-2';
    vi.mocked(paintApi.paintApi.getSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(initialSnapshot({ sessionId: nextSessionId }))
      .mockResolvedValueOnce(initialSnapshot());
    const hook = renderHook(({ id }) => usePaintSession(id), { initialProps: { id: sessionId } });
    const refreshFirstSession = hook.result.current.refresh;

    hook.rerender({ id: nextSessionId });
    await waitFor(() => expect(hook.result.current.snapshot?.sessionId).toBe(nextSessionId));
    vi.mocked(paintApi.paintApi.getSnapshot).mockClear();
    await refreshFirstSession();
    await act(async () => { resolveFirst(initialSnapshot()); });

    expect(paintApi.paintApi.getSnapshot).not.toHaveBeenCalled();
  });

  it('does not expose the previous session snapshot or previews in the first render after a session switch', async () => {
    const nextSessionId = 'session-2';
    const renders: Array<{ sessionId: string; snapshotId?: string; previewSessionId?: string }> = [];
    let resolveInitial: (snapshot: ReturnType<typeof initialSnapshot>) => void = () => {};
    function Probe({ id }: { id: string }) {
      const { snapshot, previews } = usePaintSession(id);
      renders.push({ sessionId: id, snapshotId: snapshot?.sessionId, previewSessionId: previews[0]?.sessionId });
      return null;
    }
    vi.mocked(paintApi.paintApi.getSnapshot)
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    const view = render(<Probe id={sessionId} />);
    await act(async () => { resolveInitial(initialSnapshot()); });
    await waitFor(() => expect(renders.at(-1)?.snapshotId).toBe(sessionId));
    act(() => handlers.get('paint.previewUpdated')?.({
      sessionId,
      generation: 0,
      authorUserId: 1,
      authorMatrixUserId: '@alice:server',
      input: preview(),
    }));
    await waitFor(() => expect(renders.at(-1)?.previewSessionId).toBe(sessionId));

    act(() => view.rerender(<Probe id={nextSessionId} />));

    expect(renders.find(rendered => rendered.sessionId === nextSessionId)).toEqual({ sessionId: nextSessionId });
  });

  it('does not expose a previous session initial-load error in the first render after a session switch', async () => {
    const nextSessionId = 'session-2';
    const renders: Array<{ sessionId: string; error?: string }> = [];
    function Probe({ id }: { id: string }) {
      const { error } = usePaintSession(id);
      renders.push({ sessionId: id, error: error?.message });
      return null;
    }
    vi.mocked(paintApi.paintApi.getSnapshot)
      .mockRejectedValueOnce(new Error('Session A unavailable'))
      .mockImplementation(() => new Promise(() => {}));
    const view = render(<Probe id={sessionId} />);
    await waitFor(() => expect(renders.at(-1)?.error).toBe('Session A unavailable'));

    act(() => view.rerender(<Probe id={nextSessionId} />));

    expect(renders.find(rendered => rendered.sessionId === nextSessionId)).toEqual({ sessionId: nextSessionId });
  });
});
