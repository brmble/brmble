import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { ServiceStatusProvider } from './hooks/useServiceStatus';
import {
  DEFAULT_OVERLAY,
  normalizeCompanionBridgeSelection,
  resolveCompanionDisplay,
  type CompanionSelection,
  type OverlaySettings,
} from './components/SettingsModal/InterfaceSettingsTypes';

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
    pendingViewerShares: [],
    remoteWatchCount: 0,
    isViewerConnectPending: false,
    focusedShare: null,
    setFocusedShare: vi.fn(),
    setDiscoveryTarget: vi.fn(),
    remoteVideoEl: null,
    remoteVideoEls: new Map(),
    roomQuality: undefined,
    shareQualities: new Map(),
    viewerQualities: new Map(),
    setViewerQuality: vi.fn(),
    addWatchingShare: vi.fn(),
    removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(),
    connectAsViewer: vi.fn(),
    handleScreenShareServiceUnavailable: vi.fn(),
  };
  const notificationQueueIds = new Set<string>();
  const notificationQueue = {
    register: vi.fn((id: string) => notificationQueueIds.add(id)),
    unregister: vi.fn((id: string) => notificationQueueIds.delete(id)),
    isVisible: vi.fn((id: string) => notificationQueueIds.has(id)),
    visibleCount: 0,
    totalCount: 0,
  };
  const gallery = {
    status: 'disabled',
    entries: [],
    redactedEventIds: new Set<string>(),
    error: null,
    requestAtlas: vi.fn(),
    requestThumbnail: vi.fn(),
    releaseAtlas: vi.fn(),
    releaseThumbnail: vi.fn(),
    createCompanion: vi.fn(),
    deleteCompanion: vi.fn(),
  };
  return {
    matrixClient,
    dmStore,
    unreadTracker,
    idleActions,
    screenShare,
    notificationQueue,
    notificationQueueIds,
    gallery,
  };
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
  Header: ({ onOpenSettings }: { onOpenSettings?: () => void }) => (
    <header>
      <button type="button" onClick={onOpenSettings}>Open settings</button>
    </header>
  ),
}));
vi.mock('./components/Sidebar/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('./components/ChatPanel/ChatPanel', () => ({ ChatPanel: () => <section /> }));
vi.mock('./components/ServerList/ServerList', () => ({ ServerList: () => <section /> }));
vi.mock('./components/ConnectionState/ConnectionState', () => ({ ConnectionState: () => <section /> }));
vi.mock('./components/DMContactList/DMContactList', () => ({ DMContactList: () => null }));
vi.mock('./components/NeonD/NeonDGame', () => ({ NeonDGame: () => null }));
vi.mock('./hooks/useServerlist', () => ({
  useServerlist: () => ({ servers: [] }),
}));
vi.mock('./hooks/usePermissions', () => ({
  Permission: { Ban: 0x20000, Kick: 0x10000 },
  usePermissions: () => ({ hasPermission: () => false }),
}));
vi.mock('./components/ChannelRequests/MyChannelRequests', () => ({
  MyChannelRequests: () => null,
}));
vi.mock('./hooks/useMatrixClient', () => ({ useMatrixClient: () => mockValues.matrixClient }));
vi.mock('./hooks/useCustomCompanionGallery', () => ({
  useCustomCompanionGallery: () => mockValues.gallery,
}));
vi.mock('./hooks/useChatStore', () => ({
  useChatStore: () => ({ messages: [], addMessage: vi.fn() }),
  addMessageToStore: vi.fn(),
  clearChatStorage: vi.fn(),
  purgeEphemeralMessages: vi.fn(),
}));
vi.mock('./hooks/useDMStore', () => ({ useDMStore: () => mockValues.dmStore }));
vi.mock('./hooks/useUnreadTracker', () => ({
  resetMarkersCache: vi.fn(),
  useUnreadTracker: () => mockValues.unreadTracker,
}));
vi.mock('./hooks/useBrmbleIdle', () => ({ useBrmbleIdle: () => 0 }));
vi.mock('./hooks/useIdleStatus', () => ({
  useIdleStatus: () => ({ voiceIdle: {}, systemIdle: 0, isLocked: false }),
}));
vi.mock('./hooks/useIdleActions', () => ({
  AFK_THRESHOLD_SEC: 600,
  useIdleActions: () => mockValues.idleActions,
}));
vi.mock('./hooks/useServerHealth', () => ({ useServerHealth: () => undefined }));
vi.mock('./hooks/useCompanionOverlayPublisher', () => ({
  useCompanionOverlayPublisher: () => undefined,
}));
vi.mock('./hooks/useLeaveVoiceCooldown', () => ({
  useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }),
}));
vi.mock('./hooks/useNotificationQueue', () => ({
  useNotificationQueue: () => mockValues.notificationQueue,
}));
vi.mock('./hooks/useScreenShare', () => ({ useScreenShare: () => mockValues.screenShare }));

