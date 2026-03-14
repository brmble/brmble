import { cloneElement } from 'react';
import { createPortal } from 'react-dom';
import { useTooltipPosition } from '../../hooks/useTooltipPosition';
import type { Position, Align } from '../../hooks/useTooltipPosition';
import Avatar from '../Avatar/Avatar';
import '../Tooltip/Tooltip.css';
import './UserTooltip.css';

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

interface UserTooltipUser {
  name: string;
  matrixUserId?: string;
  avatarUrl?: string;
  comment?: string;
  self?: boolean;
  muted?: boolean;
  deafened?: boolean;
}

interface UserTooltipProps {
  user: UserTooltipUser;
  children: React.ReactElement<AnyProps>;
  position?: Position;
  align?: Align;
  delay?: number;
}

function getStatusText(user: UserTooltipUser): string {
  const statuses: string[] = [];
  if (user.muted) statuses.push('Muted');
  if (user.deafened) statuses.push('Deafened');
  return statuses.length > 0 ? statuses.join(', ') : 'Online';
}

export function UserTooltip({ user, children, position = 'top', align = 'center', delay = 400 }: UserTooltipProps) {
  const { visible, show, hide, tooltipId, triggerRef, tooltipRef, portalStyle } = useTooltipPosition({ position, align, delay });

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
            <div className="user-tooltip">
              <Avatar
                user={{ name: user.name, matrixUserId: user.matrixUserId, avatarUrl: user.avatarUrl }}
                size={64}
                isMumbleOnly={!user.self && !user.matrixUserId}
              />
              <div className="user-tooltip-info">
                <span className="user-tooltip-name">{user.name}</span>
                <span className="user-tooltip-status">{getStatusText(user)}</span>
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
