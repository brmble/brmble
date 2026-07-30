import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuelPlayer, DuelQueueSnapshot } from '../../api/games';

export interface QueuedDuelConfirmation {
  reservationId: number;
  players: DuelPlayer[];
  gameType: string;
  format: string;
}

function isQueued(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
  reservationId: number,
): boolean {
  for (const snapshot of byChannel.values()) {
    if (snapshot.queue.some(entry => entry.reservationId === reservationId)) return true;
  }
  return false;
}

/**
 * Confirms that an accepted challenge actually entered the queue.
 *
 * Derived from snapshots rather than `game.accepted`, because that event carries an
 * `offerId` while snapshots carry a `reservationId` and the two do not correlate.
 *
 * The immediate-start case suppresses itself: when a pair is accepted into an idle
 * channel the orchestrator promotes the reservation to a ready check before the
 * snapshot is built, so the client never observes it in `queue[]` and nothing fires.
 *
 * The baseline is per channel *per session*. The recovery snapshot after a reconnect
 * can carry reservations queued while the client was away, so the baseline is rebuilt
 * whenever `selfSession` changes; without that reset those reservations would announce
 * themselves minutes after the fact. This assumes a reconnect yields a new session id,
 * which is usually but not always true — Mumble hands out the lowest free id, so a
 * quick reconnect on a small server can return the same one. In that case the baseline
 * is not rebuilt and a stale reservation could announce itself; the staleness clear
 * below limits the damage, since anything no longer in `queue[]` is dropped.
 *
 * Re-entering a previously-visited channel deliberately does not re-baseline: its
 * baseline survives in `baselinedRef`, so the fresh recovery snapshot is read as a
 * delta. That is safe because you can only be queued in the channel you are present
 * in, so a channel you have just re-entered cannot already hold a reservation of
 * yours that you have not seen announced.
 *
 * Load-bearing dependency: `useDuelQueueState` eagerly fetches a recovery snapshot on
 * both `voice.connected` and `voice.channelChanged`, which is what seeds `baselinedRef`
 * on join before any duel activity. Drop that eager fetch and the accepting snapshot
 * could become a channel's first, so the baseline guard would swallow the very first
 * confirmation of a session.
 */
export function useQueuedDuelConfirmation(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
  selfSession: number,
): { confirmation: QueuedDuelConfirmation | null; dismiss: () => void } {
  const [confirmation, setConfirmation] = useState<QueuedDuelConfirmation | null>(null);
  // Reservations already announced. Ids are server-unique and never reused, so this
  // never needs pruning within a session.
  const announcedRef = useRef(new Set<number>());
  // Channels whose first snapshot has been consumed as a baseline. Without this a
  // reconnect or recovery snapshot would replay a confirmation for an old reservation.
  const baselinedRef = useRef(new Set<number>());
  // Session the two sets above were populated under, so a reconnect can reset them.
  // `null` means "no snapshot processed yet", distinct from any real session id.
  const sessionRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selfSession) return;

    if (sessionRef.current !== selfSession) {
      sessionRef.current = selfSession;
      announcedRef.current.clear();
      baselinedRef.current.clear();
    }

    // At most one channel can produce a confirmation per pass, so the later
    // `setConfirmation` cannot clobber an earlier one: `byChannel` holds only the
    // channel the client is currently in, and you can only be queued where you are.
    for (const [channelId, snapshot] of byChannel) {
      const mine = snapshot.queue.filter(
        entry => entry.players.some(player => player.sessionId === selfSession),
      );

      if (!baselinedRef.current.has(channelId)) {
        baselinedRef.current.add(channelId);
        for (const entry of mine) announcedRef.current.add(entry.reservationId);
        continue;
      }

      for (const entry of mine) {
        if (announcedRef.current.has(entry.reservationId)) continue;
        announcedRef.current.add(entry.reservationId);
        setConfirmation({
          reservationId: entry.reservationId,
          players: entry.players,
          gameType: entry.gameType,
          format: entry.format,
        });
      }
    }

    // The confirmation's only other lifecycle is `dismiss`, which the UI drives from a
    // timer that runs only once the notification is actually visible — and it may never
    // become visible if higher-priority notifications hold every slot. Without this it
    // could surface minutes later for a duel that has already finished. Clearing it once
    // the reservation leaves `queue[]` covers promotion to a ready check, cancellation,
    // channel exit and disconnect (an empty map) in one rule.
    setConfirmation(current =>
      current && !isQueued(byChannel, current.reservationId) ? null : current);
  }, [byChannel, selfSession]);

  /**
   * Clears the current confirmation — the reservation stays in the announced set, so it
   * never re-fires. The effect above also clears it once the reservation leaves the
   * queue, and a later reservation replaces it directly, without any dismissal.
   */
  const dismiss = useCallback(() => setConfirmation(null), []);

  return { confirmation, dismiss };
}
