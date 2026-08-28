import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaSnapshot, ArenaStateSnapshot, ArenaWelcome } from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import { useArenaState } from './useArenaState';

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

  it('blends small corrections for 100ms and presents predicted own projectiles immediately', () => {
    vi.setSystemTime(1000);
    const initial = welcome();
    const fire: PendingArenaInput = {
      sequence: 1, predictedTick: 101, fromTick: 101, toTick: 101,
      input: { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: true, dash: false },
    };
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [fire] } });
    expect(hook.result.current.projectiles).toHaveLength(1);
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(955);
    vi.setSystemTime(1050);
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1077);
    vi.setSystemTime(1100);
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1200);
    vi.setSystemTime(1250);
    act(() => frame?.(performance.now()));
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1200);
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
    const hook = renderHook(({ latestSnapshot, pendingInputs }) => useArenaState({
      welcome: initial, latestSnapshot, pendingInputs, recentInputs: pendingInputs, selfSessionId: 10,
    }), { initialProps: { latestSnapshot: null as ArenaSnapshot | null, pendingInputs: [] as PendingArenaInput[] } });
    hook.rerender({ latestSnapshot: snapshot(2, 1000, 1200), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    vi.setSystemTime(1050);
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1100);
    hook.rerender({ latestSnapshot: snapshot(3, 1050, 1300), pendingInputs: [] });
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1100);
    vi.setSystemTime(1100);
    act(() => frame?.(performance.now()));
    expect(hook.result.current.localPlayer?.x).toBe(1200);
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
