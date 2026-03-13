import { useState } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import './ProfileSettingsTab.css';

interface ProfileSettingsTabProps {
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
}

function getAvatarStatusText(user: ProfileSettingsTabProps['currentUser']): string {
  if (!user.avatarUrl) return 'Default';
  // If the avatar URL is a Matrix mxc:// URL or HTTP URL from Matrix, it's uploaded
  // If it came from Mumble (typically a data: URL or blob), label it as such
  if (user.avatarUrl.startsWith('mxc://') || user.avatarUrl.includes('/_matrix/')) {
    return 'Uploaded';
  }
  return 'From Mumble';
}

export function ProfileSettingsTab({ currentUser, onUploadAvatar, onRemoveAvatar }: ProfileSettingsTabProps) {
  const [showUpload, setShowUpload] = useState(false);

  const statusText = getAvatarStatusText(currentUser);

  return (
    <div className="profile-settings-tab">
      <div className="settings-section">
        <h3 className="heading-section settings-section-title">Avatar</h3>
        <div className="profile-avatar-section">
          <Avatar user={currentUser} size={80} />
          <div className="profile-avatar-info">
            <span className="profile-display-name">{currentUser.name}</span>
            <span className="profile-avatar-status">{statusText}</span>
            <div className="profile-avatar-actions">
              <button className="btn btn-primary" onClick={() => setShowUpload(true)}>Upload</button>
              {currentUser.avatarUrl && (
                <button className="btn btn-secondary" onClick={onRemoveAvatar}>Remove</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showUpload && (
        <AvatarUpload
          onUpload={(blob, contentType) => {
            onUploadAvatar(blob, contentType);
            setShowUpload(false);
          }}
          onCancel={() => setShowUpload(false)}
        />
      )}
    </div>
  );
}
