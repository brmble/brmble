import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { ServiceStatusProvider } from './hooks/useServiceStatus';
import type { ChatMessage } from './types';

const mockValues = vi.hoisted(() => {
  let dmChatPanelProps: Record<string, unknown> | undefined;
  let channelChatPanelProps: Record<string, unknown> | undefined;
  let dmContactListProps: Record<string, unknown> | undefined;
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
    client: { marker: 'matrix-client', getRoom: vi.fn((): unknown => undefined) },
    activeTypingText: 'Val is typing',
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
  };
  const dmStore = {
    contacts: [],
    selectedContact: null as { id: string; displayName: string; unreadCount: number; isEphemeral?: boolean; mumbleSessionId?: number | null } | null,
    messages: [] as ChatMessage[],
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
    getMarkerTimestamp: vi.fn((): number | null => null),
    totalUnreadCount: 0,
    totalDmUnreadCount: 0,
  };
  const idleActions = { autoLeftAt: null, preLeaveStartedAt: null, preLeaveCancelledAt: null, dismissNotification: vi.fn(), dismissPreLeaveCancelled: vi.fn() };
  const screenShare = {
    isSharing: false, startSharing: vi.fn(), stopSharing: vi.fn(), markLocalShareTeardownIntent: vi.fn(), error: null,
    activeShare: null, activeShares: [], watchingShare: null, watchingShares: [] as Array<{ roomName: string; userId: number; userName: string }>, pendingViewerShares: [], remoteWatchCount: 0, isViewerConnectPending: false,
    focusedShare: null as { roomName: string; userId: number; userName: string } | null, setFocusedShare: vi.fn(), setDiscoveryTarget: vi.fn(), remoteVideoEl: null, remoteVideoEls: new Map<number, HTMLVideoElement>(),
    roomQuality: undefined as string | undefined, shareQualities: new Map<number, string>(), viewerQualities: new Map<number, string>(), addWatchingShare: vi.fn(), removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(), connectAsViewer: vi.fn(), setViewerQuality: vi.fn(), handleScreenShareServiceUnavailable: vi.fn(),
  };
  const notificationQueue = { register: vi.fn(), unregister: vi.fn(), isVisible: vi.fn(() => false), visibleCount: 0, totalCount: 0 };

  return {
    matrixClient, dmStore, unreadTracker, idleActions, screenShare, notificationQueue,
    get dmChatPanelProps() { return dmChatPanelProps; },
    setDmChatPanelProps: (props: Record<string, unknown> | undefined) => { dmChatPanelProps = props; },
    get channelChatPanelProps() { return channelChatPanelProps; },
    setChannelChatPanelProps: (props: Record<string, unknown> | undefined) => { channelChatPanelProps = props; },
    get dmContactListProps() { return dmContactListProps; },
    setDmContactListProps: (props: Record<string, unknown> | undefined) => { dmContactListProps = props; },
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
vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: (props: Record<string, unknown>) => {
    return (
      <>
        <button type="button" data-testid="sidebar-select-channel" onClick={() => (props.onSelectChannel as ((channelId: number) => void) | undefined)?.(1)} />
        <button type="button" data-testid="sidebar-select-server" onClick={() => (props.onSelectServer as (() => void) | undefined)?.()} />
      </>
    );
  },
}));
vi.mock('./components/ChatPanel/ChatPanel', () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    if (props.isDM) mockValues.setDmChatPanelProps(props);
    else mockValues.setChannelChatPanelProps(props);
    return <section />;
  },
}));
vi.mock('./components/ServerList/ServerList', () => ({ ServerList: () => <section /> }));
vi.mock('./components/ConnectionState/ConnectionState', () => ({ ConnectionState: () => <section /> }));
vi.mock('./components/DMContactList/DMContactList', () => ({
  DMContactList: (props: Record<string, unknown>) => {
    mockValues.setDmContactListProps(props);
    return null;
  },
}));
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
  const view = render(<ServiceStatusProvider><App /></ServiceStatusProvider>);
  act(() => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('server.credentials', {
      matrix: { homeserverUrl: 'https://example.com', accessToken: 'token', userId: '@me:example.com', roomMap: {} },
    });
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', {
      username: 'Me', channelId: 1, channels: [{ id: 1, name: 'General' }], users: [],
    });
  });
  return view;
}

