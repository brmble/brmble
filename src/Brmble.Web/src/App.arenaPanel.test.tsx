import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ArenaStateSnapshot } from './components/Games/Arena/arenaProtocol';

const realtime = vi.hoisted(() => ({
  requestRealtimeTicket: vi.fn(),
  sockets: [] as FakeSocket[],
}));

vi.mock('./api/games', async importOriginal => {
  const actual = await importOriginal<typeof import('./api/games')>();
  return { ...actual, requestRealtimeTicket: realtime.requestRealtimeTicket };
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
}

const finalState: ArenaStateSnapshot = {
  phase: 'ended',
  phaseEndsAtTick: null,
  score: [2, 1],
  consecutiveDoubleKos: 0,
  arena: { radius: 7000, shrinkPhase: 'collapse' },
  projectiles: [],
  players: [
    { sessionId: 1, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
    { sessionId: 20, side: 1, x: 1000, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
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

  it('keeps the split draft and scroll position mounted for the whole match', async () => {
    const user = userEvent.setup();
    const view = renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });
    const composer = screen.getByPlaceholderText('Message #General') as HTMLTextAreaElement;
    await user.type(composer, 'half a message');
    const messages = view.container.querySelector('.chat-messages') as HTMLDivElement;
    messages.scrollTop = 73;

    startArena();
    await screen.findByRole('heading', { name: 'Arena Knockoff' });

    const split = document.querySelector('[data-main-panel-layer="split"]')!;
    expect(split).toBeInTheDocument();
    expect(split).toHaveAttribute('inert');
    expect(messages.scrollTop).toBe(73);

    act(() => {
      emitBridgeEvent('game.ended', {
        type: 'matchClosed', protocolVersion: 1, matchId: 91, gameType: 'arena-knockoff',
        sequence: 9, serverTick: 600, reason: 'completed', finalState,
      });
    });
    expect(screen.getByText('Match complete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close arena' }));

    expect(composer.value).toBe('half a message');
    expect(messages.scrollTop).toBe(73);
  });

  it('does not enter game mode for arena activity the local user is not playing', () => {
    renderConnectedApp({ joinedChannelId: '7', channels: [{ id: 7, name: 'General' }] });

    act(() => {
      emitBridgeEvent('game.queueSnapshot', {
        channelId: 7,
        active: { matchId: 91, gameType: 'arena-knockoff', players: [30, 40] },
      });
    });

    expect(document.querySelector('[data-main-panel-layer="game"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Arena Knockoff' })).toBeNull();
    expect(document.querySelector('[data-main-panel-layer="split"]')).not.toHaveAttribute('inert');
  });

  it('closes the arena connection once when the participant leaves the channel', async () => {
    renderConnectedApp({
      joinedChannelId: '7',
      channels: [{ id: 7, name: 'General' }, { id: 9, name: 'Other' }],
    });
    startArena();
    await screen.findByRole('heading', { name: 'Arena Knockoff' });
    await waitFor(() => expect(realtime.sockets).toHaveLength(1));

    act(() => {
      emitBridgeEvent('voice.channelChanged', { previousChannelId: 7, channelId: 9, name: 'Other' });
    });

    expect(screen.queryByRole('heading', { name: 'Arena Knockoff' })).toBeNull();
    expect(realtime.sockets[0].close).toHaveBeenCalledTimes(1);
  });
});
