import { useState, useCallback } from 'react';
import { Notification } from '../Notification/Notification';
import './BrokenCertNotification.css';

interface BrokenCertNotificationProps {
  profile: { id: string; name: string };
  onImport: (profileId: string) => void;
  onOpenSettings: () => void;
  onDismiss?: () => void;
}

export function BrokenCertNotification({
  profile,
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
      title={<>Certificate missing from "<strong>{profile.name}</strong>"</>}
      detail="Choose Import to recover it, or delete the profile in Settings."
      actions={
        <>
          <button className="btn btn-sm btn-secondary" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => onImport(profile.id)}>
            Import
          </button>
        </>
      }
    />
  );
}
