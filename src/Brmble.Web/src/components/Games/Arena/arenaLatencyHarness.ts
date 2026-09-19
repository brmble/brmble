import type { ArenaInputState, ArenaPlayerSnapshot, ArenaPredictionConstants, ArenaSnapshot } from './arenaProtocol';
import type { PendingArenaInput } from './useArenaConnection';
import { reconcile, stepLocal, type PredictedArenaState } from './arenaMath';

/**
 * A deterministic two-clock model of one arena client and its server, for measuring
 * what local prediction does under latency without a socket, a timer or React.
 *
 * Time is integer ticks. The server steps once per tick and snapshots every
 * `snapshotEveryTicks`; a snapshot generated at tick `t` reaches the client at
 * `t + downTicks`. The client sends a frame on every held-state change and a
 * heartbeat every `heartbeatEveryTicks`; a frame sent at tick `c` reaches the server
 * at `c + upTicks`. The client maintains its pending list exactly as
 * `useArenaConnection` does (newest interval one tick wide, widened to
 * `nextStamp - 1` on the next send), rebuilds with the real `reconcile` on every
 * snapshot and advances its presentation one `stepLocal` per tick in between, as
 * `advanceLocalPresentation` does.
 *
 * The server is `stepLocal` applied to the authoritative copy — the client's mirror
 * of the server's local-player stages and what `reconcile` replays with, so it is the
 * right stand-in. There is no opponent and no projectile resolution.
 *
 * Two policies are parameters so that the same harness measures the current
 * behaviour and the input-scheduling design:
 * - `application`: `'onArrival'` installs an input on the tick it arrives (the
 *   server today); `'atStamp'` installs it at its `predictedTick`, or on arrival if
 *   that has passed, never later than `arrival + maxScheduleAheadTicks`.
 * - `pruning`: `'byAck'` drops pending intervals the snapshot acknowledges (the
 *   client today); `'byTick'` drops intervals whose `toTick` the snapshot has passed
 *   and never drops the newest.
 */
export type InputApplication = 'onArrival' | 'atStamp';
export type PendingPruning = 'byAck' | 'byTick';

export interface LatencyScenarioOptions {
  upTicks: number;
  downTicks: number;
  /** Held-input changes, in client ticks. The input before the first change is neutral. */
  script: Array<{ atClientTick: number; input: ArenaInputState }>;
  /** Total ticks to simulate. */
  durationTicks: number;
  constants: ArenaPredictionConstants;
  application?: InputApplication;
  pruning?: PendingPruning;
  /** Ticks added to the client's stamp on top of `S_last + elapsed`. Default 0 (today). */
  leadTicks?: number;
  snapshotEveryTicks?: number;
  heartbeatEveryTicks?: number;
  maxScheduleAheadTicks?: number;
  /**
   * Replay pending intervals through the client's current local tick
   * (`S_last + elapsed + lead`) instead of stopping at the newest interval's stamp,
   * as the scheduling client does.
   */
  replayThroughCurrentTick?: boolean;
  /**
   * Optional per-frame uplink jitter in ticks, keyed by sequence: a frame with an entry
   * arrives that many ticks later than `upTicks`. Arrival order is preserved.
   */
  uplinkJitterBySequence?: Record<number, number>;
}

export interface LatencyTickRecord {
  tick: number;
  /** The client's displayed local x for this tick. */
  displayedX: number;
  /** The server's authoritative x at this tick. */
  authorityX: number;
  /** Magnitude of the reconcile correction applied on this tick, 0 when none. */
  correctionMagnitude: number;
  snapped: boolean;
  reconciled: boolean;
}

export interface LatencyScenarioResult {
  ticks: LatencyTickRecord[];
  snapCount: number;
  maxCorrection: number;
  /** Number of reconciles where the displayed x moved backwards against a held right. */
  pullbackCount: number;
  /**
   * For the first script entry that holds `moveX > 0`: how many ticks after the press
   * the displayed x becomes monotone non-decreasing for the rest of the hold. 0 means
   * the display never stepped backwards after the press.
   */
  ticksUntilFirstMovement: number;
  /** Client tick at which each sequence was sent. */
  sentAtBySequence: Record<number, number>;
  /** Server tick at which each input sequence was installed, for tests on scheduling. */
  installedAtBySequence: Record<number, number>;
}

const neutral: ArenaInputState = {
  moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false,
};

