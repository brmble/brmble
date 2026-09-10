import { useEffect, useRef, useState } from 'react';
import { requestRealtimeTicket } from '../../../api/games';
import type {
  ArenaClientMessage,
  ArenaInputState,
  ArenaMatchClosed,
  ArenaSnapshot,
  ArenaWelcome,
} from './arenaProtocol';
import { parseServerMessage } from './arenaProtocol';

const RECONNECT_DELAYS = [250, 500, 1000, 2000] as const;
// Leave headroom below the server's rolling 30 aim changes/second limit.
const AIM_INTERVAL_MS = 40;
const DEFAULT_HEARTBEAT_MS = 250;
const DEFAULT_TICK_RATE = 60;
const RECONNECT_GRACE_MS = 5000;
const RECENT_INPUT_TICKS = 6;

export type ArenaConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'failed';

/**
 * Task 14 replays each pending interval inclusively. `fromTick > toTick` is an
 * empty held-state interval; edge flags still apply once and must not be dropped.
 */
export interface PendingArenaInput {
  sequence: number;
  predictedTick: number;
  fromTick: number;
  toTick: number;
  input: ArenaInputState;
}

export interface RecentArenaInput extends PendingArenaInput {
  acknowledgedAtTick?: number | null;
}

export interface ArenaConnection {
  status: ArenaConnectionStatus;
  welcome: ArenaWelcome | null;
  latestSnapshot: ArenaSnapshot | null;
  closed: ArenaMatchClosed | null;
  pendingInputs: PendingArenaInput[];
  recentInputs: RecentArenaInput[];
  pendingInputCount: number;
  currentInput: ArenaInputState;
  sendInput: (input: ArenaInputState) => void;
  sendHeartbeat: () => void;
}

const neutralInput: ArenaInputState = {
  moveX: 0,
  moveY: 0,
  aimX: 32767,
  aimY: 0,
  charging: false,
  fireReleased: false,
  dash: false,
};

interface Runtime {
  generation: number;
  matchId: number;
  socket: WebSocket | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  aimTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectStartedAt: number | null;
  retryIndex: number;
  attemptGeneration: number;
  sessionId: number | null;
  nextSequence: number | null;
  serverTick: number;
  tickRate: number;
  clockStartedAt: number;
  lastSnapshotSequence: number;
  lastAimSentAt: number;
  transmittedAimX: number;
  transmittedAimY: number;
  lastSentInput: ArenaInputState;
  currentInput: ArenaInputState;
  queuedAimInput: ArenaInputState | null;
  pendingInputs: PendingArenaInput[];
  recentInputs: RecentArenaInput[];
  sentFrames: Array<{ sequence: number; aimX: number; aimY: number; aimSentAt: number }>;
  terminal: boolean;
}

function sameHeldState(left: ArenaInputState, right: ArenaInputState): boolean {
  return left.moveX === right.moveX && left.moveY === right.moveY && left.charging === right.charging;
}

function currentPredictedTick(runtime: Runtime): number {
  const elapsedTicks = Math.floor((performance.now() - runtime.clockStartedAt) * runtime.tickRate / 1000);
  return runtime.serverTick + Math.max(1, elapsedTicks);
}

