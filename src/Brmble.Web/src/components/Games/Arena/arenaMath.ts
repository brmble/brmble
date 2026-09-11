import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaProjectileSnapshot,
  ArenaSnapshot, ArenaStateSnapshot,
} from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';

export interface FixedVec {
  x: number;
  y: number;
}

// Q15 fixed-point unit. `Q15_MAX` is the bigint form used by the checked bigint
// arithmetic; the exported `Q15` below is the same value as a number.
const Q15_MAX = 32_767n;
const PERMILLE = 1_000n;

function checkedNumber(value: bigint): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Fixed-point result exceeds the safe integer range');
  }

  return Number(value);
}

function multiplyDivide(value: number, multiplier: number, divisor: number): number {
  return checkedNumber((BigInt(value) * BigInt(multiplier)) / BigInt(divisor));
}

function multiplyDivideTruncated(value: number, multiplier: number, divisor: number): number {
  return checkedNumber((BigInt(value) * BigInt(multiplier)) / BigInt(divisor));
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new RangeError('Integer square root requires a non-negative value');
  }

  let remainder = value;
  let result = 0n;
  let bit = 1n;

  while (bit <= (remainder >> 2n)) {
    bit <<= 2n;
  }

  while (bit !== 0n) {
    if (remainder >= result + bit) {
      remainder -= result + bit;
      result = (result >> 1n) + bit;
    } else {
      result >>= 1n;
    }

    bit >>= 2n;
  }

  return result;
}

// Number-typed twin of `Q15_MAX` above, for the integer (non-bigint) call sites.
export const Q15 = Number(Q15_MAX);

/**
 * Exact mirror of the position arithmetic in ArenaSimulation.ResolveBodyOverlap
 * (stage 9 of the server tick). Two things the server method does are deliberately
 * omitted because they are caller-owned on the client: the `Phase == Loading` early
 * return (ArenaSimulation.cs:398) and the `RecordBoundaryTransition` calls (:426-427).
 * Feeds deterministic replay, so every truncation here must match C# integer
 * division, which truncates toward zero. Do not renormalize the Q15 normal:
 * the server does not, so a single call may leave the bodies slightly overlapped.
 */
export function resolveBodyOverlap(
  a: ArenaPlayerSnapshot,
  b: ArenaPlayerSnapshot,
  playerRadius: number,
): { a: ArenaPlayerSnapshot; b: ArenaPlayerSnapshot } {
  const aIsLow = a.side === 0;
  const low = aIsLow ? a : b;
  const high = aIsLow ? b : a;
  const dx = high.x - low.x;
  const dy = high.y - low.y;
  const distanceSquared = dx * dx + dy * dy;
  const diameter = playerRadius * 2;
  if (distanceSquared >= diameter * diameter) {
    return { a, b };
  }

  const distance = Number(integerSqrt(BigInt(distanceSquared)));
  const normalX = distance === 0 ? Q15 : Math.trunc((dx * Q15) / distance);
  const normalY = distance === 0 ? 0 : Math.trunc((dy * Q15) / distance);
  const penetration = diameter - distance;
  const lowShare = Math.trunc(penetration / 2);
  const highShare = penetration - lowShare;

  const nextLow: ArenaPlayerSnapshot = {
    ...low,
    x: low.x - Math.trunc((normalX * lowShare) / Q15),
    y: low.y - Math.trunc((normalY * lowShare) / Q15),
  };
  const nextHigh: ArenaPlayerSnapshot = {
    ...high,
    x: high.x + Math.trunc((normalX * highShare) / Q15),
    y: high.y + Math.trunc((normalY * highShare) / Q15),
  };
  return aIsLow ? { a: nextLow, b: nextHigh } : { a: nextHigh, b: nextLow };
}

