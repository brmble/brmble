import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
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
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleAction = useCallback((action: ToastAction) => {
    action.onClick();
    setVisible(false);
  }, []);

  return (
    <Notification
      status="info"
      position="bottom-center"
      visible={visible}
      duration={duration}
      onDismiss={handleDismiss}
      onExited={onDismiss}
      title={<span className="toast-title">{message}</span>}
      actions={actions ? (
        <>
          {actions.map((action, i) => (
            <button
              key={i}
              className={`btn btn-sm ${action.primary ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleAction(action)}
            >
              {action.label}
            </button>
          ))}
        </>
      ) : undefined}
    />
  );
}
