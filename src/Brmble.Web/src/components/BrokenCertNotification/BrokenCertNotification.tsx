import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './BrokenCertNotification.css';

interface BrokenCertNotificationProps {
  profile: { id: string; name: string };
  switchedTo: { id: string; name: string } | null;
  onImport: (profileId: string) => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export function BrokenCertNotification({
  profile,
  switchedTo,
  onImport,
  onOpenSettings,
  onDismiss,
}: BrokenCertNotificationProps) {
  const [visible, setVisible] = useState(true);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <Notification
      status="warning"
      position="top-right"
      visible={visible}
      duration={null}
      onDismiss={handleDismiss}
      onExited={onDismiss}
    >
      <div>
        <p className="broken-cert-notification__message">
          Profile <strong>"{profile.name}"</strong> has no certificate file.
          {switchedTo && (
            <> Switched to <strong>"{switchedTo.name}"</strong>.</>
          )}
        </p>
        <div className="broken-cert-notification__actions">
          <button className="btn btn-sm btn-ghost" onClick={handleDismiss}>
            Dismiss
          </button>
          <button className="btn btn-sm btn-secondary" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => onImport(profile.id)}>
            Import
          </button>
        </div>
      </div>
    </Notification>
  );
}
