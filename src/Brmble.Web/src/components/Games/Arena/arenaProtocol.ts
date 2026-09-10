export interface ArenaPredictionConstants {
  unitsPerWorldUnit: 1000;
  playerRadius: 600;
  baseMovePerTick: 90;
  chargedMovePerTick: 45;
  momentumRetentionPermille: 920;
  chargeTicks: 90;
  minChargeTicks: 30;
  forcedFireTicks: 30;
  shotCooldownTicks: 24;
  projectileRadius: 180;
  projectilePerTick: 240;
  projectileBaseKnockback: 130;
  projectileBonusKnockback: 220;
  recoilBase: 45;
  recoilBonus: 105;
  dashTicks: 6;
  dashPerTick: 240;
}

export interface ArenaPlayerSnapshot {
  sessionId: number;
  side: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  chargePermille: number;
  forcedFireTicks: number | null;
  cooldownTicks: number;
  dashAvailable: boolean;
  acknowledgedInput: number;
}

export interface ArenaProjectileSnapshot {
  id: number;
  ownerSessionId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  chargePermille: number;
}

export type ArenaPhase = 'awaitingParticipants' | 'loading' | 'positioning' | 'live' | 'roundReset' | 'ended';
export type ArenaShrinkPhase = 'hold' | 'normal' | 'collapse';

export interface ArenaStateSnapshot {
  phase: ArenaPhase;
  phaseEndsAtTick: number | null;
  score: [number, number];
  consecutiveDoubleKos: number;
  arena: { radius: number; shrinkPhase: ArenaShrinkPhase };
  players: ArenaPlayerSnapshot[];
  projectiles: ArenaProjectileSnapshot[];
}

export interface ArenaWelcome {
  type: 'welcome';
  protocolVersion: 1;
  rulesetVersion: 1;
  matchId: number;
  role: 'participant';
  sessionId: number;
  snapshotSequence: number;
  serverTick: number;
  tickRate: 60;
  snapshotRate: 20;
  interpolationMs: 100;
  maxExtrapolationMs: 50;
  inputHeartbeatMs: 250;
  neutralAfterMs: 750;
  reconnectGraceMs: 5000;
  prediction: ArenaPredictionConstants;
  state: ArenaStateSnapshot;
  acknowledgedInput: number;
}

export interface ArenaSnapshot extends ArenaStateSnapshot {
  type: 'snapshot';
  protocolVersion: 1;
  matchId: number;
  sequence: number;
  serverTick: number;
  generatedAtUnixMs: number;
}

export interface ArenaMatchClosed {
  type: 'matchClosed';
  protocolVersion: 1;
  matchId: number;
  sequence: number;
  serverTick: number;
  reason: 'completed' | 'forfeited';
  finalState: ArenaStateSnapshot;
}

export interface ArenaInputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  charging: boolean;
  fireReleased: boolean;
  dash: boolean;
}

export type ArenaClientMessage =
  | { type: 'attachAck'; protocolVersion: 1; matchId: number; snapshotSequence: number }
  | ({ type: 'input'; protocolVersion: 1; matchId: number; sequence: number; predictedTick: number } & ArenaInputState)
  | { type: 'heartbeat'; protocolVersion: 1; matchId: number; sequence: number; predictedTick: number; moveX: number; moveY: number; aimX: number; aimY: number; charging: boolean };

export type ArenaServerMessage =
  | ArenaWelcome
  | ArenaSnapshot
  | { type: 'inputRejected'; protocolVersion: 1; matchId: number; sequence: number; reason: 'staleSequence' | 'sequenceGap' | 'invalidRange' | 'rateLimited' | 'wrongMatch' | 'wrongRole' | 'phaseDenied' | 'cooldown' | 'dashSpent' }
  | { type: 'connectionState'; protocolVersion: 1; matchId: number; sessionId: number; state: 'reconnecting'; graceEndsAtUnixMs: number }
  | ArenaMatchClosed;

type ArenaInputRejected = Extract<ArenaServerMessage, { type: 'inputRejected' }>;
type ArenaConnectionState = Extract<ArenaServerMessage, { type: 'connectionState' }>;

type JsonObject = Record<string, unknown>;

function objectWithKeys(value: unknown, keys: readonly string[]): value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const nullableInteger = (value: unknown): value is number | null => value === null || integer(value);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.some(candidate => candidate === value);

const phases = ['awaitingParticipants', 'loading', 'positioning', 'live', 'roundReset', 'ended'] as const;
const shrinkPhases = ['hold', 'normal', 'collapse'] as const;

function validPlayer(value: unknown): value is ArenaPlayerSnapshot {
  const keys = ['sessionId', 'side', 'x', 'y', 'vx', 'vy', 'aimX', 'aimY', 'chargePermille', 'forcedFireTicks', 'cooldownTicks', 'dashAvailable', 'acknowledgedInput'];
  return objectWithKeys(value, keys)
    && integer(value.sessionId) && (value.side === 0 || value.side === 1)
    && integer(value.x) && integer(value.y) && integer(value.vx) && integer(value.vy)
    && integer(value.aimX) && integer(value.aimY) && integer(value.chargePermille)
    && nullableInteger(value.forcedFireTicks) && integer(value.cooldownTicks)
    && typeof value.dashAvailable === 'boolean' && integer(value.acknowledgedInput);
}

function validProjectile(value: unknown): value is ArenaProjectileSnapshot {
  const keys = ['id', 'ownerSessionId', 'x', 'y', 'vx', 'vy', 'chargePermille'];
  return objectWithKeys(value, keys) && keys.every(key => integer(value[key]));
}

