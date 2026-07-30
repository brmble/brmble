import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';
import { DeathrollModal } from './components/Games/DeathrollModal';
import { RpsModal } from './components/Games/RpsModal';
import type { EndedMatch } from './components/Games/useGameState';
import type { DuelQueueSnapshot, RematchOffer } from './components/Games/useDuelQueueState';
import type { DuelPlayer, QueuedDuel, ReadyCheck } from './api/games';
import { ServiceStatusProvider } from './hooks/useServiceStatus';
import { knownEstimate, unknownEstimate } from './components/Games/duelTestHarness';

const mocks = vi.hoisted(() => {
  const ids = new Set<string>();
  const gameState = {
    incomingInvite: null, outgoingInvite: null, inviteOutcome: null, activeMatch: null, view: null,
    ended: null as EndedMatch | null, lastError: null, turnDeadline: null, turnWindowMs: 0, penalty: false, accepting: false,
    invite: vi.fn(), cancelInvite: vi.fn(), acceptInvite: vi.fn(), declineInvite: vi.fn(), sendAction: vi.fn(),
    roll: vi.fn(), forfeit: vi.fn(), dismissEnded: vi.fn(), clearError: vi.fn(), clearInviteOutcome: vi.fn(), reset: vi.fn(),
  };
  const duelQueue = {
    byChannel: new Map<number, DuelQueueSnapshot>(), incomingRematch: null as RematchOffer | null, outgoingRematch: null as RematchOffer | null,
    commandError: null as null | { revision: number; operation: string; id: number; reason?: string },
    respondReady: vi.fn(), requestRematch: vi.fn(), respondOffer: vi.fn(), cancelOffer: vi.fn(),
    requestSnapshot: vi.fn().mockResolvedValue(undefined), reset: vi.fn(),
  };
  const notificationQueue = {
    register: vi.fn((id: string) => ids.add(id)), unregister: vi.fn((id: string) => ids.delete(id)),
    isVisible: vi.fn((id: string) => ids.has(id)), visibleCount: 0, totalCount: 0,
  };
  const sidebarProps = { current: null as null | Record<string, unknown> };
  const matrixClient = {
    lastMessages: new Map(), activeMessages: [], setActiveChannel: vi.fn(), sendMessage: vi.fn(), sendImageMessage: vi.fn(),
    uploadContent: vi.fn(), fetchHistory: vi.fn(), sendReaction: vi.fn(), removeReaction: vi.fn(), dmLastMessages: new Map(),
    activeDmMessages: [], setActiveDmContact: vi.fn(), dmRoomMap: new Map(), dmUserDisplayNames: new Map(),
    dmUserAvatarUrls: new Map(), sendDMMessage: vi.fn(), fetchDMHistory: vi.fn(), fetchAvatarUrl: vi.fn(), client: null,
    activeTypingText: null, startTyping: vi.fn(), stopTyping: vi.fn(),
  };
  const dmStore = {
    contacts: [], selectedContact: null, messages: [], appMode: 'channels', selectContact: vi.fn(), sendMessage: vi.fn(),
    startDM: vi.fn(), clearSelection: vi.fn(), toggleMode: vi.fn(), closeDM: vi.fn(), appModeRef: { current: 'channels' },
    selectedContactIdRef: { current: null }, receiveMumbleDM: vi.fn(), updateMumbleSession: vi.fn(), clearMumbleContacts: vi.fn(), startMumbleDM: vi.fn(),
  };
  const unreadTracker = { roomUnreads: new Map(), getRoomUnread: vi.fn(() => ({ notificationCount: 0, highlightCount: 0, fullyReadEventId: null })), markRoomRead: vi.fn(), getFullyReadEventId: vi.fn(), getMarkerTimestamp: vi.fn(), totalUnreadCount: 0, totalDmUnreadCount: 0 };
  const idleActions = { autoLeftAt: null, preLeaveStartedAt: null, preLeaveCancelledAt: null, dismissNotification: vi.fn(), dismissPreLeaveCancelled: vi.fn() };
  const screenShare = {
    isSharing: false, startSharing: vi.fn(), stopSharing: vi.fn(), markLocalShareTeardownIntent: vi.fn(), error: null,
    activeShare: null, activeShares: [], watchingShare: null, watchingShares: [], pendingViewerShares: [], remoteWatchCount: 0,
    isViewerConnectPending: false, focusedShare: null, setFocusedShare: vi.fn(), setDiscoveryTarget: vi.fn(), remoteVideoEl: null,
    remoteVideoEls: new Map(), roomQuality: undefined, shareQualities: new Map(), addWatchingShare: vi.fn(), removeWatchingShare: vi.fn(),
    disconnectViewer: vi.fn(), connectAsViewer: vi.fn(), handleScreenShareServiceUnavailable: vi.fn(),
  };
  return { ids, gameState, duelQueue, notificationQueue, sidebarProps, matrixClient, dmStore, unreadTracker, idleActions, screenShare };
});

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return { default: {
    send: vi.fn(),
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (data: unknown) => void) => handlers.get(event)?.delete(handler)),
    __emit: (event: string, data?: unknown) => handlers.get(event)?.forEach(handler => handler(data)),
    __reset: () => handlers.clear(),
  } };
});

