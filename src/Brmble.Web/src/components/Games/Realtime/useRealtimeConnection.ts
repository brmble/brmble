import { useEffect, useRef, useState } from 'react';
import { requestRealtimeTicket } from '../../../api/games';
import { createServerClock, type ServerClock } from './serverClock';
import { createInputLead, type InputLead } from './inputLead';

/**
 * The game-agnostic realtime connection: ticket, socket lifecycle, welcome and attach
 * acknowledgement, input sequencing and stamping, heartbeat, the direction-change
 * throttle, pending intervals, round-trip measurement and lead, the server clock, and
 * reconnect with its grace deadline. Everything a game contributes - its input shape,
 * its wire messages and how to read its own fields out of them - comes in through a
 * {@link RealtimeCodec}. A game's own connection hook is this hook with its codec.
 */

const RECONNECT_DELAYS = [250, 500, 1000, 2000] as const;
// Leave headroom below the server's rolling direction-change budget.
const DIRECTION_INTERVAL_MS = 40;
const DEFAULT_HEARTBEAT_MS = 250;
const DEFAULT_TICK_RATE = 60;
const RECONNECT_GRACE_MS = 5000;

export type RealtimeConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'failed';

/**
 * Each pending interval is replayed inclusively. `fromTick > toTick` is an empty
 * held-state interval; edge flags still apply once and must not be dropped.
 */
export interface PendingInput<TInput> {
  sequence: number;
  predictedTick: number;
  fromTick: number;
  toTick: number;
  input: TInput;
}

/** The server messages the connection itself understands. */
export interface RealtimeWelcomeShape {
  type: 'welcome';
  matchId: number;
  sessionId: number;
  snapshotSequence: number;
  serverTick: number;
  generatedAtUnixMs: number;
  tickRate: number;
  inputHeartbeatMs: number;
  acknowledgedInput: number;
}
export interface RealtimeSnapshotShape {
  type: 'snapshot';
  matchId: number;
  sequence: number;
  serverTick: number;
  generatedAtUnixMs: number;
}
export interface RealtimeMatchClosedShape {
  type: 'matchClosed';
  matchId: number;
  sequence: number;
}
export type RealtimeInputRejected = {
  type: 'inputRejected'; matchId: number; sequence: number;
  reason: 'staleSequence' | 'sequenceGap' | 'invalidRange' | 'rateLimited' | 'wrongMatch' | 'wrongRole';
};
export type RealtimeConnectionState = { type: 'connectionState'; matchId: number };
export type RealtimeServerMessage<TWelcome, TSnapshot, TClosed> =
  | TWelcome | TSnapshot | TClosed | RealtimeInputRejected | RealtimeConnectionState;

export interface RealtimeDirection { x: number; y: number }

/**
 * What a game tells the connection about its input and its wire.
 *
 * The input is split the way the server splits it: held state (persists until the
 * next frame), edges (one-shot actions a heartbeat never carries) and a direction
 * pair (the aim the server budgets changes of).
 */
export interface RealtimeCodec<TInput, TWelcome extends RealtimeWelcomeShape, TSnapshot extends RealtimeSnapshotShape, TClosed extends RealtimeMatchClosedShape> {
  neutral: TInput;
  /** The input with its edges cleared: what a heartbeat carries and what replay holds. */
  heldOnly(input: TInput): TInput;
  /** True when the held (non-edge, non-direction) part changed: a frame must go now. */
  sameHeld(previous: TInput, next: TInput): boolean;
  hasEdges(input: TInput): boolean;
  direction(input: TInput): RealtimeDirection;
  withDirection(input: TInput, direction: RealtimeDirection): TInput;
  /** The direction the player starts facing, from the welcome; null to use `neutral`'s. */
  initialDirection(welcome: TWelcome, sessionId: number): RealtimeDirection | null;
  /** The newest input sequence the server has received from this session, per snapshot. */
  acknowledgedInput(snapshot: TSnapshot, sessionId: number): number | undefined;
  /** The wire body of an input frame; the connection adds type, protocol, match, sequence and stamp. */
  inputFields(input: TInput): Record<string, unknown>;
  /** The wire body of a heartbeat: held state and direction only. */
  heartbeatFields(input: TInput): Record<string, unknown>;
  parse(raw: string): RealtimeServerMessage<TWelcome, TSnapshot, TClosed> | null;
}

