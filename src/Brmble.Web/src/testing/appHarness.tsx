/**
 * Shared App test harness.
 *
 * `App` is a very large component with a wide mock surface: every suite that renders it
 * needs the same twenty-odd module mocks plus the same "emit credentials, then emit
 * presence" connection dance. This module owns that once.
 *
 * The `vi.mock` calls below are hoisted to the top of *this* module, which is evaluated
 * before `App` is imported, so importing this harness from a test file is enough to
 * install them. A test file must therefore import this harness before anything that
 * pulls in `App`.
 *
 * Suites that need a stub instead of the real component (to capture props, or to expose
 * a simpler DOM) call `overrideComponent(name, render)`; everything else renders the
 * real implementation.
 */
import { act, render, type RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import type { ComponentType, ReactNode } from 'react';
import App from '../App';
import bridge from '../bridge';
import { ServiceStatusProvider } from '../hooks/useServiceStatus';
import { saveConversationTabs } from '../workspace/conversationStorage';
import type { Conversation } from '../workspace/conversation';

export type HarnessProps = Record<string, unknown>;

export type OverridableComponent =
  | 'Header'
  | 'Sidebar'
  | 'ChatPanel'
  | 'DMContactList'
  | 'ServerList'
  | 'ConnectionState'
  | 'PaintSessionView'
  | 'ScreenShareGrid';

const harness = vi.hoisted(() => {
  const overrides = new Map<string, (props: HarnessProps) => unknown>();
  const captured = new Map<string, HarnessProps>();

  const matrixClient = {
    lastMessages: new Map(),
    activeMessages: [] as unknown[],
    setActiveChannel: vi.fn(),
    sendMessage: vi.fn(),
    sendImageMessage: vi.fn(),
    uploadContent: vi.fn(),
    fetchHistory: vi.fn(),
    sendReaction: vi.fn(),
    removeReaction: vi.fn(),
    dmLastMessages: new Map(),
    activeDmMessages: [] as unknown[],
    setActiveDmContact: vi.fn(),
    dmRoomMap: new Map<string, string>(),
    dmUserDisplayNames: new Map(),
    dmUserAvatarUrls: new Map(),
    sendDMMessage: vi.fn(),
    fetchDMHistory: vi.fn(),
    fetchAvatarUrl: vi.fn().mockResolvedValue(undefined),
    client: { marker: 'matrix-client', getRoom: vi.fn((): unknown => undefined) },
    activeTypingText: null as string | null,
    startTyping: vi.fn(),
    stopTyping: vi.fn(),
  };

  const dmStore = {
    contacts: [] as unknown[],
    selectedContact: null as
      | { id: string; displayName: string; unreadCount: number; isEphemeral?: boolean; mumbleSessionId?: number | null }
      | null,
    messages: [] as unknown[],
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

  const roomUnreads = new Map<string, { notificationCount: number; highlightCount?: number; fullyReadEventId?: string | null }>();
  const unreadTracker = {
    roomUnreads,
    getRoomUnread: vi.fn((roomId: string) => (
      roomUnreads.get(roomId) ?? { notificationCount: 0, highlightCount: 0, fullyReadEventId: null }
    )),
    markRoomRead: vi.fn(),
    getFullyReadEventId: vi.fn(() => null),
    getMarkerTimestamp: vi.fn((): number | null => null),
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
    error: null as string | null,
    activeShare: null as unknown,
    activeShares: [] as unknown[],
    watchingShare: null as unknown,
    watchingShares: [] as Array<{ roomName: string; userId: number; userName: string }>,
    pendingViewerShares: [] as unknown[],
    remoteWatchCount: 0,
    isViewerConnectPending: false,
    focusedShare: null as { roomName: string; userId: number; userName: string } | null,
    setFocusedShare: vi.fn(),
    setDiscoveryTarget: vi.fn(),
    remoteVideoEl: null as HTMLVideoElement | null,
    remoteVideoEls: new Map<number, HTMLVideoElement>(),
    roomQuality: undefined as string | undefined,
    shareQualities: new Map<number, string>(),
    viewerQualities: new Map<number, string>(),
    addWatchingShare: vi.fn(),
    removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(),
    connectAsViewer: vi.fn(),
    setViewerQuality: vi.fn(),
    setRemoteScreenSharesHidden: vi.fn(),
    handleScreenShareServiceUnavailable: vi.fn(),
  };

  const notificationQueueIds = new Set<string>();
  const notificationQueue = {
    register: vi.fn((id: string) => { notificationQueueIds.add(id); }),
    unregister: vi.fn((id: string) => { notificationQueueIds.delete(id); }),
    isVisible: vi.fn((id: string) => notificationQueueIds.has(id)),
    visibleCount: 0,
    totalCount: 0,
  };

  return {
    overrides,
    captured,
    matrixClient,
    dmStore,
    unreadTracker,
    roomUnreads,
    idleActions,
    screenShare,
    notificationQueue,
    notificationQueueIds,
    record(name: string, props: HarnessProps) {
      captured.set(name, props);
      return overrides.get(name);
    },
  };
});

vi.mock('../bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    default: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => handlers.get(event)?.delete(handler)),
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

vi.mock('../components/Header/Header', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Actual = actual.Header as ComponentType<HarnessProps>;
  return {
    Header: (props: HarnessProps) => {
      const override = harness.record('Header', props);
      return override ? override(props) : <Actual {...props} />;
    },
  };
});

vi.mock('../components/Sidebar/Sidebar', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Actual = actual.Sidebar as ComponentType<HarnessProps>;
  return {
    Sidebar: (props: HarnessProps) => {
      const override = harness.record('Sidebar', props);
      return override ? override(props) : <Actual {...props} />;
    },
  };
});

vi.mock('../components/ChatPanel/ChatPanel', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Actual = actual.ChatPanel as ComponentType<HarnessProps>;
  return {
    ChatPanel: (props: HarnessProps) => {
      harness.record(props.isDM ? 'ChatPanel:dm' : 'ChatPanel:channel', props);
      const override = harness.overrides.get('ChatPanel');
      return override ? override(props) : <Actual {...props} />;
    },
  };
});