vi.mock('./components/Games/useGameState', async (importOriginal) => {
  const original = await importOriginal<typeof import('./components/Games/useGameState')>();
  return { ...original, useGameState: () => mocks.gameState };
});
vi.mock('./components/Games/useDuelQueueState', () => ({ useDuelQueueState: () => mocks.duelQueue }));
vi.mock('./hooks/useNotificationQueue', () => ({ useNotificationQueue: () => mocks.notificationQueue }));
vi.mock('./components/Header/Header', () => ({ Header: () => null }));
vi.mock('./components/Sidebar/Sidebar', () => ({ Sidebar: (props: Record<string, unknown>) => {
  mocks.sidebarProps.current = props;
  const open = props.onOpenDuelQueue as ((id: number) => void) | undefined;
  return <button onClick={() => open?.(7)}>Open General duel</button>;
} }));
vi.mock('./components/ChatPanel/ChatPanel', () => ({ ChatPanel: () => <section data-testid="chat-panel" /> }));
vi.mock('./components/ServerList/ServerList', () => ({ ServerList: () => null }));
vi.mock('./components/ConnectionState/ConnectionState', () => ({ ConnectionState: () => null }));
vi.mock('./components/DMContactList/DMContactList', () => ({ DMContactList: () => null }));
vi.mock('./components/NeonD/NeonDGame', () => ({ NeonDGame: () => null }));
vi.mock('./components/SettingsModal/SettingsModal', () => ({
  DEFAULT_SCREEN_SHARE: { captureAudio: false, resolution: '1080p', fps: 30, systemAudio: false, viewerMode: 'in-app' },
  SettingsModal: () => null,
}));
vi.mock('./hooks/useMatrixClient', () => ({ useMatrixClient: () => mocks.matrixClient }));
vi.mock('./hooks/useChatStore', () => ({ useChatStore: () => ({ messages: [], addMessage: vi.fn() }), addMessageToStore: vi.fn(), clearChatStorage: vi.fn(), purgeEphemeralMessages: vi.fn() }));
vi.mock('./hooks/useDMStore', () => ({ useDMStore: () => mocks.dmStore }));
vi.mock('./hooks/useUnreadTracker', () => ({ resetMarkersCache: vi.fn(), useUnreadTracker: () => mocks.unreadTracker }));
vi.mock('./hooks/useBrmbleIdle', () => ({ useBrmbleIdle: () => 0 }));
vi.mock('./hooks/useIdleStatus', () => ({ useIdleStatus: () => ({ voiceIdle: {}, systemIdle: 0, isLocked: false }) }));
vi.mock('./hooks/useIdleActions', () => ({ AFK_THRESHOLD_SEC: 600, useIdleActions: () => mocks.idleActions }));
vi.mock('./hooks/useServerHealth', () => ({ useServerHealth: () => undefined }));
vi.mock('./hooks/useCompanionOverlayPublisher', () => ({ useCompanionOverlayPublisher: () => undefined }));
vi.mock('./hooks/useLeaveVoiceCooldown', () => ({ useLeaveVoiceCooldown: () => ({ isOnCooldown: false, trigger: vi.fn() }) }));
vi.mock('./hooks/useScreenShare', () => ({ useScreenShare: () => mocks.screenShare }));

