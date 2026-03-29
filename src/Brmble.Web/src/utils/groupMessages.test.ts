import { describe, it, expect } from 'vitest';
import { groupMessages } from './groupMessages';
import type { ChatMessage } from '../types';

function msg(overrides: Partial<ChatMessage> & { sender: string; timestamp: Date }): ChatMessage {
  return {
    id: crypto.randomUUID(),
    channelId: 'test',
    content: 'hello',
    ...overrides,
  };
}

describe('groupMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('marks single message as group leader', () => {
    const messages = [msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') })];
    const result = groupMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0].isGroupStart).toBe(true);
    expect(result[0].showDateSeparator).toBe(true);
  });

  it('groups consecutive messages from same sender within 5 minutes', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:02:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:04:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[0].isGroupStart).toBe(true);
    expect(result[1].isGroupStart).toBe(false);
    expect(result[2].isGroupStart).toBe(false);
  });

  it('breaks group when sender changes', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'bob', timestamp: new Date('2026-01-01T10:01:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[0].isGroupStart).toBe(true);
    expect(result[1].isGroupStart).toBe(true);
  });

  it('breaks group after 5 minute gap', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:06:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[0].isGroupStart).toBe(true);
    expect(result[1].isGroupStart).toBe(true);
  });

  it('adds date separator on day boundary', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T23:59:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-02T00:01:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[0].showDateSeparator).toBe(true);
    expect(result[1].showDateSeparator).toBe(true);
    expect(result[1].isGroupStart).toBe(true); // day change breaks group
  });

  it('keeps group at exactly 5 minute boundary', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:05:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[1].isGroupStart).toBe(false);
  });

  it('does not show date separator for messages on the same day', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'bob', timestamp: new Date('2026-01-01T11:00:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[1].showDateSeparator).toBe(false);
  });

  it('system messages always start a new group', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'System', timestamp: new Date('2026-01-01T10:01:00'), type: 'system' }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:02:00') }),
    ];
    const result = groupMessages(messages);
    expect(result[0].isGroupStart).toBe(true);
    expect(result[1].isGroupStart).toBe(true);
    expect(result[2].isGroupStart).toBe(true);
  });
});

describe('showUnreadDivider', () => {
  it('is false for all messages when readMarkerTs is null/undefined', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
    ];

    const withNull = groupMessages(messages, null);
    expect(withNull.every(g => g.showUnreadDivider === false)).toBe(true);

    const withUndefined = groupMessages(messages, undefined);
    expect(withUndefined.every(g => g.showUnreadDivider === false)).toBe(true);

    const withOmitted = groupMessages(messages);
    expect(withOmitted.every(g => g.showUnreadDivider === false)).toBe(true);
  });

  it('is set exactly once on the first message with timestamp > readMarkerTs', () => {
    const readMarker = new Date('2026-01-01T10:02:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:03:00') }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:04:00') }),
    ];
    const result = groupMessages(messages, readMarker);

    expect(result[0].showUnreadDivider).toBe(false);
    expect(result[1].showUnreadDivider).toBe(false);
    expect(result[2].showUnreadDivider).toBe(true);
    expect(result[3].showUnreadDivider).toBe(false);
  });

  it('does not set showUnreadDivider on subsequent messages after the first unread', () => {
    const readMarker = new Date('2026-01-01T10:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:02:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:03:00') }),
    ];
    const result = groupMessages(messages, readMarker);

    expect(result[0].showUnreadDivider).toBe(true);
    expect(result[1].showUnreadDivider).toBe(false);
    expect(result[2].showUnreadDivider).toBe(false);
  });

  it('shows no divider when all messages are before readMarkerTs', () => {
    const readMarker = new Date('2026-01-01T12:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:30:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T11:00:00') }),
    ];
    const result = groupMessages(messages, readMarker);

    expect(result.every(g => g.showUnreadDivider === false)).toBe(true);
  });

  it('places divider on the first message when readMarkerTs is 0', () => {
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
    ];
    const result = groupMessages(messages, 0);

    expect(result[0].showUnreadDivider).toBe(true);
    expect(result[1].showUnreadDivider).toBe(false);
  });
});

describe('showUnreadDivider with currentUsername', () => {
  it('skips own messages and places divider on next message from another user', () => {
    const readMarker = new Date('2026-01-01T10:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:02:00') }),
    ];
    const result = groupMessages(messages, readMarker, 'alice');

    // Own messages should be skipped for divider placement
    expect(result[0].showUnreadDivider).toBe(false);
    expect(result[1].showUnreadDivider).toBe(false);
    // First message from another user gets the divider
    expect(result[2].showUnreadDivider).toBe(true);
  });

  it('places divider on own message when currentUsername is not provided', () => {
    const readMarker = new Date('2026-01-01T10:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:02:00') }),
    ];
    const result = groupMessages(messages, readMarker);

    // Without currentUsername, divider lands on the first message past readMarkerTs
    expect(result[0].showUnreadDivider).toBe(false);
    expect(result[1].showUnreadDivider).toBe(true);
    expect(result[2].showUnreadDivider).toBe(false);
  });

  it('does not skip system messages even when sender matches currentUsername', () => {
    const readMarker = new Date('2026-01-01T10:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:00:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00'), type: 'system' }),
      msg({ sender: 'bob',   timestamp: new Date('2026-01-01T10:02:00') }),
    ];
    const result = groupMessages(messages, readMarker, 'alice');

    // System messages are not treated as "own" even if sender matches
    expect(result[0].showUnreadDivider).toBe(false);
    expect(result[1].showUnreadDivider).toBe(true);
    expect(result[2].showUnreadDivider).toBe(false);
  });

  it('shows no divider when all messages after readMarkerTs are from current user', () => {
    const readMarker = new Date('2026-01-01T10:00:00').getTime();
    const messages = [
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:01:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:02:00') }),
      msg({ sender: 'alice', timestamp: new Date('2026-01-01T10:03:00') }),
    ];
    const result = groupMessages(messages, readMarker, 'alice');

    expect(result.every(g => g.showUnreadDivider === false)).toBe(true);
  });
});
