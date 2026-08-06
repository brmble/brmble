import { beforeEach, describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import {
  MessageDeletionError,
  messageApi,
} from './messages';

vi.mock('../bridge', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  },
}));

describe('messageApi.delete', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('correlates a successful WebView bridge response', async () => {
    vi.stubGlobal('chrome', { webview: {} });
    vi.mocked(bridge.send).mockImplementation((_type, data) => {
      const requestId = (data as { requestId: number }).requestId;
      const handler = vi.mocked(bridge.on).mock.calls
        .find(([type]) => type === 'messages.response')?.[1];
      handler?.({ requestId, success: true, body: '{"status":"deleted"}', statusCode: 200 });
    });

    await expect(messageApi.delete('!general:test', '$message:test')).resolves.toBeUndefined();
    expect(bridge.send).toHaveBeenCalledWith('messages.delete', expect.objectContaining({
      roomId: '!general:test', eventId: '$message:test',
    }));
    expect(bridge.off).toHaveBeenCalledWith('messages.response', expect.any(Function));
  });

  it('preserves a structured expired error', async () => {
    vi.stubGlobal('chrome', { webview: {} });
    vi.mocked(bridge.send).mockImplementation((_type, data) => {
      const requestId = (data as { requestId: number }).requestId;
      const handler = vi.mocked(bridge.on).mock.calls
        .find(([type]) => type === 'messages.response')?.[1];
      handler?.({
        requestId, success: false,
        body: JSON.stringify({ code: 'expired', error: 'Messages can only be deleted within 24 hours.' }),
        statusCode: 410, error: 'Gone',
      });
    });

    await expect(messageApi.delete('!general:test', '$message:test')).rejects.toEqual(expect.objectContaining({
      code: 'expired', statusCode: 410,
      message: 'Messages can only be deleted within 24 hours.',
    } satisfies Partial<MessageDeletionError>));
  });

  it('uses direct fetch outside WebView', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 'deleted' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    await messageApi.delete('!general:test', '$message:test');
    expect(fetch).toHaveBeenCalledWith('/messages/delete', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ roomId: '!general:test', eventId: '$message:test' }),
    }));
  });

  it('maps an unknown server code to request_failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '{"code":"new_server_code","error":"Rejected"}', { status: 400 },
    )));

    await expect(messageApi.delete('!general:test', '$message:test')).rejects.toEqual(expect.objectContaining({
      code: 'request_failed', message: 'Rejected',
    }));
  });

  it('times out and removes the bridge listener', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', { webview: {} });

    const pending = messageApi.delete('!general:test', '$message:test');
    const rejection = expect(pending).rejects.toEqual(expect.objectContaining({
      code: 'request_failed', message: 'Message deletion timed out. Try again.',
    }));
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(bridge.off).toHaveBeenCalledWith('messages.response', expect.any(Function));
    vi.useRealTimers();
  });
});
