import { describe, expect, it } from 'vitest';
import { conversationKey, type Conversation } from './conversation';
import {
  createWorkspaceState,
  isHomeKey,
  selectActiveConversation,
  selectHomeKey,
  workspaceReducer,
  type WorkspaceState,
} from './workspaceState';

const channel = (id: string): Conversation => ({ kind: 'channel', channelId: id });
const dm = (id: string): Conversation => ({ kind: 'dm', contactId: id });
const keys = (state: WorkspaceState) => state.tabs.map(conversationKey);

const joined = (id: string | null, base = createWorkspaceState()) =>
  workspaceReducer(base, { type: 'JOINED_CHANNEL_CHANGED', channelId: id });

describe('workspace conversation tabs', () => {
  it('starts empty and disconnected', () => {
    const state = createWorkspaceState();
    expect(state).toEqual({ joinedChannelId: null, tabs: [], activeKey: null });
    expect(selectHomeKey(state)).toBeNull();
    expect(selectActiveConversation(state)).toBeNull();
  });

  it('creates a pinned home tab when joining a channel', () => {
    const state = joined('7');
    expect(keys(state)).toEqual(['channel:7']);
    expect(state.activeKey).toBe('channel:7');
    expect(isHomeKey(state, 'channel:7')).toBe(true);
  });

  it('keeps a home tab at server root', () => {
    const state = joined('server-root');
    expect(keys(state)).toEqual(['channel:server-root']);
    expect(selectHomeKey(state)).toBe('channel:server-root');
  });

  it('appends and activates an opened conversation', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('@val:example.com') });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:@val:example.com']);
    expect(state.activeKey).toBe('dm:@val:example.com');
  });

  it('activates rather than duplicating an already open conversation', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:a']);
    expect(state.activeKey).toBe('channel:9');
  });

  it('replaces the home tab when the joined channel changes and leaves browsed tabs alone', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(keys(state)).toEqual(['channel:12', 'channel:9']);
    expect(selectHomeKey(state)).toBe('channel:12');
  });

  it('absorbs a browsed tab that becomes the new home instead of showing it twice', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '9' });
    expect(keys(state)).toEqual(['channel:9', 'dm:a']);
    expect(state.activeKey).toBe('dm:a');
  });

  it('follows the absorbed tab into home when it was the active tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '9' });
    expect(keys(state)).toEqual(['channel:9']);
    expect(state.activeKey).toBe('channel:9');
  });

  it('moves activation to the new home when the old home was active', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:7' });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(state.activeKey).toBe('channel:12');
  });

  it('keeps activation on a browsed tab across a channel move', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '12' });
    expect(state.activeKey).toBe('channel:9');
  });

  it('refuses to close the home tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:7' });
    expect(keys(state)).toEqual(['channel:7']);
  });

  it('activates the right neighbour when closing the active tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:9' });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:9' });
    expect(keys(state)).toEqual(['channel:7', 'dm:a']);
    expect(state.activeKey).toBe('dm:a');
  });

  it('falls back to the left neighbour when closing the last tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'dm:a' });
    expect(state.activeKey).toBe('channel:9');
  });

  it('leaves activation alone when closing an inactive tab', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: channel('9') });
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:9' });
    expect(state.activeKey).toBe('dm:a');
  });

  it('treats invalidation as a close', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'CONVERSATION_INVALIDATED', key: 'dm:a' });
    expect(keys(state)).toEqual(['channel:7']);
    expect(state.activeKey).toBe('channel:7');
  });

  it('restores non-home tabs and activates home', () => {
    let state = joined('7');
    state = workspaceReducer(state, {
      type: 'RESTORE_CONVERSATIONS',
      conversations: [channel('9'), dm('a'), channel('7')],
    });
    expect(keys(state)).toEqual(['channel:7', 'channel:9', 'dm:a']);
    expect(state.activeKey).toBe('channel:7');
  });

  it('drops every tab and the home tab on disconnect', () => {
    let state = joined('7');
    state = workspaceReducer(state, { type: 'OPEN_CONVERSATION', conversation: dm('a') });
    state = workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: null });
    expect(selectHomeKey(state)).toBeNull();
    expect(keys(state)).toEqual(['dm:a']);
    state = workspaceReducer(state, { type: 'WORKSPACE_RESET' });
    expect(keys(state)).toEqual([]);
    expect(state.activeKey).toBeNull();
  });

  it('returns the same state object when nothing changes', () => {
    const state = joined('7');
    expect(workspaceReducer(state, { type: 'JOINED_CHANNEL_CHANGED', channelId: '7' })).toBe(state);
    expect(workspaceReducer(state, { type: 'ACTIVATE_CONVERSATION', key: 'channel:7' })).toBe(state);
    expect(workspaceReducer(state, { type: 'CLOSE_CONVERSATION', key: 'channel:404' })).toBe(state);
  });
});
