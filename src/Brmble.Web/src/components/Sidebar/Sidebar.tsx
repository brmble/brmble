import { ChannelTree } from '../ChannelTree';
import type { Channel, User } from '../../types';
import './Sidebar.css';

interface SidebarProps {
  servers: { id: string; name: string; host?: string; port?: number }[];
  selectedServerId: string;
  onSelectServer: (id: string) => void;
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel: (channelId: number) => void;
  connected?: boolean;
  serverAddress?: string;
  username?: string;
  onDisconnect?: () => void;
}

export function Sidebar({
  servers,
  selectedServerId,
  onSelectServer,
  channels,
  users,
  currentChannelId,
  onJoinChannel,
  onSelectChannel,
  connected,
  serverAddress,
  username,
  onDisconnect
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="server-selector">
        <select 
          value={selectedServerId}
          onChange={(e) => onSelectServer(e.target.value)}
          disabled={connected}
        >
          {servers.map(server => (
            <option key={server.id} value={server.id}>
              {server.name}
            </option>
          ))}
        </select>
        {serverAddress && (
          <span className="server-address">{serverAddress}</span>
        )}
      </div>
      
      {connected && (
        <div className="server-status-panel">
          <div className="server-status-row">
            <span className="status-label">Logged in as</span>
            <span className="status-value">{username}</span>
          </div>
          <div className="server-status-row">
            <span className="status-label">Users online</span>
            <span className="status-value">{users.length}</span>
          </div>
          {onDisconnect && (
            <button className="disconnect-btn" onClick={onDisconnect}>
              Disconnect
            </button>
          )}
        </div>
      )}
      
      <div className="sidebar-divider"></div>
      
      <div className="sidebar-channels">
        <ChannelTree
          channels={channels}
          users={users}
          currentChannelId={currentChannelId}
          onJoinChannel={onJoinChannel}
          onSelectChannel={onSelectChannel}
        />
      </div>
    </aside>
  );
}
