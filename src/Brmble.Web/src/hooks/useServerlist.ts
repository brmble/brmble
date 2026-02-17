import { useState, useEffect, useCallback } from 'react';
import bridge from '../bridge';

export interface ServerEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
}

export function useServerlist() {
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleList = (data: unknown) => {
      const d = data as { servers?: ServerEntry[] } | undefined;
      setServers(d?.servers || []);
      setLoading(false);
    };

    const handleAdded = (data: unknown) => {
      const d = data as { server: ServerEntry } | undefined;
      if (d?.server) {
        setServers(prev => [...prev, d.server]);
      }
    };

    const handleUpdated = (data: unknown) => {
      const d = data as { server: ServerEntry } | undefined;
      if (d?.server) {
        setServers(prev => prev.map(s => 
          s.id === d.server.id ? d.server : s
        ));
      }
    };

    const handleRemoved = (data: unknown) => {
      const d = data as { id: string } | undefined;
      if (d?.id) {
        setServers(prev => prev.filter(s => s.id !== d.id));
      }
    };

    bridge.on('servers.list', handleList);
    bridge.on('servers.added', handleAdded);
    bridge.on('servers.updated', handleUpdated);
    bridge.on('servers.removed', handleRemoved);

    bridge.send('servers.list');

    return () => {
      bridge.off('servers.list', handleList);
      bridge.off('servers.added', handleAdded);
      bridge.off('servers.updated', handleUpdated);
      bridge.off('servers.removed', handleRemoved);
    };
  }, []);

  const addServer = useCallback((server: Omit<ServerEntry, 'id'>) => {
    bridge.send('servers.add', { ...server, id: crypto.randomUUID() });
  }, []);

  const updateServer = useCallback((server: ServerEntry) => {
    bridge.send('servers.update', server);
  }, []);

  const removeServer = useCallback((id: string) => {
    bridge.send('servers.remove', { id });
  }, []);

  return { servers, loading, addServer, updateServer, removeServer };
}
