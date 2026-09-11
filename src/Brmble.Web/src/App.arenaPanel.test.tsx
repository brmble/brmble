import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArenaStateSnapshot } from './components/Games/Arena/arenaProtocol';

const realtime = vi.hoisted(() => ({
  requestRealtimeTicket: vi.fn(),
  getQueueSnapshot: vi.fn(),
  subscribeSpectator: vi.fn(),
  unsubscribeSpectator: vi.fn(),
  sockets: [] as FakeSocket[],
}));

vi.mock('./api/games', async importOriginal => {
  const actual = await importOriginal<typeof import('./api/games')>();
  return {
    ...actual,
    requestRealtimeTicket: realtime.requestRealtimeTicket,
    getQueueSnapshot: realtime.getQueueSnapshot,
    subscribeSpectator: realtime.subscribeSpectator,
    unsubscribeSpectator: realtime.unsubscribeSpectator,
  };
});

import { emitBridgeEvent, renderConnectedApp, resetAppHarness } from './testing/appHarness';

class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  readyState = FakeSocket.OPEN;
  close = vi.fn(() => { this.readyState = FakeSocket.CLOSING; });
  send = vi.fn();
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    realtime.sockets.push(this);
  }

  serverMessage(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  serverClosed() {
    this.readyState = FakeSocket.CLOSING;
    this.onclose?.();
  }
}

const finalState: ArenaStateSnapshot = {
  phase: 'ended',
  phaseEndsAtTick: null,
  score: [2, 1],
  consecutiveDoubleKos: 0,
  arena: { radius: 7000, shrinkPhase: 'collapse' },
  projectiles: [],
  players: [
    { sessionId: 1, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0 },
    { sessionId: 20, side: 1, x: 1000, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0 },
  ],
};

function startArena() {
  act(() => {
    emitBridgeEvent('game.started', {
      matchId: 91,
      gameType: 'arena-knockoff',
      players: [1, 20],
    });
  });
}

const matchClosed = () => ({
  type: 'matchClosed', protocolVersion: 1, matchId: 91,
  sequence: 9, serverTick: 600, reason: 'completed', finalState,
});

const leanEnded = () => ({
  matchId: 91, gameType: 'arena-knockoff', winnerId: 1,
});

const arenaQueueSnapshot = () => ({
  schemaVersion: 1, channelId: 7, generation: 1, revision: 1,
  generatedAt: '2026-08-28T12:00:00.000Z', calculationTimeMs: 1,
  active: {
    matchId: 92, status: 'live', startedAt: '2026-08-28T12:00:00.000Z',
    players: [
      { userId: 300, sessionId: 30, displayName: 'Watcher A', ready: false },
      { userId: 400, sessionId: 40, displayName: 'Watcher B', ready: false },
    ],
    gameType: 'arena-knockoff', format: '1v1', rulesetVersion: 1,
    remaining: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
    estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
  },
  readyCheck: null, queue: [],
});

async function mountedArena() {
  startArena();
  await screen.findByTestId('arena-board');
  await waitFor(() => expect(realtime.sockets).toHaveLength(1));
  return realtime.sockets[0];
}

