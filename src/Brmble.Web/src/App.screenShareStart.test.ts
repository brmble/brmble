import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceStatusMap } from './types';

type BridgeHandler = (data: unknown) => void;

const {
  bridgeHandlers,
  bridge,
  disconnectViewer,
  setDiscoveryTarget,
  stopSharing,
  handleScreenShareServiceUnavailable,
  markLocalShareTeardownIntent,
  connectAsViewer,
  serviceStatus,
  screenShareState,
  clearChatStorage,
  notifQueue,
  idleActionsState,
  getIdleActionsArgs,
  clearIdleActionsArgs,
  captureIdleActionsArgs,
  getLocalShareEndedHandler,
  clearLocalShareEndedHandler,
  captureLocalShareEndedHandler,
} = vi.hoisted(() => {
  const handlers = new Map<string, Set<BridgeHandler>>();
  const disconnect = vi.fn();
  const setTarget = vi.fn();
  const stop = vi.fn();
  const serviceUnavailable = vi.fn();
  const markIntent = vi.fn();
  const connectViewer = vi.fn();
  const status = {
    statuses: {
      voice: { state: 'connected' as const },
      chat: { state: 'connected' as const },
      server: { state: 'connected' as const },
      livekit: { state: 'idle' as const, error: undefined },
    } as ServiceStatusMap,
    effectiveStatuses: {
      voice: { state: 'connected' as const },
      chat: { state: 'connected' as const },
      server: { state: 'connected' as const },
      livekit: { state: 'connected' as const, error: undefined },
    } as ServiceStatusMap,
    updateStatus: vi.fn(),
    resetStatuses: vi.fn(),
  };
  const clearChatStorageMock = vi.fn();
  const screenShare = {
    isSharing: false,
    error: null as string | null,
    isViewerConnectPending: false,
    startSharing: vi.fn().mockResolvedValue(true),
    activeShares: [] as Array<{
      roomName: string;
      userName: string;
      userId: number;
      matrixUserId?: string;
      sessionId?: number;
    }>,
  };
  const idleActions = {
    autoLeftAt: null as number | null,
    preLeaveStartedAt: null as number | null,
    preLeaveCancelledAt: null as number | null,
    dismissNotification: vi.fn(),
    dismissPreLeaveCancelled: vi.fn(),
  };
  let idleActionsArgs: { onBeforeAutoLeave?: () => void | Promise<void> } | null = null;
  let localShareEndedHandler: ((reason: 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel') => void) | null = null;
  const mockBridge = {
    send: vi.fn(),
    on: vi.fn((type: string, handler: BridgeHandler) => {
      const eventHandlers = handlers.get(type) ?? new Set<BridgeHandler>();
      eventHandlers.add(handler);
      handlers.set(type, eventHandlers);
    }),
    off: vi.fn((type: string, handler: BridgeHandler) => {
      handlers.get(type)?.delete(handler);
    }),
    once: vi.fn((type: string, handler: BridgeHandler) => {
      const wrapped: BridgeHandler = (data) => {
        mockBridge.off(type, wrapped);
        handler(data);
      };
      mockBridge.on(type, wrapped);
    }),
    emit(type: string, data?: unknown) {
      for (const handler of handlers.get(type) ?? []) {
        handler(data);
      }
    },
  };

  return {
    bridgeHandlers: handlers,
    bridge: mockBridge,
    disconnectViewer: disconnect,
    setDiscoveryTarget: setTarget,
    stopSharing: stop,
    handleScreenShareServiceUnavailable: serviceUnavailable,
    markLocalShareTeardownIntent: markIntent,
    connectAsViewer: connectViewer,
    serviceStatus: status,
    screenShareState: screenShare,
    clearChatStorage: clearChatStorageMock,
    idleActionsState: idleActions,
    getIdleActionsArgs: () => idleActionsArgs,
    clearIdleActionsArgs: () => {
      idleActionsArgs = null;
    },
    captureIdleActionsArgs: (args: { onBeforeAutoLeave?: () => void | Promise<void> }) => {
      idleActionsArgs = args;
    },
    getLocalShareEndedHandler: () => localShareEndedHandler,
    clearLocalShareEndedHandler: () => {
      localShareEndedHandler = null;
    },
    captureLocalShareEndedHandler: (handler?: (reason: 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel') => void) => {
      localShareEndedHandler = handler ?? null;
    },
    notifQueue: {
      register: vi.fn(),
      unregister: vi.fn(),
      isVisible: vi.fn((_id: string) => false),
    },
  };
});

vi.mock('./bridge', () => ({ default: bridge }));

vi.mock('./hooks/useMatrixClient', () => ({
  useMatrixClient: () => ({
    client: null,
    messages: new Map(),
    fetchAvatarUrl: vi.fn().mockResolvedValue(undefined),
    dmRoomMap: new Map(),
    dmMessages: [],
    dmUserDisplayNames: new Map(),
    dmUserAvatarUrls: new Map(),
    sendDMMessage: vi.fn(),
    fetchDMHistory: vi.fn(),
    setActiveChannel: vi.fn(),
    setActiveDmContact: vi.fn(),
  }),
}));

vi.mock('./hooks/useScreenShare', () => ({
  useScreenShare: (_onDisconnected?: () => void, _settings?: unknown, onLocalShareEnded?: (reason: 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel') => void) => {
    captureLocalShareEndedHandler(onLocalShareEnded);
    return {
    isSharing: screenShareState.isSharing,
    startSharing: screenShareState.startSharing,
    stopSharing,
    handleScreenShareServiceUnavailable,
    markLocalShareTeardownIntent,
    error: screenShareState.error,
    activeShare: null,
    activeShares: screenShareState.activeShares,
    watchingShares: [],
    focusedShare: null,
    setFocusedShare: vi.fn(),
    setDiscoveryTarget,
    remoteVideoEls: new Map(),
    disconnectViewer,
    connectAsViewer,
    isViewerConnectPending: screenShareState.isViewerConnectPending,
    };
  },
}));

vi.mock('./hooks/useLeaveVoiceCooldown', () => ({
  useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }),
}));

vi.mock('./hooks/useIdleActions', () => ({
  useIdleActions: (args: { onBeforeAutoLeave?: () => void | Promise<void> }) => {
    captureIdleActionsArgs(args);
    return idleActionsState;
  },
}));

vi.mock('./hooks/useNotificationQueue', () => ({
  useNotificationQueue: () => notifQueue,
}));

vi.mock('./hooks/useUnreadTracker', () => ({
  useUnreadTracker: () => ({
    totalDmUnreadCount: 0,
    getRoomUnread: vi.fn(() => ({ notificationCount: 0, highlightCount: 0 })),
    getMarkerTimestamp: vi.fn(() => null),
    markRoomRead: vi.fn(),
    roomUnreads: new Map(),
  }),
  resetMarkersCache: vi.fn(),
}));

vi.mock('./hooks/useServiceStatus', () => ({
  useServiceStatus: () => ({
    statuses: serviceStatus.statuses,
    effectiveStatuses: serviceStatus.effectiveStatuses,
    updateStatus: serviceStatus.updateStatus,
    resetStatuses: serviceStatus.resetStatuses,
  }),
}));

vi.mock('./hooks/useServerHealth', () => ({ useServerHealth: vi.fn() }));

vi.mock('./hooks/useChatStore', () => ({
  useChatStore: () => ({ messages: [], addMessage: vi.fn() }),
  addMessageToStore: vi.fn(),
  clearChatStorage,
  purgeEphemeralMessages: vi.fn(),
}));

vi.mock('./hooks/useDMStore', () => ({
  useDMStore: () => ({
    contacts: [],
    selectedContact: null,
    messages: [],
    appMode: 'channels',
    appModeRef: { current: 'channels' },
    clearSelection: vi.fn(),
    toggleMode: vi.fn(),
    receiveMumbleDM: vi.fn(),
    updateMumbleSession: vi.fn(),
    sendMessage: vi.fn(),
    selectContact: vi.fn(),
    closeDM: vi.fn(),
  }),
}));

vi.mock('./hooks/usePrompt', () => ({
  usePrompt: () => ({
    Prompt: () => null,
    PromptWithInput: () => null,
  }),
  confirm: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('./contexts/ProfileContext', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('./components/Header/Header', () => ({
  Header: ({ onLeaveVoice, onToggleScreenShare }: {
    onLeaveVoice?: () => void;
    onToggleScreenShare?: () => void;
  }) => React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      'data-testid': 'header-leave-voice',
      onClick: onLeaveVoice,
    }),
    React.createElement('button', {
      type: 'button',
      'data-testid': 'header-toggle-screen-share',
      onClick: onToggleScreenShare,
    }),
  ),
}));
vi.mock('./components/Header/UserPanel/UserPanel', () => ({
  UserPanel: ({ onLeaveVoice }: { onLeaveVoice?: () => void }) => React.createElement('button', {
    type: 'button',
    'data-testid': 'user-panel-leave-voice',
    onClick: onLeaveVoice,
  }),
}));
vi.mock('./components/Header/BrmbleLogo', () => ({ BrmbleLogo: () => null }));
vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: ({ onDisconnect, onWatchScreenShare, onJoinChannel }: {
    onDisconnect?: () => void;
    onWatchScreenShare?: (roomName: string, userId?: number, matrixUserId?: string) => void;
    onJoinChannel?: (channelId: number) => void;
  }) => React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      'data-testid': 'sidebar-disconnect',
      onClick: onDisconnect,
    }),
    React.createElement('button', {
      type: 'button',
      'data-testid': 'sidebar-watch-share',
      onClick: () => onWatchScreenShare?.('channel-0', 42, '@alice:example.com'),
    }),
    React.createElement('button', {
      type: 'button',
      'data-testid': 'sidebar-join-channel-2',
      onClick: () => onJoinChannel?.(2),
    }),
  ),
}));
vi.mock('./components/ChatPanel/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('./components/ConnectModal/ConnectModal', () => ({ ConnectModal: () => null }));
vi.mock('./components/ServerList/ServerList', () => ({ ServerList: () => null }));
vi.mock('./components/ConnectionState/ConnectionState', () => ({
  ConnectionState: ({ onBackToServerList }: { onBackToServerList?: () => void }) => React.createElement('button', {
    type: 'button',
    'data-testid': 'back-to-server-list',
    onClick: onBackToServerList,
  }),
}));
vi.mock('./components/SettingsModal/SettingsModal', () => ({
  SettingsModal: () => null,
  DEFAULT_SCREEN_SHARE: {},
}));
vi.mock('./components/AvatarEditorModal/AvatarEditorModal', () => ({ AvatarEditorModal: () => null }));
vi.mock('./components/CloseDialog/CloseDialog', () => ({ CloseDialog: () => null }));
vi.mock('./components/OnboardingWizard/OnboardingWizard', () => ({ OnboardingWizard: () => null }));
vi.mock('./components/Version/Version', () => ({ Version: () => null }));
vi.mock('./components/ZoomIndicator/ZoomIndicator', () => ({ ZoomIndicator: () => null }));
vi.mock('./components/DMContactList/DMContactList', () => ({ DMContactList: () => null }));
vi.mock('./components/NeonD/NeonDGame', () => ({ NeonDGame: () => null }));
vi.mock('./components/Brmblegotchi/Brmblegotchi', () => ({ Brmblegotchi: () => null }));
vi.mock('./components/UpdateNotification/UpdateNotification', () => ({ UpdateNotification: () => null }));
vi.mock('./components/BrokenCertNotification/BrokenCertNotification', () => ({ BrokenCertNotification: () => null }));
vi.mock('./components/Notification/Notification', () => ({
  Notification: ({ title, detail, duration, actions, onDismiss }: {
    title?: string;
    detail?: string;
    duration?: number;
    actions?: React.ReactNode;
    onDismiss?: () => void;
  }) => React.createElement('div', { 'data-duration': duration },
    title ? React.createElement('div', null, title) : null,
    detail ? React.createElement('div', null, detail) : null,
    actions,
    onDismiss ? React.createElement('button', { type: 'button', onClick: onDismiss }, 'Dismiss') : null,
  ),
}));

import App, { canWatchShareFromChannel, getNextLiveKitStatusUpdate, shouldClearLocalShareStartPending, shouldPublishServerJoinOverlayEvent, toggleLocalScreenShare } from './App';

const CHANNEL_PASSWORD_DENIAL_MESSAGE = 'Permission denied: missing channel password token';

describe('toggleLocalScreenShare', () => {
  it('starts sharing in the current voice channel without changing LiveKit status first', async () => {
    const startSharing = vi.fn().mockResolvedValue(true);
    const stopSharing = vi.fn();
    const setSharingChannelId = vi.fn();
    const onSharingChannelIdChanged = vi.fn();

    await toggleLocalScreenShare({
      isSharing: false,
      selfLeftVoice: false,
      voiceChannelId: 7,
      startSharing,
      stopSharing,
      setSharingChannelId,
      onSharingChannelIdChanged,
    });

    expect(startSharing).toHaveBeenCalledWith('channel-7');
    expect(setSharingChannelId).toHaveBeenCalledWith('7');
    expect(onSharingChannelIdChanged).toHaveBeenCalledWith('7');
    expect(stopSharing).not.toHaveBeenCalled();
  });

  it('does not set sharing channel when startSharing returns false after cancellation', async () => {
    const startSharing = vi.fn().mockResolvedValue(false);
    const stopSharing = vi.fn();
    const setSharingChannelId = vi.fn();
    const onSharingChannelIdChanged = vi.fn();

    await toggleLocalScreenShare({
      isSharing: false,
      selfLeftVoice: false,
      voiceChannelId: 7,
      startSharing,
      stopSharing,
      setSharingChannelId,
      onSharingChannelIdChanged,
    });

    expect(startSharing).toHaveBeenCalledWith('channel-7');
    expect(setSharingChannelId).not.toHaveBeenCalled();
    expect(onSharingChannelIdChanged).not.toHaveBeenCalled();
  });

  it('ignores local share start while LiveKit is already connecting', async () => {
    const startSharing = vi.fn().mockResolvedValue(undefined);
    const stopSharing = vi.fn();
    const setSharingChannelId = vi.fn();

    await toggleLocalScreenShare({
      isSharing: false,
      selfLeftVoice: false,
      voiceChannelId: 7,
      liveKitState: 'connecting',
      startSharing,
      stopSharing,
      setSharingChannelId,
    });

    expect(startSharing).not.toHaveBeenCalled();
    expect(stopSharing).not.toHaveBeenCalled();
    expect(setSharingChannelId).not.toHaveBeenCalled();
  });
});

describe('getNextLiveKitStatusUpdate', () => {
  it('preserves the previous LiveKit status while the share picker is unresolved after clearing an error', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 0,
      screenShareError: null,
      isLocalShareStartPending: true,
      isViewerConnectPending: false,
    })).toBeNull();
  });

  it('preserves connecting while viewer connect pending after clearing an error', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 0,
      screenShareError: null,
      isLocalShareStartPending: false,
      isViewerConnectPending: true,
    })).toBeNull();
  });

  it('keeps LiveKit connected while watching a share even if local share start is still pending', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 1,
      screenShareError: null,
      isLocalShareStartPending: true,
      isViewerConnectPending: false,
    })).toEqual({ state: 'connected', error: undefined });
  });

  it('returns idle when not sharing and no watched shares remain', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 0,
      screenShareError: null,
      isLocalShareStartPending: false,
      isViewerConnectPending: false,
    })).toBeNull();
  });
});

