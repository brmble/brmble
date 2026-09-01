import { describe, expect, it } from 'vitest';
import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaSnapshot,
} from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import {
  arenaRadius, computeLayout, damp, knockback, movePerTick, normalizeQ15, recoil,
  reconcile, resolveBodyOverlap, sampleTimeline, screenToWorld, stepLocal, worldToScreen,
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

  it('clips replay intervals to ticks after authority and does not carry historical edges', () => {
    const next = reconcile(authority(snapshot({ serverTick: 103 })), [
      pending(8, 101, 102, { ...right, dash: true }),
      pending(9, 103, 105),
    ], prediction);
    expect(next.replayedTicks).toBe(2);
    expect(next.local.player.x).toBe(1180);
    expect(next.local.player.dashAvailable).toBe(true);
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

  it('continues only the remaining acknowledged dash ticks after a mid-burst snapshot', () => {
    const started = reconcile(authority(), [pending(8, 101, 106, { ...right, dash: true })], prediction).local;
    const midDash = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, acknowledgedInput: 8 }
        : player),
    });
    const continued = reconcile(authority(midDash, started), [pending(9, 104, 106)], prediction);
    expect(continued.replayedTicks).toBe(3);
    expect(continued.local.dashTicks).toBe(0);
    expect(continued.local.player.x).toBe(2980);
  });

  it('reconstructs acknowledged dash before prediction exists and clamps future predicted tick skew', () => {
    const dash = pending(8, 110, 110, { ...right, dash: true });
    const accepted = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, acknowledgedInput: 8 }
        : player),
    });
    const next = reconcile({ ...authority(accepted), recentInputs: [dash] }, [pending(9, 104, 106)], prediction);
    expect(next.local.player.x).toBe(2980);
    expect(next.local.dashTicks).toBe(2);
  });

  it.each([
    ['far behind', 90, 99, 105, [104]],
    ['lagging within the active window', 100, 100, 106, [104, 105]],
    ['exact', 103, 103, 109, [104, 105, 106, 107, 108]],
    ['future skew', 120, 103, 109, [104, 105, 106, 107, 108]],
  ])('keeps %s inferred dash movement within six ticks and stops at its exclusive end', (
    _label, predictedTick, expectedStart, expectedEnd, expectedMovementTicks,
  ) => {
    const accepted = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, dashAvailable: false, acknowledgedInput: 8 }
        : player),
    });
    const dash = { ...pending(8, predictedTick, predictedTick, { ...right, dash: true }), acknowledgedAtTick: 103 };
    let local = reconcile({ ...authority(accepted), recentInputs: [dash] }, [], prediction).local;
    const movementTicks: number[] = [];
    while (local.serverTick <= expectedEnd) {
      const before = local.player.x;
      local = stepLocal(local, right, prediction);
      if (local.player.x - before === prediction.baseMovePerTick + prediction.dashPerTick) {
        movementTicks.push(local.serverTick);
      }
    }

    expect(expectedEnd - expectedStart).toBeLessThanOrEqual(6);
    expect(local.dashEndsAtTick).toBe(expectedEnd);
    expect(movementTicks).toEqual(expectedMovementTicks);
    expect(movementTicks).not.toContain(expectedEnd);
  });

  it('ends inferred dash at its bounded end and never extends it past six authoritative ticks', () => {
    const dash = { ...pending(8, 120, 120, { ...right, dash: true }), acknowledgedAtTick: 103 };
    const accepted = snapshot({ serverTick: 103, players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, dashAvailable: false, acknowledgedInput: 8 }
      : player) });
    const first = reconcile({ ...authority(accepted), recentInputs: [dash] }, [], prediction).local;
    const atEnd = snapshot({ ...accepted, serverTick: 109 });
    const ended = reconcile({ ...authority(atEnd, first), recentInputs: [dash] }, [], prediction).local;
    expect(ended.dashTicks).toBe(0);
    expect(ended.dashEndsAtTick).toBeNull();
    const later = reconcile({ ...authority(snapshot({ ...accepted, serverTick: 110 }), ended), recentInputs: [dash] }, [], prediction).local;
    expect(later.dashEndsAtTick).toBeNull();
  });

  it('smooths a 300-unit correction and snaps a 301-unit correction', () => {
    const predicted = reconcile(authority(), [pending(8, 101, 101)], prediction).local;
    const authority300 = snapshot({ players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, x: predicted.player.x + 210 }
      : player) });
    const authority301 = snapshot({ players: snapshot().players.map(player => player.sessionId === 10
      ? { ...player, x: predicted.player.x + 211 }
      : player) });
    expect(reconcile(authority(authority300, predicted), [pending(8, 101, 101)], prediction).snapped).toBe(false);
    expect(reconcile(authority(authority300, predicted), [pending(8, 101, 101)], prediction).correction).toEqual({ x: 300, y: 0, durationMs: 100 });
    expect(reconcile(authority(authority301, predicted), [pending(8, 101, 101)], prediction).snapped).toBe(true);
  });

  it('does not predict KO and detects authority KO changes independently', () => {
    const previous = reconcile(authority(snapshot({ arena: { radius: 2000, shrinkPhase: 'hold' } })), [], prediction).local;
    const moved = stepLocal({ ...previous, player: { ...previous.player, x: 1990 } }, right, prediction);
    expect(moved.player.x).toBeGreaterThan(2000);
    expect(moved.localKo).toBe(false);
    const knockedOut = snapshot({
      arena: { radius: 2000, shrinkPhase: 'hold' },
      players: snapshot().players.map(player => player.sessionId === 10 ? { ...player, x: 2001 } : player),
    });
    expect(reconcile(authority(knockedOut, previous), [], prediction).snapped).toBe(true);
  });

  it.each([
    ['awaitingParticipants', 1000, 10, 5, 32767],
    ['loading', 1000, 10, 5, 32767],
    ['positioning', 1090, 10, null, 0],
    ['live', 1340, 9, null, 0],
    ['ended', 1000, 10, 5, 32767],
  ] as const)('mirrors %s phase gates', (phase, expectedX, expectedCooldown, expectedForcedFire, expectedAimX) => {
    const base = reconcile(authority(snapshot({ phase })), [], prediction).local;
    const next = stepLocal({ ...base, player: { ...base.player, cooldownTicks: 10, forcedFireTicks: 5, vx: 10 } },
      { ...right, aimX: 0, aimY: 32767, dash: true, fireReleased: true }, prediction);
    expect(next.player.x).toBe(expectedX);
    expect(next.player.aimX).toBe(expectedAimX);
    expect(next.player.cooldownTicks).toBe(expectedCooldown);
    expect(next.player.forcedFireTicks).toBe(expectedForcedFire);
    expect(next.projectiles).toHaveLength(0);
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

  it('keeps left discrete state and membership until the right timestamp', () => {
    const shared = { id: 1, ownerSessionId: 20, x: 0, y: 0, vx: 0, vy: 0, chargePermille: 0 };
    const removed = { ...shared, id: 2 };
    const created = { ...shared, id: 3 };
    const first = snapshot({ generatedAtUnixMs: 0, sequence: 1, phase: 'live', score: [0, 0], projectiles: [shared, removed] });
    const second = snapshot({
      generatedAtUnixMs: 50, sequence: 2, phase: 'roundReset', score: [1, 0], projectiles: [{ ...shared, x: 100 }, created],
      players: snapshot().players.map(player => ({ ...player, cooldownTicks: 9, dashAvailable: false })),
    });
    const before = sampleTimeline([first, second], 125, 100, 50);
    expect(before.phase).toBe('live');
    expect(before.score).toEqual([0, 0]);
    expect(before.players[0].cooldownTicks).toBe(0);
    expect(before.players[0].dashAvailable).toBe(true);
    expect(before.projectiles.map(projectile => projectile.id)).toEqual([1, 2]);
    expect(sampleTimeline([first, second], 150, 100, 50).projectiles.map(projectile => projectile.id)).toEqual([1, 3]);
  });

  it('selects the highest sequence at equal timestamps and preserves zero aim', () => {
    const low = snapshot({ generatedAtUnixMs: 50, sequence: 2 });
    const high = snapshot({ generatedAtUnixMs: 50, sequence: 3, score: [1, 0],
      players: snapshot().players.map(player => player.sessionId === 20 ? { ...player, aimX: 0, aimY: 0 } : player) });
    const later = snapshot({ generatedAtUnixMs: 100, sequence: 4 });
    const sampled = sampleTimeline([later, high, low], 175, 100, 50);
    expect(sampled.score).toEqual([1, 0]);
    expect(sampled.players.find(player => player.sessionId === 20)?.aimX).toBe(0);
    expect(sampled.players.find(player => player.sessionId === 20)?.aimY).toBe(0);
  });

  it('maps the fixed 20k world through exact letterboxing and back', () => {
    const layout = computeLayout(1200, 800);
    expect(layout).toEqual({ cssWidth: 1200, cssHeight: 800, size: 800, offsetX: 200, offsetY: 0 });
    expect(worldToScreen({ x: -10000, y: 10000 }, layout)).toEqual({ x: 200, y: 800 });
    expect(screenToWorld({ x: 1000, y: 0 }, layout)).toEqual({ x: 10000, y: -10000 });
  });
});

