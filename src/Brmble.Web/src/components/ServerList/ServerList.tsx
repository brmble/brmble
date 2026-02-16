import './ServerList.css';

interface Server {
  id: string;
  name: string;
  host?: string;
  port?: number;
}

interface ServerListProps {
  servers: Server[];
  selectedServerId: string;
  onSelectServer: (id: string) => void;
  connected?: boolean;
  serverAddress?: string;
}

export function ServerList({ servers, selectedServerId, onSelectServer, connected, serverAddress }: ServerListProps) {
  const selectedServer = servers.find(s => s.id === selectedServerId);
  const displayName = serverAddress || selectedServer?.name || 'Server';

  return (
    <div className="server-list">
      <div className="server-list-header">
        <span className="server-list-title">Servers</span>
      </div>
      <div className="server-list-items">
        {servers.map(server => (
          <button
            key={server.id}
            className={`server-item ${selectedServerId === server.id ? 'active' : ''}`}
            onClick={() => onSelectServer(server.id)}
          >
            <span className="server-icon">
              {server.name.charAt(0).toUpperCase()}
            </span>
            <div className="server-info">
              <span className="server-status">
                {selectedServerId === server.id && connected ? 'Connected' : ''}
              </span>
              <span className="server-name">{displayName}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
