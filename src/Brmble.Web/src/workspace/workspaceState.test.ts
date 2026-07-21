import { describe, expect, it } from 'vitest';
import {
  createWorkspaceState,
  getForegroundConversation,
  isMessagesPanelExpanded,
  workspaceReducer,
} from './workspaceState';

describe('workspace state machine', () => {
  it('creates the Messages-first empty-DM workspace', () => {
    const state = createWorkspaceState();

    expect(state).toEqual({
      messagesPanelExpanded: true,
      foreground: { kind: 'dm', contactId: '' },
      previousContent: { kind: 'dm', contactId: '' },
      remoteWatchCount: 0,
    });
    expect(isMessagesPanelExpanded(state)).toBe(true);
    expect(getForegroundConversation(state)).toBe(state.foreground);
  });

  it('closes once when the first remote watch starts and reopens when the final one ends', () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 1 });
    expect(state.messagesPanelExpanded).toBe(false);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 0 });
    expect(state.messagesPanelExpanded).toBe(true);
  });

  it('changes only Messages-panel visibility when remote watching starts or ends', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'SELECT_DM', contactId: '@val:example.com' });
    const foreground = state.foreground;
    const previousContent = state.previousContent;
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 1 });
    expect(state.messagesPanelExpanded).toBe(false);
    expect(state.foreground).toBe(foreground);
    expect(state.previousContent).toBe(previousContent);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 0 });
    expect(state.messagesPanelExpanded).toBe(true);
    expect(state.foreground).toBe(foreground);
    expect(state.previousContent).toBe(previousContent);
  });

  it('keeps a manually reopened panel open until the watch set becomes empty', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 1 });
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    expect(state.messagesPanelExpanded).toBe(true);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 2 });
    expect(state.messagesPanelExpanded).toBe(true);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 0 });
    expect(state.messagesPanelExpanded).toBe(true);
  });

  it('reopens the panel when the final watch ends after a manual close during watching', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 1 });
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    expect(state.messagesPanelExpanded).toBe(false);

    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 0 });

    expect(state.messagesPanelExpanded).toBe(true);
  });

  it('clamps remote-watch counts at zero and changes visibility only at zero edges', () => {
    const initialState = createWorkspaceState();
    let state = initialState;
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: -2 });
    expect(state).toBe(initialState);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 2 });
    const watchingState = state;
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 4 });
    expect(state.remoteWatchCount).toBe(4);
    expect(state.messagesPanelExpanded).toBe(false);
    expect(state.foreground).toBe(watchingState.foreground);
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: -1 });
    expect(state.remoteWatchCount).toBe(0);
    expect(state.messagesPanelExpanded).toBe(true);
  });

  it('resets a reconnecting session to the Messages-first workspace without clearing retained DM data', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'SELECT_DM', contactId: '@val:example.com' });
    const previousContent = state.previousContent;
    state = workspaceReducer(state, { type: 'SELECT_CHANNEL' });
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 2 });
    state = workspaceReducer(state, { type: 'CONNECTION_WORKSPACE_READY' });
    expect(state).toMatchObject({ messagesPanelExpanded: true, remoteWatchCount: 0 });
    expect(state.foreground).toEqual({ kind: 'dm', contactId: '' });
    expect(state.previousContent).toBe(previousContent);
  });

  it('falls back to the channel while watching when the selected DM is invalidated', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'SELECT_DM', contactId: '@val:example.com' });
    state = workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 1 });
    state = workspaceReducer(state, { type: 'SELECTED_DM_INVALIDATED' });
    expect(state.foreground).toEqual({ kind: 'channel' });
  });

  it('falls back to the empty DM workspace when an invalidated DM is not being watched', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'SELECT_DM', contactId: '@val:example.com' });
    state = workspaceReducer(state, { type: 'SELECTED_DM_INVALIDATED' });
    expect(state.foreground).toEqual({ kind: 'dm', contactId: '' });
  });

  it('preserves previous content when opening or toggling the Messages panel', () => {
    let state = workspaceReducer(createWorkspaceState(), { type: 'SELECT_DM', contactId: '@val:example.com' });
    const previousContent = state.previousContent;
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    state = workspaceReducer(state, { type: 'OPEN_MESSAGES_PANEL' });
    expect(state.previousContent).toBe(previousContent);
  });

  it('returns the original state for idempotent events', () => {
    const state = createWorkspaceState();

    expect(workspaceReducer(state, { type: 'REMOTE_WATCH_COUNT_CHANGED', count: 0 })).toBe(state);
    expect(workspaceReducer(state, { type: 'OPEN_MESSAGES_PANEL' })).toBe(state);
    expect(workspaceReducer(state, { type: 'CONNECTION_WORKSPACE_READY' })).toBe(state);
  });

  it('uses one toggle action for both successive visibility changes', () => {
    let state = createWorkspaceState();
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    state = workspaceReducer(state, { type: 'TOGGLE_MESSAGES_PANEL' });
    expect(state.messagesPanelExpanded).toBe(true);
  });
});
