import { describe, expect, it } from 'vitest';
import { shouldKeepPaintSession } from './App';

// The viewed channel is deliberately not a parameter of this predicate: browsing
// cannot affect paint survival because there is nothing here to observe it with.
// The cases below therefore vary only session ownership and connection.
describe('paint session survival', () => {
  it('survives while the joined channel still owns the session', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: '7' })).toBe(true);
  });

  it('ends when the user moves to a different voice channel', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: '12' })).toBe(false);
  });

  it('ends when the user leaves voice entirely', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: null })).toBe(false);
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: '7', joinedChannelId: 'server-root' })).toBe(false);
  });

  it('ends when the connection drops', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'disconnected', sessionChannelId: '7', joinedChannelId: '7' })).toBe(false);
  });

  it('ends when no owning channel was recorded for the session', () => {
    expect(shouldKeepPaintSession({ connectionStatus: 'connected', sessionChannelId: undefined, joinedChannelId: '7' })).toBe(false);
  });
});
