import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeSpectator, unsubscribeSpectator, isRpsSpectatorView } from './games';
import bridge from '../bridge';

describe('spectator api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('over the WebView bridge', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', { webview: {} });
    });

    it('tunnels subscribe through games.request and resolves the parsed body', async () => {
      const send = vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId, success: true, body: JSON.stringify({ channelId: 7, match: null }),
        })));
      });

      await expect(subscribeSpectator(7)).resolves.toEqual({ channelId: 7, match: null });
      expect(send).toHaveBeenCalledWith('games.request', expect.objectContaining({
        action: 'spectate-subscribe', channelId: 7,
      }));
    });

    it('tunnels unsubscribe through games.request', async () => {
      const send = vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId, success: true, body: JSON.stringify({ unsubscribed: true }),
        })));
      });

      await expect(unsubscribeSpectator()).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith('games.request', expect.objectContaining({
        action: 'spectate-unsubscribe',
      }));
    });

    /**
     * The bridge failure envelope carries BOTH a raw `error` string built by
     * MumbleAdapter.ParseHttpResponse (`Server returned 400: {json}`) and the
     * untouched `body`. Rejecting on `error` would surface a raw JSON blob to the
     * user in the WebView2 build; the body is the only source of the clean
     * sentence and the machine-readable reason.
     */
    it('rejects a structured bridge failure with the human message and reason, not the raw blob', async () => {
      const errorBody = JSON.stringify({
        error: 'You must be in the channel to watch it.',
        reason: 'notSameChannel',
      });
      vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId,
          success: false,
          statusCode: 400,
          body: errorBody,
          error: `Server returned 400: ${errorBody}`,
        })));
      });

      await expect(subscribeSpectator(7)).rejects.toMatchObject({
        message: 'You must be in the channel to watch it.',
        reason: 'notSameChannel',
      });
    });

    /** Non-JSON bodies and null bodies must keep the pre-existing fallback. */
    it('falls back to the transport error when the failure body is not structured', async () => {
      vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId, success: false, statusCode: 0, body: null, error: 'No client certificate',
        })));
      });

      await expect(subscribeSpectator(7)).rejects.toThrow('No client certificate');
    });
  });

  describe('over fetch', () => {
    it('posts the channel id and returns the body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ channelId: 7, match: null }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(subscribeSpectator(7)).resolves.toEqual({ channelId: 7, match: null });
      expect(fetchMock).toHaveBeenCalledWith('/games/spectators/subscribe', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 7 }),
      }));
    });

    it('surfaces the structured reason on rejection', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: 'You must be in the channel to watch it.', reason: 'notSameChannel' }),
        { status: 400 },
      )));

      await expect(subscribeSpectator(8)).rejects.toMatchObject({ reason: 'notSameChannel' });
    });

    it('surfaces the structured reason when unsubscribe fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: 'Not spectating.', reason: 'notPresent' }),
        { status: 400 },
      )));

      await expect(unsubscribeSpectator()).rejects.toMatchObject({ reason: 'notPresent' });
    });
  });

  it('narrows an rps view by kind', () => {
    expect(isRpsSpectatorView({
      kind: 'rps', players: [10, 20], bestOf: 3, targetWins: 2, roundNumber: 1,
      roundWins: [0, 0], committed: [false, false], finished: false, winnerId: null, lastRound: null,
    })).toBe(true);
    expect(isRpsSpectatorView({
      kind: 'deathroll', players: [10, 20], currentPlayer: 10, ceiling: 100,
      lastRoll: null, finished: false, loserId: null,
    })).toBe(false);
  });
});
