import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChannelRequestHttpError,
  createChannelRequest,
  listAdminChannelRequests,
} from './channelRequests';
import bridge from '../bridge';

vi.mock('../bridge', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  },
}));

describe('channelRequests API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { chrome?: unknown }).chrome;
  });

  it('maps conflict responses to structured errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: { code: 'duplicate_pending_request', message: 'You already have a pending request for this channel name.' },
      }),
    }));

    await expect(createChannelRequest({ channelName: 'Raid Team 2', reason: '' }))
      .rejects.toMatchObject({ code: 'duplicate_pending_request' });
  });

  it('maps empty forbidden responses to ChannelRequestHttpError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
      text: async () => '',
    }));

    await expect(listAdminChannelRequests())
      .rejects.toBeInstanceOf(ChannelRequestHttpError);
  });

  it('uses the native bridge in WebView so requests include the client certificate path', async () => {
    (window as Window & { chrome?: unknown }).chrome = {
      webview: {
        addEventListener: vi.fn(),
        postMessage: vi.fn(),
      },
    };
    let responseHandler: ((data: unknown) => void) | undefined;
    vi.mocked(bridge.on).mockImplementation((type, handler) => {
      if (type === 'channelRequests.response') responseHandler = handler;
    });
    vi.mocked(bridge.send).mockImplementation((_type, data) => {
      const requestId = (data as { requestId: number }).requestId;
      responseHandler?.({
        requestId,
        success: true,
        statusCode: 201,
        body: JSON.stringify({
          id: 12,
          channelName: 'Raid Team 2',
          reason: null,
          status: 'pending',
          createdAtUtc: '2026-05-29T10:00:00Z',
          handledAtUtc: null,
          decisionReason: null,
        }),
      });
    });

    await expect(createChannelRequest({ channelName: 'Raid Team 2', reason: '' }))
      .resolves.toMatchObject({ id: 12, channelName: 'Raid Team 2' });
    expect(bridge.send).toHaveBeenCalledWith('channelRequests.request', expect.objectContaining({
      action: 'create',
      channelName: 'Raid Team 2',
    }));
  });
});
