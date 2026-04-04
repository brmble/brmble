import { useState, useEffect } from 'react';
import { ChannelTree } from './ChannelTree';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
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
import { Icon } from '../Icon/Icon';
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

  const [sidebarContextMenu, setSidebarContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [addChannelDialog, setAddChannelDialog] = useState(false);
  const [requestChannelDialog, setRequestChannelDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDescription, setNewChannelDescription] = useState('');

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
                    <Icon name="monitor" size={11} className="user-status-icon user-status-icon--sharing" stroke="var(--accent-primary)" strokeWidth="2.5" />
                  ) : (
                    <>
                      {user.deafened && (
                        <Icon name="headphones-off" size={11} className="user-status-icon user-status-icon--deaf" strokeWidth="2.5" />
                      )}
                      {user.muted && (
                        <Icon name="mic-off" size={11} className="user-status-icon user-status-icon--muted" strokeWidth="2.5" />
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

      <div className="sidebar-channels" onContextMenu={(e) => {
        if (e.target !== e.currentTarget) {
          return;
        }
        e.preventDefault();
        setSidebarContextMenu({ x: e.clientX, y: e.clientY });
      }}>
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
              type: 'item' as const,
              label: 'Direct Message',
              icon: (
                <Icon name="message-square" size={14} />
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              type: 'item' as const,
              label: 'User Info',
              icon: (
                <Icon name="info-filled" size={14} />
              ),
              onClick: () => setInfoDialogUser({ userId: contextMenu.userId, userName: contextMenu.userName, isSelf: contextMenu.isSelf }),
            },
            ...(contextMenu.isSelf && onEditAvatar ? [{
              type: 'item' as const,
              label: 'Edit Profile',
              icon: (
                <Icon name="user" size={14} />
              ),
              onClick: () => onEditAvatar(),
            }] : []),
            ...(!contextMenu.isSelf ? [{
              type: 'item' as const,
              label: (() => {
                const isLocallyMuted = localStorage.getItem(`localMute_${contextMenu.userId}`) === 'true';
                return isLocallyMuted ? 'Local Unmute' : 'Local Mute';
              })(),
              icon: (
                <Icon name="mic-off" size={14} />
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
              const hasKickPermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.Kick);
              const hasBanPermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.Ban);
              const hasPrioritySpeakerPermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.MuteDeafen);
              const hasMovePermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.Move);
              const hasServerMutePermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.MuteDeafen);
              const hasAdminPermission = hasKickPermission || hasBanPermission || hasPrioritySpeakerPermission || hasMovePermission || hasServerMutePermission;

              if (!hasAdminPermission) return [];

              const targetUser = rootUsers.find(u => u.session === parseInt(contextMenu.userId));
              const adminItems: ContextMenuItem[] = [];

              if (hasServerMutePermission) {
                adminItems.push({
                  type: 'item' as const,
                  label: targetUser?.muted ? 'Server Unmute' : 'Server Mute',
                  icon: (
                    <Icon name="mic-off" size={14} />
                  ),
                  onClick: () => bridge.send(targetUser?.muted ? 'voice.unmute' : 'voice.mute', { session: parseInt(contextMenu.userId) }),
                });
              }

              if (hasMovePermission) {
                adminItems.push({
                  type: 'item' as const,
                  label: 'Move to Root',
                  icon: (
                    <Icon name="arrow-right" size={14} />
                  ),
                  onClick: () => bridge.send('voice.move', { session: parseInt(contextMenu.userId), channelId: 0 }),
                });
              }

              if (hasPrioritySpeakerPermission) {
                adminItems.push({
                  type: 'item' as const,
                  label: targetUser?.prioritySpeaker ? 'Remove Priority Speaker' : 'Priority Speaker',
                  icon: (
                    <Icon name="star" size={14} />
                  ),
                  onClick: () => {
                    bridge.send('voice.setPrioritySpeaker', { session: parseInt(contextMenu.userId), enabled: !targetUser?.prioritySpeaker });
                  },
                });
              }

              if (hasKickPermission) {
                adminItems.push({
                  type: 'item' as const,
                  label: 'Kick User',
                  icon: (
                    <Icon name="x" size={14} />
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
                  type: 'item' as const,
                  label: 'Ban User',
                  icon: (
                    <Icon name="ban" size={14} />
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
                type: 'item' as const,
                label: 'Admin',
                icon: (
                  <Icon name="shield" size={14} />
                ),
                children: adminItems,
              }];
            })(),
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {sidebarContextMenu && (
        <ContextMenu
          x={sidebarContextMenu.x}
          y={sidebarContextMenu.y}
          items={[
            ...(hasPermission(0, Permission.MakeChannel) ? [{
              type: 'item' as const,
              label: 'Add Channel',
              icon: (
                <Icon name="plus" size={14} />
              ),
              onClick: () => {
                setAddChannelDialog(true);
                setSidebarContextMenu(null);
              },
            }] : []),
            {
              type: 'item' as const,
              label: 'Request Channel',
              icon: (
                <Icon name="message-square" size={14} />
              ),
              onClick: () => {
                setRequestChannelDialog(true);
                setSidebarContextMenu(null);
              },
            },
          ]}
          onClose={() => setSidebarContextMenu(null)}
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
      {addChannelDialog && (
        <div className="modal-overlay" onClick={() => { setAddChannelDialog(false); setNewChannelName(''); setNewChannelDescription(''); }}>
          <div
            className="prompt glass-panel animate-slide-up"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="heading-title modal-title">Add Channel</h2>
            </div>
            <div className="prompt-input-container">
              <input
                type="text"
                className="brmble-input"
                placeholder="Channel name"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="prompt-input-container">
              <textarea
                className="brmble-input"
                placeholder="Description (optional, max 127 chars)"
                value={newChannelDescription}
                onChange={(e) => setNewChannelDescription(e.target.value.slice(0, 127))}
                rows={3}
                style={{ resize: 'vertical', minHeight: '60px' }}
              />
            </div>
            <div className="prompt-footer">
              <span className="char-counter">{newChannelDescription.length}/127</span>
              <button className="btn btn-secondary" onClick={() => { setAddChannelDialog(false); setNewChannelName(''); setNewChannelDescription(''); }}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={newChannelName.trim().length === 0} onClick={() => { const trimmedName = newChannelName.trim(); if (!trimmedName) { return; } bridge.send('voice.addChannel', { name: trimmedName, description: newChannelDescription, parent: 0 }); setAddChannelDialog(false); setNewChannelName(''); setNewChannelDescription(''); }}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
      {requestChannelDialog && (
        <div className="modal-overlay" onClick={() => setRequestChannelDialog(false)}>
          <div
            className="prompt glass-panel animate-slide-up"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="heading-title modal-title">Request Channel</h2>
              <p className="modal-subtitle">Channel request feature coming soon</p>
            </div>
            <div className="prompt-footer">
              <button className="btn btn-primary" onClick={() => setRequestChannelDialog(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
