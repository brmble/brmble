import { useEffect, useRef, useState } from 'react';
import { approveChannelRequest, denyChannelRequest, listAdminChannelRequests } from '../../../api/channelRequests';
import type { ChannelRequestItem } from '../../../types/channelRequests';
import { confirm, prompt } from '../../../hooks/usePrompt';

type RequestFilter = 'pending' | 'approved' | 'denied' | 'all';

const labels: Record<ChannelRequestItem['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
};

export function AdminChannelRequestsSection() {
  const [items, setItems] = useState<ChannelRequestItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<RequestFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Tracks the latest request so stale responses from a previous filter are discarded.
  const latestRequestRef = useRef(0);

  const load = async (filter = statusFilter) => {
    const requestId = ++latestRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminChannelRequests(filter);
      if (requestId !== latestRequestRef.current) return;
      setItems(result);
    } catch {
      if (requestId !== latestRequestRef.current) return;
      setError('Could not load channel requests.');
    } finally {
      if (requestId === latestRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load(statusFilter);
    // load intentionally reads the latest state and is only used here/event handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const approve = async (item: ChannelRequestItem) => {
    const ok = await confirm({
      title: 'Approve Channel Request',
      message: `Create "${item.channelName}" for ${item.requesterDisplayName ?? 'this user'}?`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;

    setBusyId(item.id);
    try {
      await approveChannelRequest(item.id);
      await load();
    } catch {
      setError('Could not approve the request.');
    } finally {
      setBusyId(null);
    }
  };

  const deny = async (item: ChannelRequestItem) => {
    const reason = await prompt({
      title: 'Deny Channel Request',
      message: `Reason for denying "${item.channelName}"?`,
      placeholder: 'Optional reason',
      confirmLabel: 'Deny',
    });
    if (reason === null) return;

    setBusyId(item.id);
    try {
      await denyChannelRequest(item.id, reason);
      await load();
    } catch {
      setError('Could not deny the request.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Channel Requests</h3>
      </div>
      <div className="admin-card">
        <div className="admin-action-row">
          {(['pending', 'approved', 'denied', 'all'] as const).map(filter => (
            <button
              key={filter}
              type="button"
              className={`btn btn-sm ${statusFilter === filter ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setStatusFilter(filter)}
            >
              {filter[0].toUpperCase() + filter.slice(1)}
            </button>
          ))}
        </div>
        {loading && <p className="admin-help-text">Loading requests...</p>}
        {error && <p className="admin-help-text" role="alert">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="admin-help-text">No channel requests in this view.</p>
        )}
        <div className="admin-table-placeholder">
          {items.map(item => (
            <div key={item.id} className="admin-request-row">
              <div className="admin-request-details">
                <div className="admin-request-field">
                  <span className="admin-request-label">Channel</span>
                  <span className="admin-request-value">{item.channelName}</span>
                </div>
                <div className="admin-request-field">
                  <span className="admin-request-label">Requested by</span>
                  <span className="admin-request-value">{item.requesterDisplayName ?? 'Someone'}</span>
                </div>
                <div className="admin-request-field">
                  <span className="admin-request-label">Reason</span>
                  <span className="admin-request-value">{item.reason?.trim() || 'No reason provided'}</span>
                </div>
              </div>
              <div className="admin-request-status-cell">
                <span className="admin-request-status">{labels[item.status]}</span>
                {item.status === 'pending' && (
                  <div className="admin-request-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-label={`Approve ${item.channelName}`}
                      disabled={busyId === item.id}
                      onClick={() => void approve(item)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      aria-label={`Deny ${item.channelName}`}
                      disabled={busyId === item.id}
                      onClick={() => void deny(item)}
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
