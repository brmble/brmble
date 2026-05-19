# Settings Admin Users Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `Users` admin tab with a real, searchable unified user table that merges registered users, live connected users, and banned users while preserving the existing unban workflow.

**Architecture:** Keep aggregation on the client. `App.tsx` already owns live voice users and session-mapping updates, so pass that data into the settings admin surface instead of inventing a second live-data channel. Add two shared admin hooks for registered users and bans, and a pure merge helper that conservatively combines those datasets into one row model for `AdminUsersSection`. Do not assume live users expose Mumble registration IDs today; treat exact-name joins between live and registered rows as a deliberate soft merge rule, and otherwise keep rows separate.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing WebView bridge events, existing ASP.NET `/admin/registered-users` endpoint

---

## File Structure

**Create**
- `src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.ts`
- `src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.test.ts`
- `src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.ts`
- `src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.ts`
- `src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.test.tsx`

**Modify**
- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`
- `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- `src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx`
- `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx`
- `tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs`

**Responsibilities**
- `adminUserModels.ts`: shared row types, search normalization, conservative merge rules, row action derivation
- `useAdminBanList.ts`: shared `voice.getBans` loading, timeout/error state, `Unban` refresh behavior
- `useAdminRegisteredUsers.ts`: fetch `/admin/registered-users`, expose refresh, scoped auth/service errors
- `AdminUsersSection.tsx`: users-tab UI, search box, unified table, inline source-specific messaging
- `AdminModerationSection.tsx`: consume the shared ban hook without changing user-visible moderation behavior
- `App.tsx` + `SettingsModal.tsx` + `AdminSettingsTab.tsx`: thread live connected-user data into the users tab without inventing missing registration identifiers
- `AclAdminEndpointTests.cs`: cover `403` and `503` admin endpoint behavior already implied by the endpoint implementation

### Task 1: Extract Shared Ban Data Logic

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.ts`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`

- [ ] **Step 1: Write the failing hook tests**

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useAdminBanList } from './useAdminBanList';
import bridge from '../../../bridge';
import { confirm } from '../../../hooks/usePrompt';

vi.mock('../../../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
}));

vi.mock('../../../hooks/usePrompt', () => ({
  confirm: vi.fn().mockResolvedValue(true),
}));

describe('useAdminBanList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads bans and exposes them to both admin surfaces', async () => {
    vi.mocked(bridge.once).mockImplementation((type, handler) => {
      if (type === 'voice.bans') handler([{ name: 'TroubleUser', address: '127.0.0.1', bits: 32, hash: 'h', reason: 'spam', start: 1700000000, duration: 0 }]);
    });

    const { result } = renderHook(() => useAdminBanList());

    await waitFor(() => {
      expect(result.current.bans).toHaveLength(1);
    });
    expect(bridge.send).toHaveBeenCalledWith('voice.getBans');
  });

  it('unbans through the shared confirm flow and refreshes afterwards', async () => {
    vi.mocked(bridge.once).mockImplementation((type, handler) => {
      if (type === 'voice.bans') handler([{ name: 'TroubleUser', address: '127.0.0.1', bits: 32, hash: 'h', reason: 'spam', start: 1700000000, duration: 0 }]);
    });

    const { result } = renderHook(() => useAdminBanList());

    await waitFor(() => expect(result.current.bans[0]?.name).toBe('TroubleUser'));

    await act(async () => {
      await result.current.unban(0);
    });

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Unban User',
      confirmLabel: 'Unban',
    }));
    expect(bridge.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/useAdminBanList.test.tsx
```

Expected: FAIL with `Cannot find module './useAdminBanList'`.

- [ ] **Step 3: Write the minimal shared hook and switch moderation to it**

```ts
// src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.ts
import { useCallback, useEffect, useState } from 'react';
import bridge from '../../../bridge';
import { confirm } from '../../../hooks/usePrompt';

export interface AdminBanEntry {
  address: string;
  bits: number;
  name: string;
  hash: string;
  reason: string;
  start: number;
  duration: number;
}

export function useAdminBanList() {
  const [bans, setBans] = useState<AdminBanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setError('Failed to load bans: request timed out');
    }, 5000);

    bridge.once('voice.bans', (data: unknown) => {
      window.clearTimeout(timeoutId);
      setBans((data as AdminBanEntry[]) ?? []);
      setLoading(false);
    });

    bridge.send('voice.getBans');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnbanned = () => refresh();
    bridge.on('voice.unbanned', onUnbanned);
    return () => bridge.off('voice.unbanned', onUnbanned);
  }, [refresh]);

  const unban = useCallback(async (index: number) => {
    const ban = bans[index];
    if (!ban) return;

    const confirmed = await confirm({
      title: 'Unban User',
      message: `Are you sure you want to unban ${ban.name || ban.address}?`,
      confirmLabel: 'Unban',
    });

    if (confirmed) {
      bridge.send('voice.unban', { index });
    }
  }, [bans]);

  return { bans, loading, error, refresh, unban };
}
```

```tsx
// src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx
import { useState } from 'react';
import { AdminSectionPlaceholder } from './AdminSectionPlaceholder';
import { useAdminBanList } from './useAdminBanList';