describe('shouldPublishServerJoinOverlayEvent', () => {
  it('suppresses server join overlay events during the initial post-connect grace window', () => {
    expect(shouldPublishServerJoinOverlayEvent({
      systemType: 'userJoined',
      actorName: 'Alice',
      selfName: 'TestUser',
      connectedAtMs: 1_000,
      nowMs: 3_500,
    })).toBe(false);
  });

  it('allows server join overlay events after the initial post-connect grace window', () => {
    expect(shouldPublishServerJoinOverlayEvent({
      systemType: 'userJoined',
      actorName: 'Alice',
      selfName: 'TestUser',
      connectedAtMs: 1_000,
      nowMs: 4_000,
    })).toBe(true);
  });

  it('suppresses self join overlay events', () => {
    expect(shouldPublishServerJoinOverlayEvent({
      systemType: 'userJoined',
      actorName: 'TestUser',
      selfName: 'TestUser',
      connectedAtMs: 1_000,
      nowMs: 10_000,
    })).toBe(false);
  });
});

describe('shouldClearLocalShareStartPending', () => {
  it('clears a pending local share start when the app leaves voice before the picker resolves', () => {
    expect(shouldClearLocalShareStartPending({
      isLocalShareStartPending: true,
      selfLeftVoice: true,
      voiceChannelId: 7,
    })).toBe(true);
  });
});

