import { useMemo, useState } from 'react';
import { buildAdminUserRows, type AdminConnectedUser } from './adminUserModels';
import { useAdminBanList } from './useAdminBanList';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';

interface AdminUsersSectionProps {
  liveUsers?: AdminConnectedUser[];
}

export function AdminUsersSection({ liveUsers = [] }: AdminUsersSectionProps) {
  const [query, setQuery] = useState('');
  const { registeredUsers, loading: registeredLoading, error: registeredError, refresh } = useAdminRegisteredUsers();
  const { bans, loading: bansLoading, error: bansError, unban } = useAdminBanList();

  const rows = useMemo(() => buildAdminUserRows({
    registeredUsers,
    connectedUsers: liveUsers,
    bannedUsers: bans.map((ban, banIndex) => ({ ...ban, banIndex })),
  }), [registeredUsers, liveUsers, bans]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = rows.filter(row => row.searchText.includes(normalizedQuery));

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Users</h3>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()} disabled={registeredLoading}>
          Refresh
        </button>
      </div>
      <div className="settings-item">
        <div className="settings-label-group">
          <span className="settings-label">Search</span>
        </div>
        <input
          className="brmble-input"
          placeholder="Search users"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {registeredError && <div className="admin-error">{registeredError}</div>}
      {bansError && <div className="admin-error">{bansError}</div>}
      {(registeredLoading || bansLoading) && <div className="admin-loading">Loading user sources...</div>}

      {!registeredLoading && !bansLoading && filteredRows.length === 0 && (
        <div className="admin-empty">No users match the current filter.</div>
      )}

      {filteredRows.length > 0 && (
        <div className="admin-card">
          <div className="admin-users-table">
            {filteredRows.map(row => (
              <div key={row.key} className="admin-user-row">
                <div className="admin-user-identity">
                  <span className="admin-user-name">{row.displayName}</span>
                  <span className="admin-user-meta">
                    {row.registrationUserId ? `Registered ID ${row.registrationUserId}` : row.address ?? 'Live session only'}
                  </span>
                </div>
                <div className="admin-user-badges">
                  {row.isConnected && <span className="admin-user-badge">Connected</span>}
                  {row.isRegistered && <span className="admin-user-badge">Registered</span>}
                  {row.isBanned && <span className="admin-user-badge admin-user-badge-danger">Banned</span>}
                </div>
                <div className="admin-user-actions">
                  {row.banIndex !== undefined && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => void unban(row.banIndex!)}>
                      Unban
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
