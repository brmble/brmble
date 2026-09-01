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

  it('blends small corrections over 100ms on the animation-frame clock', () => {
    vi.setSystemTime(1000);
    // Under fake timers performance.now() is 0, not the system time, and the RAF
    // effect's first synchronous update runs at performance.now(). Anchoring here
    // keeps the first driven frame at the mount instant instead of a second later.
    const startedAt = performance.now();
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
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(startedAt));
    expect(hook.result.current.localPlayer?.x).toBe(955);
    act(() => frame?.(startedAt + 50));
    expect(latestFrame?.localPlayer?.x).toBe(1077);
    act(() => frame?.(startedAt + 100));
    expect(latestFrame?.localPlayer?.x).toBe(1200);
    act(() => frame?.(startedAt + 250));
    expect(latestFrame?.localPlayer?.x).toBe(1200);
  });

  it('presents predicted own projectiles immediately', () => {
    const initial = welcome();
    const fire: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: true, dash: false },
    };
    const hook = renderHook(() => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs: [fire], recentInputs: [fire], selfSessionId: 10,
    }));
    expect(hook.result.current.projectiles).toHaveLength(1);
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
    const startedAt = 1000;
    const initial = welcome();
    let latestFrame: ReturnType<typeof useArenaState> | undefined;
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
      onFrame: state => { latestFrame = state; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [] as PendingArenaInput[] } });
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(startedAt));
    act(() => frame?.(startedAt + 50));
    expect(latestFrame?.localPlayer?.x).toBe(1100);
    hook.rerender({ latestSnapshot: snapshot(3, 1050, 1300), pendingInputs: [] });
    act(() => frame?.(startedAt + 50));
    expect(hook.result.current.localPlayer?.x).toBe(1100);
    act(() => frame?.(startedAt + 100));
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

    // The frame gap is 1 ms and baseMovePerTick is 90 at 60 Hz, i.e. 5.4 units/ms,
    // so the smooth continuation of `before` (1126) is 1131. Before the tick phase
    // was preserved this read exactly `before`, because the phase reset to zero
    // held the display still for a frame; that stall is the bug being fixed.
    expect(hook.result.current.localPlayer?.x).toBe(before + 5);
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

  it('keeps local display cadence continuous across aim-only pending input updates', () => {
    const initial = welcome();
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 0, moveY: 32767, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false },
    };
    const aim: PendingArenaInput = {
      sequence: 2, predictedTick: 103, fromTick: 103, toTick: 103,
      input: { ...move.input, aimX: 0, aimY: 32767 },
    };
    const positions: number[] = [];
    const hook = renderHook(({ pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs, currentInput: aim.input, selfSessionId: 10,
      onFrame: state => positions.push(state.localPlayer!.y),
    }), { initialProps: { pendingInputs: [move] } });
    const startedAt = performance.now();
    act(() => frame?.(startedAt + 4));
    act(() => frame?.(startedAt + 8));
    hook.rerender({ pendingInputs: [{ ...move, toTick: 102 }, aim] });
    act(() => frame?.(startedAt + 12));

    const deltas = positions.slice(-3).map((position, index, values) => index === 0 ? 0 : position - values[index - 1]);
    expect(deltas[2]).toBeLessThanOrEqual(deltas[1] + 1);
  });

  it('does not lose a frame of local movement when an ordinary snapshot lands', () => {
    vi.setSystemTime(1000);
    const startedAt = 1000;
    const initial = welcome();
    const held = {
      moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false,
    };
    // useArenaConnection keeps the newest pending interval at the current
    // predicted tick and extends the previous one behind it, so held input
    // arrives as a contiguous replayable range rather than a single stale tick.
    const heldThrough = (toTick: number): PendingArenaInput[] => [
      { sequence: 1, predictedTick: 101, fromTick: 101, toTick, input: held },
    ];
    const positions: number[] = [];
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, currentInput: held, selfSessionId: 10,
      onFrame: state => positions.push(state.localPlayer!.x),
    }), { initialProps: {
      latestSnapshot: null as ArenaSnapshot | null,
      pendingInputs: heldThrough(101),
    } });

    // Sample at ~144 Hz. The snapshot lands on the frame at t+56, which is not
    // aligned to the 16.666 ms tick boundary, so the sub-tick phase is non-zero.
    for (let i = 1; i <= 7; i++) act(() => { frame?.(startedAt + i * 7); });
    hook.rerender({ latestSnapshot: snapshot(2, 1050, 1180), pendingInputs: heldThrough(104) });
    for (let i = 8; i <= 15; i++) act(() => { frame?.(startedAt + i * 7); });

    const deltas = positions.slice(1).map((x, index) => x - positions[index]);
    expect(Math.min(...deltas)).toBeGreaterThan(0);
    expect(Math.max(...deltas)).toBeLessThan(3 * 90);
  });

  it('resets the tick phase on a mandatory snap', () => {
    vi.setSystemTime(1000);
    const startedAt = 1000;
    const initial = welcome();
    const held = {
      moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false,
    };
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [], currentInput: held, selfSessionId: 10,
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });
    for (let i = 1; i <= 7; i++) act(() => { frame?.(startedAt + i * 7); });

    // A score change is a mandatory discrete snap condition.
    const scored = { ...snapshot(2, 1050, 1180), score: [1, 0] as [number, number] };
    hook.rerender({ latestSnapshot: scored });
    act(() => { frame?.(startedAt + 56); });

    expect(hook.result.current.snapCount).toBe(1);
    // The phase reset to zero, so the snapped frame presents the authoritative
    // position with no carried sub-tick interpolation on top of it.
    expect(hook.result.current.localPlayer?.x).toBe(1180);
  });

  it('keeps the tick phase when an input-only reconcile reports a large correction', () => {
    vi.setSystemTime(1000);
    const startedAt = 0;
    const initial = welcome();
    const held = {
      moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false,
    };
    const move: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101, input: held,
    };
    // A dash is the realistic trigger: inputDirtyRef is only set by fire or dash
    // pending inputs, and replaying a dash moves 90 + 240 = 330 in its first tick
    // while reconcile measures dx against the stale predictedRef, so
    // correctionSquared clears 90_000 and `snapped` comes back true even though
    // authority never changed. That is not a mandatory snap.
    const dash: PendingArenaInput = {
      sequence: 2, predictedTick: 107, fromTick: 107, toTick: 107, input: { ...held, dash: true },
    };
    const positions: number[] = [];
    const hook = renderHook(({ pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot: null, pendingInputs, currentInput: held, selfSessionId: 10,
      onFrame: state => positions.push(state.localPlayer!.x),
    }), { initialProps: { pendingInputs: [move] } });

    for (let i = 1; i <= 13; i++) act(() => { frame?.(startedAt + i * 7); });
    // useArenaConnection extends the previous interval to predictedTick - 1 when
    // it sends the dash, so the held run covers ticks 101-106 and the dash 107.
    hook.rerender({ pendingInputs: [{ ...move, toTick: 106 }, dash] });
    act(() => { frame?.(startedAt + 98); });

    // Not a mandatory snap, so nothing counts it as one.
    expect(hook.result.current.snapCount).toBe(0);
    // Reconcile lands the base on tick 107 at 1870. The phase clock is preserved
    // at 14.667 ms into the tick, so the frame shows 0.88 of the next dash step
    // (330) on top: 1870 + 290 = 2160. Resetting the phase would land exactly on
    // the tick-aligned base, 1870, dropping 290 units of travel.
    expect(hook.result.current.localPlayer?.x).toBe(2160);
    const deltas = positions.slice(1).map((x, index) => x - positions[index]);
    expect(Math.min(...deltas)).toBeGreaterThan(0);
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