vi.mock('./components/Games/HeadToHead', () => ({ HeadToHead: () => null }));

const ended: EndedMatch = {
  matchId: 91,
  sourceMatchId: 91,
  gameType: 'rps',
  format: 'bo3',
  draw: true,
};

const common = {
  view: null,
  ended,
  myUserId: 11,
  turnDeadline: null,
  turnWindowMs: 15_000,
  penalty: false,
  resolveName: (id: number) => `Player ${id}`,
  onForfeit: vi.fn(),
  onClose: vi.fn(),
  onRematch: vi.fn(),
};

describe('participant result rematches', () => {
  it.each([
    ['Deathroll', DeathrollModal],
    ['Rock Paper Scissors', RpsModal],
  ])('keeps the %s result open and requests a rematch', (_name, Modal) => {
    const onRematch = vi.fn();
    if (Modal === DeathrollModal) {
      render(<DeathrollModal {...common} ended={{ ...ended, gameType: 'deathroll' }} onRematch={onRematch} onRoll={vi.fn()} />);
    } else {
      render(<RpsModal {...common} onRematch={onRematch} onPick={vi.fn()} />);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));

    expect(onRematch).toHaveBeenCalledOnce();
    expect(common.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('disables the pending rematch action', () => {
    render(<RpsModal {...common} onPick={vi.fn()} rematchPending />);
    expect(screen.getByRole('button', { name: 'Rematch pending' })).toBeDisabled();
  });
});

function renderApp() {
  return render(<ServiceStatusProvider><App /></ServiceStatusProvider>);
}

/** Mumble session of the local user in these fixtures. Deliberately distinct from any userId. */
const selfSession = 11;

/** userId and sessionId are kept distinct so a userId/sessionId mix-up fails the tests. */
const player = (sessionId: number): DuelPlayer =>
  ({ userId: sessionId * 100, sessionId, displayName: `Player ${sessionId}`, ready: false });

const queuedEntry = (players: DuelPlayer[]): QueuedDuel => ({
  reservationId: 1, position: 1, players, gameType: 'rps', format: 'bo3', rulesetVersion: 1,
  eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
  estimatedDuration: unknownEstimate,
});

const readyCheck = (parts: Partial<ReadyCheck> = {}): ReadyCheck => ({
  reservationId: 42, expiresAt: new Date(Date.now() + 10_000).toISOString(),
  gameType: 'rps', format: 'bo3', rulesetVersion: 1,
  players: [player(selfSession)], estimatedDuration: unknownEstimate, ...parts,
});

const snapshot = (
  channelId: number,
  parts: Partial<Pick<DuelQueueSnapshot, 'active' | 'readyCheck' | 'queue'>>,
): DuelQueueSnapshot => ({
  schemaVersion: 1, channelId, generation: 1, revision: 1, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
  active: parts.active ?? null, readyCheck: parts.readyCheck ?? null, queue: parts.queue ?? [],
});

const connectSelf = (channelId: number) => act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void })
  .__emit('voice.connected', { channelId, users: [{ session: selfSession, name: 'Me', self: true, channelId }] }));

