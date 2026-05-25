import { useState, useEffect } from 'react';
import { Icon } from '../Icon/Icon';
import './EditChannelDialog.css';

interface EditChannelDialogProps {
  isOpen: boolean;
  initialName: string;
  initialDescription?: string;
  initialPassword?: string;
  initialPosition?: number;
  showPosition?: boolean;
  onClose: () => void;
  onSave: (name: string, description: string, position: number, password: string) => void;
  onError?: (message: string) => void;
}

export function EditChannelDialog({
  isOpen,
  initialName,
  initialDescription = '',
  initialPassword = '',
  initialPosition = 0,
  showPosition = false,
  onClose,
  onSave,
}: EditChannelDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [position, setPosition] = useState(String(initialPosition));

  useEffect(() => {
    setName(initialName);
    setDescription(initialDescription);
    setPosition(String(initialPosition));
  }, [initialName, initialDescription, initialPassword, initialPosition, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name, description, Number.parseInt(position, 10) || 0, initialPassword);
  };

  const hasChanges = name !== initialName
    || description !== initialDescription
    || (showPosition && (Number.parseInt(position, 10) || 0) !== initialPosition);

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

          {showPosition && (
            <div className="form-group">
              <label htmlFor="channel-position">Position</label>
              <input
                id="channel-position"
                className="brmble-input"
                type="number"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </div>
          )}

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
