import { useState, useMemo, useCallback } from 'react';
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
  sortByName: boolean;
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, sortByName }: ChannelTreeProps) {
  const [expandedChannels, setExpandedChannels] = useState<Set<number>>(new Set());

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

  const buildTree = useCallback((): ChannelWithUsers[] => {
    const channelMap = new Map<number, ChannelWithUsers>();
    const roots: ChannelWithUsers[] = [];

    channels.forEach(ch => {
      channelMap.set(ch.id, { ...ch, users: [], children: [] });
    });

    users.forEach(user => {
      if (user.channelId && channelMap.has(user.channelId)) {
        channelMap.get(user.channelId)!.users.push(user);
      }
    });

    channelMap.forEach(ch => {
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

    return roots;
  }, [channels, users, sortByName]);

  const tree = useMemo(() => buildTree(), [buildTree]);

  const renderChannel = (channel: ChannelWithUsers, level: number = 0) => {
    const hasChildren = channel.children.length > 0 || channel.users.length > 0;
    const isExpanded = expandedChannels.has(channel.id);
    const isCurrentChannel = currentChannelId === channel.id;

    return (
      <div key={channel.id} className="channel-item channel-item--level" data-level={level}>
        <div 
          className={`channel-row ${isCurrentChannel ? 'current' : ''}`}
          onClick={() => hasChildren && toggleExpand(channel.id)}
          onDoubleClick={() => onJoinChannel(channel.id)}
        >
          {hasChildren && (
            <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
          )}
          {!hasChildren && <span className="expand-icon placeholder">▶</span>}
          <span className="channel-icon">📁</span>
          <span className="channel-name">{channel.name}</span>
          {channel.users.length > 0 && (
            <span className="user-count">({channel.users.length})</span>
          )}
        </div>
        
        {isExpanded && (
          <div className="channel-children">
            {channel.users.map(user => (
              <div 
                key={user.session} 
                className={`user-row ${user.self ? 'self' : ''} user-row--level`}
                data-level={level + 1}
                title={getUserTooltip(user)}
              >
                <span className="user-status">
                  {user.deafened ? '🔇❌' : user.muted ? '🔇' : '🔊'}
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
    </div>
  );
}

function getUserTooltip(user: User): string {
  const statuses: string[] = [];
  if (user.muted) statuses.push('Muted');
  if (user.deafened) statuses.push('Deafened');
  return statuses.length > 0 ? statuses.join(', ') : 'Online';
}
