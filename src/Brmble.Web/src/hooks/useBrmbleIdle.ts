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

// 5-second tick is plenty for a 10-minute auto-leave threshold and avoids
// re-rendering App every second (which over hours of idle would dominate the
// renderer's CPU budget without any user benefit).
const TICK_MS = 5000;

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
 *
 * Reports in 5-second granularity (the tick interval), and only triggers a
 * React re-render when the bucketed value actually changes — so a continuously-
 * active user re-renders App at most once per tick instead of every second.
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
      const next = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      // setState with === skips the render entirely (React bail-out). This
      // makes the steady-state cost ~0 between activity ticks.
      setIdleSecs(prev => prev === next ? prev : next);
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
