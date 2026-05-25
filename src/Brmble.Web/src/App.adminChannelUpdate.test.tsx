import { render, screen, act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { ServiceStatusProvider } from './hooks/useServiceStatus';

const mockValues = vi.hoisted(() => {
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
    dmRoomMap: new Map(),
    dmUserDisplayNames: new Map(),
    dmUserAvatarUrls: new Map(),
    sendDMMessage: vi.fn(),
    fetchDMHistory: vi.fn(),
    fetchAvatarUrl: vi.fn(),
    client: null,
    activeTypingText: null,
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
  };

  const dmStore = {
    contacts: [],
    selectedContact: null,
    messages: [],
    appMode: 'channels' as const,
    selectContact: vi.fn(),
    sendMessage: vi.fn(),
    startDM: vi.fn(),
    clearSelection: vi.fn(),
    toggleMode: vi.fn(),
    closeDM: vi.fn(),
    appModeRef: { current: 'channels' as const },
    selectedContactIdRef: { current: null },
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

  const idleActions = {
    autoLeftAt: null,
    preLeaveStartedAt: null,
    preLeaveCancelledAt: null,
    dismissNotification: vi.fn(),
    dismissPreLeaveCancelled: vi.fn(),
  };

  const screenShare = {
    isSharing: false,
    startSharing: vi.fn(),
    stopSharing: vi.fn(),
    markLocalShareTeardownIntent: vi.fn(),
    error: null,
    activeShare: null,
    activeShares: [],
    watchingShare: null,
    watchingShares: [],
    isViewerConnectPending: false,
    focusedShare: null,
    setFocusedShare: vi.fn(),
    setDiscoveryTarget: vi.fn(),
    remoteVideoEl: null,
    remoteVideoEls: new Map(),
    roomQuality: undefined,
    shareQualities: new Map(),
    addWatchingShare: vi.fn(),
    removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(),
    connectAsViewer: vi.fn(),
    handleScreenShareServiceUnavailable: vi.fn(),
  };

  const notificationQueueIds = new Set<string>();
  const notificationQueue = {
    register: vi.fn((id: string) => {
      notificationQueueIds.add(id);
    }),
    unregister: vi.fn((id: string) => {
      notificationQueueIds.delete(id);
    }),
    isVisible: vi.fn((id: string) => notificationQueueIds.has(id)),
    visibleCount: 0,
    totalCount: 0,
  };

  return { matrixClient, dmStore, unreadTracker, idleActions, screenShare, notificationQueue, notificationQueueIds };
});

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    default: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      __emit: (event: string, data?: unknown) => {
        handlers.get(event)?.forEach(handler => handler(data));
      },
      __reset: () => handlers.clear(),
    },
  };
});

vi.mock('./components/Header/Header', () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock('./components/ChatPanel/ChatPanel', () => ({
  ChatPanel: () => <section data-testid="chat-panel" />,
}));

vi.mock('./components/ServerList/ServerList', () => ({
  ServerList: () => <section data-testid="server-list" />,
}));

vi.mock('./components/ConnectionState/ConnectionState', () => ({
  ConnectionState: () => <section data-testid="connection-state" />,
}));

vi.mock('./components/DMContactList/DMContactList', () => ({
  DMContactList: () => null,
}));

vi.mock('./components/NeonD/NeonDGame', () => ({
  NeonDGame: () => null,
}));

vi.mock('./components/SettingsModal/SettingsModal', () => ({
  DEFAULT_SCREEN_SHARE: {
    captureAudio: false,
    resolution: '1080p',
    fps: 30,
    systemAudio: false,
    viewerMode: 'in-app',
  },
  SettingsModal: () => null,
}));

vi.mock('./hooks/useMatrixClient', () => ({
  useMatrixClient: () => mockValues.matrixClient,
}));

vi.mock('./hooks/useChatStore', () => ({
  useChatStore: () => ({ messages: [], addMessage: vi.fn() }),
  addMessageToStore: vi.fn(),
  clearChatStorage: vi.fn(),
  purgeEphemeralMessages: vi.fn(),
}));

vi.mock('./hooks/useDMStore', () => ({
  useDMStore: () => mockValues.dmStore,
}));

vi.mock('./hooks/useUnreadTracker', () => ({
  resetMarkersCache: vi.fn(),
  useUnreadTracker: () => mockValues.unreadTracker,
}));

vi.mock('./hooks/useBrmbleIdle', () => ({
  useBrmbleIdle: () => 0,
}));

vi.mock('./hooks/useIdleStatus', () => ({
  useIdleStatus: () => ({ voiceIdle: {}, systemIdle: 0, isLocked: false }),
}));

vi.mock('./hooks/useIdleActions', () => ({
  AFK_THRESHOLD_SEC: 600,
  useIdleActions: () => mockValues.idleActions,
}));

vi.mock('./hooks/useServerHealth', () => ({
  useServerHealth: () => undefined,
}));

vi.mock('./hooks/useCompanionOverlayPublisher', () => ({
  useCompanionOverlayPublisher: () => undefined,
}));

vi.mock('./hooks/useLeaveVoiceCooldown', () => ({
  useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }),
}));

vi.mock('./hooks/useNotificationQueue', () => ({
  useNotificationQueue: () => mockValues.notificationQueue,
}));

vi.mock('./hooks/useScreenShare', () => ({
  useScreenShare: () => mockValues.screenShare,
}));

function renderApp() {
  render(
    <ServiceStatusProvider>
      <App />
    </ServiceStatusProvider>,
  );
}

async function emitAdminChannelUpdateError() {
  await act(async () => {
    (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('admin.channelUpdateError', { channelId: 7, statusCode: 403 });
  });
}

describe('admin channel update notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.notificationQueueIds.clear();
    localStorage.clear();
    (bridge as unknown as { __reset: () => void }).__reset();
  });

  it('shows a warning notification when admin channel updates fail', async () => {
    renderApp();

    await emitAdminChannelUpdateError();

    expect(mockValues.notificationQueue.register).toHaveBeenCalledWith('admin-channel-update-error', 'warning');
    expect(await screen.findByText('Channel position was not saved')).toBeInTheDocument();
    expect(screen.getByText('You need Write permission on that channel. Check the channel ACL if inheritance is disabled.')).toBeInTheDocument();
  });

  it('unregisters the queue entry when dismissed', async () => {
    renderApp();
    await emitAdminChannelUpdateError();

    fireEvent.click(await screen.findByLabelText('Dismiss notification'));

    expect(mockValues.notificationQueue.unregister).toHaveBeenCalledWith('admin-channel-update-error');
  });

  it('keeps the warning visible for repeated failures', async () => {
    vi.useFakeTimers();
    try {
      renderApp();
      await emitAdminChannelUpdateError();

      expect(screen.getByText('Channel position was not saved')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(4900);
      });
      await emitAdminChannelUpdateError();
      await act(async () => {
        vi.advanceTimersByTime(5200);
      });

      expect(screen.getByText('Channel position was not saved')).toBeInTheDocument();
      expect(mockValues.notificationQueue.register).toHaveBeenCalledWith('admin-channel-update-error', 'warning');
    } finally {
      vi.useRealTimers();
    }
  });
});
