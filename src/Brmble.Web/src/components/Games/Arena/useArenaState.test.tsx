import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome } from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import { reconcile, sampleTimeline } from './arenaMath';
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

  // The local player is presented at approximately now while the remote player is
  // replayed from the `interpolationMs` buffer, so displayed bodies can overlap even
  // when both source states are valid. These fixtures sit well inside the arena ring
  // (|x| well under 9000) because the arena clamp deliberately takes precedence over
  // full separation near the edge.
  const contactState = (remoteX: number): ArenaStateSnapshot => ({
    ...state(0),
    players: [
      { ...state(0).players[0], sessionId: 10, side: 0 as const, x: 0, y: 0 },
      { ...state(0).players[1], sessionId: 20, side: 1 as const, x: remoteX, y: 0, vx: 0 },
    ],
  });
  const contactWelcome = (remoteX: number): ArenaWelcome => ({ ...welcome(), state: contactState(remoteX) });
  const contactSnapshot = (sequence: number, generatedAtUnixMs: number, remoteX: number): ArenaSnapshot => ({
    ...snapshot(sequence, generatedAtUnixMs, 0), ...contactState(remoteX),
  });
  // What `asSnapshot` builds from the welcome inside the hook: the mount effect runs
  // at Date.now() === 1000 in these fixtures, and welcome.snapshotSequence is 1.
  const welcomeFrame = (remoteX: number): ArenaSnapshot => ({
    type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 1, serverTick: 100,
    generatedAtUnixMs: 1000, ...contactState(remoteX),
  });
  type RenderState = ReturnType<typeof useArenaState>;

  it('never displays overlapping player bodies', () => {
    vi.setSystemTime(1000);
    const initial = contactWelcome(700);
    let latestFrame: RenderState | null = null;
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [], selfSessionId: 10,
      onFrame: rendered => { latestFrame = rendered; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });

    hook.rerender({ latestSnapshot: contactSnapshot(2, 1050, 700) });
    // sampleTimeline reads Date.now() - interpolationMs, so the wall clock has to run
    // 100 ms past the newest snapshot or the sampler replays the pre-contact welcome
    // frame and the assertion below passes without exercising the constraint at all.
    vi.setSystemTime(1150);
    act(() => { frame?.(50); });

    const { localPlayer, remotePlayer } = latestFrame!;
    const dx = localPlayer!.x - remotePlayer!.x;
    const dy = localPlayer!.y - remotePlayer!.y;
    expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(1200 * 1200);
  });

  it('never moves the displayed remote player away from its interpolated path', () => {
    vi.setSystemTime(1000);
    const initial = contactWelcome(700);
    let latestFrame: RenderState | null = null;
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [], selfSessionId: 10,
      onFrame: rendered => { latestFrame = rendered; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });

    hook.rerender({ latestSnapshot: contactSnapshot(2, 1050, 900) });
    // renderAt is 1025, i.e. between the two frames, so the sampler produces a genuinely
    // interpolated remote position rather than echoing a snapshot verbatim.
    vi.setSystemTime(1125);
    act(() => { frame?.(50); });

    const expected = sampleTimeline(
      [welcomeFrame(700), contactSnapshot(2, 1050, 900)], 1125,
      initial.interpolationMs, initial.maxExtrapolationMs,
    ).players.find(player => player.sessionId === 20)!;
    expect(latestFrame!.remotePlayer?.x).toBe(expected.x);
    expect(latestFrame!.remotePlayer?.y).toBe(expected.y);
    // The constraint moved only the local player: it sits one diameter (plus the one
    // rounding unit) to the near side of the untouched remote position.
    expect(latestFrame!.localPlayer?.x).toBe(expected.x - 1201);
  });

  it('does not generate a correction from a constraint-only offset', () => {
    vi.setSystemTime(1000);
    // The opponent dashes past. Prediction always sees the newest snapshot, where they
    // are well clear, so prediction never pushes the local base off 0. The display
    // replays them from interpolationMs ago, where they are still at 800 — inside a
    // diameter — so the constraint has to move the local player by 401 units, which is
    // more than reconcile's 300-unit snap threshold.
    const initial = contactWelcome(3000);
    let latestFrame: RenderState | null = null;
    const hook = renderHook(({ latestSnapshot }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs: [], selfSessionId: 10,
      onFrame: rendered => { latestFrame = rendered; },
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null } });

    hook.rerender({ latestSnapshot: contactSnapshot(2, 1050, 800) });
    hook.rerender({ latestSnapshot: contactSnapshot(3, 1100, 2000) });
    vi.setSystemTime(1150);
    act(() => { frame?.(50); });

    // renderAt is exactly the sequence-2 frame, so the displayed remote is 800 and the
    // constraint is active with a 401-unit offset, while prediction sees 2000.
    expect(latestFrame!.remotePlayer?.x).toBe(800);
    expect(latestFrame!.localPlayer?.x).toBe(800 - 1201);

    // A second reconcile, with the constraint no longer active. The local base is still
    // 0 and authority still agrees, so there is nothing to correct and nothing to snap.
    hook.rerender({ latestSnapshot: contactSnapshot(4, 1150, 3200) });
    vi.setSystemTime(1200);
    act(() => { frame?.(100); });

    expect(latestFrame!.remotePlayer?.x).toBe(2000);
    expect(latestFrame!.localPlayer?.x).toBe(0);
    // The discriminating assertion. If the constrained position had reached
    // renderedLocalRef / renderedBaseRef it would be this reconcile's correction origin,
    // reconcile would measure a 401-unit correction against the authoritative base, and
    // 401^2 clears the 90_000 snap threshold — a snap manufactured entirely out of a
    // client-only display artefact.
    expect(hook.result.current.snapCount).toBe(0);
  });

  describe('sustained contact', () => {
    const snapshotMs = 50;
    const frameMs = 16;
    const framesPerSnapshot = 3;
    const ticksPerSnapshot = 3; // 50 ms at 60 Hz
    const snapshotCount = 40; // 40 x 50 ms = 2 s of sustained contact
    const diameter = prediction.playerRadius * 2;
    // `resolveBodyOverlap` splits the penetration evenly between the two bodies, so a
    // player in sustained head-on contact advances at half the free rate. The server
    // runs the same stage, so authority advances at this rate too and the held-input
    // prediction agrees with it. (Advancing authority at the free rate would put
    // prediction half a diameter ahead per snapshot and manufacture a snap.)
    const pushPerTick = prediction.baseMovePerTick / 2; // 45
    const pushPerSnapshot = pushPerTick * ticksPerSnapshot; // 135
    // 100 ms of round trip: the client always holds six ticks of input the server has
    // not acknowledged, so every reconcile replays six ticks of contact. Contact has to
    // happen inside the replay to be observable — `reconcile` evaluates the deep-overlap
    // condition on the replayed base, not on the presented state.
    const unacknowledgedTicks = 6;
    // `sampleTimeline` renders `interpolationMs` behind the wall clock, so early frames
    // still replay the pre-contact welcome frame. Only assert once the buffer is full.
    const warmUpSnapshots = 4;
    const held = {
      moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false,
    };
    const neutral = { ...held, moveX: 0 };

    const pairState = (localX: number, remoteX: number, remoteVx: number): ArenaStateSnapshot => ({
      ...state(0),
      players: [
        { ...state(0).players[0], x: localX, y: 0, vx: 0 },
        { ...state(0).players[1], x: remoteX, y: 0, vx: remoteVx },
      ],
    });

    function driveContact(
      currentInput: typeof held,
      remoteVx: number,
      authorityAt: (index: number) => { localX: number; remoteX: number },
    ) {
      vi.setSystemTime(1000);
      const start = authorityAt(0);
      // Hoisted: a fresh welcome identity on every render would re-run the [welcome]
      // effect and reset every prediction ref the test is measuring.
      const initial: ArenaWelcome = { ...welcome(), state: pairState(start.localX, start.remoteX, remoteVx) };
      const captured: { index: number; rendered: RenderState }[] = [];
      let index = 0;
      const heldThrough = (toTick: number): PendingArenaInput[] => [
        { sequence: 1, predictedTick: toTick, fromTick: 101, toTick, input: currentInput },
      ];
      const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
        welcome: initial, latestSnapshot, pendingInputs, currentInput, selfSessionId: 10,
        onFrame: rendered => { captured.push({ index, rendered }); },
      }), { initialProps: {
        // No unacknowledged input at mount, so the mount reconcile replays nothing and
        // cannot latch `snappedRef` while `predictedRef` is still undefined — which
        // would pin snapCount at 0 and make the assertion below vacuous.
        latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [] as PendingArenaInput[],
      } });

      for (index = 1; index <= snapshotCount; index++) {
        const wallClock = 1000 + index * snapshotMs;
        const serverTick = 100 + ticksPerSnapshot * index;
        const { localX, remoteX } = authorityAt(index);
        hook.rerender({
          // welcome.snapshotSequence is 1, so sequences have to start at 2 to clear the
          // `sequence <= newest` guard.
          latestSnapshot: { ...snapshot(index + 1, wallClock, localX), serverTick,
            ...pairState(localX, remoteX, remoteVx) },
          pendingInputs: heldThrough(serverTick + unacknowledgedTicks),
        });
        for (let step = 0; step < framesPerSnapshot; step++) {
          // Both clocks, driven coherently: the wall clock feeds sampleTimeline's
          // Date.now() and the explicit argument feeds the presentation clock. Frame
          // times start at 50, past the RAF effect's synchronous mount update at
          // performance.now(), which is 0 under fake timers.
          vi.setSystemTime(wallClock + step * frameMs);
          act(() => { frame?.(index * snapshotMs + step * frameMs); });
        }
      }
      return { hook, settled: captured.filter(entry => entry.index > warmUpSnapshots).map(entry => entry.rendered) };
    }

    const separations = (rendered: RenderState[]): number[] => rendered.map(item => {
      const dx = item.localPlayer!.x - item.remotePlayer!.x;
      const dy = item.localPlayer!.y - item.remotePlayer!.y;
      return dx * dx + dy * dy;
    });
    const frameDeltas = (rendered: RenderState[]): number[] => rendered
      .slice(1).map((item, at) => Math.abs(item.localPlayer!.x - rendered[at].localPlayer!.x));

    it('never overlaps or hard-snaps while the local player pushes the opponent', () => {
      // The local player shoves the opponent along in front of it. The opponent carries
      // no velocity of its own — its motion is entirely the server's overlap resolution —
      // so dead reckoning holds it still and the client's own resolution has to
      // reproduce the push. Displayed contact is a pure interpolation-lag artefact here:
      // the local player is presented at approximately now while the opponent is replayed
      // from 100 ms ago, one whole diameter of closing behind, so this is the fixture
      // that exercises the display constraint.
      const { hook, settled } = driveContact(held, 0, index => ({
        localX: index * pushPerSnapshot,
        remoteX: index * pushPerSnapshot + diameter,
      }));

      expect(settled).toHaveLength((snapshotCount - warmUpSnapshots) * framesPerSnapshot);
      expect(hook.result.current.snapCount).toBe(0);
      expect(Math.min(...separations(settled))).toBeGreaterThanOrEqual(diameter * diameter);
      expect(Math.max(...frameDeltas(settled))).toBeLessThan(4 * prediction.baseMovePerTick);
    });

    it('never overlaps or hard-snaps while the opponent pushes the local player', () => {
      // The mirror: the local player holds neutral input and the opponent walks into it
      // at the free rate, so the authoritative local x is driven outward purely by the
      // server's overlap resolution. Displayed bodies stay clear here — the lagged
      // opponent is behind its live position, i.e. further away — so the separation this
      // test measures is produced by prediction, not by the display constraint.
      const { hook, settled } = driveContact(neutral, -prediction.baseMovePerTick, index => ({
        localX: diameter - index * pushPerSnapshot,
        remoteX: 2 * diameter - index * pushPerSnapshot,
      }));

      expect(settled).toHaveLength((snapshotCount - warmUpSnapshots) * framesPerSnapshot);
      expect(hook.result.current.snapCount).toBe(0);
      expect(Math.min(...separations(settled))).toBeGreaterThanOrEqual(diameter * diameter);
      expect(Math.max(...frameDeltas(settled))).toBeLessThan(4 * prediction.baseMovePerTick);
      // The display here is the raw prediction, so the sub-tick phase clock is visible in
      // it. Every frame is at least `frameMs` long, i.e. very nearly a whole tick, so at
      // the contact rate it must carry the local player at least half a tick's travel.
      // Resetting the phase on an ordinary snapshot strands the frame the snapshot lands
      // on at the tick-aligned base and drops that frame's travel to almost nothing.
      expect(Math.min(...frameDeltas(settled))).toBeGreaterThan(pushPerTick / 2);
    });
  });
});
