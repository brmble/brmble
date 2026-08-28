import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaConnection } from './useArenaConnection';
import type { ArenaPlayerSnapshot, ArenaSnapshot, ArenaWelcome } from './arenaProtocol';
import { ArenaBoard } from './ArenaBoard';
import { GameSurface } from '../GameSurface';

const connection = vi.hoisted(() => ({ current: {} as ArenaConnection }));
const state = vi.hoisted(() => ({
  current: {} as ReturnType<typeof import('./useArenaState').useArenaState>, useReal: false,
}));

vi.mock('./useArenaConnection', () => ({ useArenaConnection: () => connection.current }));
vi.mock('./useArenaState', async importOriginal => {
  const original = await importOriginal<typeof import('./useArenaState')>();
  return { useArenaState: (options: Parameters<typeof original.useArenaState>[0]) =>
    state.useReal ? original.useArenaState(options) : state.current };
});

function player(sessionId: number, side: 0 | 1, overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot {
  return {
    sessionId, side, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 640, forcedFireTicks: 18, cooldownTicks: 12,
    dashAvailable: false, acknowledgedInput: 0, ...overrides,
  };
}

function props(overrides: Partial<React.ComponentProps<typeof ArenaBoard>> = {}) {
  return {
    matchId: 91, selfSessionId: 10,
    resolveName: (id: number) => id === 10 ? 'Local' : 'Remote',
    resolveAvatarUrl: () => null, onForfeit: vi.fn(), onClose: vi.fn(), ended: null,
    ...overrides,
  };
}

describe('ArenaBoard', () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    state.useReal = false;
    connection.current = {
      status: 'connected', welcome: { serverTick: 100, tickRate: 60 } as ArenaConnection['welcome'],
      latestSnapshot: null, closed: null, pendingInputs: [], recentInputs: [], pendingInputCount: 0,
      currentInput: { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
      sendInput: vi.fn(), sendHeartbeat: vi.fn(),
    };
    state.current = {
      localPlayer: player(10, 0), remotePlayer: player(20, 1, { chargePermille: 0, forcedFireTicks: null }),
      projectiles: [{ id: 1, ownerSessionId: 20, x: 0, y: 0, vx: 1, vy: 0, chargePermille: 0 }],
      arena: { radius: 7600, shrinkPhase: 'collapse' }, phase: 'live', phaseEndsAtTick: 160,
      score: [1, 0], consecutiveDoubleKos: 0, snapCount: 0,
    };
    connection.current.welcome = {
      serverTick: 100, tickRate: 60,
      state: {
        phase: state.current.phase!, phaseEndsAtTick: state.current.phaseEndsAtTick,
        score: state.current.score, consecutiveDoubleKos: state.current.consecutiveDoubleKos,
        arena: state.current.arena!, projectiles: state.current.projectiles,
        players: [state.current.localPlayer!, state.current.remotePlayer!],
      },
    } as ArenaConnection['welcome'];
  });

  it('exposes the stable HUD and every canvas gameplay datum as DOM text', () => {
    render(<ArenaBoard {...props()} />);
    expect(screen.getByTestId('arena-score')).toHaveTextContent('1 – 0');
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /audio/i })).toHaveAttribute('aria-disabled', 'true');
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Live.*1 second/i);
    expect(live).toHaveTextContent(/Local.*side 1.*aim east.*charge 50 to 74 percent.*forced fire in 18 ticks/i);
    expect(live).toHaveTextContent(/Remote.*side 2.*aim east/i);
    expect(live).toHaveTextContent(/1 projectile.*side 2/i);
    expect(live).toHaveTextContent(/radius 7500 to 7999.*collapse/i);
    expect(live).toHaveTextContent(/cooldown.*7 to 12 ticks.*dash used/i);
  });

  it('keeps the live region polite and ignores frame-position-only changes', () => {
    const { rerender } = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveAttribute('aria-live', 'polite');
    const first = live.textContent;
    state.current = { ...state.current, localPlayer: { ...state.current.localPlayer!, x: 40 } };
    rerender(<ArenaBoard {...props()} />);
    expect(live.textContent).toBe(first);
  });

  it('keeps announcements stable across interpolated RAF changes within semantic bands', () => {
    const { rerender } = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    const first = live.textContent;
    state.current = {
      ...state.current,
      arena: { radius: 7590, shrinkPhase: 'collapse' },
      localPlayer: { ...state.current.localPlayer!, x: 400, aimX: 32000, aimY: 100, chargePermille: 700 },
      remotePlayer: { ...state.current.remotePlayer!, x: -400 },
    };
    rerender(<ArenaBoard {...props()} />);
    expect(live.textContent).toBe(first);
  });

  it('renders terminal final state through the real state hook without adding an unplayed round', () => {
    state.useReal = true;
    connection.current = { ...connection.current, welcome: null, latestSnapshot: null, status: 'closed' };
    const finalState = {
      phase: 'ended' as const, phaseEndsAtTick: null, score: [2, 1] as [number, number], consecutiveDoubleKos: 0,
      arena: { radius: 7100, shrinkPhase: 'collapse' as const }, projectiles: [],
      players: [player(10, 0, { cooldownTicks: 0 }), player(20, 1)],
    };
    const ended = { type: 'matchClosed' as const, protocolVersion: 1 as const, matchId: 91, sequence: 4,
      serverTick: 200, reason: 'completed' as const, finalState };
    render(<ArenaBoard {...props({ ended })} />);
    expect(screen.getByText('Round 3')).toBeInTheDocument();
    expect(screen.getByTestId('arena-score')).toHaveTextContent('2 – 1');
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Local.*radius 7000 to 7499/i);
    expect(live).toHaveTextContent(/Outcome: Victory/i);
  });

  it('keeps authoritative announcements stable while the real state hook interpolates visual frames', () => {
    state.useReal = true;
    const prediction = {
      unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
      momentumRetentionPermille: 920, chargeTicks: 90, forcedFireTicks: 30, shotCooldownTicks: 24,
      projectileRadius: 180, projectilePerTick: 240, projectileBaseKnockback: 130,
      projectileBonusKnockback: 220, recoilBase: 45, recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
    } as const;
    const welcomeState = {
      phase: 'live' as const, phaseEndsAtTick: 160, score: [1, 0] as [number, number], consecutiveDoubleKos: 0,
      arena: { radius: 7600, shrinkPhase: 'collapse' as const }, projectiles: [],
      players: [player(10, 0), player(20, 1, { chargePermille: 0, forcedFireTicks: null })],
    };
    const welcome: ArenaWelcome = {
      type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91, role: 'participant', sessionId: 10,
      snapshotSequence: 1, serverTick: 100, tickRate: 60, snapshotRate: 20, interpolationMs: 100,
      maxExtrapolationMs: 50, inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
      prediction, state: welcomeState, acknowledgedInput: 0,
    };
    connection.current = { ...connection.current, welcome, latestSnapshot: null };
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    const first = live.textContent;
    const latestSnapshot: ArenaSnapshot = {
      type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 2, serverTick: 101,
      generatedAtUnixMs: Date.now(), ...welcomeState, arena: { radius: 7590, shrinkPhase: 'collapse' },
      players: welcomeState.players.map(candidate => candidate.sessionId === 10
        ? { ...candidate, x: 400, aimX: 32000, aimY: 100, chargePermille: 700 }
        : { ...candidate, x: -400 }),
    };
    connection.current = { ...connection.current, latestSnapshot };
    rendered.rerender(<ArenaBoard {...props()} />);
    act(() => {
      for (const callback of [...frames]) callback(performance.now());
    });
    expect(live.textContent).toBe(first);
  });

  it('makes the audio placeholder keyboard reachable and exposes its exact explanation', async () => {
    render(<ArenaBoard {...props()} />);
    const audio = screen.getByRole('button', { name: /audio/i });
    audio.focus();
    fireEvent.focus(audio);
    expect(audio).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Arena audio arrives in a later release');
    fireEvent.click(audio);
    expect(audio).toHaveAttribute('aria-disabled', 'true');
  });

  it('opts into a filling game surface without changing the default', () => {
    const filled = render(<GameSurface fill><ArenaBoard {...props()} /></GameSurface>);
    expect(filled.container.querySelector('.game-surface')).toHaveClass('game-surface--fill');
    filled.unmount();
    const centered = render(<GameSurface><div /></GameSurface>);
    expect(centered.container.querySelector('.game-surface')).not.toHaveClass('game-surface--fill');
  });

  it('uses the shared shell and selects forfeit while live or close after ending', () => {
    const liveProps = props();
    const rendered = render(<ArenaBoard {...liveProps} />);
    expect(document.querySelector('.glass-panel.animate-slide-up')).not.toBeNull();
    expect(document.querySelector('h2.heading-title.modal-title')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /forfeit/i }));
    expect(liveProps.onForfeit).toHaveBeenCalledOnce();
    rendered.unmount();
    const endedProps = props({ ended: { reason: 'completed', finalState: { ...state.current, players: [] } } as never });
    render(<ArenaBoard {...endedProps} />);
    fireEvent.click(screen.getByRole('button', { name: /close arena/i }));
    expect(endedProps.onClose).toHaveBeenCalledOnce();
  });
});
