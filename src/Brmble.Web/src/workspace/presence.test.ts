import { describe, expect, it } from 'vitest';
import { selectJoinedChannelId } from './presence';

describe('selectJoinedChannelId', () => {
  it('returns the stringified channel of the self user', () => {
    expect(selectJoinedChannelId([
      { channelId: 3 },
      { self: true, channelId: 7 },
    ])).toBe('7');
  });

  it('maps the root channel to server-root', () => {
    expect(selectJoinedChannelId([{ self: true, channelId: 0 }])).toBe('server-root');
  });

  it('returns null when there is no self user', () => {
    expect(selectJoinedChannelId([{ channelId: 7 }])).toBeNull();
    expect(selectJoinedChannelId([])).toBeNull();
  });

  it('returns null when the self user has no channel', () => {
    expect(selectJoinedChannelId([{ self: true }])).toBeNull();
  });
});
