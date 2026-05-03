import { useState, useEffect, useRef } from 'react';
import bridge from '../bridge';

const ACTIVITY_EVENTS = [
  'mousemove',
  'keydown',
  'click',
  'scroll',
  'mousedown',
  'wheel',
  'touchstart',
  'pointerdown',
] as const;

const TICK_MS = 1000;

/**
 * Tracks how many seconds the local user has been inactive within the Brmble app.
 *
 * "Active" = any DOM input event listed in {@link ACTIVITY_EVENTS}, OR the local
 * user transmitting voice (relayed from C# as `voice.localTransmit`).
 *
 * Stores `lastActivityTs = Date.now()` and computes the diff each tick rather
 * than incrementing a counter. WebView2 throttles `setInterval` to ≥1 Hz when
 * the window is hidden — counter-based code under-counts; timestamp-diff code
 * stays correct on the next tick.
 */
export function useBrmbleIdle(): number {
  const lastActivityRef = useRef<number>(Date.now());
  const [idleSecs, setIdleSecs] = useState(0);

  useEffect(() => {
    const reset = () => {
      lastActivityRef.current = Date.now();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    bridge.on('voice.localTransmit', reset);

    const interval = window.setInterval(() => {
      setIdleSecs(Math.floor((Date.now() - lastActivityRef.current) / 1000));
    }, TICK_MS);

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, reset);
      }
      bridge.off('voice.localTransmit', reset);
      clearInterval(interval);
    };
  }, []);

  return idleSecs;
}
