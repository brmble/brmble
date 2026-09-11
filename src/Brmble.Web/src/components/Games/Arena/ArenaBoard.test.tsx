import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaConnection } from './useArenaConnection';
import type { ArenaPlayerSnapshot, ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome } from './arenaProtocol';
import type { EndedMatch } from '../useGameState';
import { ArenaBoard } from './ArenaBoard';
import { ArenaRenderer, type ArenaRenderView } from './ArenaRenderer';
import { GameSurface } from '../GameSurface';
import bridge from '../../../bridge';
import { createServerClock } from './serverClock';

const connection = vi.hoisted(() => ({ current: {} as ArenaConnection }));
const state = vi.hoisted(() => ({
  current: {} as ReturnType<typeof import('./useArenaState').useArenaState>, useReal: false,
}));

vi.mock('./useArenaConnection', () => ({ useArenaConnection: () => connection.current }));
vi.mock('../../../bridge', () => ({ default: { send: vi.fn() } }));
vi.mock('./useArenaState', async importOriginal => {
  const original = await importOriginal<typeof import('./useArenaState')>();
  return { useArenaState: (options: Parameters<typeof original.useArenaState>[0]) =>
    state.useReal ? original.useArenaState(options) : state.current };
});

function player(sessionId: number, side: 0 | 1, overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot {
  return {
    sessionId, side, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 640, forcedFireTicks: 18, cooldownTicks: 12,
    dashAvailable: false, dashTicksRemaining: 0, acknowledgedInput: 0, ...overrides,
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
    vi.clearAllMocks();
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
      latestSnapshot: null, closed: null, pendingInputs: [], pendingInputCount: 0,
      serverClock: createServerClock(),
      currentInput: { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
      sendInput: vi.fn(), sendHeartbeat: vi.fn(),
    };
    state.current = {
      localPlayer: player(10, 0), remotePlayer: player(20, 1, { chargePermille: 0, forcedFireTicks: null }),
      projectiles: [{ id: 1, ownerSessionId: 20, x: 0, y: 0, vx: 1, vy: 0, chargePermille: 0 }],
      arena: { radius: 7600, shrinkPhase: 'collapse' }, phase: 'live', phaseEndsAtTick: 160,
      score: [1, 0], consecutiveDoubleKos: 0, snapCount: 0, knockout: [],
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
    expect(screen.getByText('Round 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /audio/i })).toHaveAttribute('aria-disabled', 'true');
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Live.*1 second/i);
    expect(live).toHaveTextContent(/Local.*side 1.*aim east.*charge 50 to 74 percent.*forced fire armed/i);
    expect(live).toHaveTextContent(/Remote.*side 2.*aim east/i);
    expect(live).toHaveTextContent(/1 projectile.*side 2/i);
    expect(live).toHaveTextContent(/radius 7500 to 7999.*collapse/i);
    expect(live).toHaveTextContent(/shot cooling down.*dash used/i);
  });

  it('allows closing without fabricating an outcome when neither source reports one', () => {
    const onClose = vi.fn();
    connection.current = {
      ...connection.current,
      status: 'failed',
      welcome: null,
      latestSnapshot: null,
      closed: null,
    };

    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff' },
      onClose,
    })} />);

    expect(screen.getByText('Match ended')).toBeInTheDocument();
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Final match state unavailable.');
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Outcome unavailable.');
    expect(screen.getByTestId('arena-live-region')).not.toHaveTextContent('Outcome: Draw');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('states the authoritative outcome even when the final board never arrives', () => {
    // The outcome rides the duel event bridge, not the arena socket, so a dead
    // socket must not stop us naming the winner.
    connection.current = {
      ...connection.current, status: 'failed', welcome: null, latestSnapshot: null, closed: null,
    };

    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 10 },
    })} />);

    expect(screen.getByText('Match complete')).toBeInTheDocument();
    expect(screen.queryByText('Finalization failed')).toBeNull();
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Outcome: Victory.');
  });

  it('names a defeat from the authoritative winner rather than the local score', () => {
    connection.current = {
      ...connection.current, status: 'failed', welcome: null, latestSnapshot: null, closed: null,
    };

    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 20 },
    })} />);

    expect(screen.getByTestId('arena-live-region')).toHaveTextContent('Outcome: Defeat.');
  });

  it('never leaves close disabled once the match has ended', () => {
    // A socket that closes cleanly without matchClosed used to strand the board
    // on 'Finalizing match' with the close button permanently disabled.
    const onClose = vi.fn();
    connection.current = {
      ...connection.current, status: 'closed', welcome: null, latestSnapshot: null, closed: null,
    };

    render(<ArenaBoard {...props({
      onClose,
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 10 },
    })} />);

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).not.toBeDisabled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('claims no outcome when the socket closes before the duel bridge reports', () => {
    const onClose = vi.fn();
    const onForfeit = vi.fn();
    connection.current = {
      ...connection.current, status: 'closed', welcome: null, latestSnapshot: null,
      closed: { reason: 'completed', serverTick: 400 } as ArenaConnection['closed'],
    };

    render(<ArenaBoard {...props({ ended: null, onClose, onForfeit })} />);

    expect(screen.getByText('Match ended')).toBeInTheDocument();
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent('Outcome unavailable.');
    expect(live).not.toHaveTextContent('Outcome: Victory');
    // The match is already over, so this exit must close rather than forfeit.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onForfeit).not.toHaveBeenCalled();
  });

  // The overlay follows the authoritative snapshot, which is where the HUD
  // countdown already comes from, so fixtures must move the welcome state too.
  const atPhase = (phase: ArenaStateSnapshot['phase'], phaseEndsAtTick: number | null) => {
    state.current = { ...state.current, phase, phaseEndsAtTick };
    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, phase, phaseEndsAtTick },
    } as ArenaConnection['welcome'];
  };

  it('shows the countdown and control legend before the round goes live', () => {
    atPhase('positioning', 280);

    render(<ArenaBoard {...props()} />);

    const overlay = screen.getByTestId('arena-pregame');
    // phaseEndsAtTick 280 against serverTick 100 at 60Hz = 3 seconds.
    expect(within(overlay).getByText('3')).toBeInTheDocument();
    expect(within(overlay).getByText('WASD to move')).toBeInTheDocument();
    expect(within(overlay).getByText('Spacebar to dash')).toBeInTheDocument();
    expect(within(overlay).getByText('Hold to shoot')).toBeInTheDocument();
    // The live region already announces phase and countdown, so this must not double up.
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the pregame overlay while loading too', () => {
    atPhase('loading', 160);

    render(<ArenaBoard {...props()} />);

    expect(screen.getByTestId('arena-pregame')).toBeInTheDocument();
  });

  it('hides the pregame overlay once the round is live', () => {
    atPhase('live', null);

    render(<ArenaBoard {...props()} />);

    expect(screen.queryByTestId('arena-pregame')).toBeNull();
  });

  it('drops the countdown animation under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    atPhase('positioning', 280);

    render(<ArenaBoard {...props()} />);

    expect(screen.getByTestId('arena-countdown').className).not.toMatch(/pulse/i);
  });

  it('puts the match action in the header and keeps close beside the result', () => {
    const live = render(<ArenaBoard {...props()} />);
    expect(screen.getByRole('button', { name: 'Forfeit' }).closest('header')).not.toBeNull();
    // The footer is always present so the arena never resizes when a match ends;
    // during play it is an empty reserved strip.
    const playing = live.container.querySelector('[data-testid="arena-footer"]');
    expect(playing).not.toBeNull();
    expect(within(playing as HTMLElement).queryByRole('button')).toBeNull();
    expect(playing?.textContent).toBe('');
    live.unmount();

    render(<ArenaBoard {...props({
      onRematch: vi.fn(),
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 10 },
    })} />);
    expect(screen.getByRole('button', { name: 'Rematch' }).closest('header')).not.toBeNull();
    const footer = screen.getByTestId('arena-footer');
    expect(within(footer).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(footer).getByText('You win!')).toBeInTheDocument();
  });

  it('offers an explicit Forfeit action while the match is live', () => {
    const onForfeit = vi.fn();

    render(<ArenaBoard {...props({ onForfeit })} />);

    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Forfeit' }));
    expect(onForfeit).toHaveBeenCalledOnce();
  });

  it('replaces Forfeit with Rematch and Close once the match has ended', () => {
    const onRematch = vi.fn();
    const onClose = vi.fn();

    render(<ArenaBoard {...props({
      onRematch, onClose,
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 10 },
    })} />);

    expect(screen.queryByRole('button', { name: 'Forfeit' })).toBeNull();
    expect(screen.getByText('You win!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(onRematch).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('locks the rematch action while a request is pending', () => {
    const onRematch = vi.fn();

    render(<ArenaBoard {...props({
      onRematch, rematchPending: true,
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 10 },
    })} />);

    const rematch = screen.getByRole('button', { name: 'Rematch pending' });
    expect(rematch).toBeDisabled();
    fireEvent.click(rematch);
    expect(onRematch).not.toHaveBeenCalled();
  });

  it('names the winner when the local player lost', () => {
    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', winnerId: 20 },
    })} />);

    expect(screen.getByText('Remote wins!')).toBeInTheDocument();
  });

  it('states a draw without naming a winner', () => {
    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', draw: true },
    })} />);

    expect(screen.getByText('Draw.')).toBeInTheDocument();
  });

  it('gives a neutral result message when neither source reports an outcome', () => {
    connection.current = {
      ...connection.current, status: 'failed', welcome: null, latestSnapshot: null, closed: null,
    };

    render(<ArenaBoard {...props({
      ended: { matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff' },
    })} />);

    expect(screen.getByText('The match has ended.')).toBeInTheDocument();
    expect(screen.queryByText(/wins!/)).toBeNull();
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

  it('renders a normal 2-1 terminal state as match complete through the real state hook', () => {
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
    expect(screen.getByText('Match complete')).toBeInTheDocument();
    expect(screen.getByTestId('arena-score')).toHaveTextContent('2 – 1');
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Local.*radius 7000 to 7499/i);
    expect(live).toHaveTextContent(/Outcome: Victory/i);
  });

  it('renders an in-bounds zero-score disconnect as a forfeit rather than a draw', () => {
    const finalState = {
      ...connection.current.welcome!.state,
      phase: 'ended' as const,
      phaseEndsAtTick: null,
      score: [0, 0] as [number, number],
    };
    const ended = { type: 'matchClosed' as const, protocolVersion: 1 as const, matchId: 91, sequence: 4,
      serverTick: 200, reason: 'forfeited' as const, finalState };

    render(<ArenaBoard {...props({ ended })} />);

    expect(screen.getByText('Match forfeited')).toBeInTheDocument();
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Outcome: Forfeit/i);
    expect(live).not.toHaveTextContent(/Outcome: Draw/i);
  });

  it('labels an ongoing double KO as a replay of the same scoring round', () => {
    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, score: [1, 0], consecutiveDoubleKos: 2 },
    };
    render(<ArenaBoard {...props()} />);
    expect(screen.getByText('Round 2 · Double KO replay 2')).toBeInTheDocument();
  });

  it('labels a four-double-KO terminal draw as match complete', () => {
    const finalState = {
      ...connection.current.welcome!.state,
      phase: 'ended' as const, phaseEndsAtTick: null, score: [0, 0] as [number, number], consecutiveDoubleKos: 4,
    };
    const ended = { type: 'matchClosed' as const, protocolVersion: 1 as const, matchId: 91, sequence: 5,
      serverTick: 220, reason: 'completed' as const, finalState };
    render(<ArenaBoard {...props({ ended })} />);
    expect(screen.getByText('Match complete')).toBeInTheDocument();
    expect(screen.queryByText(/Round/)).not.toBeInTheDocument();
    expect(screen.getByTestId('arena-live-region')).toHaveTextContent(/Outcome: Draw/i);
  });

  it('announces normal round advancement exactly once', () => {
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    expect(live.textContent?.match(/Round 2/g)).toHaveLength(1);

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, score: [2, 0], consecutiveDoubleKos: 0 },
    };
    rendered.rerender(<ArenaBoard {...props()} />);

    expect(live.textContent?.match(/Round 3/g)).toHaveLength(1);
    expect(live).not.toHaveTextContent('Round 2');
  });

  it('announces a same-score double KO replay count change exactly once', () => {
    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, score: [1, 0], consecutiveDoubleKos: 1 },
    };
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    expect(live.textContent?.match(/Round 2 · Double KO replay 1/g)).toHaveLength(1);

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, consecutiveDoubleKos: 2 },
    };
    rendered.rerender(<ArenaBoard {...props()} />);

    expect(live.textContent?.match(/Round 2 · Double KO replay 2/g)).toHaveLength(1);
    expect(live).not.toHaveTextContent('Double KO replay 1');
  });

  it('announces terminal match completion exactly once', () => {
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent('Round 2');

    const finalState = {
      ...connection.current.welcome!.state,
      phase: 'ended' as const, phaseEndsAtTick: null, score: [2, 1] as [number, number], consecutiveDoubleKos: 0,
    };
    const ended = { type: 'matchClosed' as const, protocolVersion: 1 as const, matchId: 91, sequence: 6,
      serverTick: 240, reason: 'completed' as const, finalState };
    rendered.rerender(<ArenaBoard {...props({ ended })} />);

    expect(live.textContent?.match(/Match complete/g)).toHaveLength(1);
    expect(live).not.toHaveTextContent(/Round \d/);
  });

  it('mutates the same live text node once per round semantic transition and never for equivalent raw state', () => {
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    const textNode = live.firstChild;
    expect(textNode).toBeInstanceOf(Text);
    const observer = new MutationObserver(() => {});
    observer.observe(live, { characterData: true, childList: true, subtree: true });

    const expectSemanticMutation = (label: string) => {
      const records = observer.takeRecords();
      expect(records).toHaveLength(1);
      expect(records[0].type).toBe('characterData');
      expect(live).toHaveTextContent(label);
      expect(live.firstChild).toBe(textNode);
    };
    const expectEquivalentStateIsStable = (text: string) => {
      expect(observer.takeRecords()).toHaveLength(0);
      expect(live.textContent).toBe(text);
      expect(live.firstChild).toBe(textNode);
    };

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, score: [2, 0], consecutiveDoubleKos: 0 },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectSemanticMutation('Round 3');
    const roundText = live.textContent!;

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: {
        ...connection.current.welcome!.state,
        arena: { ...connection.current.welcome!.state.arena, radius: 7591 },
        players: connection.current.welcome!.state.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 80, aimX: 32600, aimY: 100, chargePermille: 641, forcedFireTicks: 17, cooldownTicks: 11 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectEquivalentStateIsStable(roundText);

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, consecutiveDoubleKos: 1 },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectSemanticMutation('Round 3 · Double KO replay 1');
    const replayOneText = live.textContent!;

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: {
        ...connection.current.welcome!.state,
        players: connection.current.welcome!.state.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 120, chargePermille: 642, forcedFireTicks: 16, cooldownTicks: 10 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectEquivalentStateIsStable(replayOneText);

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: { ...connection.current.welcome!.state, consecutiveDoubleKos: 2 },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectSemanticMutation('Round 3 · Double KO replay 2');
    const replayTwoText = live.textContent!;

    connection.current.welcome = {
      ...connection.current.welcome!,
      state: {
        ...connection.current.welcome!.state,
        players: connection.current.welcome!.state.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 160, chargePermille: 643, forcedFireTicks: 15, cooldownTicks: 9 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expectEquivalentStateIsStable(replayTwoText);

    const finalState = {
      ...connection.current.welcome!.state,
      phase: 'ended' as const, phaseEndsAtTick: null, consecutiveDoubleKos: 2,
    };
    const ended = { type: 'matchClosed' as const, protocolVersion: 1 as const, matchId: 91, sequence: 7,
      serverTick: 260, reason: 'completed' as const, finalState };
    rendered.rerender(<ArenaBoard {...props({ ended })} />);
    expectSemanticMutation('Match complete');
    const terminalText = live.textContent!;

    const equivalentEnded = {
      ...ended,
      sequence: 8,
      finalState: {
        ...finalState,
        arena: { ...finalState.arena, radius: 7592 },
        players: finalState.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 200, aimX: 32500, aimY: 120, chargePermille: 644, forcedFireTicks: 14, cooldownTicks: 8 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props({ ended: equivalentEnded })} />);
    expectEquivalentStateIsStable(terminalText);
    observer.disconnect();
  });

  it('keeps 20 Hz snapshots quiet within combat semantic states and updates at their boundaries', () => {
    const initial = connection.current.welcome!.state;
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    const first = live.textContent;

    for (let index = 1; index <= 5; index++) {
      connection.current = {
        ...connection.current,
        latestSnapshot: {
          type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: index + 1,
          serverTick: 100 + index, generatedAtUnixMs: Date.now() + index * 50,
          ...initial,
          players: initial.players.map(candidate => candidate.sessionId === 10
            ? { ...candidate, forcedFireTicks: 18 - index, cooldownTicks: 12 - index, chargePermille: 640 + index }
            : candidate),
        },
      };
      rendered.rerender(<ArenaBoard {...props()} />);
      expect(live.textContent).toBe(first);
    }

    const imminent = connection.current.latestSnapshot!;
    connection.current = {
      ...connection.current,
      latestSnapshot: {
        ...imminent, sequence: imminent.sequence + 1,
        players: imminent.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, forcedFireTicks: 6 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expect(live).toHaveTextContent(/forced fire imminent/i);
    expect(live.textContent).not.toBe(first);
    const imminentText = live.textContent;

    connection.current = {
      ...connection.current,
      latestSnapshot: {
        ...connection.current.latestSnapshot!, sequence: connection.current.latestSnapshot!.sequence + 1,
        players: connection.current.latestSnapshot!.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, forcedFireTicks: 5, cooldownTicks: 1 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expect(live.textContent).toBe(imminentText);

    connection.current = {
      ...connection.current,
      latestSnapshot: {
        ...connection.current.latestSnapshot!, sequence: connection.current.latestSnapshot!.sequence + 1,
        players: connection.current.latestSnapshot!.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, forcedFireTicks: null, cooldownTicks: 0 }
          : candidate),
      },
    };
    rendered.rerender(<ArenaBoard {...props()} />);
    expect(live).toHaveTextContent(/shot ready/i);
    expect(live).not.toHaveTextContent(/forced fire/i);
  });

  it('keeps authoritative announcements stable while the real state hook interpolates visual frames', () => {
    state.useReal = true;
    const prediction = {
      unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
      momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30, shotCooldownTicks: 24,
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
      snapshotSequence: 1, serverTick: 100, generatedAtUnixMs: Date.now(),
      tickRate: 60, snapshotRate: 20, interpolationMs: 100,
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

  it('does not mutate live DOM during equivalent real-hook snapshot and RAF interpolation updates', () => {
    state.useReal = true;
    const prediction = {
      unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
      momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30, shotCooldownTicks: 24,
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
      snapshotSequence: 1, serverTick: 100, generatedAtUnixMs: Date.now(),
      tickRate: 60, snapshotRate: 20, interpolationMs: 100,
      maxExtrapolationMs: 50, inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
      prediction, state: welcomeState, acknowledgedInput: 0,
    };
    connection.current = { ...connection.current, welcome, latestSnapshot: null };
    const rendered = render(<ArenaBoard {...props()} />);
    const live = screen.getByTestId('arena-live-region');
    const textNode = live.firstChild;
    const text = live.textContent;
    expect(textNode).toBeInstanceOf(Text);
    const observer = new MutationObserver(() => {});
    observer.observe(live, { characterData: true, childList: true, subtree: true });

    const snapshots: ArenaSnapshot[] = [
      {
        type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 2, serverTick: 101,
        generatedAtUnixMs: Date.now(), ...welcomeState,
        arena: { radius: 7595, shrinkPhase: 'collapse' },
        players: welcomeState.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 120, aimX: 32600, aimY: 80, chargePermille: 641, forcedFireTicks: 17, cooldownTicks: 11 }
          : { ...candidate, x: -120 }),
      },
      {
        type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 3, serverTick: 102,
        generatedAtUnixMs: Date.now() + 50, ...welcomeState,
        arena: { radius: 7590, shrinkPhase: 'collapse' },
        players: welcomeState.players.map(candidate => candidate.sessionId === 10
          ? { ...candidate, x: 240, aimX: 32500, aimY: 100, chargePermille: 642, forcedFireTicks: 16, cooldownTicks: 10 }
          : { ...candidate, x: -240 }),
      },
    ];

    for (const latestSnapshot of snapshots) {
      connection.current = { ...connection.current, latestSnapshot };
      rendered.rerender(<ArenaBoard {...props()} />);
      act(() => {
        const pendingFrames = frames.splice(0);
        for (const callback of pendingFrames) callback(performance.now());
      });
      expect(observer.takeRecords()).toHaveLength(0);
      expect(screen.getByTestId('arena-live-region')).toBe(live);
      expect(live.firstChild).toBe(textNode);
      expect(live.textContent).toBe(text);
    }
    observer.disconnect();
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

  // The vanish is only observable on the render frame: it never reaches the DOM,
  // and the canvas context is stubbed to null, so the renderer call is the seam.
  const knockoutFrames = (spy: ReturnType<typeof vi.spyOn>) =>
    (spy.mock.calls.at(-1)![0] as ArenaRenderView).knockout;

  // A forfeit reaches the board as two independent messages: the duel bridge names
  // the winner, and the arena socket delivers the final board. Neither alone is enough.
  const closedWith = (reason: 'completed' | 'forfeited') => {
    const finalState: ArenaStateSnapshot = {
      ...connection.current.welcome!.state, phase: 'ended', phaseEndsAtTick: null,
    };
    connection.current = {
      ...connection.current,
      status: 'closed',
      closed: {
        type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 4, serverTick: 200, reason, finalState,
      },
    };
    return finalState;
  };

  const endedBy = (overrides: Partial<EndedMatch>): EndedMatch =>
    ({ matchId: 91, sourceMatchId: 91, gameType: 'arena-knockoff', ...overrides });

  it('vanishes the forfeiting player rather than freezing them in place', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    closedWith('forfeited');

    render(<ArenaBoard {...props({
      ended: endedBy({ abandoned: true, reason: 'forfeit', winnerId: 10 }),
    })} />);

    const knockout = knockoutFrames(renderSpy);
    expect(knockout).toHaveLength(1);
    // winnerId is a session id despite its name, so the victim is session 20.
    expect(knockout[0].sessionId).toBe(20);
    // vanishOnly opens the dust at once: full opacity from zero radius. A knockout
    // that slides and falls first opens it at opacity 0 instead.
    expect(knockout[0].puffOpacity).toBe(1);
    expect(knockout[0].puffRadius).toBe(0);
  });

  it('vanishes a forfeit that carries no abandoned flag', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    closedWith('forfeited');

    render(<ArenaBoard {...props({ ended: endedBy({ winnerId: 10 }) })} />);

    expect(knockoutFrames(renderSpy).map(frame => frame.sessionId)).toEqual([20]);
  });

  it('vanishes an abandon that the arena socket closed as completed', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    closedWith('completed');

    render(<ArenaBoard {...props({
      ended: endedBy({ abandoned: true, reason: 'connection lost', winnerId: 10 }),
    })} />);

    expect(knockoutFrames(renderSpy).map(frame => frame.sessionId)).toEqual([20]);
  });

  it('leaves a normally completed match on the board', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    closedWith('completed');

    render(<ArenaBoard {...props({ ended: endedBy({ winnerId: 10 }) })} />);

    expect(knockoutFrames(renderSpy)).toEqual([]);
  });

  it('vanishes nobody when a forfeit arrives without a final board', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    connection.current = { ...connection.current, status: 'closed', closed: null };

    render(<ArenaBoard {...props({
      ended: endedBy({ abandoned: true, reason: 'forfeit', winnerId: 10 }),
    })} />);

    expect(knockoutFrames(renderSpy)).toEqual([]);
  });

  it('vanishes nobody when a forfeit names no winner', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    closedWith('forfeited');

    render(<ArenaBoard {...props({ ended: endedBy({ abandoned: true, reason: 'forfeit' }) })} />);

    expect(knockoutFrames(renderSpy)).toEqual([]);
  });

  // The real hook is needed wherever more than one frame must be drawn: the mocked
  // hook only draws once, from the canvas mount effect.
  const liveWelcome = () => {
    const prediction = {
      unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
      momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30, shotCooldownTicks: 24,
      projectileRadius: 180, projectilePerTick: 240, projectileBaseKnockback: 130,
      projectileBonusKnockback: 220, recoilBase: 45, recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
    } as const;
    const welcome: ArenaWelcome = {
      type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91, role: 'participant', sessionId: 10,
      snapshotSequence: 1, serverTick: 100, generatedAtUnixMs: Date.now(),
      tickRate: 60, snapshotRate: 20, interpolationMs: 100,
      maxExtrapolationMs: 50, inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
      prediction, acknowledgedInput: 0,
      state: {
        phase: 'live', phaseEndsAtTick: 160, score: [1, 0], consecutiveDoubleKos: 0,
        arena: { radius: 7600, shrinkPhase: 'collapse' }, projectiles: [],
        players: [player(10, 0), player(20, 1, { chargePermille: 0, forcedFireTicks: null })],
      },
    };
    state.useReal = true;
    connection.current = { ...connection.current, welcome, latestSnapshot: null };
    return welcome;
  };

  it('advances one vanish across frames rather than restarting it on each', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const welcome = liveWelcome();
    closedWith('forfeited');
    connection.current = { ...connection.current, welcome };
    const forfeit = endedBy({ abandoned: true, reason: 'forfeit', winnerId: 10 });

    const rendered = render(<ArenaBoard {...props({ ended: forfeit })} />);
    expect(knockoutFrames(renderSpy)[0].puffOpacity).toBe(1);

    // Half of KNOCKOUT_DURATION_MS later the puff must be half faded. A vanish
    // re-armed on this frame would read as opacity 1 again.
    now.mockReturnValue(1700);
    rendered.rerender(<ArenaBoard {...props({ ended: forfeit })} />);
    act(() => {
      for (const callback of frames.splice(0)) callback(1700);
    });

    const knockout = knockoutFrames(renderSpy);
    expect(knockout.map(frame => frame.sessionId)).toEqual([20]);
    expect(knockout[0].puffOpacity).toBeCloseTo(0.5, 5);
    expect(knockout[0].scale).toBe(0);
    now.mockRestore();
  });

  it('retires the vanish when the board is reused for the next match', () => {
    const renderSpy = vi.spyOn(ArenaRenderer.prototype, 'render');
    const welcome = liveWelcome();
    closedWith('forfeited');
    connection.current = { ...connection.current, welcome };

    const rendered = render(<ArenaBoard {...props({
      ended: endedBy({ abandoned: true, reason: 'forfeit', winnerId: 10 }),
    })} />);
    expect(knockoutFrames(renderSpy)).toHaveLength(1);

    // The rematch reconnects: a fresh match id, a live socket, no ended payload.
    connection.current = { ...connection.current, status: 'connected', closed: null };
    rendered.rerender(<ArenaBoard {...props({ matchId: 92 })} />);
    act(() => {
      for (const callback of frames.splice(0)) callback(performance.now());
    });

    expect(knockoutFrames(renderSpy)).toEqual([]);
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
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    expect(endedProps.onClose).toHaveBeenCalledOnce();
  });

  it('pairs one committed capture owner when mounted in StrictMode', () => {
    const rendered = render(<ArenaBoard {...props()} />, { reactStrictMode: true });
    fireEvent.click(rendered.container.querySelector('canvas')!);
    const activation = vi.mocked(bridge.send).mock.calls.at(-1)!;
    rendered.unmount();

    expect(vi.mocked(bridge.send).mock.calls).toEqual([
      activation,
      ['game.inputCapture', { ...(activation[1] as object), active: false }],
    ]);
  });

  it('releases neutral then native capture exactly once before a match change', () => {
    const events: string[] = [];
    vi.mocked(connection.current.sendInput).mockImplementation(input => {
      if (input.moveX === 0 && input.moveY === 0) events.push('neutral');
    });
    vi.mocked(bridge.send).mockImplementation((_type, payload) => {
      events.push((payload as { active: boolean }).active ? 'active' : 'inactive');
    });
    const rendered = render(<ArenaBoard {...props()} />);
    fireEvent.click(rendered.container.querySelector('canvas')!);
    events.length = 0;

    rendered.rerender(<ArenaBoard {...props({ matchId: 92 })} />);

    expect(events).toEqual(['neutral', 'inactive']);
  });

  it('releases neutral then native capture exactly once before forfeit callback', () => {
    const events: string[] = [];
    const onForfeit = vi.fn(() => events.push('callback'));
    vi.mocked(connection.current.sendInput).mockImplementation(input => {
      if (input.moveX === 0 && input.moveY === 0) events.push('neutral');
    });
    vi.mocked(bridge.send).mockImplementation((_type, payload) => {
      events.push((payload as { active: boolean }).active ? 'active' : 'inactive');
    });
    const rendered = render(<ArenaBoard {...props({ onForfeit })} />);
    fireEvent.click(rendered.container.querySelector('canvas')!);
    events.length = 0;

    fireEvent.click(screen.getByRole('button', { name: /forfeit/i }));

    expect(events).toEqual(['neutral', 'inactive', 'callback']);
  });

  it('releases capture on terminal transition exactly once before close callback', () => {
    const events: string[] = [];
    const onClose = vi.fn(() => events.push('callback'));
    vi.mocked(connection.current.sendInput).mockImplementation(input => {
      if (input.moveX === 0 && input.moveY === 0) events.push('neutral');
    });
    vi.mocked(bridge.send).mockImplementation((_type, payload) => {
      events.push((payload as { active: boolean }).active ? 'active' : 'inactive');
    });
    const rendered = render(<ArenaBoard {...props({ onClose })} />);
    fireEvent.click(rendered.container.querySelector('canvas')!);
    events.length = 0;
    const ended = { reason: 'completed', finalState: { ...state.current, players: [] } } as never;

    rendered.rerender(<ArenaBoard {...props({ ended, onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));

    expect(events).toEqual(['neutral', 'inactive', 'callback']);
  });
});
