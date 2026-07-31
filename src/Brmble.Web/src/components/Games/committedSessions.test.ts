import { describe, it, expect } from 'vitest';
import { collectCommittedSessions } from './committedSessions';
import type { DuelQueueSnapshot } from '../../api/games';

function snapshot(channelId: number, parts: Partial<DuelQueueSnapshot>): DuelQueueSnapshot {
  return {
    schemaVersion: 1,
    generation: 1,
    revision: 1,
    channelId,
    generatedAt: '2026-07-31T10:00:00Z',
    calculationTimeMs: 0,
    active: null,
    readyCheck: null,
    queue: [],
    ...parts,
  } as DuelQueueSnapshot;
}

const player = (sessionId: number) => ({ sessionId } as DuelQueueSnapshot['queue'][number]['players'][number]);

describe('collectCommittedSessions', () => {
  it('is empty when no channel has any duel activity', () => {
    const byChannel = new Map([[1, snapshot(1, {})]]);
    expect(collectCommittedSessions(byChannel)).toEqual(new Set());
  });

  // The server sets a commitment for Queued, ReadyCheck AND Active, and rejects a
  // challenge if either side holds one — all three states must count.
  it('collects sessions from active, ready check and queued duels', () => {
    const byChannel = new Map([
      [1, snapshot(1, {
        active: { players: [player(10), player(11)] } as DuelQueueSnapshot['active'],
        readyCheck: { players: [player(20), player(21)] } as DuelQueueSnapshot['readyCheck'],
        queue: [
          { players: [player(30), player(31)] },
          { players: [player(40)] },
        ] as DuelQueueSnapshot['queue'],
      })],
    ]);

    expect(collectCommittedSessions(byChannel)).toEqual(new Set([10, 11, 20, 21, 30, 31, 40]));
  });

  it('spans every channel in the snapshot map', () => {
    const byChannel = new Map([
      [1, snapshot(1, { active: { players: [player(10)] } as DuelQueueSnapshot['active'] })],
      [2, snapshot(2, { active: { players: [player(99)] } as DuelQueueSnapshot['active'] })],
    ]);

    expect(collectCommittedSessions(byChannel)).toEqual(new Set([10, 99]));
  });
});