const entry = {
  id: 'custom:$sprite:test' as const,
  eventId: '$sprite:test',
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

function gallery(input?: {
  entries?: typeof entry[];
  ready?: string[];
  redacted?: string[];
}) {
  return {
    status: 'ready',
    entries: input?.entries ?? [entry],
    readyAtlasCacheKeys: new Set(input?.ready ?? [entry.atlasCacheKey]),
    redactedEventIds: new Set(input?.redacted ?? []),
  };
}

function emit(event: string, data?: unknown) {
  (bridge as unknown as { __emit: (type: string, payload?: unknown) => void }).__emit(event, data);
}

function renderApp() {
  return render(
    <ServiceStatusProvider>
      <App />
    </ServiceStatusProvider>,
  );
}

function credentials(selectedCompanionId: CompanionSelection = entry.id) {
  return {
    matrix: {
      homeserverUrl: 'https://example.com',
      accessToken: 'token',
      userId: '@me:example.com',
      roomMap: {},
      customCompanions: {
        enabled: true,
        schemaVersion: 1,
        galleryRoomId: '!gallery:test',
        trustedSender: '@server:example.com',
        canModerate: false,
        selectedCompanionId,
        maxActivePerUser: 1,
        maxActiveTotal: 10,
      },
    },
  };
}

function connectedSelf(companionId: CompanionSelection) {
  return {
    username: 'Me',
    channelId: 1,
    channels: [{ id: 1, name: 'General' }],
    users: [{
      session: 7,
      name: 'Me',
      self: true,
      channelId: 1,
      companionId,
      isBrmbleClient: true,
    }],
  };
}

function storedOverlay(): OverlaySettings {
  return JSON.parse(localStorage.getItem('brmble-settings') ?? '{}').overlay;
}

async function openInterfaceSettings(settings: { overlay: OverlaySettings; appearance?: { theme: string } }) {
  await waitFor(() => {
    expect(vi.mocked(bridge.on)).toHaveBeenCalledWith('settings.current', expect.any(Function));
  });
  act(() => emit('settings.current', { settings }));
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Interface' }));
}

function selectCompanion(label: string) {
  const companionSetting = screen.getByText('My Companion').parentElement;
  if (!companionSetting) throw new Error('Missing companion setting');
  fireEvent.click(within(companionSetting).getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('App custom companion delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    mockValues.notificationQueueIds.clear();
    (bridge as unknown as { __reset: () => void }).__reset();
  });

  it('persists the server-selected companion without changing other server selections', async () => {
    const initial: OverlaySettings = {
      ...DEFAULT_OVERLAY,
      myCompanion: 'patch',
      companionSelectionsByServer: {
        '!other:test': 'custom:$other:test',
      },
    };
    localStorage.setItem('brmble-settings', JSON.stringify({ overlay: initial }));
    renderApp();

    act(() => emit('server.credentials', credentials()));

    await waitFor(() => {
      expect(storedOverlay()).toEqual({
        ...initial,
        companionSelectionsByServer: {
          '!other:test': 'custom:$other:test',
          '!gallery:test': entry.id,
        },
      });
    });
  });

  it('restores the modal pre-change overlay when another modal setting changed before the App update', async () => {
    const previous: OverlaySettings = {
      overlayEnabled: false,
      mode: 'full',
      position: 'top-left',
      myCompanion: 'retro',
      companionSelectionsByServer: {
        '!gallery:test': entry.id,
        '!other:test': 'custom:$other:test',
      },
      showChannelMessages: true,
      showDirectMessages: true,
      showJoinLeaveEvents: false,
      showModerationEvents: true,
      showActiveSpeakers: false,
    };
    localStorage.setItem('brmble-settings', JSON.stringify({
      appearance: { theme: 'classic' },
      overlay: previous,
    }));
    renderApp();
    act(() => {
      emit('server.credentials', credentials());
      emit('voice.connected', connectedSelf(entry.id));
    });

    await openInterfaceSettings({
      appearance: { theme: 'classic' },
      overlay: previous,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Channel Messages' }));
    selectCompanion('Bee');

    const request = vi.mocked(bridge.send).mock.calls
      .filter(([type]) => type === 'voice.setCompanion')
      .at(-1)?.[1] as { requestId: number };

    act(() => emit('voice.setCompanionResponse', {
      success: false,
      requestId: request.requestId,
      error: 'rejected',
    }));

    const expectedRollback = {
      ...previous,
      showChannelMessages: false,
    };
    await waitFor(() => expect(storedOverlay()).toEqual(expectedRollback));
    expect(vi.mocked(bridge.send)).toHaveBeenCalledWith('settings.set', {
      settings: expect.objectContaining({
        appearance: { theme: 'classic' },
        overlay: expectedRollback,
      }),
    });
  });

  it('never sends a custom selection without server capability but still sends built-ins', async () => {
    const initial: OverlaySettings = {
      ...DEFAULT_OVERLAY,
      mode: 'full',
      myCompanion: entry.id,
    };
    localStorage.setItem('brmble-settings', JSON.stringify({ overlay: initial }));
    renderApp();
    act(() => emit('voice.connected', connectedSelf('bee')));

    await openInterfaceSettings({ overlay: initial });
    selectCompanion('Patch');

    const selections = vi.mocked(bridge.send).mock.calls
      .filter(([type]) => type === 'voice.setCompanion')
      .map(([, payload]) => (payload as { companionId: CompanionSelection }).companionId);
    expect(selections).not.toContain(entry.id);
    expect(selections).toContain('floppy');
    expect(selections).toContain('patch');
  });

  it('immediately falls back local and remote displays when the selected event is removed', () => {
    const available = gallery();
    const removed = gallery({ entries: [], ready: [], redacted: [entry.eventId] });

    expect(resolveCompanionDisplay(entry.id, available).companionId).toBe(entry.id);
    expect(resolveCompanionDisplay(entry.id, removed).companionId).toBe('floppy');
  });

  it('restores a temporarily unavailable selection after its atlas becomes ready', () => {
    const unavailable = gallery({ ready: [] });
    const recovered = gallery();

    expect(resolveCompanionDisplay(entry.id, unavailable).companionId).toBe('floppy');
    expect(resolveCompanionDisplay(entry.id, recovered)).toEqual({
      companionId: entry.id,
      atlasCacheKey: entry.atlasCacheKey,
    });
  });

  it('keeps a redacted selection on floppy even if stale metadata and cache state reappear', () => {
    expect(resolveCompanionDisplay(entry.id, gallery({ redacted: [entry.eventId] })).companionId).toBe('floppy');
  });

  it('prefers the additive custom field while preserving the legacy floppy field', () => {
    const serverPayload = {
      companionId: 'floppy',
      customCompanionId: entry.id,
    };

    expect(serverPayload.companionId).toBe('floppy');
    expect(normalizeCompanionBridgeSelection(serverPayload)).toBe(entry.id);
  });
});
