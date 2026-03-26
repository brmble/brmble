import { useState, useEffect } from 'react';
import './AdminSettingsTab.css';
import bridge from '../../bridge';
import { confirm } from '../../hooks/usePrompt';

interface BanEntry {
  address: string;
  bits: number;
  name: string;
  hash: string;
  reason: string;
  start: number;
  duration: number;
}

export function AdminSettingsTab() {
  const [activeSubTab, setActiveSubTab] = useState<'bans' | 'requests' | 'users'>('bans');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBan, setExpandedBan] = useState<number | null>(null);

  useEffect(() => {
    if (activeSubTab === 'bans') {
      loadBans();
    }
  }, [activeSubTab]);

  const loadBans = () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    const timeoutId = setTimeout(() => {
      setLoading(false);
      setError('Failed to load bans: request timed out');
    }, 5000);

    const handleBans = (data: unknown) => {
      clearTimeout(timeoutId);
      setBans(data as BanEntry[]);
      setLoading(false);
    };

    bridge.once('voice.bans', handleBans);
    bridge.send('voice.getBans');
  };

  const handleUnban = async (index: number) => {
    const ban = bans[index];
    const confirmed = await confirm({
      title: 'Unban User',
      message: `Are you sure you want to unban ${ban.name || ban.address}?`,
      confirmLabel: 'Unban',
    });
    if (!confirmed) return;
    bridge.send('voice.unban', { index });
  };

  useEffect(() => {
    const unbannedHandler = () => {
      loadBans();
    };
    bridge.on('voice.unbanned', unbannedHandler);
    return () => {
      bridge.off('voice.unbanned', unbannedHandler);
    };
  }, []);

  const formatExpiry = (start: number, duration: number): string => {
    if (duration === 0) return 'Permanent';
    const expiry = start + duration;
    return new Date(expiry * 1000).toLocaleDateString();
  };

  return (
    <div className="admin-settings-tab">
      <div className="settings-subtabs">
        <button
          className={`settings-subtab ${activeSubTab === 'bans' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('bans')}
        >
          Ban List
        </button>
        <button
          className={`settings-subtab ${activeSubTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('requests')}
        >
          Channel Requests
        </button>
        <button
          className={`settings-subtab ${activeSubTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('users')}
        >
          Registered Users
        </button>
      </div>

      {activeSubTab === 'bans' && (
        <div className="admin-subpanel">
          <div className="admin-panel-header">
            <h3 className="heading-section">Ban List</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadBans} disabled={loading}>
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
                  <button
                    type="button"
                    className="admin-ban-summary"
                    onClick={() => setExpandedBan(expandedBan === index ? null : index)}
                  >
                    <div className="admin-ban-info">
                      <span className="admin-ban-name">{ban.name || ban.address}</span>
                      <span className="admin-ban-reason">{ban.reason || 'No reason'}</span>
                    </div>
                    <div className="admin-ban-meta">
                      <span className="admin-ban-expiry">
                        {formatExpiry(ban.start, ban.duration)}
                      </span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnban(index);
                        }}
                      >
                        Unban
                      </button>
                    </div>
                  </button>
                  {expandedBan === index && (
                    <div className="admin-ban-details">
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
        </div>
      )}

      {activeSubTab === 'requests' && (
        <div className="admin-subpanel">
          <div className="admin-panel-header">
            <h3 className="heading-section">Channel Requests</h3>
          </div>
          <div className="admin-empty">No pending requests.</div>
        </div>
      )}

      {activeSubTab === 'users' && (
        <div className="admin-subpanel">
          <div className="admin-panel-header">
            <h3 className="heading-section">Registered Users</h3>
          </div>
          <div className="admin-empty">
            <p>Registered Users feature coming soon.</p>
          </div>
        </div>
      )}
    </div>
  );
}
