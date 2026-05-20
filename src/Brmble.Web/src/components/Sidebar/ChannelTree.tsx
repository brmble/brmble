import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import { UserInfoDialog } from '../UserInfoDialog/UserInfoDialog';
import { Tooltip } from '../Tooltip/Tooltip';
import { UserTooltip } from '../UserTooltip/UserTooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { prompt } from '../../hooks/usePrompt';
import bridge from '../../bridge';
import Avatar from '../Avatar/Avatar';
import { formatIdleDuration } from '../../utils/formatIdleDuration';
import { AFK_THRESHOLD_SEC } from '../../hooks/useIdleActions';
import type { ShareInfo } from '../../hooks/useScreenShare';
import { EditChannelDialog } from '../EditChannelDialog/EditChannelDialog';
import { RenameConfirmDialog } from '../RenameConfirmDialog/RenameConfirmDialog';
import { Icon } from '../Icon/Icon';
import { AclEditorDialog } from '../AclEditor/AclEditorDialog';
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
  isEnterRestricted?: boolean;
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
  voiceIdle?: Record<number, number>;
  pendingChannelAction?: number | 'leave' | null;
  channelUnreads?: Map<string, { notificationCount: number; highlightCount: number }>;
  sharingChannelId?: number;
  sharingUserSession?: number;
  onWatchScreenShare?: (roomName: string, userId?: number, matrixUserId?: string) => void;
  onStopWatching?: (userId: number) => void;
  activeShares?: ShareInfo[];
  watchingShares?: ShareInfo[];
  onEditAvatar?: () => void;
  onMoveUser?: (session: number, channelId: number) => void;
}

function getManagedPasswordFromAclBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      snapshot?: {
        acls?: Array<{ group?: string | null }>;
      };
      acls?: Array<{ group?: string | null }>;
    };
    const acls = parsed.snapshot?.acls ?? parsed.acls ?? [];
    const markerPrefix = '__brmble_password_marker__:#';
    const marker = acls.find(acl => typeof acl.group === 'string' && acl.group.startsWith(markerPrefix))?.group;
    return marker ? marker.slice(markerPrefix.length) : '';
  } catch {
    return '';
  }
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, onSelectChannel, onStartDM, speakingUsers, voiceIdle, pendingChannelAction, channelUnreads, sharingChannelId, sharingUserSession, onWatchScreenShare, onStopWatching, activeShares, watchingShares, onEditAvatar, onMoveUser }: ChannelTreeProps) {
  const [sortByNamePerChannel, setSortByNamePerChannel] = useState<Record<number, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string; isSelf: boolean; channelId?: number } | null>(null);
  const [channelContextMenu, setChannelContextMenu] = useState<{ x: number; y: number; channelId: number; channelName: string } | null>(null);
  const [infoDialogUser, setInfoDialogUser] = useState<{ userId: string; userName: string; isSelf: boolean } | null>(null);
  const [draggedUser, setDraggedUser] = useState<number | null>(null);
  const [dropTargetChannel, setDropTargetChannel] = useState<number | null>(null);
  const [editChannelDialog, setEditChannelDialog] = useState<{ id: number; name: string; description?: string; initialPassword: string } | null>(null);
  const [aclEditorChannel, setAclEditorChannel] = useState<{ id: number; name: string } | null>(null);
  const [renameConfirmDialog, setRenameConfirmDialog] = useState<{
    channelId: number;
    oldName: string;
    newName: string;
    description: string;
  } | null>(null);
  const { hasPermission, Permission, requestPermissions } = usePermissions();
  const sharingChannelIds = useMemo(() => {
    const ids = new Set<number>();
    if (sharingChannelId != null) {
      ids.add(sharingChannelId);
    }
    for (const share of activeShares ?? []) {
      const id = Number(share.roomName.replace('channel-', ''));
      if (Number.isFinite(id)) {
        ids.add(id);
      }
    }
    return ids;
  }, [activeShares, sharingChannelId]);

  const canDragUsers = hasPermission(0, Permission.Move)
    || (currentChannelId != null && hasPermission(currentChannelId, Permission.Move));

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

  useEffect(() => {
    const handleAclChannel = (data: unknown) => {
      const payload = data as { channelId?: number; body?: string } | undefined;
      if (!payload?.body || payload.channelId == null) return;
      const body = payload.body;

      setEditChannelDialog(current => {
        if (!current || current.id !== payload.channelId) {
          return current;
        }

        return {
          ...current,
          initialPassword: getManagedPasswordFromAclBody(body),
        };
      });
    };

    bridge.on('acl.channel', handleAclChannel);
    return () => bridge.off('acl.channel', handleAclChannel);
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
            if (!canDragUsers) return;
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
            <Icon name="triangle-right" size={10} />
          </span>
          <span className="channel-icon">
            {sharingChannelIds.has(channel.id) ? (
              <Icon name="monitor" size={14} stroke="var(--accent-primary)" />
            ) : (
              <Icon name="folder" size={14} />
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
            {channel.users.map(user => {
              const share = activeShares?.find(s => s.sessionId === user.session);
              const isLocalSharer = !!user.self && user.session === sharingUserSession;
              const isRemoteSharer = !!share && !user.self;
              const isSharer = isLocalSharer || isRemoteSharer;
              const isWatchingRemoteShare = !!share && !!watchingShares?.some(s => s.userId === share.userId);

              return (
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
                    onDoubleClick={isRemoteSharer ? () => onWatchScreenShare?.(`channel-${channel.id}`, share?.userId, share?.matrixUserId) : undefined}
                  >
                    <span className="user-status-area">
                      {user.deafened && (
                        <Icon name="headphones-off" size={11} className="user-status-icon user-status-icon--deaf" strokeWidth={2.5} />
                      )}
                      {user.muted && (
                        <Icon name="mic-off" size={11} className="user-status-icon user-status-icon--muted" strokeWidth={2.5} />
                      )}
                      {voiceIdle && voiceIdle[user.session] !== undefined && voiceIdle[user.session] >= AFK_THRESHOLD_SEC && (
                        <Tooltip content={formatIdleDuration(voiceIdle[user.session])}>
                          <span tabIndex={0} role="img" aria-label={formatIdleDuration(voiceIdle[user.session])}>
                            <Icon name="moon" size={11} className="user-status-icon user-status-icon--idle" strokeWidth={2.5} />
                          </span>
                        </Tooltip>
                      )}
                    </span>
                    <Avatar user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }} size={20} isMumbleOnly={!user.self && !user.isBrmbleClient} />
                    <span className="user-name">{user.name}</span>
                    {user.self && <span className="self-badge">(you)</span>}
                    {user.isBrmbleClient && <Tooltip content="Brmble user"><span className="brmble-badge" /></Tooltip>}
                    {isSharer && (
                      <span className="sharing-indicator">
                        <span className="sharing-badge">Sharing</span>
                        {isRemoteSharer ? (
                          <button
                            className={`user-status-icon-btn${isWatchingRemoteShare ? ' user-status-icon-btn--watching' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!share) return;
                              if (isWatchingRemoteShare) {
                                onStopWatching?.(share.userId);
                              } else {
                                onWatchScreenShare?.(`channel-${channel.id}`, share.userId, share.matrixUserId);
                              }
                            }}
                            aria-label={`${isWatchingRemoteShare ? 'Watching' : 'Watch'} screen share from ${user.name}`}
                            aria-pressed={isWatchingRemoteShare}
                          >
                            <Icon name="monitor" size={11} className={`user-status-icon user-status-icon--sharing${isWatchingRemoteShare ? ' user-status-icon--watching' : ''}`} stroke="var(--accent-primary)" strokeWidth={2.5} />
                          </button>
                        ) : (
                          <Icon name="monitor" size={11} className="user-status-icon user-status-icon--sharing" stroke="var(--accent-primary)" strokeWidth={2.5} />
                        )}
                      </span>
                    )}
                  </div>
                </UserTooltip>
              );
            })}
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
            initialPassword: '',
          });
          bridge.send('acl.getChannel', { channelId: channelContextMenu.channelId });
          setChannelContextMenu(null);
        },
      });
    }

    if (hasRemovePermission) {
      adminItems.push({
        type: 'item' as const,
        label: 'Edit Permissions',
        onClick: () => {
          const channel = channels.find(c => c.id === channelContextMenu.channelId);
          setAclEditorChannel({ id: channelContextMenu.channelId, name: channel?.name ?? 'Channel' });
          setChannelContextMenu(null);
        },
      });

      adminItems.push({
        type: 'item' as const,
        label: 'Remove',
        onClick: async () => {
          const result = await prompt({
            title: 'Remove Channel',
            message: `Type "Remove" to confirm deleting "${channelContextMenu.channelName}".`,
            placeholder: 'Remove',
            confirmLabel: 'Remove',
            cancelLabel: 'Cancel',
          });

          if (result === 'Remove') {
            bridge.send('voice.removeChannel', { channelId: channelContextMenu.channelId });
          }

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
            ...(activeShares?.some(s => s.sessionId === Number(contextMenu.userId)) && !contextMenu.isSelf && onWatchScreenShare ? [{
              type: 'item' as const,
              label: 'Watch Stream',
              icon: (
                <Icon name="monitor" size={14} stroke="var(--accent-primary)" />
              ),
onClick: () => {
                const channelId = contextMenu.channelId ?? currentChannelId;
                const share = activeShares?.find(s => s.sessionId === Number(contextMenu.userId));
                onWatchScreenShare?.(`channel-${channelId}`, share?.userId, share?.matrixUserId);
              },
            }] : []),
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
          initialPassword={editChannelDialog.initialPassword}
          onClose={() => setEditChannelDialog(null)}
          onSave={(name, description, password) => {
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

      {aclEditorChannel && (
        <AclEditorDialog
          isOpen={true}
          channelId={aclEditorChannel.id}
          channelName={aclEditorChannel.name}
          availableUsers={users}
          isNativePasswordProtected={channels.find(c => c.id === aclEditorChannel.id)?.isEnterRestricted ?? false}
          onClose={() => setAclEditorChannel(null)}
        />
      )}
    </div>
  );
}
