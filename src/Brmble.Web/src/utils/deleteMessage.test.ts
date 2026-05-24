import { describe, expect, it, vi } from 'vitest';
import { deleteMessage, DeleteMessageError, resolveDeleteMessageApiBaseUrl } from './deleteMessage';

describe('deleteMessage', () => {
  it('prefers the configured server base URL over the current window origin', () => {
    expect(resolveDeleteMessageApiBaseUrl({
      homeserverUrl: 'https://localhost:1912/',
      fallbackOrigin: 'http://localhost:5173',
    })).toBe('https://localhost:1912');
  });

  it('returns parsed response when successful', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ roomId: '!r', eventId: '$e', redactionEventId: '$r', reason: 'brmble:self-delete', placeholderText: 'This message was deleted', actorType: 'user' }),
    }));

    const result = await deleteMessage('http://localhost:8080', 'token', { roomId: '!r', eventId: '$e' });
    expect(result.redactionEventId).toBe('$r');
  });

  it('throws typed error when request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ errorCode: 'not_message_owner' }),
      statusText: 'Forbidden',
    }));

    await expect(deleteMessage('http://localhost:8080', 'token', { roomId: '!r', eventId: '$e' }))
      .rejects.toEqual(expect.any(DeleteMessageError));
  });

  it('throws a network_error when fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    await expect(deleteMessage('http://localhost:8080', 'token', { roomId: '!r', eventId: '$e' }))
      .rejects.toMatchObject({ errorCode: 'network_error', detail: 'Failed to fetch' });
  });
});
