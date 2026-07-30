import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DuelPlayer, DuelQueueSnapshot, QueuedDuel, ReadyCheck } from '../../api/games';
import { unknownEstimate } from './duelTestHarness';
import { useQueuedDuelConfirmation } from './useQueuedDuelConfirmation';

const SELF = 11;

const player = (sessionId: number): DuelPlayer =>
  ({ userId: sessionId * 100, sessionId, displayName: `P${sessionId}`, ready: false });

const queued = (reservationId: number, sessions: number[]): QueuedDuel => ({
  reservationId,
  position: 1,
  players: sessions.map(player),
  gameType: 'rps',
  format: 'bo3',
  rulesetVersion: 1,
  eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
  estimatedDuration: unknownEstimate,
});

const ready = (reservationId: number, sessions: number[]): ReadyCheck => ({
  reservationId,
  expiresAt: '2026-07-30T00:00:30Z',
  players: sessions.map(player),
  gameType: 'rps',
  format: 'bo3',
  rulesetVersion: 1,
  estimatedDuration: unknownEstimate,
});

const snapshot = (
  channelId: number,
  parts: Partial<Pick<DuelQueueSnapshot, 'active' | 'readyCheck' | 'queue'>>,
): DuelQueueSnapshot => ({
  schemaVersion: 1,
  generation: 1,
  revision: 1,
  channelId,
  generatedAt: '2026-07-30T00:00:00Z',
  calculationTimeMs: 1,
  active: null,
  readyCheck: null,
  queue: [],
  ...parts,
});

const channels = (...snapshots: DuelQueueSnapshot[]) =>
  new Map<number, DuelQueueSnapshot>(snapshots.map(s => [s.channelId, s]));

describe('useQueuedDuelConfirmation', () => {
  it('confirms when the local session newly appears in the queue', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    expect(result.current.confirmation).toBeNull();

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });

    expect(result.current.confirmation).toEqual({
      reservationId: 41,
      players: [player(SELF), player(22)],
      gameType: 'rps',
      format: 'bo3',
    });
  });

  it('stays silent when the pair goes straight to a ready check', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    rerender({ byChannel: channels(snapshot(7, { readyCheck: ready(41, [SELF, 22]) })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('treats the first snapshot of a channel as a baseline', () => {
    const { result } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })) } },
    );

    expect(result.current.confirmation).toBeNull();
  });

  it('ignores queue entries the local session is not part of', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [33, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('confirms once per reservation, not on every later snapshot', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });
    expect(result.current.confirmation?.reservationId).toBe(41);

    act(() => result.current.dismiss());
    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('baselines each channel independently', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, SELF),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    rerender({ byChannel: channels(snapshot(7, {}), snapshot(8, { queue: [queued(42, [SELF, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('does not confirm before the local session is known', () => {
    const { result, rerender } = renderHook(
      ({ byChannel }) => useQueuedDuelConfirmation(byChannel, 0),
      { initialProps: { byChannel: channels(snapshot(7, {})) } },
    );

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [0, 22])] })) });

    expect(result.current.confirmation).toBeNull();
  });

  it('re-baselines after a reconnect with a new session id', () => {
    const { result, rerender } = renderHook(
      ({ byChannel, selfSession }) => useQueuedDuelConfirmation(byChannel, selfSession),
      { initialProps: { byChannel: channels(snapshot(7, {})), selfSession: SELF } },
    );

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })), selfSession: SELF });
    expect(result.current.confirmation?.reservationId).toBe(41);
    act(() => result.current.dismiss());

    // Reconnect: a new Mumble session id, and a recovery snapshot carrying both the
    // reservation announced under the old session and one queued while disconnected.
    rerender({
      byChannel: channels(snapshot(7, { queue: [queued(41, [12, 22]), queued(55, [12, 33])] })),
      selfSession: 12,
    });

    expect(result.current.confirmation).toBeNull();
  });

  it('still confirms normally after a reconnect', () => {
    const { result, rerender } = renderHook(
      ({ byChannel, selfSession }) => useQueuedDuelConfirmation(byChannel, selfSession),
      { initialProps: { byChannel: channels(snapshot(7, {})), selfSession: SELF } },
    );

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [SELF, 22])] })), selfSession: SELF });
    expect(result.current.confirmation?.reservationId).toBe(41);
    act(() => result.current.dismiss());

    rerender({ byChannel: channels(snapshot(7, { queue: [queued(41, [12, 22])] })), selfSession: 12 });
    expect(result.current.confirmation).toBeNull();

    rerender({
      byChannel: channels(snapshot(7, { queue: [queued(41, [12, 22]), queued(60, [12, 33])] })),
      selfSession: 12,
    });

    expect(result.current.confirmation?.reservationId).toBe(60);
  });
});
