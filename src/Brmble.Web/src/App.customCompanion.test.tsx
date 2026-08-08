import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { ServiceStatusProvider } from './hooks/useServiceStatus';
import type { CustomCompanionEntry } from './customCompanions/customCompanionTypes';
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
    requestAtlas: vi.fn().mockResolvedValue('blob:atlas'),
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
        // The client emits membership as voice.usersReset immediately after voice.connected.
        const users = (data as { users?: unknown[] } | undefined)?.users;
        if (event === 'voice.connected' && users) {
          handlers.get('voice.usersReset')?.forEach(handler => handler({ users }));
        }
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
vi.mock('./components/SettingsModal/AdminSettingsTab', () => ({
  AdminSettingsTab: ({ customCompanions }: { customCompanions?: { canModerate: boolean } }) => (
    <div data-testid="admin-custom-companion-prop">{customCompanions?.canModerate ? 'can-moderate' : 'absent'}</div>
  ),
}));
vi.mock('./hooks/useServerlist', () => ({
  useServerlist: () => ({ servers: [] }),
}));
const hasPermissionMock = vi.fn(() => false);

vi.mock('./hooks/usePermissions', () => ({
  Permission: { Ban: 0x20000, Kick: 0x10000 },
  usePermissions: () => ({ hasPermission: hasPermissionMock }),
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

const entry: CustomCompanionEntry = {
  id: 'custom:$sprite:test',
  eventId: '$sprite:test',
  roomId: '!gallery:test',
  name: 'Orbit',
  mediaUri: 'mxc://test/sprite',
  mimeType: 'image/png',
  width: 1536,
  height: 1872,
  frameCount: 1,
  byteSize: 1024,
  uploaderMatrixUserId: '@alice:example.com',
  uploaderDisplayName: 'Alice',
  createdAt: 1,
  atlasCacheKey: '!gallery:test\u0000$sprite:test',
};

function gallery(input?: {
  entries?: CustomCompanionEntry[];
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

function galleryEntry(index: number): CustomCompanionEntry {
  return {
    ...entry,
    id: `custom:$sprite-${index}:test`,
    eventId: `$sprite-${index}:test`,
    name: `Sprite ${index}`,
    mediaUri: `mxc://test/sprite-${index}`,
    createdAt: index,
    atlasCacheKey: `!gallery:test\u0000$sprite-${index}:test`,
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

function selectCompanion(label: string | RegExp) {
  const companionSetting = screen.getByText('My Companion').parentElement;
  if (!companionSetting) throw new Error('Missing companion setting');
  const pickerButton = within(companionSetting).queryByRole('button', { name: label });
  if (pickerButton) {
    fireEvent.click(pickerButton);
    return;
  }
  fireEvent.click(within(companionSetting).getByRole('combobox'));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('App custom companion delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    mockValues.notificationQueueIds.clear();
    Object.assign(mockValues.gallery, {
      status: 'disabled',
      entries: [],
      redactedEventIds: new Set<string>(),
      error: null,
    });
    mockValues.gallery.requestAtlas.mockResolvedValue('blob:atlas');
    mockValues.gallery.requestThumbnail.mockResolvedValue('blob:thumbnail');
    hasPermissionMock.mockReturnValue(false);
    (bridge as unknown as { __reset: () => void }).__reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('waits for metadata before requesting only the saved custom atlas', async () => {
    Object.assign(mockValues.gallery, {
      status: 'loading',
      entries: [],
      redactedEventIds: new Set<string>(),
      error: null,
    });
    const view = renderApp();

    act(() => emit('server.credentials', credentials(entry.id)));
    await waitFor(() => {
      expect(storedOverlay().companionSelectionsByServer['!gallery:test']).toBe(entry.id);
    });
    expect(mockValues.gallery.requestAtlas).not.toHaveBeenCalled();

    Object.assign(mockValues.gallery, {
      status: 'ready',
      entries: [entry],
    });
    view.rerender(
      <ServiceStatusProvider>
        <App />
      </ServiceStatusProvider>,
    );

    await waitFor(() => expect(mockValues.gallery.requestAtlas).toHaveBeenCalledOnce());
    expect(mockValues.gallery.requestAtlas).toHaveBeenCalledWith(
      entry,
      new Set([entry.atlasCacheKey]),
    );
  });

  it('loads only observed thumbnails and the selected atlas in a 100-entry gallery', async () => {
    const intersections: Array<() => void> = [];
    vi.stubGlobal('IntersectionObserver', class {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(element: Element) {
        intersections.push(() => this.callback(
          [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ));
      }

      unobserve() {}
      disconnect() {}
    });
    const entries = Array.from({ length: 100 }, (_, index) => galleryEntry(index));
    Object.assign(mockValues.gallery, {
      status: 'ready',
      entries,
      redactedEventIds: new Set<string>(),
      error: null,
    });
    const fullOverlay: OverlaySettings = {
      ...DEFAULT_OVERLAY,
      mode: 'full',
    };
    localStorage.setItem('brmble-settings', JSON.stringify({ overlay: fullOverlay }));
    renderApp();
    act(() => {
      emit('server.credentials', credentials('floppy'));
      emit('voice.connected', connectedSelf('floppy'));
    });

    await openInterfaceSettings({ overlay: fullOverlay });
    await waitFor(() => expect(intersections).toHaveLength(100));
    expect(mockValues.gallery.requestThumbnail).not.toHaveBeenCalled();
    expect(mockValues.gallery.requestAtlas).not.toHaveBeenCalled();

    act(() => intersections.slice(0, 3).forEach(intersect => intersect()));
    await waitFor(() => expect(mockValues.gallery.requestThumbnail).toHaveBeenCalledTimes(3));
    expect(mockValues.gallery.requestAtlas).not.toHaveBeenCalled();

    selectCompanion(/Sprite 50, uploaded by Alice/);
    await waitFor(() => expect(mockValues.gallery.requestAtlas).toHaveBeenCalledOnce());
    expect(mockValues.gallery.requestAtlas).toHaveBeenCalledWith(
      entries[50],
      new Set([entries[50].atlasCacheKey]),
    );
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
      showLocalCompanionWhenIdle: true,
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

  it('does not roll back a newer modal setting when connect-time companion sync fails', async () => {
    const initial: OverlaySettings = {
      ...DEFAULT_OVERLAY,
      myCompanion: 'patch',
      showChannelMessages: true,
    };
    localStorage.setItem('brmble-settings', JSON.stringify({ overlay: initial }));
    renderApp();

    act(() => emit('voice.connected', connectedSelf('bee')));
    const request = vi.mocked(bridge.send).mock.calls
      .filter(([type]) => type === 'voice.setCompanion')
      .at(-1)?.[1] as { requestId: number };

    await openInterfaceSettings({ overlay: initial });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Channel Messages' }));
    await waitFor(() => expect(storedOverlay().showChannelMessages).toBe(false));

    act(() => emit('voice.setCompanionResponse', {
      success: false,
      requestId: request.requestId,
      error: 'rejected',
    }));

    await waitFor(() => expect(storedOverlay().showChannelMessages).toBe(false));
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

  it('falls back for a custom ID that belongs to another gallery', () => {
    expect(resolveCompanionDisplay(
      'custom:$other:test',
      gallery(),
    ).companionId).toBe('floppy');
  });

  it('renders another user custom companion from shared gallery metadata', () => {
    const remoteSelection = normalizeCompanionBridgeSelection({
      companionId: 'floppy',
      customCompanionId: entry.id,
    });

    expect(resolveCompanionDisplay(remoteSelection, gallery())).toEqual({
      companionId: entry.id,
      atlasCacheKey: entry.atlasCacheKey,
    });
  });

  it('prefers the additive custom field while preserving the legacy floppy field', () => {
    const serverPayload = {
      companionId: 'floppy',
      customCompanionId: entry.id,
    };

    expect(serverPayload.companionId).toBe('floppy');
    expect(normalizeCompanionBridgeSelection(serverPayload)).toBe(entry.id);
  });

  it('accepts legacy-field-only floppy delivery from an older server', () => {
    expect(normalizeCompanionBridgeSelection({ companionId: 'floppy' })).toBe('floppy');
  });

  it('ignores a built-in value in the custom field and keeps the legacy field', () => {
    expect(normalizeCompanionBridgeSelection({
      companionId: 'retro',
      customCompanionId: 'bee',
    })).toBe('retro');
  });

  it('ignores a malformed custom field and keeps the legacy field', () => {
    expect(normalizeCompanionBridgeSelection({
      companionId: 'retro',
      customCompanionId: 'custom:not-an-event-id',
    })).toBe('retro');
  });

  it('retries an already-selected custom companion through App atlas ownership', async () => {
    const initial: OverlaySettings = {
      ...DEFAULT_OVERLAY,
      mode: 'full',
      myCompanion: entry.id,
      companionSelectionsByServer: {
        '!gallery:test': entry.id,
      },
    };
    localStorage.setItem('brmble-settings', JSON.stringify({ overlay: initial }));
    Object.assign(mockValues.gallery, {
      status: 'ready',
      entries: [entry],
      redactedEventIds: new Set<string>(),
      error: null,
    });
    mockValues.gallery.requestAtlas
      .mockRejectedValueOnce(new Error('temporary media failure'))
      .mockResolvedValueOnce('blob:atlas');
    renderApp();

    act(() => emit('server.credentials', credentials(entry.id)));
    await waitFor(() => expect(mockValues.gallery.requestAtlas).toHaveBeenCalledTimes(1));
    mockValues.gallery.requestAtlas.mockClear();

    await openInterfaceSettings({ overlay: initial });
    selectCompanion(/Orbit, uploaded by Alice/);

    await waitFor(() => expect(mockValues.gallery.requestAtlas).toHaveBeenCalledTimes(1));
    expect(mockValues.gallery.releaseAtlas).toHaveBeenCalledWith(entry);
  });

  it('passes the server-advertised custom companion moderation capability into settings', async () => {
    hasPermissionMock.mockReturnValue(true);
    renderApp();

    act(() => emit('server.credentials', credentials(entry.id)));
    await waitFor(() => {
      expect(vi.mocked(bridge.on)).toHaveBeenCalledWith('settings.current', expect.any(Function));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }));

    expect(screen.getByTestId('admin-custom-companion-prop')).toHaveTextContent('absent');

    act(() => emit('server.credentials', {
      matrix: {
        ...credentials(entry.id).matrix,
        customCompanions: {
          ...credentials(entry.id).matrix.customCompanions,
          canModerate: true,
        },
      },
    }));

    expect(screen.getByTestId('admin-custom-companion-prop')).toHaveTextContent('can-moderate');
  });
});