/**
 * Display filter, not client authority. The local player is presented at
 * approximately now while the remote player is replayed from a 100 ms buffer,
 * so displayed bodies can overlap even when both source states are valid.
 * The error is entirely local, so only the local player moves; the remote
 * player must never deviate from its authoritative interpolated path.
 *
 * The result is never written back into prediction, presentation, snapshots,
 * pending inputs, or the correction origin.
 *
 * Separation yields to the arena clamp: if clearing the remote would put the
 * local player outside the ring, the clamp wins and the bodies may still
 * overlap on screen. Rendering outside the ring without an authoritative
 * knockout is the worse artefact.
 */
export function constrainLocalDisplay(
  local: ArenaPlayerSnapshot,
  remote: ArenaPlayerSnapshot | null,
  playerRadius: number,
  arenaRadius: number,
): ArenaPlayerSnapshot {
  if (remote === null) return local;
  const dx = local.x - remote.x;
  const dy = local.y - remote.y;
  const distanceSquared = dx * dx + dy * dy;
  const diameter = playerRadius * 2;
  if (distanceSquared >= diameter * diameter) return local;

  const distance = Math.sqrt(distanceSquared);
  const unitX = distance === 0 ? 1 : dx / distance;
  const unitY = distance === 0 ? 0 : dy / distance;
  // One extra unit absorbs the rounding below, so the result always clears a
  // full diameter rather than landing a unit short of it.
  let x = Math.round(remote.x + unitX * (diameter + 1));
  let y = Math.round(remote.y + unitY * (diameter + 1));

  const radiusSquared = x * x + y * y;
  if (radiusSquared > arenaRadius * arenaRadius) {
    const length = Math.sqrt(radiusSquared);
    x = Math.trunc(x * arenaRadius / length);
    y = Math.trunc(y * arenaRadius / length);
  }
  return { ...local, x, y };
}

export function normalizeQ15(x: number, y: number): FixedVec {
  if (x === 0 && y === 0) {
    return { x: 0, y: 0 };
  }

  const bigX = BigInt(x);
  const bigY = BigInt(y);
  const length = integerSqrt(bigX * bigX + bigY * bigY);
  if (length <= Q15_MAX) {
    return { x, y };
  }

  return {
    x: checkedNumber((bigX * Q15_MAX) / length),
    y: checkedNumber((bigY * Q15_MAX) / length),
  };
}

export function scale(vector: FixedVec, amount: number): FixedVec {
  return {
    x: multiplyDivide(vector.x, amount, 32_767),
    y: multiplyDivide(vector.y, amount, 32_767),
  };
}

export function movePerTick(q: number): number {
  return 90 - multiplyDivide(45, Math.min(1000, Math.max(0, q)), 1000);
}

export function knockback(q: number): number {
  return 130 + multiplyDivide(220, Math.min(1000, Math.max(0, q)), 1000);
}

export function recoil(q: number): number {
  return 45 + multiplyDivide(105, Math.min(1000, Math.max(0, q)), 1000);
}

export function chargePermille(chargeTicks: number): number {
  const clampedTicks = Math.min(90, Math.max(0, chargeTicks));
  return Math.min(1000, multiplyDivide(clampedTicks, 1000, 90));
}

export function arenaRadius(liveTick: number): number {
  if (liveTick < 600) {
    return 9_000;
  }
  if (liveTick < 2_400) {
    return 9_000 - multiplyDivide(5_500, liveTick - 599, 1_800);
  }
  if (liveTick < 3_600) {
    return 3_500 - multiplyDivide(3_500, liveTick - 2_399, 1_200);
  }
  return 0;
}

// The rear reads as the player's back, so it points opposite the aim and rotates
// with it. Aim is zero-length only before the first input, where the spawn
// orientation — facing away from the player's own side — is the correct rear.
export function rearVector(player: Pick<ArenaPlayerSnapshot, 'aimX' | 'aimY' | 'side'>): {
  x: number;
  y: number;
} {
  const length = Math.hypot(player.aimX, player.aimY);
  if (length === 0) {
    return { x: player.side === 0 ? -1 : 1, y: 0 };
  }
  // Adding zero collapses -0 to 0, which is otherwise contagious through the
  // trig below and shows up in comparisons and serialized output.
  return { x: -player.aimX / length + 0, y: -player.aimY / length + 0 };
}

