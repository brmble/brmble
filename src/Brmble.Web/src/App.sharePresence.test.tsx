import { describe, expect, it } from 'vitest';
import { canWatchShareFromChannel } from './App';

describe('canWatchShareFromChannel', () => {
  // Browsing another channel can no longer affect the answer: the viewed channel
  // is not a parameter at all. Independence from selection is structural, so
  // there is nothing observable to assert about it here.

  it('allows watching a share published into the joined channel', () => {
    expect(canWatchShareFromChannel('7', 'channel-7')).toBe(true);
  });

  it('rejects a share from any other channel', () => {
    expect(canWatchShareFromChannel('7', 'channel-9')).toBe(false);
  });

  it('rejects when not in a channel', () => {
    expect(canWatchShareFromChannel(null, 'channel-7')).toBe(false);
  });

  it('rejects server-root because it owns no shares', () => {
    expect(canWatchShareFromChannel('server-root', 'channel-7')).toBe(false);
    expect(canWatchShareFromChannel('server-root', 'channel-server-root')).toBe(false);
  });

  it('rejects a room name that is not a channel activity room', () => {
    expect(canWatchShareFromChannel('7', 'room-7')).toBe(false);
    expect(canWatchShareFromChannel('7', 'channel-')).toBe(false);
    expect(canWatchShareFromChannel('7', '')).toBe(false);
  });
});
