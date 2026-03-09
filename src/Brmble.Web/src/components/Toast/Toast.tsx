import { useEffect, useState, useCallback } from 'react';
import './Toast.css';

interface ToastAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

interface ToastProps {
  message: string;
  actions?: ToastAction[];
  duration?: number;
  onDismiss: () => void;
}

export function Toast({ message, actions, duration = 8000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  const handleAction = useCallback((action: ToastAction) => {
    action.onClick();
    setVisible(false);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  return (
    <div className={`toast ${visible ? 'toast--visible' : ''}`}>
      <span className="toast-message">{message}</span>
      {actions && (
        <div className="toast-actions">
          {actions.map((action, i) => (
            <button
              key={i}
              className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
