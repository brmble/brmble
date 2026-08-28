import { describe, expect, it } from 'vitest';
import type { ArenaInputState, ArenaPredictionConstants, ArenaSnapshot } from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import {
  arenaRadius, computeLayout, damp, knockback, movePerTick, normalizeQ15, recoil,
  reconcile, sampleTimeline, screenToWorld, stepLocal, worldToScreen,
} from './arenaMath';

const prediction: ArenaPredictionConstants = {
  unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
  momentumRetentionPermille: 920, chargeTicks: 90, forcedFireTicks: 30,
  shotCooldownTicks: 24, projectileRadius: 180, projectilePerTick: 240,
  projectileBaseKnockback: 130, projectileBonusKnockback: 220, recoilBase: 45,
  recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
};

const right: ArenaInputState = {
  moveX: 32767, moveY: 0, aimX: 32767, aimY: 0,
  charging: false, fireReleased: false, dash: false,
};

function snapshot(overrides: Partial<ArenaSnapshot> = {}): ArenaSnapshot {
  return {
    type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 1, serverTick: 100,
    generatedAtUnixMs: 1000, phase: 'live', phaseEndsAtTick: null, score: [0, 0],
    consecutiveDoubleKos: 0, arena: { radius: 9000, shrinkPhase: 'hold' },
    players: [
      { sessionId: 10, side: 0, x: 1000, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
        chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true,
        acknowledgedInput: 7 },
      { sessionId: 20, side: 1, x: -3000, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0,
        chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true,
        acknowledgedInput: 0 },
    ],
    projectiles: [], ...overrides,
  };
}

const pending = (sequence: number, fromTick: number, toTick: number, input = right): PendingArenaInput =>
  ({ sequence, predictedTick: fromTick, fromTick, toTick, input });
const authority = (value = snapshot(), previous?: ReturnType<typeof reconcile>['local']) =>
  ({ snapshot: value, selfSessionId: 10, previous });

describe('arenaMath golden vectors', () => {
  it.each([
    [32767, 32767, 23170, 23170],
    [-32767, 32767, -23170, 23170],
    [32767, 0, 32767, 0],
    [0, 0, 0, 0],
  ])('normalizeQ15(%i,%i)', (x, y, ex, ey) =>
    expect(normalizeQ15(x, y)).toEqual({ x: ex, y: ey }));

  it('normalizes safe integers whose squared magnitude exceeds 64 bits', () => {
    expect(normalizeQ15(Number.MAX_SAFE_INTEGER, 0)).toEqual({ x: 32767, y: 0 });
  });

  it('curves at q=333', () => {
    expect(movePerTick(333)).toBe(76);
    expect(knockback(333)).toBe(203);
    expect(recoil(333)).toBe(79);
  });

  it('damps toward zero on both signs', () =>
    expect(damp({ x: 350, y: -151 })).toEqual({ x: 322, y: -138 }));

  it.each([
    [599, 9000],
    [600, 8997],
    [2399, 3500],
    [2400, 3498],
    [3599, 0],
    [3600, 0],
  ])('arenaRadius(%i)', (tick, radius) => expect(arenaRadius(tick)).toBe(radius));
});

