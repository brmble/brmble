import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArenaInputState, ArenaPredictionConstants, ArenaSnapshot, ArenaStateSnapshot } from './arenaProtocol';
import { stepLocal, type PredictedArenaState } from './arenaMath';
import { useArenaConnection } from './useArenaConnection';
import { useArenaState, type ArenaRenderState } from './useArenaState';

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
    // Authoritative ids are positive; the server model mirrors that so the client's
    // predicted shot (negative id) is replaced by, not confused with, the real one.
    projectiles: local.projectiles.map(projectile => ({ ...projectile, id: Math.abs(projectile.id) })),
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
  /** The x of the local player's own projectile as drawn each tick, or null when none is drawn. */
  projectile: Array<number | null>;
}

interface Script {
  pressAt: number;
  releaseAt: number;
  /** The held movement from `pressAt` to `releaseAt`; right unless given. */
  move?: ArenaInputState;
  /** Start charging at this tick and release the shot at `fireAt`, both while still holding `move`. */
  chargeAt?: number;
  fireAt?: number;
}

async function play(upMs: number, downMs: number, ticks: number, script: Script): Promise<Run> {
  let frame: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('WebSocket', FakeWebSocket);

  // What the canvas draws comes through `onFrame` every animation frame; the hook's
  // React state only refreshes on a reconcile, so it is read here as the board reads it.
  const drawn: { current: ArenaRenderState | null } = { current: null };
  const hook = renderHook(() => {
    const connection = useArenaConnection({ matchId: 91, enabled: true });
    const state = useArenaState({
      welcome: connection.welcome, latestSnapshot: connection.latestSnapshot, pendingInputs: connection.pendingInputs,
      currentInput: connection.currentInput, selfSessionId: 10, serverClock: connection.serverClock,
      currentPredictedTick: connection.currentPredictedTick, onFrame: current => { drawn.current = current; },
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

  const run: Run = { displayed: [], authority: [], projectile: [] };
  const move = script.move ?? right;
  for (let tick = 1; tick <= ticks; tick++) {
    await act(() => vi.advanceTimersByTimeAsync(TICK_MS));
    if (tick === script.pressAt) act(() => hook.result.current.connection.sendInput(move));
    if (tick === script.chargeAt) act(() => hook.result.current.connection.sendInput({ ...move, charging: true }));
    if (tick === script.fireAt) act(() => hook.result.current.connection.sendInput({ ...move, fireReleased: true }));
    if (tick === script.releaseAt) act(() => hook.result.current.connection.sendInput(neutral));
    server.tick(performance.now());
    act(() => frame?.(performance.now()));
    const rendered = drawn.current;
    run.displayed.push(rendered?.localPlayer?.x ?? Number.NaN);
    run.authority.push(server.authority.player.x);
    const own = (rendered?.projectiles ?? []).filter(projectile => projectile.ownerSessionId === 10);
    expect(own.length, `tick ${tick}: one own projectile at most, got ${own.length}`).toBeLessThanOrEqual(1);
    run.projectile.push(own[0]?.x ?? null);
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

  it.each([[0, 0], [50, 50], [100, 100]])('a shot fired while moving at %d/%d ms flies from the player without a gap or a jump back', async (up, down) => {
    // Run downwards while aiming right, charge past the minimum, release: the shot
    // must appear at once, be drawn on every tick until it leaves the arena, and only
    // ever move forward. Before own projectiles were drawn in the prediction frame
    // this showed the predicted shot, a gap of a few ticks, then the authoritative
    // shot reappearing where the player had been thousands of units ago.
    const runDown: ArenaInputState = { ...neutral, moveY: 32767 };
    const run = await play(up, down, 240, { pressAt: 30, move: runDown, chargeAt: 60, fireAt: 100, releaseAt: 220 });
    const first = run.projectile.findIndex(x => x !== null);
    expect(first, 'the shot is drawn').toBeGreaterThan(0);
    expect(first, 'the shot is drawn on the tick it was fired').toBeLessThanOrEqual(100);
    let last = first;
    while (last + 1 < run.projectile.length && run.projectile[last + 1] !== null) last++;
    // From x = 780 at about y = 5600 to the 9000 radius: some 26 ticks of flight.
    // Much shorter means it vanished before the edge; anything after means it came back.
    expect(last - first).toBeGreaterThanOrEqual(20);
    expect(run.projectile.slice(last + 1).every(x => x === null), 'gone once it left the arena').toBe(true);
    const flight = run.projectile.slice(first, last + 1) as number[];
    const steps = flight.map((x, index) => index === 0 ? 240 : x - flight[index - 1]);
    const trace = flight.map((x, index) => `${first + 1 + index}:${x}`).join(' ');
    expect(steps.filter(step => step < 0), `backward steps:\n${trace}`).toEqual([]);
    // Known residual, not the defect this test is about: the connection's stamp clock
    // (`serverTick + max(1, elapsed) + lead`) and the presentation's tick-phase clock
    // disagree by a tick or two around a reconcile, so the frame that re-anchors the
    // presentation can move a projectile up to three ticks at once. See the note on
    // the release frame in the movement test below.
    expect(steps.filter(step => step > 3 * 240), `jumps of more than three ticks:\n${trace}`).toEqual([]);
  });

  it.each([[0, 0], [50, 50], [100, 100]])('holding right at %d/%d ms never steps the local player backwards', async (up, down) => {
    const run = await play(up, down, 240, { pressAt: 60, releaseAt: 200 });
    // Ticks 61..199: the key is held and no input changes hands.
    const steps = run.displayed.slice(60, 199).map((x, index, all) => index === 0 ? 0 : x - all[index - 1]);
    const backwards = steps.map((step, index) => [61 + index, step] as const).filter(([, step]) => step < 0);
    const trace = run.displayed.slice(55, 120).map((x, index) => `${55 + index}:${x}/${run.authority[55 + index]}`).join(' ');
    expect(backwards, `backward steps while holding right (tick, step): ${JSON.stringify(backwards)}\n${trace}`).toEqual([]);
    // It moves, and by roughly the held distance.
    expect(run.displayed[199] - run.displayed[60]).toBeGreaterThan(90 * 120);
    // Known residual on the frame an input change is sent (the release at tick 200):
    // the input is stamped with the connection's clock, `serverTick + max(1, elapsed)
    // + lead`, while the presentation has advanced on its own tick-phase clock, and
    // the two can differ by a tick or two. The input-only reconcile then replays
    // through the stamp, so the display steps back by that difference, once, at base
    // speed 90 per tick. Pinned at its current size so a regression is visible; the
    // fix is a single local clock, which is a design change.
    const releaseStep = run.displayed[199] - run.displayed[198];
    expect(releaseStep, `release-frame step ${releaseStep}`).toBeGreaterThanOrEqual(-2 * 90);
  });
});
