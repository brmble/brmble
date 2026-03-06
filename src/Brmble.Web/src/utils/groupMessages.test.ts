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
