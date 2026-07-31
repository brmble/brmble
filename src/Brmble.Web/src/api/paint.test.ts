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
    ['createSession', () => paintApi.createSession({ channelId: 7, participantSessionIds: [2] }), '/paint/sessions', 'POST'],
    ['attachSource', () => paintApi.attachSource(sessionId, '$source'), '/paint/sessions/session-1/source', 'POST'],
    ['join', () => paintApi.join(sessionId), '/paint/sessions/session-1/join', 'POST'],
    ['leave', () => paintApi.leave(sessionId), '/paint/sessions/session-1/leave', 'POST'],
    ['commitStroke', () => paintApi.commitStroke(sessionId, { correlationId: 'stroke-1', generation: 0, tool: 'pen', width: 6, points: [] }), '/paint/sessions/session-1/stroke', 'POST'],
    ['sendPreview', () => paintApi.sendPreview(sessionId, { correlationId: 'stroke-1', generation: 0, tool: 'pen', width: 6, points: [] }), '/paint/sessions/session-1/preview', 'POST'],
    ['undo', () => paintApi.undo(sessionId), '/paint/sessions/session-1/undo', 'POST'],
    ['clear', () => paintApi.clear(sessionId), '/paint/sessions/session-1/clear', 'POST'],
    ['end', () => paintApi.end(sessionId), '/paint/sessions/session-1/end', 'POST'],
    ['getSnapshot', () => paintApi.getSnapshot(sessionId), '/paint/sessions/session-1', 'GET'],
    ['getSummary', () => paintApi.getSummary(sessionId), '/paint/sessions/session-1/summary', 'GET'],
  ])('uses the Task 4 %s endpoint', async (_operation, invoke, path, method) => {
    await invoke();

    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ method }));
  });

  it('returns the created paint session from the browser fallback', async () => {
    const response = { sessionId: 'session-1', matrixRoomId: '!paint:server' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    await expect(paintApi.createSession({ channelId: 7, participantSessionIds: [2] })).resolves.toEqual({ ...response, channelId: 7 });
  });

  it('accepts an empty successful mutation response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(paintApi.clear(sessionId)).resolves.toBeUndefined();
  });
});

describe('paintApi WebView bridge', () => {
  const stroke = {
    correlationId: 'stroke-1',
    generation: 3,
    tool: 'pen' as const,
    color: '#123456',
    width: 6 as const,
    points: [{ x: 0.25, y: 0.75, pressure: 0.5 }],
  };

  beforeEach(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { webview: { postMessage: vi.fn() } },
    });
  });

  it('returns the correlated created paint session response', async () => {
    const response = { sessionId: 'session-1', matrixRoomId: '!paint:server' };
    const result = paintApi.createSession({ channelId: 7, participantSessionIds: [2] });
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual(expect.objectContaining({
      type: 'paint.create',
      data: expect.objectContaining({ channelId: 7, participantSessionIds: [2], requestId: expect.any(Number) }),
    }));

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: JSON.stringify(response) },
      },
    });

    await expect(result).resolves.toEqual({ ...response, channelId: 7 });
  });

  it('requests a summary through the bridge without fetching the snapshot', async () => {
    const response = { sessionId, channelId: 5, hostUserId: 7, status: 'active', canJoin: true, isParticipant: false };
    const result = paintApi.getSummary(sessionId);
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual({
      type: 'paint.request',
      data: { action: 'summary', sessionId, requestId: expect.any(Number) },
    });

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: JSON.stringify(response) },
      },
    });

    await expect(result).resolves.toEqual(response);
  });

  it.each([
    ['attachSource', 'paint.attachSource', () => paintApi.attachSource(sessionId, '$source'), { sessionId, sourceEventId: '$source' }],
    ['join', 'paint.join', () => paintApi.join(sessionId), { sessionId }],
    ['leave', 'paint.leave', () => paintApi.leave(sessionId), { sessionId }],
    ['commitStroke', 'paint.commitStroke', () => paintApi.commitStroke(sessionId, stroke), { sessionId, ...stroke }],
    ['sendPreview', 'paint.sendPreview', () => paintApi.sendPreview(sessionId, stroke), { sessionId, ...stroke }],
    ['undo', 'paint.undo', () => paintApi.undo(sessionId), { sessionId }],
    ['clear', 'paint.clear', () => paintApi.clear(sessionId), { sessionId }],
    ['end', 'paint.end', () => paintApi.end(sessionId), { sessionId }],
  ])('correlates the %s mutation and retains its payload', async (_operation, event, invoke, payload) => {
    const result = invoke();
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual({
      type: event,
      data: { ...payload, requestId: expect.any(Number) },
    });

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: '{}' },
      },
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('keeps end pending until its correlated response arrives', async () => {
    const result = paintApi.end(sessionId);
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];
    const settled = vi.fn();
    void result.then(settled, settled);

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId + 1, success: true, body: '{}' },
      },
    });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: '{}' },
      },
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('rejects end with the correlated bridge error', async () => {
    const result = paintApi.end(sessionId);
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: false, statusCode: 409, error: 'Paint session is no longer open.' },
      },
    });

    await expect(result).rejects.toThrow('Paint session is no longer open.');
  });
});
