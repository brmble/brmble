import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { ServiceStatusProvider } from './hooks/useServiceStatus';

const mockValues = vi.hoisted(() => {
  let dmChatPanelProps: Record<string, unknown> | undefined;
  let headerProps: Record<string, unknown> | undefined;
  let dmStoreOptions: Record<string, unknown> | undefined;
  const matrixClient = {
    lastMessages: new Map(),
    activeMessages: [],
    setActiveChannel: vi.fn(),
    sendMessage: vi.fn(),
    sendImageMessage: vi.fn(),
    uploadContent: vi.fn(),
    fetchHistory: vi.fn(),
    sendReaction: vi.fn(),
    removeReaction: vi.fn(),
    dmLastMessages: new Map(),
    activeDmMessages: [],
    setActiveDmContact: vi.fn(),
    dmRoomMap: new Map<string, string>(),
    dmUserDisplayNames: new Map(),
    dmUserAvatarUrls: new Map(),
    sendDMMessage: vi.fn(),
    fetchDMHistory: vi.fn(),
    fetchAvatarUrl: vi.fn().mockResolvedValue(undefined),
    client: { marker: 'matrix-client', getRoom: vi.fn(() => undefined) },
    activeTypingText: 'Val is typing',
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
  };
  const dmStore = {
    contacts: [],
    selectedContact: null as { id: string; displayName: string; unreadCount: number; isEphemeral?: boolean; mumbleSessionId?: number | null } | null,
    messages: [],
    selectContact: vi.fn(),
    sendMessage: vi.fn(),
    startDM: vi.fn(),
    clearSelection: vi.fn(),
    closeDM: vi.fn(),
    selectedContactIdRef: { current: null as string | null },
    receiveMumbleDM: vi.fn(),
    updateMumbleSession: vi.fn(),
    clearMumbleContacts: vi.fn(),
    startMumbleDM: vi.fn(),
  };
  const unreadTracker = {
    roomUnreads: new Map(),
    getRoomUnread: vi.fn(() => ({ notificationCount: 0, highlightCount: 0, fullyReadEventId: null })),
    markRoomRead: vi.fn(),
    getFullyReadEventId: vi.fn(() => null),
    getMarkerTimestamp: vi.fn(() => null),
    totalUnreadCount: 0,
    totalDmUnreadCount: 0,
  };
  const idleActions = { autoLeftAt: null, preLeaveStartedAt: null, preLeaveCancelledAt: null, dismissNotification: vi.fn(), dismissPreLeaveCancelled: vi.fn() };
  const screenShare = {
    isSharing: false, startSharing: vi.fn(), stopSharing: vi.fn(), markLocalShareTeardownIntent: vi.fn(), error: null,
    activeShare: null, activeShares: [], watchingShare: null, watchingShares: [], pendingViewerShares: [], remoteWatchCount: 0, isViewerConnectPending: false,
    focusedShare: null, setFocusedShare: vi.fn(), setDiscoveryTarget: vi.fn(), remoteVideoEl: null, remoteVideoEls: new Map(),
    roomQuality: undefined, shareQualities: new Map(), addWatchingShare: vi.fn(), removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(), connectAsViewer: vi.fn(), handleScreenShareServiceUnavailable: vi.fn(),
  };
  const notificationQueue = { register: vi.fn(), unregister: vi.fn(), isVisible: vi.fn(() => false), visibleCount: 0, totalCount: 0 };

  return {
    matrixClient, dmStore, unreadTracker, idleActions, screenShare, notificationQueue,
    get dmChatPanelProps() { return dmChatPanelProps; },
    setDmChatPanelProps: (props: Record<string, unknown> | undefined) => { dmChatPanelProps = props; },
    get headerProps() { return headerProps; },
    setHeaderProps: (props: Record<string, unknown> | undefined) => { headerProps = props; },
    get dmStoreOptions() { return dmStoreOptions; },
    setDmStoreOptions: (options: Record<string, unknown> | undefined) => { dmStoreOptions = options; },
  };
});

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return { default: {
    send: vi.fn(),
    on: vi.fn((event: string, handler: (data: unknown) => void) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(handler); }),
    off: vi.fn((event: string, handler: (data: unknown) => void) => handlers.get(event)?.delete(handler)),
    __emit: (event: string, data?: unknown) => handlers.get(event)?.forEach(handler => handler(data)),
    __reset: () => handlers.clear(),
  } };
});

