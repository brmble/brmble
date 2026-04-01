import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
import { UserTooltip } from '../UserTooltip/UserTooltip';
import { usePermissions, Permission } from '../../hooks/usePermissions';
import { prompt } from '../../hooks/usePrompt';
import bridge from '../../bridge';
import Avatar from '../Avatar/Avatar';
import { EditChannelDialog } from '../EditChannelDialog/EditChannelDialog';
import { RenameConfirmDialog } from '../RenameConfirmDialog/RenameConfirmDialog';
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
  description?: string;
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
  onMoveUser?: (session: number, channelId: number) => void;
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, onSelectChannel, onStartDM, speakingUsers, pendingChannelAction, channelUnreads, sharingChannelId, sharingUserSession, onWatchScreenShare, onEditAvatar, onMoveUser }: ChannelTreeProps) {
  const [sortByNamePerChannel, setSortByNamePerChannel] = useState<Record<number, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string; isSelf: boolean; channelId?: number } | null>(null);
  const [channelContextMenu, setChannelContextMenu] = useState<{ x: number; y: number; channelId: number; channelName: string } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{ userId: string; userName: string; isSelf: boolean } | null>(null);
  const [draggedUser, setDraggedUser] = useState<number | null>(null);
  const [dropTargetChannel, setDropTargetChannel] = useState<number | null>(null);
  const [editChannelDialog, setEditChannelDialog] = useState<{ id: number; name: string; description?: string } | null>(null);
  const [renameConfirmDialog, setRenameConfirmDialog] = useState<{
    channelId: number;
    oldName: string;
    newName: string;
    description: string;
  } | null>(null);
  const [removeChannelDialog, setRemoveChannelDialog] = useState<{ id: number; name: string } | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState('');
  const { hasPermission, Permission, requestPermissions } = usePermissions();

  const canDragUsers = currentChannelId != null && hasPermission(currentChannelId, Permission.Move);

  useEffect(() => {
    if (currentChannelId) {
      requestPermissions(currentChannelId);
    }
    requestPermissions(0);
  }, [currentChannelId, requestPermissions]);

  useEffect(() => {
    if (contextMenu?.channelId != null) {
      requestPermissions(contextMenu.channelId);
    }
  }, [contextMenu?.channelId, requestPermissions]);

  useEffect(() => {
    if (channelContextMenu?.channelId != null) {
      requestPermissions(channelContextMenu.channelId);
    }
  }, [channelContextMenu?.channelId, requestPermissions]);

  useEffect(() => {
    const handleError = (data: unknown) => {
      const d = data as { message?: string; type?: string } | undefined;
      const msg = d?.message || 'Failed to edit channel';
      console.error('Edit channel error:', msg);
    };
    bridge.on('voice.error', handleError);
    return () => bridge.off('voice.error', handleError);
  }, []);

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

    const isChannelActive = (channelId: number) => channelContextMenu?.channelId === channelId;

    return (
      <div key={channel.id} className={`channel-item${pendingChannelAction !== null ? ' channel-item--pending' : ''}`} data-level={level}>
        <div 
          className={`channel-row ${isCurrentChannel ? 'current' : ''}${hasUnread ? ' channel-row--unread' : ''}${channel.users.length === 0 && !hasUnread ? ' channel-row--empty' : ''}${isFolder ? ' is-folder' : ''}${dropTargetChannel === channel.id ? ' channel-row--drop-target' : ''}${isChannelActive(channel.id) ? ' channel-row--context-active' : ''}`}
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
          onDragOver={(e) => {
            if (!canDragUsers || draggedUser === null) return;
            e.preventDefault();
            setDropTargetChannel(channel.id);
          }}
          onDragLeave={() => setDropTargetChannel(null)}
          onDrop={(e) => {
            if (!canDragUsers || draggedUser === null) return;
            e.preventDefault();
            const session = parseInt(e.dataTransfer.getData('text/plain'));
            if (!isNaN(session) && onMoveUser) {
              onMoveUser(session, channel.id);
            }
            setDraggedUser(null);
            setDropTargetChannel(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (channel.id !== 0) {
              setChannelContextMenu({ x: e.clientX, y: e.clientY, channelId: channel.id, channelName: channel.name });
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
                className={`user-row ${user.self ? 'self' : ''} ${speakingUsers?.has(user.session) ? 'speaking' : ''}${canDragUsers && !user.self ? ' user-row--draggable' : ''}`}
                style={{ paddingLeft: `calc(4px + ${level * 20}px)` }}
                draggable={canDragUsers && !user.self}
                onDragStart={(e) => {
                  if (!canDragUsers || user.self) return;
                  e.dataTransfer.setData('text/plain', String(user.session));
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggedUser(user.session);
                }}
                onDragEnd={() => {
                  setDraggedUser(null);
                  setDropTargetChannel(null);
                }}
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

  const channelMenuItems = useMemo(() => {
    if (!channelContextMenu) return [];

    const items = [
      {
        type: 'item' as const,
        label: 'Join',
        onClick: () => {
          onJoinChannel(channelContextMenu.channelId);
          setChannelContextMenu(null);
        },
      },
    ];

    const hasEditPermission = hasPermission(channelContextMenu.channelId, Permission.MakeChannel);
    const hasRemovePermission = hasPermission(channelContextMenu.channelId, Permission.Write);
    const hasAdmin = hasEditPermission || hasRemovePermission;

    if (!hasAdmin) return items;

    const adminItems = [];

    if (hasEditPermission) {
      adminItems.push({
        type: 'item' as const,
        label: 'Edit',
        onClick: () => {
          const channel = channels.find(c => c.id === channelContextMenu.channelId);
          setEditChannelDialog({
            id: channelContextMenu.channelId,
            name: channelContextMenu.channelName,
            description: channel?.description || '',
          });
          setChannelContextMenu(null);
        },
      });
    }

    if (hasRemovePermission) {
      adminItems.push({
        type: 'item' as const,
        label: 'Remove',
        onClick: () => {
          setRemoveChannelDialog({ id: channelContextMenu.channelId, name: channelContextMenu.channelName });
          setChannelContextMenu(null);
        },
      });
    }

    return [...items, { type: 'divider' as const }, ...adminItems];
  }, [channelContextMenu, hasPermission, onJoinChannel, channels, Permission]);

  return (
    <div className="channel-tree">
      {tree.map(channel => renderChannel(channel))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            ...(contextMenu.userId === String(sharingUserSession) && onWatchScreenShare ? [{
              type: 'item' as const,
              label: 'Watch Stream',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              ),
onClick: () => {
                const channelId = contextMenu.channelId ?? currentChannelId;
                onWatchScreenShare?.(`channel-${channelId}`);
              },
            }] : []),
            ...(!contextMenu.isSelf && onStartDM ? [{
              type: 'item' as const,
              label: 'Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              type: 'item' as const,
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
              type: 'item' as const,
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
              type: 'item' as const,
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
              const targetChannelId = contextMenu.channelId ?? currentChannelId;
              const hasKickPermission = !contextMenu.isSelf && hasPermission(0, Permission.Kick);
              const hasBanPermission = !contextMenu.isSelf && hasPermission(0, Permission.Ban);
              const hasPrioritySpeakerPermission = !contextMenu.isSelf && targetChannelId != null && hasPermission(targetChannelId, Permission.MuteDeafen);
              const hasMovePermission = !contextMenu.isSelf && targetChannelId != null && hasPermission(targetChannelId, Permission.Move);
              const hasServerMutePermission = !contextMenu.isSelf && targetChannelId != null && hasPermission(targetChannelId, Permission.MuteDeafen);
              const hasAdminPermission = hasKickPermission || hasBanPermission || hasPrioritySpeakerPermission || hasMovePermission || hasServerMutePermission;

              if (!hasAdminPermission) return [];

              const targetUser = users.find(u => u.session === parseInt(contextMenu.userId));
              const adminItems: ContextMenuItem[] = [];

              if (hasServerMutePermission) {
                adminItems.push({
                  type: 'item' as const,
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
                  type: 'item' as const,
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
                  type: 'item' as const,
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
                  type: 'item' as const,
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
                  type: 'item' as const,
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
                type: 'item' as const,
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
      {channelContextMenu && (
        <ContextMenu
          x={channelContextMenu.x}
          y={channelContextMenu.y}
          items={channelMenuItems}
          onClose={() => setChannelContextMenu(null)}
        />
      )}
      {editChannelDialog && (
        <EditChannelDialog
          isOpen={true}
          initialName={editChannelDialog.name}
          initialDescription={editChannelDialog.description}
          onClose={() => setEditChannelDialog(null)}
          onSave={(name, description) => {
            const channel = channels.find(c => c.id === editChannelDialog!.id);
            const oldName = channel?.name || '';

            if (name !== oldName) {
              setRenameConfirmDialog({
                channelId: editChannelDialog!.id,
                oldName,
                newName: name,
                description,
              });
            } else {
              bridge.send('voice.editChannel', {
                channelId: editChannelDialog!.id,
                name,
                description,
              });
            }
          }}
          onError={(msg) => console.error('Edit channel error:', msg)}
        />
      )}

      {renameConfirmDialog && (
        <RenameConfirmDialog
          isOpen={true}
          oldName={renameConfirmDialog.oldName}
          newName={renameConfirmDialog.newName}
          onClose={() => setRenameConfirmDialog(null)}
          onConfirm={() => {
            bridge.send('voice.editChannel', {
              channelId: renameConfirmDialog.channelId,
              name: renameConfirmDialog.newName,
              description: renameConfirmDialog.description,
            });
            setEditChannelDialog(null);
            setRenameConfirmDialog(null);
          }}
        />
      )}

      {removeChannelDialog && (
        <div className="modal-overlay" onClick={() => setRemoveChannelDialog(null)}>
          <div
            className="prompt glass-panel animate-slide-up"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="heading-title modal-title">Remove Channel</h2>
              <p className="modal-subtitle">
                Are you sure you want to remove "{removeChannelDialog.name}"?
              </p>
            </div>
            <div className="prompt-input-container">
              <input
                type="text"
                className="brmble-input"
                placeholder='Type "Remove" to confirm'
                onChange={(e) => setRemoveConfirmText(e.target.value)}
              />
            </div>
            <div className="prompt-footer">
              <button className="btn btn-secondary" onClick={() => setRemoveChannelDialog(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={removeConfirmText !== 'Remove'}
                onClick={() => {
                  bridge.send('voice.removeChannel', { channelId: removeChannelDialog.id });
                  setRemoveChannelDialog(null);
                  setRemoveConfirmText('');
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
