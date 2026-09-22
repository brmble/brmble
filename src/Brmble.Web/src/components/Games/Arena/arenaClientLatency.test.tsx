import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaInputState, ArenaPredictionConstants, ArenaSnapshot, ArenaStateSnapshot } from './arenaProtocol';
import { stepLocal, type PredictedArenaState } from './arenaMath';
import { useArenaConnection } from './useArenaConnection';
import { useArenaState } from './useArenaState';

/**
 * The real client hooks - `useArenaConnection` feeding `useArenaState` - against a
 * simulated server that applies inputs at their stamped tick, with a configurable
 * one-way delay in each direction. This is the deterministic harness's sibling: same
 * scenario, but through the production hooks, timers and socket handling rather
 * than a model of them, so a disagreement between the two is a bug in the hooks.
 */

const { requestRealtimeTicket } = vi.hoisted(() => ({ requestRealtimeTicket: vi.fn() }));
vi.mock('../../../api/games', () => ({ requestRealtimeTicket }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<{ at: number; message: Record<string, unknown> }> = [];
  close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(raw: string) { this.sent.push({ at: performance.now(), message: JSON.parse(raw) }); }
  open() { act(() => { this.readyState = FakeWebSocket.OPEN; this.onopen?.(new Event('open')); }); }
  message(value: unknown) { act(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) }))); }
}

const prediction: ArenaPredictionConstants = {
  unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90, chargedMovePerTick: 45,
  momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30, forcedFireTicks: 30,
  shotCooldownTicks: 24, projectileRadius: 180, projectilePerTick: 240,
  projectileBaseKnockback: 130, projectileBonusKnockback: 220, recoilBase: 45,
  recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
};
const TICK_MS = 1000 / 60;
const neutral: ArenaInputState = { moveX: 0, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false };
const right: ArenaInputState = { ...neutral, moveX: 32767 };

function stateOf(local: PredictedArenaState, acknowledgedInput: number): ArenaStateSnapshot {
  return {
    phase: 'live', phaseEndsAtTick: null, score: [0, 0], consecutiveDoubleKos: 0,
    arena: { radius: 9000, shrinkPhase: 'hold' },
    players: [
      { ...local.player, dashTicksRemaining: local.dashTicks, acknowledgedInput },
      { sessionId: 20, side: 1, x: -3000, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0,
        forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0 },
    ],
    projectiles: [],
  };
}

function initialAuthority(serverTick: number): PredictedArenaState {
  return {
    player: { sessionId: 10, side: 0, x: 0, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0,
      forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0 },
    opponent: null, projectiles: [], arena: { radius: 9000, shrinkPhase: 'hold' }, phase: 'live',
    score: [0, 0], localKo: false, serverTick, chargeTicks: 0, dashTicks: 0, dashEndsAtTick: null, nextProjectileId: -1,
  };
}

/** A server that applies each input at its stamped tick, behind `upMs`/`downMs` of one-way delay. */
class SimulatedServer {
  authority = initialAuthority(100);
  held: ArenaInputState = neutral;
  acknowledged = 0;
  private consumed = 0;
  private readonly inbound: Array<{ arrivesAt: number; message: Record<string, unknown> }> = [];
  private readonly scheduled: Array<{ applyAt: number; input: ArenaInputState; sequence: number }> = [];
  private readonly outbound: Array<{ at: number; snapshot: ArenaSnapshot }> = [];
  private sequence = 1;

  private readonly socket: FakeWebSocket;
  private readonly upMs: number;
  private readonly downMs: number;

  constructor(socket: FakeWebSocket, upMs: number, downMs: number) {
    this.socket = socket;
    this.upMs = upMs;
    this.downMs = downMs;
  }

