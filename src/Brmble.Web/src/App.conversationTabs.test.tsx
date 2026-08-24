import { describe, expect, it } from 'vitest';
import { conversationKey } from './workspace/conversation';
import { selectJoinedChannelId } from './workspace/presence';
import {
  createWorkspaceState,
  selectActiveConversation,
  selectHomeKey,
  workspaceReducer,
} from './workspace/workspaceState';

// Presence and tabs must agree: whatever selectJoinedChannelId reports is the home tab.
describe('App presence and tab wiring contract', () => {
  it('derives the home tab from the self user channel', () => {
    const joinedChannelId = selectJoinedChannelId([{ channelId: 3 }, { self: true, channelId: 7 }]);
    const state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: joinedChannelId });
    expect(selectHomeKey(state)).toBe('channel:7');
  });

  it('opens a browsed channel without disturbing presence', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: { kind: 'channel', channelId: '9' } });
    expect(state.joinedChannelId).toBe('7');
    expect(selectHomeKey(state)).toBe('channel:7');
    expect(conversationKey(selectActiveConversation(state)!)).toBe('channel:9');
  });

  it('invalidates a dm by key', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: { kind: 'dm', contactId: 'a' } });
    state = workspaceReducer(state, { type: 'CONVERSATION_INVALIDATED', key: conversationKey({ kind: 'dm', contactId: 'a' }) });
    expect(state.tabs.map(conversationKey)).toEqual(['channel:7']);
  });
});
