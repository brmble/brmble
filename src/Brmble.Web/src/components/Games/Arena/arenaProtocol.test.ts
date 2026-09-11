import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './arenaProtocol';

const player = (sessionId: number) => ({
  sessionId, side: sessionId === 10 ? 0 : 1, x: sessionId === 10 ? -3500 : 3500, y: 0,
  vx: 0, vy: 0, aimX: sessionId === 10 ? 32767 : -32767, aimY: 0,
  chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0,
  dashAvailable: true, acknowledgedInput: 0,
});

const state = () => ({
  phase: 'positioning', phaseEndsAtTick: 240, score: [0, 0], consecutiveDoubleKos: 0,
  arena: { radius: 9000, shrinkPhase: 'hold' },
  players: [player(10), player(20)], projectiles: [],
});

const snapshot = () => ({
  type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: 28,
  serverTick: 81, generatedAtUnixMs: 1784989801350, ...state(),
});

const welcome = () => ({
  type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91,
  role: 'participant', sessionId: 10, snapshotSequence: 1, serverTick: 0,
  generatedAtUnixMs: 1_700_000_000_000, tickRate: 60, snapshotRate: 20, interpolationMs: 100, maxExtrapolationMs: 50,
  inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
  prediction: {
    unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90,
    chargedMovePerTick: 45, momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30,
    forcedFireTicks: 30, shotCooldownTicks: 24, projectileRadius: 180,
    projectilePerTick: 240, projectileBaseKnockback: 130, projectileBonusKnockback: 220,
    recoilBase: 45, recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
  },
  state: { ...state(), phase: 'awaitingParticipants', phaseEndsAtTick: null }, acknowledgedInput: 0,
});

describe('parseServerMessage', () => {
  it('accepts every complete protocol-v1 server message', () => {
    const messages = [
      welcome(),
      snapshot(),
      { type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 44, reason: 'phaseDenied' },
      { type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 45, reason: 'invalidRange' },
      { type: 'connectionState', protocolVersion: 1, matchId: 91, sessionId: 20, state: 'reconnecting', graceEndsAtUnixMs: 1784989806000 },
      { type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 121, serverTick: 3601, reason: 'completed', finalState: { ...state(), phase: 'ended', phaseEndsAtTick: null } },
    ];

    for (const message of messages) {
      expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
    }
  });

  it.each([
    ['wrong protocol version', { ...snapshot(), protocolVersion: 2 }],
    ['non-integer coordinate', { ...snapshot(), players: [{ ...player(10), x: 1.5 }, player(20)] }],
    ['duplicate player session', { ...snapshot(), players: [player(10), player(10)] }],
    ['unknown discriminant', { ...snapshot(), type: 'surprise' }],
    ['missing terminal state', { type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 121, serverTick: 3601, reason: 'completed' }],
    ['unknown reject reason', { type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 44, reason: 'other' }],
    ['unknown phase', { ...snapshot(), phase: 'paused' }],
    ['extra field', { ...snapshot(), extra: true }],
    ['unsafe integer', { ...snapshot(), serverTick: Number.MAX_SAFE_INTEGER + 1 }],
    ['wrong ruleset', { ...welcome(), rulesetVersion: 2 }],
    ['zero tick rate', { ...welcome(), tickRate: 0 }],
    ['wrong snapshot rate', { ...welcome(), snapshotRate: 21 }],
    ['wrong interpolation', { ...welcome(), interpolationMs: 99 }],
    ['wrong extrapolation', { ...welcome(), maxExtrapolationMs: 51 }],
    ['wrong heartbeat', { ...welcome(), inputHeartbeatMs: 251 }],
    ['wrong neutral timeout', { ...welcome(), neutralAfterMs: 0 }],
    ['wrong reconnect grace', { ...welcome(), reconnectGraceMs: -5000 }],
    ['wrong prediction constant', { ...welcome(), prediction: { ...welcome().prediction, dashPerTick: 241 } }],
  ])('rejects %s', (_name, message) => {
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });

  it('returns null for malformed JSON and JSON null', () => {
    expect(parseServerMessage('{')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
  });
});
