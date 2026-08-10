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
    ['createSession', () => paintApi.createSession({ channelId: 7, source: new File([new Uint8Array([1])], 'source.png', { type: 'image/png' }) }), '/paint/sessions', 'POST'],
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
    const response = { sessionId: 'session-1' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    const source = new File([new Uint8Array([1, 2, 3])], 'source.png', { type: 'image/png' });
    await expect(paintApi.createSession({ channelId: 7, source })).resolves.toEqual({ ...response, channelId: 7 });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toEqual({
      channelId: 7,
      source: { mimeType: 'image/png', dataBase64: 'AQID' },
    });
  });

  it('decodes a browser source response to a Blob', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mimeType: 'image/png', dataBase64: 'AQID' }), { status: 200 }));

    const blob = await paintApi.getSource(sessionId);

    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
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
    const response = { sessionId: 'session-1' };
    const source = new File([new Uint8Array([1, 2, 3])], 'source.png', { type: 'image/png' });
    const result = paintApi.createSession({ channelId: 7, source });
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual(expect.objectContaining({
      type: 'paint.create',
      data: expect.objectContaining({ channelId: 7, source: { mimeType: 'image/png', dataBase64: 'AQID' }, requestId: expect.any(Number) }),
    }));

    bridge._handleMessage({
      data: {
        type: 'paint.response',
        data: { requestId: request.data.requestId, success: true, body: JSON.stringify(response) },
      },
    });

    await expect(result).resolves.toEqual({ ...response, channelId: 7 });
  });

  it('decodes a correlated paint source response to a Blob', async () => {
    const result = paintApi.getSource(sessionId);
    const postMessage = window.chrome!.webview!.postMessage as ReturnType<typeof vi.fn>;
    const request = postMessage.mock.calls[0][0];

    expect(request).toEqual({ type: 'paint.request', data: { action: 'source', sessionId, requestId: expect.any(Number) } });
    bridge._handleMessage({ data: { type: 'paint.response', data: { requestId: request.data.requestId, success: true, body: JSON.stringify({ mimeType: 'image/png', dataBase64: 'AQID' }) } } });

    const blob = await result;
    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
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
