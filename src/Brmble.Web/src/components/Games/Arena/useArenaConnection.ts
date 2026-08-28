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
const AIM_INTERVAL_MS = 34;
const DEFAULT_HEARTBEAT_MS = 250;
const DEFAULT_TICK_RATE = 60;
const RECONNECT_GRACE_MS = 5000;

export type ArenaConnectionStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'failed';

export interface PendingArenaInput {
  sequence: number;
  predictedTick: number;
  fromTick: number;
  toTick: number;
  input: ArenaInputState;
}

export interface ArenaConnection {
  status: ArenaConnectionStatus;
  welcome: ArenaWelcome | null;
  latestSnapshot: ArenaSnapshot | null;
  closed: ArenaMatchClosed | null;
  pendingInputs: PendingArenaInput[];
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
  aimTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectStartedAt: number | null;
  retryIndex: number;
  sessionId: number | null;
  nextSequence: number | null;
  serverTick: number;
  tickRate: number;
  clockStartedAt: number;
  lastSnapshotSequence: number;
  lastSentAt: number;
  lastSentInput: ArenaInputState;
  currentInput: ArenaInputState;
  queuedAimInput: ArenaInputState | null;
  terminal: boolean;
}

function sameHeldState(left: ArenaInputState, right: ArenaInputState): boolean {
  return left.moveX === right.moveX && left.moveY === right.moveY && left.charging === right.charging;
}

function currentPredictedTick(runtime: Runtime): number {
  const elapsedTicks = Math.floor((performance.now() - runtime.clockStartedAt) * runtime.tickRate / 1000);
  return runtime.serverTick + Math.max(0, elapsedTicks);
}

