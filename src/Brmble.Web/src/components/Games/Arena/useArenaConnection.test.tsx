import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArenaConnection } from './useArenaConnection';

/**
 * What the arena's codec adds to the generic realtime connection: its wire shape, and
 * the aim as the budgeted direction - throttled when it moves on its own, carried true
 * on a fire or dash. The connection itself (ticket, welcome, sequencing, pending
 * intervals, reconnect, rejections) is covered in `Realtime/useRealtimeConnection.test`.
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
  sent: unknown[] = [];
  close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  open() { act(() => { this.readyState = FakeWebSocket.OPEN; this.onopen?.(new Event('open')); }); }
  message(value: unknown) { act(() => this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(value) }))); }
}

const held = {
  moveX: 32767, moveY: 0, aimX: 32767, aimY: 0,
  charging: false, fireReleased: false, dash: false,
};

const welcome = (acknowledgedInput = 0, snapshotSequence = 1) => ({
  type: 'welcome', protocolVersion: 1, rulesetVersion: 1, matchId: 91,
  role: 'participant', sessionId: 10, snapshotSequence, serverTick: 100,
  generatedAtUnixMs: Date.now(), tickRate: 60, snapshotRate: 20, interpolationMs: 100, maxExtrapolationMs: 50,
  inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
  prediction: {
    unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90,
    chargedMovePerTick: 45, momentumRetentionPermille: 920, chargeTicks: 90, minChargeTicks: 30,
    forcedFireTicks: 30, shotCooldownTicks: 24, projectileRadius: 180,
    projectilePerTick: 240, projectileBaseKnockback: 130, projectileBonusKnockback: 220,
    recoilBase: 45, recoilBonus: 105, dashTicks: 6, dashPerTick: 240,
  },
  state: {
    phase: 'awaitingParticipants', phaseEndsAtTick: null, score: [0, 0], consecutiveDoubleKos: 0,
    arena: { radius: 9000, shrinkPhase: 'hold' },
    players: [
      { sessionId: 10, side: 0, x: -3500, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput },
      { sessionId: 20, side: 1, x: 3500, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, dashTicksRemaining: 0, acknowledgedInput: 0 },
    ], projectiles: [],
  },
  acknowledgedInput,
});

async function connect(acknowledgedInput = 0) {
  const rendered = renderHook(() => useArenaConnection({ matchId: 91, enabled: true }));
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(welcome(acknowledgedInput));
  return { ...rendered, socket };
}

describe('useArenaConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeWebSocket.instances = [];
    requestRealtimeTicket.mockReset().mockResolvedValue({
      protocolVersion: 1, ticket: 'ticket +/=', url: 'wss://chat.example/games/realtime',
      expiresAt: '2026-08-28T12:00:15.0000000+00:00',
    });
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends the arena wire shape: every field on an input, held state and aim on a heartbeat', async () => {
    const h = await connect();
    expect(h.socket.sent[0]).toEqual({ type: 'attachAck', protocolVersion: 1, matchId: 91, snapshotSequence: 1 });

    act(() => h.result.current.sendInput({ ...held, charging: true, dash: true }));
    expect(h.socket.sent[1]).toEqual({
      type: 'input', protocolVersion: 1, matchId: 91, sequence: 1, predictedTick: 104,
      ...held, charging: true, dash: true,
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
    // serverTick 100 + 15 ticks elapsed + the 3-tick minimum lead; no edges.
    expect(h.socket.sent[2]).toEqual({
      type: 'heartbeat', protocolVersion: 1, matchId: 91, sequence: 2,
      predictedTick: 118, moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: true,
    });
    expect(h.result.current.pendingInputs[1].input).toEqual({ ...held, charging: true });
  });

  it.each([
    ['dash', { ...held, aimX: 0, aimY: 32767, dash: true }],
    ['fire', { ...held, aimX: 0, aimY: 32767, fireReleased: true }],
  ])('sends an immediate %s with the true aim rather than the throttled one', async (_label, input) => {
    // A shot or dash commits to a direction. Sending it with the previously
    // transmitted aim fires it where the player used to be pointing, which is the
    // visible flick back to the old facing. These are rare enough - the shot cooldown
    // caps firing at about 2.5/s - that spending an aim change on them is cheap.
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => h.result.current.sendInput(input));

    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'input', sequence: 2, aimX: 0, aimY: 32767,
      fireReleased: input.fireReleased, dash: input.dash,
    });
    // The aim went out with the action, so there is nothing left to queue.
    const afterAction = h.socket.sent.length;
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(h.socket.sent).toHaveLength(afterAction);
  });

  it('stays under the server aim-change budget under spam clicking', async () => {
    const h = await connect();
    let aimAngle = 0;
    // One second of 60fps mouse movement with a click every ~60ms.
    for (let ms = 0; ms < 1000; ms += 16) {
      aimAngle += 0.2;
      const aimX = Math.round(Math.cos(aimAngle) * 32767);
      const aimY = Math.round(Math.sin(aimAngle) * 32767);
      act(() => h.result.current.sendInput({ ...held, aimX, aimY }));
      if (ms % 64 === 0) {
        act(() => h.result.current.sendInput({ ...held, aimX, aimY, charging: true }));
        act(() => h.result.current.sendInput({ ...held, aimX, aimY, fireReleased: true }));
      }
      await act(() => vi.advanceTimersByTimeAsync(16));
    }
    const wire = h.socket.sent as { aimX: number; aimY: number }[];
    let aimChanges = 0;
    let previousX = 32767;
    let previousY = 0;
    for (const message of wire) {
      if (message.aimX !== previousX || message.aimY !== previousY) aimChanges++;
      previousX = message.aimX;
      previousY = message.aimY;
    }
    // ContinuousGameCoordinator allows 120 messages and MaxDirectionChangesPerSecond
    // direction changes per second. Nothing else guards this relationship, and it is
    // not generous: the 40ms throttle intends 25/s, heartbeats carry aim too, and fire
    // and dash deliberately bypass the throttle to keep their direction honest.
    expect(wire.length).toBeLessThan(120);
    expect(aimChanges).toBeLessThan(45);
  });

  it('sends held changes and edges immediately but limits aim-only changes to 25Hz', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    expect(h.socket.sent).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(39));
    expect(h.socket.sent).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(h.socket.sent[2]).toMatchObject({ type: 'input', sequence: 2, aimX: 0, aimY: 32767 });
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767, dash: true }));
    expect(h.socket.sent[3]).toMatchObject({ type: 'input', sequence: 3, dash: true });
  });

  it.each([
    ['movement', { ...held, moveX: -32767, aimX: 0, aimY: 32767 }],
  ])('sends an immediate %s change with transmitted aim and queues requested aim', async (_label, input) => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => h.result.current.sendInput(input));

    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'input', sequence: 2, moveX: input.moveX,
      fireReleased: input.fireReleased, dash: input.dash, aimX: 32767, aimY: 0,
    });
    expect(h.result.current.currentInput).toMatchObject({ aimX: 0, aimY: 32767 });
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'input', sequence: 3, aimX: 0, aimY: 32767, fireReleased: false, dash: false,
    });
    expect(h.socket.sent.filter(message => (
      message as { fireReleased?: boolean; dash?: boolean }
    ).fireReleased || (message as { dash?: boolean }).dash)).toHaveLength(input.fireReleased || input.dash ? 1 : 0);
  });

  it('coalesces queued aim to the latest request without delaying immediate held state', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(5));
    act(() => h.result.current.sendInput({ ...held, moveX: -32767, aimX: 0, aimY: 32767 }));
    act(() => h.result.current.sendInput({ ...held, moveX: 0, aimX: -32767, aimY: 0 }));
    expect(h.socket.sent.slice(-2)).toMatchObject([
      { sequence: 2, moveX: -32767, aimX: 32767, aimY: 0 },
      { sequence: 3, moveX: 0, aimX: 32767, aimY: 0 },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(35));
    expect(h.socket.sent.at(-1)).toMatchObject({ sequence: 4, moveX: 0, aimX: -32767, aimY: 0 });
  });

  it('rebases queued aim on heartbeat and keeps aim-changing sends 40ms apart', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    act(() => h.result.current.sendHeartbeat());
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'heartbeat', aimX: 32767, aimY: 0 });
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'input', aimX: 0, aimY: 32767 });
    act(() => h.result.current.sendInput({ ...held, aimX: -32767, aimY: 0 }));
    const beforeQueuedAim = h.socket.sent.length;
    await act(() => vi.advanceTimersByTimeAsync(39));
    expect(h.socket.sent).toHaveLength(beforeQueuedAim);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(h.socket.sent).toHaveLength(beforeQueuedAim + 1);
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'input', aimX: -32767, aimY: 0 });
  });

  it('lets the heartbeat cadence satisfy a queued aim at its legal slot', async () => {
    const h = await connect();
    await act(() => vi.advanceTimersByTimeAsync(210));
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'heartbeat', sequence: 2, aimX: 0, aimY: 32767,
    });
    expect(h.socket.sent).toHaveLength(3);
  });

  it('cancels queued aim on rejection instead of retrying the rejected sequence', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(10));
    act(() => h.result.current.sendInput({ ...held, moveX: -32767, aimX: 0, aimY: 32767 }));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 2, reason: 'rateLimited' });
    await act(() => vi.advanceTimersByTimeAsync(30));
    expect(h.socket.sent).toHaveLength(3);
    act(() => h.result.current.sendHeartbeat());
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'heartbeat', sequence: 2, aimX: 0, aimY: 32767 });
  });

  it('keeps rejected wire aim direction and timestamp for subsequent aim spacing', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(40));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 2, reason: 'rateLimited' });
    await act(() => vi.advanceTimersByTimeAsync(10));
    // A movement edge, not a dash: directional actions deliberately carry their true
    // aim, so they would not exercise the spacing this test is about.
    act(() => h.result.current.sendInput({ ...held, moveX: -32767, aimX: 32767, aimY: 0 }));
    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'input', sequence: 2, moveX: -32767, aimX: 0, aimY: 32767,
    });
    await act(() => vi.advanceTimersByTimeAsync(29));
    expect(h.socket.sent.at(-1)).toMatchObject({ aimX: 0, aimY: 32767 });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(h.socket.sent.at(-1)).toMatchObject({
      type: 'input', sequence: 3, aimX: 32767, aimY: 0,
    });
    expect(h.result.current.currentInput).toMatchObject({ moveX: -32767, aimX: 32767, aimY: 0 });
  });
});
