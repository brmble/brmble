import { useEffect, useRef } from 'react';
import { useServiceStatus } from './useServiceStatus';

const POLL_INTERVAL = 30_000; // 30 seconds

export function useServerHealth(apiUrl: string | undefined) {
  const { updateStatus } = useServiceStatus();
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (!apiUrl) {
      updateStatus('server', { state: 'unavailable', error: undefined });
      return;
    }

    const check = async () => {
      try {
        const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          updateStatus('server', { state: 'connected', error: undefined, label: apiUrl });
        } else {
          updateStatus('server', { state: 'disconnected', error: `Health check returned ${res.status}` });
        }
      } catch (err) {
        updateStatus('server', { state: 'disconnected', error: err instanceof Error ? err.message : 'Health check failed' });
      }
    };

    updateStatus('server', { state: 'connecting', label: apiUrl });
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [apiUrl, updateStatus]);
}