/**
 * A test-harness artefact, not a property of the app. The queue confirmation lands two
 * render passes after a snapshot: the hook's effect sets the confirmation, then the
 * registration effect claims a notification slot. In the app that second pass happens
 * naturally because the real `useNotificationQueue` re-renders on `register`; the mock
 * here does not, so only it needs prompting.
 */
const rerenderApp = (rerender: (ui: React.ReactElement) => void) => {
  rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
  rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
};

describe('App duel orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ids.clear();
    mocks.duelQueue.byChannel = new Map();
    mocks.duelQueue.incomingRematch = null;
    mocks.duelQueue.outgoingRematch = null;
    mocks.duelQueue.commandError = null;
    localStorage.clear();
    (bridge as unknown as { __reset: () => void }).__reset();
  });

  it('derives the badge, opens the selected snapshot, and leaves screen share UI untouched', () => {
    mocks.duelQueue.byChannel = new Map([[7, {
      schemaVersion: 1, channelId: 7, generation: 1, revision: 1, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
      active: { matchId: 1, status: 'starting', startedAt: new Date().toISOString(), players: [], gameType: 'rps', format: 'bo3', rulesetVersion: 1, remaining: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true }, estimatedDuration: unknownEstimate },
      readyCheck: null, queue: [],
    }]]);
    renderApp();
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void }).__emit('voice.connected', { channelId: 7, users: [] }));

    expect(mocks.sidebarProps.current?.duelChannelIds).toEqual(new Set([7]));
    fireEvent.click(screen.getByRole('button', { name: 'Open General duel' }));
    expect(screen.getByRole('dialog', { name: 'Duel activity' })).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-panel')).not.toHaveLength(0);
    expect(mocks.screenShare.stopSharing).not.toHaveBeenCalled();
    expect(mocks.screenShare.disconnectViewer).not.toHaveBeenCalled();
  });

  it('locks a ready submission against dismiss and double click', () => {
    mocks.duelQueue.byChannel = new Map([[7, {
      schemaVersion: 1, channelId: 7, generation: 1, revision: 1, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
      active: null, queue: [], readyCheck: readyCheck({
        players: [player(selfSession), { ...player(22), ready: true }],
      }),
    }]]);
    renderApp();
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void }).__emit('voice.connected', { channelId: 7, users: [{ session: 11, name: 'Me', self: true, channelId: 7 }] }));

    expect(screen.getAllByText('Ready to play?')).toHaveLength(1);
    const ready = screen.getByRole('button', { name: 'Ready' });
    fireEvent.click(ready);
    fireEvent.click(ready);
    expect(mocks.duelQueue.respondReady).toHaveBeenCalledWith(42, true);
    expect(mocks.duelQueue.respondReady).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(mocks.duelQueue.respondReady).not.toHaveBeenCalledWith(42, false);
    expect(screen.getByRole('button', { name: 'Submitting' })).toBeDisabled();
  });

  it('resets the ready lock for a new reservation', () => {
    const readySnapshot = (reservationId: number) => ({
      schemaVersion: 1 as const, channelId: 7, generation: 1, revision: reservationId, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
      active: null, queue: [], readyCheck: readyCheck({ reservationId }),
    });
    mocks.duelQueue.byChannel = new Map([[7, readySnapshot(42)]]);
    const { rerender } = renderApp();
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void }).__emit('voice.connected', { channelId: 7, users: [{ session: 11, name: 'Me', self: true, channelId: 7 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));

    mocks.duelQueue.byChannel = new Map([[7, readySnapshot(43)]]);
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));

    expect(mocks.duelQueue.respondReady).toHaveBeenNthCalledWith(1, 42, true);
    expect(mocks.duelQueue.respondReady).toHaveBeenNthCalledWith(2, 43, true);
  });

  it('unlocks only the matching rejected ready command and permits decline or retry', () => {
    const readySnapshot = (reservationId: number) => ({
      schemaVersion: 1 as const, channelId: 7, generation: 1, revision: reservationId, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
      active: null, queue: [], readyCheck: readyCheck({ reservationId }),
    });
    mocks.duelQueue.byChannel = new Map([[7, readySnapshot(42)]]);
    const { rerender } = renderApp();
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void }).__emit('voice.connected', { channelId: 7, users: [{ session: 11, name: 'Me', self: true, channelId: 7 }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Ready' }));

    mocks.duelQueue.commandError = { revision: 1, operation: 'ready', id: 41 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    expect(screen.getByRole('button', { name: 'Submitting' })).toBeDisabled();

    mocks.duelQueue.commandError = { revision: 2, operation: 'ready', id: 42 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    expect(screen.getByRole('button', { name: 'Ready' })).toBeEnabled();
    const readyNotification = screen.getByText('Ready to play?').closest('.notification') as HTMLElement;
    fireEvent.click(within(readyNotification).getByLabelText('Dismiss notification'));
    expect(mocks.duelQueue.respondReady).toHaveBeenLastCalledWith(42, false);
  });

  it('shows the opponent pair and estimated duration on the ready notification', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({
        gameType: 'deathroll', format: '1v1',
        players: [player(selfSession), player(22)],
        estimatedDuration: knownEstimate(90_000),
      }),
    })]]);
    renderApp();
    connectSelf(7);

    const notification = screen.getByText('Ready to play?').closest('.notification') as HTMLElement;
    expect(notification).toHaveTextContent('Player 11 vs Player 22');
    expect(notification).toHaveTextContent('Estimated duration: ~1m 30s');
  });

  it('shows an unknown estimated duration on the ready notification', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({
        gameType: 'deathroll', format: '1v1',
        players: [player(selfSession), player(22)],
        estimatedDuration: unknownEstimate,
      }),
    })]]);
    renderApp();
    connectSelf(7);

    const notification = screen.getByText('Ready to play?').closest('.notification') as HTMLElement;
    expect(notification).toHaveTextContent('Estimated duration: Unknown');
    expect(notification).not.toHaveTextContent('Starts in');
  });

  it('leaves connect recovery to the duel queue hook and resets both stores on disconnect', () => {
    renderApp();
    act(() => (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.connected', { channelId: 7 }));
    expect(mocks.duelQueue.requestSnapshot).not.toHaveBeenCalled();
    act(() => (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('voice.disconnected'));
    expect(mocks.gameState.reset).toHaveBeenCalledOnce();
    expect(mocks.duelQueue.reset).toHaveBeenCalledOnce();
  });

  it('locks rematch acceptance against dismiss and double click', () => {
    mocks.duelQueue.incomingRematch = {
      offerId: 73,
      sourceMatchId: 91,
      fromSessionId: 22,
      gameType: 'rps',
      expiresAt: new Date(Date.now() + 20_000).toISOString(),
    };
    renderApp();

    expect(mocks.notificationQueue.register).toHaveBeenCalledWith('game-rematch', 'info', 2);
    const accept = screen.getByRole('button', { name: 'Accept' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(mocks.duelQueue.respondOffer).toHaveBeenCalledWith(73, true);
    expect(mocks.duelQueue.respondOffer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(mocks.duelQueue.respondOffer).not.toHaveBeenCalledWith(73, false);
    expect(screen.getByRole('button', { name: 'Submitting' })).toBeDisabled();
  });

  async function flushNotificationFrame() {
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
  }

  it('omits the countdown bar when a rematch offer has no expiry', async () => {
    mocks.duelQueue.incomingRematch = { offerId: 73, sourceMatchId: 91, gameType: 'rps' };
    const { container } = renderApp();
    await flushNotificationFrame();

    const timer = container.querySelector('.notification__timer') as HTMLElement | null;
    expect(screen.getByText('Rematch offered')).toBeInTheDocument();
    expect(timer).toBeNull();
  });

  it('keeps the rematch countdown bar stable across unrelated re-renders', async () => {
    const base = 1_700_000_000_000;
    let now = base;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.duelQueue.incomingRematch = {
      offerId: 73,
      sourceMatchId: 91,
      gameType: 'rps',
      expiresAt: new Date(base + 20_000).toISOString(),
    };
    const { container, rerender } = renderApp();
    await flushNotificationFrame();
    const initial = (container.querySelector('.notification__timer') as HTMLElement).style.animationDuration;

    now = base + 5_000;
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    const after = (container.querySelector('.notification__timer') as HTMLElement).style.animationDuration;

    expect(initial).toBe('20000ms');
    expect(after).toBe(initial);
    nowSpy.mockRestore();
  });

  it('unlocks only the matching rejected rematch response', () => {
    mocks.duelQueue.incomingRematch = { offerId: 73, sourceMatchId: 91, gameType: 'rps' };
    const { rerender } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    mocks.duelQueue.commandError = { revision: 1, operation: 'respondOffer', id: 72 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    expect(screen.getByRole('button', { name: 'Submitting' })).toBeDisabled();

    mocks.duelQueue.commandError = { revision: 2, operation: 'respondOffer', id: 73 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(mocks.duelQueue.respondOffer).toHaveBeenCalledTimes(2);
  });

  it('requests the ended source match and shows pending state in the App modal', () => {
    mocks.gameState.ended = ended;
    mocks.duelQueue.outgoingRematch = { offerId: 8, sourceMatchId: 91, gameType: 'rps' };
    renderApp();

    expect(screen.getByRole('button', { name: 'Rematch pending' })).toBeDisabled();
    mocks.duelQueue.outgoingRematch = null;
    mocks.gameState.ended = null;
  });

  it('locks a rematch request against double click and unlocks on a correlated error', () => {
    mocks.gameState.ended = ended;
    const { rerender } = renderApp();

    const rematch = screen.getByRole('button', { name: 'Rematch' });
    fireEvent.click(rematch);
    fireEvent.click(rematch);
    expect(mocks.duelQueue.requestRematch).toHaveBeenCalledWith(91);
    expect(mocks.duelQueue.requestRematch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Rematch pending' })).toBeDisabled();

    mocks.duelQueue.commandError = { revision: 1, operation: 'requestRematch', id: 90 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    expect(screen.getByRole('button', { name: 'Rematch pending' })).toBeDisabled();

    mocks.duelQueue.commandError = { revision: 2, operation: 'requestRematch', id: 91 };
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(mocks.duelQueue.requestRematch).toHaveBeenCalledTimes(2);
    mocks.gameState.ended = null;
  });

  it('surfaces a rejected duel command as a dismissible error notification', () => {
    mocks.duelQueue.commandError = { revision: 1, operation: 'ready', id: 42, reason: 'stale' };
    renderApp();

    expect(mocks.notificationQueue.register).toHaveBeenCalledWith('game-command-error', 'error');
    expect(screen.getByText('Ready check failed')).toBeInTheDocument();
    expect(screen.getByText('stale')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('Ready check failed')).not.toBeInTheDocument();
  });

  it('marks only channels where the local player is queued or ready as personal', () => {
    mocks.duelQueue.byChannel = new Map<number, DuelQueueSnapshot>([
      [7, snapshot(7, { queue: [queuedEntry([player(selfSession), player(999)])] })],
      [8, snapshot(8, { queue: [queuedEntry([player(998), player(999)])] })],
    ]);
    renderApp();
    connectSelf(7);

    expect(mocks.sidebarProps.current?.duelChannelIds).toEqual(new Set([7, 8]));
    expect(mocks.sidebarProps.current?.personalDuelChannelIds).toEqual(new Set([7]));
  });

  it('marks a channel personal when the local player is in the ready check', () => {
    mocks.duelQueue.byChannel = new Map<number, DuelQueueSnapshot>([[7, snapshot(7, {
      readyCheck: readyCheck({ players: [player(selfSession), player(999)] }),
    })]]);
    renderApp();
    connectSelf(7);

    expect(mocks.sidebarProps.current?.personalDuelChannelIds).toEqual(new Set([7]));
  });

  it('does not mark a channel personal for an active-only local match', () => {
    mocks.duelQueue.byChannel = new Map<number, DuelQueueSnapshot>([[7, snapshot(7, {
      active: {
        matchId: 1, status: 'starting', startedAt: new Date().toISOString(),
        players: [player(selfSession), player(999)],
        gameType: 'rps', format: 'bo3', rulesetVersion: 1,
        remaining: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
        estimatedDuration: unknownEstimate,
      },
    })]]);
    renderApp();
    connectSelf(7);

    expect(mocks.sidebarProps.current?.duelChannelIds).toEqual(new Set([7]));
    expect(mocks.sidebarProps.current?.personalDuelChannelIds).toEqual(new Set());
  });

  it('closes a selected modal when its snapshot is removed', () => {
    const activeSnapshot = {
      schemaVersion: 1 as const, channelId: 7, generation: 1, revision: 1, generatedAt: new Date().toISOString(), calculationTimeMs: 1,
      active: null, readyCheck: null, queue: [{
        reservationId: 2, position: 1, players: [], gameType: 'rps', format: 'bo3', rulesetVersion: 1,
        eta: { status: 'unknown' as const, estimatedStartAt: null, milliseconds: null, approximate: true as const, segments: [] },
        estimatedDuration: unknownEstimate,
      }],
    };
    mocks.duelQueue.byChannel = new Map([[7, activeSnapshot]]);
    const { rerender } = renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Open General duel' }));
    expect(screen.getByRole('dialog', { name: 'Duel activity' })).toBeInTheDocument();

    mocks.duelQueue.byChannel = new Map();
    rerender(<ServiceStatusProvider><App /></ServiceStatusProvider>);
    expect(screen.queryByRole('dialog', { name: 'Duel activity' })).not.toBeInTheDocument();
  });

  it('confirms when your accepted challenge enters the queue', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerenderApp(rerender);

    expect(screen.getByText('Challenge accepted')).toBeInTheDocument();
    expect(screen.getByText('Player 11 vs Player 22')).toBeInTheDocument();
  });

  it('does not confirm when the duel goes straight to a ready check', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      readyCheck: readyCheck({ players: [player(selfSession), player(22)] }),
    })]]);
    rerenderApp(rerender);

    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });

  it('suppresses the queue confirmation when its category is disabled', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);
    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void })
      .__emit('settings.current', { settings: { messages: { notificationDuelQueued: false } } }));

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerenderApp(rerender);

    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });

  it('releases the queue confirmation slot when the category is disabled mid-flight', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerenderApp(rerender);
    expect(mocks.ids.has('game-queued')).toBe(true);

    act(() => (bridge as unknown as { __emit: (event: string, data: unknown) => void })
      .__emit('settings.current', { settings: { messages: { notificationDuelQueued: false } } }));

    // The registration must actually be released, not merely hidden by the render gate:
    // a stale entry would hold one of the three visible slots for the rest of the session.
    expect(mocks.ids.has('game-queued')).toBe(false);
    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });

  it('releases the queue confirmation slot when it is dismissed', () => {
    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {})]]);
    const { rerender } = renderApp();
    connectSelf(7);

    mocks.duelQueue.byChannel = new Map([[7, snapshot(7, {
      queue: [queuedEntry([player(selfSession), player(22)])],
    })]]);
    rerenderApp(rerender);
    expect(mocks.ids.has('game-queued')).toBe(true);

    fireEvent.click(screen.getByLabelText('Dismiss notification'));

    // Dismissing unmounts the notification through the render gate, so `onExited` never
    // runs. Only the registration effect can release the slot; without that the id would
    // hold one of the three visible slots for the rest of the session.
    expect(mocks.ids.has('game-queued')).toBe(false);
    expect(screen.queryByText('Challenge accepted')).toBeNull();
  });
});
