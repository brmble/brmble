import { useState } from 'react';
import './RenameConfirmDialog.css';

interface RenameConfirmDialogProps {
  isOpen: boolean;
  oldName: string;
  newName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function RenameConfirmDialog({
  isOpen,
  oldName,
  newName,
  onClose,
  onConfirm,
}: RenameConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText.trim().toLowerCase() === 'change') {
      onConfirm();
    }
  };

  const isValid = confirmText.trim().toLowerCase() === 'change';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="rename-confirm-dialog glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="heading-title modal-title">Confirm Channel Rename</h2>
          <p className="modal-subtitle">
            Renaming "{oldName}" to "{newName}" will update the channel name for all users.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rename-confirm-form">
          <div className="form-group">
            <label htmlFor="confirm-rename">Type "change" to confirm</label>
            <input
              id="confirm-rename"
              className="brmble-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="change"
              autoFocus
            />
          </div>

          <div className="rename-confirm-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!isValid}>
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
