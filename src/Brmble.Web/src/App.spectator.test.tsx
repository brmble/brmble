/**
 * Integration coverage for spectating as a channel activity.
 *
 * Everything on the spectate path runs for real here — `useSpectatorState`,
 * `SpectatorActivity`, the spectator boards, `DuelQueueModal`,
 * `ChannelActivityRegion`, `MainPanel` and the `App` wiring under test. Only two
 * things are faked: the spectator transport (`api/games`' subscribe/unsubscribe,
 * which would otherwise `fetch`) and `useDuelQueueState`, whose snapshot recovery
 * handshake is not what these tests are about. Frames arrive over the harness
 * bridge exactly as the server sends them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  DurationEstimate,
  SpectatorMatchEndedEvent,
  SpectatorSnapshot,
  SpectatorSubscribeResponse,
} from './api/games';
import type { DuelQueueSnapshot } from './components/Games/useDuelQueueState';

const mocks = vi.hoisted(() => ({
  duelQueue: {
    byChannel: new Map<number, DuelQueueSnapshot>(),
    incomingRematch: null,
    outgoingRematch: null,
    commandError: null,
    respondReady: vi.fn(),
    requestRematch: vi.fn(),
    respondOffer: vi.fn(),
    cancelOffer: vi.fn(),
    requestSnapshot: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
  },
  subscribeSpectator: vi.fn(),
  unsubscribeSpectator: vi.fn(),
}));

vi.mock('./components/Games/useDuelQueueState', () => ({
  useDuelQueueState: () => mocks.duelQueue,
}));

vi.mock('./api/games', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/games')>();
  return {
    ...actual,
    subscribeSpectator: mocks.subscribeSpectator,
    unsubscribeSpectator: mocks.unsubscribeSpectator,
  };
});

import {
  emitBridgeEvent,
  renderConnectedApp,
  resetAppHarness,
} from './testing/appHarness';

const CHANNEL = 7;
/** Mumble session of the local user in the harness. */
const SELF = 1;

const unknownEstimate: DurationEstimate = {
  status: 'unknown', milliseconds: null, sampleCount: 0,
  method: 'insufficient', approximate: true,
};

const duelPlayer = (sessionId: number) =>
  ({ userId: sessionId * 100, sessionId, displayName: `Player ${sessionId}`, ready: false });

/** A channel snapshot with a live duel, which is what lights the sidebar swords badge. */
function activeDuelSnapshot(channelId: number): DuelQueueSnapshot {
  return {
    schemaVersion: 1, channelId, generation: 1, revision: 1,
    generatedAt: new Date().toISOString(), calculationTimeMs: 1,
    active: {
      matchId: 91, status: 'live', startedAt: new Date().toISOString(),
      players: [duelPlayer(20), duelPlayer(21)],
      gameType: 'deathroll', format: 'bo1', rulesetVersion: 1,
      remaining: unknownEstimate, estimatedDuration: unknownEstimate,
    },
    readyCheck: null, queue: [],
  };
}

/** A channel snapshot with nobody playing but a pair waiting: the Idle card's input. */
function queuedOnlySnapshot(channelId: number): DuelQueueSnapshot {
  return {
    schemaVersion: 1, channelId, generation: 1, revision: 1,
    generatedAt: new Date().toISOString(), calculationTimeMs: 1,
    active: null, readyCheck: null,
    queue: [{
      reservationId: 5, position: 1, players: [duelPlayer(30), duelPlayer(31)],
      gameType: 'deathroll', format: 'bo1', rulesetVersion: 1,
      eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
      estimatedDuration: unknownEstimate,
    }],
  };
}

function deathrollFrame(sequence: number, parts: Partial<SpectatorSnapshot> = {}): SpectatorSnapshot {
  return {
    schemaVersion: 1, matchId: 91, channelId: CHANNEL, gameType: 'deathroll',
    format: 'bo1', rulesetVersion: 1,
    players: [duelPlayer(20), duelPlayer(21)],
    sequence, generatedAt: new Date().toISOString(),
    view: {
      kind: 'deathroll', players: [20, 21], currentPlayer: 21,
      ceiling: 500, lastRoll: 500, finished: false, loserId: null,
    },
    ...parts,
  };
}

const matchEnded = (): SpectatorMatchEndedEvent => ({
  schemaVersion: 1, matchId: 91, channelId: CHANNEL, reason: 'completed', finalSequence: 9,
  outcome: { winnerId: 20, loserId: 21, draw: false },
});

const subscribed = (match: SpectatorSnapshot | null = null): SpectatorSubscribeResponse =>
  ({ channelId: CHANNEL, match });

function renderInChannel(options: Parameters<typeof renderConnectedApp>[0] = {}) {
  return renderConnectedApp({
    joinedChannelId: String(CHANNEL),
    channels: [{ id: CHANNEL, name: 'General' }],
    users: [{ session: SELF, name: 'Me', self: true, channelId: CHANNEL }],
    ...options,
  });
}

/** Opens the swords badge and clicks Watch. */
async function watchDuel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: `Open duel activity for General` }));
  await user.click(screen.getByRole('button', { name: 'Watch' }));
}

const gameChip = () => screen.queryByRole('tab', { name: 'Game' });
const splitLayer = () => document.querySelector('[data-main-panel-layer="split"]');

