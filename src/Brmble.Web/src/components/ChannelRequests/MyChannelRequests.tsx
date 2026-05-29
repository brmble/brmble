import { useEffect, useState } from 'react';
import { listMyChannelRequests } from '../../api/channelRequests';
import type { ChannelRequestItem } from '../../types/channelRequests';
import './RequestChannelModal.css';

interface MyChannelRequestsProps {
  refreshKey: number;
  connected: boolean;
}

const labels: Record<ChannelRequestItem['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
};

export function MyChannelRequests({ refreshKey, connected }: MyChannelRequestsProps) {
  const [items, setItems] = useState<ChannelRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyChannelRequests()
      .then(nextItems => {
        if (!cancelled) setItems(nextItems);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your channel requests.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, connected]);

  return (
    <section className="settings-section">
      <h3 className="heading-section settings-section-title">My Channel Requests</h3>
      {!connected && <p className="admin-help-text">Connect to a server to view your channel requests.</p>}
      {connected && loading && <p className="admin-help-text">Loading channel requests...</p>}
      {connected && error && <p className="admin-help-text" role="alert">{error}</p>}
      {connected && !loading && !error && items.length === 0 && (
        <p className="admin-help-text">No channel requests yet.</p>
      )}
      {connected && (
        <div className="channel-request-list">
          {items.map(item => (
            <article key={item.id} className="channel-request-row">
              <div className="channel-request-main">
                <span className="channel-request-name">{item.channelName}</span>
                {item.reason && <span className="channel-request-meta">{item.reason}</span>}
                {item.decisionReason && <span className="channel-request-meta">{item.decisionReason}</span>}
              </div>
              <span className="channel-request-status">{labels[item.status]}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