describe('canWatchShareFromChannel', () => {
  it('blocks watch attempts when current channel does not match share room', () => {
    expect(canWatchShareFromChannel('server-root', 'channel-1')).toBe(false);
    expect(canWatchShareFromChannel('2', 'channel-1')).toBe(false);
    expect(canWatchShareFromChannel('1', 'channel-1')).toBe(true);
  });
});

describe('active share discovery', () => {
  const getActiveShareRequests = () => vi.mocked(bridge.send).mock.calls.filter(
    ([type]) => type === 'livekit.checkActiveShare',
  );

  const getShareEndedQueueRegistrations = () => vi.mocked(notifQueue.register).mock.calls.filter(
    ([id]) => String(id).startsWith('screen-share-ended-'),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    bridgeHandlers.clear();
    localStorage.clear();
    screenShareState.isSharing = false;
    screenShareState.error = null;
    screenShareState.isViewerConnectPending = false;
    screenShareState.startSharing.mockResolvedValue(true);
    screenShareState.activeShares = [];
    serviceStatus.statuses.server = { state: 'connected' };
    serviceStatus.statuses.livekit = { state: 'idle', error: undefined };
    serviceStatus.effectiveStatuses.server = { state: 'connected' };
    serviceStatus.effectiveStatuses.livekit = { state: 'connected', error: undefined };
    handleScreenShareServiceUnavailable.mockClear();
    idleActionsState.autoLeftAt = null;
    idleActionsState.preLeaveStartedAt = null;
    idleActionsState.preLeaveCancelledAt = null;
    clearIdleActionsArgs();
    clearLocalShareEndedHandler();
    vi.mocked(notifQueue.isVisible).mockReturnValue(false);
  });

  it('renders a pre-idle warning notification when idle pre-leave starts', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'idle-pre-leave');
    idleActionsState.preLeaveStartedAt = 1000;

    render(React.createElement(App));

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('idle-pre-leave', 'info');
    });
    expect(screen.getByText('Still there?')).toBeInTheDocument();
    expect(screen.getByText("You'll leave voice soon due to inactivity.")).toBeInTheDocument();
    expect(screen.getByText('Still there?').parentElement).toHaveAttribute('data-duration', '60000');
  });

  it('does not register idle pre-leave notification when idle reminders are disabled', () => {
    const { rerender } = render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: false,
            notificationMovedChannel: true,
          },
        },
      });
    });

    idleActionsState.preLeaveStartedAt = 1234;
    rerender(React.createElement(App));

    expect(notifQueue.register).not.toHaveBeenCalledWith('idle-pre-leave', 'info');
  });

  it('unregisters idle pre-leave notification when idle pre-leave clears', async () => {
    idleActionsState.preLeaveStartedAt = 1234;
    const { rerender } = render(React.createElement(App));

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('idle-pre-leave', 'info');
    });

    vi.mocked(notifQueue.unregister).mockClear();
    idleActionsState.preLeaveStartedAt = null;
    rerender(React.createElement(App));

    expect(notifQueue.unregister).toHaveBeenCalledWith('idle-pre-leave');
  });

  it('does not clear chat storage when credentials refresh after reconnect failure without session reset', () => {
    render(React.createElement(App));

    const credentials = {
      matrix: {
        homeserverUrl: 'https://matrix.example.com',
        accessToken: 'tok_1',
        userId: '@me:example.com',
        roomMap: { '1': '!one:example.com' },
      },
    };

    act(() => {
      bridge.emit('server.credentials', credentials);
      bridge.emit('voice.reconnectFailed', { reason: 'network' });
      bridge.emit('server.credentials', { matrix: { ...credentials.matrix, accessToken: 'tok_2' } });
    });

    expect(clearChatStorage).toHaveBeenCalledTimes(1);
  });

  it('starts local sharing from an available screenshare service state', async () => {
    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
      bridge.emit('brmble.serviceStatus', { service: 'screenshare', state: 'connected' });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });

    expect(screenShareState.startSharing).toHaveBeenCalledWith('channel-1');
    expect(bridge.send).toHaveBeenCalledWith('livekit.debug.toggleScreenShare.notSharing.inVoice.channel-1.canStart', {});
    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('does not start local sharing while Brmble-dependent screenshare status is idle', async () => {
    serviceStatus.statuses.server = { state: 'connecting' };
    serviceStatus.statuses.livekit = { state: 'connected' };
    serviceStatus.effectiveStatuses.server = { state: 'connecting' };
    serviceStatus.effectiveStatuses.livekit = { state: 'idle' };
    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });

    expect(screenShareState.startSharing).not.toHaveBeenCalled();
    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('does not start local sharing while Screenshare is still connecting', async () => {
    serviceStatus.statuses.server = { state: 'connected' };
    serviceStatus.statuses.livekit = { state: 'idle' };
    serviceStatus.effectiveStatuses.server = { state: 'connected' };
    serviceStatus.effectiveStatuses.livekit = { state: 'connecting' };
    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });

    expect(screenShareState.startSharing).not.toHaveBeenCalled();
    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('rechecks active shares when screenshare service reconnects after an interruption', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' }));
    });

    vi.mocked(bridge.send).mockClear();

    act(() => {
      bridge.emit('brmble.serviceStatus', { service: 'screenshare', state: 'disconnected', reason: 'active-share-request-failed' });
      bridge.emit('brmble.serviceStatus', { service: 'screenshare', state: 'connected' });
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' }));
  });

  it('does not tear down LiveKit lifecycle when active share discovery fails', () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('brmble.serviceStatus', { service: 'screenshare', state: 'disconnected', reason: 'active-share-request-failed' });
    });

    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'connected', error: undefined });
    expect(handleScreenShareServiceUnavailable).not.toHaveBeenCalled();
  });

  it('replaces the pre-idle warning with a cancellation notification', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) =>
      id === 'idle-pre-leave' || id === 'idle-pre-leave-cancelled'
    );
    idleActionsState.preLeaveStartedAt = 1000;

    const { rerender } = render(React.createElement(App));

    await waitFor(() => {
      expect(screen.getByText('Still there?')).toBeInTheDocument();
    });

    idleActionsState.preLeaveStartedAt = null;
    idleActionsState.preLeaveCancelledAt = 2000;
    rerender(React.createElement(App));

    await waitFor(() => {
      expect(notifQueue.unregister).toHaveBeenCalledWith('idle-pre-leave');
      expect(notifQueue.register).toHaveBeenCalledWith('idle-pre-leave-cancelled', 'info');
    });
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Auto leave cancelled.')).toBeInTheDocument();
    expect(screen.getByText('Welcome back').parentElement).toHaveAttribute('data-duration', '5000');

    fireEvent.click(screen.getAllByText('Dismiss').at(-1)!);

    expect(notifQueue.unregister).toHaveBeenCalledWith('idle-pre-leave-cancelled');
    expect(idleActionsState.dismissPreLeaveCancelled).toHaveBeenCalled();
  });

  it('does not register idle cancellation notification when idle reminders are disabled', () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'idle-pre-leave-cancelled');

    const { rerender } = render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: false,
            notificationMovedChannel: true,
          },
        },
      });
    });

    vi.mocked(notifQueue.register).mockClear();
    vi.mocked(notifQueue.unregister).mockClear();
    idleActionsState.preLeaveCancelledAt = 2000;
    rerender(React.createElement(App));

    expect(notifQueue.register).not.toHaveBeenCalledWith('idle-pre-leave-cancelled', 'info');
    expect(notifQueue.unregister).toHaveBeenCalledWith('idle-pre-leave-cancelled');
    expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
  });

  it('requests active share discovery after connect for the current channel', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' }));
    });

    expect(getActiveShareRequests()).toHaveLength(1);
  });

  it('does not connect as viewer for root watch attempts', async () => {
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 0,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 0 },
          { session: 2, name: 'Alice', channelId: 0, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-watch-share').click();
      await Promise.resolve();
    });

    expect(connectAsViewer).not.toHaveBeenCalled();
    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('connects as viewer with the actual share room for same-channel watch attempts', async () => {
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-watch-share').click();
      await Promise.resolve();
    });

    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
    expect(connectAsViewer).toHaveBeenCalledWith('channel-1', 42, '@alice:example.com');
  });

  it('handles rejected viewer connect from the watch UI path', async () => {
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];
    vi.mocked(connectAsViewer).mockRejectedValueOnce(new Error('viewer failed'));

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-watch-share').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(connectAsViewer).toHaveBeenCalledWith('channel-1', 42, '@alice:example.com');
    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'disconnected', error: 'viewer failed' });
  });

  it('retry viewer connect pending preserves connecting status after clearing previous error', async () => {
    screenShareState.error = 'viewer failed';
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];

    const { rerender } = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      serviceStatus.updateStatus.mockClear();
      screenShareState.error = null;
      screenShareState.isViewerConnectPending = true;
      rerender(React.createElement(App));
      await Promise.resolve();
    });

    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'idle', error: undefined });
  });

  it('notification watch does not connect as viewer from root selected channel', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'screen-share');
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 0, name: 'Root' });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    await act(async () => {
      view.getByText('Watch').click();
      await Promise.resolve();
    });

    expect(connectAsViewer).not.toHaveBeenCalled();
    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('notification watch does not connect as viewer from the wrong selected channel', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'screen-share');
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 2, name: 'Gaming' });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    await act(async () => {
      view.getByText('Watch').click();
      await Promise.resolve();
    });

    expect(connectAsViewer).not.toHaveBeenCalled();
    expect(serviceStatus.updateStatus).not.toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
  });

  it('notification watch connects as viewer through the gate from the same selected channel', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'screen-share');
    screenShareState.activeShares = [
      {
        roomName: 'channel-2',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      },
      {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      },
    ];

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    await act(async () => {
      view.getByText('Watch').click();
      await Promise.resolve();
    });

    expect(serviceStatus.updateStatus).toHaveBeenCalledWith('livekit', { state: 'connecting', error: undefined });
    expect(connectAsViewer).toHaveBeenCalledWith('channel-1', 42, '@alice:example.com');
  });

  it('does not register remote screen share notification when screen share invitations are disabled', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: false,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: true,
          },
        },
      });
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    expect(notifQueue.register).not.toHaveBeenCalledWith('screen-share', 'info');
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();
  });

  it('clears visible optional screen share notification when global disable is enabled', () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'screen-share');

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    expect(screen.getByText('Alice started sharing their screen')).toBeInTheDocument();

    act(() => {
      bridge.emit('settings.updated', {
        settings: {
          messages: {
            notificationsDisabled: true,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: true,
          },
        },
      });
    });

    expect(notifQueue.unregister).toHaveBeenCalledWith('screen-share');
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();
  });

  it('rechecks active share discovery after reconnect when the current channel is unchanged', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' }));
    });

    act(() => {
      bridge.emit('voice.reconnecting');
    });

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(2);
    });

    expect(getActiveShareRequests()).toEqual([
      ['livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' })],
      ['livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' })],
    ]);
  });

  it('requests global active share discovery while in root channel', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 0,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 0 }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', expect.objectContaining({ scope: 'all' }));
    });
  });

  it('sends increasing requestIds for room and global active share discovery', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(1);
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 2, name: 'Gaming' });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(2);
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 0, name: 'Root' });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(3);
    });

    expect(getActiveShareRequests()).toEqual([
      ['livekit.checkActiveShare', { roomName: 'channel-1', requestId: 1 }],
      ['livekit.checkActiveShare', { roomName: 'channel-2', requestId: 2 }],
      ['livekit.checkActiveShare', { scope: 'all', requestId: 3 }],
    ]);

    expect(setDiscoveryTarget.mock.calls.map(([target]) => target).filter(Boolean)).toEqual([
      { roomName: 'channel-1', requestId: 1 },
      { roomName: 'channel-2', requestId: 2 },
      { scope: 'all', requestId: 3 },
    ]);
  });

  it('requests active share discovery exactly once when switching channels while already connected', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(1);
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 2, name: 'Gaming' });
    });

    await waitFor(() => {
      expect(getActiveShareRequests()).toHaveLength(2);
    });

    expect(getActiveShareRequests()).toEqual([
      ['livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-1' })],
      ['livekit.checkActiveShare', expect.objectContaining({ roomName: 'channel-2' })],
    ]);
  });

  it('unregisters previous moved-channel notification before registering a replacement', async () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
          { id: 3, name: 'Raid' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-0', 'info');
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 3,
        previousChannelId: 2,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(notifQueue.unregister).toHaveBeenCalledWith('channel-moved-0');
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-1', 'info');
    });
  });

  it('does not register moved channel notification when channel move notices are disabled', () => {
    render(React.createElement(App));

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: false,
          },
        },
      });
    });

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', { channelId: 2, name: 'Gaming', actorName: 'Moderator', reason: 'moved' });
    });

    expect(notifQueue.register).not.toHaveBeenCalledWith(expect.stringMatching(/^channel-moved-/), 'info');
  });

  it('hides a visible moved channel notification when channel move notices are disabled later', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Moved to Gaming')).toBeInTheDocument();
    });

    act(() => {
      bridge.emit('settings.current', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: false,
          },
        },
      });
    });

    expect(screen.queryByText('Moved to Gaming')).not.toBeInTheDocument();
  });

  it('clears visible moved channel notification when channel move notices are disabled later', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Moved to Gaming')).toBeInTheDocument();
    });

    act(() => {
      bridge.emit('settings.updated', {
        settings: {
          messages: {
            notificationsDisabled: false,
            notificationRemoteScreenShare: true,
            notificationScreenShareStatus: true,
            notificationIdleWarning: true,
            notificationMovedChannel: false,
          },
        },
      });
    });

    expect(notifQueue.unregister).toHaveBeenCalledWith('channel-moved-0');
    expect(screen.queryByText('Moved to Gaming')).not.toBeInTheDocument();
  });

  it('keeps showing moved notifications after many replacements', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
          { id: 3, name: 'Raid' },
          { id: 4, name: 'Ops' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    for (let i = 0; i < 25; i++) {
      const previousChannelId = (i % 4) + 1;
      const channelId = ((i + 1) % 4) + 1;
      act(() => {
        bridge.emit('voice.channelChanged', {
          channelId,
          previousChannelId,
          actorName: 'Moderator',
          reason: 'moved',
        });
      });
    }

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-24', 'info');
      expect(document.body.textContent).toContain('Moved to');
    });
    expect(notifQueue.unregister).toHaveBeenCalledWith('channel-moved-23');
  });

  it('treats repeated admin moves as sharing-related when user resumes sharing after each move', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
          { id: 3, name: 'Raid' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    for (let i = 0; i < 6; i++) {
      await act(async () => {
        view.getByTestId('header-toggle-screen-share').click();
        await Promise.resolve();
      });
      act(() => {
        bridge.emit('voice.channelChanged', {
          channelId: i % 2 === 0 ? 2 : 3,
          previousChannelId: i % 2 === 0 ? 1 : 2,
          actorName: 'Moderator',
          reason: 'moved',
        });
      });
      await waitFor(() => {
        expect(document.body.textContent).toContain('Screen sharing was stopped.');
      });
      screenShareState.isSharing = false;
    }

    expect(markLocalShareTeardownIntent).toHaveBeenCalledTimes(6);
    expect(stopSharing).toHaveBeenCalledTimes(6);
  });

  it('admin move while sharing stops local publishing with moved-channel intent', async () => {
    screenShareState.isSharing = true;
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(markLocalShareTeardownIntent).toHaveBeenCalledWith('moved-channel');
      expect(stopSharing).toHaveBeenCalledTimes(1);
    });
  });

  it('admin move after a LiveKit interruption replaces the technical share warning with moved sharing notification', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('screen-share-ended-') || id.startsWith('channel-moved-'));
    screenShareState.isSharing = true;
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      getLocalShareEndedHandler()?.('interrupted');
    });
    screenShareState.isSharing = false;

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(notifQueue.unregister).toHaveBeenCalledWith('screen-share-ended-0');
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-0', 'info');
      expect(document.body.textContent).toContain('Moved to Gaming');
      expect(document.body.textContent).toContain('Screen sharing was stopped.');
      expect(document.body.textContent).not.toContain('technical issue');
    });
  });

  it('manual share stop unregisters a previously queued share-ended notification', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('screen-share-ended-'));
    render(React.createElement(App));

    act(() => {
      getLocalShareEndedHandler()?.('interrupted');
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('screen-share-ended-0', 'info');
    });

    act(() => {
      getLocalShareEndedHandler()?.('manual');
    });

    await waitFor(() => {
      expect(notifQueue.unregister).toHaveBeenCalledWith('screen-share-ended-0');
    });
  });

  it('manual share stop does not make a later admin move look sharing-related', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    screenShareState.isSharing = true;
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      getLocalShareEndedHandler()?.('manual');
    });
    screenShareState.isSharing = false;

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-0', 'info');
      expect(document.body.textContent).toContain('Moved to Gaming');
      expect(document.body.textContent).not.toContain('Screen sharing was stopped.');
    });
    expect(markLocalShareTeardownIntent).not.toHaveBeenCalledWith('moved-channel');
    expect(stopSharing).not.toHaveBeenCalled();
  });

  it('admin move while not sharing does not set moved-channel teardown intent', async () => {
    screenShareState.isSharing = false;
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 2,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('channel-moved-0', 'info');
    });
    expect(markLocalShareTeardownIntent).not.toHaveBeenCalledWith('moved-channel');
    expect(stopSharing).not.toHaveBeenCalled();
  });

  it('describes admin move to root as moved out of voice', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 0, name: 'Connected', parent: 0 },
          { id: 1, name: 'General' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 0,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Moved out of voice');
      expect(document.body.textContent).toContain('Moderator moved you out of General.');
      expect(document.body.textContent).not.toContain('Moved to Connected');
    });
  });

  it('describes admin move to root while sharing as moved out of voice and stopped sharing', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id.startsWith('channel-moved-'));
    screenShareState.isSharing = true;
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 0, name: 'Connected', parent: 0 },
          { id: 1, name: 'General' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    act(() => {
      bridge.emit('voice.channelChanged', {
        channelId: 0,
        previousChannelId: 1,
        actorName: 'Moderator',
        reason: 'moved',
      });
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain('Moved out of voice');
      expect(document.body.textContent).toContain('Moderator moved you out of General. Screen sharing was stopped.');
    });
  });

  it('shows a warning notification when kicked from the server', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'server-removal');
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.disconnected', {
        reason: 'kicked',
        actorName: 'Moderator',
        message: 'Too loud',
        reconnectAvailable: true,
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('server-removal', 'warning');
      expect(document.body.textContent).toContain('Kicked from server');
      expect(document.body.textContent).toContain('Moderator kicked you from the server. Reason: Too loud');
    });
  });

  it('shows an error notification when banned from the server', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'server-removal');
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.disconnected', {
        reason: 'banned',
        actorName: 'Admin',
        message: 'Spam',
        reconnectAvailable: true,
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('server-removal', 'error');
      expect(document.body.textContent).toContain('Banned from server');
      expect(document.body.textContent).toContain('Admin banned you from the server. Reason: Spam');
    });
  });

  it('clears server removal notification after reconnecting successfully', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'server-removal');
    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.disconnected', {
        reason: 'kicked',
        actorName: 'Moderator',
        reconnectAvailable: true,
      });
    });

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('server-removal', 'warning');
      expect(document.body.textContent).toContain('Kicked from server');
    });

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await waitFor(() => {
      expect(notifQueue.unregister).toHaveBeenCalledWith('server-removal');
      expect(document.body.textContent).not.toContain('Kicked from server');
    });
  });

  it('screen share active channel switch cancel keeps sharing and does not join the new channel', async () => {
    const { confirm } = await import('./hooks/usePrompt');
    vi.mocked(confirm).mockResolvedValueOnce(false);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });
    screenShareState.isSharing = true;
    view.rerender(React.createElement(App));

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screen share active',
      message: 'Moving to another channel will end your screen share. Move and stop sharing?',
      confirmLabel: 'Move',
      cancelLabel: 'Stay Here',
    }));
    expect(stopSharing).not.toHaveBeenCalled();
    expect(bridge.send).not.toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });
  });

  it('screen share active channel switch confirm stops sharing before joining the new channel', async () => {
    const { confirm } = await import('./hooks/usePrompt');
    vi.mocked(confirm).mockResolvedValueOnce(true);
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });
    screenShareState.isSharing = true;
    view.rerender(React.createElement(App));

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screen share active',
      message: 'Moving to another channel will end your screen share. Move and stop sharing?',
      confirmLabel: 'Move',
      cancelLabel: 'Stay Here',
    }));
    expect(stopSharing).toHaveBeenCalled();
    expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const joinCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.joinChannel');
    expect(joinCall?.order).toBeGreaterThan(stopCall);
  });

  it('screen share active denied channel join keeps sharing and does not ask to stop sharing', async () => {
    const { confirm } = await import('./hooks/usePrompt');

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', canEnter: false },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });
    screenShareState.isSharing = true;
    view.rerender(React.createElement(App));

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(stopSharing).not.toHaveBeenCalled();
    expect(bridge.send).not.toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });
  });

  it('screen share active password join cancel keeps sharing and does not ask to stop sharing', async () => {
    const { confirm, prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce(null);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', canEnter: false, hasPasswordRestriction: true },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });
    screenShareState.isSharing = true;
    view.rerender(React.createElement(App));

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Channel Password',
      message: 'Enter the password for Gaming.',
    }));
    expect(confirm).not.toHaveBeenCalled();
    expect(stopSharing).not.toHaveBeenCalled();
    expect(bridge.send).not.toHaveBeenCalledWith('voice.joinChannel', { channelId: 2 });
  });

  it('screen share active password join confirm stops sharing before sending password join', async () => {
    const { confirm, prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce('secret-token');
    vi.mocked(confirm).mockResolvedValueOnce(true);
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', canEnter: false, hasPasswordRestriction: true },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-toggle-screen-share').click();
      await Promise.resolve();
    });
    screenShareState.isSharing = true;
    view.rerender(React.createElement(App));

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Channel Password',
      message: 'Enter the password for Gaming.',
    }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screen share active',
      message: 'Moving to another channel will end your screen share. Move and stop sharing?',
    }));
    expect(stopSharing).toHaveBeenCalled();
    expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2, password: 'secret-token' });

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const joinCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.joinChannel');
    expect(joinCall?.order).toBeGreaterThan(stopCall);
  });

  it('prompts for a known password-protected channel before joining', async () => {
    const { prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce('secret-token');
    const getJoinChannelCalls = () => vi.mocked(bridge.send).mock.calls.filter(
      ([type]) => type === 'voice.joinChannel',
    );

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', hasPasswordRestriction: true },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Channel Password',
        message: 'Enter the password for Gaming.',
        placeholder: 'Password',
        confirmLabel: 'Join',
        cancelLabel: 'Cancel',
      }));
    });
    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2, password: 'secret-token' });
    });
    expect(getJoinChannelCalls()).toEqual([
      ['voice.joinChannel', { channelId: 2, password: 'secret-token' }],
    ]);
  });

  it('prompts for a channel password when a password-denial reason reveals an uncached password ACL', async () => {
    const { prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce('secret-token');
    const getJoinChannelCalls = () => vi.mocked(bridge.send).mock.calls.filter(
      ([type]) => type === 'voice.joinChannel',
    );

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    await act(async () => {
      bridge.emit('voice.error', {
        type: 'permissionDenied',
        permission: 4,
        channelId: 2,
        message: CHANNEL_PASSWORD_DENIAL_MESSAGE,
      });
    });

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Channel Password',
        message: 'Enter the password for Gaming.',
      }));
    });
    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('voice.joinChannel', { channelId: 2, password: 'secret-token' });
    });
    expect(getJoinChannelCalls()).toEqual([
      ['voice.joinChannel', { channelId: 2 }],
      ['voice.joinChannel', { channelId: 2, password: 'secret-token' }],
    ]);
  });

  it('does not join when the user cancels the known channel password prompt', async () => {
    const { prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce(null);
    const getJoinChannelCalls = () => vi.mocked(bridge.send).mock.calls.filter(
      ([type]) => type === 'voice.joinChannel',
    );

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', hasPasswordRestriction: true },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(prompt).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getJoinChannelCalls()).toEqual([]);
  });

  it('does not prompt for unrelated permission denials', async () => {
    const { prompt } = await import('./hooks/usePrompt');
    const getJoinChannelCalls = () => vi.mocked(bridge.send).mock.calls.filter(
      ([type]) => type === 'voice.joinChannel',
    );

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming' },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    await act(async () => {
      bridge.emit('voice.error', {
        type: 'permissionDenied',
        permission: 4,
        channelId: 2,
        message: 'Permission denied: missing enter permission',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(getJoinChannelCalls()).toEqual([
      ['voice.joinChannel', { channelId: 2 }],
    ]);
  });

  it('does not reopen the password prompt after a second failed retry', async () => {
    const { prompt } = await import('./hooks/usePrompt');
    vi.mocked(prompt).mockResolvedValueOnce('wrong-secret');
    const getJoinChannelCalls = () => vi.mocked(bridge.send).mock.calls.filter(
      ([type]) => type === 'voice.joinChannel',
    );

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [
          { id: 1, name: 'General' },
          { id: 2, name: 'Gaming', hasPasswordRestriction: true },
        ],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-join-channel-2').click();
      await Promise.resolve();
    });

    await act(async () => {
      bridge.emit('voice.error', {
        type: 'permissionDenied',
        permission: 4,
        channelId: 2,
        message: CHANNEL_PASSWORD_DENIAL_MESSAGE,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getJoinChannelCalls()).toEqual([
      ['voice.joinChannel', { channelId: 2, password: 'wrong-secret' }],
    ]);

    await act(async () => {
      bridge.emit('voice.error', {
        type: 'permissionDenied',
        permission: 4,
        channelId: 2,
        message: CHANNEL_PASSWORD_DENIAL_MESSAGE,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getJoinChannelCalls()).toEqual([
      ['voice.joinChannel', { channelId: 2, password: 'wrong-secret' }],
    ]);
  });

  it('screen share active leave voice cancel keeps sharing and does not leave voice', async () => {
    const { confirm } = await import('./hooks/usePrompt');
    vi.mocked(confirm).mockResolvedValueOnce(false);
    screenShareState.isSharing = true;

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-leave-voice').click();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screen share active',
      message: 'Leaving voice will end your screen share. Leave voice and stop sharing?',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay Here',
    }));
    expect(stopSharing).not.toHaveBeenCalled();
    expect(bridge.send).not.toHaveBeenCalledWith('voice.leaveVoice', {});
  });

  it('screen share active leave voice confirm stops sharing before leaving voice', async () => {
    const { confirm } = await import('./hooks/usePrompt');
    vi.mocked(confirm).mockResolvedValueOnce(true);
    screenShareState.isSharing = true;
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('header-leave-voice').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screen share active',
      message: 'Leaving voice will end your screen share. Leave voice and stop sharing?',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay Here',
    }));
    expect(stopSharing).toHaveBeenCalled();
    expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const leaveCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.leaveVoice');
    expect(leaveCall?.order).toBeGreaterThan(stopCall);
  });

  it('idle auto-leave cleans up local and watched screen shares before leaving voice', async () => {
    screenShareState.isSharing = true;
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-watch-share').click();
      await Promise.resolve();
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    expect(getIdleActionsArgs()?.onBeforeAutoLeave).toBeTypeOf('function');
    await act(async () => {
      await getIdleActionsArgs()?.onBeforeAutoLeave?.();
      bridge.send('voice.leaveVoice', {});
    });

    expect(stopSharing).toHaveBeenCalled();
    expect(disconnectViewer).toHaveBeenCalled();
    expect(bridge.send).toHaveBeenCalledWith('voice.leaveVoice', {});
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const disconnectCall = vi.mocked(disconnectViewer).mock.invocationCallOrder[0];
    const leaveCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.leaveVoice');
    expect(leaveCall?.order).toBeGreaterThan(disconnectCall);
    expect(leaveCall?.order).toBeGreaterThan(stopCall);
  });

  it('idle auto-leave notification says screen sharing and watched streams were stopped', async () => {
    vi.mocked(notifQueue.isVisible).mockImplementation((id: string) => id === 'idle-auto-leave');
    idleActionsState.autoLeftAt = 3000;

    render(React.createElement(App));

    await waitFor(() => {
      expect(notifQueue.register).toHaveBeenCalledWith('idle-auto-leave', 'info');
    });
    expect(screen.getByText('Out of voice')).toBeInTheDocument();
    expect(screen.getByText('You were moved out of voice after inactivity. Screen sharing and watched streams were stopped.')).toBeInTheDocument();
  });

  it('leftVoiceChanged cleans up local and watched screen shares', async () => {
    screenShareState.isSharing = true;
    screenShareState.activeShares = [{
      roomName: 'channel-1',
      userName: 'Alice',
      userId: 42,
      matrixUserId: '@alice:example.com',
      sessionId: 2,
    }];
    vi.mocked(stopSharing).mockResolvedValueOnce(undefined);

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 2, name: 'Alice', channelId: 1, matrixUserId: '@alice:example.com' },
        ],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-watch-share').click();
      await Promise.resolve();
    });

    act(() => {
      bridge.emit('livekit.screenShareStarted', {
        roomName: 'channel-1',
        userName: 'Alice',
        userId: 42,
        matrixUserId: '@alice:example.com',
        sessionId: 2,
      });
    });

    await act(async () => {
      bridge.emit('voice.leftVoiceChanged', { leftVoice: true });
      await Promise.resolve();
    });

    expect(stopSharing).toHaveBeenCalled();
    expect(disconnectViewer).toHaveBeenCalled();
    expect(screen.queryByText('Alice started sharing their screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Sharing')).not.toBeInTheDocument();
  });

  it('clicking disconnect while sharing stops manually before voice disconnect without queueing a warning', async () => {
    screenShareState.isSharing = true;
    vi.mocked(stopSharing).mockImplementation(async () => {
      screenShareState.isSharing = false;
    });

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      view.getByTestId('sidebar-disconnect').click();
      await Promise.resolve();
    });

    expect(markLocalShareTeardownIntent).toHaveBeenCalledWith('manual');
    expect(stopSharing).toHaveBeenCalledTimes(1);
    expect(bridge.send).toHaveBeenCalledWith('voice.disconnect');

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const disconnectCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.disconnect');

    expect(disconnectCall?.order).toBeGreaterThan(stopCall);
    expect(getShareEndedQueueRegistrations()).toEqual([]);
  });

  it('back-to-server while sharing stops manually before voice disconnect without queueing a warning', async () => {
    screenShareState.isSharing = true;
    vi.mocked(stopSharing).mockImplementation(async () => {
      screenShareState.isSharing = false;
    });

    const view = render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      bridge.emit('voice.disconnected', { reconnectAvailable: true });
    });

    await waitFor(() => {
      expect(view.getByTestId('back-to-server-list')).toBeTruthy();
    });

    await act(async () => {
      view.getByTestId('back-to-server-list').click();
      await Promise.resolve();
    });

    expect(markLocalShareTeardownIntent).toHaveBeenCalledWith('manual');
    expect(stopSharing).toHaveBeenCalledTimes(1);
    expect(bridge.send).toHaveBeenCalledWith('voice.disconnect');

    const stopCall = vi.mocked(stopSharing).mock.invocationCallOrder[0];
    const disconnectCall = vi.mocked(bridge.send).mock.calls
      .map(([type], index) => ({ type, order: vi.mocked(bridge.send).mock.invocationCallOrder[index] }))
      .find(call => call.type === 'voice.disconnect');

    expect(disconnectCall?.order).toBeGreaterThan(stopCall);
    expect(getShareEndedQueueRegistrations()).toEqual([]);
  });

  it('publishes a user-muted or user-unmuted balloon for same-channel user state updates when self-mute changes', async () => {
    localStorage.setItem('brmble-settings', JSON.stringify({
      overlay: {
        overlayEnabled: true,
        showJoinLeaveEvents: true,
      },
    }));

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'TestUser',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 7, name: 'TestUser', self: true, channelId: 1 },
          { session: 8, name: 'Alice', channelId: 1, muted: false },
        ],
      });
    });

    act(() => {
      bridge.emit('voice.userJoined', {
        session: 8,
        name: 'Alice',
        channelId: 1,
        muted: true,
        self: false,
      });
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as { snapshot?: { recentEvents?: Array<{ line: string }> } } | undefined;
      expect(lastPayload?.snapshot?.recentEvents ?? []).toEqual([
        expect.objectContaining({ line: 'Alice muted themselves' }),
      ]);
    });

    act(() => {
      bridge.emit('voice.userJoined', {
        session: 8,
        name: 'Alice',
        channelId: 1,
        muted: false,
        self: false,
      });
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as { snapshot?: { recentEvents?: Array<{ line: string }> } } | undefined;
      expect(lastPayload?.snapshot?.recentEvents ?? []).toEqual([
        expect.objectContaining({ line: 'Alice muted themselves' }),
        expect.objectContaining({ line: 'Alice unmuted themselves' }),
      ]);
    });
  });

  it('stores remote companion ids from voice state in overlay companion lookup', async () => {
    localStorage.setItem('brmble-settings', JSON.stringify({
      overlay: {
        overlayEnabled: true,
        mode: 'full',
        myCompanion: 'floppy',
      },
    }));

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'me',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 1, name: 'me', self: true, channelId: 1, companionId: 'bee' }],
      });
    });

    act(() => {
      bridge.emit('voice.userJoined', {
        session: 2,
        name: 'alice',
        self: false,
        channelId: 1,
        companionId: 'retro',
      });
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as { snapshot?: { fullCompanion?: { companionsByUser?: Record<string, { companionId?: string }> } } } | undefined;
      expect(lastPayload?.snapshot?.fullCompanion?.companionsByUser?.['2']?.companionId).toBe('retro');
    });
  });

  it('refreshes a speaking remote companion display after mapping arrives while screen sharing', async () => {
    localStorage.setItem('brmble-settings', JSON.stringify({
      overlay: {
        overlayEnabled: true,
        mode: 'full',
        myCompanion: 'floppy',
      },
    }));
    screenShareState.isSharing = true;

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'me',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [
          { session: 1, name: 'me', self: true, channelId: 1, companionId: 'floppy' },
          { session: 2, name: 'alice', self: false, channelId: 1 },
        ],
      });
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as {
        snapshot?: { currentChannelId?: string | null };
      } | undefined;
      expect(lastPayload?.snapshot?.currentChannelId).toBe('1');
    });

    act(() => {
      bridge.emit('voice.userSpeaking', { session: 2 });
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as {
        snapshot?: { fullCompanion?: { activeDisplay?: { representedSession?: number; companionId?: string; isProxy?: boolean } } };
      } | undefined;
      expect(lastPayload?.snapshot?.fullCompanion?.activeDisplay?.representedSession).toBe(2);
      expect(lastPayload?.snapshot?.fullCompanion?.activeDisplay?.companionId).toBe('floppy');
      expect(lastPayload?.snapshot?.fullCompanion?.activeDisplay?.isProxy).toBe(true);
    });

    act(() => {
      bridge.emit('voice.userMappingUpdated', {
        sessionId: 2,
        matrixUserId: '@alice:example.com',
        companionId: 'retro',
        action: 'added',
      });
    });

    await waitFor(() => {
      const overlaySyncCalls = vi.mocked(bridge.send).mock.calls
        .filter(([type]) => type === 'overlay.sync');
      const lastPayload = overlaySyncCalls.at(-1)?.[1] as {
        snapshot?: { fullCompanion?: { activeDisplay?: { companionId?: string; isProxy?: boolean } } };
      } | undefined;
      expect(lastPayload?.snapshot?.fullCompanion?.activeDisplay?.companionId).toBe('retro');
      expect(lastPayload?.snapshot?.fullCompanion?.activeDisplay?.isProxy).toBe(false);
    });
  });

  it('reconciles local myCompanion after connect when server state differs', async () => {
    localStorage.setItem('brmble-settings', JSON.stringify({
      overlay: {
        overlayEnabled: true,
        mode: 'full',
        myCompanion: 'floppy',
      },
    }));

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'me',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 1, name: 'me', self: true, channelId: 1, companionId: 'bee' }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('voice.setCompanion', expect.objectContaining({ companionId: 'floppy' }));
    });
  });

  it('keeps the local overlay companion when voice.setCompanionResponse fails', async () => {
    localStorage.setItem('brmble-settings', JSON.stringify({
      overlay: {
        overlayEnabled: true,
        mode: 'full',
        myCompanion: 'floppy',
      },
    }));

    render(React.createElement(App));

    act(() => {
      bridge.emit('voice.connected', {
        username: 'me',
        channelId: 1,
        channels: [{ id: 1, name: 'General' }],
        users: [{ session: 1, name: 'me', self: true, channelId: 1, companionId: 'bee', isBrmbleClient: true }],
      });
    });

    await waitFor(() => {
      expect(bridge.send).toHaveBeenCalledWith('voice.setCompanion', expect.objectContaining({ companionId: 'floppy' }));
    });

    act(() => {
      bridge.emit('voice.setCompanionResponse', {
        success: false,
        companionId: 'bee',
        error: 'Invalid companion ID',
      });
    });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('brmble-settings') ?? '{}');
      expect(stored.overlay.myCompanion).toBe('floppy');
    });

    expect(bridge.send).toHaveBeenCalledWith('voice.setCompanion', expect.objectContaining({ companionId: 'floppy' }));
  });

});
