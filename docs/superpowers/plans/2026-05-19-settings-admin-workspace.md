# Settings Admin Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current narrow Admin settings sub-tabs with a five-section admin workspace that keeps existing live ban and ACL-backed behavior usable while aligning every UI change with `docs/UI_GUIDE.md`.

**Architecture:** Keep the feature inside the existing `SettingsModal` and refactor `AdminSettingsTab` into a lightweight coordinator that renders focused admin subcomponents for `Channels`, `Users`, `Groups`, `Moderation`, and `Audit Log`. Reuse current bridge and ACL hooks where they already exist, move the live ban flow into `Moderation`, and implement `Groups` as a real staged editor with create/delete/save behavior instead of a placeholder role viewer.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Brmble bridge events, existing ACL hook (`useAclAdmin`), CSS modules/files using global theme tokens from `index.css` and patterns from `docs/UI_GUIDE.md`

---

## File Structure

- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
  - Reduce to admin workspace shell, top-level admin tab navigation, and state coordination.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
  - Replace current narrow ban-list styling with workspace-level layout tokens and per-section styles.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`
  - Shift from narrow ban-row tests to workspace-level navigation and moderation regression coverage.
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
  - Keep modal integration stable; only touch if the admin workspace needs prop wiring or width behavior changes.
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
  - Add guard coverage that Admin still appears only for admins and still mounts cleanly.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceTypes.ts`
  - Centralize admin tab ids and shared placeholder-state metadata.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminSectionPlaceholder.tsx`
  - Shared empty/partial/disabled section block that follows `UI_GUIDE.md` patterns.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx`
  - Own the migrated live ban list plus future moderation placeholders.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx`
  - Render the channel management overview, request queue, row-level request decisions, and typed-delete workflow.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx`
  - Render user search/list/detail content, scoped actions, and a bottom banned-users section with unban support.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`
  - Render the real group editor with group list, add/delete controls, dual-list membership, permissions checklist, and save/cancel actions.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`
  - Focused tests for add/delete/save/cancel and staged group editing behavior.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminAuditLogSection.tsx`
  - Render the phase-1 read-only chronological log placeholder.
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`
  - Focused tests for placeholder/disabled messaging and section rendering.

## Task 1: Establish The Admin Workspace Shell

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceTypes.ts`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`

- [ ] **Step 1: Write the failing admin workspace navigation test**

```tsx
it('renders the five admin workspace tabs', () => {
  render(<AdminSettingsTab />);

  expect(screen.getByRole('button', { name: 'Channels' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Groups' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Moderation' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Audit Log' })).toBeInTheDocument();

  expect(screen.queryByRole('button', { name: 'Ban List' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
FAIL ... Unable to find role="button" with name "Channels"
```

- [ ] **Step 3: Add shared admin workspace types**

```ts
export type AdminWorkspaceTab = 'channels' | 'users' | 'groups' | 'moderation' | 'audit-log';

export interface AdminWorkspaceTabDefinition {
  id: AdminWorkspaceTab;
  label: string;
}

export const ADMIN_WORKSPACE_TABS: AdminWorkspaceTabDefinition[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'users', label: 'Users' },
  { id: 'groups', label: 'Groups' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'audit-log', label: 'Audit Log' },
];
```

- [ ] **Step 4: Replace the old three-subtab shell in `AdminSettingsTab.tsx` with the new workspace nav**

```tsx
const [activeTab, setActiveTab] = useState<AdminWorkspaceTab>('channels');

return (
  <div className="admin-settings-tab">
    <div className="settings-subtabs" role="tablist" aria-label="Admin sections">
      {ADMIN_WORKSPACE_TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`settings-subtab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
    <div className="admin-workspace-body">{/* section render comes in later tasks */}</div>
  </div>
);
```

- [ ] **Step 5: Run the focused test to verify it passes**

Run:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/AdminSettingsTab.test.tsx
```

- [ ] **Step 6: Commit the workspace shell**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceTypes.ts
git commit -m "feat: add admin workspace navigation shell"
```

## Task 2: Move The Live Ban Flow Into Moderation

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`

- [ ] **Step 1: Write the failing moderation regression tests**

```tsx
it('shows the moderation section by default with the ban list', async () => {
  renderWithBan();

  fireEvent.click(screen.getByRole('button', { name: 'Moderation' }));

  expect(await screen.findByRole('heading', { name: 'Moderation' })).toBeInTheDocument();
  expect(screen.getByText('TroubleUser')).toBeInTheDocument();
});

it('keeps unban behavior working after the moderation move', async () => {
  renderWithBan();

  fireEvent.click(screen.getByRole('button', { name: 'Moderation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Unban' }));

  await waitFor(() => {
    expect(bridgeMock.send).toHaveBeenCalledWith('voice.unban', { index: 0 });
  });
});
```

