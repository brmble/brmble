import { ChannelTree } from '../ChannelTree';
import type { Channel, User } from '../../types';
import './Sidebar.css';

interface SidebarProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel: (channelId: number) => void;
  onSelectServer?: () => void;
  isServerChatActive?: boolean;
  connected?: boolean;
  serverLabel?: string;
  serverAddress?: string;
  username?: string;
  onDisconnect?: () => void;
}

export function Sidebar({
  channels,
  users,
  currentChannelId,
  onJoinChannel,
  onSelectChannel,
  onSelectServer,
  isServerChatActive,
  connected,
  serverLabel,
  serverAddress,
  username,
  onDisconnect
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {connected && (
        <div 
          className={`server-info-panel${onSelectServer ? ' server-info-clickable' : ''}${isServerChatActive ? ' server-info-active' : ''}`}
          onClick={onSelectServer}
        >
          <div className="server-info-name">{serverLabel || 'Server'}</div>
          {serverAddress && (
            <div className="server-info-address">{serverAddress}</div>
          )}
        </div>
      )}
      
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
