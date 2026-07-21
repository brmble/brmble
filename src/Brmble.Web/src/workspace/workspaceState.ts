export type ForegroundConversation =
  | { kind: 'channel' }
  | { kind: 'dm'; contactId: string };

export interface WorkspaceState {
  messagesPanelExpanded: boolean;
  foreground: ForegroundConversation;
  previousContent: ForegroundConversation;
  remoteWatchCount: number;
}

export type WorkspaceEvent =
  | { type: 'REMOTE_WATCH_COUNT_CHANGED'; count: number }
  | { type: 'CONNECTION_WORKSPACE_READY' }
  | { type: 'TOGGLE_MESSAGES_PANEL' }
  | { type: 'OPEN_MESSAGES_PANEL' }
  | { type: 'SELECT_CHANNEL' }
  | { type: 'SELECT_DM'; contactId: string }
  | { type: 'SELECTED_DM_INVALIDATED' };

const emptyDm: ForegroundConversation = { kind: 'dm', contactId: '' };

export const createWorkspaceState = (): WorkspaceState => ({
  messagesPanelExpanded: true,
  foreground: { ...emptyDm },
  previousContent: { ...emptyDm },
  remoteWatchCount: 0,
});

export const isMessagesPanelExpanded = (state: WorkspaceState): boolean =>
  state.messagesPanelExpanded;

export const getForegroundConversation = (
  state: WorkspaceState,
): ForegroundConversation => state.foreground;

export const workspaceReducer = (
  state: WorkspaceState,
  event: WorkspaceEvent,
): WorkspaceState => {
  switch (event.type) {
    case 'REMOTE_WATCH_COUNT_CHANGED': {
      const count = Math.max(0, event.count);
      const wasWatching = state.remoteWatchCount > 0;
      const isWatching = count > 0;
      const messagesPanelExpanded =
        wasWatching === isWatching
          ? state.messagesPanelExpanded
          : !isWatching;

      if (
        count === state.remoteWatchCount &&
        messagesPanelExpanded === state.messagesPanelExpanded
      ) {
        return state;
      }

      return { ...state, remoteWatchCount: count, messagesPanelExpanded };
    }
    case 'CONNECTION_WORKSPACE_READY':
      if (
        state.messagesPanelExpanded &&
        state.remoteWatchCount === 0 &&
        state.foreground.kind === 'dm' &&
        state.foreground.contactId === ''
      ) {
        return state;
      }
      return {
        ...state,
        messagesPanelExpanded: true,
        foreground: { ...emptyDm },
        remoteWatchCount: 0,
      };
    case 'TOGGLE_MESSAGES_PANEL':
      return { ...state, messagesPanelExpanded: !state.messagesPanelExpanded };
    case 'OPEN_MESSAGES_PANEL':
      return state.messagesPanelExpanded
        ? state
        : { ...state, messagesPanelExpanded: true };
    case 'SELECT_CHANNEL':
      return state.foreground.kind === 'channel'
        ? state
        : { ...state, foreground: { kind: 'channel' } };
    case 'SELECT_DM': {
      if (
        state.foreground.kind === 'dm' &&
        state.foreground.contactId === event.contactId
      ) {
        return state;
      }
      const foreground = { kind: 'dm' as const, contactId: event.contactId };
      return { ...state, foreground, previousContent: foreground };
    }
    case 'SELECTED_DM_INVALIDATED': {
      if (state.foreground.kind !== 'dm') {
        return state;
      }

      const foreground =
        state.remoteWatchCount > 0 ? { kind: 'channel' as const } : { ...emptyDm };
      if (
        state.foreground.kind === foreground.kind &&
        (foreground.kind === 'channel' ||
          (state.foreground.kind === 'dm' &&
            state.foreground.contactId === foreground.contactId))
      ) {
        return state;
      }
      return { ...state, foreground };
    }
  }
};