  /** Runs one server tick at client time `now`, delivering whatever is due. */
  tick(now: number) {
    for (; this.consumed < this.socket.sent.length; this.consumed++) {
      const { at, message } = this.socket.sent[this.consumed];
      this.inbound.push({ arrivesAt: at + this.upMs, message });
    }
    while (this.inbound.length > 0 && this.inbound[0].arrivesAt <= now) {
      const { message } = this.inbound.shift()!;
      if (message.type !== 'input' && message.type !== 'heartbeat') continue;
      const sequence = message.sequence as number;
      this.acknowledged = Math.max(this.acknowledged, sequence);
      const stamp = Math.min(Math.max(message.predictedTick as number, this.authority.serverTick + 1), this.authority.serverTick + 30);
      const input: ArenaInputState = {
        moveX: message.moveX as number, moveY: message.moveY as number, aimX: message.aimX as number, aimY: message.aimY as number,
        charging: message.charging as boolean, fireReleased: (message.fireReleased as boolean | undefined) ?? false,
        dash: (message.dash as boolean | undefined) ?? false,
      };
      let index = this.scheduled.length;
      while (index > 0 && this.scheduled[index - 1].applyAt > stamp) index--;
      this.scheduled.splice(index, 0, { applyAt: stamp, input, sequence });
    }
    let fire = false;
    let dash = false;
    while (this.scheduled.length > 0 && this.scheduled[0].applyAt <= this.authority.serverTick + 1) {
      const { input } = this.scheduled.shift()!;
      this.held = { ...input, fireReleased: false, dash: false };
      fire ||= input.fireReleased;
      dash ||= input.dash;
    }
    this.authority = stepLocal(this.authority, { ...this.held, fireReleased: fire, dash }, prediction);
    if (this.authority.serverTick % 3 === 0) {
      this.outbound.push({
        at: now + this.downMs,
        snapshot: {
          type: 'snapshot', protocolVersion: 1, matchId: 91, sequence: ++this.sequence,
          serverTick: this.authority.serverTick, generatedAtUnixMs: Date.now(),
          ...stateOf(this.authority, this.acknowledged),
        },
      });
    }
    while (this.outbound.length > 0 && this.outbound[0].at <= now) {
      this.socket.message(this.outbound.shift()!.snapshot);
    }
  }
}

function welcome() {
  return {
    type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91, role: 'participant', sessionId: 10,
    snapshotSequence: 1, serverTick: 100, generatedAtUnixMs: Date.now(), tickRate: 60, snapshotRate: 20,
    interpolationMs: 100, maxExtrapolationMs: 50, inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
    prediction, state: stateOf(initialAuthority(100), 0), acknowledgedInput: 0,
  };
}

interface Run {
  displayed: number[];
  authority: number[];
}

async function play(upMs: number, downMs: number, ticks: number, pressAt: number, releaseAt: number): Promise<Run> {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('WebSocket', FakeWebSocket);

  const hook = renderHook(() => {
    const connection = useArenaConnection({ matchId: 91, enabled: true });
    const state = useArenaState({
      welcome: connection.welcome, latestSnapshot: connection.latestSnapshot, pendingInputs: connection.pendingInputs,
      currentInput: connection.currentInput, selfSessionId: 10, serverClock: connection.serverClock,
      currentPredictedTick: connection.currentPredictedTick,
    });
    return { connection, state };
  });
  await act(() => vi.advanceTimersByTimeAsync(0));
  const socket = FakeWebSocket.instances[0];
  socket.open();
  // The welcome itself crosses the downlink.
  await act(() => vi.advanceTimersByTimeAsync(downMs));
  socket.message(welcome());
  const server = new SimulatedServer(socket, upMs, downMs);

  const run: Run = { displayed: [], authority: [] };
  for (let tick = 1; tick <= ticks; tick++) {
    await act(() => vi.advanceTimersByTimeAsync(TICK_MS));
    if (tick === pressAt) act(() => hook.result.current.connection.sendInput(right));
    if (tick === releaseAt) act(() => hook.result.current.connection.sendInput(neutral));
    server.tick(performance.now());
    act(() => frame?.(performance.now()));
    run.displayed.push(hook.result.current.state.localPlayer?.x ?? Number.NaN);
    run.authority.push(server.authority.player.x);
  }
  return run;
}

describe('arena client under latency (real hooks)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    FakeWebSocket.instances = [];
    requestRealtimeTicket.mockReset().mockResolvedValue({
      protocolVersion: 1, ticket: 'ticket', url: 'wss://chat.example/games/realtime',
      expiresAt: '2026-08-28T12:00:15.0000000+00:00',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([[0, 0], [50, 50], [100, 100]])('holding right at %d/%d ms never steps the local player backwards', async (up, down) => {
    const run = await play(up, down, 240, 60, 200);
    const steps = run.displayed.slice(60, 200).map((x, index, all) => index === 0 ? 0 : x - all[index - 1]);
    const backwards = steps.filter(step => step < 0);
    const trace = run.displayed.slice(55, 120).map((x, index) => `${55 + index}:${x}/${run.authority[55 + index]}`).join(' ');
    expect(backwards, `backward steps while holding right: ${backwards.length}\n${trace}`).toEqual([]);
    // It moves, and by roughly the held distance.
    expect(run.displayed[199] - run.displayed[60]).toBeGreaterThan(90 * 120);
  });
});
