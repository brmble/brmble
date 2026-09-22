import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRealtimeConnection,
  type RealtimeCodec,
  type RealtimeMatchClosedShape,
  type RealtimeSnapshotShape,
  type RealtimeWelcomeShape,
} from './useRealtimeConnection';

/**
 * The generic connection against a made-up game: one axis, a held button, one edge and
 * a direction pair. Everything here is what any realtime game gets for free - ticket,
 * socket lifecycle, welcome, sequencing, stamping, heartbeat, pending intervals, the
 * round trip and lead, rejection handling and reconnect. The arena's own connection
 * tests cover what its codec adds.
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
  fail() { act(() => this.onerror?.(new Event('error'))); }
  closed() { act(() => this.onclose?.(new CloseEvent('close'))); }
}

interface TestInput { axis: number; dirX: number; dirY: number; hold: boolean; act: boolean }
interface TestWelcome extends RealtimeWelcomeShape { protocolVersion: number; facing: { x: number; y: number } }
interface TestSnapshot extends RealtimeSnapshotShape { protocolVersion: number; acknowledged: Record<string, number> }
interface TestClosed extends RealtimeMatchClosedShape { protocolVersion: number; reason: string; final: { score: number[] } }

const neutral: TestInput = { axis: 0, dirX: 1, dirY: 0, hold: false, act: false };
const held: TestInput = { ...neutral, axis: 1 };
const turned = { dirX: 0, dirY: 1 };

const MESSAGE_TYPES = new Set(['welcome', 'snapshot', 'matchClosed', 'inputRejected', 'connectionState']);
const codec: RealtimeCodec<TestInput, TestWelcome, TestSnapshot, TestClosed> = {
  neutral,
  heldOnly: input => ({ ...input, act: false }),
  sameHeld: (previous, next) => previous.axis === next.axis && previous.hold === next.hold,
  hasEdges: input => input.act,
  direction: input => ({ x: input.dirX, y: input.dirY }),
  withDirection: (input, direction) => ({ ...input, dirX: direction.x, dirY: direction.y }),
  initialDirection: welcome => welcome.facing,
  acknowledgedInput: (snapshot, sessionId) => snapshot.acknowledged[String(sessionId)],
  inputFields: input => ({ ...input }),
  heartbeatFields: input => ({ axis: input.axis, dirX: input.dirX, dirY: input.dirY, hold: input.hold }),
  parse: raw => {
    const message = JSON.parse(raw) as { type?: unknown };
    return typeof message.type === 'string' && MESSAGE_TYPES.has(message.type)
      ? message as ReturnType<typeof codec.parse>
      : null;
  },
};

const welcome = (acknowledgedInput = 0, snapshotSequence = 1): TestWelcome => ({
  type: 'welcome', protocolVersion: 1, matchId: 91, sessionId: 10, snapshotSequence, serverTick: 100,
  generatedAtUnixMs: Date.now(), tickRate: 60, inputHeartbeatMs: 250, acknowledgedInput,
  facing: { x: 1, y: 0 },
});

const world = (sequence: number, acknowledgedInput = 0): TestSnapshot => ({
  type: 'snapshot', protocolVersion: 1, matchId: 91, sequence, serverTick: 120,
  generatedAtUnixMs: 1784989801350, acknowledged: { '10': acknowledgedInput, '20': 0 },
});

const matchClosed = (): TestClosed => ({
  type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 121, reason: 'completed',
  final: { score: [2, 1] },
});

const useTestConnection = (options: { matchId: number; enabled: boolean }) => useRealtimeConnection(codec, options);

async function connect(acknowledgedInput = 0) {
  const rendered = renderHook(() => useTestConnection({ matchId: 91, enabled: true }));
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message(welcome(acknowledgedInput));
  return { ...rendered, socket };
}

describe('useRealtimeConnection', () => {
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

  it('opens the direct URL, acknowledges welcome, sequences input, and sends a held-only heartbeat', async () => {
    const h = await connect();
    expect(h.socket.url).toBe('wss://chat.example/games/realtime?ticket=ticket+%2B%2F%3D');
    expect(h.socket.sent[0]).toEqual({ type: 'attachAck', protocolVersion: 1, matchId: 91, snapshotSequence: 1 });

    act(() => h.result.current.sendInput(held));
    expect(h.socket.sent[1]).toMatchObject({ type: 'input', sequence: 1, ...held });
    await act(() => vi.advanceTimersByTimeAsync(250));
    // serverTick 100 + 15 ticks elapsed + the 3-tick minimum lead.
    expect(h.socket.sent[2]).toEqual({
      type: 'heartbeat', protocolVersion: 1, matchId: 91, sequence: 2,
      predictedTick: 118, axis: 1, dirX: 1, dirY: 0, hold: false,
    });
    expect(h.result.current.pendingInputs[1].input).toEqual(held);
  });

  it('records exact prediction intervals and prunes them by tick, never the newest', async () => {
    const h = await connect(10);
    act(() => h.result.current.sendInput(held));
    // serverTick 100 + max(1, elapsed) + the 3-tick minimum lead.
    expect(h.result.current.pendingInputs).toEqual([{
      sequence: 11, predictedTick: 104, fromTick: 104, toTick: 104, input: held,
    }]);
    act(() => h.result.current.sendInput({ ...held, hold: true }));
    expect(h.result.current.pendingInputs).toEqual([
      { sequence: 11, predictedTick: 104, fromTick: 104, toTick: 103, input: held },
      { sequence: 12, predictedTick: 104, fromTick: 104, toTick: 104, input: { ...held, hold: true } },
    ]);

    // The snapshot acknowledges both, but acknowledgement means received, not
    // applied: the server applies at the stamp. The superseded interval is behind the
    // snapshot's tick and goes; the newest is open-ended and stays until superseded.
    h.socket.message(world(2, 12));
    expect(h.result.current.pendingInputs).toEqual([
      { sequence: 12, predictedTick: 104, fromTick: 104, toTick: 104, input: { ...held, hold: true } },
    ]);
  });

  it('keeps an acknowledged interval the snapshot has not reached yet', async () => {
    const h = await connect(10);
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(50));
    act(() => h.result.current.sendInput({ ...held, hold: true }));
    expect(h.result.current.pendingInputs.map(input => [input.sequence, input.fromTick, input.toTick]))
      .toEqual([[11, 104, 105], [12, 106, 106]]);

    // Both acknowledged, but the first still covers tick 105 against a snapshot at
    // 104: the server has received it and applies it on the stamped ticks, so it is
    // still replayed. One tick later it is behind the snapshot and goes.
    h.socket.message({ ...world(2, 12), serverTick: 104 });
    expect(h.result.current.pendingInputs.map(input => input.sequence)).toEqual([11, 12]);
    h.socket.message({ ...world(3, 12), serverTick: 105 });
    expect(h.result.current.pendingInputs.map(input => input.sequence)).toEqual([12]);
  });

  it('samples the round trip from the newest acknowledged frame and raises the lead', async () => {
    const h = await connect(10);
    act(() => h.result.current.sendInput(held));
    await act(() => vi.advanceTimersByTimeAsync(120));
    expect(h.result.current.inputLead.rttMs).toBeNull();
    h.socket.message(world(2, 11));
    // Sent at 0, acknowledged 120 ms later: ceil(120 * 60 / 1000) = 8 ticks + 2 margin.
    expect(h.result.current.inputLead.rttMs).toBe(120);
    expect(h.result.current.inputLead.targetTicks).toBe(10);
    // A second snapshot acknowledging nothing new adds no sample.
    h.socket.message(world(3, 11));
    expect(h.result.current.inputLead.sampleCount).toBe(1);
  });

  // An edge press is ordinary pending input: it is not retained past the snapshot
  // that passes its tick, because the client cannot tell an edge the server honoured
  // from one it accepted and stripped - the game states the outcome authoritatively.
  it('clears a superseded edge press like any other input once the snapshot passes it', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput({ ...held, act: true }));
    act(() => h.result.current.sendInput({ ...held, hold: true }));
    expect(h.result.current.pendingInputs).toHaveLength(2);
    h.socket.message({ ...world(2, 2), serverTick: 104 });
    expect(h.result.current.pendingInputs.map(input => input.sequence)).toEqual([2]);
  });

  it('uses non-overlapping inclusive intervals and preserves same-tick edges in empty intervals', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, act: true }));
    act(() => h.result.current.sendInput({ ...held, axis: -1 }));
    expect(h.result.current.pendingInputs).toEqual([
      { sequence: 1, predictedTick: 104, fromTick: 104, toTick: 103, input: held },
      { sequence: 2, predictedTick: 104, fromTick: 104, toTick: 103, input: { ...held, act: true } },
      { sequence: 3, predictedTick: 104, fromTick: 104, toTick: 104, input: { ...held, axis: -1 } },
    ]);
  });

  it('resumes at acknowledged input plus one and keeps final state through close', async () => {
    const h = await connect(87);
    act(() => h.result.current.sendInput(held));
    expect(h.socket.sent[1]).toMatchObject({ sequence: 88 });
    h.socket.message(matchClosed());
    expect(h.result.current.closed?.final.score).toEqual([2, 1]);
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
      h.result.current.sendInput({ ...held, axis: -1, act: true });
      h.result.current.sendHeartbeat();
    });

    expect(h.socket.sent).toHaveLength(sentAtClose);
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.closed?.final.score).toEqual([2, 1]);
    h.socket.closed();
    expect(h.result.current.closed?.final.score).toEqual([2, 1]);
    expect(h.result.current.status).toBe('closed');
  });

  it('ignores already-queued direction and heartbeat callbacks after the match closes', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const h = await connect();
    const heartbeatCallback = setIntervalSpy.mock.calls.find(([, delay]) => delay === 250)?.[0] as () => void;
    setIntervalSpy.mockRestore();
    act(() => h.result.current.sendInput(held));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    act(() => h.result.current.sendInput({ ...held, ...turned }));
    const directionCallback = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 40)?.[0] as () => void;
    setTimeoutSpy.mockRestore();
    expect(heartbeatCallback).toBeTypeOf('function');
    expect(directionCallback).toBeTypeOf('function');

    h.socket.message(matchClosed());
    const sentAtClose = h.socket.sent.length;
    act(() => {
      directionCallback();
      heartbeatCallback();
    });

    expect(h.socket.sent).toHaveLength(sentAtClose);
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.closed?.final.score).toEqual([2, 1]);
  });

  it('ignores an old in-flight ticket after a replacement match closes', async () => {
    let resolveStaleTicket: ((ticket: object) => void) | undefined;
    requestRealtimeTicket
      .mockImplementationOnce(() => new Promise(resolve => { resolveStaleTicket = resolve; }))
      .mockResolvedValueOnce({
        protocolVersion: 1, ticket: 'current', url: 'wss://chat.example/current', expiresAt: 'later',
      });
    const h = renderHook(
      ({ matchId }) => useTestConnection({ matchId, enabled: true }),
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
    expect(h.result.current.closed?.final.score).toEqual([2, 1]);
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
    renderHook(() => useTestConnection({ matchId: 91, enabled: true }));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toBe(
      'wss://chat.example/games/realtime?transport=websocket&ticket=new+token#arena',
    );
  });

  it('rewinds a rejected newest sequence without creating a sequence gap', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason: 'rateLimited' });
    expect(h.result.current.pendingInputs).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(40));
    act(() => h.result.current.sendInput({ ...held, ...turned }));
    expect(h.socket.sent.at(-1)).toMatchObject({ type: 'input', sequence: 1 });
  });

  it.each(['wrongMatch', 'wrongRole'] as const)('fails and closes on terminal rejection %s', async reason => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason });
    expect(h.result.current.status).toBe('failed');
    expect(h.socket.close).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(1);
  });

  it.each(['invalidRange', 'rateLimited'] as const)(
    'safely rewinds newest %s rejection without auto-resending an edge',
    async reason => {
      const h = await connect();
      act(() => h.result.current.sendInput({ ...held, act: true }));
      h.socket.message({ type: 'inputRejected', protocolVersion: 1, matchId: 91, sequence: 1, reason });
      expect(h.result.current.pendingInputs).toEqual([]);
      await act(() => vi.advanceTimersByTimeAsync(250));
      expect(h.socket.sent.filter(message => (message as { act?: boolean }).act)).toHaveLength(1);
      expect(h.socket.sent.at(-1)).toMatchObject({ type: 'heartbeat', sequence: 1 });
      expect(h.socket.sent.at(-1)).not.toHaveProperty('act');
    },
  );

  it('reconnects when a rejected sequence already has later frames', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, axis: -1 }));
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
    act(() => h.result.current.sendInput({ ...held, axis: -1 }));
    h.socket.fail();
    expect(h.result.current.pendingInputs).toEqual([]);
    expect(h.result.current.currentInput).toEqual(neutral);
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
      ({ matchId, enabled }) => useTestConnection({ matchId, enabled }),
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
