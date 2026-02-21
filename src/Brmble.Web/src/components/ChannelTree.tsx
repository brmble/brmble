import { useState, useMemo, useCallback, useEffect } from 'react';
import { ContextMenu } from './ContextMenu/ContextMenu';
import './ChannelTree.css';

interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
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
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, onSelectChannel, onStartDM, speakingUsers, pendingChannelAction }: ChannelTreeProps) {
  const [sortByNamePerChannel, setSortByNamePerChannel] = useState<Record<number, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string; isSelf: boolean } | null>(null);
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
    const hasChildren = channel.children.length > 0 || channel.users.length > 0;
    const isExpanded = expandedChannels.has(channel.id);
    const isCurrentChannel = currentChannelId === channel.id;

    return (
      <div key={channel.id} className={`channel-item${pendingChannelAction !== null ? ' channel-item--pending' : ''}`} data-level={level}>
        <div 
          className={`channel-row ${isCurrentChannel ? 'current' : ''}`}
          onClick={() => handleChannelClick(channel.id)}
          onDoubleClick={pendingChannelAction === null ? () => onJoinChannel(channel.id) : undefined}
        >
          <span 
            className={`expand-icon ${isExpanded ? 'expanded' : ''} ${!hasChildren ? 'placeholder' : ''}`}
            onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpand(channel.id); }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2L7 5L3 8V2Z" />
            </svg>
          </span>
          <span className="channel-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <span className="channel-name">{channel.name}</span>
          {channel.users.length > 0 && (
            <>
              <button
                className="channel-sort-btn"
                onClick={(e) => toggleSort(channel.id, e)}
                title={(sortByNamePerChannel[channel.id] ?? false) ? 'Sort by join order' : 'Sort alphabetically'}
              >
                {(sortByNamePerChannel[channel.id] ?? false) ? 'A-Z' : '↺'}
              </button>
              <span className="user-count">({channel.users.length})</span>
            </>
          )}
        </div>
        
        {isExpanded && (
          <div className="channel-children">
            {channel.users.map(user => (
              <div 
                key={user.session} 
                className={`user-row ${user.self ? 'self' : ''} ${speakingUsers?.has(user.session) ? 'speaking' : ''}`}
                title={getUserTooltip(user)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self });
                }}
              >
                <span className="user-status">
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
                <span className="user-name">{user.name}</span>
                {user.self && <span className="self-badge">(you)</span>}
              </div>
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
    </div>
  );
}

function getUserTooltip(user: User): string {
  const statuses: string[] = [];
  if (user.muted) statuses.push('Muted');
  if (user.deafened) statuses.push('Deafened');
  return statuses.length > 0 ? statuses.join(', ') : 'Online';
}
