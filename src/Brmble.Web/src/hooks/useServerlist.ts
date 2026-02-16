import { useState, useEffect, useCallback } from 'react';

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
    const handleMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'servers.list') {
        setServers(msg.data.servers || []);
        setLoading(false);
      }
      if (msg.type === 'servers.added') {
        setServers(prev => [...prev, msg.data.server]);
      }
      if (msg.type === 'servers.updated') {
        setServers(prev => prev.map(s => 
          s.id === msg.data.server.id ? msg.data.server : s
        ));
      }
      if (msg.type === 'servers.removed') {
        setServers(prev => prev.filter(s => s.id !== msg.data.id));
      }
    };

    window.addEventListener('message', handleMessage);
    window.chrome?.webview?.postMessage({ type: 'servers.list' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const addServer = useCallback((server: Omit<ServerEntry, 'id'>) => {
    window.chrome?.webview?.postMessage({
      type: 'servers.add',
      data: { ...server, id: crypto.randomUUID() }
    });
  }, []);

  const updateServer = useCallback((server: ServerEntry) => {
    window.chrome?.webview?.postMessage({ type: 'servers.update', data: server });
  }, []);

  const removeServer = useCallback((id: string) => {
    window.chrome?.webview?.postMessage({ type: 'servers.remove', data: { id } });
  }, []);

  return { servers, loading, addServer, updateServer, removeServer };
}