describe('App — spectating as a channel activity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetAppHarness();
    mocks.duelQueue.byChannel = new Map();
    mocks.subscribeSpectator.mockResolvedValue(subscribed());
    mocks.unsubscribeSpectator.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('offers no Game chip and no activity region until the user opts in', () => {
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    renderInChannel();

    expect(gameChip()).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
    expect(mocks.subscribeSpectator).not.toHaveBeenCalled();
  });

  it('Watch subscribes to the channel, closes the modal, and stages the Game chip', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);

    expect(mocks.subscribeSpectator).toHaveBeenCalledWith(CHANNEL);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Duel activity' })).not.toBeInTheDocument();
    // Explicit click always wins: the stage is the one just opted into.
    expect(gameChip()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Spectating' })).toBeInTheDocument();
    expect(screen.getByTestId('spectator-player-20')).toBeInTheDocument();
  });

  it('subscribes to an idle channel and shows what is next up', async () => {
    const user = userEvent.setup();
    // The badge and the Watch button need a live duel; the server answers the
    // subscribe with `match: null` because that duel finished in between.
    mocks.duelQueue.byChannel = new Map([[CHANNEL, {
      ...activeDuelSnapshot(CHANNEL), queue: queuedOnlySnapshot(CHANNEL).queue,
    }]]);
    const { rerenderApp } = renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    // The queue feed still claims a live match we have no frame for, so the card
    // must not name the pair queued BEHIND that match as "Next up".
    expect(screen.getByTestId('spectator-next-up').textContent)
      .toBe('Waiting for the next match');

    // The queue feed catches up: the match is over and the queued pair is next.
    mocks.duelQueue.byChannel = new Map([[CHANNEL, queuedOnlySnapshot(CHANNEL)]]);
    act(() => { rerenderApp(); });

    const nextUp = screen.getByTestId('spectator-next-up');
    expect(within(nextUp).getByText('Next up')).toBeInTheDocument();
    expect(nextUp.textContent).toContain('Player 30');
  });

  it('labels the chip Game, and appends it last so existing chip order is untouched', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    renderInChannel({
      watchedShares: [{ roomName: 'channel-7', userId: 10, userName: 'User 10' }],
      paintSessionId: 'paint-1',
    });

    await watchDuel(user);

    await waitFor(() => expect(gameChip()).toBeInTheDocument());
    const chips = screen.getByRole('tablist', { name: 'Channel activities' });
    expect(within(chips).getAllByRole('tab').map(tab => tab.textContent))
      .toEqual(['Screen share', 'Paint', 'Game']);
    expect(screen.queryByRole('tab', { name: 'Spectate' })).not.toBeInTheDocument();
  });

  it('keeps the chip and the result when the watched match ends', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    act(() => { emitBridgeEvent('game.spectatorMatchEnded', matchEnded()); });

    expect(gameChip()).toBeInTheDocument();
    expect(screen.getByText('Player 20 wins!')).toBeInTheDocument();
    expect(mocks.unsubscribeSpectator).not.toHaveBeenCalled();
  });

  it('keeps taking live frames off the bridge while staged', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    act(() => {
      emitBridgeEvent('game.spectatorSnapshot', deathrollFrame(2, {
        view: {
          kind: 'deathroll', players: [20, 21], currentPlayer: 20,
          ceiling: 37, lastRoll: 42, finished: false, loserId: null,
        },
      }));
    });

    const board = screen.getByRole('region', { name: 'Spectating' });
    expect(within(board).getByText('37')).toBeInTheDocument();
    expect(within(board).getByText('42')).toBeInTheDocument();
    // The turn moved with the frame.
    expect(screen.getByTestId('spectator-player-20')).toHaveAttribute('data-current', 'true');
  });

  it('Stop watching unsubscribes, drops the chip and collapses the region', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Stop watching' }));

    expect(mocks.unsubscribeSpectator).toHaveBeenCalledTimes(1);
    expect(gameChip()).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });

  it('leaves the subscription alive with the chip lit when another activity takes the stage', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    renderInChannel({ paintSessionId: 'paint-1' });

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: 'Paint' }));

    expect(screen.getByRole('tab', { name: 'Paint' })).toHaveAttribute('aria-selected', 'true');
    expect(gameChip()).toBeInTheDocument();
    expect(gameChip()).toHaveAttribute('aria-selected', 'false');
    expect(mocks.unsubscribeSpectator).not.toHaveBeenCalled();
  });

  it('never hands the main panel to game mode', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    // Game mode is entered by PARTICIPATING. A spectator keeps the split layer live.
    expect(splitLayer()).not.toHaveAttribute('inert');
    expect(document.querySelector('[data-main-panel-layer="game"]')).toBeNull();
  });

  it('surfaces a rejected subscribe and leaves no chip behind', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    const { GameApiError } = await import('./api/games');
    mocks.subscribeSpectator.mockRejectedValue(
      new GameApiError('You are not in that channel.', 'notSameChannel'),
    );
    renderInChannel();

    await watchDuel(user);

    await waitFor(() => expect(screen.getByText('Cannot watch this channel')).toBeInTheDocument());
    expect(screen.getByText('You can only watch a game in the channel you have joined.'))
      .toBeInTheDocument();
    expect(gameChip()).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });

  it('drops the chip when the server closes the subscription', async () => {
    const user = userEvent.setup();
    mocks.duelQueue.byChannel = new Map([[CHANNEL, activeDuelSnapshot(CHANNEL)]]);
    mocks.subscribeSpectator.mockResolvedValue(subscribed(deathrollFrame(1)));
    renderInChannel();

    await watchDuel(user);
    await waitFor(() => expect(gameChip()).toBeInTheDocument());

    act(() => {
      emitBridgeEvent('game.spectatorClosed', { channelId: CHANNEL, reason: 'authorizationLost' });
    });

    expect(gameChip()).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });
});
