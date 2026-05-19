import { useState } from 'react';
import { prompt } from '../../../hooks/usePrompt';

const CHANNELS = [
  { id: 1, name: 'Officer Chat' },
  { id: 2, name: 'Raid Planning' },
];

const REQUESTS = [{ id: 1, requestedBy: 'Mike', channelName: 'Officer Chat', status: 'Pending' }];

export function AdminChannelsSection() {
  const [selectedChannelId, setSelectedChannelId] = useState<number>(CHANNELS[0].id);
  const selectedChannel = CHANNELS.find(channel => channel.id === selectedChannelId) ?? null;

  const handleDeleteChannel = async () => {
    if (!selectedChannel) return;

    const result = await prompt({
      title: 'Delete Channel',
      message: `Type "${selectedChannel.name}" to confirm deleting this channel.`,
      placeholder: selectedChannel.name,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });

    if (result !== selectedChannel.name) return;
  };

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Channels</h3>
      </div>

      <div className="admin-card">
        <h4 className="heading-label">Existing Channels</h4>
        <div className="admin-table-placeholder" role="table" aria-label="Existing Channels table">
          {CHANNELS.map(channel => (
            <button
              key={channel.id}
              type="button"
              className={`admin-channel-row ${channel.id === selectedChannelId ? 'selected' : ''}`}
              role="row"
              aria-label={channel.name}
              onClick={() => setSelectedChannelId(channel.id)}
            >
              {channel.name}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <h4 className="heading-label">Channel Requests</h4>
        <div className="admin-table-placeholder">
          {REQUESTS.map(request => (
            <div key={request.id} className="admin-request-row">
              <span>{request.requestedBy} requested {request.channelName}</span>
              <div className="admin-request-status-cell">
                <span className="admin-request-status">{request.status}</span>
                <div className="admin-request-actions">
                  <button type="button" className="btn btn-secondary btn-sm" aria-label={`Approve ${request.requestedBy} request`}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" aria-label={`Deny ${request.requestedBy} request`}>
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-action-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled>Create Channel</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteChannel}>Delete Channel</button>
      </div>

      <p className="admin-help-text">Create Channel is not available yet. Request actions and safe delete are available.</p>
    </section>
  );
}