- [ ] **Step 2: Run the moderation test to verify it fails**

Run:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
FAIL ... Unable to find role="heading" with name "Moderation"
```

- [ ] **Step 3: Extract the existing ban loading and unban behavior into `AdminModerationSection.tsx`**

```tsx
export function AdminModerationSection() {
  const [bans, setBans] = useState<BanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBan, setExpandedBan] = useState<number | null>(null);

  useEffect(() => {
    loadBans();
  }, []);

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Moderation</h3>
        <button className="btn btn-secondary btn-sm" onClick={loadBans} disabled={loading}>
          Refresh
        </button>
      </div>
      {/* existing live ban UI */}
      <AdminSectionPlaceholder
        title="Warnings"
        body="Additional moderation tools are not available yet in phase 1."
      />
    </section>
  );
}
```

- [ ] **Step 4: Render `AdminModerationSection` from the workspace shell**

```tsx
{activeTab === 'moderation' && <AdminModerationSection />}
```

- [ ] **Step 5: Run the focused tests to verify the moderation move passes**

Run:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/AdminSettingsTab.test.tsx
```

- [ ] **Step 6: Commit the moderation extraction**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminModerationSection.tsx
git commit -m "feat: move admin ban list into moderation section"
```

## Task 3: Add Guide-Compliant Shared Placeholder Infrastructure

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminSectionPlaceholder.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`

- [ ] **Step 1: Write the failing placeholder test**

```tsx
it('renders guide-compliant placeholder copy without fake actions', () => {
  render(
    <AdminSectionPlaceholder
      title="Audit Log"
      body="Audit history is not available yet."
      actionLabel="Export"
      disabledActionReason="Export will unlock when audit events are wired."
    />
  );

  expect(screen.getByRole('heading', { name: 'Audit Log' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  expect(screen.getByText('Export will unlock when audit events are wired.')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the placeholder test to verify it fails**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
FAIL ... Cannot find module './AdminSectionPlaceholder'
```

- [ ] **Step 3: Implement the shared placeholder component with heading and button patterns from `UI_GUIDE.md`**

```tsx
interface AdminSectionPlaceholderProps {
  title: string;
  body: string;
  actionLabel?: string;
  disabledActionReason?: string;
}

export function AdminSectionPlaceholder(props: AdminSectionPlaceholderProps) {
  return (
    <section className="settings-section admin-placeholder-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">{props.title}</h3>
        {props.actionLabel ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
      <div className="admin-empty">
        <p>{props.body}</p>
        {props.disabledActionReason ? <p>{props.disabledActionReason}</p> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add token-only CSS for the shared placeholder surface**

```css
.admin-placeholder-section {
  display: grid;
  gap: var(--space-sm);
}

.admin-empty {
  padding: var(--space-lg);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}
```

- [ ] **Step 5: Run the placeholder test to verify it passes**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

- [ ] **Step 6: Commit the shared placeholder groundwork**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/components/SettingsModal/admin/AdminSectionPlaceholder.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
git commit -m "feat: add admin workspace placeholder sections"
```