// How far the arena has closed, on 0..1. `arenaRadius` runs 9000 down to 3500 over
// the normal shrink and 3500 to 0 over the collapse, so the ramp spans the whole
// range rather than topping out at the handover between the two.
export function shrinkIntensity(radius: number): number {
  return Math.min(1, Math.max(0, 1 - radius / 9_000));
}

export function damp(vector: FixedVec): FixedVec {
  return {
    x: checkedNumber((BigInt(vector.x) * 920n) / PERMILLE),
    y: checkedNumber((BigInt(vector.y) * 920n) / PERMILLE),
  };
}

export interface PredictedArenaState {
  player: ArenaPlayerSnapshot;
  opponent: ArenaPlayerSnapshot | null;
  projectiles: ArenaProjectileSnapshot[];
  arena: ArenaStateSnapshot['arena'];
  phase: ArenaStateSnapshot['phase'];
  score: [number, number];
  localKo: boolean;
  serverTick: number;
  chargeTicks: number;
  dashTicks: number;
  dashEndsAtTick: number | null;
  nextProjectileId: number;
}

export interface ArenaCorrection extends FixedVec {
  durationMs: 100;
}

export interface ArenaAuthority {
  snapshot: ArenaSnapshot;
  selfSessionId: number;
  previous?: PredictedArenaState;
  correctionOrigin?: FixedVec;
}

function scaleBy(vector: FixedVec, amount: number): FixedVec {
  return {
    x: multiplyDivideTruncated(vector.x, amount, 32_767),
    y: multiplyDivideTruncated(vector.y, amount, 32_767),
  };
}

function chargeFromTicks(ticks: number, constants: ArenaPredictionConstants): number {
  return Math.min(1000, multiplyDivideTruncated(Math.min(constants.chargeTicks, Math.max(0, ticks)), 1000, constants.chargeTicks));
}

function ticksFromCharge(charge: number, constants: ArenaPredictionConstants): number {
  if (charge <= 0) return 0;
  return Math.min(constants.chargeTicks, Math.ceil(charge * constants.chargeTicks / 1000));
}

function moveAmount(charge: number, constants: ArenaPredictionConstants): number {
  const difference = constants.baseMovePerTick - constants.chargedMovePerTick;
  return constants.baseMovePerTick - multiplyDivideTruncated(difference, Math.min(1000, Math.max(0, charge)), 1000);
}

function recoilAmount(charge: number, constants: ArenaPredictionConstants): number {
  return constants.recoilBase
    + multiplyDivideTruncated(constants.recoilBonus, Math.min(1000, Math.max(0, charge)), 1000);
}

function cloneState(state: PredictedArenaState): PredictedArenaState {
  return {
    ...state,
    player: { ...state.player },
    opponent: state.opponent ? { ...state.opponent } : null,
    projectiles: state.projectiles.map(projectile => ({ ...projectile })),
    arena: { ...state.arena },
    score: [...state.score],
  };
}

