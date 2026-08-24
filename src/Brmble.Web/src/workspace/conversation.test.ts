import { describe, expect, it } from 'vitest';
import { conversationKey, isChannelConversation, sameConversation, type Conversation } from './conversation';

describe('conversation identity', () => {
  it('keys channels and dms into disjoint namespaces', () => {
    expect(conversationKey({ kind: 'channel', channelId: '7' })).toBe('channel:7');
    expect(conversationKey({ kind: 'dm', contactId: '@val:example.com' })).toBe('dm:@val:example.com');
    expect(conversationKey({ kind: 'channel', channelId: 'server-root' })).toBe('channel:server-root');
  });

  it('never collides a channel id with a contact id', () => {
    const channel: Conversation = { kind: 'channel', channelId: '7' };
    const dm: Conversation = { kind: 'dm', contactId: '7' };
    expect(conversationKey(channel)).not.toBe(conversationKey(dm));
    expect(sameConversation(channel, dm)).toBe(false);
  });

  it('compares by value, not reference', () => {
    expect(sameConversation({ kind: 'channel', channelId: '7' }, { kind: 'channel', channelId: '7' })).toBe(true);
    expect(sameConversation({ kind: 'channel', channelId: '7' }, { kind: 'channel', channelId: '8' })).toBe(false);
  });

  it('narrows channel conversations', () => {
    const c: Conversation = { kind: 'channel', channelId: '7' };
    expect(isChannelConversation(c)).toBe(true);
    expect(isChannelConversation({ kind: 'dm', contactId: 'a' })).toBe(false);
  });
});
