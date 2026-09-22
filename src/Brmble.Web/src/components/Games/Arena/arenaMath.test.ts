import { describe, expect, it } from 'vitest';
import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaSnapshot,
} from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import {
  arenaRadius, computeLayout, constrainLocalDisplay, damp, knockback, movePerTick, normalizeQ15, rearVector, shrinkIntensity,
  projectileReachedBody, recoil, reconcile, resolveBodyOverlap, sampleTimeline, screenToWorld, stepLocal, worldToScreen,
} from './arenaMath';

const prediction: ArenaPredictionConstants = {
  unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
  momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30,
  shotCooldownTicks: 24, projectileRadius: 180, projectilePerTick: 240,
  projectileBaseKnockback: 130, projectileBonusKnockback: 220, recoilBase: 45,
  recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
};

// The minimum charge gate is pinned by its own tests below and by PREDICTION_V1,
// which is validated against the server. Tests whose subject is movement, recoil or
// input edges opt out of the gate, so their exact expectations keep describing what
// they are actually about instead of being refitted around a charge they never meant.
// The cast is deliberate: minChargeTicks is a literal type precisely so production
// code cannot vary it, and this fixture is not production configuration.
const ungated = { ...prediction, minChargeTicks: 0 } as unknown as ArenaPredictionConstants;


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
        chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0,
        acknowledgedInput: 7 },
      { sessionId: 20, side: 1, x: -3000, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0,
        chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0,
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
    let local = reconcile(authority(), [], ungated).local;
    local = stepLocal(local, { ...right, charging: true, dash: true }, ungated);
    expect(local.player.x).toBe(1330);
    expect(local.player.dashAvailable).toBe(false);
    local = stepLocal(local, { ...right, charging: false, fireReleased: true }, ungated);
    expect(local.player.x).toBe(1614);
    expect(local.player.vx).toBe(-42);
    expect(local.player.cooldownTicks).toBe(24);
    // Spawned at the pre-movement position plus the spawn offset (1330 + 780) and
    // then advanced by one velocity in its spawn tick, as the server does.
    expect(local.projectiles).toEqual([{
      id: -1, ownerSessionId: 10, x: 2350, y: 0, vx: 240, vy: 0, chargePermille: 11,
    }]);
  });

  describe('projectileReachedBody', () => {
    const shooter = { x: 0, y: 0 };
    const hitRadius = 600 + 180;
    const shot = (x: number) => ({ id: 1, ownerSessionId: 10, x, y: 0, vx: 240, vy: 0, chargePermille: 500 });

    it('is true on overlap, and once the body sits behind the shot within the hit radius of its line of flight', () => {
      expect(projectileReachedBody(shot(3000), { x: 3600, y: 0 }, shooter, hitRadius)).toBe(true);
      expect(projectileReachedBody(shot(5000), { x: 3000, y: 700 }, shooter, hitRadius)).toBe(true);
      // Just within the slack behind the shooter's own projection.
      expect(projectileReachedBody(shot(5000), { x: -500, y: 0 }, shooter, hitRadius)).toBe(true);
    });

    it('is false while the body is ahead, off the line, or further back than the shooter', () => {
      expect(projectileReachedBody(shot(1000), { x: 3000, y: 0 }, shooter, hitRadius)).toBe(false);
      expect(projectileReachedBody(shot(5000), { x: 3000, y: 900 }, shooter, hitRadius)).toBe(false);
      expect(projectileReachedBody(shot(5000), { x: -2000, y: 0 }, shooter, hitRadius)).toBe(false);
      expect(projectileReachedBody({ ...shot(5000), vx: 0 }, { x: 3000, y: 0 }, shooter, hitRadius)).toBe(false);
    });
  });

  it('advances every projectile one velocity per live tick and drops it at the arena edge, as the server does', () => {
    const base = reconcile(authority(snapshot({ projectiles: [
      { id: 7, ownerSessionId: 10, x: 1000, y: 0, vx: 240, vy: 0, chargePermille: 500 },
      { id: 8, ownerSessionId: 20, x: -2000, y: 500, vx: -240, vy: 0, chargePermille: 500 },
      { id: 9, ownerSessionId: 10, x: 8800, y: 0, vx: 240, vy: 0, chargePermille: 500 },
    ] })), [], prediction).local;
    const still = { ...right, moveX: 0 };

    const next = stepLocal(base, still, prediction);

    // Own and opponent's alike, so an authoritative projectile replayed to the local
    // tick lands exactly where the predicted one it replaces was; the one at 8800
    // crosses the 9000 radius and goes, exactly as RemoveExpiredProjectiles would.
    expect(next.projectiles).toEqual([
      { id: 7, ownerSessionId: 10, x: 1240, y: 0, vx: 240, vy: 0, chargePermille: 500 },
      { id: 8, ownerSessionId: 20, x: -2240, y: 500, vx: -240, vy: 0, chargePermille: 500 },
    ]);
    // Not during positioning: the server's projectile stages are live-only.
    const positioning = reconcile(authority(snapshot({ phase: 'positioning', projectiles: base.projectiles })), [], prediction).local;
    expect(stepLocal(positioning, still, prediction).projectiles).toEqual(base.projectiles);
  });

  it('starts the forced-fire countdown at full charge and fires only when it expires', () => {
    // Starting at x = 0: 120 ticks of charged movement from the fixture's 1000 would
    // put the spawn point past the 9000 radius, and the shot would leave the arena in
    // the tick it was fired - as it does on the server.
    const start = snapshot({ players: snapshot().players.map(player => player.sessionId === 10 ? { ...player, x: 0 } : player) });
    let local = reconcile(authority(start), [], prediction).local;
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

  it('replays by tick, not by acknowledgement, and through the local tick when given one', () => {
    // Acknowledged means received: the server applies at the stamp, so an
    // acknowledged interval past the snapshot's tick is still replayed.
    const authorityAt = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10 ? { ...player, acknowledgedInput: 9 } : player),
    });
    const acknowledgedButFuture = reconcile(authority(authorityAt), [pending(9, 104, 106)], prediction);
    expect(acknowledgedButFuture.replayedTicks).toBe(3);
    expect(acknowledgedButFuture.local.player.x).toBe(1000 + 3 * 90);

    // The newest interval is open-ended: given the local tick, it replays through it.
    const through = reconcile(authority(authorityAt), [pending(9, 104, 104)], prediction, 110);
    expect(through.replayedTicks).toBe(7);
    expect(through.local.player.x).toBe(1000 + 7 * 90);

    // Only the newest is widened; a superseded interval keeps its bounds.
    const two = reconcile(authority(authorityAt), [pending(9, 104, 105), pending(10, 106, 106, { ...right, moveX: 0 })], prediction, 110);
    expect(two.replayedTicks).toBe(7);
    expect(two.local.player.x).toBe(1000 + 2 * 90);

    // An interval already behind the snapshot contributes nothing either way.
    const behind = reconcile(authority(authorityAt), [pending(8, 100, 102), pending(9, 104, 104)], prediction);
    expect(behind.replayedTicks).toBe(1);
  });

  it('carries same-tick empty edge flags into the next nonempty interval exactly once', () => {
    const next = reconcile(authority(), [
      pending(8, 101, 100, { ...right, dash: true }),
      pending(9, 101, 100, { ...right, fireReleased: true }),
      pending(10, 101, 101),
    ], ungated);
    expect(next.replayedTicks).toBe(1);
    expect(next.local.player.x).toBe(1285);
    expect(next.local.player.dashAvailable).toBe(false);
    expect(next.local.projectiles).toHaveLength(1);
  });

  // The server grants a dash at a tick it knows and counts down the applications it
  // still owes. `dashTicksRemaining` is that count, so the client never has to work
  // out when a dash began. These four tests replace an earlier set that pinned an
  // inference built from the client's own acknowledged inputs; that inference could
  // not tell a dash the server honoured from one it accepted and silently stripped,
  // which is the defect they now guard against.

  it('continues only the dash ticks the server still owes after a mid-burst snapshot', () => {
    // Granted at 101, so after tick 103 three applications are outstanding: 104-106.
    const midDash = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, dashTicksRemaining: 3, acknowledgedInput: 8 }
        : player),
    });
    const continued = reconcile(authority(midDash), [pending(9, 104, 106)], prediction);
    expect(continued.replayedTicks).toBe(3);
    expect(continued.local.dashTicks).toBe(0);
    expect(continued.local.player.x).toBe(2980);
  });

  it('takes the dash window from the server instead of inferring one', () => {
    const midDash = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, dashTicksRemaining: 3 }
        : player),
    });
    let local = reconcile(authority(midDash), [], prediction).local;
    // Owed applications land on 104, 105 and 106; stepLocal dashes while
    // tick < dashEndsAtTick, so the exclusive end is 107.
    expect(local.dashEndsAtTick).toBe(107);
    expect(local.dashTicks).toBe(3);

    const travelled: number[] = [];
    for (let step = 0; step < 4; step++) {
      const before = local.player.x;
      local = stepLocal(local, right, prediction);
      travelled.push(local.player.x - before);
    }
    const dashing = prediction.baseMovePerTick + prediction.dashPerTick;
    expect(travelled).toEqual([dashing, dashing, dashing, prediction.baseMovePerTick]);
  });

  it('does not dash on a press the server accepted but refused', () => {
    // Spamming space once the round's dash is spent. The server strips the flag and
    // acknowledges the input exactly as it would one it honoured, so the
    // acknowledgement is no evidence; dashAvailable has been false since the real
    // dash. Only dashTicksRemaining distinguishes the two, and here it is zero.
    const refused = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, dashTicksRemaining: 0, acknowledgedInput: 8 }
        : player),
    });
    const local = reconcile(authority(refused), [], prediction).local;
    expect(local.dashEndsAtTick).toBeNull();
    expect(local.dashTicks).toBe(0);
    const stepped = stepLocal(local, right, prediction);
    expect(stepped.player.x - local.player.x).toBe(prediction.baseMovePerTick);
  });

  it('replays an unacknowledged dash press without re-arming a spent dash', () => {
    const refused = snapshot({
      serverTick: 103,
      players: snapshot().players.map(player => player.sessionId === 10
        ? { ...player, x: 1990, dashAvailable: false, dashTicksRemaining: 0, acknowledgedInput: 8 }
        : player),
    });
    const next = reconcile(authority(refused), [pending(9, 104, 104, { ...right, dash: true })], prediction);
    expect(next.local.dashEndsAtTick).toBeNull();
    expect(next.local.player.x).toBe(1990 + prediction.baseMovePerTick);
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
    dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0, ...overrides,
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
    const source = body({ sessionId: 10, side: 0, x: 0, y: 0, vx: 41, vy: -17, aimX: 100, aimY: -200, chargePermille: 333, forcedFireTicks: 4, cooldownTicks: 7, dashAvailable: false, dashTicksRemaining: 0, acknowledgedInput: 12 });
    const result = resolveBodyOverlap(source, high(1000), 600);
    expect(result.a).toEqual({ ...source, x: -100 });
    expect(source.x).toBe(0);
  });
});

