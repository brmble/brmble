import { useState, useEffect } from 'react';
import './EditChannelDialog.css';

interface EditChannelDialogProps {
  isOpen: boolean;
  initialName: string;
  initialDescription?: string;
  onClose: () => void;
  onSave: (name: string, description: string) => void;
  onError?: (message: string) => void;
}

export function EditChannelDialog({
  isOpen,
  initialName,
  initialDescription = '',
  onClose,
  onSave,
}: EditChannelDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, description);
  };

  const hasChanges = name !== initialName || description !== initialDescription;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="edit-channel-dialog glass-panel animate-slide-up"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-header">
          <h2 className="heading-title modal-title">Edit Channel</h2>
        </div>

        <form onSubmit={handleSubmit} className="edit-channel-form">
          <div className="form-group">
            <label htmlFor="channel-name">Name</label>
            <input
              id="channel-name"
              className="brmble-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="channel-description">Description</label>
            <textarea
              id="channel-description"
              className="brmble-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-group password-placeholder">
            <label>Password</label>
            <div className="password-coming-soon">
              <span className="coming-soon-text">Coming soon</span>
              <p className="coming-soon-note">Channel passwords require ACL support (see issue #421)</p>
            </div>
          </div>

          <div className="edit-channel-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!hasChanges || !name.trim()}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