vi.mock('./components/Header/Header', () => ({ Header: (props: Record<string, unknown>) => { mockValues.setHeaderProps(props); return <header />; } }));
vi.mock('./components/Sidebar/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('./components/ChatPanel/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    if (props.isDM) mockValues.setDmChatPanelProps(props);
    return <section />;
  },
}));
vi.mock('./components/ServerList/ServerList', () => ({ ServerList: () => <section /> }));
vi.mock('./components/ConnectionState/ConnectionState', () => ({ ConnectionState: () => <section /> }));
vi.mock('./components/DMContactList/DMContactList', () => ({ DMContactList: () => null }));
vi.mock('./components/NeonD/NeonDGame', () => ({ NeonDGame: () => null }));
vi.mock('./components/SettingsModal/SettingsModal', () => ({
  DEFAULT_SCREEN_SHARE: { captureAudio: false, resolution: '1080p', fps: 30, systemAudio: false, viewerMode: 'in-app' },
  SettingsModal: () => null,
}));
vi.mock('./hooks/useMatrixClient', () => ({ useMatrixClient: () => mockValues.matrixClient }));
vi.mock('./hooks/useChatStore', () => ({ useChatStore: () => ({ messages: [], addMessage: vi.fn() }), addMessageToStore: vi.fn(), clearChatStorage: vi.fn(), purgeEphemeralMessages: vi.fn() }));
vi.mock('./hooks/useDMStore', () => ({ useDMStore: (options: Record<string, unknown>) => { mockValues.setDmStoreOptions(options); return mockValues.dmStore; } }));
vi.mock('./hooks/useUnreadTracker', () => ({ resetMarkersCache: vi.fn(), useUnreadTracker: () => mockValues.unreadTracker }));
vi.mock('./hooks/useBrmbleIdle', () => ({ useBrmbleIdle: () => 0 }));
vi.mock('./hooks/useIdleStatus', () => ({ useIdleStatus: () => ({ voiceIdle: {}, systemIdle: 0, isLocked: false }) }));
vi.mock('./hooks/useIdleActions', () => ({ AFK_THRESHOLD_SEC: 600, useIdleActions: () => mockValues.idleActions }));
vi.mock('./hooks/useServerHealth', () => ({ useServerHealth: () => undefined }));
vi.mock('./hooks/useCompanionOverlayPublisher', () => ({ useCompanionOverlayPublisher: () => undefined }));
vi.mock('./hooks/useLeaveVoiceCooldown', () => ({ useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }) }));
vi.mock('./hooks/useNotificationQueue', () => ({ useNotificationQueue: () => mockValues.notificationQueue }));
vi.mock('./hooks/useScreenShare', () => ({ useScreenShare: () => mockValues.screenShare }));

function renderConnectedApp() {
  render(<ServiceStatusProvider><App /></ServiceStatusProvider>);
  act(() => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('server.credentials', {
      matrix: { homeserverUrl: 'https://example.com', accessToken: 'token', userId: '@me:example.com', roomMap: {} },
    });
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { username: 'Me', channelId: 0, users: [] });
  });
}

describe('DM route Matrix isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (bridge as unknown as { __reset: () => void }).__reset();
    mockValues.setDmChatPanelProps(undefined);
    mockValues.setHeaderProps(undefined);
    mockValues.setDmStoreOptions(undefined);
    mockValues.matrixClient.dmRoomMap.clear();
    mockValues.dmStore.selectedContact = null;
  });

  it('omits Matrix state from an online Mumble DM route', () => {
    mockValues.dmStore.selectedContact = { id: 'cert-val', displayName: 'Vanilla Val', unreadCount: 0, isEphemeral: true, mumbleSessionId: 42 };
    renderConnectedApp();

    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith(null);
    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-cert-val', channelName: 'Vanilla Val', matrixClient: null, matrixRoomId: null, readMarkerTs: null,
      disabled: false, topNotice: 'This is a Mumble direct message. Chat history will be lost when you disconnect.',
      typingIndicatorText: undefined, typingTargetId: undefined, onTypingStart: undefined, onTypingStop: undefined,
      onToggleReaction: undefined, currentUserMatrixId: undefined,
    }));
  });

  it('keeps an offline Mumble DM route separate from Matrix state', () => {
    mockValues.dmStore.selectedContact = { id: 'cert-val', displayName: 'Vanilla Val', unreadCount: 0, isEphemeral: true, mumbleSessionId: null };
    renderConnectedApp();

    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-cert-val', matrixClient: null, matrixRoomId: null, disabled: true, typingTargetId: undefined,
    }));
  });

  it('preserves Matrix props for a Matrix DM route', () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    renderConnectedApp();

    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith('@val:example.com');
    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-@val:example.com', channelName: 'Vanilla Val', matrixClient: mockValues.matrixClient.client,
      matrixRoomId: '!val:example.com', topNotice: undefined, typingTargetId: '@val:example.com',
      onTypingStart: mockValues.matrixClient.startTyping, onTypingStop: mockValues.matrixClient.stopTyping,
      onToggleReaction: expect.any(Function), currentUserMatrixId: '@me:example.com',
    }));
  });

  it('reports an unread foreground only when the workspace and selected contact match', () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };

    renderConnectedApp();

    expect((mockValues.dmStoreOptions?.isSelectedConversationForeground as () => boolean)()).toBe(false);
  });

  it('uses the Messages panel state for the Header DM control', () => {
    renderConnectedApp();

    expect(mockValues.headerProps?.dmActive).toBe(true);

    act(() => {
      (mockValues.headerProps?.onToggleDM as () => void)();
    });

    expect(mockValues.headerProps?.dmActive).toBe(false);
  });

  it('resets the Messages panel when reconnecting', async () => {
    renderConnectedApp();
    act(() => {
      (mockValues.headerProps?.onToggleDM as () => void)();
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    });

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(false));

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { username: 'Me', channelId: 0, users: [] });
    });

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(true));
  });
});
