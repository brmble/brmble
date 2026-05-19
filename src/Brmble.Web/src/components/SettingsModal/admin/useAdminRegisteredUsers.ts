import { useCallback, useEffect, useState } from 'react';
import bridge from '../../../bridge';
import type { AdminRegisteredUser } from './adminUserModels';

export function useAdminRegisteredUsers() {
  const [registeredUsers, setRegisteredUsers] = useState<AdminRegisteredUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setRegisteredUsers([]);
      setError('Registered users could not be loaded right now.');
    }, 5000);

    const handleRegisteredUsers = (data: unknown) => {
      window.clearTimeout(timeoutId);

      const nextUsers = Array.isArray(data)
        ? (data as unknown[])
          .map(item => {
            if (!item || typeof item !== 'object') return null;
            const candidate = item as Record<string, unknown>;
            const rawId = candidate.id ?? candidate.userId ?? candidate.key;
            const rawName = candidate.name ?? candidate.displayName ?? candidate.value;
            const registrationUserId = typeof rawId === 'number'
              ? rawId
              : typeof rawId === 'string'
                ? Number.parseInt(rawId, 10)
                : Number.NaN;

            return !Number.isNaN(registrationUserId) && typeof rawName === 'string'
              ? { registrationUserId, registeredName: rawName }
              : null;
          })
          .filter((user): user is AdminRegisteredUser => user !== null)
        : Object.entries((data as Record<string, unknown>) ?? {})
          .map(([registrationUserId, registeredName]) => {
            const parsedId = Number.parseInt(registrationUserId, 10);
            return !Number.isNaN(parsedId) && typeof registeredName === 'string'
              ? { registrationUserId: parsedId, registeredName }
              : null;
          })
          .filter((user): user is AdminRegisteredUser => user !== null);

      setRegisteredUsers(nextUsers.sort((left, right) => left.registeredName.localeCompare(right.registeredName)));
      setLoading(false);
    };

    const handleRegisteredUsersError = (data: unknown) => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return;
      }

      const message = (data as { message?: unknown }).message;
      setError(typeof message === 'string' ? message : null);
    };

    bridge.once('voice.registeredUsers', handleRegisteredUsers);
    bridge.once('voice.registeredUsersError', handleRegisteredUsersError);
    bridge.send('voice.getRegisteredUsers');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { registeredUsers, loading, error, refresh };
}
