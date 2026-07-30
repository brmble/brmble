import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuelPlayer, DuelQueueSnapshot } from '../../api/games';

export interface QueuedDuelConfirmation {
  reservationId: number;
  players: DuelPlayer[];
  gameType: string;
  format: string;
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
 * The baseline is per channel *per session*. A Mumble reconnect assigns a new session
 * id, and the recovery snapshot can carry reservations queued while the client was
 * away, so the baseline is rebuilt whenever `selfSession` changes. Without that reset
 * those reservations would announce themselves minutes after the fact.
 *
 * Re-entering a previously-visited channel deliberately does not re-baseline: its
 * baseline survives in `baselinedRef`, so the fresh recovery snapshot is read as a
 * delta. That is safe because you can only be queued in the channel you are present
 * in, so a channel you have just re-entered cannot already hold a reservation of
 * yours that you have not seen announced.
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
  }, [byChannel, selfSession]);

  /**
   * Clears the current confirmation permanently — the reservation stays in the
   * announced set, so it never re-fires. A later reservation replaces the current
   * confirmation directly, without any dismissal in between.
   */
  const dismiss = useCallback(() => setConfirmation(null), []);

  return { confirmation, dismiss };
}