function player(sessionId: number, x: number): ArenaPlayerSnapshot {
  return {
    sessionId, side: 0, x, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0,
    forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0,
  };
}

function initialState(serverTick: number): PredictedArenaState {
  return {
    player: player(10, 0), opponent: null, projectiles: [],
    arena: { radius: 9000, shrinkPhase: 'hold' }, phase: 'live', score: [0, 0], localKo: false,
    serverTick, chargeTicks: 0, dashTicks: 0, dashEndsAtTick: null, nextProjectileId: -1,
  };
}

function toSnapshot(state: PredictedArenaState, sequence: number, acknowledgedInput: number): ArenaSnapshot {
  return {
    type: 'snapshot', protocolVersion: 1, matchId: 1, sequence, serverTick: state.serverTick,
    generatedAtUnixMs: state.serverTick * 1000 / 60, phase: state.phase, phaseEndsAtTick: null,
    score: [state.score[0], state.score[1]], consecutiveDoubleKos: 0, arena: { ...state.arena },
    players: [{ ...state.player, dashTicksRemaining: state.dashTicks, acknowledgedInput }],
    projectiles: [],
  };
}

interface Frame {
  sequence: number;
  predictedTick: number;
  input: ArenaInputState;
  arrivesAt: number;
}

export function runLatencyScenario(options: LatencyScenarioOptions): LatencyScenarioResult {
  const {
    upTicks, downTicks, script, durationTicks, constants,
    application = 'onArrival', pruning = 'byAck', leadTicks = 0,
    snapshotEveryTicks = 3, heartbeatEveryTicks = 15, maxScheduleAheadTicks = 30,
    replayThroughCurrentTick = false, uplinkJitterBySequence = {},
  } = options;

  // Server.
  let authority = initialState(0);
  let serverHeld: ArenaInputState = neutral;
  let serverAck = 0;
  const inFlightUp: Frame[] = [];
  const scheduled: Array<{ applyAt: number; frame: Frame }> = [];
  const installedAtBySequence: Record<number, number> = {};
  const sentAtBySequence: Record<number, number> = {};
  let snapshotSequence = 0;
  const inFlightDown: Array<{ arrivesAt: number; snapshot: ArenaSnapshot }> = [];

  // Client.
  let currentInput: ArenaInputState = neutral;
  let nextSequence = 1;
  let pending: PendingArenaInput[] = [];
  let lastSnapshotTick = 0;
  let receivedAtTick = 0;
  let lastSendTick = Number.NEGATIVE_INFINITY;
  let predicted: PredictedArenaState = initialState(0);
  let presented: PredictedArenaState = initialState(0);

  const currentPredictedTick = (clientTick: number) =>
    lastSnapshotTick + Math.max(1, clientTick - receivedAtTick) + leadTicks;

  const send = (clientTick: number, input: ArenaInputState, heartbeat: boolean) => {
    const predictedTick = currentPredictedTick(clientTick);
    const recorded = heartbeat ? { ...input, fireReleased: false, dash: false } : input;
    const sequence = nextSequence++;
    const jitter = uplinkJitterBySequence[sequence] ?? 0;
    const previousArrival = inFlightUp.length > 0 ? inFlightUp[inFlightUp.length - 1].arrivesAt : Number.NEGATIVE_INFINITY;
    // The socket is ordered: a jittered frame delays everything behind it too.
    const arrivesAt = Math.max(clientTick + upTicks + jitter, previousArrival);
    inFlightUp.push({ sequence, predictedTick, input: recorded, arrivesAt });
    sentAtBySequence[sequence] = clientTick;
    pending = [
      ...pending.map((entry, index) => index === pending.length - 1 ? { ...entry, toTick: predictedTick - 1 } : entry),
      { sequence, predictedTick, fromTick: predictedTick, toTick: predictedTick, input: recorded },
    ];
    lastSendTick = clientTick;
  };

  const records: LatencyTickRecord[] = [];
  let snapCount = 0;
  let maxCorrection = 0;
  let pullbackCount = 0;
  let scriptIndex = 0;
  let previousDisplayedX = 0;

  for (let tick = 1; tick <= durationTicks; tick++) {
    // ---- Client: script and sends for this tick.
    while (scriptIndex < script.length && script[scriptIndex].atClientTick === tick) {
      const next = script[scriptIndex++].input;
      const held = currentInput;
      currentInput = next;
      const immediate = held.moveX !== next.moveX || held.moveY !== next.moveY || held.charging !== next.charging
        || next.fireReleased || next.dash;
      if (immediate) send(tick, next, false);
    }
    if (tick - lastSendTick >= heartbeatEveryTicks) send(tick, currentInput, true);

    // ---- Server: receive, install, step, snapshot.
    while (inFlightUp.length > 0 && inFlightUp[0].arrivesAt <= tick) {
      const frame = inFlightUp.shift()!;
      serverAck = Math.max(serverAck, frame.sequence);
      const applyAt = application === 'onArrival'
        ? tick
        : Math.min(Math.max(frame.predictedTick, tick), tick + maxScheduleAheadTicks);
      scheduled.push({ applyAt, frame });
    }
    scheduled.sort((a, b) => a.applyAt - b.applyAt || a.frame.sequence - b.frame.sequence);
    let fire = false;
    let dash = false;
    while (scheduled.length > 0 && scheduled[0].applyAt <= tick) {
      const { frame } = scheduled.shift()!;
      installedAtBySequence[frame.sequence] = tick;
      serverHeld = { ...frame.input, fireReleased: false, dash: false };
      fire ||= frame.input.fireReleased;
      dash ||= frame.input.dash;
    }
    authority = stepLocal(authority, { ...serverHeld, fireReleased: fire, dash }, constants);
    if (tick % snapshotEveryTicks === 0) {
      inFlightDown.push({ arrivesAt: tick + downTicks, snapshot: toSnapshot(authority, ++snapshotSequence, serverAck) });
    }

    // ---- Client: presentation advance for this tick, then any snapshot that arrived.
    presented = stepLocal(presented, { ...currentInput, fireReleased: false, dash: false }, constants);

    let reconciled = false;
    let correctionMagnitude = 0;
    let snapped = false;
    while (inFlightDown.length > 0 && inFlightDown[0].arrivesAt <= tick) {
      const { snapshot } = inFlightDown.shift()!;
      lastSnapshotTick = snapshot.serverTick;
      receivedAtTick = tick;
      const ack = snapshot.players[0].acknowledgedInput;
      pending = pruning === 'byAck'
        ? pending.filter(entry => entry.sequence > ack)
        : pending.filter((entry, index) => index === pending.length - 1 || entry.toTick > snapshot.serverTick);
      const origin = presented.player;
      const authorityInput = { snapshot, selfSessionId: 10, previous: predicted, correctionOrigin: { x: origin.x, y: origin.y } };
      const result = reconcile(
        authorityInput, pending, constants, replayThroughCurrentTick ? currentPredictedTick(tick) : undefined,
      );
      const dx = result.local.player.x - origin.x;
      const dy = result.local.player.y - origin.y;
      correctionMagnitude = Math.max(correctionMagnitude, Math.hypot(dx, dy));
      snapped ||= result.snapped;
      predicted = result.local;
      presented = result.local;
      reconciled = true;
    }

    if (reconciled) {
      if (snapped) snapCount++;
      maxCorrection = Math.max(maxCorrection, correctionMagnitude);
      if (currentInput.moveX > 0 && presented.player.x < previousDisplayedX) pullbackCount++;
    }
    records.push({
      tick, displayedX: presented.player.x, authorityX: authority.player.x,
      correctionMagnitude, snapped, reconciled,
    });
    previousDisplayedX = presented.player.x;
  }

  // ticksUntilFirstMovement: from the first press of moveX > 0 until the display stops
  // stepping backwards for the rest of that hold.
  let ticksUntilFirstMovement = 0;
  const press = script.find(entry => entry.input.moveX > 0);
  if (press) {
    const releaseEntry = script.find(entry => entry.atClientTick > press.atClientTick && entry.input.moveX <= 0);
    const holdEnd = releaseEntry ? releaseEntry.atClientTick - 1 : durationTicks;
    let lastBackward = press.atClientTick;
    for (let index = press.atClientTick; index < holdEnd; index++) {
      const now = records[index - 1];
      const next = records[index];
      if (next.displayedX < now.displayedX) lastBackward = next.tick;
    }
    ticksUntilFirstMovement = lastBackward - press.atClientTick;
  }

  return {
    ticks: records, snapCount, maxCorrection, pullbackCount, ticksUntilFirstMovement,
    sentAtBySequence, installedAtBySequence,
  };
}
