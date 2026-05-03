import { useEffect, useRef, useState } from 'react';
import bridge from '../bridge';

export const AFK_THRESHOLD_SEC = 10 * 60;

interface UseIdleActionsArgs {
  brmbleIdleSec: number;
  systemIdleSec: number;
  isLocked: boolean;
  inVoiceChannel: boolean;
}

interface UseIdleActionsResult {
  /** Unix ms timestamp of the most recent auto-leave-voice fire, or null. */
  autoLeftAt: number | null;
  /** Clear the toast indicator (does not unfire the leave). */
  dismissToast: () => void;
}

/**
 * Decides when to fire `voice.leaveVoice` based on the AND of
 * Brmble app idle + Windows system idle ≥ {@link AFK_THRESHOLD_SEC}, OR
 * the workstation being locked. Only triggers while in a voice channel and
 * fires at most once per active period (resets when user returns).
 *
 * AND-combine prevents false positives:
 * - Fullscreen-game DirectInput → system idle high, Brmble idle low → no fire.
 * - Working in another app → system idle low, Brmble idle high → no fire.
 * - Locked workstation → fire immediately (covers the media-playback false
 *   positive — no input + no transmit + no Brmble interaction in any case).
 */
export function useIdleActions({
  brmbleIdleSec,
  systemIdleSec,
  isLocked,
  inVoiceChannel,
}: UseIdleActionsArgs): UseIdleActionsResult {
  const firedRef = useRef(false);
  const [autoLeftAt, setAutoLeftAt] = useState<number | null>(null);

  useEffect(() => {
    if (!inVoiceChannel) {
      // Not in voice → nothing to leave; reset so a future channel join is armed
      firedRef.current = false;
      return;
    }

    const fullyIdle =
      isLocked ||
      (brmbleIdleSec >= AFK_THRESHOLD_SEC && systemIdleSec >= AFK_THRESHOLD_SEC);

    if (fullyIdle && !firedRef.current) {
      firedRef.current = true;
      bridge.send('voice.leaveVoice', {});
      setAutoLeftAt(Date.now());
    } else if (!fullyIdle && firedRef.current) {
      // Any source dropped below threshold → user came back. Re-arm for next cycle.
      firedRef.current = false;
    }
  }, [brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel]);

  return {
    autoLeftAt,
    dismissToast: () => setAutoLeftAt(null),
  };
}
