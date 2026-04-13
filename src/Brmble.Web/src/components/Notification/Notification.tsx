import { useEffect, useState, useCallback, useRef } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import './Notification.css';

export type NotificationStatus = 'info' | 'success' | 'warning' | 'error';

interface NotificationProps {
  status: NotificationStatus;
  position: 'top-right' | 'bottom-center';
  children: React.ReactNode;
  visible: boolean;
  duration?: number | null;
  onDismiss?: () => void;
  onExited?: () => void;
  pauseOnHover?: boolean;
  className?: string;
}

const STATUS_ICONS: Record<NotificationStatus, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  error: 'alert-circle',
};

const STATUS_ROLES: Record<NotificationStatus, string> = {
  info: 'status',
  success: 'status',
  warning: 'status',
  error: 'alert',
};

const STATUS_LIVE: Record<NotificationStatus, 'polite' | 'assertive'> = {
  info: 'polite',
  success: 'polite',
  warning: 'polite',
  error: 'assertive',
};

const DEFAULT_DURATIONS: Record<NotificationStatus, number | null> = {
  info: 5000,
  success: 5000,
  warning: null,
  error: null,
};

export function Notification({
  status,
  position,
  children,
  visible,
  duration,
  onDismiss,
  onExited,
  pauseOnHover = true,
  className,
}: NotificationProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveDuration = duration !== undefined ? duration : DEFAULT_DURATIONS[status];

  // Enter animation
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
      exitTimerRef.current = setTimeout(() => onExited?.(), 250);
    }
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [visible, onExited]);

  // Auto-dismiss timer
  const startTimer = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingRef.current = ms;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss?.();
    }, ms);
  }, [onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current && startTimeRef.current !== null && remainingRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const elapsed = Date.now() - startTimeRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (remainingRef.current !== null && remainingRef.current > 0 && !timerRef.current) {
      startTimer(remainingRef.current);
    }
  }, [startTimer]);

  useEffect(() => {
    if (visible && effectiveDuration !== null && effectiveDuration > 0) {
      startTimer(effectiveDuration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, effectiveDuration, startTimer]);

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover && effectiveDuration !== null) pauseTimer();
  }, [pauseOnHover, effectiveDuration, pauseTimer]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover && effectiveDuration !== null) resumeTimer();
  }, [pauseOnHover, effectiveDuration, resumeTimer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onDismiss) {
      onDismiss();
    }
  }, [onDismiss]);

  const classNames = [
    'notification',
    `notification--${status}`,
    `notification--${position}`,
    isVisible ? 'notification--visible' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      role={STATUS_ROLES[status]}
      aria-live={STATUS_LIVE[status]}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
    >
      <div className="notification__icon">
        <Icon name={STATUS_ICONS[status]} size={18} />
      </div>
      <div className="notification__content">
        {children}
      </div>
      {onDismiss && (
        <button
          className="notification__close"
          onClick={onDismiss}
          aria-label="Dismiss notification"
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
