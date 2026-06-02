import { useEffect, useState } from 'react';
import { Select } from '../../Select';
import type { Channel } from '../../../types';

interface AdminCreateChannelDialogProps {
  isOpen: boolean;
  channels: Channel[];
  defaultParentId: number;
  pending: boolean;
  onClose: () => void;
  onCreate: (draft: { name: string; description: string; parentId: number }) => void;
}

export function AdminCreateChannelDialog({
  isOpen,
  channels,
  defaultParentId,
  pending,
  onClose,
  onCreate,
}: AdminCreateChannelDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState(String(defaultParentId));

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setName('');
    setDescription('');
    setParentId(String(defaultParentId));
  }, [defaultParentId, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="edit-channel-dialog glass-panel admin-create-channel-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create Channel"
        onClick={event => event.stopPropagation()}
      >
        <form
          className="admin-create-channel-form"
          onSubmit={event => {
            event.preventDefault();
            onCreate({ name, description, parentId: Number(parentId) });
          }}
        >
          <label htmlFor="admin-create-channel-name">Name</label>
          <input
            id="admin-create-channel-name"
            className="brmble-input"
            value={name}
            onChange={event => setName(event.target.value)}
          />

          <label htmlFor="admin-create-channel-description">Description</label>
          <textarea
            id="admin-create-channel-description"
            className="brmble-input"
            value={description}
            onChange={event => setDescription(event.target.value)}
          />

          <span id="admin-create-channel-parent-label">Parent channel</span>
          <Select
            value={parentId}
            onChange={setParentId}
            options={channels.map(channel => ({ value: String(channel.id), label: channel.name }))}
          />

          <div className="admin-create-channel-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || !name.trim()}>
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