export function useArenaConnection({ matchId, enabled }: { matchId: number; enabled: boolean }): ArenaConnection {
  const [status, setStatus] = useState<ArenaConnectionStatus>(enabled ? 'connecting' : 'disabled');
  const [welcome, setWelcome] = useState<ArenaWelcome | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<ArenaSnapshot | null>(null);
  const [closed, setClosed] = useState<ArenaMatchClosed | null>(null);
  const [pendingInputs, setPendingInputs] = useState<PendingArenaInput[]>([]);
  const [recentInputs, setRecentInputs] = useState<RecentArenaInput[]>([]);
  const [currentInput, setCurrentInput] = useState<ArenaInputState>(neutralInput);
  const runtimeRef = useRef<Runtime | null>(null);
  const sendStateRef = useRef<(runtime: Runtime, input: ArenaInputState, heartbeat: boolean) => void>(() => {});

  const sendMessage = (runtime: Runtime, message: ArenaClientMessage) => {
    if (runtimeRef.current !== runtime || runtime.socket?.readyState !== WebSocket.OPEN) return false;
    runtime.socket.send(JSON.stringify(message));
    return true;
  };

  const sendState = (runtime: Runtime, input: ArenaInputState, heartbeat: boolean) => {
    if (runtime.terminal || runtime.nextSequence === null) return;
    const predictedTick = currentPredictedTick(runtime);
    const sequence = runtime.nextSequence;
    const recordedInput = heartbeat ? { ...input, fireReleased: false, dash: false } : input;
    const message: ArenaClientMessage = heartbeat
      ? {
          type: 'heartbeat', protocolVersion: 1, matchId: runtime.matchId, sequence, predictedTick,
          moveX: input.moveX, moveY: input.moveY, aimX: input.aimX, aimY: input.aimY,
          charging: input.charging,
        }
      : { type: 'input', protocolVersion: 1, matchId: runtime.matchId, sequence, predictedTick, ...input };
    if (!sendMessage(runtime, message)) return;

    runtime.nextSequence++;
    const aimChanged = input.aimX !== runtime.transmittedAimX || input.aimY !== runtime.transmittedAimY;
    const aimSentAt = aimChanged || runtime.sentFrames.length === 0
      ? performance.now()
      : runtime.lastAimSentAt;
    if (aimChanged || runtime.sentFrames.length === 0) runtime.lastAimSentAt = aimSentAt;
    runtime.transmittedAimX = input.aimX;
    runtime.transmittedAimY = input.aimY;
    runtime.lastSentInput = recordedInput;
    runtime.sentFrames.push({ sequence, aimX: input.aimX, aimY: input.aimY, aimSentAt });
    const extended = runtime.pendingInputs.map((pending, index) => index === runtime.pendingInputs.length - 1
        ? { ...pending, toTick: predictedTick - 1 }
        : pending);
    runtime.pendingInputs = [...extended, {
      sequence, predictedTick, fromTick: predictedTick, toTick: predictedTick, input: recordedInput,
    }];
    if (recordedInput.dash) {
      runtime.recentInputs = [...runtime.recentInputs, {
        sequence, predictedTick, fromTick: predictedTick, toTick: predictedTick,
        input: recordedInput, acknowledgedAtTick: null,
      }];
    }
    setPendingInputs(runtime.pendingInputs);
    setRecentInputs(runtime.recentInputs);
  };
  sendStateRef.current = sendState;

  const queueAim = (runtime: Runtime, input: ArenaInputState) => {
    runtime.queuedAimInput = input;
    if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
    const wait = Math.max(0, AIM_INTERVAL_MS - (performance.now() - runtime.lastAimSentAt));
    runtime.aimTimer = setTimeout(() => {
      runtime.aimTimer = null;
      if (runtime.terminal) return;
      const queued = runtime.queuedAimInput;
      runtime.queuedAimInput = null;
      if (!queued) return;
      sendStateRef.current(runtime, {
        ...runtime.currentInput,
        aimX: queued.aimX,
        aimY: queued.aimY,
        fireReleased: false,
        dash: false,
      }, false);
    }, wait);
  };

  const withLegalAim = (runtime: Runtime, input: ArenaInputState): ArenaInputState => {
    const aimChanged = input.aimX !== runtime.transmittedAimX || input.aimY !== runtime.transmittedAimY;
    if (!aimChanged || performance.now() - runtime.lastAimSentAt >= AIM_INTERVAL_MS) return input;
    return { ...input, aimX: runtime.transmittedAimX, aimY: runtime.transmittedAimY };
  };

  const sendHeartbeat = () => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.terminal) return;
    const frame = withLegalAim(runtime, runtime.currentInput);
    if (frame.aimX === runtime.currentInput.aimX && frame.aimY === runtime.currentInput.aimY) {
      if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
      runtime.aimTimer = null;
      runtime.queuedAimInput = null;
    }
    sendStateRef.current(runtime, frame, true);
    if (frame.aimX !== runtime.currentInput.aimX || frame.aimY !== runtime.currentInput.aimY) {
      queueAim(runtime, runtime.currentInput);
    }
  };

  const sendInput = (input: ArenaInputState) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.terminal) return;
    const previous = runtime.currentInput;
    runtime.currentInput = input;
    setCurrentInput(input);

    const immediate = !sameHeldState(previous, input) || input.fireReleased || input.dash;
    const aimChanged = input.aimX !== runtime.transmittedAimX || input.aimY !== runtime.transmittedAimY;
    if (immediate) {
      // A shot or a dash commits to a direction, so it carries the true aim even inside
      // the throttle window. Sending the previously transmitted aim instead would fire
      // it where the player used to be pointing. They are rare — the shot cooldown caps
      // firing near 2.5/s — so the aim change they spend is affordable.
      const directional = input.fireReleased || input.dash;
      const frame = directional ? input : withLegalAim(runtime, input);
      if (frame.aimX === input.aimX && frame.aimY === input.aimY) {
        if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
        runtime.aimTimer = null;
        runtime.queuedAimInput = null;
      }
      sendStateRef.current(runtime, frame, false);
      if (frame.aimX !== input.aimX || frame.aimY !== input.aimY) queueAim(runtime, input);
      return;
    }
    if (!aimChanged) return;
    if (performance.now() - runtime.lastAimSentAt >= AIM_INTERVAL_MS) {
      sendStateRef.current(runtime, { ...input, fireReleased: false, dash: false }, false);
    } else {
      queueAim(runtime, input);
    }
  };

  useEffect(() => {
    const generation = (runtimeRef.current?.generation ?? 0) + 1;
    const runtime: Runtime = {
      generation, matchId, socket: null, retryTimer: null, deadlineTimer: null,
      aimTimer: null, heartbeatTimer: null, reconnectStartedAt: null, retryIndex: 0,
      attemptGeneration: 0, sessionId: null, nextSequence: null, serverTick: 0,
      tickRate: DEFAULT_TICK_RATE, clockStartedAt: performance.now(), lastSnapshotSequence: -1,
      lastAimSentAt: Number.NEGATIVE_INFINITY, transmittedAimX: neutralInput.aimX,
      transmittedAimY: neutralInput.aimY, lastSentInput: neutralInput,
      currentInput: neutralInput, queuedAimInput: null, pendingInputs: [], recentInputs: [], sentFrames: [], terminal: false,
    };
    runtimeRef.current = runtime;

    const current = () => runtimeRef.current === runtime;
    const clearConnectionTimers = () => {
      if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
      if (runtime.heartbeatTimer !== null) clearInterval(runtime.heartbeatTimer);
      runtime.aimTimer = null;
      runtime.heartbeatTimer = null;
      runtime.queuedAimInput = null;
    };
    const installNeutral = () => {
      runtime.currentInput = neutralInput;
      runtime.lastSentInput = neutralInput;
      setCurrentInput(neutralInput);
      setPendingInputs([]);
      runtime.pendingInputs = [];
      runtime.recentInputs = [];
      setRecentInputs([]);
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

    const handleWelcome = (socket: WebSocket, message: ArenaWelcome) => {
      if (!current() || runtime.socket !== socket || message.matchId !== matchId) return;
      if (runtime.nextSequence !== null) {
        failReconnect();
        return;
      }
      runtime.serverTick = message.serverTick;
      runtime.sessionId = message.sessionId;
      runtime.tickRate = message.tickRate;
      runtime.clockStartedAt = performance.now();
      runtime.nextSequence = message.acknowledgedInput + 1;
      runtime.lastSnapshotSequence = message.snapshotSequence;
      runtime.retryIndex = 0;
      runtime.reconnectStartedAt = null;
      if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
      runtime.deadlineTimer = null;
      runtime.currentInput = neutralInput;
      runtime.lastSentInput = neutralInput;
      const self = message.state.players.find(player => player.sessionId === message.sessionId);
      runtime.transmittedAimX = self?.aimX ?? neutralInput.aimX;
      runtime.transmittedAimY = self?.aimY ?? neutralInput.aimY;
      runtime.lastAimSentAt = Number.NEGATIVE_INFINITY;
      runtime.pendingInputs = [];
      runtime.recentInputs = [];
      runtime.sentFrames = [];
      setCurrentInput(neutralInput);
      setPendingInputs([]);
      setRecentInputs([]);
      setWelcome(message);
      setLatestSnapshot(null);
      setStatus('connected');
      sendMessage(runtime, {
        type: 'attachAck', protocolVersion: 1, matchId, snapshotSequence: message.snapshotSequence,
      });
      runtime.heartbeatTimer = setInterval(() => {
        if (current() && !runtime.terminal) {
          const frame = withLegalAim(runtime, runtime.currentInput);
          if (frame.aimX === runtime.currentInput.aimX && frame.aimY === runtime.currentInput.aimY) {
            if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
            runtime.aimTimer = null;
            runtime.queuedAimInput = null;
          }
          sendStateRef.current(runtime, frame, true);
          if (frame.aimX !== runtime.currentInput.aimX || frame.aimY !== runtime.currentInput.aimY) {
            queueAim(runtime, runtime.currentInput);
          }
        }
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
          const message = parseServerMessage(event.data);
          if (!message || message.matchId !== matchId) return;
          if (message.type === 'welcome') {
            handleWelcome(socket, message);
          } else if (message.type === 'snapshot') {
            if (message.sequence < runtime.lastSnapshotSequence) return;
            runtime.lastSnapshotSequence = message.sequence;
            runtime.serverTick = message.serverTick;
            runtime.clockStartedAt = performance.now();
            setLatestSnapshot(message);
            const self = message.players.find(player => player.sessionId === runtime.sessionId);
            const acknowledged = self?.acknowledgedInput;
            if (acknowledged !== undefined) {
              runtime.recentInputs = runtime.recentInputs
                .map(input => input.sequence <= acknowledged && input.acknowledgedAtTick === null
                  ? { ...input, acknowledgedAtTick: message.serverTick }
                  : input)
                .filter(input => input.acknowledgedAtTick == null
                  || message.serverTick - input.acknowledgedAtTick <= RECENT_INPUT_TICKS);
              runtime.pendingInputs = runtime.pendingInputs.filter(input => input.sequence > acknowledged);
              runtime.sentFrames = runtime.sentFrames.filter(frame => frame.sequence > acknowledged);
              setPendingInputs(runtime.pendingInputs);
              setRecentInputs(runtime.recentInputs);
            }
          } else if (message.type === 'inputRejected') {
            if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
            runtime.aimTimer = null;
            runtime.queuedAimInput = null;
            if (message.reason === 'wrongMatch' || message.reason === 'wrongRole') {
              failReconnect();
              return;
            }
            if (message.reason === 'staleSequence' || message.reason === 'sequenceGap') {
              scheduleReconnect();
              return;
            }
            const newestSequence = runtime.nextSequence === null ? null : runtime.nextSequence - 1;
            if (message.sequence !== newestSequence) {
              scheduleReconnect();
              return;
            }
            runtime.nextSequence = message.sequence;
            runtime.pendingInputs = runtime.pendingInputs.filter(input => input.sequence !== message.sequence);
            runtime.recentInputs = runtime.recentInputs.filter(input => input.sequence !== message.sequence);
            runtime.sentFrames = runtime.sentFrames.filter(frame => frame.sequence !== message.sequence);
            setPendingInputs(runtime.pendingInputs);
            setRecentInputs(runtime.recentInputs);
          } else if (message.type === 'matchClosed') {
            if (message.sequence < runtime.lastSnapshotSequence) return;
            runtime.lastSnapshotSequence = message.sequence;
            runtime.terminal = true;
            runtime.attemptGeneration++;
            if (runtime.retryTimer !== null) clearTimeout(runtime.retryTimer);
            if (runtime.deadlineTimer !== null) clearTimeout(runtime.deadlineTimer);
            runtime.retryTimer = null;
            runtime.deadlineTimer = null;
            clearConnectionTimers();
            runtime.nextSequence = null;
            runtime.pendingInputs = [];
            runtime.recentInputs = [];
            runtime.sentFrames = [];
            setPendingInputs([]);
            setRecentInputs([]);
            setClosed(message);
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
    setRecentInputs([]);
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
    status, welcome, latestSnapshot, closed, pendingInputs, recentInputs,
    pendingInputCount: pendingInputs.length, currentInput, sendInput, sendHeartbeat,
  };
}
