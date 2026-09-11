import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArenaConnection } from './useArenaConnection';

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
  fail() { act(() => this.onerror?.(new Event('error'))); }
  closed() { act(() => this.onclose?.(new CloseEvent('close'))); }
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
      { sessionId: 10, side: 0, x: -3500, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput },
      { sessionId: 20, side: 1, x: 3500, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
    ], projectiles: [],
  },
  acknowledgedInput,
});

const world = (sequence: number, acknowledgedInput = 0) => ({
  type: 'snapshot', protocolVersion: 1, matchId: 91, sequence, serverTick: 120,
  generatedAtUnixMs: 1784989801350, phase: 'live', phaseEndsAtTick: null,
  score: [0, 0], consecutiveDoubleKos: 0,
  arena: { radius: 9000, shrinkPhase: 'hold' },
  players: [
    { sessionId: 10, side: 0, x: -3500, y: 0, vx: 0, vy: 0, aimX: 32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput },
    { sessionId: 20, side: 1, x: 3500, y: 0, vx: 0, vy: 0, aimX: -32767, aimY: 0, chargePermille: 0, forcedFireTicks: null, cooldownTicks: 0, dashAvailable: true, acknowledgedInput: 0 },
  ], projectiles: [],
});

const matchClosed = () => ({
  type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 121,
  serverTick: 3601, reason: 'completed',
  finalState: {
    ...world(1), type: undefined, protocolVersion: undefined, matchId: undefined,
    sequence: undefined, serverTick: undefined, generatedAtUnixMs: undefined,
    score: [2, 1], phase: 'ended',
  },
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

  it('opens the direct URL, acknowledges welcome, sequences input, and sends a complete heartbeat', async () => {
    const h = await connect();
    expect(h.socket.url).toBe('wss://chat.example/games/realtime?ticket=ticket+%2B%2F%3D');
    expect(h.socket.sent[0]).toEqual({ type: 'attachAck', protocolVersion: 1, matchId: 91, snapshotSequence: 1 });

    act(() => h.result.current.sendInput(held));
    expect(h.socket.sent[1]).toMatchObject({ type: 'input', sequence: 1, ...held });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(h.socket.sent[2]).toEqual({
      type: 'heartbeat', protocolVersion: 1, matchId: 91, sequence: 2,
      predictedTick: 115, moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false,
    });
    expect(h.result.current.pendingInputs[1].input).toEqual(held);
  });

  it('records exact prediction intervals and removes acknowledged inputs', async () => {
    const h = await connect(10);
    act(() => h.result.current.sendInput(held));
    expect(h.result.current.pendingInputs).toEqual([{
      sequence: 11, predictedTick: 101, fromTick: 101, toTick: 101, input: held,
    }]);
    h.socket.message(world(2, 11));
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.recentInputs).toEqual([]);
  });

  it('retains acknowledged dash edges for six ticks and clears them on terminal state', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput({ ...held, dash: true }));
    h.socket.message({ ...world(2, 101), serverTick: 101,
      players: world(2, 1).players.map(player => player.sessionId === 10
        ? { ...player, dashAvailable: false, acknowledgedInput: 1 }
        : player) });
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.recentInputs[0].input.dash).toBe(true);
    h.socket.message({ ...world(3, 1), serverTick: 108 });
    expect(h.result.current.recentInputs).toEqual([]);
    act(() => h.result.current.sendInput({ ...held, dash: true }));
    h.socket.message(matchClosed());
    expect(h.result.current.recentInputs).toEqual([]);
  });

  it('uses non-overlapping inclusive intervals and preserves same-tick edges in empty intervals', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, dash: true }));
    act(() => h.result.current.sendInput({ ...held, moveX: -32767 }));

    expect(h.result.current.pendingInputs).toEqual([
      { sequence: 1, predictedTick: 101, fromTick: 101, toTick: 100, input: held },
      { sequence: 2, predictedTick: 101, fromTick: 101, toTick: 100, input: { ...held, dash: true } },
      { sequence: 3, predictedTick: 101, fromTick: 101, toTick: 101, input: { ...held, moveX: -32767 } },
    ]);
  });



  it.each([
    ['dash', { ...held, aimX: 0, aimY: 32767, dash: true }],
    ['fire', { ...held, aimX: 0, aimY: 32767, fireReleased: true }],
  ])('sends an immediate %s with the true aim rather than the throttled one', async (_label, input) => {
    // A shot or dash commits to a direction. Sending it with the previously
    // transmitted aim fires it where the player used to be pointing, which is the
    // visible flick back to the old facing. These are rare enough � the shot cooldown
    // caps firing at about 2.5/s � that spending an aim change on them is cheap.
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
    // ContinuousGameCoordinator allows 120 messages and MaxAimChangesPerSecond aim
    // changes per second. Nothing else guards this relationship, and it is not
    // generous: the 40ms throttle intends 25/s, heartbeats carry aim too, and fire and
    // dash deliberately bypass the throttle to keep their direction honest.
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

  it('resumes at acknowledged input plus one and keeps final state through close', async () => {
    const h = await connect(87);
    act(() => h.result.current.sendInput(held));
    expect(h.socket.sent[1]).toMatchObject({ sequence: 88 });
    h.socket.message(matchClosed());
    // JSON serialization drops the undefined envelope fields, leaving the complete inner state.
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
    h.socket.closed();
    expect(h.result.current.closed?.reason).toBe('completed');
    expect(h.result.current.status).toBe('closed');
  });

  it('invalidates public input production when the match closes', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    h.socket.message(matchClosed());
    const sentAtClose = h.socket.sent.length;

    act(() => {
      h.result.current.sendInput({ ...held, moveX: -32767, dash: true });
      h.result.current.sendHeartbeat();
    });

    expect(h.socket.sent).toHaveLength(sentAtClose);
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
    h.socket.closed();
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
    expect(h.result.current.status).toBe('closed');
  });

  it('ignores already-queued aim and heartbeat callbacks after the match closes', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const h = await connect();
    const heartbeatCallback = setIntervalSpy.mock.calls.find(([, delay]) => delay === 250)?.[0] as () => void;
    setIntervalSpy.mockRestore();
    act(() => h.result.current.sendInput(held));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    const aimCallback = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 40)?.[0] as () => void;
    setTimeoutSpy.mockRestore();
    expect(heartbeatCallback).toBeTypeOf('function');
    expect(aimCallback).toBeTypeOf('function');

    h.socket.message(matchClosed());
    const sentAtClose = h.socket.sent.length;
    act(() => {
      aimCallback();
      heartbeatCallback();
    });

    expect(h.socket.sent).toHaveLength(sentAtClose);
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
  });

  it('ignores an old in-flight ticket after a replacement match closes', async () => {
    let resolveStaleTicket: ((ticket: object) => void) | undefined;
    requestRealtimeTicket
      .mockImplementationOnce(() => new Promise(resolve => { resolveStaleTicket = resolve; }))
      .mockResolvedValueOnce({
        protocolVersion: 1, ticket: 'current', url: 'wss://chat.example/current', expiresAt: 'later',
      });
    const h = renderHook(
      ({ matchId }) => useArenaConnection({ matchId, enabled: true }),
      { initialProps: { matchId: 90 } },
    );
    await waitFor(() => expect(requestRealtimeTicket).toHaveBeenCalledWith(90, 'participant'));
    expect(resolveStaleTicket).toBeTypeOf('function');
    h.rerender({ matchId: 91 });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const current = FakeWebSocket.instances[0];
    current.open();
    current.message(welcome());

    current.message(matchClosed());
    expect(h.result.current.status).toBe('closed');
    resolveStaleTicket?.({
      protocolVersion: 1, ticket: 'stale', url: 'wss://chat.example/stale', expiresAt: 'later',
    });
    await act(async () => {});

    expect(requestRealtimeTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(h.result.current.status).toBe('closed');
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
  });

  it('requests a fresh ticket with 250/500/1000/2000ms reconnect backoff', async () => {
    const h = await connect();
    h.socket.fail();
    for (const [index, delay] of [250, 500, 1000, 2000].entries()) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(index + 2));
      FakeWebSocket.instances[index + 1].open();
      FakeWebSocket.instances[index + 1].fail();
    }
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(5);
  });

  it('fails at the reconnect deadline when a ticket request stalls', async () => {
    const h = await connect();
    let resolveTicket!: (ticket: object) => void;
    requestRealtimeTicket.mockImplementationOnce(() => new Promise(resolve => { resolveTicket = resolve; }));
    h.socket.fail();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(h.result.current.status).toBe('failed');
    resolveTicket({ protocolVersion: 1, ticket: 'stale', url: 'wss://chat.example/stale', expiresAt: 'later' });
    await act(async () => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes a CONNECTING replacement socket and fails at the reconnect deadline', async () => {
    const h = await connect();
    h.socket.fail();
    await act(() => vi.advanceTimersByTimeAsync(250));
    const stalled = FakeWebSocket.instances[1];
    expect(stalled.readyState).toBe(FakeWebSocket.CONNECTING);
    await act(() => vi.advanceTimersByTimeAsync(4750));
    expect(stalled.close).toHaveBeenCalledOnce();
    expect(h.result.current.status).toBe('failed');
    stalled.open();
    stalled.message(welcome());
    expect(h.result.current.status).toBe('failed');
  });

  it('fails at the reconnect deadline when an OPEN socket never sends welcome', async () => {
    const h = await connect();
    h.socket.fail();
    await act(() => vi.advanceTimersByTimeAsync(250));
    const stalled = FakeWebSocket.instances[1];
    stalled.open();
    await act(() => vi.advanceTimersByTimeAsync(4750));
    expect(stalled.close).toHaveBeenCalledOnce();
    expect(h.result.current.status).toBe('failed');
  });

  it('preserves URL query and fragment while replacing one ticket parameter', async () => {
    requestRealtimeTicket.mockResolvedValueOnce({
      protocolVersion: 1, ticket: 'new token',
      url: 'wss://chat.example/games/realtime?transport=websocket&ticket=old#arena',
      expiresAt: '2026-08-28T12:00:15Z',
    });
    renderHook(() => useArenaConnection({ matchId: 91, enabled: true }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toBe(
      'wss://chat.example/games/realtime?transport=websocket&ticket=new+token#arena',
    );
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

  it('rewinds a rejected newest sequence without creating a sequence gap', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason: 'rateLimited' });
    expect(h.result.current.pendingInputs).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(40));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'input', sequence: 1 });
  });

  it.each(['staleSequence', 'sequenceGap'] as const)(
    'reconnects on %s without repeating the rejected sequence',
    async reason => {
      const h = await connect();
      act(() => h.result.current.sendInput(held));
      h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason });
      expect(h.result.current.status).toBe('reconnecting');
      expect(h.socket.close).toHaveBeenCalledOnce();
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(requestRealtimeTicket).toHaveBeenCalledTimes(2);
      expect(h.socket.sent.filter(message => (message as { sequence?: number }).sequence === 1)).toHaveLength(1);
    },
  );

  it.each(['wrongMatch', 'wrongRole'] as const)('fails and closes on terminal rejection %s', async reason => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason });
    expect(h.result.current.status).toBe('failed');
    expect(h.socket.close).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(1);
  });

  it.each(['invalidRange', 'rateLimited', 'phaseDenied', 'cooldown', 'dashSpent'] as const)(
    'safely rewinds newest %s rejection without auto-resending an edge',
    async reason => {
      const h = await connect();
      act(() => h.result.current.sendInput({ ...held, dash: true }));
      h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason });
      expect(h.result.current.pendingInputs).toEqual([]);
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(h.socket.sent.filter(message => (message as { dash?: boolean }).dash)).toHaveLength(1);
      expect(h.socket.sent.at(-1)).toMatchObject({ type: 'heartbeat', sequence: 1 });
      expect(h.socket.sent.at(-1)).not.toHaveProperty('dash');
    },
  );

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

  it('reconnects when a rejected sequence already has later frames', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, moveX: -32767 }));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason: 'rateLimited' });
    expect(h.result.current.status).toBe('reconnecting');
    expect(h.socket.close).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(2);
  });

  it('fails and clears the heartbeat when an active socket sends a duplicate welcome', async () => {
    const h = await connect();
    h.socket.message(welcome(20, 2));
    expect(h.socket.close).toHaveBeenCalledOnce();
    expect(h.result.current.status).toBe('failed');
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(h.socket.sent).toHaveLength(1);
  });

  it('clears pending input, installs neutral, and uses the new welcome acknowledgement', async () => {
    const h = await connect(10);
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, moveX: -32767 }));
    h.socket.fail();
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.currentInput).toMatchObject({ moveX: 0, moveY: 0, charging: false });
    await act(() => vi.advanceTimersByTimeAsync(250));
    const replacement = FakeWebSocket.instances[1];
    replacement.open();
    replacement.message(welcome(11, 40));
    act(() => h.result.current.sendInput(held));
    expect(replacement.sent.at(-1)).toMatchObject({ type: 'input', sequence: 12 });
    expect(h.result.current.pendingInputCount).toBe(1);
  });

  it('rejects backwards snapshots and stale sockets cannot mutate the current generation', async () => {
    const h = await connect();
    h.socket.message(world(30));
    h.socket.message(world(29));
    expect(h.result.current.latestSnapshot?.sequence).toBe(30);
    h.socket.fail();
    await act(() => vi.advanceTimersByTimeAsync(250));
    const replacement = FakeWebSocket.instances[1];
    replacement.message(welcome(3, 40));
    h.socket.message(world(99));
    expect(h.result.current.latestSnapshot).toBeNull();
  });

  it('closes sockets and cancels retries on disable and match changes', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ matchId, enabled }) => useArenaConnection({ matchId, enabled }),
      { initialProps: { matchId: 91, enabled: true } },
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message(welcome());
    rerender({ matchId: 92, enabled: false });
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('disabled');
    unmount();
  });
});
