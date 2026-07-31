import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import type { DuelPlayer, DuelQueueSnapshot, ReadyCheck } from '../../api/games';

export interface MissedReadyCheck {
  reservationId: number;
  /** The pair as it stood when the check expired. */
  players: DuelPlayer[];
  localReadied: boolean;
  /** Opponents who did not ready. Empty when only the local player failed. */
  unreadyOpponents: DuelPlayer[];
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
    for (const snapshot of byChannel.values()) {
      const check = snapshot.readyCheck;
      if (!check?.players.some(player => player.sessionId === selfSession)) continue;
      if (capturedRef.current?.reservationId !== check.reservationId) {
        // A new pop supersedes any report still on screen for the previous one.
        setMissed(null);
      }
      capturedRef.current = check;
    }
  }, [byChannel, selfSession]);

  useEffect(() => {
    const handleCanceled = (data: unknown) => {
      const { reservationId, reason } = data as { reservationId?: number; reason?: string };
      // Only a timeout means "did not ready up in time". `declined` is a deliberate
      // refusal; `disconnected`/`leftChannel`/`channelRemoved` are not the player's doing.
      if (reason !== 'expired' || reservationId == null) return;
      const captured = capturedRef.current;
      if (!captured || captured.reservationId !== reservationId) return;
      const self = selfSessionRef.current;
      setMissed({
        reservationId,
        players: captured.players,
        localReadied: captured.players.find(p => p.sessionId === self)?.ready ?? false,
        unreadyOpponents: captured.players.filter(p => p.sessionId !== self && !p.ready),
      });
    };
    bridge.on('game.commitmentCanceled', handleCanceled);
    return () => bridge.off('game.commitmentCanceled', handleCanceled);
  }, []);

  const dismiss = useCallback(() => setMissed(null), []);

  return { missed, dismiss };
}
