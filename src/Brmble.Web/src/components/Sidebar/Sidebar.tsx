import { ChannelTree } from '../ChannelTree';
import type { Channel, User, ConnectionStatus } from '../../types';
import './Sidebar.css';

interface SidebarProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel: (channelId: number) => void;
  onSelectServer?: () => void;
  isServerChatActive?: boolean;
  connectionStatus?: ConnectionStatus;
  onCancelReconnect?: () => void;
  serverLabel?: string;
  serverAddress?: string;
  username?: string;
  onDisconnect?: () => void;
  onStartDM?: (userId: string, userName: string) => void;
  speakingUsers?: Map<number, boolean>;
}

export function Sidebar({
  channels,
  users,
  currentChannelId,
  onJoinChannel,
  onSelectChannel,
  onSelectServer,
  isServerChatActive,
  connectionStatus = 'idle',
  onCancelReconnect,
  serverLabel,
  serverAddress,
  username,
  onDisconnect,
  onStartDM,
  speakingUsers
}: SidebarProps) {
  const connected = connectionStatus === 'connected';
  const isReconnecting = connectionStatus === 'reconnecting';

  return (
    <aside className="sidebar">
      {serverLabel && (
        <div 
          className={`server-info-panel${onSelectServer ? ' server-info-clickable' : ''}${isServerChatActive ? ' server-info-active' : ''}`}
          onClick={onSelectServer}
        >
          <div className="server-info-name">{serverLabel || 'Server'}</div>
          {serverAddress && (
            <div className="server-info-address">{serverAddress}</div>
          )}
          <div className="server-status-line">
            <span className={`status-dot status-dot--${connectionStatus ?? 'idle'}`} />
            {connectionStatus && connectionStatus !== 'idle' && (
              <span className="status-text">
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {connectionStatus === 'failed' && 'Disconnected'}
              </span>
            )}
          </div>
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
          {(onDisconnect || onCancelReconnect) && (
            <button
              className="disconnect-btn"
              onClick={isReconnecting ? onCancelReconnect : onDisconnect}
            >
              {isReconnecting ? 'Cancel reconnecting' : 'Disconnect'}
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
          onStartDM={onStartDM}
          speakingUsers={speakingUsers}
        />
      </div>
    </aside>
  );
}
