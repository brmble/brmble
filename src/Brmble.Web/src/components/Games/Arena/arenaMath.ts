import type {
  ArenaInputState, ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaProjectileSnapshot,
  ArenaSnapshot, ArenaStateSnapshot,
} from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';

export interface FixedVec {
  x: number;
  y: number;
}

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
  chargeTicks: number;
  dashTicks: number;
  nextProjectileId: number;
}

export interface ArenaCorrection extends FixedVec {
  durationMs: 100;
}

export interface ArenaAuthority {
  snapshot: ArenaSnapshot;
  selfSessionId: number;
  previous?: PredictedArenaState;
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
  const next = cloneState(current);
  const player = next.player;
  const movement = normalizeQ15(rawInput.moveX, rawInput.moveY);
  const aim = normalizeQ15(rawInput.aimX, rawInput.aimY);
  player.aimX = aim.x;
  player.aimY = aim.y;

  const forcedFire = player.forcedFireTicks === 1;
  if (player.cooldownTicks > 0) player.cooldownTicks--;
  if (player.forcedFireTicks !== null) {
    player.forcedFireTicks--;
    if (player.forcedFireTicks <= 0) player.forcedFireTicks = null;
  }

  if (next.phase !== 'live' || player.cooldownTicks > 0) {
    next.chargeTicks = 0;
    player.forcedFireTicks = null;
  } else if (rawInput.charging && next.chargeTicks < constants.chargeTicks) {
    next.chargeTicks++;
    if (next.chargeTicks === constants.chargeTicks) player.forcedFireTicks = constants.forcedFireTicks;
  }
  player.chargePermille = chargeFromTicks(next.chargeTicks, constants);

  if (rawInput.dash && next.phase === 'live' && player.dashAvailable) {
    player.dashAvailable = false;
    next.dashTicks = constants.dashTicks;
  }

  if (next.phase === 'live' && player.cooldownTicks === 0 && (rawInput.fireReleased || forcedFire)) {
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
  if (next.phase === 'live' && next.dashTicks > 0) {
    const dashDirection = movement.x === 0 && movement.y === 0 ? aim : movement;
    const dashDelta = scaleBy(dashDirection, constants.dashPerTick);
    player.x += dashDelta.x;
    player.y += dashDelta.y;
    next.dashTicks--;
  }
  if (next.phase === 'live') {
    player.x += player.vx;
    player.y += player.vy;
    player.vx = multiplyDivideTruncated(player.vx, constants.momentumRetentionPermille, 1000);
    player.vy = multiplyDivideTruncated(player.vy, constants.momentumRetentionPermille, 1000);
  }
  next.localKo = !insideRadius(player, next.arena.radius);
  return next;
}

function insideRadius(point: FixedVec, radius: number): boolean {
  const x = BigInt(point.x);
  const y = BigInt(point.y);
  return x * x + y * y <= BigInt(radius) * BigInt(radius);
}

function bodiesOverlap(left: FixedVec, right: FixedVec, playerRadius: number): boolean {
  const dx = BigInt(left.x - right.x);
  const dy = BigInt(left.y - right.y);
  const diameter = BigInt(playerRadius * 2);
  return dx * dx + dy * dy < diameter * diameter;
}

function fromAuthority(authority: ArenaAuthority, constants: ArenaPredictionConstants): PredictedArenaState {
  const player = authority.snapshot.players.find(candidate => candidate.sessionId === authority.selfSessionId);
  if (!player) throw new Error('Arena authority does not contain the current session');
  const opponent = authority.snapshot.players.find(candidate => candidate.sessionId !== authority.selfSessionId) ?? null;
  return {
    player: { ...player }, opponent: opponent ? { ...opponent } : null,
    projectiles: authority.snapshot.projectiles.map(projectile => ({ ...projectile })),
    arena: { ...authority.snapshot.arena }, phase: authority.snapshot.phase,
    score: [...authority.snapshot.score], localKo: !insideRadius(player, authority.snapshot.arena.radius),
    chargeTicks: ticksFromCharge(player.chargePermille, constants), dashTicks: 0, nextProjectileId: -1,
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
      carriedFire ||= interval.input.fireReleased;
      carriedDash ||= interval.input.dash;
      continue;
    }
    for (let tick = interval.fromTick; tick <= interval.toTick; tick++) {
      local = stepLocal(local, {
        ...interval.input,
        fireReleased: tick === interval.fromTick && (carriedFire || interval.input.fireReleased),
        dash: tick === interval.fromTick && (carriedDash || interval.input.dash),
      }, constants);
      carriedFire = false;
      carriedDash = false;
      replayedTicks++;
    }
  }

  const previous = authority.previous;
  const dx = previous ? authoritative.player.x - previous.player.x : 0;
  const dy = previous ? authoritative.player.y - previous.player.y : 0;
  const correctionSquared = BigInt(dx) * BigInt(dx) + BigInt(dy) * BigInt(dy);
  const discreteChanged = previous !== undefined && (
    previous.phase !== authoritative.phase
    || previous.score[0] !== authoritative.score[0] || previous.score[1] !== authoritative.score[1]
    || previous.localKo !== authoritative.localKo
    || (authoritative.player.cooldownTicks > 0 && previous.player.cooldownTicks === 0)
    || (!authoritative.player.dashAvailable && previous.player.dashAvailable)
  );
  const invalidPosition = !insideRadius(local.player, authoritative.arena.radius)
    || (local.opponent !== null && bodiesOverlap(local.player, local.opponent, constants.playerRadius));
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
  const leftAngle = Math.atan2(left.y, left.x);
  const rightAngle = Math.atan2(right.y, right.x);
  let difference = rightAngle - leftAngle;
  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;
  const angle = leftAngle + difference * fraction;
  return { x: Math.trunc(Math.cos(angle) * 32_767), y: Math.trunc(Math.sin(angle) * 32_767) };
}

function interpolatePlayer(left: ArenaPlayerSnapshot, right: ArenaPlayerSnapshot, fraction: number): ArenaPlayerSnapshot {
  const aim = interpolateAim(left, right, fraction);
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
  const ordered = [...frames].sort((left, right) => left.generatedAtUnixMs - right.generatedAtUnixMs || left.sequence - right.sequence);
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
  const rightIndex = ordered.findIndex(frame => frame.generatedAtUnixMs >= renderAt);
  if (rightIndex <= 0) return ordered[0];
  const left = ordered[rightIndex - 1];
  const right = ordered[rightIndex];
  const fraction = (renderAt - left.generatedAtUnixMs) / (right.generatedAtUnixMs - left.generatedAtUnixMs || 1);
  const leftPlayers = new Map(left.players.map(player => [player.sessionId, player]));
  const leftProjectiles = new Map(left.projectiles.map(projectile => [projectile.id, projectile]));
  return {
    ...right,
    players: right.players.map(player => {
      const earlier = leftPlayers.get(player.sessionId);
      return earlier ? interpolatePlayer(earlier, player, fraction) : player;
    }),
    projectiles: right.projectiles.map(projectile => {
      const earlier = leftProjectiles.get(projectile.id);
      return earlier ? interpolateProjectile(earlier, projectile, fraction) : projectile;
    }),
    arena: { ...right.arena, radius: interpolateInteger(left.arena.radius, right.arena.radius, fraction) },
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