vi.mock('../components/DMContactList/DMContactList', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Actual = actual.DMContactList as ComponentType<HarnessProps>;
  return {
    DMContactList: (props: HarnessProps) => {
      const override = harness.record('DMContactList', props);
      return override ? override(props) : <Actual {...props} />;
    },
  };
});

vi.mock('../components/ServerList/ServerList', () => ({
  ServerList: (props: HarnessProps) => {
    const override = harness.record('ServerList', props);
    return override ? override(props) : <section data-testid="server-list" />;
  },
}));

vi.mock('../components/ConnectionState/ConnectionState', () => ({
  ConnectionState: (props: HarnessProps) => {
    const override = harness.record('ConnectionState', props);
    return override ? override(props) : <section data-testid="connection-state" />;
  },
}));

vi.mock('../components/Paint/PaintSessionView', () => ({
  PaintSessionView: (props: HarnessProps) => {
    const override = harness.record('PaintSessionView', props);
    return override ? override(props) : <div data-testid="paint-session-view" />;
  },
}));

vi.mock('../components/ScreenShareGrid', () => ({
  ScreenShareGrid: (props: HarnessProps) => {
    const override = harness.record('ScreenShareGrid', props);
    return override ? override(props) : <div data-testid="screen-share-grid" />;
  },
}));

vi.mock('../components/NeonD/NeonDGame', () => ({ NeonDGame: () => null }));

vi.mock('../components/SettingsModal/SettingsModal', () => ({
  DEFAULT_SCREEN_SHARE: { captureAudio: false, resolution: '1080p', fps: 30, systemAudio: false, viewerMode: 'in-app' },
  SettingsModal: () => null,
}));

