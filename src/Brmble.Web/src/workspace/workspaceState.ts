import { conversationKey, type Conversation } from './conversation';

export interface WorkspaceState {
  joinedChannelId: string | null;
  tabs: Conversation[];
  activeKey: string | null;
}

export type WorkspaceEvent =
  | { type: 'JOINED_CHANNEL_CHANGED'; channelId: string | null }
  | { type: 'OPEN_CONVERSATION'; conversation: Conversation }
  | { type: 'CLOSE_CONVERSATION'; key: string }
  | { type: 'ACTIVATE_CONVERSATION'; key: string }
  | { type: 'CONVERSATION_INVALIDATED'; key: string }
  | { type: 'RESTORE_CONVERSATIONS'; conversations: Conversation[] }
  | { type: 'WORKSPACE_RESET' };

export const createWorkspaceState = (): WorkspaceState => ({
  joinedChannelId: null,
  tabs: [],
  activeKey: null,
});

export const selectHomeKey = (state: WorkspaceState): string | null =>
  state.joinedChannelId === null ? null : `channel:${state.joinedChannelId}`;

export const isHomeKey = (state: WorkspaceState, key: string): boolean =>
  selectHomeKey(state) === key;

export const selectActiveConversation = (state: WorkspaceState): Conversation | null =>
  state.tabs.find(tab => conversationKey(tab) === state.activeKey) ?? null;

function withoutKey(tabs: Conversation[], key: string | null): Conversation[] {
  if (key === null) return tabs;
  return tabs.filter(tab => conversationKey(tab) !== key);
}

function closeTab(state: WorkspaceState, key: string): WorkspaceState {
  if (isHomeKey(state, key)) return state;
  const index = state.tabs.findIndex(tab => conversationKey(tab) === key);
  if (index === -1) return state;

  const tabs = state.tabs.filter((_, position) => position !== index);
  if (state.activeKey !== key) return { ...state, tabs };

  const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
  const fallback = neighbour ? conversationKey(neighbour) : selectHomeKey(state);
  return { ...state, tabs, activeKey: fallback };
}

export const workspaceReducer = (
  state: WorkspaceState,
  event: WorkspaceEvent,
): WorkspaceState => {
  switch (event.type) {
    case 'JOINED_CHANNEL_CHANGED': {
      if (event.channelId === state.joinedChannelId) return state;

      const previousHomeKey = selectHomeKey(state);
      const rest = withoutKey(state.tabs, previousHomeKey);

      if (event.channelId === null) {
        const activeKey = state.activeKey === previousHomeKey
          ? (rest[0] ? conversationKey(rest[0]) : null)
          : state.activeKey;
        return { joinedChannelId: null, tabs: rest, activeKey };
      }

      const home: Conversation = { kind: 'channel', channelId: event.channelId };
      const homeKey = conversationKey(home);
      const absorbed = rest.some(tab => conversationKey(tab) === homeKey);
      const tabs = [home, ...withoutKey(rest, homeKey)];
      const activeKey = state.activeKey === previousHomeKey || state.activeKey === null || absorbed && state.activeKey === homeKey
        ? homeKey
        : tabs.some(tab => conversationKey(tab) === state.activeKey)
          ? state.activeKey
          : homeKey;

      return { joinedChannelId: event.channelId, tabs, activeKey };
    }

    case 'OPEN_CONVERSATION': {
      const key = conversationKey(event.conversation);
      if (state.tabs.some(tab => conversationKey(tab) === key)) {
        return state.activeKey === key ? state : { ...state, activeKey: key };
      }
      return { ...state, tabs: [...state.tabs, event.conversation], activeKey: key };
    }

    case 'ACTIVATE_CONVERSATION': {
      if (state.activeKey === event.key) return state;
      if (!state.tabs.some(tab => conversationKey(tab) === event.key)) return state;
      return { ...state, activeKey: event.key };
    }

    case 'CLOSE_CONVERSATION':
    case 'CONVERSATION_INVALIDATED':
      return closeTab(state, event.key);

    case 'RESTORE_CONVERSATIONS': {
      const homeKey = selectHomeKey(state);
      const home = state.tabs.find(tab => conversationKey(tab) === homeKey);
      const seen = new Set<string>(homeKey ? [homeKey] : []);
      const restored: Conversation[] = [];
      for (const conversation of event.conversations) {
        const key = conversationKey(conversation);
        if (seen.has(key)) continue;
        seen.add(key);
        restored.push(conversation);
      }
      const tabs = home ? [home, ...restored] : restored;
      return { ...state, tabs, activeKey: homeKey ?? (tabs[0] ? conversationKey(tabs[0]) : null) };
    }

    case 'WORKSPACE_RESET': {
      const homeKey = selectHomeKey(state);
      const home = state.tabs.find(tab => conversationKey(tab) === homeKey);
      return { ...state, tabs: home ? [home] : [], activeKey: home ? homeKey : null };
    }
  }
};
