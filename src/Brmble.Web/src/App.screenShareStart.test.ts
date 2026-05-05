import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type BridgeHandler = (data: unknown) => void;

const {
  bridgeHandlers,
  bridge,
  disconnectViewer,
  setDiscoveryTarget,
  stopSharing,
  markLocalShareTeardownIntent,
  screenShareState,
  notifQueue,
} = vi.hoisted(() => {
  const handlers = new Map<string, Set<BridgeHandler>>();
  const disconnect = vi.fn();
  const setTarget = vi.fn();
  const stop = vi.fn();
  const markIntent = vi.fn();
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
    markLocalShareTeardownIntent: markIntent,
    screenShareState: { isSharing: false },
    notifQueue: {
      register: vi.fn(),
      unregister: vi.fn(),
      isVisible: vi.fn(() => false),
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
  }),
}));

vi.mock('./hooks/useScreenShare', () => ({
  useScreenShare: () => ({
    isSharing: screenShareState.isSharing,
    startSharing: vi.fn(),
    stopSharing,
    markLocalShareTeardownIntent,
    error: null,
    activeShare: null,
    activeShares: [],
    watchingShares: [],
    focusedShare: null,
    setFocusedShare: vi.fn(),
    setDiscoveryTarget,
    remoteVideoEls: new Map(),
    disconnectViewer,
    connectAsViewer: vi.fn(),
  }),
}));

vi.mock('./hooks/useLeaveVoiceCooldown', () => ({
  useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }),
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
    statuses: { voice: { error: undefined } },
    updateStatus: vi.fn(),
    resetStatuses: vi.fn(),
  }),
}));

vi.mock('./hooks/useServerHealth', () => ({ useServerHealth: vi.fn() }));

vi.mock('./hooks/useChatStore', () => ({
  useChatStore: () => ({ messages: [], addMessage: vi.fn() }),
  addMessageToStore: vi.fn(),
  clearChatStorage: vi.fn(),
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
}));

vi.mock('./contexts/ProfileContext', () => ({
  ProfileProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('./components/Header/Header', () => ({ Header: () => null }));
vi.mock('./components/Header/BrmbleLogo', () => ({ BrmbleLogo: () => null }));
vi.mock('./components/Sidebar/Sidebar', () => ({
  Sidebar: ({ onDisconnect }: { onDisconnect?: () => void }) => React.createElement('button', {
    type: 'button',
    'data-testid': 'sidebar-disconnect',
    onClick: onDisconnect,
  }),
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
vi.mock('./components/Notification/Notification', () => ({ Notification: () => null }));

import App, { getNextLiveKitStatusUpdate, shouldClearLocalShareStartPending, toggleLocalScreenShare } from './App';

describe('toggleLocalScreenShare', () => {
  it('starts sharing in the current voice channel without changing LiveKit status first', async () => {
    const startSharing = vi.fn().mockResolvedValue(undefined);
    const stopSharing = vi.fn();
    const setSharingChannelId = vi.fn();

    await toggleLocalScreenShare({
      isSharing: false,
      selfLeftVoice: false,
      voiceChannelId: 7,
      startSharing,
      stopSharing,
      setSharingChannelId,
    });

    expect(startSharing).toHaveBeenCalledWith('channel-7');
    expect(setSharingChannelId).toHaveBeenCalledWith('7');
    expect(stopSharing).not.toHaveBeenCalled();
  });
});

describe('getNextLiveKitStatusUpdate', () => {
  it('preserves the previous LiveKit status while the share picker is unresolved after clearing an error', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 0,
      screenShareError: null,
      isLocalShareStartPending: true,
    })).toBeNull();
  });

  it('keeps LiveKit connected while watching a share even if local share start is still pending', () => {
    expect(getNextLiveKitStatusUpdate({
      isSharing: false,
      watchingShareCount: 1,
      screenShareError: null,
      isLocalShareStartPending: true,
    })).toEqual({ state: 'connected', error: undefined });
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

describe('active share discovery', () => {
  const getActiveShareRequests = () => vi.mocked(bridge.send).mock.calls.filter(
    ([type]) => type === 'livekit.checkActiveShare',
  );

  const getShareEndedQueueRegistrations = () => vi.mocked(notifQueue.register).mock.calls.filter(
    ([id]) => String(id).startsWith('screen-share-ended-'),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeHandlers.clear();
    localStorage.clear();
    screenShareState.isSharing = false;
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
});