vi.mock('../hooks/useMatrixClient', () => ({ useMatrixClient: () => harness.matrixClient }));
vi.mock('../hooks/useChatStore', () => ({
  useChatStore: () => ({ messages: [], addMessage: vi.fn() }),
  addMessageToStore: vi.fn(),
  clearChatStorage: vi.fn(),
  purgeEphemeralMessages: vi.fn(),
}));
vi.mock('../hooks/useDMStore', () => ({
  useDMStore: (options: HarnessProps) => {
    harness.captured.set('useDMStore', options);
    return harness.dmStore;
  },
}));
vi.mock('../hooks/useUnreadTracker', () => ({
  resetMarkersCache: vi.fn(),
  useUnreadTracker: () => harness.unreadTracker,
}));
vi.mock('../hooks/useBrmbleIdle', () => ({ useBrmbleIdle: () => 0 }));
vi.mock('../hooks/useIdleStatus', () => ({ useIdleStatus: () => ({ voiceIdle: {}, systemIdle: 0, isLocked: false }) }));
vi.mock('../hooks/useIdleActions', () => ({ AFK_THRESHOLD_SEC: 600, useIdleActions: () => harness.idleActions }));
vi.mock('../hooks/useServerHealth', () => ({ useServerHealth: () => undefined }));
vi.mock('../hooks/useCompanionOverlayPublisher', () => ({ useCompanionOverlayPublisher: () => undefined }));
vi.mock('../hooks/useLeaveVoiceCooldown', () => ({ useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }) }));
vi.mock('../hooks/useNotificationQueue', () => ({ useNotificationQueue: () => harness.notificationQueue }));
vi.mock('../hooks/useScreenShare', () => ({ useScreenShare: () => harness.screenShare }));

export interface HarnessChannel {
  id: number;
  name: string;
  [extra: string]: unknown;
}

export interface HarnessUser {
  session: number;
  name: string;
  channelId?: number;
  self?: boolean;
  [extra: string]: unknown;
}

export interface HarnessDmContact {
  id: string;
  name: string;
  unreadCount?: number;
  [extra: string]: unknown;
}

export interface HarnessShare {
  roomName: string;
  userId: number;
  userName: string;
}

export interface RenderConnectedAppOptions {
  /** `'7'` for channel 7, `'server-root'` for the root, `null` for no presence. */
  joinedChannelId?: string | null;
  channels?: HarnessChannel[];
  /**
   * Matrix room ids by channel id. Defaults to one room per channel; pass `{}` for a
   * server whose channels have no Matrix rooms at all.
   */
  matrixRoomMap?: Record<string, string>;
  users?: HarnessUser[];
  dmContacts?: HarnessDmContact[];
  /** Shares the local user is watching; each one also gets a fake remote video element. */
  watchedShares?: HarnessShare[];
  /** Opens a paint session through the real `onOpenPaint` entry point after connecting. */
  paintSessionId?: string | null;
  /** Conversation tabs seeded into storage before the first render. */
  persistedTabs?: Conversation[];
  /** Per-channel unread counts, keyed by channel id. */
  unreads?: Record<string, { notificationCount: number; highlightCount: number }>;
  serverLabel?: string;
}

export interface ConnectedAppHandles extends RenderResult {
  emit: (event: string, data?: unknown) => void;
  screenShare: typeof harness.screenShare;
  matrixClient: typeof harness.matrixClient;
  dmStore: typeof harness.dmStore;
  unreadTracker: typeof harness.unreadTracker;
  notificationQueue: typeof harness.notificationQueue;
  /** Emits a presence reset that puts the local user in another voice channel. */
  moveSelfToChannel: (channelId: number) => void;
  /** Last props seen by a captured component, e.g. `'ChatPanel:channel'`. */
  props: (name: string) => HarnessProps | undefined;
  /** Re-renders the same `<App />` tree, for asserting on freshly captured props. */
  rerenderApp: () => void;
}

const SERVER_HOST = 'voice.example.com';
const SERVER_PORT = 64738;
export const HARNESS_SERVER_ADDRESS = `${SERVER_HOST}:${SERVER_PORT}`;

/** Replaces a component with a stub for the current test file. */
export function overrideComponent(
  name: OverridableComponent,
  render: (props: HarnessProps) => ReactNode,
): void {
  harness.overrides.set(name, render as (props: HarnessProps) => unknown);
}

/** Drops every component override and captured prop set. */
export function resetAppHarness(): void {
  harness.overrides.clear();
  harness.captured.clear();
  harness.roomUnreads.clear();
  harness.screenShare.watchingShares = [];
  harness.screenShare.remoteVideoEls = new Map();
  harness.screenShare.focusedShare = null;
  harness.dmStore.contacts = [];
  harness.dmStore.selectedContact = null;
  (bridge as unknown as { __reset: () => void }).__reset();
}

export { harness as appHarnessMocks };

