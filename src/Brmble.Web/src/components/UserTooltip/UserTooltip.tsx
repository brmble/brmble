import { useState, useRef, useCallback, useEffect, useId, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import Avatar from '../Avatar/Avatar';
import './UserTooltip.css';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

type Position = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

interface UserTooltipUser {
  name: string;
  matrixUserId?: string;
  avatarUrl?: string;
  comment?: string;
  self?: boolean;
}

interface UserTooltipProps {
  user: UserTooltipUser;
  children: React.ReactElement<AnyProps>;
  position?: Position;
  align?: Align;
  delay?: number;
}

/** Static transform maps — hoisted to module scope to avoid re-creation every render. */
const transformMap: Record<string, Record<string, string>> = {
  top:    { start: 'translateY(-100%)',        center: 'translateX(-50%) translateY(-100%)', end: 'translateX(-100%) translateY(-100%)' },
  bottom: { start: '',                         center: 'translateX(-50%)',                   end: 'translateX(-100%)' },
  left:   { start: 'translateX(-100%)',        center: 'translateX(-100%) translateY(-50%)', end: 'translateX(-100%) translateY(-100%)' },
  right:  { start: '',                         center: 'translateY(-50%)',                   end: 'translateY(-100%)' },
};

export function UserTooltip({ user, children, position = 'top', align = 'center', delay = 400 }: UserTooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [effectivePosition, setEffectivePosition] = useState<Position>(position);
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    // Clear any existing show timer before scheduling a new one.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Dismiss tooltip on Escape key
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, hide]);

  // Reset effective position when preferred position changes or tooltip hides
  useEffect(() => {
    setEffectivePosition(position);
  }, [position, visible]);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const bottomGap = 14; /* extra clearance to avoid cursor overlap */

    let top = 0;
    let left = 0;

    /* Horizontal anchor point based on align (for top/bottom positions) */
    const anchorLeft =
      align === 'start'  ? rect.left :
      align === 'end'    ? rect.right :
      rect.left + rect.width / 2;

    /* Vertical anchor point based on align (for left/right positions) */
    const anchorTop =
      align === 'start'  ? rect.top :
      align === 'end'    ? rect.bottom :
      rect.top + rect.height / 2;

    switch (position) {
      case 'top':
        top = rect.top - gap;
        left = anchorLeft;
        break;
      case 'bottom':
        top = rect.bottom + bottomGap;
        left = anchorLeft;
        break;
      case 'left':
        top = anchorTop;
        left = rect.left - gap;
        break;
      case 'right':
        top = anchorTop;
        left = rect.right + gap;
        break;
    }

    setCoords({ top, left });

    const rafId = requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const tt = tooltipRef.current.getBoundingClientRect();
      let adjustedTop = top;
      let adjustedLeft = left;
      let flippedPosition: Position | null = null;

      /* Horizontal overflow clamping for top/bottom */
      if (position === 'top' || position === 'bottom') {
        if (align === 'center') {
          adjustedLeft = Math.max(8 + tt.width / 2, Math.min(adjustedLeft, window.innerWidth - tt.width / 2 - 8));
        } else if (align === 'start' && tt.right > window.innerWidth - 8) {
          adjustedLeft = window.innerWidth - tt.width - 8;
        } else if (align === 'end' && tt.left < 8) {
          adjustedLeft = tt.width + 8;
        }
      }

      /* Vertical flip if overflowing — also update effective position for transform */
      if (position === 'top' && tt.top < 0) {
        adjustedTop = rect.bottom + bottomGap;
        flippedPosition = 'bottom';
      } else if (position === 'bottom' && tt.bottom > window.innerHeight) {
        adjustedTop = rect.top - gap;
        flippedPosition = 'top';
      }

      if (adjustedTop !== top || adjustedLeft !== left) {
        setCoords({ top: adjustedTop, left: adjustedLeft });
      }
      if (flippedPosition) {
        setEffectivePosition(flippedPosition);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [visible, position, align]);

  return (
    <>
      {cloneElement(children, {
        ref: triggerRef,
        'aria-describedby': visible ? tooltipId : undefined,
        onMouseEnter: (e: React.MouseEvent) => {
          show();
          children.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
          hide();
          children.props.onMouseLeave?.(e);
        },
        onFocus: (e: React.FocusEvent) => {
          show();
          children.props.onFocus?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
          hide();
          children.props.onBlur?.(e);
        },
      })}
      {visible && createPortal(
        <div
          className="brmble-tooltip-portal"
          style={{
            top: coords.top,
            left: coords.left,
            transform: transformMap[effectivePosition][align],
          }}
        >
          <div className="brmble-tooltip" ref={tooltipRef} id={tooltipId} role="tooltip">
            <div className="user-tooltip">
              <Avatar
                user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }}
                size={64}
                isMumbleOnly={!user.self && !user.matrixUserId}
              />
              <div className="user-tooltip-info">
                <span className="user-tooltip-name">{user.name}</span>
                {user.comment && (
                  <span className="user-tooltip-comment">{user.comment}</span>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