export function stepLocal(
  current: PredictedArenaState,
  rawInput: ArenaInputState,
  constants: ArenaPredictionConstants,
): PredictedArenaState {
  if (current.phase === 'awaitingParticipants' || current.phase === 'loading' || current.phase === 'ended') {
    return cloneState(current);
  }
  const next = cloneState(current);
  const player = next.player;
  const tick = current.serverTick + 1;
  next.serverTick = tick;
  const movement = normalizeQ15(rawInput.moveX, rawInput.moveY);
  const aim = normalizeQ15(rawInput.aimX, rawInput.aimY);
  player.aimX = aim.x;
  player.aimY = aim.y;

  const live = next.phase === 'live';
  const forcedFire = live && player.forcedFireTicks === 1;
  if (live) {
    if (player.cooldownTicks > 0) player.cooldownTicks--;
    if (player.forcedFireTicks !== null) {
      player.forcedFireTicks--;
      if (player.forcedFireTicks <= 0) player.forcedFireTicks = null;
    }
  }

  if (!live || player.cooldownTicks > 0) {
    next.chargeTicks = 0;
    player.forcedFireTicks = null;
  } else if (rawInput.charging && next.chargeTicks < constants.chargeTicks) {
    next.chargeTicks++;
    if (next.chargeTicks === constants.chargeTicks) player.forcedFireTicks = constants.forcedFireTicks;
  }
  player.chargePermille = chargeFromTicks(next.chargeTicks, constants);

  if (rawInput.dash && live && player.dashAvailable) {
    player.dashAvailable = false;
    next.dashEndsAtTick = tick + constants.dashTicks;
  }

  // Mirrors the server exactly: a release below the minimum charge fires nothing,
  // costs no cooldown and cancels the charge. Predicting the shot here and having the
  // server refuse it would mispredict both a projectile and a recoil impulse.
  const refused = rawInput.fireReleased && next.chargeTicks < constants.minChargeTicks;

  if (refused) {
    next.chargeTicks = 0;
    player.chargePermille = 0;
  } else if (live && player.cooldownTicks === 0 && (rawInput.fireReleased || forcedFire)) {
    const spawn = scaleBy(aim, constants.playerRadius + constants.projectileRadius);
    const velocity = scaleBy(aim, constants.projectilePerTick);
    const recoilVector = scaleBy(aim, recoilAmount(player.chargePermille, constants));
    next.projectiles.push({
      id: next.nextProjectileId--,
      ownerSessionId: player.sessionId,
      x: player.x + spawn.x,
      y: player.y + spawn.y,
      vx: velocity.x,
      vy: velocity.y,
      chargePermille: player.chargePermille,
    });
    player.vx -= recoilVector.x;
    player.vy -= recoilVector.y;
    next.chargeTicks = 0;
    player.chargePermille = 0;
    player.forcedFireTicks = null;
    player.cooldownTicks = constants.shotCooldownTicks;
  }

  const movementDelta = scaleBy(movement, moveAmount(player.chargePermille, constants));
  player.x += movementDelta.x;
  player.y += movementDelta.y;
  if (live && next.dashEndsAtTick !== null && tick < next.dashEndsAtTick) {
    const dashDirection = movement.x === 0 && movement.y === 0 ? aim : movement;
    const dashDelta = scaleBy(dashDirection, constants.dashPerTick);
    player.x += dashDelta.x;
    player.y += dashDelta.y;
  }
  next.dashTicks = next.dashEndsAtTick === null ? 0 : Math.max(0, next.dashEndsAtTick - tick - 1);
  if (live) {
    player.x += player.vx;
    player.y += player.vy;
    player.vx = multiplyDivideTruncated(player.vx, constants.momentumRetentionPermille, 1000);
    player.vy = multiplyDivideTruncated(player.vy, constants.momentumRetentionPermille, 1000);
  }

  // Server stage 9. The opponent is dead-reckoned from authority, never simulated:
  // no opponent input, dash, or fire is inferred. Same linear extrapolation
  // sampleTimeline already uses.
  if (next.opponent !== null) {
    const opponent = live
      ? { ...next.opponent, x: next.opponent.x + next.opponent.vx, y: next.opponent.y + next.opponent.vy }
      : { ...next.opponent };
    const resolved = resolveBodyOverlap(player, opponent, constants.playerRadius);
    next.player = resolved.a;
    next.opponent = resolved.b;
  }

  // Server stage 9b. Positioning lets players move but does not evaluate boundaries,
  // so without this a player could walk out of the ring during the countdown. Must
  // match ArenaSimulation.ClampToArenaBeforeLive exactly, including the distance + 1
  // divisor: integerSqrt truncates downward, so dividing by the raw distance would
  // leave the point fractionally outside.
  if (next.phase === 'positioning') {
    const radius = next.arena.radius;
    const distanceSquared = next.player.x * next.player.x + next.player.y * next.player.y;
    if (distanceSquared > radius * radius) {
      const distance = Number(integerSqrt(BigInt(distanceSquared)));
      if (distance !== 0) {
        const divisor = distance + 1;
        next.player = {
          ...next.player,
          x: Math.trunc(next.player.x * radius / divisor),
          y: Math.trunc(next.player.y * radius / divisor),
        };
      }
    }
  }

  return next;
}

