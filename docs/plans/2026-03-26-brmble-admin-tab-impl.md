# Admin Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Admin tab to settings showing ban list and channel requests for moderators

**Architecture:** Admin tab added to SettingsModal with two subtabs. Ban list fetches from backend via `voice.getBans` bridge command. Unban handled via `voice.unban`. Channel requests panel follows same pattern.

**Tech Stack:** React + TypeScript (frontend), C# MumbleSharp (backend)

---

## Task 1: Create AdminSettingsTab component (with tab visibility control)

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.css`

**Step 1: Create AdminSettingsTab.tsx with subtab structure**

```tsx
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

interface ChannelRequest {
  id: string;
  userId: string;
  userName: string;
  channelName: string;
  reason: string;
  submittedAt: number;
}

export function AdminSettingsTab() {
  const [activeSubTab, setActiveSubTab] = useState<'bans' | 'requests'>('bans');
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [requests, setRequests] = useState<ChannelRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBan, setExpandedBan] = useState<number | null>(null);

  useEffect(() => {
    if (activeSubTab === 'bans') {
      loadBans();
    }
  }, [activeSubTab]);

  const loadBans = () => {
    setLoading(true);
    setError(null);
    bridge.send('voice.getBans');
  };

  useEffect(() => {
    const handler = (data: unknown) => {
      setBans(data as BanEntry[]);
      setLoading(false);
    };
    const errorHandler = (data: unknown) => {
      setError((data as { message: string }).message);
      setLoading(false);
    };
    bridge.on('voice.bans', handler);
    bridge.on('voice.error', errorHandler);
    return () => {
      bridge.off('voice.bans', handler);
      bridge.off('voice.error', errorHandler);
    };
  }, []);

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
                <div key={index} className="admin-ban-row">
                  <div className="admin-ban-summary" onClick={() => setExpandedBan(expandedBan === index ? null : index)}>
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
                  </div>
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
    </div>
  );
}
```

**Step 2: Create AdminSettingsTab.css**

```css
.admin-settings-tab {
  padding: var(--space-lg);
}

