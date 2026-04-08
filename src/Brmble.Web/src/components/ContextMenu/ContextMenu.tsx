import { useEffect, useMemo, useRef, useState } from 'react';
import './ContextMenu.css';

const MOUSE_LEAVE_CLOSE_DELAY = 400;

type ContextMenuItem =
  | { type: 'divider' }
  | { type: 'item'; label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; children?: ContextMenuItem[] }
  | { type: 'checkbox'; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }
  | { type: 'slider'; label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean };

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
    if (!submenuRef.current) return;
    
    const rect = submenuRef.current.getBoundingClientRect();
    const offRight = rect.right > window.innerWidth - 8;
    const offBottom = rect.bottom > window.innerHeight - 8;
    
    submenuRef.current.classList.toggle('context-submenu--off-right', offRight);
    submenuRef.current.classList.toggle('context-submenu--off-bottom', offBottom);
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

function CheckboxMenuItem({ item }: { item: { type: 'checkbox'; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean } }) {
  const isDisabled = item.disabled;

  return (
    <div className="context-menu-item-wrapper">
      <div
        className={`context-menu-item context-menu-checkbox${isDisabled ? ' context-menu-item--disabled' : ''}`}
        role="menuitemcheckbox"
        aria-checked={item.checked}
        aria-disabled={isDisabled}
        tabIndex={isDisabled ? -1 : 0}
        onClick={() => {
          if (isDisabled) return;
          item.onChange(!item.checked);
        }}
        onKeyDown={(e) => {
          if (isDisabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            item.onChange(!item.checked);
          }
        }}
      >
        <span className="context-menu-label">{item.label}</span>
        <span aria-hidden="true">{item.checked ? '☑' : '☐'}</span>
      </div>
    </div>
  );
}

function SliderMenuItem({ item }: { item: { type: 'slider'; label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean } }) {
  const isDisabled = item.disabled;

  return (
    <div className={`context-menu-item-wrapper context-menu-slider${isDisabled ? ' context-menu-item--disabled' : ''}`}>
      <div className="context-menu-slider-label">
        <span className="context-menu-label">{item.label}</span>
      </div>
      <input
        type="range"
        className="context-menu-slider-input"
        min={item.min}
        max={item.max}
        value={item.value}
        onChange={(e) => item.onChange(parseInt(e.target.value, 10))}
        disabled={isDisabled}
        aria-label={item.label}
      />
    </div>
  );
}

function MenuItem({ item, depth, onItemClick }: MenuItemProps) {
  if (isDivider(item)) {
    return (
      <div className="context-menu-divider" role="separator" aria-orientation="horizontal" />
    );
  }

  if (item.type === 'checkbox') {
    return <CheckboxMenuItem item={item} />;
  }

  if (item.type === 'slider') {
    return <SliderMenuItem item={item} />;
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

  const spaceCalculations = useMemo(() => ({
    x,
    y,
    spaceBelow: window.innerHeight - y - 8,
    spaceRight: window.innerWidth - x - 8,
    spaceAbove: y - 8,
    spaceLeft: x - 8,
  }), [x, y]);

  useEffect(() => {
    if (!menuRef.current) return;
    
    requestAnimationFrame(() => {
      if (!menuRef.current) return;
      const rect = menuRef.current.getBoundingClientRect();
      const menuWidth = rect.width;
      const menuHeight = rect.height;
      const { spaceBelow, spaceRight, spaceAbove, spaceLeft } = spaceCalculations;
      
      let finalX: number = x;
      let finalY: number = y;
      
      if (menuHeight > spaceBelow && menuHeight <= spaceAbove) {
        finalY = y - menuHeight;
      } else if (menuHeight > spaceBelow && menuHeight > spaceAbove) {
        finalY = Math.max(8, window.innerHeight - menuHeight - 8);
      }
      
      if (menuWidth > spaceRight && menuWidth <= spaceLeft) {
        finalX = x - menuWidth;
      } else if (menuWidth > spaceRight && menuWidth > spaceLeft) {
        finalX = Math.max(8, window.innerWidth - menuWidth - 8);
      }
      
      menuRef.current.style.left = `${finalX}px`;
      menuRef.current.style.top = `${finalY}px`;
      menuRef.current.style.visibility = 'visible';
    });
  }, [x, y, spaceCalculations]);

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
    // Don't close on checkbox or slider interactions — let user continue adjusting
    if (item.type === 'item' || item.type === 'divider') {
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="context-menu"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {items.map((item, i) => (
        <MenuItem key={i} item={item} depth={1} onItemClick={handleItemClick} />
      ))}
    </div>
  );
}