describe('resolveBodyOverlap', () => {
  const body = (overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot => ({
    sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0,
    dashAvailable: true, acknowledgedInput: 0, ...overrides,
  });
  const low = (x: number, y = 0) => body({ sessionId: 10, side: 0, x, y });
  const high = (x: number, y = 0) => body({ sessionId: 20, side: 1, x, y });

  it('leaves separated bodies untouched', () => {
    const result = resolveBodyOverlap(low(0), high(2000), 600);
    expect([result.a.x, result.b.x]).toEqual([0, 2000]);
  });

  it('does not push bodies that exactly touch at one diameter', () => {
    const result = resolveBodyOverlap(low(0), high(1200), 600);
    expect([result.a.x, result.b.x]).toEqual([0, 1200]);
  });

  it('splits even penetration in half', () => {
    // distance 1000, penetration 200, lowShare 100, highShare 100.
    // normal.x = trunc(1000 * 32767 / 1000) = 32767, push = trunc(32767 * 100 / 32767) = 100.
    const result = resolveBodyOverlap(low(0), high(1000), 600);
    expect([result.a.x, result.b.x]).toEqual([-100, 1100]);
  });

  it('assigns the odd penetration unit to side 1', () => {
    // distance 1001, penetration 199, lowShare 99, highShare 100.
    const result = resolveBodyOverlap(low(0), high(1001), 600);
    expect([result.a.x, result.b.x]).toEqual([-99, 1101]);
  });

  it('orders by side, not by argument order', () => {
    const result = resolveBodyOverlap(high(1000), low(0), 600);
    expect([result.a.x, result.b.x]).toEqual([1100, -100]);
  });

  it('separates coincident centers along positive x', () => {
    // distance 0, normal (32767, 0), penetration 1200, lowShare 600, highShare 600.
    const result = resolveBodyOverlap(low(0), high(0), 600);
    expect([result.a.x, result.a.y, result.b.x, result.b.y]).toEqual([-600, 0, 600, 0]);
  });

  it('truncates negative normal components toward zero', () => {
    // low at (500, 500), high at (0, 0): dx = -500, dy = -500.
    // distanceSquared 500000, distance = integerSqrt = 707, penetration 493,
    // lowShare 246, highShare 247.
    // normal.x = trunc(-500 * 32767 / 707) = trunc(-23173.6...) = -23173 (toward zero).
    // lowPush = trunc(-23173 * 246 / 32767) = trunc(-173.98...) = -173.
    // highPush = trunc(-23173 * 247 / 32767) = trunc(-174.68...) = -174.
    const result = resolveBodyOverlap(body({ sessionId: 10, side: 0, x: 500, y: 500 }), high(0, 0), 600);
    expect([result.a.x, result.a.y]).toEqual([673, 673]);
    expect([result.b.x, result.b.y]).toEqual([-174, -174]);
  });

  it('does not renormalize, so one call can under-separate diagonally', () => {
    const result = resolveBodyOverlap(body({ sessionId: 10, side: 0, x: 500, y: 500 }), high(0, 0), 600);
    const dx = result.a.x - result.b.x;
    const dy = result.a.y - result.b.y;
    expect(dx * dx + dy * dy).toBeLessThan(1200 * 1200);
  });

  it('preserves velocity and every non-position field', () => {
    const source = body({ sessionId: 10, side: 0, x: 0, y: 0, vx: 41, vy: -17, aimX: 100, aimY: -200, chargePermille: 333, forcedFireTicks: 4, cooldownTicks: 7, dashAvailable: false, acknowledgedInput: 12 });
    const result = resolveBodyOverlap(source, high(1000), 600);
    expect(result.a).toEqual({ ...source, x: -100 });
    expect(source.x).toBe(0);
  });
});

describe('stepLocal body overlap', () => {
  const liveState = (localX: number, opponentX: number) => reconcile(
    authority(snapshot({
      phase: 'live',
      players: [
        { ...snapshot().players[0], sessionId: 10, side: 0, x: localX, y: 0, vx: 0, vy: 0 },
        { ...snapshot().players[1], sessionId: 20, side: 1, x: opponentX, y: 0, vx: 0, vy: 0 },
      ],
    })),
    [],
    prediction,
  ).local;

  const idle = { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };

  it('separates the predicted local player from an overlapping opponent', () => {
    const next = stepLocal(liveState(0, 1000), idle, prediction);
    expect(next.player.x).toBe(-100);
    expect(next.opponent?.x).toBe(1100);
  });

  it('does not touch positions when the bodies are clear', () => {
    const next = stepLocal(liveState(0, 4000), idle, prediction);
    expect(next.player.x).toBe(0);
    expect(next.opponent?.x).toBe(4000);
  });

  it('dead-reckons the opponent forward by its velocity before resolving overlap', () => {
    const state = liveState(0, 1300);
    state.opponent = { ...state.opponent!, vx: -200 };
    // Opponent dead-reckons to 1100, penetration 100, lowShare 50, highShare 50.
    const next = stepLocal(state, idle, prediction);
    expect(next.player.x).toBe(-50);
    expect(next.opponent?.x).toBe(1150);
    expect(next.opponent?.vx).toBe(-200);
  });

  it('skips the overlap stage when there is no opponent', () => {
    const state = liveState(0, 1000);
    state.opponent = null;
    expect(stepLocal(state, idle, prediction).player.x).toBe(0);
  });

  it('keeps prediction error bounded through sustained contact', () => {
    let state = liveState(0, 1000);
    for (let tick = 0; tick < 120; tick++) state = stepLocal(state, idle, prediction);
    const dx = state.player.x - state.opponent!.x;
    // Never drifts far past a single separation; nowhere near the 300-unit snap threshold.
    expect(Math.abs(dx)).toBeLessThan(1300);
  });
});