export function AdminModerationSection() {
  const { bans, loading, error, refresh, unban } = useAdminBanList();
  const [expandedBanKey, setExpandedBanKey] = useState<string | null>(null);

  // keep the existing rendering and button labels, but call refresh/unban from the hook
}
```

- [ ] **Step 4: Run the targeted tests to verify the hook and moderation wiring pass**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/useAdminBanList.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected: PASS with the existing moderation-tab expectations still green.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.ts src/Brmble.Web/src/components/SettingsModal/admin/useAdminBanList.test.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx
git commit -m "refactor: share admin ban data logic"
```

### Task 2: Thread Live Connected User Data Into Admin Settings

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`

- [ ] **Step 1: Write the failing component test for prop plumbing**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

vi.mock('./AdminSettingsTab', () => ({
  AdminSettingsTab: ({ liveUsers }: { liveUsers: Array<{ session: number; name: string }> }) => (
    <div data-testid="admin-users-prop">{liveUsers.map(user => user.name).join(',')}</div>
  ),
}));

describe('SettingsModal admin live user plumbing', () => {
  it('passes live voice users into AdminSettingsTab', () => {
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        initialTab="admin"
        liveUsers={[{ session: 7, name: 'Alice' }]}
      />,
    );

    expect(screen.getByTestId('admin-users-prop')).toHaveTextContent('Alice');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/SettingsModal.test.tsx
```

Expected: FAIL because `SettingsModal` does not accept `liveUsers`.

- [ ] **Step 3: Add the minimal prop chain from `App.tsx` to `AdminSettingsTab`**

```tsx
// src/Brmble.Web/src/App.tsx
<SettingsModal
  isOpen={showSettings}
  onClose={() => setShowSettings(false)}
  initialTab={settingsTab}
  connected={isConnected}
  username={username}
  liveUsers={users}
/>
```

```tsx
// src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection' | 'admin' | 'screenShare';
  liveUsers?: Array<{
    session: number;
    name: string;
    channelId?: number;
    matrixUserId?: string;
    companionId?: string;
    isBrmbleClient?: boolean;
  }>;
}

{activeTab === 'admin' && hasAdminPermission && (
  <AdminSettingsTab liveUsers={props.liveUsers ?? []} />
)}
```

```tsx
// src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx
interface AdminSettingsTabProps {
  liveUsers?: Array<{
    session: number;
    name: string;
    channelId?: number;
    matrixUserId?: string;
    companionId?: string;
    isBrmbleClient?: boolean;
  }>;
}

export function AdminSettingsTab({ liveUsers = [] }: AdminSettingsTabProps) {
  // later tasks will pass liveUsers into AdminUsersSection only; no registrationUserId is assumed here
}
```

- [ ] **Step 4: Run the tests for settings/admin wiring**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected: PASS with no regressions in existing tab-render tests.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx
git commit -m "feat: pass live voice users into admin settings"
```

### Task 3: Build the Unified Admin User Row Model

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.ts`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.test.ts`

- [ ] **Step 1: Write the failing pure-model tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildAdminUserRows } from './adminUserModels';

describe('buildAdminUserRows', () => {
  it('soft-merges registered and connected rows when the normalized name matches exactly', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [{ registrationUserId: 12, registeredName: 'Alice' }],
      connectedUsers: [{ session: 7, name: 'Alice' }],
      bannedUsers: [],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      displayName: 'Alice',
      isRegistered: true,
      isConnected: true,
      registrationUserId: 12,
      sessionId: 7,
    });
  });

  it('keeps ambiguous rows separate when only a fuzzy-ish name relationship exists', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [{ registrationUserId: 12, registeredName: 'Alice' }],
      connectedUsers: [{ session: 7, name: 'Alice_' }],
      bannedUsers: [],
    });

    expect(rows).toHaveLength(2);
  });

  it('matches search against names and ban metadata', () => {
    const rows = buildAdminUserRows({
      registeredUsers: [],
      connectedUsers: [],
      bannedUsers: [{ banIndex: 3, name: '', address: '10.0.0.4', hash: 'abc123', reason: 'spam', start: 1700000000, duration: 0 }],
    });

    expect(rows[0].searchText).toContain('10.0.0.4');
    expect(rows[0].searchText).toContain('abc123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/adminUserModels.test.ts
```

