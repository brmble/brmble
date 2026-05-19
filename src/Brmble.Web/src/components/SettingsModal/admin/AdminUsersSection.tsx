import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';

export function AdminUsersSection() {
  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Users</h3>
      </div>
      <div className="settings-item">
        <div className="settings-label-group">
          <span className="settings-label">Search</span>
        </div>
        <input className="brmble-input" placeholder="Search users" />
      </div>
      <AdminSectionPlaceholder title="Registered Users" body="User search and scoped admin actions will appear here." />
      <div className="admin-card">
        <h4 className="heading-label">Banned Users</h4>
        <div className="admin-empty">Banned users and unban actions render here.</div>
      </div>
    </section>
  );
}