describe('stepLocal arena clamp during positioning', () => {
  const idle = { moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };
  const positioning = (x: number) => reconcile(
    authority(snapshot({
      phase: 'positioning',
      arena: { radius: 9000, shrinkPhase: 'hold' },
      players: [
        { ...snapshot().players[0], x, y: 0, vx: 0, vy: 0 },
        { ...snapshot().players[1], x: -8000, y: 0, vx: 0, vy: 0 },
      ],
    })),
    [],
    prediction,
  ).local;

  it('keeps a player walking at the edge inside the ring', () => {
    // 8950 + 90 = 9040, outside 9000. 9040 * 9000 / (9040 + 1) truncates to 8999.
    const next = stepLocal(positioning(8950), idle, prediction);
    expect(next.player.x).toBe(8999);
    expect(next.player.y).toBe(0);
  });

  it('leaves a player well inside the ring untouched', () => {
    const next = stepLocal(positioning(0), idle, prediction);
    expect(next.player.x).toBe(90);
  });

  it('does not clamp once the round is live', () => {
    const live = { ...positioning(8950), phase: 'live' as const };
    expect(stepLocal(live, idle, prediction).player.x).toBe(9040);
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

  it('settles at a stable separation through sustained contact', () => {
    let state = liveState(0, 1000);
    for (let tick = 0; tick < 120; tick++) state = stepLocal(state, idle, prediction);
    // Converges after one push and is a fixed point thereafter: exactly one diameter.
    expect(state.player.x).toBe(-100);
    expect(state.opponent!.x).toBe(1100);
  });
});

describe('overlap snap tuning', () => {
  const contact = (opponentX: number) => {
    const base = snapshot({
      phase: 'live',
      players: [
        { ...snapshot().players[0], x: 0, y: 0, vx: 0, vy: 0 },
        { ...snapshot().players[1], x: opponentX, y: 0, vx: 0, vy: 0 },
      ],
    });
    const previous = reconcile(authority(base), [], prediction).local;
    return reconcile({ ...authority(base), previous }, [], prediction);
  };

  it('does not snap for ordinary shallow contact', () => {
    expect(contact(1150).snapped).toBe(false);
  });

  it('snaps when the bodies are deeply interpenetrated', () => {
    expect(contact(899).snapped).toBe(true);
    expect(contact(900).snapped).toBe(false);
  });
});

describe('constrainLocalDisplay', () => {
  const body = (overrides: Partial<ArenaPlayerSnapshot> = {}): ArenaPlayerSnapshot => ({
    sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0,
    chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0,
    dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0, ...overrides,
  });
  const clear = (local: ArenaPlayerSnapshot, remote: ArenaPlayerSnapshot) => {
    const dx = local.x - remote.x;
    const dy = local.y - remote.y;
    return dx * dx + dy * dy;
  };

  it('pushes the local player fully clear of the remote circle', () => {
    const remote = body({ sessionId: 20, side: 1, x: 0, y: 0 });
    const result = constrainLocalDisplay(body({ x: 400, y: 0 }), remote, 600, 9000);
    expect(clear(result, remote)).toBeGreaterThanOrEqual(1200 * 1200);
    expect(result.y).toBe(0);
  });

  it('clears diagonal overlap fully', () => {
    const remote = body({ sessionId: 20, side: 1, x: 100, y: -250 });
    const result = constrainLocalDisplay(body({ x: 500, y: 300 }), remote, 600, 9000);
    expect(clear(result, remote)).toBeGreaterThanOrEqual(1200 * 1200);
  });

  it('leaves an already separated local player untouched', () => {
    const local = body({ x: 3000, y: 0 });
    const result = constrainLocalDisplay(local, body({ sessionId: 20, side: 1, x: 0, y: 0 }), 600, 9000);
    expect(result).toBe(local);
  });

  it('separates coincident centers along positive x', () => {
    const result = constrainLocalDisplay(body({ x: 0, y: 0 }), body({ sessionId: 20, side: 1, x: 0, y: 0 }), 600, 9000);
    expect(result.x).toBeGreaterThanOrEqual(1200);
    expect(result.y).toBe(0);
  });

  it('never renders the local player outside the arena radius', () => {
    const remote = body({ sessionId: 20, side: 1, x: 8800, y: 0 });
    const result = constrainLocalDisplay(body({ x: 8900, y: 0 }), remote, 600, 9000);
    expect(result.x).toBe(9000);
    expect(result.y).toBe(0);
    expect(result.x * result.x + result.y * result.y).toBeLessThanOrEqual(9000 * 9000);
  });

  it('returns the local player unchanged when there is no remote player', () => {
    const local = body({ x: 10, y: 20 });
    expect(constrainLocalDisplay(local, null, 600, 9000)).toBe(local);
  });

  it('never mutates its inputs and preserves every non-position field', () => {
    const local = body({ x: 400, vx: 31, vy: -9, aimX: 12, aimY: -34, chargePermille: 500, cooldownTicks: 3, dashAvailable: false, dashTicksRemaining: 0, acknowledgedInput: 8 });
    const remote = body({ sessionId: 20, side: 1, x: 0, y: 0 });
    const result = constrainLocalDisplay(local, remote, 600, 9000);
    expect(local.x).toBe(400);
    expect(remote.x).toBe(0);
    expect(result).not.toBe(local);
    expect(result.x).toBe(1201);
    expect({ ...result, x: 0, y: 0 }).toEqual({ ...local, x: 0, y: 0 });
  });
});

describe('rearVector', () => {
  const player = (aimX: number, aimY: number, side: 0 | 1) => ({ aimX, aimY, side }) as const;

  it('points opposite a normalized aim', () => {
    expect(rearVector(player(0, -32767, 0))).toEqual({ x: 0, y: 1 });
  });

  it('normalizes a non-unit aim before reversing it', () => {
    const rear = rearVector(player(3000, 4000, 1));
    expect(rear.x).toBeCloseTo(-0.6, 6);
    expect(rear.y).toBeCloseTo(-0.8, 6);
  });

  it('falls back to the spawn orientation before the first input', () => {
    // Each side spawns facing away from its own edge, so the rear points back at it.
    expect(rearVector(player(0, 0, 0))).toEqual({ x: -1, y: 0 });
    expect(rearVector(player(0, 0, 1))).toEqual({ x: 1, y: 0 });
  });
});

describe('shrinkIntensity', () => {
  it('is zero while the arena is still at full size', () => {
    expect(shrinkIntensity(9_000)).toBe(0);
  });

  it('reaches one only when the arena has closed completely', () => {
    expect(shrinkIntensity(0)).toBe(1);
  });

  it('ramps continuously across the collapse, not just the normal shrink', () => {
    // arenaRadius runs 9000 -> 3500 over the normal phase and 3500 -> 0 over the
    // collapse, so the handover must not be the top of the ramp.
    expect(shrinkIntensity(3_500)).toBeCloseTo(1 - 3_500 / 9_000, 6);
    expect(shrinkIntensity(1_750)).toBeGreaterThan(shrinkIntensity(3_500));
  });

  it('clamps outside the arena bounds', () => {
    expect(shrinkIntensity(12_000)).toBe(0);
    expect(shrinkIntensity(-500)).toBe(1);
  });
});

describe('arena minimum charge gate', () => {
  const chargeFor = (ticks: number) => {
    let local = reconcile(authority(), [], prediction).local;
    for (let tick = 0; tick < ticks; tick++) {
      local = stepLocal(local, { ...right, moveX: 0, moveY: 0, charging: true }, prediction);
    }
    return local;
  };

  it('refuses a release below the minimum charge, exactly as the server does', () => {
    let local = chargeFor(prediction.minChargeTicks - 1);
    const restingVx = local.player.vx;

    local = stepLocal(local, { ...right, moveX: 0, moveY: 0, charging: false, fireReleased: true }, prediction);

    // No shot, no cooldown, no recoil, and the charge is cancelled rather than banked.
    expect(local.projectiles).toEqual([]);
    expect(local.player.cooldownTicks).toBe(0);
    expect(local.player.vx).toBe(restingVx);
    expect(local.chargeTicks).toBe(0);
  });

  it('fires at exactly the minimum charge', () => {
    let local = chargeFor(prediction.minChargeTicks);

    local = stepLocal(local, { ...right, moveX: 0, moveY: 0, charging: false, fireReleased: true }, prediction);

    expect(local.projectiles).toHaveLength(1);
    expect(local.player.cooldownTicks).toBe(prediction.shotCooldownTicks);
  });
});
