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
  comment?: string;
  onSetComment: (comment: string) => void;
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

export function AvatarEditorModal({ isOpen, onClose, currentUser, comment, onSetComment, onUploadAvatar, onRemoveAvatar }: AvatarEditorModalProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(comment || '');
  const dialogRef = useRef<HTMLDivElement>(null);

  const statusText = getAvatarStatusText(currentUser);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setShowUpload(false);
      setEditingComment(false);
    }
    setCommentDraft(comment || '');
  }, [isOpen, comment]);

  // Escape key handling: upload > editing comment > close modal
  useEffect(() => {
    if (!isOpen || showUpload) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingComment) {
          setEditingComment(false);
          setCommentDraft(comment || '');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, showUpload, editingComment, comment]);

  // Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const card = dialogRef.current;
    if (!card) return;

    const focusableSelector = 'button, input, textarea, [tabindex]:not([tabindex="-1"])';

    const focusable = card.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    const handleTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = card.querySelectorAll<HTMLElement>(focusableSelector);
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
  }, [isOpen, showUpload, editingComment]);

  if (!isOpen) return null;

  const saveComment = () => {
    onSetComment(commentDraft);
    setEditingComment(false);
  };

  const cancelCommentEdit = () => {
    setEditingComment(false);
    setCommentDraft(comment || '');
  };

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
          <h2 id="avatar-editor-title" className="heading-title modal-title">Edit Profile</h2>
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

        <div className="avatar-editor-comment">
          <h4 className="heading-label">Comment</h4>
          {editingComment ? (
            <>
              <textarea
                className="avatar-editor-comment-textarea"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                rows={3}
                autoFocus
                aria-label="Comment"
              />
              <div className="avatar-editor-comment-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={cancelCommentEdit}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={saveComment}>
                  Save
                </button>
              </div>
            </>
          ) : (
            <div
              className="avatar-editor-comment-box"
              role="button"
              tabIndex={0}
              onClick={() => setEditingComment(true)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingComment(true); } }}
            >
              <span className={comment ? '' : 'avatar-editor-comment-placeholder'}>
                {comment || 'No comment set'}
              </span>
              <span className="avatar-editor-comment-edit-hint">Click to edit</span>
            </div>
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
