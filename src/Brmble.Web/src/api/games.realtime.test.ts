import { afterEach, describe, expect, it, vi } from 'vitest';
import bridge from '../bridge';
import { requestRealtimeTicket } from './games';

describe('requestRealtimeTicket', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the correlated realtime-ticket bridge action in WebView', async () => {
    vi.stubGlobal('chrome', { webview: {} });
    const ticket = { protocolVersion: 1, ticket: 'token', url: 'wss://chat.example/games/realtime', expiresAt: '2026-08-28T12:00:15Z' };
    const send = vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
      if (type !== 'games.request') return;
      const { requestId } = data as { requestId: number };
      queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(handler => handler({
        requestId, success: true, body: JSON.stringify(ticket),
      })));
    });

    await expect(requestRealtimeTicket(91, 'participant')).resolves.toEqual(ticket);
    expect(send).toHaveBeenCalledWith('games.request', expect.objectContaining({
      action: 'realtime-ticket', matchId: 91, role: 'participant',
    }));
  });

  it('unwraps a structured bridge error identically to fetch', async () => {
    vi.stubGlobal('chrome', { webview: {} });
    vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
      if (type !== 'games.request') return;
      const { requestId } = data as { requestId: number };
      queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(handler => handler({
        requestId, success: false, statusCode: 400,
        body: JSON.stringify({ error: 'The match is not live.', reason: 'matchNotLive' }),
        error: 'Server returned 400',
      })));
    });

    await expect(requestRealtimeTicket(91, 'participant')).rejects.toMatchObject({
      message: 'The match is not live.', reason: 'matchNotLive',
    });
  });

  it('returns the fetch ticket envelope', async () => {
    const ticket = { protocolVersion: 1, ticket: 'token', url: 'wss://chat.example/games/realtime', expiresAt: '2026-08-28T12:00:15Z' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(ticket), { status: 200 })));

    await expect(requestRealtimeTicket(91, 'participant')).resolves.toEqual(ticket);
  });

  it('posts exact participant scope and unwraps a structured fetch error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'The match is not live.', reason: 'matchNotLive' }),
      { status: 400 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestRealtimeTicket(91, 'participant')).rejects.toMatchObject({
      message: 'The match is not live.', reason: 'matchNotLive',
    });
    expect(fetchMock).toHaveBeenCalledWith('/games/realtime-ticket', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId: 91, role: 'participant' }),
    });
  });
});