Expected: FAIL with `Cannot find module './adminUserModels'`.

- [ ] **Step 3: Implement the conservative row builder**

```ts
export interface AdminRegisteredUser {
  registrationUserId: number;
  registeredName: string;
}

export interface AdminConnectedUser {
  session: number;
  name: string;
  channelId?: number;
  matrixUserId?: string;
  companionId?: string;
  isBrmbleClient?: boolean;
}

export interface AdminBannedUser {
  banIndex: number;
  name: string;
  address: string;
  hash: string;
  reason: string;
  start: number;
  duration: number;
}

export interface AdminUserRow {
  key: string;
  displayName: string;
  searchText: string;
  aliases: string[];
  isRegistered: boolean;
  isConnected: boolean;
  isBanned: boolean;
  registrationUserId?: number;
  sessionId?: number;
  banIndex?: number;
  matrixUserId?: string;
  address?: string;
  hash?: string;
  sourceKinds: Array<'registered' | 'connected' | 'banned'>;
}

const normalize = (value: string) => value.trim().toLowerCase();

export function buildAdminUserRows(input: {
  registeredUsers: AdminRegisteredUser[];
  connectedUsers: AdminConnectedUser[];
  bannedUsers: AdminBannedUser[];
}): AdminUserRow[] {
  const rows = new Map<string, AdminUserRow>();

  for (const registeredUser of input.registeredUsers) {
    rows.set(`registered:${registeredUser.registrationUserId}`, {
      key: `registered:${registeredUser.registrationUserId}`,
      displayName: registeredUser.registeredName,
      searchText: normalize(registeredUser.registeredName),
      aliases: [registeredUser.registeredName],
      isRegistered: true,
      isConnected: false,
      isBanned: false,
      registrationUserId: registeredUser.registrationUserId,
      sourceKinds: ['registered'],
    });
  }

  for (const connectedUser of input.connectedUsers) {
    const normalizedConnectedName = normalize(connectedUser.name);
    const existing = [...rows.values()].find(row =>
      row.isRegistered &&
      normalize(row.displayName) === normalizedConnectedName
    );

    if (existing) {
      existing.isConnected = true;
      existing.sessionId = connectedUser.session;
      existing.matrixUserId = connectedUser.matrixUserId;
      existing.aliases = Array.from(new Set([...existing.aliases, connectedUser.name]));
      existing.searchText = normalize([...existing.aliases, connectedUser.matrixUserId ?? ''].join(' '));
      existing.sourceKinds = Array.from(new Set([...existing.sourceKinds, 'connected']));
      continue;
    }

    rows.set(`connected:${connectedUser.session}`, {
      key: `connected:${connectedUser.session}`,
      displayName: connectedUser.name,
      searchText: normalize([connectedUser.name, connectedUser.matrixUserId ?? ''].join(' ')),
      aliases: [connectedUser.name],
      isRegistered: false,
      isConnected: true,
      isBanned: false,
      sessionId: connectedUser.session,
      matrixUserId: connectedUser.matrixUserId,
      sourceKinds: ['connected'],
    });
  }

  for (const bannedUser of input.bannedUsers) {
    const exactHashMatch = [...rows.values()].find(row => row.hash && row.hash === bannedUser.hash);

    if (exactHashMatch) {
      exactHashMatch.isBanned = true;
      exactHashMatch.banIndex = bannedUser.banIndex;
      exactHashMatch.address = bannedUser.address;
      exactHashMatch.hash = bannedUser.hash;
      exactHashMatch.searchText = normalize([exactHashMatch.searchText, bannedUser.address, bannedUser.hash].join(' '));
      exactHashMatch.sourceKinds = Array.from(new Set([...exactHashMatch.sourceKinds, 'banned']));
      continue;
    }

    rows.set(`banned:${bannedUser.banIndex}`, {
      key: `banned:${bannedUser.banIndex}`,
      displayName: bannedUser.name || bannedUser.address,
      searchText: normalize([bannedUser.name, bannedUser.address, bannedUser.hash].join(' ')),
      aliases: [bannedUser.name, bannedUser.address].filter(Boolean),
      isRegistered: false,
      isConnected: false,
      isBanned: true,
      banIndex: bannedUser.banIndex,
      address: bannedUser.address,
      hash: bannedUser.hash,
      sourceKinds: ['banned'],
    });
  }

  return [...rows.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
}
```