export interface RealtimeConnection<TInput, TWelcome, TSnapshot, TClosed> {
  status: RealtimeConnectionStatus;
  welcome: TWelcome | null;
  latestSnapshot: TSnapshot | null;
  closed: TClosed | null;
  pendingInputs: PendingInput<TInput>[];
  pendingInputCount: number;
  currentInput: TInput;
  /**
   * Server-minus-client clock offset, sampled at the moment each server message
   * is received. Anything that compares a server timestamp against `Date.now()`
   * — the snapshot timeline above all — has to go through this.
   */
  serverClock: ServerClock;
  /**
   * How far ahead of the server this client stamps its inputs, from the round trip
   * measured off `acknowledgedInput`. Shared with the game's state hook so replay
   * runs through the same local tick the stamps use.
   */
  inputLead: InputLead;
  /**
   * The client's current local tick: `serverTick + elapsed since the last snapshot +
   * lead`. Every sent frame is stamped with this; the game replays pending intervals
   * through it.
   */
  currentPredictedTick: () => number;
  sendInput: (input: TInput) => void;
  sendHeartbeat: () => void;
}

interface Runtime<TInput> {
  generation: number;
  matchId: number;
  socket: WebSocket | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  directionTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectStartedAt: number | null;
  retryIndex: number;
  attemptGeneration: number;
  sessionId: number | null;
  nextSequence: number | null;
  serverTick: number;
  tickRate: number;
  clockStartedAt: number;
  /** The newest stamp sent on this attach; the floor for the next one. */
  lastStamp: number;
  lastSnapshotSequence: number;
  lastDirectionSentAt: number;
  transmittedDirection: RealtimeDirection;
  lastSentInput: TInput;
  currentInput: TInput;
  queuedDirectionInput: TInput | null;
  pendingInputs: PendingInput<TInput>[];
  sentFrames: Array<{ sequence: number; direction: RealtimeDirection; directionSentAt: number; sentAt: number }>;
  lead: InputLead;
  terminal: boolean;
}

function sameDirection(left: RealtimeDirection, right: RealtimeDirection): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * The client's local tick. The server applies an input at the tick it is stamped
 * with, so the stamp has to name a tick the input can still reach: the last known
 * server tick, plus the time since it was known, plus a lead covering the round trip.
 * Local prediction runs from the same tick, which is what makes the two agree.
 *
 * Never below the previous stamp. A snapshot that arrives late re-anchors the clock a
 * tick lower than it had extrapolated, and the lead slews down a tick at a time, so
 * the raw estimate can step back. A later input stamped below an earlier one would be
 * installed before it, and the server would keep the held state this client had
 * already replaced. The server floors stamps the same way; flooring here as well keeps
 * the prediction on the tick the server will actually use.
 */
function currentPredictedTick<TInput>(runtime: Runtime<TInput>): number {
  const now = performance.now();
  const elapsedTicks = Math.floor((now - runtime.clockStartedAt) * runtime.tickRate / 1000);
  return Math.max(runtime.lastStamp, runtime.serverTick + Math.max(1, elapsedTicks) + runtime.lead.leadTicks(now));
}