function insideRadius(point: FixedVec, radius: number): boolean {
  const x = BigInt(point.x);
  const y = BigInt(point.y);
  return x * x + y * y <= BigInt(radius) * BigInt(radius);
}

/**
 * Deep interpenetration threshold, as a fraction of the player diameter.
 * Shallow overlap is expected: the local player is displayed at approximately
 * now while the remote player comes from a 100 ms buffer, and the server's
 * un-renormalized push can itself leave the bodies slightly overlapped.
 * Only genuine desynchronisation reaches this depth.
 */
const DEEP_OVERLAP_DIAMETER_FRACTION = 3 / 4;

function deeplyOverlapping(left: FixedVec, right: FixedVec, playerRadius: number): boolean {
  const dx = BigInt(left.x - right.x);
  const dy = BigInt(left.y - right.y);
  const limit = BigInt(Math.trunc(playerRadius * 2 * DEEP_OVERLAP_DIAMETER_FRACTION));
  return dx * dx + dy * dy < limit * limit;
}

function fromAuthority(authority: ArenaAuthority, constants: ArenaPredictionConstants): PredictedArenaState {
  const player = authority.snapshot.players.find(candidate => candidate.sessionId === authority.selfSessionId);
  if (!player) throw new Error('Arena authority does not contain the current session');
  const opponent = authority.snapshot.players.find(candidate => candidate.sessionId !== authority.selfSessionId) ?? null;
  // The server states what it owes; nothing here infers it. The previous shape of
  // this — reconstructing the window from the newest acknowledged dash in the
  // client's own sent inputs, gated only on `!dashAvailable` — was wrong in two
  // ways. A dash the server accepted but stripped (`DashSpent`) acknowledges
  // exactly like one it honoured, so after the round's first dash every further
  // press re-armed six ticks of 240-per-tick displacement the server never
  // applied: 720 units of pure fiction per press against a 300-unit snap
  // threshold, which is the spasming under spammed dash. And even a single honest
  // dash was placed by guesswork, since the wire never said which tick it began on.
  //
  // `dashTicksRemaining` counts applications still owed AFTER `serverTick`, so
  // those land on ticks `serverTick + 1 .. serverTick + remaining`, and `stepLocal`
  // applies while `tick < dashEndsAtTick` — hence the + 1.
  const dashEndsAtTick = player.dashTicksRemaining > 0
    ? authority.snapshot.serverTick + player.dashTicksRemaining + 1
    : null;
  return {
    player: { ...player }, opponent: opponent ? { ...opponent } : null,
    projectiles: authority.snapshot.projectiles.map(projectile => ({ ...projectile })),
    arena: { ...authority.snapshot.arena }, phase: authority.snapshot.phase,
    score: [...authority.snapshot.score], localKo: !insideRadius(player, authority.snapshot.arena.radius),
    serverTick: authority.snapshot.serverTick, chargeTicks: ticksFromCharge(player.chargePermille, constants),
    dashTicks: dashEndsAtTick === null ? 0 : Math.max(0, dashEndsAtTick - authority.snapshot.serverTick - 1),
    dashEndsAtTick, nextProjectileId: -1,
  };
}

