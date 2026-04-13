import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
  progress: number | null;
}

export function UpdateNotification({ version, onUpdate, onDismiss, progress }: UpdateNotificationProps) {
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const isApplying = progress !== null;

  return (
    <Notification
      status="info"
      position="top-right"
      visible={visible}
      duration={null}
      onDismiss={isApplying ? undefined : handleDismiss}
      onExited={onDismiss}
    >
      {isApplying ? (
        <>
          <span className="update-notification__message">Updating to v{version}...</span>
          <div className="update-notification__progress">
            <div className="update-notification__progress-bar" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <>
          <span className="update-notification__message">Update available: v{version}</span>
          <div className="update-notification__actions">
            <button className="btn btn-sm btn-ghost" onClick={handleDismiss}>Later</button>
            <button className="btn btn-sm btn-primary" onClick={onUpdate}>Update</button>
          </div>
        </>
      )}
    </Notification>
  );
}