export function useArenaConnection({ matchId, enabled }: { matchId: number; enabled: boolean }): ArenaConnection {
  const [status, setStatus] = useState<ArenaConnectionStatus>(enabled ? 'connecting' : 'disabled');
  const [welcome, setWelcome] = useState<ArenaWelcome | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<ArenaSnapshot | null>(null);
  const [closed, setClosed] = useState<ArenaMatchClosed | null>(null);
  const [pendingInputs, setPendingInputs] = useState<PendingArenaInput[]>([]);
  const [currentInput, setCurrentInput] = useState<ArenaInputState>(neutralInput);
  const runtimeRef = useRef<Runtime | null>(null);
  const sendStateRef = useRef<(runtime: Runtime, input: ArenaInputState, heartbeat: boolean) => void>(() => {});

  const sendMessage = (runtime: Runtime, message: ArenaClientMessage) => {
    if (runtimeRef.current !== runtime || runtime.socket?.readyState !== WebSocket.OPEN) return false;
    runtime.socket.send(JSON.stringify(message));
    return true;
  };

  const sendState = (runtime: Runtime, input: ArenaInputState, heartbeat: boolean) => {
    if (runtime.nextSequence === null) return;
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
    runtime.lastSentAt = performance.now();
    runtime.lastSentInput = recordedInput;
    setPendingInputs(previous => {
      const extended = previous.map((pending, index) => index === previous.length - 1
        ? { ...pending, toTick: Math.max(pending.fromTick, predictedTick - 1) }
        : pending);
      return [...extended, { sequence, predictedTick, fromTick: predictedTick, toTick: predictedTick, input: recordedInput }];
    });
  };
  sendStateRef.current = sendState;

  const sendHeartbeat = () => {
    const runtime = runtimeRef.current;
    if (runtime) sendStateRef.current(runtime, runtime.currentInput, true);
  };

  const sendInput = (input: ArenaInputState) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const previous = runtime.currentInput;
    runtime.currentInput = input;
    setCurrentInput(input);

    const immediate = !sameHeldState(previous, input) || input.fireReleased || input.dash;
    if (immediate || performance.now() - runtime.lastSentAt >= AIM_INTERVAL_MS) {
      if (runtime.aimTimer !== null) clearTimeout(runtime.aimTimer);
      runtime.aimTimer = null;
      runtime.queuedAimInput = null;
      sendStateRef.current(runtime, input, false);
      return;
    }
    if (input.aimX === previous.aimX && input.aimY === previous.aimY) return;

    runtime.queuedAimInput = input;
    if (runtime.aimTimer !== null) return;
    const wait = Math.max(0, AIM_INTERVAL_MS - (performance.now() - runtime.lastSentAt));
    runtime.aimTimer = setTimeout(() => {
      runtime.aimTimer = null;
      const queued = runtime.queuedAimInput;
      runtime.queuedAimInput = null;
      if (queued) sendStateRef.current(runtime, queued, false);
    }, wait);
  };

  useEffect(() => {
    const generation = (runtimeRef.current?.generation ?? 0) + 1;
    const runtime: Runtime = {
      generation, matchId, socket: null, retryTimer: null, aimTimer: null, heartbeatTimer: null,
      reconnectStartedAt: null, retryIndex: 0, sessionId: null, nextSequence: null, serverTick: 0,
      tickRate: DEFAULT_TICK_RATE, clockStartedAt: performance.now(), lastSnapshotSequence: -1,
      lastSentAt: Number.NEGATIVE_INFINITY, lastSentInput: neutralInput,
      currentInput: neutralInput, queuedAimInput: null, terminal: false,
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
      runtime.nextSequence = null;
    };

    const scheduleReconnect = () => {
      if (!current() || runtime.terminal || runtime.retryTimer !== null) return;
      clearConnectionTimers();
      const failedSocket = runtime.socket;
      runtime.socket = null;
      if (failedSocket && failedSocket.readyState < WebSocket.CLOSING) failedSocket.close();
      installNeutral();
      runtime.reconnectStartedAt ??= performance.now();
      setStatus('reconnecting');
      const elapsed = performance.now() - runtime.reconnectStartedAt;
      const delay = RECONNECT_DELAYS[runtime.retryIndex];
      if (delay === undefined || elapsed + delay > RECONNECT_GRACE_MS) {
        setStatus('failed');
        return;
      }
      runtime.retryIndex++;
      runtime.retryTimer = setTimeout(() => {
        runtime.retryTimer = null;
        void connect();
      }, delay);
    };

    const handleWelcome = (socket: WebSocket, message: ArenaWelcome) => {
      if (!current() || runtime.socket !== socket || message.matchId !== matchId) return;
      runtime.serverTick = message.serverTick;
      runtime.sessionId = message.sessionId;
      runtime.tickRate = message.tickRate;
      runtime.clockStartedAt = performance.now();
      runtime.nextSequence = message.acknowledgedInput + 1;
      runtime.lastSnapshotSequence = message.snapshotSequence;
      runtime.retryIndex = 0;
      runtime.reconnectStartedAt = null;
      runtime.currentInput = neutralInput;
      runtime.lastSentInput = neutralInput;
      setCurrentInput(neutralInput);
      setPendingInputs([]);
      setWelcome(message);
      setLatestSnapshot(null);
      setStatus('connected');
      sendMessage(runtime, {
        type: 'attachAck', protocolVersion: 1, matchId, snapshotSequence: message.snapshotSequence,
      });
      runtime.heartbeatTimer = setInterval(() => {
        if (current()) sendStateRef.current(runtime, runtime.currentInput, true);
      }, message.inputHeartbeatMs || DEFAULT_HEARTBEAT_MS);
    };

    const connect = async () => {
      if (!current() || !enabled) return;
      try {
        const ticket = await requestRealtimeTicket(matchId, 'participant');
        if (!current()) return;
        const socket = new WebSocket(`${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`);
        runtime.socket = socket;
        socket.onmessage = event => {
          if (!current() || runtime.socket !== socket || typeof event.data !== 'string') return;
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
              setPendingInputs(previous => previous.filter(input => input.sequence > acknowledged));
            }
          } else if (message.type === 'matchClosed') {
            if (message.sequence < runtime.lastSnapshotSequence) return;
            runtime.lastSnapshotSequence = message.sequence;
            runtime.terminal = true;
            clearConnectionTimers();
            setClosed(message);
            setStatus('closed');
          }
        };
        socket.onerror = () => {
          if (current() && runtime.socket === socket) scheduleReconnect();
        };
        socket.onclose = () => {
          if (!current() || runtime.socket !== socket) return;
          if (runtime.terminal) setStatus('closed');
          else scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
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
      clearConnectionTimers();
      runtime.socket?.close();
    };
  }, [enabled, matchId]);

  return {
    status, welcome, latestSnapshot, closed, pendingInputs,
    pendingInputCount: pendingInputs.length, currentInput, sendInput, sendHeartbeat,
  };
}