export function reconcile(
  authority: ArenaAuthority,
  allPending: PendingArenaInput[],
  constants: ArenaPredictionConstants,
): { local: PredictedArenaState; pending: PendingArenaInput[]; replayedTicks: number; correction: ArenaCorrection | null; snapped: boolean } {
  const authoritative = fromAuthority(authority, constants);
  const pending = allPending.filter(input => input.sequence > authoritative.player.acknowledgedInput);
  let local = cloneState(authoritative);
  let replayedTicks = 0;
  let carriedFire = false;
  let carriedDash = false;

  for (const interval of pending) {
    if (interval.fromTick > interval.toTick) {
      if (interval.fromTick > authority.snapshot.serverTick) {
        carriedFire ||= interval.input.fireReleased;
        carriedDash ||= interval.input.dash;
      }
      continue;
    }
    const fromTick = Math.max(interval.fromTick, authority.snapshot.serverTick + 1);
    if (interval.toTick <= authority.snapshot.serverTick) continue;
    for (let tick = fromTick; tick <= interval.toTick; tick++) {
      local = stepLocal(local, {
        ...interval.input,
        fireReleased: tick === fromTick && (carriedFire || interval.input.fireReleased),
        dash: tick === fromTick && (carriedDash || interval.input.dash),
      }, constants);
      carriedFire = false;
      carriedDash = false;
      replayedTicks++;
    }
  }

  const previous = authority.previous;
  const correctionOrigin = authority.correctionOrigin ?? previous?.player;
  const dx = correctionOrigin ? local.player.x - correctionOrigin.x : 0;
  const dy = correctionOrigin ? local.player.y - correctionOrigin.y : 0;
  const correctionSquared = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
  const discreteChanged = previous !== undefined && (
    previous.phase !== authoritative.phase
    || previous.score[0] !== authoritative.score[0] || previous.score[1] !== authoritative.score[1]
    || previous.localKo !== authoritative.localKo
    || (authoritative.player.cooldownTicks > 0 && previous.player.cooldownTicks === 0)
    || (!authoritative.player.dashAvailable && previous.player.dashAvailable)
  );
  const invalidPosition = !insideRadius(local.player, authoritative.arena.radius)
    || (local.opponent !== null && deeplyOverlapping(local.player, local.opponent, constants.playerRadius));
  const snapped = correctionSquared > 90_000n || discreteChanged || invalidPosition;
  const correction = previous && !snapped && (dx !== 0 || dy !== 0)
    ? { x: dx, y: dy, durationMs: 100 as const }
    : null;
  return { local, pending, replayedTicks, correction, snapped };
}

function interpolateInteger(left: number, right: number, fraction: number): number {
  return Math.trunc(left + (right - left) * fraction);
}

function interpolateAim(left: FixedVec, right: FixedVec, fraction: number): FixedVec {
  if ((left.x === 0 && left.y === 0) || (right.x === 0 && right.y === 0)) {
    return left;
  }
  const leftAngle = Math.atan2(left.y, left.x);
  const rightAngle = Math.atan2(right.y, right.x);
  let difference = rightAngle - leftAngle;
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  const angle = leftAngle + difference * fraction;
  return { x: Math.trunc(Math.cos(angle) * 32_767), y: Math.trunc(Math.sin(angle) * 32_767) };
}

function interpolatePlayer(left: ArenaPlayerSnapshot, right: ArenaPlayerSnapshot, fraction: number): ArenaPlayerSnapshot {
  const aim = interpolateAim({ x: left.aimX, y: left.aimY }, { x: right.aimX, y: right.aimY }, fraction);
  return {
    ...right,
    x: interpolateInteger(left.x, right.x, fraction), y: interpolateInteger(left.y, right.y, fraction),
    vx: interpolateInteger(left.vx, right.vx, fraction), vy: interpolateInteger(left.vy, right.vy, fraction),
    aimX: aim.x, aimY: aim.y,
    chargePermille: interpolateInteger(left.chargePermille, right.chargePermille, fraction),
  };
}

function interpolateProjectile(left: ArenaProjectileSnapshot, right: ArenaProjectileSnapshot, fraction: number): ArenaProjectileSnapshot {
  return {
    ...right,
    x: interpolateInteger(left.x, right.x, fraction), y: interpolateInteger(left.y, right.y, fraction),
    vx: interpolateInteger(left.vx, right.vx, fraction), vy: interpolateInteger(left.vy, right.vy, fraction),
    chargePermille: interpolateInteger(left.chargePermille, right.chargePermille, fraction),
  };
}