.settings-subtabs {
  display: flex;
  gap: var(--space-xs);
  margin-bottom: var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.settings-subtab {
  padding: var(--space-xs) var(--space-md);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.settings-subtab:hover {
  color: var(--text-primary);
}

.settings-subtab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
}

.admin-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.admin-panel-header .heading-section {
  margin: 0;
}

.admin-loading,
.admin-error,
.admin-empty {
  padding: var(--space-lg);
  text-align: center;
  color: var(--text-muted);
}

.admin-error {
  color: var(--accent-danger);
}

.admin-ban-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.admin-ban-row {
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.admin-ban-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.admin-ban-summary:hover {
  background: var(--bg-hover);
}

.admin-ban-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
}

.admin-ban-name {
  font-weight: 500;
  color: var(--text-primary);
}

.admin-ban-reason {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-ban-meta {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.admin-ban-expiry {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.admin-ban-details {
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-overlay);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.admin-ban-detail {
  display: flex;
  gap: var(--space-sm);
}

.admin-ban-detail span {
  font-weight: 500;
  color: var(--text-secondary);
}

.btn-sm {
  padding: var(--space-2xs) var(--space-sm);
  font-size: var(--text-sm);
}
```

**Step 3: Add Admin tab to SettingsModal.tsx with permission check**

In SettingsModal.tsx, import the permissions hook and AdminSettingsTab, then conditionally render the Admin tab:

```tsx
import { AdminSettingsTab } from './AdminSettingsTab';
import { usePermissions, Permission } from '../../hooks/usePermissions';

// Inside the component:
const { hasPermission } = usePermissions();
const hasAdminPermission = hasPermission(0, Permission.Ban) || hasPermission(0, Permission.Kick);

// In the tabs section, add (only if user has admin permission):
{hasAdminPermission && (
  <button
    className={`settings-tab ${activeTab === 'admin' ? 'active' : ''}`}
    onClick={() => setActiveTab('admin')}
  >
    Admin
  </button>
)}

// In the content area, add (AdminSettingsTab already guards itself, but this won't render for non-admins):
{activeTab === 'admin' && hasAdminPermission && <AdminSettingsTab />}
```

**Step 4: Run lint/typecheck**

```bash
cd src/Brmble.Web && npm run lint
```

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/
git commit -m "feat: add AdminSettingsTab component with subtabs and permission-gated visibility"
```

---

## Task 2: Add backend handlers for voice.getBans and voice.unban

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add getBans handler**

In MumbleAdapter.cs, after existing bridge handlers (around line 1660), add:

```csharp
bridge.RegisterHandler("voice.getBans", data =>
{
    if (Connection is not { State: ConnectionStates.Connected })
    {
        _bridge?.Send("voice.error", new { message = "Not connected", type = "notConnected" });
        return Task.CompletedTask;
    }

    try
    {
        var bans = Connection.getBans();
        var banList = bans.Select(b => new
        {
            address = BitConverter.ToString(b.Address).Replace("-", ":"),
            bits = b.Bits,
            name = b.Name,
            hash = b.Hash,
            reason = b.Reason,
            start = b.Start,
            duration = b.Duration
        }).ToArray();
        _bridge?.Send("voice.bans", banList);
    }
    catch (Exception ex)
    {
        _bridge?.Send("voice.error", new { message = $"Failed to get bans: {ex.Message}", type = "getBansFailed" });
    }
    return Task.CompletedTask;
});

bridge.RegisterHandler("voice.unban", data =>
{
    if (Connection is not { State: ConnectionStates.Connected })
    {
        _bridge?.Send("voice.error", new { message = "Not connected", type = "notConnected" });
        return Task.CompletedTask;
    }

    if (!data.TryGetProperty("index", out var indexElement))
    {
        _bridge?.Send("voice.error", new { message = "Missing ban index", type = "invalidRequest" });
        return Task.CompletedTask;
    }

    var index = indexElement.GetInt32();

    try
    {
        var bans = Connection.getBans().ToList();
        if (index < 0 || index >= bans.Count)
        {
            _bridge?.Send("voice.error", new { message = "Invalid ban index", type = "invalidIndex" });
            return Task.CompletedTask;
        }

        bans.RemoveAt(index);
        Connection.setBans(bans.ToArray());
        _bridge?.Send("voice.unbanned", new { success = true, index });
        _bridge?.Send("voice.bans", bans.Select(b => new
        {
            address = BitConverter.ToString(b.Address).Replace("-", ":"),
            bits = b.Bits,
            name = b.Name,
            hash = b.Hash,
            reason = b.Reason,
            start = b.Start,
            duration = b.Duration
        }).ToArray());
    }
    catch (Exception ex)
    {
        _bridge?.Send("voice.error", new { message = $"Failed to unban: {ex.Message}", type = "unbanFailed" });
    }
    return Task.CompletedTask;
});
```

**Step 2: Build to verify**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add voice.getBans and voice.unban bridge handlers"
```

---

## Task 3: Test the complete flow

**Step 1: Run all tests**

```bash
dotnet test
```

**Step 2: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 3: Run client**

```bash
dotnet run --project src/Brmble.Client
```

**Manual verification:**
1. Open settings with an admin account
2. Verify "Admin" tab appears
3. Click Admin tab, verify Ban List subtab shows
4. Test refresh button
5. Verify empty state when no bans
6. (If possible) Create a test ban and verify it appears
7. Test unban confirmation dialog
8. Verify Channel Requests subtab shows empty state

---

## Summary

| Task | Files Modified |
|------|----------------|
| 1 | AdminSettingsTab.tsx, AdminSettingsTab.css, SettingsModal.tsx, SettingsModal.css |
| 2 | MumbleAdapter.cs |
| 3 | All above (test) |

## Future Enhancements (Out of Scope)

- Channel Requests panel implementation
- Search/filter in ban list
- Sorting by columns
- Bulk unban operations
- Export ban list to CSV
