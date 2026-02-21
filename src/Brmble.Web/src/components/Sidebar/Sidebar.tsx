import { useState } from 'react';
import { ChannelTree } from '../ChannelTree';
import { ContextMenu } from '../ContextMenu/ContextMenu';
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
  pendingChannelAction?: number | 'leave' | null;
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
  speakingUsers,
  pendingChannelAction
}: SidebarProps) {
  const connected = connectionStatus === 'connected';
  const isReconnecting = connectionStatus === 'reconnecting';

  const rootChannel = channels.find(ch => ch.id === 0 || ch.parent === ch.id);
  const rootUsers = rootChannel ? users.filter(u => u.channelId === rootChannel.id) : [];
  const nonRootChannels = rootChannel ? channels.filter(ch => ch !== rootChannel) : channels;
  const nonRootUsers = rootChannel ? users.filter(u => u.channelId !== rootChannel.id) : users;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    userName: string;
    isSelf: boolean;
  } | null>(null);

  return (
    <aside className="sidebar">
      {serverLabel && (
        <div 
          className={`server-info-panel${onSelectServer ? ' server-info-clickable' : ''}${isServerChatActive ? ' server-info-active' : ''}`}
          onClick={onSelectServer}
        >
          <div className="server-info-name">{serverLabel}</div>
          {serverAddress && (
            <div className="server-info-address">{serverAddress}</div>
          )}
          <div className="server-status-line" aria-live="polite" aria-atomic="true">
            <span className={`status-dot status-dot--${connectionStatus}`} aria-hidden="true" />
            {connectionStatus !== 'idle' && (
              <span className="status-text">
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {connectionStatus === 'failed' && 'Disconnected'}
              </span>
            )}
            {(onDisconnect || onCancelReconnect) && (connected || isReconnecting) && (
              <button
                className="disconnect-btn"
                onClick={(e) => { e.stopPropagation(); (isReconnecting ? onCancelReconnect : onDisconnect)?.(); }}
              >
                {isReconnecting ? 'Cancel' : 'Disconnect'}
              </button>
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
        </div>
      )}
      
      {connected && rootUsers.length > 0 && (
        <div className="root-users-panel">
          <div className="root-users-header">
            <span className="root-users-label">Connected</span>
            <span className="root-users-count">{rootUsers.length}</span>
          </div>
          <div className="root-users-list">
            {rootUsers.map((user, i) => (
              <div
                key={user.session}
                className={`root-user-row${user.self ? ' root-user-self' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                title={user.deafened ? 'Deafened' : user.muted ? 'Muted' : 'Online'}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self });
                }}
              >
                <span className="root-user-status">
                  {user.muted && (
                    <svg className="status-icon status-icon--muted" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                    </svg>
                  )}
                  {user.deafened && (
                    <svg className="status-icon status-icon--deaf" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                    </svg>
                  )}
                  <svg className="status-icon status-icon--mic" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </span>
                <span className="root-user-name">{user.name}</span>
                {user.self && <span className="root-self-badge">you</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-channels">
        {connected && (
          <div className="channels-section-header">
            <span className="channels-section-label">Channels</span>
            <span className="channels-section-count">{nonRootChannels.length}</span>
          </div>
        )}
        <ChannelTree
          channels={nonRootChannels}
          users={nonRootUsers}
          currentChannelId={currentChannelId}
          onJoinChannel={onJoinChannel}
          onSelectChannel={onSelectChannel}
          onStartDM={onStartDM}
          speakingUsers={speakingUsers}
          pendingChannelAction={pendingChannelAction}
        />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            ...(!contextMenu.isSelf && onStartDM ? [{
              label: 'Send Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              label: 'Information',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              onClick: () => { /* placeholder — implement later */ },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}
