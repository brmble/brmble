import { useEffect, useRef, useState } from 'react';
import './ContextMenu.css';

const MOUSE_LEAVE_CLOSE_DELAY = 400;

type ContextMenuItem =
  | { type: 'divider' }
  | { type: 'item'; label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; children?: ContextMenuItem[] };

function isDivider(item: ContextMenuItem): item is { type: 'divider' } {
  return item.type === 'divider';
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  mouseLeaveDelay?: number;
}

export type { ContextMenuItem };

interface MenuItemProps {
  item: ContextMenuItem;
  depth: number;
  onItemClick: (item: ContextMenuItem) => void;
}

function Submenu({ item, depth, onItemClick }: { item: { type: 'item'; children?: ContextMenuItem[] }; depth: number; onItemClick: (item: ContextMenuItem) => void }) {
  const submenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (submenuRef.current) {
      const rect = submenuRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        submenuRef.current.classList.add('context-submenu--off-right');
      }
    }
  }, []);

  return (
    <div ref={submenuRef} className={`context-submenu context-submenu--depth-${depth}`}>
      {item.children?.map((child: ContextMenuItem, index: number) => (
        <MenuItem key={index} item={child} depth={depth} onItemClick={onItemClick} />
      ))}
    </div>
  );
}

function isMenuItem(item: ContextMenuItem): item is { type: 'item'; label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; children?: ContextMenuItem[] } {
  return item.type === 'item';
}

function MenuItem({ item, depth, onItemClick }: MenuItemProps) {
  if (isDivider(item)) {
    return (
      <div className="context-menu-divider" role="separator" aria-orientation="horizontal" />
    );
  }

  if (!isMenuItem(item)) {
    return null;
  }

  const hasChildren = item.children && item.children.length > 0;
  const isDisabled = item.disabled;
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="context-menu-item-wrapper">
      <button
        className={`context-menu-item${hasChildren ? ' context-menu-item--has-children' : ''}${isDisabled ? ' context-menu-item--disabled' : ''}`}
        onClick={(e) => {
          if (isDisabled) return;
          if (hasChildren) {
            e.stopPropagation();
            return;
          }
          onItemClick(item);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        disabled={isDisabled}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? isFocused : undefined}
      >
        {item.icon && <span className="context-menu-icon">{item.icon}</span>}
        <span className="context-menu-label">{item.label}</span>
      </button>
      {hasChildren && !isDisabled && (
        <Submenu item={item} depth={depth + 1} onItemClick={onItemClick} />
      )}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose, mouseLeaveDelay = MOUSE_LEAVE_CLOSE_DELAY }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const menuWidth = rect.width;
      const menuHeight = rect.height;
      
      const spaceBelow = window.innerHeight - y - 8;
      const spaceRight = window.innerWidth - x - 8;
      const spaceAbove = y - 8;
      const spaceLeft = x - 8;
      
      let finalX = x;
      let finalY = y;
      
      if (menuHeight > spaceBelow && menuHeight <= spaceAbove) {
        finalY = y - menuHeight;
      } else if (menuHeight > spaceBelow && menuHeight > spaceAbove) {
        finalY = Math.max(8, spaceAbove);
      }
      
      if (menuWidth > spaceRight && menuWidth <= spaceLeft) {
        finalX = x - menuWidth;
      } else if (menuWidth > spaceRight && menuWidth > spaceLeft) {
        finalX = Math.max(8, spaceLeft);
      }
      
      menuRef.current.style.left = `${finalX}px`;
      menuRef.current.style.top = `${finalY}px`;
    }
  }, [x, y]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const isTopLevel = (e.target as HTMLElement).closest('.context-menu') === menuRef.current;
    if (isTopLevel && leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const isLeavingMenu = !menuRef.current?.contains(relatedTarget);
    if (isLeavingMenu) {
      leaveTimerRef.current = setTimeout(() => {
        onClose();
      }, mouseLeaveDelay);
    }
  };

  const handleItemClick = (item: ContextMenuItem) => {
    if (isMenuItem(item) && item.onClick) {
      item.onClick();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: x, top: y }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {items.map((item, i) => (
        <MenuItem key={i} item={item} depth={1} onItemClick={handleItemClick} />
      ))}
    </div>
  );
}