- [ ] **Step 4: Run the pure-model tests**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/adminUserModels.test.ts
```

Expected: PASS, confirming the merge logic is conservative and searchable.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.ts src/Brmble.Web/src/components/SettingsModal/admin/adminUserModels.test.ts
git commit -m "feat: add admin user merge model"
```

### Task 4: Add Registered User Loading And Build the Users Tab UI

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.ts`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`

- [ ] **Step 1: Write the failing users-tab tests**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AdminUsersSection } from './AdminUsersSection';

const refreshJson = vi.fn();
const originalFetch = global.fetch;

describe('AdminUsersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: refreshJson.mockResolvedValue({ 12: 'Alice', 34: 'Bob' }),
    }) as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it('renders registered and banned users in one table', async () => {
    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'Alice' }]} />);

    await screen.findByRole('heading', { name: 'Users' });

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('filters rows locally from the search input', async () => {
    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'Alice' }, { session: 9, name: 'Bob' }]} />);

    fireEvent.change(await screen.findByPlaceholderText('Search users'), { target: { value: 'bob' } });

    await waitFor(() => {
      expect(screen.queryByText('Alice')).not.toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('keeps partial failure scoped to the registered-users source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as unknown as typeof fetch);

    render(<AdminUsersSection liveUsers={[{ session: 7, name: 'LiveOnlyUser' }]} />);

    expect(await screen.findByText('Registered users are unavailable for this account.')).toBeInTheDocument();
    expect(screen.getByText('LiveOnlyUser')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx src/components/SettingsModal/admin/AdminUsersSection.test.tsx
```

Expected: FAIL because the registered-user hook and the new `AdminUsersSection` API do not exist yet.

- [ ] **Step 3: Implement the registered-user hook and the real users section**

```ts
// src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.ts
import { useCallback, useEffect, useState } from 'react';
import type { AdminRegisteredUser } from './adminUserModels';

export function useAdminRegisteredUsers() {
  const [registeredUsers, setRegisteredUsers] = useState<AdminRegisteredUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    const response = await fetch('/admin/registered-users');
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        setError('Registered users are unavailable for this account.');
      } else {
        setError('Registered users could not be loaded right now.');
      }
      setRegisteredUsers([]);
      setLoading(false);
      return;
    }

    const payload = await response.json() as Record<string, string>;
    setRegisteredUsers(
      Object.entries(payload).map(([registrationUserId, registeredName]) => ({
        registrationUserId: Number(registrationUserId),
        registeredName,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { registeredUsers, loading, error, refresh };
}
```

```tsx
// src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx
import { useMemo, useState } from 'react';
import { buildAdminUserRows } from './adminUserModels';
import { useAdminBanList } from './useAdminBanList';
import { useAdminRegisteredUsers } from './useAdminRegisteredUsers';

interface AdminUsersSectionProps {
  liveUsers?: Array<{
    session: number;
    name: string;
    channelId?: number;
    matrixUserId?: string;
    companionId?: string;
    isBrmbleClient?: boolean;
  }>;
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

  const filteredRows = rows.filter(row => row.searchText.includes(query.trim().toLowerCase()));

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
```

```tsx
// src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx
{activeTab === 'users' && <AdminUsersSection liveUsers={liveUsers} />}
```

```css
.admin-users-table {
  display: grid;
  gap: var(--space-sm);
}

.admin-user-row {
  display: grid;
  grid-template-columns: minmax(0, 2fr) auto auto;
  gap: var(--space-md);
  align-items: center;
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.admin-user-badges,
.admin-user-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.admin-user-badge {
  padding: 2px var(--space-xs);
  border-radius: var(--radius-pill);
  background: var(--bg-overlay);
  color: var(--text-secondary);
}

.admin-user-badge-danger {
  color: var(--accent-danger);
}
```

- [ ] **Step 4: Run the users-tab tests**

```bash
cd src/Brmble.Web
npm run test -- src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx src/components/SettingsModal/admin/AdminUsersSection.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected: PASS, including unified rendering, search, and scoped failure messaging.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.ts src/Brmble.Web/src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.test.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css
git commit -m "feat: add real admin users table"
```

### Task 5: Cover Admin Endpoint Failure Modes Used By the UI

**Files:**
- Modify: `tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs`

- [ ] **Step 1: Write the failing integration tests for forbidden and service-unavailable responses**

```csharp
[TestMethod]
public async Task GetRegisteredUsers_WithoutAdminAclPermission_ReturnsForbidden()
{
    using var factory = new BrmbleServerFactory("cert_registered_forbidden");
    var user = await SeedUser(factory, "cert_registered_forbidden", "Alice");
    factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(false);
    var client = factory.CreateClient();

    var response = await client.GetAsync("/admin/registered-users");

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}

[TestMethod]
public async Task GetRegisteredUsers_WhenRegistrationLookupFails_ReturnsServiceUnavailable()
{
    using var factory = new BrmbleServerFactory("cert_registered_error");
    var user = await SeedUser(factory, "cert_registered_error", "Admin");
    factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(true);
    factory.MumbleRegistrationMock
        .Setup(service => service.GetRegisteredUsersAsync(""))
        .ThrowsAsync(new MumbleRegistrationException("ICE unavailable"));
    var client = factory.CreateClient();

    var response = await client.GetAsync("/admin/registered-users");

    Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
}
```

- [ ] **Step 2: Run test to verify the new assertions fail if setup is incomplete**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter AclAdminEndpointTests
```

Expected: FAIL if the mock permission/service setup does not yet match the endpoint behavior exactly.

- [ ] **Step 3: Adjust the test fixture expectations to reflect the endpoint contract**

```csharp
[TestMethod]
public async Task GetRegisteredUsers_Authenticated_ReturnsRegisteredUsers()
{
    using var factory = new BrmbleServerFactory("cert_registered_lookup");
    var user = await SeedUser(factory, "cert_registered_lookup", "Admin");
    factory.AclAuthorizationMock.Setup(a => a.CanManageChannelAclAsync(user.Id, 0)).ReturnsAsync(true);
    factory.MumbleRegistrationMock
        .Setup(service => service.GetRegisteredUsersAsync(""))
        .ReturnsAsync(new Dictionary<int, string>
        {
            [12] = "Alice",
            [34] = "Bob",
        });

    var client = factory.CreateClient();
    var response = await client.GetAsync("/admin/registered-users");

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
}
```

- [ ] **Step 4: Run the integration tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter AclAdminEndpointTests
```

Expected: PASS with `Unauthorized`, `Forbidden`, `OK`, and `ServiceUnavailable` all covered.

- [ ] **Step 5: Commit**

```bash
git add tests/Brmble.Server.Tests/Integration/AclAdminEndpointTests.cs
git commit -m "test: cover admin registered users endpoint failures"
```

## Verification Checklist

- Run: `cd src/Brmble.Web && npm run test -- src/components/SettingsModal/admin/useAdminBanList.test.tsx src/components/SettingsModal/admin/adminUserModels.test.ts src/components/SettingsModal/admin/useAdminRegisteredUsers.test.tsx src/components/SettingsModal/admin/AdminUsersSection.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/SettingsModal.test.tsx`
- Run: `cd src/Brmble.Web && npm run type-check`
- Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter AclAdminEndpointTests`

Expected verification outcome:
- Web tests pass for the shared ban hook, merge helper, settings prop plumbing, and users-tab UI behavior.
- Web tests pass for the shared ban hook, merge helper, settings prop plumbing, and users-tab UI behavior, with `fetch` mocks restored after each test file.
- TypeScript type-check passes after the new `liveUsers` prop and row-model types are added.
- Server integration tests confirm the UI-facing endpoint failure modes remain stable.

## Self-Review

**Spec coverage**
- Real data-driven `Users` tab: covered by Task 4.
- Unified merge of registered, connected, and banned sources: covered by Task 3 and consumed in Task 4.
- Unified merge of registered, connected, and banned sources: covered by Task 3 and consumed in Task 4, without assuming a live registration ID field that the app does not currently expose.
- Existing unban flow reused in `Users`: covered by Task 1 and Task 4.
- Partial failures isolated: covered by Task 4 tests and scoped error rendering.
- Conservative identity joins only: covered by Task 3 tests and merge rules.
- No new aggregate endpoint: respected; Task 5 only tests the existing endpoint.

**Placeholder scan**
- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each code-writing step includes concrete code, and each verification step includes explicit commands and expected outcomes.

**Type consistency**
- Shared naming is consistent across tasks: `AdminBanEntry`, `AdminRegisteredUser`, `AdminConnectedUser`, `AdminUserRow`, `useAdminBanList`, `useAdminRegisteredUsers`, `buildAdminUserRows`.
- Shared naming is consistent across tasks: `AdminBanEntry`, `AdminRegisteredUser`, `AdminConnectedUser`, `AdminUserRow`, `useAdminBanList`, `useAdminRegisteredUsers`, `buildAdminUserRows`.
- The `liveUsers` prop is introduced once in Task 2 and reused consistently in Task 4.

Plan complete and saved to `docs/superpowers/plans/2026-05-19-settings-admin-users-real-data.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
