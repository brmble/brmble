import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArenaConnection } from './useArenaConnection';

const { requestRealtimeTicket } = vi.hoisted(() => ({ requestRealtimeTicket: vi.fn() }));
vi.mock('../../../api/games', () => ({ requestRealtimeTicket }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  sent: unknown[] = [];
  close = vi.fn(() => { this.readyState = 3; });
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.(new Event('open')));
  }

  send(raw: string) { this.sent.push(JSON.parse(raw)); }
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
  tickRate: 60, snapshotRate: 20, interpolationMs: 100, maxExtrapolationMs: 50,
  inputHeartbeatMs: 250, neutralAfterMs: 750, reconnectGraceMs: 5000,
  prediction: {
    unitsPerWorldUnit: 1000, playerRadius: 600, baseMovePerTick: 90,
    chargedMovePerTick: 45, momentumRetentionPermille: 920, chargeTicks: 90,
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

async function connect(acknowledgedInput = 0) {
  const rendered = renderHook(() => useArenaConnection({ matchId: 91, enabled: true }));
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0];
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
    expect(h.socket.url).toBe('wss://chat.example/games/realtime?ticket=ticket%20%2B%2F%3D');
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
      sequence: 11, predictedTick: 100, fromTick: 100, toTick: 100, input: held,
    }]);
    h.socket.message(world(2, 11));
    expect(h.result.current.pendingInputs).toEqual([]);
  });

  it('sends held changes and edges immediately but coalesces aim-only changes for 34ms', async () => {
    const h = await connect();
    act(() => h.result.current.sendInput(held));
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767 }));
    expect(h.socket.sent).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(33));
    expect(h.socket.sent).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(h.socket.sent[2]).toMatchObject({ type: 'input', sequence: 2, aimX: 0, aimY: 32767 });
    act(() => h.result.current.sendInput({ ...held, aimX: 0, aimY: 32767, dash: true }));
    expect(h.socket.sent[3]).toMatchObject({ type: 'input', sequence: 3, dash: true });
  });

  it('resumes at acknowledged input plus one and keeps final state through close', async () => {
    const h = await connect(87);
    act(() => h.result.current.sendInput(held));
    expect(h.socket.sent[1]).toMatchObject({ sequence: 88 });
    h.socket.message({
      type: 'matchClosed', protocolVersion: 1, matchId: 91, sequence: 121,
      serverTick: 3601, reason: 'completed', finalState: { ...world(1), type: undefined, protocolVersion: undefined, matchId: undefined, sequence: undefined, serverTick: undefined, generatedAtUnixMs: undefined, score: [2, 1], phase: 'ended' },
    });
    // JSON serialization drops the undefined envelope fields, leaving the complete inner state.
    expect(h.result.current.closed?.finalState.score).toEqual([2, 1]);
    h.socket.closed();
    expect(h.result.current.closed?.reason).toBe('completed');
    expect(h.result.current.status).toBe('closed');
  });

  it('requests a fresh ticket with 250/500/1000/2000ms reconnect backoff', async () => {
    const h = await connect();
    h.socket.fail();
    for (const [index, delay] of [250, 500, 1000, 2000].entries()) {
      await act(() => vi.advanceTimersByTimeAsync(delay));
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(index + 2));
      FakeWebSocket.instances[index + 1].fail();
    }
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(5);
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
    FakeWebSocket.instances[0].message(welcome());
    rerender({ matchId: 92, enabled: false });
    expect(FakeWebSocket.instances[0].close).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(requestRealtimeTicket).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('disabled');
    unmount();
  });
});
