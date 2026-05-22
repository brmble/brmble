import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../types';
import {
  MESSAGE_EDIT_WINDOW_MS,
  buildMessageEditContent,
  canEditMessage,
  compareReplacementEdits,
  getEditedBody,
  isReplacementEvent,
  parseBundledReplacementFromUnsigned,
  parseReplacementEvent,
} from './matrixMessageEditing';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: '$msg',
    channelId: '42',
    sender: 'Alice',
    senderMatrixUserId: '@alice:example.com',
    content: 'hello',
    timestamp: new Date('2026-05-21T12:00:00.000Z'),
    msgType: 'm.text',
    ...overrides,
  };
}

describe('matrixMessageEditing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts only editable self-authored plain-text messages inside the window', () => {
    vi.setSystemTime(new Date('2026-05-22T11:59:59.000Z'));

    expect(canEditMessage(makeMessage(), '@alice:example.com')).toBe(true);
    expect(canEditMessage(makeMessage({ senderMatrixUserId: '@bob:example.com' }), '@alice:example.com')).toBe(false);
    expect(canEditMessage(makeMessage({ msgType: 'm.image' }), '@alice:example.com')).toBe(false);
    expect(canEditMessage(makeMessage({ pending: true }), '@alice:example.com')).toBe(false);
    expect(canEditMessage(makeMessage({ redacted: true }), '@alice:example.com')).toBe(false);
    expect(canEditMessage(makeMessage({ html: true }), '@alice:example.com')).toBe(true);
    expect(canEditMessage(makeMessage({ msgType: undefined }), '@alice:example.com')).toBe(true);
  });

  it('rejects messages older than the edit window', () => {
    vi.setSystemTime(new Date('2026-05-22T12:00:01.000Z'));

    expect(canEditMessage(makeMessage(), '@alice:example.com')).toBe(false);
    expect(MESSAGE_EDIT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('builds a Matrix replacement payload with m.new_content and fallback body', () => {
    expect(buildMessageEditContent('$original', 'Edited text')).toEqual({
      msgtype: 'm.text',
      body: '* Edited text',
      'm.new_content': {
        msgtype: 'm.text',
        body: 'Edited text',
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: '$original',
      },
    });
  });

  it('recognizes and parses replacement events', () => {
    const replacementEvent = {
      getType: () => 'm.room.message',
      getId: () => '$replacement',
      getSender: () => '@alice:example.com',
      getTs: () => 1234,
      getContent: () => ({
        body: '* Edited text',
        msgtype: 'm.text',
        'm.new_content': { msgtype: 'm.text', body: 'Edited text' },
        'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
      }),
    };

    expect(isReplacementEvent(replacementEvent)).toBe(true);
    expect(parseReplacementEvent(replacementEvent)).toEqual({
      targetEventId: '$original',
      senderId: '@alice:example.com',
      body: 'Edited text',
      editEventId: '$replacement',
      timestamp: 1234,
    });
    expect(getEditedBody(replacementEvent.getContent())).toBe('Edited text');
  });

  it('preserves remote edited body text exactly when parsing replacement content', () => {
    expect(getEditedBody({
      msgtype: 'm.text',
      body: '*   padded edit  ',
      'm.new_content': { msgtype: 'm.text', body: '  padded edit  ' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    })).toBe('  padded edit  ');

    expect(getEditedBody({
      msgtype: 'm.text',
      body: '* image edit',
      'm.new_content': { msgtype: 'm.image', body: 'image edit' },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original' },
    })).toBeNull();
  });

  it('parses bundled replacement data from unsigned relations', () => {
    const originalEvent = {
      getId: () => '$original',
      getUnsigned: () => ({
        'm.relations': {
          'm.replace': {
            event_id: '$replacement',
            origin_server_ts: 2222,
            sender: '@alice:example.com',
            content: {
              body: '* bundled',
              msgtype: 'm.text',
              'm.new_content': {
                body: 'bundled',
                msgtype: 'm.text',
              },
            },
          },
        },
      }),
    };

    expect(parseBundledReplacementFromUnsigned(originalEvent as never)).toEqual({
      targetEventId: '$original',
      senderId: '@alice:example.com',
      body: 'bundled',
      editEventId: '$replacement',
      timestamp: 2222,
    });
  });

  it('orders replacement events by timestamp then lexicographically by event id', () => {
    expect(compareReplacementEdits(
      { targetEventId: '$a', senderId: '@alice:example.com', body: 'one', editEventId: '$aaa', timestamp: 1000 },
      { targetEventId: '$a', senderId: '@alice:example.com', body: 'two', editEventId: '$bbb', timestamp: 1000 },
    )).toBeLessThan(0);
  });
});
