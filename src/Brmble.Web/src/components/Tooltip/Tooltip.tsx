import { useState, useRef, useCallback, useEffect, useId, cloneElement } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

interface TooltipProps {
  content: string;
  children: React.ReactElement<AnyProps>;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

/** Static transform map — hoisted to module scope to avoid re-creation every render. */
const transformOrigin: Record<string, string> = {
  top: 'translateX(-50%) translateY(-100%)',
  bottom: 'translateX(-50%)',
  left: 'translateX(-100%) translateY(-50%)',
  right: 'translateY(-50%)',
};

export function Tooltip({ content, children, position = 'top', delay = 400 }: TooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
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

  useEffect(() => {
    if (!visible || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (position) {
      case 'top':
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
    }

    setCoords({ top, left });

    const rafId = requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const tt = tooltipRef.current.getBoundingClientRect();
      let adjustedTop = top;
      let adjustedLeft = left;

      if (position === 'top' || position === 'bottom') {
        adjustedLeft = Math.max(8, Math.min(adjustedLeft, window.innerWidth - tt.width / 2 - 8));
      }
      if (position === 'top' && tt.top < 0) {
        adjustedTop = rect.bottom + gap;
      } else if (position === 'bottom' && tt.bottom > window.innerHeight) {
        adjustedTop = rect.top - gap;
      }

      if (adjustedTop !== top || adjustedLeft !== left) {
        setCoords({ top: adjustedTop, left: adjustedLeft });
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [visible, position]);

  if (!content) return children;

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
            transform: transformOrigin[position],
          }}
        >
          <div className="brmble-tooltip" ref={tooltipRef} id={tooltipId} role="tooltip">
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