export function useRealtimeConnection<TInput, TWelcome extends RealtimeWelcomeShape, TSnapshot extends RealtimeSnapshotShape, TClosed extends RealtimeMatchClosedShape>(
  codec: RealtimeCodec<TInput, TWelcome, TSnapshot, TClosed>,
  { matchId, enabled }: { matchId: number; enabled: boolean },
): RealtimeConnection<TInput, TWelcome, TSnapshot, TClosed> {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(enabled ? 'connecting' : 'disabled');
  const [welcome, setWelcome] = useState<TWelcome | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<TSnapshot | null>(null);
  const [closed, setClosed] = useState<TClosed | null>(null);
  const [pendingInputs, setPendingInputs] = useState<PendingInput<TInput>[]>([]);
  const [currentInput, setCurrentInput] = useState<TInput>(codec.neutral);
  const runtimeRef = useRef<Runtime<TInput> | null>(null);
  const codecRef = useRef(codec);
  codecRef.current = codec;
  // One instance for the life of the hook, so the game's state hook sees a live
  // estimate without a re-render per sample. Deliberately NOT replaced when the
  // effect reconnects: the offset is a property of the two machines rather than of
  // the match, it stays valid across a reconnect, and a fresh instance would render
  // uncorrected until it recalibrated. Stale samples age out of the window within
  // 2 s regardless. It must also never be reassigned from inside the effect — that
  // writes a ref without re-rendering, and on a first mount the effect's setState
  // calls all bail out as no-ops, leaving the consumer reading an instance the
  // socket is not feeding.
  const serverClockRef = useRef<ServerClock | null>(null);
  serverClockRef.current ??= createServerClock();
  // Same lifetime and the same discipline as the clock above: the round trip is a
  // property of the network, not of the match, so it survives a reconnect. The tick
  // rate is the game's and is set from every welcome.
  const inputLeadRef = useRef<InputLead | null>(null);
  inputLeadRef.current ??= createInputLead({ tickRate: DEFAULT_TICK_RATE });
  const sendStateRef = useRef<(runtime: Runtime<TInput>, input: TInput, heartbeat: boolean) => void>(() => {});

  const sendMessage = (runtime: Runtime<TInput>, message: Record<string, unknown>) => {
    if (runtimeRef.current !== runtime || runtime.socket?.readyState !== WebSocket.OPEN) return false;
    runtime.socket.send(JSON.stringify(message));
    return true;
  };

  const sendState = (runtime: Runtime<TInput>, input: TInput, heartbeat: boolean) => {
    if (runtime.terminal || runtime.nextSequence === null) return;
    const predictedTick = currentPredictedTick(runtime);
    const sequence = runtime.nextSequence;
    const recordedInput = heartbeat ? codecRef.current.heldOnly(input) : input;
    const message = heartbeat
      ? {
          type: 'heartbeat', protocolVersion: 1, matchId: runtime.matchId, sequence, predictedTick,
          ...codecRef.current.heartbeatFields(input),
        }
      : { type: 'input', protocolVersion: 1, matchId: runtime.matchId, sequence, predictedTick, ...codecRef.current.inputFields(input) };
    if (!sendMessage(runtime, message)) return;

    runtime.nextSequence++;
    runtime.lastStamp = predictedTick;
    const direction = codecRef.current.direction(input);
    const directionChanged = !sameDirection(direction, runtime.transmittedDirection);
    const directionSentAt = directionChanged || runtime.sentFrames.length === 0
      ? performance.now()
      : runtime.lastDirectionSentAt;
    if (directionChanged || runtime.sentFrames.length === 0) runtime.lastDirectionSentAt = directionSentAt;
    runtime.transmittedDirection = direction;
    runtime.lastSentInput = recordedInput;
    runtime.sentFrames.push({ sequence, direction, directionSentAt, sentAt: performance.now() });
    const extended = runtime.pendingInputs.map((pending, index) => index === runtime.pendingInputs.length - 1
        ? { ...pending, toTick: predictedTick - 1 }
        : pending);
    runtime.pendingInputs = [...extended, {
      sequence, predictedTick, fromTick: predictedTick, toTick: predictedTick, input: recordedInput,
    }];
    setPendingInputs(runtime.pendingInputs);
  };
  sendStateRef.current = sendState;

  const queueDirection = (runtime: Runtime<TInput>, input: TInput) => {
    runtime.queuedDirectionInput = input;
    if (runtime.directionTimer !== null) clearTimeout(runtime.directionTimer);
    const wait = Math.max(0, DIRECTION_INTERVAL_MS - (performance.now() - runtime.lastDirectionSentAt));
    runtime.directionTimer = setTimeout(() => {
      runtime.directionTimer = null;
      if (runtime.terminal) return;
      const queued = runtime.queuedDirectionInput;
      runtime.queuedDirectionInput = null;
      if (!queued) return;
      sendStateRef.current(runtime, codecRef.current.heldOnly(
        codecRef.current.withDirection(runtime.currentInput, codecRef.current.direction(queued)),
      ), false);
    }, wait);
  };

  const withLegalDirection = (runtime: Runtime<TInput>, input: TInput): TInput => {
    const directionChanged = !sameDirection(codecRef.current.direction(input), runtime.transmittedDirection);
    if (!directionChanged || performance.now() - runtime.lastDirectionSentAt >= DIRECTION_INTERVAL_MS) return input;
    return codecRef.current.withDirection(input, runtime.transmittedDirection);
  };

  const clearQueuedDirection = (runtime: Runtime<TInput>) => {
    if (runtime.directionTimer !== null) clearTimeout(runtime.directionTimer);
    runtime.directionTimer = null;
    runtime.queuedDirectionInput = null;
  };

  const sendHeartbeatFrom = (runtime: Runtime<TInput>) => {
    const frame = withLegalDirection(runtime, runtime.currentInput);
    if (sameDirection(codecRef.current.direction(frame), codecRef.current.direction(runtime.currentInput))) {
      clearQueuedDirection(runtime);
    }
    sendStateRef.current(runtime, frame, true);
    if (!sameDirection(codecRef.current.direction(frame), codecRef.current.direction(runtime.currentInput))) {
      queueDirection(runtime, runtime.currentInput);
    }
  };

  const sendHeartbeat = () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.terminal) return;
    sendHeartbeatFrom(runtime);
  };
  // The connection effect reaches these through a ref, as it does `sendState`, so
  // the effect's dependencies stay `[enabled, matchId]` and a reconnect is the only
  // thing that re-runs it.
  const helpersRef = useRef({ sendMessage, sendHeartbeatFrom, clearQueuedDirection });
  helpersRef.current = { sendMessage, sendHeartbeatFrom, clearQueuedDirection };

  const sendInput = (input: TInput) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.terminal) return;
    const previous = runtime.currentInput;
    runtime.currentInput = input;
    setCurrentInput(input);

    const immediate = !codecRef.current.sameHeld(previous, input) || codecRef.current.hasEdges(input);
    const directionChanged = !sameDirection(codecRef.current.direction(input), runtime.transmittedDirection);
    if (immediate) {
      // An edge commits to a direction, so it carries the true one even inside the
      // throttle window. Sending the previously transmitted direction instead would
      // fire it where the player used to be pointing. Edges are rare — the arena's
      // shot cooldown caps firing near 2.5/s — so the change they spend is affordable.
      const directional = codecRef.current.hasEdges(input);
      const frame = directional ? input : withLegalDirection(runtime, input);
      if (sameDirection(codecRef.current.direction(frame), codecRef.current.direction(input))) {
        clearQueuedDirection(runtime);
      }
      sendStateRef.current(runtime, frame, false);
      if (!sameDirection(codecRef.current.direction(frame), codecRef.current.direction(input))) queueDirection(runtime, input);
      return;
    }
    if (!directionChanged) return;
    if (performance.now() - runtime.lastDirectionSentAt >= DIRECTION_INTERVAL_MS) {
      sendStateRef.current(runtime, codecRef.current.heldOnly(input), false);
    } else {
      queueDirection(runtime, input);
    }
  };

  useEffect(() => {
    const neutralInput = codecRef.current.neutral;
    const generation = (runtimeRef.current?.generation ?? 0) + 1;
    const runtime: Runtime<TInput> = {
      generation, matchId, socket: null, retryTimer: null, deadlineTimer: null,
      directionTimer: null, heartbeatTimer: null, reconnectStartedAt: null, retryIndex: 0,
      attemptGeneration: 0, sessionId: null, nextSequence: null, serverTick: 0,
      tickRate: DEFAULT_TICK_RATE, clockStartedAt: performance.now(), lastStamp: 0, lastSnapshotSequence: -1,
      lastDirectionSentAt: Number.NEGATIVE_INFINITY, transmittedDirection: codecRef.current.direction(neutralInput),
      lastSentInput: neutralInput, currentInput: neutralInput, queuedDirectionInput: null,
      pendingInputs: [], sentFrames: [],
      lead: inputLeadRef.current ?? createInputLead({ tickRate: DEFAULT_TICK_RATE }), terminal: false,
    };
    runtimeRef.current = runtime;

    const current = () => runtimeRef.current === runtime;
    const clearConnectionTimers = () => {
      if (runtime.directionTimer !== null) clearTimeout(runtime.directionTimer);
      if (runtime.heartbeatTimer !== null) clearInterval(runtime.heartbeatTimer);
      runtime.directionTimer = null;
      runtime.heartbeatTimer = null;
      runtime.queuedDirectionInput = null;
    };
    const installNeutral = () => {
      runtime.currentInput = neutralInput;
      runtime.lastSentInput = neutralInput;
      setCurrentInput(neutralInput);
      setPendingInputs([]);
      runtime.pendingInputs = [];
      runtime.sentFrames = [];
      runtime.nextSequence = null;
    };
    const failReconnect = () => {
      if (!current() || runtime.terminal) return;
      runtime.attemptGeneration++;
      if (runtime.retryTimer !== null) clearTimeout(runtime.retryTimer);
      runtime.retryTimer = null;
      if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
      runtime.deadlineTimer = null;
      clearConnectionTimers();
      const staleSocket = runtime.socket;
      runtime.socket = null;
      if (staleSocket && staleSocket.readyState < WebSocket.CLOSING) staleSocket.close();
      installNeutral();
      setStatus('failed');
    };
    const startReconnectDeadline = () => {
      if (runtime.deadlineTimer !== null) return;
      runtime.deadlineTimer = setTimeout(failReconnect, RECONNECT_GRACE_MS);
    };

    const scheduleReconnect = () => {
      if (!current() || runtime.terminal || runtime.retryTimer !== null) return;
      clearConnectionTimers();
      const failedSocket = runtime.socket;
      runtime.socket = null;
      if (failedSocket && failedSocket.readyState < WebSocket.CLOSING) failedSocket.close();
      installNeutral();
      runtime.reconnectStartedAt ??= performance.now();
      startReconnectDeadline();
      setStatus('reconnecting');
      const elapsed = performance.now() - runtime.reconnectStartedAt;
      const delay = RECONNECT_DELAYS[runtime.retryIndex];
      if (delay === undefined || elapsed + delay > RECONNECT_GRACE_MS) {
        setStatus('failed');
        return;
      }
      runtime.retryIndex++;
      const retryGeneration = runtime.attemptGeneration;
      runtime.retryTimer = setTimeout(() => {
        runtime.retryTimer = null;
        if (!current() || runtime.terminal || retryGeneration !== runtime.attemptGeneration) return;
        void connect(retryGeneration);
      }, delay);
    };

    const handleWelcome = (socket: WebSocket, message: TWelcome) => {
      if (!current() || runtime.socket !== socket || message.matchId !== matchId) return;
      if (runtime.nextSequence !== null) {
        failReconnect();
        return;
      }
      runtime.serverTick = message.serverTick;
      runtime.sessionId = message.sessionId;
      runtime.tickRate = message.tickRate;
      // The lead converts the round trip into ticks, so it has to use the game's rate,
      // not the default; the round trip itself carries over from an earlier attach.
      runtime.lead.setTickRate(message.tickRate);
      runtime.clockStartedAt = performance.now();
      // The server drops its stamp floor with the queue on a reconnect; so does this.
      runtime.lastStamp = 0;
      runtime.nextSequence = message.acknowledgedInput + 1;
      runtime.lastSnapshotSequence = message.snapshotSequence;
      runtime.retryIndex = 0;
      runtime.reconnectStartedAt = null;
      if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
      runtime.deadlineTimer = null;
      runtime.currentInput = neutralInput;
      runtime.lastSentInput = neutralInput;
      runtime.transmittedDirection = codecRef.current.initialDirection(message, message.sessionId)
        ?? codecRef.current.direction(neutralInput);
      runtime.lastDirectionSentAt = Number.NEGATIVE_INFINITY;
      runtime.pendingInputs = [];
      runtime.sentFrames = [];
      setCurrentInput(neutralInput);
      setPendingInputs([]);
      setWelcome(message);
      setLatestSnapshot(null);
      setStatus('connected');
      helpersRef.current.sendMessage(runtime, {
        type: 'attachAck', protocolVersion: 1, matchId, snapshotSequence: message.snapshotSequence,
      });
      runtime.heartbeatTimer = setInterval(() => {
        if (current() && !runtime.terminal) helpersRef.current.sendHeartbeatFrom(runtime);
      }, message.inputHeartbeatMs || DEFAULT_HEARTBEAT_MS);
    };

    const connect = async (expectedGeneration = runtime.attemptGeneration) => {
      if (!current() || runtime.terminal || !enabled || expectedGeneration !== runtime.attemptGeneration) return;
      const attempt = ++runtime.attemptGeneration;
      try {
        const ticket = await requestRealtimeTicket(matchId, 'participant');
        if (!current() || runtime.terminal || attempt !== runtime.attemptGeneration) return;
        const socketUrl = new URL(ticket.url);
        socketUrl.searchParams.set('ticket', ticket.ticket);
        const socket = new WebSocket(socketUrl.toString());
        runtime.socket = socket;
        socket.onmessage = event => {
          if (!current() || attempt !== runtime.attemptGeneration
            || runtime.socket !== socket || typeof event.data !== 'string') return;
          // Sampled here, at the moment of receipt, rather than wherever the message
          // is eventually consumed: React scheduling between the two would be charged
          // to the latency term and bias the offset low.
          const receivedAt = Date.now();
          const receivedAtPerf = performance.now();
          const message = codecRef.current.parse(event.data);
          if (!message || message.matchId !== matchId) return;
          // The generic members are narrowed by hand: TypeScript does not narrow a
          // union of type parameters by a discriminant on their constraints.
          if (message.type === 'welcome') {
            const welcomeMessage = message as unknown as TWelcome;
            serverClockRef.current?.observe(welcomeMessage.generatedAtUnixMs, receivedAt);
            handleWelcome(socket, welcomeMessage);
          } else if (message.type === 'snapshot') {
            const snapshot = message as unknown as TSnapshot;
            serverClockRef.current?.observe(snapshot.generatedAtUnixMs, receivedAt);
            if (snapshot.sequence < runtime.lastSnapshotSequence) return;
            runtime.lastSnapshotSequence = snapshot.sequence;
            runtime.serverTick = snapshot.serverTick;
            runtime.clockStartedAt = performance.now();
            setLatestSnapshot(snapshot);
            const acknowledged = runtime.sessionId === null
              ? undefined
              : codecRef.current.acknowledgedInput(snapshot, runtime.sessionId);
            if (acknowledged !== undefined) {
              // One round-trip sample per snapshot, from the newest frame it acknowledges:
              // the server echoes the newest sequence it has *received*, and this client
              // knows when it sent it. Older acknowledged frames would only add queueing.
              const newestAcknowledged = runtime.sentFrames.reduce<Runtime<TInput>['sentFrames'][number] | null>(
                (newest, frame) => frame.sequence <= acknowledged && (newest === null || frame.sequence > newest.sequence) ? frame : newest,
                null,
              );
              if (newestAcknowledged !== null) runtime.lead.sample(receivedAtPerf - newestAcknowledged.sentAt, receivedAtPerf);
              // Pending is pruned by tick, not by acknowledgement. The server applies an
              // input at its stamped tick, so this snapshot contains exactly the inputs
              // stamped at or before its serverTick; an acknowledged input stamped later
              // is received but not yet applied and must still be replayed. The newest
              // interval is open-ended - its held state persists until the next frame -
              // and is never pruned.
              runtime.pendingInputs = runtime.pendingInputs.filter((input, index, all) =>
                index === all.length - 1 || input.toTick > snapshot.serverTick);
              runtime.sentFrames = runtime.sentFrames.filter(frame => frame.sequence > acknowledged);
              setPendingInputs(runtime.pendingInputs);
            }
          } else if (message.type === 'inputRejected') {
            const rejected = message as RealtimeInputRejected;
            helpersRef.current.clearQueuedDirection(runtime);
            if (rejected.reason === 'wrongMatch' || rejected.reason === 'wrongRole') {
              failReconnect();
              return;
            }
            // The server acknowledges every well-formed message and refuses only at the
            // connection level, so a rejection of anything but the newest frame can only
            // mean this client has lost the thread; a stale or gapped sequence is
            // absorbed server-side and never reported.
            const newestSequence = runtime.nextSequence === null ? null : runtime.nextSequence - 1;
            if (rejected.sequence !== newestSequence) {
              scheduleReconnect();
              return;
            }
            runtime.nextSequence = rejected.sequence;
            runtime.pendingInputs = runtime.pendingInputs.filter(input => input.sequence !== rejected.sequence);
            runtime.sentFrames = runtime.sentFrames.filter(frame => frame.sequence !== rejected.sequence);
            setPendingInputs(runtime.pendingInputs);
          } else if (message.type === 'matchClosed') {
            const closedMessage = message as unknown as TClosed;
            if (closedMessage.sequence < runtime.lastSnapshotSequence) return;
            runtime.lastSnapshotSequence = closedMessage.sequence;
            runtime.terminal = true;
            runtime.attemptGeneration++;
            if (runtime.retryTimer !== null) clearTimeout(runtime.retryTimer);
            if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
            runtime.retryTimer = null;
            runtime.deadlineTimer = null;
            clearConnectionTimers();
            runtime.nextSequence = null;
            runtime.pendingInputs = [];
            runtime.sentFrames = [];
            setPendingInputs([]);
            setClosed(closedMessage);
            setStatus('closed');
          }
        };
        socket.onerror = () => {
          if (current() && attempt === runtime.attemptGeneration && runtime.socket === socket) scheduleReconnect();
        };
        socket.onclose = () => {
          if (!current() || attempt !== runtime.attemptGeneration || runtime.socket !== socket) return;
          if (runtime.terminal) setStatus('closed');
          else scheduleReconnect();
        };
      } catch {
        if (current() && attempt === runtime.attemptGeneration) scheduleReconnect();
      }
    };

    setWelcome(null);
    setLatestSnapshot(null);
    setClosed(null);
    setPendingInputs([]);
    setCurrentInput(neutralInput);
    if (enabled) {
      setStatus('connecting');
      void connect();
    } else {
      setStatus('disabled');
    }

    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      if (runtime.retryTimer !== null) clearTimeout(runtime.retryTimer);
      if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
      clearConnectionTimers();
      runtime.socket?.close();
    };
  }, [enabled, matchId]);

  return {
    status, welcome, latestSnapshot, closed, pendingInputs,
    pendingInputCount: pendingInputs.length, currentInput,
    serverClock: serverClockRef.current, inputLead: inputLeadRef.current,
    currentPredictedTick: () => runtimeRef.current === null ? 0 : currentPredictedTick(runtimeRef.current),
    sendInput, sendHeartbeat,
  };
}
