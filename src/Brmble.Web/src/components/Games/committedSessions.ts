import type { DuelQueueSnapshot } from '../../api/games';

/**
 * Session ids of every player the server currently holds a duel commitment for.
 *
 * The server commits a player for the Queued, ReadyCheck and Active states alike, and
 * rejects a challenge when EITHER side holds one — a player may only be queued or in
 * one live game at a time. Collecting all three lets the UI avoid offering a challenge
 * that is guaranteed to be refused.
 */
export function collectCommittedSessions(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
): Set<number> {
  const committed = new Set<number>();
  for (const snapshot of byChannel.values()) {
    for (const player of snapshot.active?.players ?? []) committed.add(player.sessionId);
    for (const player of snapshot.readyCheck?.players ?? []) committed.add(player.sessionId);
    for (const entry of snapshot.queue) {
      for (const player of entry.players) committed.add(player.sessionId);
    }
  }
  return committed;
}
