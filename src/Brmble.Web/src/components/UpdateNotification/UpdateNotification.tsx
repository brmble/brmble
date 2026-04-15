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
      title={isApplying ? 'Updating...' : 'Update available'}
      detail={
        <span className="update-notification__detail">
          {isApplying ? `Installing v${version}` : `Press Update to install v${version}.`}
        </span>
      }
      actions={isApplying ? (
        <div className="update-notification__progress">
          <div className="update-notification__progress-bar" style={{ width: `${progress}%` }} />
        </div>
      ) : (
        <button className="btn btn-sm btn-primary" onClick={onUpdate}>Update</button>
      )}
    />
  );
}