function emit(event: string, data?: unknown): void {
  (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit(event, data);
}

/** Renders `App` without connecting it, for suites that drive the connection themselves. */
export function renderDisconnectedApp(): RenderResult {
  return render(
    <ServiceStatusProvider>
      <App />
    </ServiceStatusProvider>,
  );
}

export { emit as emitBridgeEvent };

function channelIdNumber(joinedChannelId: string | null): number | undefined {
  if (joinedChannelId === null) return undefined;
  if (joinedChannelId === 'server-root') return 0;
  return Number(joinedChannelId);
}

/**
 * Renders `App` and drives it to the connected state.
 *
 * The connection is emitted the way the client does it: `voice.autoConnect` (which is
 * what establishes the server address the tab store is keyed by), then
 * `server.credentials`, then `voice.connected` carrying presence.
 */
export function renderConnectedApp(options: RenderConnectedAppOptions = {}): ConnectedAppHandles {
  const joinedChannelId = options.joinedChannelId === undefined ? '7' : options.joinedChannelId;
  const selfChannelId = channelIdNumber(joinedChannelId);
  const channels: HarnessChannel[] = options.channels
    ?? (selfChannelId && selfChannelId > 0 ? [{ id: selfChannelId, name: 'General' }] : [{ id: 7, name: 'General' }]);

  const users: HarnessUser[] = options.users
    ?? [{ session: 1, name: 'Me', self: true, ...(selfChannelId === undefined ? {} : { channelId: selfChannelId }) }];

  const roomMap: Record<string, string> = options.matrixRoomMap ?? {};
  if (!options.matrixRoomMap) {
    for (const channel of channels) roomMap[String(channel.id)] = `!channel-${channel.id}:example.com`;
  }

  for (const [channelId, unread] of Object.entries(options.unreads ?? {})) {
    harness.roomUnreads.set(roomMap[channelId] ?? `!channel-${channelId}:example.com`, {
      ...unread,
      fullyReadEventId: null,
    });
  }

  harness.dmStore.contacts = (options.dmContacts ?? []).map(contact => ({
    ...contact,
    id: contact.id,
    displayName: contact.name,
    unreadCount: contact.unreadCount ?? 0,
  }));

  const shares = options.watchedShares ?? [];
  harness.screenShare.watchingShares = shares;
  harness.screenShare.remoteVideoEls = new Map(
    shares.map(share => [share.userId, document.createElement('video')]),
  );

  if (options.persistedTabs) {
    saveConversationTabs(HARNESS_SERVER_ADDRESS, options.persistedTabs);
  }

  const view = render(
    <ServiceStatusProvider>
      <App />
    </ServiceStatusProvider>,
  );

  act(() => {
    emit('voice.autoConnect', {
      id: 'harness-server',
      label: options.serverLabel ?? 'Brmble',
      host: SERVER_HOST,
      port: SERVER_PORT,
    });
    emit('server.credentials', {
      matrix: {
        homeserverUrl: 'https://example.com',
        accessToken: 'token',
        userId: '@me:example.com',
        roomMap,
      },
    });
    emit('voice.connected', {
      username: 'Me',
      channelId: selfChannelId ?? 0,
      channels,
      users,
    });
  });

  if (options.paintSessionId) {
    const channelProps = harness.captured.get('ChatPanel:channel');
    const onOpenPaint = channelProps?.onOpenPaint as ((sessionId: string) => void) | undefined;
    if (!onOpenPaint) {
      throw new Error('renderConnectedApp: paintSessionId requires a rendered channel ChatPanel');
    }
    act(() => { onOpenPaint(options.paintSessionId!); });
  }

  return {
    ...view,
    emit,
    screenShare: harness.screenShare,
    matrixClient: harness.matrixClient,
    dmStore: harness.dmStore,
    unreadTracker: harness.unreadTracker,
    notificationQueue: harness.notificationQueue,
    moveSelfToChannel: (channelId: number) => {
      act(() => {
        emit('voice.usersReset', {
          users: users.map(user => (user.self ? { ...user, channelId } : user)),
        });
      });
    },
    props: (name: string) => harness.captured.get(name),
    rerenderApp: () => {
      view.rerender(
        <ServiceStatusProvider>
          <App />
        </ServiceStatusProvider>,
      );
    },
  };
}
