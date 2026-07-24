import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paintApi } from './paint';

const sessionId = 'session-1';

describe('paintApi browser fallback', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    Object.defineProperty(window, 'chrome', { configurable: true, value: undefined });
  });

  it.each([
    ['createSession', () => paintApi.createSession({ channelId: 7, participantUserIds: [2] }), '/paint/sessions', 'POST'],
    ['attachSource', () => paintApi.attachSource(sessionId, '$source'), '/paint/sessions/session-1/source', 'POST'],
    ['join', () => paintApi.join(sessionId), '/paint/sessions/session-1/join', 'POST'],
    ['leave', () => paintApi.leave(sessionId), '/paint/sessions/session-1/leave', 'POST'],
    ['commitStroke', () => paintApi.commitStroke(sessionId, { correlationId: 'stroke-1', generation: 0, tool: 'pen', width: 6, points: [] }), '/paint/sessions/session-1/stroke', 'POST'],
    ['sendPreview', () => paintApi.sendPreview(sessionId, { correlationId: 'stroke-1', generation: 0, tool: 'pen', width: 6, points: [] }), '/paint/sessions/session-1/preview', 'POST'],
    ['undo', () => paintApi.undo(sessionId), '/paint/sessions/session-1/undo', 'POST'],
    ['clear', () => paintApi.clear(sessionId), '/paint/sessions/session-1/clear', 'POST'],
    ['end', () => paintApi.end(sessionId), '/paint/sessions/session-1/end', 'POST'],
    ['getSnapshot', () => paintApi.getSnapshot(sessionId), '/paint/sessions/session-1', 'GET'],
  ])('uses the Task 4 %s endpoint', async (_operation, invoke, path, method) => {
    await invoke();

    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method }));
  });
});
