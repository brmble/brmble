import { useEffect, useState, useCallback } from 'react';
import './UpdateNotification.css';

interface UpdateNotificationProps {
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
  progress: number | null;
}

export function UpdateNotification({ version, onUpdate, onDismiss, progress }: UpdateNotificationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  const isApplying = progress !== null;

  return (
    <div className={`update-notification ${visible ? 'update-notification--visible' : ''}`} role="status" aria-live="polite">
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
    </div>
  );
}
