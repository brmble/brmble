import { useEffect, useRef } from 'react';
import './ContextMenu.css';

const MOUSE_LEAVE_CLOSE_DELAY = 400;

interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
  children?: ContextMenuItem[];
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

function Submenu({ item, depth, onItemClick }: { item: ContextMenuItem; depth: number; onItemClick: (item: ContextMenuItem) => void }) {
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
      {item.children!.map((child, index) => (
        <MenuItem key={index} item={child} depth={depth} onItemClick={onItemClick} />
      ))}
    </div>
  );
}

function MenuItem({ item, depth, onItemClick }: MenuItemProps) {
  const hasChildren = item.children && item.children.length > 0;
  const isDisabled = item.disabled;

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
        disabled={isDisabled}
        aria-haspopup={hasChildren ? 'true' : undefined}
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
      const maxX = window.innerWidth - rect.width - 8;
      const maxY = window.innerHeight - rect.height - 8;
      if (x > maxX) menuRef.current.style.left = `${maxX}px`;
      if (y > maxY) menuRef.current.style.top = `${maxY}px`;
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
    if (item.onClick) item.onClick();
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
