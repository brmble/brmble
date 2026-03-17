import { cloneElement } from 'react';
import { createPortal } from 'react-dom';
import { useTooltipPosition } from '../../hooks/useTooltipPosition';
import type { Position, Align } from '../../hooks/useTooltipPosition';
import './Tooltip.css';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

interface TooltipProps {
  content: string;
  children: React.ReactElement<AnyProps>;
  position?: Position;
  align?: Align;
  delay?: number;
}

export function Tooltip({ content, children, position = 'top', align = 'center', delay = 400 }: TooltipProps) {
  const { visible, show, hide, tooltipId, triggerRef, tooltipRef, portalStyle } = useTooltipPosition({ position, align, delay });

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
        <div className="brmble-tooltip-portal" style={portalStyle}>
          <div className="brmble-tooltip" ref={tooltipRef} id={tooltipId} role="tooltip">
            {content}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
