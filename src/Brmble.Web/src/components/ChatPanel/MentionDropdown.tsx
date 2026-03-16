import { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { MentionableUser } from '../../types';
import Avatar from '../Avatar/Avatar';
import './MentionDropdown.css';

interface MentionDropdownProps {
  query: string;
  users: MentionableUser[];
  activeIndex: number;
  anchorRect: DOMRect | null;
  onSelect: (user: MentionableUser) => void;
  onActiveIndexChange: (index: number) => void;
  listboxId?: string;
}

export function MentionDropdown({
  query,
  users,
  activeIndex,
  anchorRect,
  onSelect,
  onActiveIndexChange,
  listboxId,
}: MentionDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const matches = users.filter(u =>
      u.displayName.toLowerCase().startsWith(q)
    );
    // Online users first, then offline, alphabetical within each group
    matches.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return matches;
  }, [query, users]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector('.mention-dropdown-item--active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  // Clamp active index when filtered list changes
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onActiveIndexChange(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex, onActiveIndexChange]);

  if (!anchorRect || filtered.length === 0) return null;

  // Position above the anchor
  const style: React.CSSProperties = {
    left: anchorRect.left,
    bottom: window.innerHeight - anchorRect.top + 4,
  };

  return createPortal(
    <div className="mention-dropdown" style={style} ref={listRef} role="listbox" id={listboxId}>
      {filtered.map((user, i) => (
        <button
          key={user.displayName}
          id={listboxId ? `${listboxId}-option-${i}` : undefined}
          className={`mention-dropdown-item${i === activeIndex ? ' mention-dropdown-item--active' : ''}${!user.isOnline ? ' mention-dropdown-item--offline' : ''}`}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(user);
          }}
          onMouseEnter={() => onActiveIndexChange(i)}
        >
          <Avatar
            user={{ name: user.displayName, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }}
            size={20}
            isMumbleOnly={!user.matrixUserId}
          />
          <span className="mention-dropdown-name">{user.displayName}</span>
          {!user.isOnline && <span className="mention-dropdown-status">offline</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