describe('App arena main-panel integration', () => {
  beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    localStorage.clear();
    realtime.sockets = [];
    realtime.requestRealtimeTicket.mockResolvedValue({
      ticket: 'arena-ticket',
      url: 'wss://voice.example.com/games/realtime',
      expiresAt: '2026-08-28T12:00:00.000Z',
    });
    realtime.getQueueSnapshot.mockResolvedValue(arenaQueueSnapshot());
    realtime.subscribeSpectator.mockResolvedValue({
      channelId: 7,
      match: {
        schemaVersion: 1, matchId: 92, channelId: 7, gameType: 'arena-knockoff',
        format: '1v1', rulesetVersion: 1, sequence: 1, generatedAt: '2026-08-28T12:00:00.000Z',
        players: [
          { userId: 300, sessionId: 30, displayName: 'Watcher A', ready: false },
          { userId: 400, sessionId: 40, displayName: 'Watcher B', ready: false },
        ],
        view: { kind: 'deathroll', players: [30, 40], currentPlayer: 30, ceiling: 100, lastRoll: null, lastRollBy: null, finished: false, loserId: null },
      },
    });
    realtime.unsubscribeSpectator.mockResolvedValue(undefined);
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => {
    cleanup();
    resetAppHarness();
    vi.clearAllMocks();
  });

  it('enters game mode and renders ArenaBoard when an arena match starts', async () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }],
      users: [{ session: 1, name: 'Me', self: true, channelId: 7 }, { session: 20, name: 'Rival', channelId: 7 }],
    });

    startArena();

    expect(await screen.findByTestId('arena-board')).toBeInTheDocument();
    expect(document.querySelector('[data-main-panel-layer="game"]')).not.toBeNull();
    expect(document.querySelector('[data-main-panel-layer="split"]')).toHaveClass('main-panel__split--hidden');
  });

  it.each(['event-first', 'socket-first'] as const)(
    'keeps final realtime state until Close when %s',
    async order => {
    const user = userEvent.setup();
    const view = renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    const composer = screen.getByPlaceholderText('Message #General') as HTMLTextAreaElement;
    await user.type(composer, 'half a message');
    const messages = view.container.querySelector('.chat-messages') as HTMLDivElement;
    messages.scrollTop = 73;

    const socket = await mountedArena();

    const split = document.querySelector('[data-main-panel-layer="split"]')!;
    expect(split).toBeInTheDocument();
    expect(split).toHaveAttribute('inert');
    expect(messages.scrollTop).toBe(73);

    if (order === 'event-first') {
      act(() => { emitBridgeEvent('game.ended', leanEnded()); });
      expect(socket.close).not.toHaveBeenCalled();
      expect(screen.getByTestId('arena-board')).toBeInTheDocument();
      // The duel event names the winner, so the outcome is known before the
      // arena socket delivers the final board.
      expect(screen.getByText('Match complete')).toBeInTheDocument();
      expect(screen.getByTestId('arena-live-region')).not.toHaveTextContent('Outcome: Draw');
      // Close must never be blocked on the socket: a socket that closes without
      // matchClosed used to strand the board here permanently.
      expect(within(screen.getByTestId('arena-board')).getByRole('button', { name: 'Close' })).toBeEnabled();
      act(() => { socket.serverMessage(matchClosed()); });
    } else {
      act(() => { socket.serverMessage(matchClosed()); });
      expect(screen.getByTestId('arena-score')).toHaveTextContent('2 – 1');
      act(() => { emitBridgeEvent('game.ended', leanEnded()); });
    }

    act(() => { socket.serverClosed(); });
    expect(screen.getByText('Match complete')).toBeInTheDocument();
    expect(screen.getByTestId('arena-score')).toHaveTextContent('2 – 1');
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Me, side 1');
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Player 20, side 2');
    expect(socket.close).not.toHaveBeenCalled();
    const close = within(screen.getByTestId('arena-board')).getByRole('button', { name: 'Close' });
    expect(close).toBeEnabled();
    fireEvent.click(close);

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(composer.value).toBe('half a message');
    expect(messages.scrollTop).toBe(73);
  });

  it('keeps a watched Arena match in split mode with an unsupported spectator notice', async () => {
    const user = userEvent.setup();
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });

    await screen.findByRole('button', { name: 'Watch games in General' });
    await user.click(screen.getByRole('button', { name: 'Watch games in General' }));
    await screen.findByTestId('spectator-unsupported-game');

    expect(document.querySelector('[data-main-panel-layer="game"]')).toBeNull();
    expect(screen.queryByTestId('arena-board')).toBeNull();
    expect(document.querySelector('[data-main-panel-layer="split"]')).not.toHaveAttribute('inert');
    expect(screen.getByTestId('spectator-unsupported-game')).toHaveTextContent('arena-knockoff');
  });

  it('keeps the authoritative outcome and Close when the socket never delivers the final board', async () => {
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    const socket = await mountedArena();
    act(() => { emitBridgeEvent('game.ended', leanEnded()); });
    // leanEnded names session 1 — the local player — as the winner.
    expect(screen.getByText('Match complete')).toBeInTheDocument();
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Outcome: Victory.');

    vi.useFakeTimers();
    try {
      act(() => { socket.onerror?.(); });
      await act(() => vi.advanceTimersByTimeAsync(5000));

      // Losing the socket costs the final board, never the result.
      expect(screen.getByText('Match complete')).toBeInTheDocument();
      expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Final match state unavailable.');
      expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Outcome: Victory.');
      expect(screen.getByTestId('arena-live-region')).not.toHaveTextContent('Outcome unavailable.');
      const close = within(screen.getByTestId('arena-board')).getByRole('button', { name: 'Close' });
      expect(close).toBeEnabled();
      fireEvent.click(close);
      expect(screen.queryByTestId('arena-board')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the arena connection once when the participant leaves the channel', async () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Other' }],
    });
    const socket = await mountedArena();

    act(() => {
      emitBridgeEvent('voice.channelChanged', { previousChannelId: 7, channelId: 9, name: 'Other' });
    });

    expect(screen.queryByRole('heading', { name: 'Arena Knockoff' })).toBeNull();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('closes the arena connection once on voice disconnect', async () => {
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    const socket = await mountedArena();

    act(() => { emitBridgeEvent('voice.disconnected', {}); });

    expect(screen.queryByTestId('arena-board')).toBeNull();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('closes the arena connection once when App unmounts', async () => {
    const view = renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    const socket = await mountedArena();

    view.unmount();

    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
