import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
import { UserTooltip } from '../UserTooltip/UserTooltip';
import { usePermissions } from '../../hooks/usePermissions';
import bridge from '../../bridge';
import Avatar from '../Avatar/Avatar';
import './ChannelTree.css';

interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  prioritySpeaker?: boolean;
  comment?: string;
  matrixUserId?: string;
  avatarUrl?: string;
  isBrmbleClient?: boolean;
}

interface Channel {
  id: number;
  name: string;
  parent?: number;
}

interface ChannelWithUsers extends Channel {
  users: User[];
  children: ChannelWithUsers[];
}

interface ChannelTreeProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel?: (channelId: number) => void;
  onStartDM?: (userId: string, userName: string) => void;
  speakingUsers?: Map<number, boolean>;
  pendingChannelAction?: number | 'leave' | null;
  channelUnreads?: Map<string, { notificationCount: number; highlightCount: number }>;
  sharingChannelId?: number;
  sharingUserSession?: number;
  onWatchScreenShare?: (roomName: string) => void;
  onEditAvatar?: () => void;
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, onSelectChannel, onStartDM, speakingUsers, pendingChannelAction, channelUnreads, sharingChannelId, sharingUserSession, onWatchScreenShare, onEditAvatar }: ChannelTreeProps) {
  const [sortByNamePerChannel, setSortByNamePerChannel] = useState<Record<number, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string; isSelf: boolean; channelId?: number } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{ userId: string; userName: string; isSelf: boolean } | null>(null);
  const { hasPermission, Permission, requestPermissions } = usePermissions();

  useEffect(() => {
    if (currentChannelId) {
      requestPermissions(currentChannelId);
    }
  }, [currentChannelId, requestPermissions]);
  const initialExpanded = useMemo(() => {
    const expanded = new Set<number>();
    channels.forEach(ch => {
      const hasUsers = users.some(u => u.channelId === ch.id);
      if (hasUsers) {
        expanded.add(ch.id);
      }
    });
    return expanded;
  }, [channels, users]);

  const [expandedChannels, setExpandedChannels] = useState<Set<number>>(initialExpanded);

  useEffect(() => {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      let changed = false;
      channels.forEach(ch => {
        const hasUsers = users.some(u => u.channelId === ch.id);
        if (hasUsers && !next.has(ch.id)) {
          next.add(ch.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [channels, users]);

  const toggleExpand = (channelId: number) => {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const toggleSort = (channelId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSortByNamePerChannel(prev => ({
      ...prev,
      [channelId]: !prev[channelId]
    }));
  };

  const buildTree = useCallback((): ChannelWithUsers[] => {
    const channelMap = new Map<number, ChannelWithUsers>();
    const roots: ChannelWithUsers[] = [];

    channels.forEach(ch => {
      channelMap.set(ch.id, { ...ch, users: [], children: [] });
    });

    users.forEach(user => {
      if (user.channelId !== undefined && channelMap.has(user.channelId)) {
        channelMap.get(user.channelId)!.users.push(user);
      }
    });

    channelMap.forEach(ch => {
      const sortByName = sortByNamePerChannel[ch.id] ?? false;
      ch.users = sortByName
        ? [...ch.users].sort((a, b) => a.name.localeCompare(b.name))
        : ch.users;
    });

    channelMap.forEach(ch => {
      if (ch.parent && channelMap.has(ch.parent)) {
        channelMap.get(ch.parent)!.children.push(ch);
      } else {
        roots.push(ch);
      }
    });

    const sortChildren = (channels: ChannelWithUsers[]) => {
      channels.forEach(ch => {
        if (ch.children.length > 0) {
          ch.children.sort((a, b) => a.id - b.id);
          sortChildren(ch.children);
        }
      });
    };
    sortChildren(roots);

    return roots;
  }, [channels, users, sortByNamePerChannel]);

  const tree = useMemo(() => buildTree(), [buildTree]);

  const handleChannelClick = (channelId: number) => {
    if (onSelectChannel) {
      onSelectChannel(channelId);
    }
  };

  const renderChannel = (channel: ChannelWithUsers, level: number = 0) => {
    const isExpandable = channel.children.length > 0 || channel.users.length > 0;
    const isFolder = channel.children.length > 0;
    const isExpanded = expandedChannels.has(channel.id);
    const isCurrentChannel = currentChannelId === channel.id;
    const unreadInfo = channelUnreads?.get(String(channel.id));
    const hasUnread = ((unreadInfo?.notificationCount ?? 0) + (unreadInfo?.highlightCount ?? 0)) > 0;

    return (
      <div key={channel.id} className={`channel-item${pendingChannelAction !== null ? ' channel-item--pending' : ''}`} data-level={level}>
        <div 
          className={`channel-row ${isCurrentChannel ? 'current' : ''}${hasUnread ? ' channel-row--unread' : ''}${channel.users.length === 0 && !hasUnread ? ' channel-row--empty' : ''}${isFolder ? ' is-folder' : ''}`}
          style={{ paddingLeft: `calc(16px + ${level * 20}px)` }}
          role="button"
          tabIndex={0}
          onClick={() => handleChannelClick(channel.id)}
          onDoubleClick={pendingChannelAction === null ? () => onJoinChannel(channel.id) : undefined}
          onKeyDown={(e) => {
            if (e.defaultPrevented) return;
            if (e.key === ' ') {
              e.preventDefault();
              handleChannelClick(channel.id);
            } else if (e.key === 'Enter') {
              if (pendingChannelAction === null) {
                onJoinChannel(channel.id);
              }
            }
          }}
        >
          <span 
            className={`expand-icon ${isExpanded ? 'expanded' : ''} ${!isExpandable ? 'placeholder' : ''}`}
            onClick={(e) => { e.stopPropagation(); if (isExpandable) toggleExpand(channel.id); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2L7 5L3 8V2Z" />
            </svg>
          </span>
          <span className="channel-icon">
            {channel.id === sharingChannelId ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </span>
          <span className="channel-name">{channel.name}</span>
          {channel.users.length > 0 && (
            <Tooltip content={(sortByNamePerChannel[channel.id] ?? false) ? 'Sort by join order' : 'Sort alphabetically'}>
            <button
              className="channel-sort-btn"
              onClick={(e) => toggleSort(channel.id, e)}
            >
              {(sortByNamePerChannel[channel.id] ?? false) ? 'A-Z' : '↺'}
            </button>
            </Tooltip>
          )}
          {channel.users.length > 0 && (
            <span className="user-count">({channel.users.length})</span>
          )}
          {(() => {
            const unread = channelUnreads?.get(String(channel.id));
            if (!unread) return null;
            return (
              <>
                {unread.highlightCount > 0 && (
                  <span className="channel-unread-badge channel-unread-badge--mention">
                    @{unread.highlightCount}
                  </span>
                )}
                {unread.notificationCount > 0 && (
                  <span className="channel-unread-badge">
                    {unread.notificationCount}
                  </span>
                )}
              </>
            );
          })()}
        </div>
        
        {isExpanded && (
          <div className="channel-children">
            {channel.users.map(user => (
              <UserTooltip key={user.session} user={user}>
              <div
                className={`user-row ${user.self ? 'self' : ''} ${speakingUsers?.has(user.session) ? 'speaking' : ''}`}
                style={{ paddingLeft: `calc(4px + ${level * 20}px)` }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self, channelId: channel.id });
                }}
                onDoubleClick={user.session === sharingUserSession
                  ? () => onWatchScreenShare?.(`channel-${channel.id}`)
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
                <span className="user-name">{user.name}</span>
                {user.self && <span className="self-badge">(you)</span>}
                {user.isBrmbleClient && <Tooltip content="Brmble user"><span className="brmble-badge" /></Tooltip>}
                {user.session === sharingUserSession && (
                  <span className="sharing-badge">Sharing</span>
                )}
              </div>
              </UserTooltip>
            ))}
            {channel.children.map(child => renderChannel(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="channel-tree">
      {tree.map(channel => renderChannel(channel))}
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
            ...(() => {
              const targetUser = users.find(u => u.session === parseInt(contextMenu.userId));
              const canMute = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.MuteDeafen);
              return canMute ? [{
                label: targetUser?.muted ? 'Unmute' : 'Mute',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                  </svg>
                ),
                onClick: () => bridge.send('voice.mute', { session: parseInt(contextMenu.userId) }),
              }] : [];
            })(),
            ...(() => {
              const hasKickPermission = !contextMenu.isSelf && hasPermission(0, Permission.Kick);
              const hasBanPermission = !contextMenu.isSelf && hasPermission(0, Permission.Ban);
              const hasPrioritySpeakerPermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.MuteDeafen);
              const hasMovePermission = !contextMenu.isSelf && currentChannelId && hasPermission(currentChannelId, Permission.Move);
              const hasAdminPermission = hasKickPermission || hasBanPermission || hasPrioritySpeakerPermission || hasMovePermission;

              if (!hasAdminPermission) return [];

              const targetUser = users.find(u => u.session === parseInt(contextMenu.userId));
              const adminItems = [];

              if (hasKickPermission) {
                adminItems.push({
                  label: 'Kick User',
                  icon: (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  ),
                  onClick: () => bridge.send('voice.kick', { session: parseInt(contextMenu.userId) }),
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
                  onClick: () => bridge.send('voice.ban', { session: parseInt(contextMenu.userId) }),
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
    </div>
  );
}
