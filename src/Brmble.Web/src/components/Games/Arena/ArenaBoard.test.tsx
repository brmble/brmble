import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaConnection } from './useArenaConnection';
import type { ArenaPlayerSnapshot } from './arenaProtocol';
import { ArenaBoard } from './ArenaBoard';
import { GameSurface } from '../GameSurface';

const connection = vi.hoisted(() => ({ current: {} as ArenaConnection }));
const state = vi.hoisted(() => ({ current: {} as ReturnType<typeof import('./useArenaState').useArenaState> }));

vi.mock('./useArenaConnection', () => ({ useArenaConnection: () => connection.current }));
vi.mock('./useArenaState', () => ({ useArenaState: () => state.current }));

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
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('matchMedia', () => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  });

  it('exposes the stable HUD and every canvas gameplay datum as DOM text', () => {
    render(<ArenaBoard {...props()} />);
    expect(screen.getByTestId('arena-score')).toHaveTextContent('1 – 0');
    expect(screen.getByText(/Round 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /audio/i })).toBeDisabled();
    const live = screen.getByTestId('arena-live-region');
    expect(live).toHaveTextContent(/Live.*1 second/i);
    expect(live).toHaveTextContent(/Local.*side 1.*aim east.*charge 50 to 74 percent.*forced fire in 18 ticks/i);
    expect(live).toHaveTextContent(/Remote.*side 2.*aim east/i);
    expect(live).toHaveTextContent(/1 projectile/i);
    expect(live).toHaveTextContent(/radius 7600.*collapse/i);
    expect(live).toHaveTextContent(/cooldown.*12 ticks.*dash used/i);
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
