import { useEffect } from 'react';
import bridge from '../bridge';
import { useServiceStatus } from './useServiceStatus';
import type { ServiceState } from '../types';

/**
 * Listens for server.healthStatus bridge messages from the C# backend,
 * which performs periodic health checks to avoid CORS issues with cross-origin fetches.
 */
export function useServerHealth() {
  const { updateStatus } = useServiceStatus();

  useEffect(() => {
    const onHealthStatus = (data: unknown) => {
      const d = data as { state?: ServiceState; error?: string; label?: string } | undefined;
      if (!d?.state) return;
      updateStatus('server', {
        state: d.state,
        error: d.error,
        label: d.label,
      });
    };

    bridge.on('server.healthStatus', onHealthStatus);
    return () => {
      bridge.off('server.healthStatus', onHealthStatus);
    };
  }, [updateStatus]);
}
