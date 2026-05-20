import { useState, useEffect } from 'react';
import { Icon } from '../Icon/Icon';
import './EditChannelDialog.css';

interface EditChannelDialogProps {
  isOpen: boolean;
  initialName: string;
  initialDescription?: string;
  initialPassword?: string;
  onClose: () => void;
  onSave: (name: string, description: string, password: string) => void;
  onError?: (message: string) => void;
}

export function EditChannelDialog({
  isOpen,
  initialName,
  initialDescription = '',
  initialPassword = '',
  onClose,
  onSave,
}: EditChannelDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
  }, [initialName, initialDescription, initialPassword, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, description, initialPassword);
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
          <Icon name="x" size={20} />
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

          <div className="form-group">
            <label>Password Access</label>
            <p className="edit-channel-hint">
              Channel password access is managed from the Permissions ACL editor so it stays visible alongside other group access rules.
            </p>
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
