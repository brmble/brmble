import { useCallback, useEffect, useState } from 'react';
import bridge from '../../../bridge';
import { confirm } from '../../../hooks/usePrompt';

export interface AdminBanEntry {
  address: string;
  bits: number;
  name: string;
  hash: string;
  reason: string;
  start: number;
  duration: number;
}

export function useAdminBanList() {
  const [bans, setBans] = useState<AdminBanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setError('Failed to load bans: request timed out');
    }, 5000);

    bridge.once('voice.bans', (data: unknown) => {
      window.clearTimeout(timeoutId);
      setBans((data as AdminBanEntry[]) ?? []);
      setLoading(false);
    });

    bridge.send('voice.getBans');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnbanned = () => refresh();
    bridge.on('voice.unbanned', onUnbanned);
    return () => bridge.off('voice.unbanned', onUnbanned);
  }, [refresh]);

  const unban = useCallback(async (index: number) => {
    const ban = bans[index];
    if (!ban) {
      return;
    }

    const confirmed = await confirm({
      title: 'Unban User',
      message: `Are you sure you want to unban ${ban.name || ban.address}?`,
      confirmLabel: 'Unban',
    });

    if (confirmed) {
      bridge.send('voice.unban', { index });
    }
  }, [bans]);

  return { bans, loading, error, refresh, unban };
}