describe('arena client prediction', () => {
  it('uses welcome constants for integer movement, charge slowdown, dash, recoil and own projectile', () => {
    let local = reconcile(authority(), [], prediction).local;
    local = stepLocal(local, { ...right, charging: true, dash: true }, prediction);
    expect(local.player.x).toBe(1330);
    expect(local.player.dashAvailable).toBe(false);
    local = stepLocal(local, { ...right, charging: false, fireReleased: true }, prediction);
    expect(local.player.x).toBe(1614);
    expect(local.player.vx).toBe(-42);
    expect(local.player.cooldownTicks).toBe(24);
    expect(local.projectiles).toEqual([{
      id: -1, ownerSessionId: 10, x: 2110, y: 0, vx: 240, vy: 0, chargePermille: 11,
    }]);
  });

  it('starts the forced-fire countdown at full charge and fires only when it expires', () => {
    let local = reconcile(authority(), [], prediction).local;
    for (let tick = 0; tick < prediction.chargeTicks; tick++) {
      local = stepLocal(local, { ...right, charging: true }, prediction);
    }
    expect(local.player.forcedFireTicks).toBe(30);
    expect(local.projectiles).toHaveLength(0);
    for (let tick = 0; tick < prediction.forcedFireTicks; tick++) {
      local = stepLocal(local, { ...right, charging: true }, prediction);
    }
    expect(local.projectiles).toHaveLength(1);
  });

  it('resets to authority and replays exact non-overlapping inclusive intervals', () => {
    const next = reconcile(authority(), [pending(8, 101, 103), pending(9, 104, 105, { ...right, charging: true })], prediction);
    expect(next.replayedTicks).toBe(5);
    expect(next.pending.map(x => x.sequence)).toEqual([8, 9]);
    expect(next.local.player.x).toBe(1450);
  });

  it('discards acknowledged sequences before replaying', () => {
    const authority = snapshot({ players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, acknowledgedInput: 9 }
      : player) });
    const next = reconcile({ snapshot: authority, selfSessionId: 10 }, [pending(8, 101, 103), pending(9, 104, 105), pending(10, 106, 106)], prediction);
    expect(next.pending.map(x => x.sequence)).toEqual([10]);
    expect(next.replayedTicks).toBe(1);
  });

  it('carries same-tick empty edge flags into the next nonempty interval exactly once', () => {
    const next = reconcile(authority(), [
      pending(8, 101, 100, { ...right, dash: true }),
      pending(9, 101, 100, { ...right, fireReleased: true }),
      pending(10, 101, 101),
    ], prediction);
    expect(next.replayedTicks).toBe(1);
    expect(next.local.player.x).toBe(1285);
    expect(next.local.player.dashAvailable).toBe(false);
    expect(next.local.projectiles).toHaveLength(1);
  });

  it('smooths a 300-unit correction and snaps a 301-unit correction', () => {
    const predicted = reconcile(authority(), [pending(8, 101, 101)], prediction).local;
    const authority300 = snapshot({ players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, x: predicted.player.x + 300 }
      : player) });
    const authority301 = snapshot({ players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, x: predicted.player.x + 301 }
      : player) });
    expect(reconcile(authority(authority300, predicted), [], prediction).snapped).toBe(false);
    expect(reconcile(authority(authority300, predicted), [], prediction).correction).toEqual({ x: 300, y: 0, durationMs: 100 });
    expect(reconcile(authority(authority301, predicted), [], prediction).snapped).toBe(true);
  });

  it.each([
    ['predicted center outside radius', (base: ArenaSnapshot) => ({ ...base, arena: { ...base.arena, radius: 500 } })],
    ['body overlap', (base: ArenaSnapshot) => ({ ...base, players: base.players.map(p => p.sessionId === 20 ? { ...p, x: 1200 } : p) })],
    ['phase difference', (base: ArenaSnapshot) => ({ ...base, phase: 'roundReset' as const })],
    ['score difference', (base: ArenaSnapshot) => ({ ...base, score: [1, 0] as [number, number] })],
    ['dash contradiction', (base: ArenaSnapshot) => ({ ...base, players: base.players.map(p => p.sessionId === 10 ? { ...p, dashAvailable: false } : p) })],
    ['cooldown contradiction', (base: ArenaSnapshot) => ({ ...base, players: base.players.map(p => p.sessionId === 10 ? { ...p, cooldownTicks: 5 } : p) })],
  ])('snaps on %s', (_label, mutate) => {
    const previous = reconcile(authority(), [pending(8, 101, 101)], prediction).local;
    expect(reconcile(authority(mutate(snapshot()), previous), [pending(8, 101, 101)], prediction).snapped).toBe(true);
  });
});

describe('arena interpolation and layout', () => {
  it('interpolates matching IDs and shortest normalized aim at now minus the buffer', () => {
    const first = snapshot({
      generatedAtUnixMs: 0, sequence: 1,
      players: snapshot().players.map(p => p.sessionId === 20 ? { ...p, aimX: -32767, aimY: 1000 } : p),
    });
    const second = snapshot({
      generatedAtUnixMs: 50, sequence: 2,
      players: snapshot().players.map(p => p.sessionId === 20 ? { ...p, x: -2000, aimX: -32767, aimY: -1000 } : p),
      arena: { radius: 8000, shrinkPhase: 'normal' },
    });
    const sampled = sampleTimeline([second, first], 125, 100, 50);
    expect(sampled.players.find(p => p.sessionId === 20)?.x).toBe(-2500);
    expect(sampled.arena.radius).toBe(8500);
    expect(sampled.players.find(p => p.sessionId === 20)?.aimY).toBe(0);
  });

  it('caps extrapolation at 50ms and then holds the latest frame', () => {
    const first = snapshot({ generatedAtUnixMs: 0, sequence: 1 });
    const second = snapshot({ generatedAtUnixMs: 50, sequence: 2,
      players: snapshot().players.map(p => p.sessionId === 20 ? { ...p, x: -2000, vx: 10 } : p) });
    expect(sampleTimeline([first, second], 175, 100, 50).players.find(p => p.sessionId === 20)?.x).toBe(-1985);
    expect(sampleTimeline([first, second], 400, 100, 50).players.find(p => p.sessionId === 20)?.x).toBe(-2000);
  });

  it('never extrapolates discrete state or projectile creation and removal', () => {
    const first = snapshot({ generatedAtUnixMs: 0, sequence: 1, phase: 'live', score: [0, 0], projectiles: [] });
    const second = snapshot({ generatedAtUnixMs: 50, sequence: 2, phase: 'roundReset', score: [1, 0], projectiles: [
      { id: 2, ownerSessionId: 20, x: 5, y: 6, vx: 7, vy: 8, chargePermille: 500 },
    ] });
    const sampled = sampleTimeline([first, second], 175, 100, 50);
    expect(sampled.phase).toBe('roundReset');
    expect(sampled.score).toEqual([1, 0]);
    expect(sampled.projectiles).toEqual(second.projectiles);
  });

  it('maps the fixed 20k world through exact letterboxing and back', () => {
    const layout = computeLayout(1200, 800);
    expect(layout).toEqual({ cssWidth: 1200, cssHeight: 800, size: 800, offsetX: 200, offsetY: 0 });
    expect(worldToScreen({ x: -10000, y: 10000 }, layout)).toEqual({ x: 200, y: 800 });
    expect(screenToWorld({ x: 1000, y: 0 }, layout)).toEqual({ x: 10000, y: -10000 });
  });
});
