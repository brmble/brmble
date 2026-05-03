import { useState, useEffect } from 'react';
import bridge from '../bridge';
import type { IdleUpdate } from '../types';

/**
 * Subscribes to `voice.idleUpdate` from C# and exposes the most recent values.
 *
 * - `voiceIdle`: sessionId → idle seconds (from Mumble UserStats polling).
 * - `systemIdle`: seconds since last keyboard/mouse on Windows.
 * - `isLocked`: workstation is locked (or console session is disconnected).
 */
export function useIdleStatus() {
  const [voiceIdle, setVoiceIdle] = useState<Record<number, number>>({});
  const [systemIdle, setSystemIdle] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const handler = (data: unknown) => {
      const update = data as Partial<IdleUpdate>;
      setVoiceIdle(update.voiceIdle ?? {});
      setSystemIdle(update.systemIdle ?? 0);
      setIsLocked(update.isLocked ?? false);
    };
    bridge.on('voice.idleUpdate', handler);
    return () => bridge.off('voice.idleUpdate', handler);
  }, []);

  return { voiceIdle, systemIdle, isLocked };
}
