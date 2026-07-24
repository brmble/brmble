import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
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

  it('returns the created paint session from the browser fallback', async () => {
    const response = { sessionId: 'session-1', matrixRoomId: '!paint:server' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    await expect(paintApi.createSession({ channelId: 7, participantUserIds: [2] })).resolves.toEqual({ ...response, channelId: 7 });
  });
});

describe('paintApi WebView bridge', () => {
  it('returns the correlated created paint session response', async () => {
    const postMessage = vi.fn();
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage } },
    });

    const response = { sessionId: 'session-1', matrixRoomId: '!paint:server' };
    const result = paintApi.createSession({ channelId: 7, participantUserIds: [2] });
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual(expect.objectContaining({
      type: 'paint.create',
      data: expect.objectContaining({ channelId: 7, participantUserIds: [2], requestId: expect.any(Number) }),
    }));

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: JSON.stringify(response) },
      },
    });

    await expect(result).resolves.toEqual({ ...response, channelId: 7 });
  });
});
