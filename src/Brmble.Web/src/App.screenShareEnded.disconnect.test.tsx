import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';

type BridgeHandler = (data: unknown) => void;

const {
  bridgeHandlers,
  bridge,
  stopSharing,
  setDiscoveryTarget,
  disconnectViewer,
  connectAsViewer,
  markLocalShareTeardownIntent,
  screenShareState,
} = vi.hoisted(() => {
  const handlers = new Map<string, Set<BridgeHandler>>();
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
    emit(type: string, data?: unknown) {
      for (const handler of handlers.get(type) ?? []) {
        handler(data);
      }
    },
  };

  return {
    bridgeHandlers: handlers,
    bridge: mockBridge,
    stopSharing: vi.fn(),
    setDiscoveryTarget: vi.fn(),
    disconnectViewer: vi.fn(),
    connectAsViewer: vi.fn(),
    markLocalShareTeardownIntent: vi.fn(),
    screenShareState: { isSharing: false },
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
  useScreenShare: (_onDisconnected?: () => void, _screenShareSettings?: unknown, onLocalShareEnded?: (reason: 'manual' | 'source-closed' | 'interrupted' | 'error') => void) => ({
    isSharing: screenShareState.isSharing,
    startSharing: vi.fn(),
    stopSharing: stopSharing.mockImplementation(async () => {
      screenShareState.isSharing = false;
      onLocalShareEnded?.('manual');
    }),
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
    connectAsViewer,
  }),
}));

vi.mock('./hooks/useLeaveVoiceCooldown', () => ({
  useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }),
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
vi.mock('./components/Notification/Notification', () => ({
  Notification: ({ title, detail }: { title?: string; detail?: string }) => React.createElement(
    'div',
    { 'data-testid': 'notification' },
    title,
    detail,
  ),
}));

describe('screen share disconnect handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeHandlers.clear();
    localStorage.clear();
    screenShareState.isSharing = false;
  });

  it('stops sharing manually before disconnecting from the sidebar without queueing a share-ended notification', async () => {
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
    expect(view.queryByText('Share ended')).toBeNull();
    expect(view.queryByText('Screen share failed')).toBeNull();
  });

  it('stops sharing manually before back-to-server disconnect without queueing a share-ended notification', async () => {
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
    expect(view.queryByText('Share ended')).toBeNull();
    expect(view.queryByText('Screen share failed')).toBeNull();
  });
});
