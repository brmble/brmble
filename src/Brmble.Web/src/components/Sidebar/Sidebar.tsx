import { useState, useEffect } from 'react';
import { ChannelTree } from './ChannelTree';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { UserTooltip } from '../UserTooltip/UserTooltip';
import { Tooltip } from '../Tooltip/Tooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { useResizable } from '../../hooks/useResizable';
import { useProfileFingerprint } from '../../contexts/ProfileContext';
import { prompt } from '../../hooks/usePrompt';
import bridge from '../../bridge';
import type { Channel, User, ConnectionStatus } from '../../types';
import { SERVICE_DISPLAY_NAMES } from '../../types';
import type { ServiceName, ServiceState } from '../../types';
import Avatar from '../Avatar/Avatar';
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
  channelUnreads?: Map<string, { notificationCount: number; highlightCount: number }>;
  sharingChannelId?: number;
  sharingUserSession?: number;
  onWatchScreenShare?: (roomName: string) => void;
  onEditAvatar?: () => void;
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
  pendingChannelAction,
  channelUnreads,
  sharingChannelId,
  sharingUserSession,
  onWatchScreenShare,
  onEditAvatar
}: SidebarProps) {
  const fingerprint = useProfileFingerprint();
  const { width, isDragging, handleProps } = useResizable({
    minWidth: 340,
    maxWidth: 600,
    defaultWidth: 340,
    storageKey: 'brmble-sidebar-width',
    fingerprint,
  });

  const connected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isReconnecting = connectionStatus === 'reconnecting';

  const rootChannel = channels.find(ch => ch.id === 0 || ch.parent === ch.id);
  const rootUsers = rootChannel ? users.filter(u => u.channelId === rootChannel.id) : [];
  const nonRootChannels = rootChannel ? channels.filter(ch => ch !== rootChannel) : channels;
  const nonRootUsers = rootChannel ? users.filter(u => u.channelId !== rootChannel.id) : users;

  const { statuses } = useServiceStatus();

  const serviceOrder: ServiceName[] = ['voice', 'chat', 'server', 'livekit'];

  const stateLabel = (state: ServiceState): string => {
    switch (state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting';
      case 'disconnected': return 'Disconnected';
      case 'unavailable': return 'Unavailable';
      case 'idle': return 'Idle';
    }
  };

  const dotTooltip = (svc: ServiceName): string => {
    const name = SERVICE_DISPLAY_NAMES[svc];
    const state = stateLabel(statuses[svc].state);
    const error = statuses[svc].error;
    return error ? `${name}: ${state} — ${error}` : `${name}: ${state}`;
  };

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    userName: string;
    isSelf: boolean;
  } | null>(null);

  const [infoDialogUser, setInfoDialogUser] = useState<{ userId: string; userName: string; isSelf: boolean } | null>(null);

  const { hasPermission, Permission, requestPermissions } = usePermissions();

  useEffect(() => {
    if (connected) {
      requestPermissions(0);
    }
  }, [connected, requestPermissions]);

  return (
    <aside className={`sidebar${isDragging ? ' sidebar--resizing' : ''}`} style={{ width }}>
      <div className={`server-info-panel${isServerChatActive ? ' server-info-active' : ''}`}>
        {serverLabel ? (
          <div 
            className={`server-info-header${onSelectServer ? ' server-info-clickable' : ''}`}
            onClick={onSelectServer}
            role={onSelectServer ? 'button' : undefined}
            tabIndex={onSelectServer ? 0 : undefined}
            onKeyDown={onSelectServer ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectServer();
              }
            } : undefined}
          >
            <div className="server-info-name">{serverLabel}</div>
            {serverAddress && (
              <div className="server-info-address">{serverAddress}</div>
            )}
            
            {connected && (
              <div className="server-integrated-stats">
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

            <div className="server-status-line" aria-live="polite" aria-atomic="true">
              <div className="service-status-dots" aria-label="Service status">
                {serviceOrder.map(svc => (
                  <Tooltip key={svc} content={dotTooltip(svc)} position="top">
                    <span
                      className={`service-dot service-dot--${statuses[svc].state}`}
                      aria-label={dotTooltip(svc)}
                      tabIndex={0}
                    />
                  </Tooltip>
                ))}
              </div>
              <span className="status-text">
                {connectionStatus === 'idle' && 'Not connected'}
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {connectionStatus === 'failed' && 'Connection failed'}
                {connectionStatus === 'disconnected' && 'Disconnected'}
              </span>
              {(isConnecting || isReconnecting) && onCancelReconnect && (
                <button
                  className="btn btn-sm disconnect-btn"
                  onClick={(e) => { e.stopPropagation(); onCancelReconnect(); }}
                >
                  Cancel
                </button>
              )}
              {connected && onDisconnect && (
                <button
                  className="btn btn-sm disconnect-btn"
                  onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="server-info-header">
            <div className="server-status-line" aria-live="polite" aria-atomic="true">
              <div className="service-status-dots" aria-label="Service status">
                {serviceOrder.map(svc => (
                  <Tooltip key={svc} content={dotTooltip(svc)} position="top">
                    <span
                      className={`service-dot service-dot--${statuses[svc].state}`}
                      aria-label={dotTooltip(svc)}
                      tabIndex={0}
                    />
                  </Tooltip>
                ))}
              </div>
              <span className="status-text">
                {connectionStatus === 'idle' && 'Not connected'}
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'connecting' && 'Connecting...'}
                {connectionStatus === 'reconnecting' && 'Reconnecting...'}
                {connectionStatus === 'failed' && 'Connection failed'}
                {connectionStatus === 'disconnected' && 'Disconnected'}
              </span>
              {(isConnecting || isReconnecting) && onCancelReconnect && (
                <button
                  className="btn btn-sm disconnect-btn"
                  onClick={(e) => { e.stopPropagation(); onCancelReconnect(); }}
                >
                  Cancel
                </button>
              )}
              {connected && onDisconnect && (
                <button
                  className="btn btn-sm disconnect-btn"
                  onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      
      {connected && rootUsers.length > 0 && (
        <div className="root-users-panel">
          <div className="root-users-header">
            <h4 className="heading-label">Connected</h4>
            <span className="root-users-count">{rootUsers.length}</span>
          </div>
          <div className="root-users-list">
            {rootUsers.map((user, i) => (
              <UserTooltip key={user.session} user={user}>
              <div
                className={`root-user-row${user.self ? ' root-user-self' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self });
                }}
                onDoubleClick={user.session === sharingUserSession
                  ? () => onWatchScreenShare?.(`channel-${rootChannel?.id ?? 0}`)
                  : undefined}
              >
                <span className="user-status-area">
                  {user.session === sharingUserSession ? (
                    <svg className="user-status-icon user-status-icon--sharing" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  ) : (
                    <>
                      {user.deafened && (
                        <svg className="user-status-icon user-status-icon--deaf" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23"/>
                          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
                          <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
                        </svg>
                      )}
                      {user.muted && (
                        <svg className="user-status-icon user-status-icon--muted" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23"/>
                          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                        </svg>
                      )}
                    </>
                  )}
                </span>
                <Avatar user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }} size={20} isMumbleOnly={!user.self && !user.isBrmbleClient} />
                <span className="root-user-name">{user.name}</span>
                {user.self && <span className="root-self-badge">you</span>}
                {user.session === sharingUserSession && (
                  <span className="sharing-badge">Sharing</span>
                )}
              </div>
              </UserTooltip>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-channels">
        {connected && (
          <div className="channels-section-header">
            <h4 className="heading-label">Channels</h4>
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
          channelUnreads={channelUnreads}
          sharingChannelId={sharingChannelId}
          sharingUserSession={sharingUserSession}
          onWatchScreenShare={onWatchScreenShare}
          onEditAvatar={onEditAvatar}
          onMoveUser={(session, channelId) => bridge.send('voice.move', { session, channelId })}
        />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            ...(!contextMenu.isSelf && onStartDM ? [{
              label: 'Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              label: 'User Info',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              onClick: () => setInfoDialogUser({ userId: contextMenu.userId, userName: contextMenu.userName, isSelf: contextMenu.isSelf }),
            },
            ...(contextMenu.isSelf && onEditAvatar ? [{
              label: 'Edit Profile',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              ),
              onClick: () => onEditAvatar(),
            }] : []),
            ...(!contextMenu.isSelf ? [{
              label: (() => {
                const isLocallyMuted = localStorage.getItem(`localMute_${contextMenu.userId}`) === 'true';
                return isLocallyMuted ? 'Local Unmute' : 'Local Mute';
              })(),
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                </svg>
              ),
              onClick: () => {
                const session = parseInt(contextMenu.userId);
                const isLocallyMuted = localStorage.getItem(`localMute_${contextMenu.userId}`) === 'true';
                const newMuted = !isLocallyMuted;
                localStorage.setItem(`localMute_${session}`, String(newMuted));
                bridge.send('voice.setLocalMute', { session, muted: newMuted });
              },
            }] : []),

            ...(() => {
              const hasKickPermission = !contextMenu.isSelf && hasPermission(0, Permission.Kick);
              const hasBanPermission = !contextMenu.isSelf && hasPermission(0, Permission.Ban);
              const hasPrioritySpeakerPermission = !contextMenu.isSelf && hasPermission(0, Permission.MuteDeafen);
              const hasMovePermission = !contextMenu.isSelf && hasPermission(0, Permission.Move);
              const hasServerMutePermission = !contextMenu.isSelf && hasPermission(0, Permission.MuteDeafen);
              const hasAdminPermission = hasKickPermission || hasBanPermission || hasPrioritySpeakerPermission || hasMovePermission || hasServerMutePermission;

              if (!hasAdminPermission) return [];

              const targetUser = rootUsers.find(u => u.session === parseInt(contextMenu.userId));
              const adminItems = [];

              if (hasServerMutePermission) {
                adminItems.push({
                  label: targetUser?.muted ? 'Server Unmute' : 'Server Mute',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                    </svg>
                  ),
                  onClick: () => bridge.send(targetUser?.muted ? 'voice.unmute' : 'voice.mute', { session: parseInt(contextMenu.userId) }),
                });
              }

              if (hasMovePermission) {
                adminItems.push({
                  label: 'Move to Root',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  ),
                  onClick: () => bridge.send('voice.move', { session: parseInt(contextMenu.userId), channelId: 0 }),
                });
              }

              if (hasPrioritySpeakerPermission) {
                adminItems.push({
                  label: targetUser?.prioritySpeaker ? 'Remove Priority Speaker' : 'Priority Speaker',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z"/>
                    </svg>
                  ),
                  onClick: () => {
                    bridge.send('voice.setPrioritySpeaker', { session: parseInt(contextMenu.userId), enabled: !targetUser?.prioritySpeaker });
                  },
                });
              }

              if (hasKickPermission) {
                adminItems.push({
                  label: 'Kick User',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  ),
                  onClick: async () => {
                    const reason = await prompt({
                      title: 'Kick User',
                      message: `Enter a reason for kicking ${targetUser?.name || 'user'}:`,
                      placeholder: 'Reason (optional)',
                      confirmLabel: 'Kick',
                    });
                    if (reason === null) return;
                    bridge.send('voice.kick', { session: parseInt(contextMenu.userId), reason });
                  },
                });
              }

              if (hasBanPermission) {
                adminItems.push({
                  label: 'Ban User',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
                  ),
                  onClick: async () => {
                    const reason = await prompt({
                      title: 'Ban User',
                      message: `Enter a reason for banning ${targetUser?.name || 'user'}:`,
                      placeholder: 'Reason (optional)',
                      confirmLabel: 'Ban',
                    });
                    if (reason === null) return;
                    bridge.send('voice.ban', { session: parseInt(contextMenu.userId), reason });
                  },
                });
              }

              return [{
                label: 'Admin',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                ),
                children: adminItems,
              }];
            })(),
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {infoDialogUser && (() => {
        const user = users.find(u => u.session === parseInt(infoDialogUser.userId));
        return (
          <UserInfoDialog
            isOpen={true}
            onClose={() => setInfoDialogUser(null)}
            userName={infoDialogUser.userName}
            session={parseInt(infoDialogUser.userId)}
            isSelf={infoDialogUser.isSelf}
            comment={user?.comment}
            matrixUserId={user?.matrixUserId}
            avatarUrl={user?.avatarUrl}
            onStartDM={onStartDM}
          />
        );
      })()}
      <div
        className={`sidebar-resize-handle${isDragging ? ' sidebar-resize-handle--active' : ''}`}
        ref={handleProps.ref}
        onPointerDown={handleProps.onPointerDown}
        onDoubleClick={handleProps.onDoubleClick}
        aria-label="Resize sidebar"
        role="separator"
        aria-orientation="vertical"
      />
    </aside>
  );
}
