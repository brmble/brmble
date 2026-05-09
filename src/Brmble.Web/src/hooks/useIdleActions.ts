import { useEffect, useRef, useState } from 'react';
import bridge from '../bridge';

export const AFK_THRESHOLD_SEC = 10 * 60;
export const PRE_LEAVE_WARNING_SEC = 60;

interface UseIdleActionsArgs {
  brmbleIdleSec: number;
  systemIdleSec: number;
  isLocked: boolean;
  inVoiceChannel: boolean;
  onBeforeAutoLeave?: () => void | Promise<void>;
}

interface UseIdleActionsResult {
  /** Unix ms timestamp of the most recent auto-leave-voice fire, or null. */
  autoLeftAt: number | null;
  /** Unix ms timestamp for the current pre-leave notification, or null. */
  preLeaveStartedAt: number | null;
  /** Unix ms timestamp for the most recent cancelled pre-leave notification, or null. */
  preLeaveCancelledAt: number | null;
  /** Clear the toast indicator (does not unfire the leave). */
  dismissToast: () => void;
  /** Clear the cancelled pre-leave toast indicator. */
  dismissPreLeaveCancelled: () => void;
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
  onBeforeAutoLeave,
}: UseIdleActionsArgs): UseIdleActionsResult {
  const firedRef = useRef(false);
  const preLeaveShownRef = useRef(false);
  const [autoLeftAt, setAutoLeftAt] = useState<number | null>(null);
  const [preLeaveStartedAt, setPreLeaveStartedAt] = useState<number | null>(null);
  const [preLeaveCancelledAt, setPreLeaveCancelledAt] = useState<number | null>(null);

  useEffect(() => {
    if (!inVoiceChannel) {
      // Not in voice → nothing to leave; reset so a future channel join is armed
      firedRef.current = false;
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      setPreLeaveCancelledAt(null);
      return;
    }

    const fullyIdle =
      isLocked ||
      (brmbleIdleSec >= AFK_THRESHOLD_SEC && systemIdleSec >= AFK_THRESHOLD_SEC);
    const nearingIdle =
      !isLocked &&
      brmbleIdleSec >= AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC &&
      systemIdleSec >= AFK_THRESHOLD_SEC - PRE_LEAVE_WARNING_SEC;

    if (fullyIdle && !firedRef.current) {
      firedRef.current = true;
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      if (!onBeforeAutoLeave) {
        bridge.send('voice.leaveVoice', {});
        setAutoLeftAt(Date.now());
      } else {
        void Promise.resolve(onBeforeAutoLeave())
          .finally(() => {
            bridge.send('voice.leaveVoice', {});
            setAutoLeftAt(Date.now());
          });
      }
    } else if (!fullyIdle && firedRef.current) {
      // Any source dropped below threshold → user came back. Re-arm for next cycle.
      firedRef.current = false;
    }

    if (!fullyIdle && nearingIdle && !preLeaveShownRef.current) {
      preLeaveShownRef.current = true;
      setPreLeaveCancelledAt(null);
      setPreLeaveStartedAt(Date.now());
    } else if (!fullyIdle && !nearingIdle && preLeaveShownRef.current) {
      preLeaveShownRef.current = false;
      setPreLeaveStartedAt(null);
      setPreLeaveCancelledAt(Date.now());
    }
  }, [brmbleIdleSec, systemIdleSec, isLocked, inVoiceChannel, onBeforeAutoLeave]);

  return {
    autoLeftAt,
    preLeaveStartedAt,
    preLeaveCancelledAt,
    dismissToast: () => setAutoLeftAt(null),
    dismissPreLeaveCancelled: () => setPreLeaveCancelledAt(null),
  };
}
