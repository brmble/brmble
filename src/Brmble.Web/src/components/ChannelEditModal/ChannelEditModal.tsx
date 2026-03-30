import { useState } from 'react';
import { ManageModeratorsTab } from '../ManageModeratorsTab/ManageModeratorsTab';
import bridge from '../../bridge';
import './ChannelEditModal.css';

interface ChannelEditModalProps {
  channelId: number;
  channelName: string;
  isAdmin: boolean;
  onClose: () => void;
}

export function ChannelEditModal({ channelId, channelName, isAdmin, onClose }: ChannelEditModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'moderators'>('general');
  const [name, setName] = useState(channelName);
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    bridge.send('voice.updateChannel', {
      channelId,
      name: name !== channelName ? name : undefined,
      description,
      password: password || null,
    });
    setSaving(false);
    onClose();
  };

  const showModeratorsTab = isAdmin;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="channel-edit-modal glass-panel animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="heading-title modal-title">Edit Channel</h2>
          <p className="modal-subtitle">{channelName}</p>
        </div>

        <div className="edit-tabs">
          <button
            className={`edit-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          {showModeratorsTab && (
            <button
              className={`edit-tab ${activeTab === 'moderators' ? 'active' : ''}`}
              onClick={() => setActiveTab('moderators')}
            >
              Manage Moderators
            </button>
          )}
        </div>

        <div className="modal-body">
          {activeTab === 'general' && (
            <div className="general-tab-content">
              <div className="form-group">
                <label className="form-label">Channel Name</label>
                <input
                  type="text"
                  className="brmble-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="brmble-input"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Channel description..."
                  rows={3}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Password (leave empty to clear)</label>
                <input
                  type="password"
                  className="brmble-input"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter new password..."
                />
              </div>
            </div>
          )}

          {activeTab === 'moderators' && (
            <ManageModeratorsTab
              channelId={channelId}
              isAdmin={isAdmin}
            />
          )}
        </div>

        {activeTab === 'general' && (
          <div className="prompt-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
