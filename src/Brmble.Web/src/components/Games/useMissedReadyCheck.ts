import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import type { DuelPlayer, DuelQueueSnapshot, ReadyCheck } from '../../api/games';

export interface MissedReadyCheck {
  reservationId: number;
  /** The pair as it stood when the check expired. */
  players: DuelPlayer[];
  /**
   * Whether the local player readied before the check expired.
   *
   * Retained deliberately as part of this hook's contract even though App branches its
   * copy on `unreadyOpponents.length` instead: `pairLabel([])` is `''`, so keying the
   * render off the array degrades to the pair form rather than to blank text for
   * degenerate data. This stays the honest answer to "did I ready?".
   */
  localReadied: boolean;
  /** Opponents who did not ready. Empty when only the local player failed. */
  unreadyOpponents: DuelPlayer[];
}

/**
 * The local player's pending ready check, if any.
 *
 * At most one can match, so returning the first is not a last-write-wins hazard:
 * `byChannel` only holds the channel the client is currently in, and you can only be
 * in a ready check you are a participant of.
 */
function myReadyCheck(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
  selfSession: number,
): ReadyCheck | null {
  for (const snapshot of byChannel.values()) {
    const check = snapshot.readyCheck;
    if (check?.players.some(player => player.sessionId === selfSession)) return check;
  }
  return null;
}

/**
 * Reports a ready check that expired without both players readying.
 *
 * The ready state is captured from raw snapshots rather than App's derived
 * `readyCheck`, which filters to checks the local player has NOT readied and so
 * goes null the moment they press Ready — the ready-player case would never fire.
 *
 * The capture is kept after the check leaves the snapshot, because
 * `game.commitmentCanceled` can be handled after the snapshot has already dropped it.
 *
 * The capture is only as fresh as the last snapshot push, so a ready press that races
 * the expiry could in principle be captured as unready and show the player "Missed your
 * duel" when they did ready. The damage is bounded: the race needs a press in the final
 * moments of a 30s window that the server accepts yet does not publish before expiring,
 * and the worst outcome is an overstated notification about a duel that was cancelled
 * either way — never a missed report, and never a wrong duel.
 *
 * Unlike the sibling `useQueuedDuelConfirmation`, this hook deliberately does not reset
 * its ref when `selfSession` changes. That hook matches reservations by *membership* of
 * accumulating sets, so a stale entry changes the outcome for unrelated reservations.
 * Here the capture is a single reference guarded by an exact `reservationId` match, and
 * reservation ids are server-unique and never reused — a stale capture can therefore
 * only be matched by a cancellation for the very duel it describes, which is still worth
 * reporting. Clearing it on reconnect would instead swallow an expiry that landed while
 * the client was away, which is the silence this feature exists to fix. The one residual
 * is that `localReadied` resolves against the new session id and falls back to `false`,
 * i.e. the same overstatement as the race above.
 */
export function useMissedReadyCheck(
  byChannel: ReadonlyMap<number, DuelQueueSnapshot>,
  selfSession: number,
): { missed: MissedReadyCheck | null; dismiss: () => void } {
  const [missed, setMissed] = useState<MissedReadyCheck | null>(null);
  const capturedRef = useRef<ReadyCheck | null>(null);
  const selfSessionRef = useRef(selfSession);
  selfSessionRef.current = selfSession;

  useEffect(() => {
    if (!selfSession) return;
    const check = myReadyCheck(byChannel, selfSession);
    if (!check) return;
    // A new pop supersedes any report still on screen for the previous one.
    if (capturedRef.current?.reservationId !== check.reservationId) setMissed(null);
    capturedRef.current = check;
  }, [byChannel, selfSession]);

  useEffect(() => {
    const handleCanceled = (data: unknown) => {
      const { reservationId, reason } = data as { reservationId?: number; reason?: string };
      // Only a timeout means "did not ready up in time". `declined` is a deliberate
      // refusal; `disconnected`/`leftChannel`/`channelRemoved`/`startFailed` are not the
      // player's doing. Allow-listed so a reason added later cannot start reporting itself.
      if (reason !== 'expired' || reservationId == null) return;
      const captured = capturedRef.current;
      if (!captured || captured.reservationId !== reservationId) return;
      const self = selfSessionRef.current;
      setMissed({
        reservationId,
        players: captured.players,
        localReadied: captured.players.find(player => player.sessionId === self)?.ready ?? false,
        unreadyOpponents: captured.players.filter(
          player => player.sessionId !== self && !player.ready),
      });
    };
    bridge.on('game.commitmentCanceled', handleCanceled);
    return () => bridge.off('game.commitmentCanceled', handleCanceled);
  }, []);

  const dismiss = useCallback(() => setMissed(null), []);

  return { missed, dismiss };
}
