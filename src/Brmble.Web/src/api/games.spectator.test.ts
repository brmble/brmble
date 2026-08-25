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
