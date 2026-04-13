import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './BrokenCertNotification.css';

interface BrokenCertNotificationProps {
  brokenProfile: { id: string; name: string };
  switchedTo: { id: string; name: string } | null;
  onImport: () => void;
  onOpenSettings: () => void;
  onDismiss?: () => void;
}

export function BrokenCertNotification({
  brokenProfile,
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
      onDismiss={onDismiss ? handleDismiss : undefined}
      onExited={onDismiss}
    >
      <div>
        <p className="broken-cert-notification__message">
          {switchedTo ? (
            <>
              Profile <strong>"{brokenProfile.name}"</strong> has no certificate file.
              Switched to <strong>"{switchedTo.name}"</strong>.
            </>
          ) : (
            <>
              Profile <strong>"{brokenProfile.name}"</strong> has no certificate.
              Import a certificate or create a new profile to connect.
            </>
          )}
        </p>
        <div className="broken-cert-notification__actions">
          {onDismiss && (
            <button className="btn btn-sm btn-ghost" onClick={handleDismiss}>
              Dismiss
            </button>
          )}
          <button className="btn btn-sm btn-secondary" onClick={onOpenSettings}>
            Open Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={onImport}>
            Import Certificate
          </button>
        </div>
      </div>
    </Notification>
  );
}
