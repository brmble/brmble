import { useState, useEffect, useRef } from 'react';
import Avatar from '../Avatar/Avatar';
import AvatarUpload from '../AvatarUpload/AvatarUpload';
import './AvatarEditorModal.css';

interface AvatarEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    name: string;
    matrixUserId?: string;
    avatarUrl?: string;
  };
  onUploadAvatar: (blob: Blob, contentType: string) => void;
  onRemoveAvatar: () => void;
}

function getAvatarStatusText(user: AvatarEditorModalProps['currentUser']): string {
  if (!user.avatarUrl) return 'Default';
  if (user.avatarUrl.startsWith('mxc://') || user.avatarUrl.includes('/_matrix/')) {
    return 'Uploaded';
  }
  return 'From Mumble';
}

export function AvatarEditorModal({ isOpen, onClose, currentUser, onUploadAvatar, onRemoveAvatar }: AvatarEditorModalProps) {
  const [showUpload, setShowUpload] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const statusText = getAvatarStatusText(currentUser);

  // Reset upload view when modal opens/closes
  useEffect(() => {
    if (!isOpen) setShowUpload(false);
  }, [isOpen]);

  // Escape key to close (AvatarUpload manages its own Escape when active)
  useEffect(() => {
    if (!isOpen || showUpload) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, showUpload]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const card = dialogRef.current;
    if (!card) return;

    const focusable = card.querySelectorAll<HTMLElement>(
      'button, input, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = card.querySelectorAll<HTMLElement>(
        'button, input, [tabindex]:not([tabindex="-1"])'
      );
      if (current.length === 0) return;
      const f = current[0];
      const l = current[current.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTrap);
    return () => window.removeEventListener('keydown', handleTrap);
  }, [isOpen, showUpload]);

  if (!isOpen) return null;

  // When upload cropper is active, render AvatarUpload instead
  if (showUpload) {
    return (
      <AvatarUpload
        onUpload={(blob, contentType) => {
          onUploadAvatar(blob, contentType);
          setShowUpload(false);
          onClose();
        }}
        onCancel={() => setShowUpload(false)}
      />
    );
  }

  return (
    <div className="avatar-editor-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="avatar-editor glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="avatar-editor-title" className="heading-title modal-title">Edit Avatar</h2>
        </div>

        <div className="avatar-editor-preview">
          <Avatar user={currentUser} size={120} />
          <span className="avatar-editor-name">{currentUser.name}</span>
          <span className="avatar-editor-status">{statusText}</span>
        </div>

        <div className="avatar-editor-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShowUpload(true)}>
            Upload
          </button>
          {currentUser.avatarUrl && (
            <button type="button" className="btn btn-secondary" onClick={() => { onRemoveAvatar(); }}>
              Remove
            </button>
          )}
        </div>

        <div className="avatar-editor-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