export function sampleTimeline(
  frames: ArenaSnapshot[], nowMs: number, interpolationMs: number, maxExtrapolationMs: number,
): ArenaSnapshot {
  if (frames.length === 0) throw new Error('Cannot sample an empty arena timeline');
  const ordered = [...frames]
    .sort((left, right) => left.generatedAtUnixMs - right.generatedAtUnixMs || left.sequence - right.sequence)
    .filter((frame, index, values) => values[index + 1]?.generatedAtUnixMs !== frame.generatedAtUnixMs);
  const renderAt = nowMs - interpolationMs;
  const latest = ordered[ordered.length - 1];
  if (renderAt >= latest.generatedAtUnixMs) {
    const elapsed = renderAt - latest.generatedAtUnixMs;
    if (elapsed <= 0 || elapsed > maxExtrapolationMs) return latest;
    const tickNumerator = Math.trunc(elapsed * 60);
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;
    const previousPlayerIds = new Set(previous?.players.map(player => player.sessionId) ?? []);
    const previousProjectileIds = new Set(previous?.projectiles.map(projectile => projectile.id) ?? []);
    return {
      ...latest,
      players: latest.players.map(player => !previousPlayerIds.has(player.sessionId) ? player : ({
        ...player,
        x: player.x + Math.trunc(player.vx * tickNumerator / 1000),
        y: player.y + Math.trunc(player.vy * tickNumerator / 1000),
      })),
      projectiles: latest.projectiles.map(projectile => !previousProjectileIds.has(projectile.id) ? projectile : ({
        ...projectile,
        x: projectile.x + Math.trunc(projectile.vx * tickNumerator / 1000),
        y: projectile.y + Math.trunc(projectile.vy * tickNumerator / 1000),
      })),
    };
  }
  const rightIndex = ordered.findIndex(frame => frame.generatedAtUnixMs > renderAt);
  if (rightIndex <= 0) return ordered[0];
  const left = ordered[rightIndex - 1];
  const right = ordered[rightIndex];
  const fraction = (renderAt - left.generatedAtUnixMs) / (right.generatedAtUnixMs - left.generatedAtUnixMs || 1);
  const rightPlayers = new Map(right.players.map(player => [player.sessionId, player]));
  const rightProjectiles = new Map(right.projectiles.map(projectile => [projectile.id, projectile]));
  return {
    ...left,
    players: left.players.map(player => {
      const later = rightPlayers.get(player.sessionId);
      return later ? { ...player, ...interpolatePlayer(player, later, fraction),
        forcedFireTicks: player.forcedFireTicks, cooldownTicks: player.cooldownTicks,
        dashAvailable: player.dashAvailable, acknowledgedInput: player.acknowledgedInput } : player;
    }),
    projectiles: left.projectiles.map(projectile => {
      const later = rightProjectiles.get(projectile.id);
      return later ? interpolateProjectile(projectile, later, fraction) : projectile;
    }),
    arena: { ...left.arena, radius: interpolateInteger(left.arena.radius, right.arena.radius, fraction) },
  };
}

export interface ArenaLayout {
  cssWidth: number;
  cssHeight: number;
  size: number;
  offsetX: number;
  offsetY: number;
}

export function computeLayout(cssWidth: number, cssHeight: number): ArenaLayout {
  const size = Math.min(cssWidth, cssHeight);
  return { cssWidth, cssHeight, size, offsetX: (cssWidth - size) / 2, offsetY: (cssHeight - size) / 2 };
}

export function worldToScreen(world: FixedVec, layout: ArenaLayout): FixedVec {
  return {
    x: layout.offsetX + (world.x + 10_000) * layout.size / 20_000,
    y: layout.offsetY + (world.y + 10_000) * layout.size / 20_000,
  };
}

export function screenToWorld(point: FixedVec, layout: ArenaLayout): FixedVec {
  return {
    x: Math.trunc((point.x - layout.offsetX) * 20_000 / layout.size - 10_000),
    y: Math.trunc((point.y - layout.offsetY) * 20_000 / layout.size - 10_000),
  };
}
