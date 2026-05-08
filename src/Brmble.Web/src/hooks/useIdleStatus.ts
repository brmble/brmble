import { useState, useEffect } from 'react';
import bridge from '../bridge';
import type { IdleUpdate } from '../types';

function shallowEqualNumberMap(a: Record<number, number>, b: Record<number, number>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k as unknown as number] !== b[k as unknown as number]) return false;
  }
  return true;
}

/**
 * Subscribes to `voice.idleUpdate` from C# and exposes the most recent values.
 *
 * - `voiceIdle`: sessionId → idle seconds (from Mumble UserStats polling).
 * - `systemIdle`: seconds since last keyboard/mouse on Windows.
 * - `isLocked`: workstation is locked (or console session is disconnected).
 *
 * Each setter uses an equality bail-out so identical payloads (the common case
 * in steady state — voiceIdle ticks once per UserStats response, systemIdle in
 * 1-second granularity but mostly stable) don't trigger React re-renders.
 */
export function useIdleStatus() {
  const [voiceIdle, setVoiceIdle] = useState<Record<number, number>>({});
  const [systemIdle, setSystemIdle] = useState(0);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const handler = (data: unknown) => {
      const update = data as Partial<IdleUpdate>;
      const nextVoice = update.voiceIdle ?? {};
      const nextSystem = update.systemIdle ?? 0;
      const nextLocked = update.isLocked ?? false;

      setVoiceIdle(prev => shallowEqualNumberMap(prev, nextVoice) ? prev : nextVoice);
      setSystemIdle(prev => prev === nextSystem ? prev : nextSystem);
      setIsLocked(prev => prev === nextLocked ? prev : nextLocked);
    };
    bridge.on('voice.idleUpdate', handler);
    return () => bridge.off('voice.idleUpdate', handler);
  }, []);

  return { voiceIdle, systemIdle, isLocked };
}
