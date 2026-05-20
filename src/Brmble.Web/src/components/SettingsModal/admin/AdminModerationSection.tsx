import { useState } from 'react';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { useAdminBanList } from './useAdminBanList';

export function AdminModerationSection() {
  const { bans, loading, error, refresh, unban } = useAdminBanList();
  const [expandedBan, setExpandedBan] = useState<number | null>(null);

  const formatExpiry = (start: number, duration: number): string => {
    if (duration === 0) {
      return 'Permanent';
    }
    const expiry = start + duration;
    return new Date(expiry * 1000).toLocaleDateString();
  };

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Moderation</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <div className="admin-loading">Loading...</div>}
      {error && <div className="admin-error">{error}</div>}

      {!loading && !error && bans.length === 0 && (
        <div className="admin-empty">No users are currently banned.</div>
      )}

      {!loading && bans.length > 0 && (
        <div className="admin-ban-list">
          {bans.map((ban, index) => (
            <div key={`${ban.hash}-${ban.address}-${ban.start}`} className="admin-ban-row">
              <div className="admin-ban-summary">
                <button
                  type="button"
                  className="admin-ban-expand"
                  aria-expanded={expandedBan === index}
                  aria-controls={`admin-ban-details-${index}`}
                  onClick={() => setExpandedBan(expandedBan === index ? null : index)}
                >
                  <div className="admin-ban-info">
                    <span className="admin-ban-name">{ban.name || ban.address}</span>
                    <span className="admin-ban-reason">{ban.reason || 'No reason'}</span>
                  </div>
                  <span className="admin-ban-expiry">{formatExpiry(ban.start, ban.duration)}</span>
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void unban(index)}>
                  Unban
                </button>
              </div>
              {expandedBan === index && (
                <div className="admin-ban-details" id={`admin-ban-details-${index}`}>
                  <div className="admin-ban-detail"><span>IP:</span> {ban.address}/{ban.bits}</div>
                  <div className="admin-ban-detail"><span>Hash:</span> {ban.hash}</div>
                  <div className="admin-ban-detail"><span>Applied:</span> {new Date(ban.start * 1000).toLocaleString()}</div>
                  {ban.reason && <div className="admin-ban-detail"><span>Reason:</span> {ban.reason}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AdminSectionPlaceholder
        title="Warnings"
        body="Additional moderation tools are not available yet in phase 1."
      />
    </section>
  );
}