## Task 4: Build The Channels, Users, And Audit Sections

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminAuditLogSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`

- [ ] **Step 1: Write the failing section-rendering tests**

```tsx
it('renders the channels management overview and request queue', () => {
  render(<AdminChannelsSection />);

  expect(screen.getByRole('heading', { name: 'Channels' })).toBeInTheDocument();
  expect(screen.getByText('Existing Channels')).toBeInTheDocument();
  expect(screen.getByText('Channel Requests')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Delete Channel' })).toBeDisabled();
});

it('renders inline approve and deny actions for each channel request row', () => {
  render(<AdminChannelsSection />);

  expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
});

```

- [ ] **Step 2: Run the section tests to verify they fail**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
FAIL ... Cannot find module './AdminChannelsSection'
```

- [ ] **Step 3: Implement the channels overview section with honest disabled actions**

```tsx
export function AdminChannelsSection() {
  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Channels</h3>
      </div>
      <div className="admin-card">
        <h4 className="heading-label">Existing Channels</h4>
        <div className="admin-table-placeholder">Channel management overview will render here.</div>
      </div>
      <div className="admin-card">
        <h4 className="heading-label">Channel Requests</h4>
        <div className="admin-table-placeholder">
          Request rows render inline approve and deny actions beside status.
        </div>
      </div>
      <div className="admin-action-row">
        <button type="button" className="btn btn-secondary btn-sm" disabled>Create Channel</button>
        <button type="button" className="btn btn-danger btn-sm" disabled>Delete Channel</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement the users and audit sections**

```tsx
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

export function AdminAuditLogSection() {
  return (
    <AdminSectionPlaceholder
      title="Audit Log"
      body="A chronological audit list will appear here once admin event data is available."
    />
  );
}
```

- [ ] **Step 5: Wire all sections into `AdminSettingsTab.tsx`**

```tsx
{activeTab === 'channels' && <AdminChannelsSection />}
{activeTab === 'users' && <AdminUsersSection />}
{activeTab === 'moderation' && <AdminModerationSection />}
{activeTab === 'audit-log' && <AdminAuditLogSection />}
```

- [ ] **Step 6: Run the section tests to verify they pass**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
PASS src/components/SettingsModal/AdminSettingsTab.test.tsx
```

- [ ] **Step 7: Commit the section implementation**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminUsersSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminAuditLogSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
git commit -m "feat: add admin workspace content sections"
```

## Task 5: Implement The Real Groups Editor

**Files:**
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`
- Modify: `src/Brmble.Web/src/hooks/useAclAdmin.ts` (if existing save paths can carry group create/delete updates)
- Modify: `src/Brmble.Server/src` ACL-related endpoints/services only if current backend cannot persist group lifecycle edits through the existing ACL update path
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`

- [ ] **Step 1: Verify the existing persistence path for group create/delete**

Check:

```text
src/Brmble.Web/src/hooks/useAclAdmin.ts
src/Brmble.Web/src/types/acl.ts
src/Brmble.Server/Mumble/AclAdminEndpoints.cs
related ACL coordinator/service files used by setChannel
```

Expected result:

```text
Either the current ACL update request already supports adding/removing groups by saving a modified groups array, or the plan must extend the backend before calling the feature complete.
```

- [ ] **Step 2: Write the failing groups editor tests**

```tsx
it('renders add/delete actions and save controls for groups', () => {
  render(<AdminGroupsSection />);

  expect(screen.getByRole('button', { name: 'Add Group' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Group' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
});

it('creates and deletes staged groups before save', () => {
  render(<AdminGroupsSection />);

  fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
  expect(screen.getByText('New Group')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Delete Group' }));
  expect(screen.queryByText('New Group')).not.toBeInTheDocument();
});

it('saves the edited groups through the ACL-backed persistence path', async () => {
  render(<AdminGroupsSection />);

  fireEvent.click(screen.getByRole('button', { name: 'Add Group' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

  await waitFor(() => {
    expect(saveSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the groups editor test to verify it fails**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
```

Expected:

```text
FAIL ... Cannot find module './AdminGroupsSection'
```

- [ ] **Step 4: Implement the staged groups editor UI**

```tsx
export function AdminGroupsSection() {
  const [selectedGroup, setSelectedGroup] = useState('Officers');
  const [draftGroups, setDraftGroups] = useState(DEFAULT_GROUPS);

  return (
    <section className="settings-section admin-section">
      <div className="admin-panel-header">
        <h3 className="heading-section settings-section-title">Groups</h3>
      </div>
      <div className="admin-groups-layout">
        <div className="admin-card">
          <h4 className="heading-label">Groups List</h4>
          {/* group list */}
          <div className="admin-action-row">
            <button type="button" className="btn btn-secondary btn-sm">Add Group</button>
            <button type="button" className="btn btn-danger btn-sm">Delete Group</button>
          </div>
        </div>
        <div className="admin-card">{/* available users / transfer actions / members */}</div>
      </div>
      <div className="admin-card">
        <h4 className="heading-label">Group Permissions</h4>
        {/* permission checklists by category */}
      </div>
      <div className="admin-footer-row">
        <button type="button" className="btn btn-secondary">Cancel</button>
        <button type="button" className="btn btn-primary">Save Changes</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Hook `Save Changes` to real persistence and extend backend if needed**

```tsx
const handleSave = () => {
  save({
    inheritAcls: snapshot.inheritAcls,
    groups: draftGroups,
    acls: draftRules,
  });
};
```

If step 1 showed the existing path is insufficient, add the minimal server-side support required so create/delete persists through the same ACL update flow instead of inventing a separate groups-only API unless the current model makes that impossible.

- [ ] **Step 6: Wire the real groups editor into the admin workspace**

```tsx
{activeTab === 'groups' && <AdminGroupsSection />}
```

- [ ] **Step 7: Run the groups editor tests to verify they pass**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
PASS src/components/SettingsModal/AdminSettingsTab.test.tsx
```

- [ ] **Step 8: Commit the real groups editor**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
git commit -m "feat: add real groups editor to admin workspace"
```

## Task 6: Add Channel Typed-Delete And Inline Request Actions

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- Modify: `src/Brmble.Web/src/hooks/usePrompt.tsx` only if existing typed prompt behavior needs a small extension

- [ ] **Step 1: Write the failing channel action tests**

```tsx
it('opens a typed confirmation before deleting the selected channel', async () => {
  render(<AdminChannelsSection />);

  fireEvent.click(screen.getByRole('row', { name: /Officer Chat/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Channel' }));

  await waitFor(() => {
    expect(promptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete Channel',
        message: expect.stringContaining('Officer Chat'),
        placeholder: 'Officer Chat',
        confirmLabel: 'Delete',
      }),
    );
  });
});

it('renders approve and deny actions inline with request status', () => {
  render(<AdminChannelsSection />);

  expect(screen.getByRole('button', { name: 'Approve Mike request' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deny Mike request' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the channel action tests to verify they fail**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
FAIL ... delete prompt not called or request action buttons missing
```

- [ ] **Step 3: Implement selected-row delete with typed confirmation**

```tsx
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
  // existing or future delete action hook
};
```

- [ ] **Step 4: Render request actions inline with each request row status**

```tsx
<div className="admin-request-status-cell">
  <span className="admin-request-status">Pending</span>
  <div className="admin-request-actions">
    <button type="button" className="btn btn-secondary btn-sm" aria-label={`Approve ${request.requestedBy} request`}>
      Approve
    </button>
    <button type="button" className="btn btn-danger btn-sm" aria-label={`Deny ${request.requestedBy} request`}>
      Deny
    </button>
  </div>
</div>
```

- [ ] **Step 5: Run the channel action tests to verify they pass**

Run:

```bash
npm run test -- src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

- [ ] **Step 6: Commit the channel action behavior**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/hooks/usePrompt.tsx
git commit -m "feat: add safe channel delete and request row actions"
```

## Task 7: Apply UI Guide Styling, Accessibility, And Modal Regression Coverage

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx`
- Modify: `docs/UI_GUIDE.md` (only if execution reveals a missing pattern that cannot be expressed with current rules)

- [ ] **Step 1: Write the failing regression tests for admin mounting and disabled-action messaging**

```tsx
it('shows Admin tab only when the user has admin permissions', () => {
  vi.mocked(usePermissions).mockReturnValue({ hasPermission: () => true });
  render(<SettingsModal isOpen onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
});

it('keeps disabled admin actions paired with visible explanatory text', () => {
  render(<AdminChannelsSection />);
  expect(screen.getByRole('button', { name: 'Create Channel' })).toBeDisabled();
  expect(screen.getByText(/not available yet|request/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the regression tests to verify they fail or expose missing coverage**

Run:

```bash
npm run test -- src/components/SettingsModal/SettingsModal.test.tsx src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected:

```text
FAIL or missing assertions proving admin visibility and explanatory copy
```

- [ ] **Step 3: Finish the CSS and accessibility pass using only shared tokens and guide patterns**

```css
.admin-workspace-body {
  display: grid;
  gap: var(--space-lg);
}

.admin-card {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.admin-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
```

- [ ] **Step 4: Update tests until they prove guide-compliant behavior**

```tsx
expect(screen.getByRole('tablist', { name: 'Admin sections' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: 'Channels' })).toHaveAttribute('aria-selected', 'true');
expect(screen.getByRole('heading', { name: 'Channels' })).toHaveClass('heading-section');
```

- [ ] **Step 5: Run the targeted admin test suite**

Run:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx src/components/SettingsModal/SettingsModal.test.tsx
```

Expected:

```text
PASS src/components/SettingsModal/AdminSettingsTab.test.tsx
PASS src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
PASS src/components/SettingsModal/SettingsModal.test.tsx
```

- [ ] **Step 6: Run the frontend build**

Run:

```bash
npm run build
```

Expected:

```text
vite build
... built successfully
```

- [ ] **Step 7: Commit the polish and verification pass**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx docs/UI_GUIDE.md
git commit -m "feat: finish settings admin workspace polish"
```

## Spec Coverage Check

- Workspace replaces the old `Ban List / Channel Requests / Registered Users` model: covered by Tasks 1, 2, and 4.
- Five top-level admin sections: covered by Tasks 1 and 4.
- Ban list moved into `Moderation`: covered by Task 2.
- Honest partial-support states and disabled actions: covered by Tasks 3, 4, 6, and 7.
- Channel delete safety and inline request actions: covered by Task 6.
- Banned-user review and unban access inside `Users`: covered by Task 4.
- Real group add/delete/save behavior: covered by Task 5.
- `UI_GUIDE.md` compliance as a hard constraint: covered by Tasks 3 and 7.
- Room for future ACL-backed and audit-backed expansion without another IA rewrite: covered by the extracted section structure in Tasks 2 through 6.

## Verification Commands

Run from `src/Brmble.Web`:

```bash
npm run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx src/components/SettingsModal/SettingsModal.test.tsx
npm run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
npm run build
```
