import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome } from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import { reconcile } from './arenaMath';
import { advanceLocalPresentation, interpolateLocalPresentation, useArenaState } from './useArenaState';

const prediction = {
  unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
  momentumRetentionPermille: 920, chargeTicks: 90, forcedFireTicks: 30, shotCooldownTicks: 24,
  projectileRadius: 180, projectilePerTick: 240, projectileBaseKnockback: 130,
  projectileBonusKnockback: 220, recoilBase: 45, recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
} as const;

function state(x = 1000) {
  return {
    phase: 'live' as const, phaseEndsAtTick: null, score: [0, 0] as [number, number], consecutiveDoubleKos: 0,
    arena: { radius: 9000, shrinkPhase: 'hold' as const }, projectiles: [],
    players: [
      { sessionId: 10, side: 0 as const, x, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0,
        forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
      { sessionId: 20, side: 1 as const, x: -1000, y: 0, vx: 10, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0,
        forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
    ],
  };
}

function welcome(): ArenaWelcome {
  return { type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91, role: 'participant', sessionId: 10,
    snapshotSequence: 1, serverTick: 100, tickRate: 60, snapshotRate: 20, interpolationMs: 100,
    maxExtrapolationMs: 50, inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
    prediction, state: state(), acknowledgedInput: 0 };
}

const snapshot = (sequence: number, generatedAtUnixMs: number, x: number): ArenaSnapshot => ({
  type: 'snapshot', protocolVersion: 1, matchId: 91, sequence, serverTick: 100 + sequence,
  generatedAtUnixMs, ...state(x),
});

describe('useArenaState', () => {
  let frame: FrameRequestCallback | null;
  beforeEach(() => {
    vi.useFakeTimers();
    frame = null;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('installs welcome state, finds self from the current session, and applies state-only updates', () => {
    const initial = welcome();
    const hook = renderHook(({ currentWelcome, selfSessionId }) => useArenaState({
      welcome: currentWelcome, latestSnapshot: null, pendingInputs: [], selfSessionId,
    }), { initialProps: { currentWelcome: initial as ArenaWelcome | null, selfSessionId: 10 } });
    expect(hook.result.current.localPlayer?.sessionId).toBe(10);
    hook.rerender({ currentWelcome: { ...initial, state: state(2222) }, selfSessionId: 20 });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.sessionId).toBe(20);
    expect(hook.result.current.remotePlayer?.x).toBe(2222);
  });

  it('ignores stale snapshot order and advances interpolation on animation frames', () => {
    vi.setSystemTime(900);
    const initial = welcome();
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [], selfSessionId: 10,
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });
    hook.rerender({ latestSnapshot: snapshot(3, 1050, 3000) });
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 2000) });
    vi.setSystemTime(1200);
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(3000);
    expect(hook.result.current.remotePlayer?.x).toBe(-970);
    hook.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it('advances local held movement every fixed tick between network sends', () => {
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const reconciled = reconcile({
      snapshot: { ...snapshot(1, 1000, 1000), serverTick: 100 }, selfSessionId: 10,
    }, [move], prediction).local;
    expect(reconciled.player.x).toBe(1090);

    const first = advanceLocalPresentation(reconciled, move.input, 20, 60, prediction);
    expect(first.elapsedTicks).toBe(1);
    expect(first.state.player.x).toBe(1180);

    const second = advanceLocalPresentation(first.state, move.input, 20, 60, prediction);
    expect(second.elapsedTicks).toBe(1);
    expect(second.state.player.x).toBe(1270);

    const resumed = advanceLocalPresentation(second.state, move.input, 10_000, 60, prediction);
    expect(resumed.elapsedTicks).toBe(3);
    expect(resumed.state.player.x).toBe(1540);
  });

  it('interpolates local presentation between fixed ticks on high-refresh frames', () => {
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const current = reconcile({
      snapshot: { ...snapshot(1, 1000, 1000), serverTick: 100 }, selfSessionId: 10,
    }, [move], prediction).local;

    const rendered = interpolateLocalPresentation(current, move.input, 8, 60, prediction);

    expect(rendered.x).toBeGreaterThan(current.player.x);
    expect(rendered.x).toBeLessThan(current.player.x + 90);
    expect(current.player.x).toBe(1090);
  });

  it('publishes fractional local positions directly on successive animation frames', () => {
    const initial = welcome();
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const onFrame = vi.fn();
    renderHook(() => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs: [move], currentInput: move.input,
      selfSessionId: 10, onFrame,
    }));
    const startedAt = performance.now();

    act(() => frame?.(startedAt + 4));
    act(() => frame?.(startedAt + 8));
    act(() => frame?.(startedAt + 12));

    const positions = onFrame.mock.calls.slice(-3).map(([state]) => state.localPlayer.x);
    expect(new Set(positions).size).toBe(3);
  });

  it('snaps final state and increments snapCount for mandatory reconciliation snaps', () => {
    const initial = welcome();
    const final = { ...state(5000), phase: 'ended' as const, score: [2, 1] as [number, number] };
    const hook = renderHook(({ finalState }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs: [], selfSessionId: 10, finalState,
    }), { initialProps: { finalState: undefined as typeof final | undefined } });
    hook.rerender({ finalState: final });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.phase).toBe('ended');
    expect(hook.result.current.score).toEqual([2, 1]);
    expect(hook.result.current.snapCount).toBe(1);
    act(() => frame?.(performance.now()));
    expect(hook.result.current.snapCount).toBe(1);
  });

  it('renders a terminal final state without a welcome frame', () => {
    const final = { ...state(5000), phase: 'ended' as const, score: [2, 1] as [number, number] };
    const onFrame = vi.fn();
    const hook = renderHook(() => useArenaState({
      welcome: null, latestSnapshot: null, pendingInputs: [], selfSessionId: 10, finalState: final,
      onFrame,
    }));
    expect(hook.result.current).toMatchObject({
      phase: 'ended', score: [2, 1], arena: final.arena,
      localPlayer: { sessionId: 10, x: 5000 }, remotePlayer: { sessionId: 20 },
    });
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'ended', localPlayer: expect.objectContaining({ x: 5000 }),
    }));
  });

  it('blends small corrections for 100ms and presents predicted own projectiles immediately', () => {
    vi.setSystemTime(1000);
    const initial = welcome();
    let latestFrame: ReturnType<typeof useArenaState> | undefined;
    const fire: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: true, dash: false },
    };
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
      onFrame: state => { latestFrame = state; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [fire] } });
    expect(hook.result.current.projectiles).toHaveLength(1);
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(955);
    vi.setSystemTime(1050);
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(latestFrame?.localPlayer?.x).toBe(1077);
    vi.setSystemTime(1100);
    act(() => frame?.(performance.now()));
    expect(latestFrame?.localPlayer?.x).toBe(1200);
    vi.setSystemTime(1250);
    act(() => frame?.(performance.now()));
    act(() => frame?.(performance.now()));
    expect(latestFrame?.localPlayer?.x).toBe(1200);
  });

  it('continues a dash acknowledged before the first RAF using recent input history', () => {
    const initial = welcome();
    const dash: PendingArenaInput = {
      sequence: 1, predictedTick: 110, fromTick: 110, toTick: 110,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: true },
    };
    const acknowledged = {
      ...snapshot(2, 1000, 1990), serverTick: 103,
      players: snapshot(2, 1000, 1990).players.map(player => player.sessionId === 10
        ? { ...player, dashAvailable: false, acknowledgedInput: 1 }
        : player),
    };
    const hook = renderHook(() => useArenaState({
      welcome: initial, latestSnapshot: acknowledged, pendingInputs: [], recentInputs: [dash], selfSessionId: 10,
    }));
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1990);
    expect(hook.result.current.snapCount).toBe(0);
  });

  it('replaces an active authority correction from the current blended position without jumping', () => {
    vi.setSystemTime(1000);
    const initial = welcome();
    let latestFrame: ReturnType<typeof useArenaState> | undefined;
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
      onFrame: state => { latestFrame = state; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [] as PendingArenaInput[] } });
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    vi.setSystemTime(1050);
    act(() => frame?.(performance.now()));
    expect(latestFrame?.localPlayer?.x).toBe(1100);
    hook.rerender({ latestSnapshot: snapshot(3, 1050, 1300), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1100);
    vi.setSystemTime(1100);
    act(() => frame?.(performance.now()));
    expect(latestFrame?.localPlayer?.x).toBe(1200);
  });

  it('does not jump backward when a normal snapshot reconciles smooth local presentation', () => {
    vi.setSystemTime(1000);
    const initial = welcome();
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [move], currentInput: move.input, selfSessionId: 10,
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });
    const startedAt = performance.now();
    act(() => frame?.(startedAt + 40));
    const before = hook.result.current.localPlayer!.x;

    hook.rerender({ latestSnapshot: { ...snapshot(2, 1050, before - 90), serverTick: 102 } });
    act(() => frame?.(startedAt + 41));

    expect(hook.result.current.localPlayer?.x).toBe(before);
  });

  it('does not reset smooth local movement when an aim-only pending input is added', () => {
    const initial = welcome();
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const aim: PendingArenaInput = {
      sequence: 2, predictedTick: 102, fromTick: 102, toTick: 102,
      input: { ...move.input, aimX: 0, aimY: 32767 },
    };
    const hook = renderHook(({ pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs, currentInput: aim.input, selfSessionId: 10,
    }), { initialProps: { pendingInputs: [move] } });
    const startedAt = performance.now();
    act(() => frame?.(startedAt + 40));
    const before = hook.result.current.localPlayer!.x;

    hook.rerender({ pendingInputs: [move, aim] });
    act(() => frame?.(startedAt + 41));

    expect(hook.result.current.localPlayer?.x).toBeGreaterThanOrEqual(before);
  });

  it('advances an input-only target without creating an authority correction', () => {
    const initial = welcome();
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const hook = renderHook(({ pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
    }), { initialProps: { pendingInputs: [] as PendingArenaInput[] } });
    hook.rerender({ pendingInputs: [move] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1090);
  });

  it('resets caches when selfSessionId changes with the same welcome object', () => {
    const initial = welcome();
    const hook = renderHook(({ selfSessionId, finalState }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs: [], recentInputs: [], selfSessionId, finalState,
    }), { initialProps: { selfSessionId: 10, finalState: undefined as ArenaStateSnapshot | undefined } });
    hook.rerender({ selfSessionId: 10, finalState: { ...state(5000), phase: 'ended', score: [2, 0] } });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.snapCount).toBe(1);
    hook.rerender({ selfSessionId: 20, finalState: undefined });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.sessionId).toBe(20);
    expect(hook.result.current.snapCount).toBe(0);
  });

  it('suppresses old-session pending and recent inputs until new-session arrays change', () => {
    const initial = welcome();
    const oldDash: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: true },
    };
    const hook = renderHook(({ selfSessionId, pendingInputs, recentInputs }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs, recentInputs, selfSessionId,
    }), { initialProps: { selfSessionId: 10, pendingInputs: [oldDash], recentInputs: [oldDash] } });
    hook.rerender({ selfSessionId: 20, pendingInputs: [oldDash], recentInputs: [oldDash] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer).toMatchObject({ sessionId: 20, x: -1000, dashAvailable: true });
    hook.rerender({ selfSessionId: 20, pendingInputs: [], recentInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.sessionId).toBe(20);
  });

  it('resets prediction, correction and snap count when the current session is replaced', () => {
    vi.setSystemTime(1000);
    const initial = welcome();
    const hook = renderHook(({ currentWelcome, selfSessionId, finalState }) => useArenaState({
      welcome: currentWelcome, latestSnapshot: null, pendingInputs: [], selfSessionId, finalState,
    }), { initialProps: {
      currentWelcome: initial as ArenaWelcome,
      selfSessionId: 10,
      finalState: undefined as ArenaStateSnapshot | undefined,
    } });
    hook.rerender({ currentWelcome: initial, selfSessionId: 10,
      finalState: { ...state(5000), phase: 'ended', score: [2, 0] } });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.snapCount).toBe(1);
    const replacement = { ...initial, matchId: 92, sessionId: 20, state: state(2222) };
    hook.rerender({ currentWelcome: replacement, selfSessionId: 20, finalState: undefined });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.sessionId).toBe(20);
    expect(hook.result.current.remotePlayer?.x).toBe(2222);
    expect(hook.result.current.snapCount).toBe(0);
  });
});
