import { useEffect, useState } from 'react';
import { prompt } from '../../../hooks/usePrompt';
import type { Channel } from '../../../types';

const REQUESTS = [{ id: 1, requestedBy: 'Mike', channelName: 'Officer Chat', status: 'Pending' }];

interface AdminChannelsSectionProps {
  channels?: Channel[];
}

export function AdminChannelsSection({ channels = [] }: AdminChannelsSectionProps) {
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(channels[0]?.id ?? null);
  const selectedChannel = channels.find(channel => channel.id === selectedChannelId) ?? null;

  useEffect(() => {
    if (selectedChannelId != null && channels.some(channel => channel.id === selectedChannelId)) {
      return;
    }

    setSelectedChannelId(channels[0]?.id ?? null);
  }, [channels, selectedChannelId]);

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
          {channels.length > 0 ? (
            channels.map(channel => (
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
            ))
          ) : (
            <p className="admin-help-text">No channels are available yet.</p>
          )}
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
        <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteChannel} disabled={!selectedChannel}>Delete Channel</button>
      </div>

      <p className="admin-help-text">Create Channel is not available yet. Request actions and safe delete are available.</p>
    </section>
  );
}