function validState(value: unknown): value is ArenaStateSnapshot {
  if (!objectWithKeys(value, ['phase', 'phaseEndsAtTick', 'score', 'consecutiveDoubleKos', 'arena', 'players', 'projectiles'])
    || !oneOf(value.phase, phases) || !nullableInteger(value.phaseEndsAtTick)
    || !Array.isArray(value.score) || value.score.length !== 2 || !value.score.every(integer)
    || !integer(value.consecutiveDoubleKos)
    || !objectWithKeys(value.arena, ['radius', 'shrinkPhase']) || !integer(value.arena.radius)
    || !oneOf(value.arena.shrinkPhase, shrinkPhases)
    || !Array.isArray(value.players) || !value.players.every(validPlayer)
    || !Array.isArray(value.projectiles) || !value.projectiles.every(validProjectile)) return false;
  const playerIds = value.players.map(player => player.sessionId);
  const projectileIds = value.projectiles.map(projectile => projectile.id);
  return new Set(playerIds).size === playerIds.length && new Set(projectileIds).size === projectileIds.length;
}

function validPrediction(value: unknown): value is ArenaPredictionConstants {
  return objectWithKeys(value, Object.keys(PREDICTION_V1))
    && Object.entries(PREDICTION_V1).every(([key, expected]) => value[key] === expected);
}

export const PREDICTION_V1: ArenaPredictionConstants = {
  unitsPerWorldUnit: 1000,
  playerRadius: 600,
  baseMovePerTick: 90,
  chargedMovePerTick: 45,
  momentumRetentionPermille: 920,
  chargeTicks: 90,
  minChargeTicks: 30,
  forcedFireTicks: 30,
  shotCooldownTicks: 24,
  projectileRadius: 180,
  projectilePerTick: 240,
  projectileBaseKnockback: 130,
  projectileBonusKnockback: 220,
  recoilBase: 45,
  recoilBonus: 105,
  dashTicks: 6,
  dashPerTick: 240,
};

function validWelcome(value: JsonObject): value is JsonObject & ArenaWelcome {
  const keys = ['type', 'protocolVersion', 'rulesetVersion', 'matchId', 'role', 'sessionId', 'snapshotSequence', 'serverTick', 'tickRate', 'snapshotRate', 'interpolationMs', 'maxExtrapolationMs', 'inputHeartbeatMs', 'neutralAfterMs', 'reconnectGraceMs', 'prediction', 'state', 'acknowledgedInput'];
  return objectWithKeys(value, keys) && value.type === 'welcome' && value.protocolVersion === 1
    && value.role === 'participant' && value.rulesetVersion === 1
    && value.tickRate === 60 && value.snapshotRate === 20
    && value.interpolationMs === 100 && value.maxExtrapolationMs === 50
    && value.inputHeartbeatMs === 250 && value.neutralAfterMs === 750
    && value.reconnectGraceMs === 5000
    && ['matchId', 'sessionId', 'snapshotSequence', 'serverTick', 'acknowledgedInput'].every(key => integer(value[key]))
    && validPrediction(value.prediction) && validState(value.state);
}

function validSnapshot(value: JsonObject): value is JsonObject & ArenaSnapshot {
  const envelope = ['type', 'protocolVersion', 'matchId', 'sequence', 'serverTick', 'generatedAtUnixMs'];
  const stateKeys = ['phase', 'phaseEndsAtTick', 'score', 'consecutiveDoubleKos', 'arena', 'players', 'projectiles'];
  if (!objectWithKeys(value, [...envelope, ...stateKeys]) || value.type !== 'snapshot' || value.protocolVersion !== 1
    || !['matchId', 'sequence', 'serverTick', 'generatedAtUnixMs'].every(key => integer(value[key]))) return false;
  const state: JsonObject = {};
  for (const key of stateKeys) state[key] = value[key];
  return validState(state);
}

function validInputRejected(value: JsonObject): value is JsonObject & ArenaInputRejected {
  return objectWithKeys(value, ['type', 'protocolVersion', 'matchId', 'sequence', 'reason'])
    && value.type === 'inputRejected' && value.protocolVersion === 1
    && integer(value.matchId) && integer(value.sequence)
    && oneOf(value.reason, ['staleSequence', 'sequenceGap', 'invalidRange', 'rateLimited', 'wrongMatch', 'wrongRole', 'phaseDenied', 'cooldown', 'dashSpent'] as const);
}

function validConnectionState(value: JsonObject): value is JsonObject & ArenaConnectionState {
  return objectWithKeys(value, ['type', 'protocolVersion', 'matchId', 'sessionId', 'state', 'graceEndsAtUnixMs'])
    && value.type === 'connectionState' && value.protocolVersion === 1
    && integer(value.matchId) && integer(value.sessionId) && value.state === 'reconnecting'
    && integer(value.graceEndsAtUnixMs);
}

function validMatchClosed(value: JsonObject): value is JsonObject & ArenaMatchClosed {
  return objectWithKeys(value, ['type', 'protocolVersion', 'matchId', 'sequence', 'serverTick', 'reason', 'finalState'])
    && value.type === 'matchClosed' && value.protocolVersion === 1
    && integer(value.matchId) && integer(value.sequence) && integer(value.serverTick)
    && oneOf(value.reason, ['completed', 'forfeited'] as const) && validState(value.finalState);
}

export function parseServerMessage(raw: string): ArenaServerMessage | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!objectWithKeys(value, Object.keys(value)) || value.protocolVersion !== 1 || typeof value.type !== 'string') return null;
  if (value.type === 'welcome') return validWelcome(value) ? value : null;
  if (value.type === 'snapshot') return validSnapshot(value) ? value : null;
  if (value.type === 'inputRejected') return validInputRejected(value) ? value : null;
  if (value.type === 'connectionState') return validConnectionState(value) ? value : null;
  if (value.type === 'matchClosed') return validMatchClosed(value) ? value : null;
  return null;
}