describe('DM route Matrix isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (bridge as unknown as { __reset: () => void }).__reset();
    mockValues.setDmChatPanelProps(undefined);
    mockValues.setChannelChatPanelProps(undefined);
    mockValues.setDmContactListProps(undefined);
    mockValues.setHeaderProps(undefined);
    mockValues.setDmStoreOptions(undefined);
    mockValues.matrixClient.dmRoomMap.clear();
    mockValues.dmStore.selectedContact = null;
    mockValues.dmStore.messages = [];
    mockValues.screenShare.isSharing = false;
    mockValues.screenShare.remoteWatchCount = 0;
    mockValues.screenShare.pendingViewerShares = [];
    mockValues.screenShare.watchingShares = [];
    mockValues.screenShare.focusedShare = null;
    mockValues.screenShare.remoteVideoEls = new Map();
    mockValues.screenShare.roomQuality = undefined;
    mockValues.screenShare.shareQualities = new Map();
    mockValues.screenShare.viewerQualities = new Map();
    mockValues.unreadTracker.totalDmUnreadCount = 0;
    mockValues.unreadTracker.roomUnreads = new Map();
    mockValues.unreadTracker.getRoomUnread.mockReturnValue({ notificationCount: 0, highlightCount: 0, fullyReadEventId: null });
    mockValues.unreadTracker.getMarkerTimestamp.mockReturnValue(null);
    mockValues.matrixClient.client.getRoom.mockReturnValue(undefined);
  });

  it('omits Matrix state from an online Mumble DM route', () => {
    mockValues.dmStore.selectedContact = { id: 'cert-val', displayName: 'Vanilla Val', unreadCount: 0, isEphemeral: true, mumbleSessionId: 42 };
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('cert-val');
    });

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

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('cert-val');
    });

    expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
      channelId: 'dm-cert-val', matrixClient: null, matrixRoomId: null, disabled: true, typingTargetId: undefined,
    }));
  });

  it('preserves Matrix props for a Matrix DM route', () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

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

  it('does not expose stale selected DM messages when no DM is foreground', () => {
    mockValues.dmStore.selectedContact = null;
    mockValues.dmStore.messages = [{
      id: 'stale',
      channelId: 'dm-stale',
      sender: 'Val',
      content: 'stale',
      timestamp: new Date(),
    }];

    renderConnectedApp();

    expect(mockValues.dmChatPanelProps?.messages).toEqual([]);
  });

  it('uses the Messages panel state for the Header DM control', () => {
    renderConnectedApp();

    expect(mockValues.headerProps?.dmActive).toBe(true);

    act(() => {
      (mockValues.headerProps?.onToggleDM as () => void)();
    });

    expect(mockValues.headerProps?.dmActive).toBe(false);
  });

  it('routes DMContactList visibility through the shared Messages panel toggle', () => {
    renderConnectedApp();

    expect(mockValues.dmContactListProps?.onToggleVisibility).toBe(mockValues.headerProps?.onToggleDM);

    act(() => {
      (mockValues.dmContactListProps?.onToggleVisibility as () => void)();
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

  it('returns to channel chat and clears Matrix DM routing after reconnecting with a retained selection', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith('@val:example.com');

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    });
    await waitFor(() => expect(document.querySelector('.content-slider')).not.toBeInTheDocument());

    act(() => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { username: 'Me', channelId: 0, users: [] });
    });

    await waitFor(() => expect(mockValues.matrixClient.setActiveDmContact).toHaveBeenLastCalledWith(null));
    expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active');
  });

  it('lands on channel chat after connecting', async () => {
    renderConnectedApp();

    expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active');
    await waitFor(() => expect(mockValues.matrixClient.setActiveChannel).toHaveBeenCalledWith(null));
  });

  it('keeps a selected DM foreground while remote watches start and end', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

    await waitFor(() => expect(document.querySelector('.content-slider')).toHaveClass('dm-active'));

    mockValues.screenShare.remoteWatchCount = 1;
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    await waitFor(() => {
      expect(mockValues.headerProps?.dmActive).toBe(false);
      expect(document.querySelector('.content-slider')).toHaveClass('dm-active');
    });

    mockValues.screenShare.remoteWatchCount = 0;
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    await waitFor(() => {
      expect(mockValues.headerProps?.dmActive).toBe(true);
      expect(document.querySelector('.content-slider')).toHaveClass('dm-active');
    });
  });

  it('supplies the remote viewer to the foreground DM panel without duplicating it in the inactive channel panel', async () => {
    const share = { roomName: 'channel-1', userId: 10, userName: 'Vanilla Val' };
    const remoteVideoEls = new Map([[10, document.createElement('video')]]);
    const shareQualities = new Map([[10, 'high']]);
    const viewerQualities = new Map([[10, 'low']]);
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.screenShare.watchingShares = [share];
    mockValues.screenShare.focusedShare = share;
    mockValues.screenShare.remoteVideoEls = remoteVideoEls;
    mockValues.screenShare.roomQuality = 'good';
    mockValues.screenShare.shareQualities = shareQualities;
    mockValues.screenShare.viewerQualities = viewerQualities;
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    await waitFor(() => {
      expect(mockValues.dmChatPanelProps).toEqual(expect.objectContaining({
        watchingShares: [share],
        focusedShare: share,
        remoteVideoEls,
        roomQuality: 'good',
        shareQualities,
        viewerQualities,
        onFocusShare: mockValues.screenShare.setFocusedShare,
        onCloseShare: expect.any(Function),
        onViewerQualityChange: mockValues.screenShare.setViewerQuality,
        screenShareViewerMode: 'in-app',
      }));
    });
    expect(mockValues.channelChatPanelProps).not.toHaveProperty('watchingShares');
  });

  it('marks inactive conversation slides inert as well as aria-hidden', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });

    await waitFor(() => {
      const [channelSlide, dmSlide] = Array.from(document.querySelectorAll('.content-slide'));
      expect(channelSlide).toHaveAttribute('aria-hidden', 'true');
      expect(channelSlide).toHaveAttribute('inert');
      expect(dmSlide).toHaveAttribute('aria-hidden', 'false');
      expect(dmSlide).not.toHaveAttribute('inert');
    });

    act(() => view.getByTestId('sidebar-select-channel').click());
    const [channelSlide, dmSlide] = Array.from(document.querySelectorAll('.content-slide'));
    expect(channelSlide).toHaveAttribute('aria-hidden', 'false');
    expect(channelSlide).not.toHaveAttribute('inert');
    expect(dmSlide).toHaveAttribute('aria-hidden', 'true');
    expect(dmSlide).toHaveAttribute('inert');
  });

  it('falls back to the channel foreground when a selected conversation closes during a remote watch', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    await waitFor(() => expect(document.querySelector('.content-slider')).toHaveClass('dm-active'));

    mockValues.screenShare.remoteWatchCount = 1;
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(false));

    act(() => {
      (mockValues.dmContactListProps?.onCloseConversation as (id: string) => void)('@val:example.com');
    });

    expect(mockValues.dmStore.closeDM).toHaveBeenCalledWith('@val:example.com');
    expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active');
  });

  it('updates the unread DM badge without leaving the foreground channel', async () => {
    const view = renderConnectedApp();

    act(() => view.getByTestId('sidebar-select-channel').click());
    await waitFor(() => expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active'));
    mockValues.unreadTracker.totalDmUnreadCount = 3;
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    await waitFor(() => expect(mockValues.headerProps?.unreadDMCount).toBe(3));
    expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active');
  });

  it('does not mark a selected Matrix DM as read when a channel is in the foreground', async () => {
    mockValues.dmStore.selectedContact = { id: '@val:example.com', displayName: 'Vanilla Val', unreadCount: 0 };
    mockValues.matrixClient.dmRoomMap.set('@val:example.com', '!val:example.com');
    mockValues.matrixClient.client.getRoom.mockReturnValue({
      getLiveTimeline: () => ({
        getEvents: () => [{ getId: () => '$latest-dm-event' }],
      }),
    });
    const view = renderConnectedApp();

    act(() => {
      (mockValues.dmContactListProps?.onSelectContact as (id: string) => void)('@val:example.com');
    });
    await waitFor(() => expect(document.querySelector('.content-slider')).toHaveClass('dm-active'));
    mockValues.unreadTracker.markRoomRead.mockClear();

    act(() => view.getByTestId('sidebar-select-channel').click());
    await waitFor(() => expect(document.querySelector('.content-slider')).not.toHaveClass('dm-active'));

    mockValues.unreadTracker.roomUnreads = new Map([['!val:example.com', { notificationCount: 1 }]]);
    mockValues.unreadTracker.getRoomUnread.mockReturnValue({ notificationCount: 1, highlightCount: 0, fullyReadEventId: null });
    mockValues.unreadTracker.getMarkerTimestamp.mockReturnValue(1234);
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(true));
    expect(mockValues.unreadTracker.markRoomRead).not.toHaveBeenCalledWith('!val:example.com', '$latest-dm-event');
  });

  it('keeps active remote watches connected when selecting channel chat or server chat', async () => {
    const view = renderConnectedApp();
    mockValues.screenShare.remoteWatchCount = 1;
    view.rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    await waitFor(() => expect(mockValues.headerProps?.dmActive).toBe(false));
    mockValues.screenShare.disconnectViewer.mockClear();

    act(() => view.getByTestId('sidebar-select-channel').click());
    act(() => view.getByTestId('sidebar-select-server').click());

    expect(mockValues.screenShare.disconnectViewer).not.toHaveBeenCalled();
  });

  it.each([
    ['server list', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('cert.status', { exists: true });
    }],
    ['onboarding', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('cert.status', { exists: false });
    }],
    ['disconnected', () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', {
        username: 'Me', channelId: 1, channels: [{ id: 1, name: 'General' }], users: [],
      });
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected', { reconnectAvailable: true });
    }],
  ])('does not reserve Messages panel space on the %s screen', async (_label, enterScreen) => {
    render(<ServiceStatusProvider><App /></ServiceStatusProvider>);

    act(() => enterScreen());

    await waitFor(() => {
      expect(document.querySelector('.workspace-conversation')).not.toHaveClass('workspace-conversation--with-panel');
    });
    expect(mockValues.dmContactListProps).toBeUndefined();
  });
});
