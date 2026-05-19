# Settings Admin Groups Operational Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `Settings > Admin > Groups` into a denser Brmble-native operational editor with a compact groups rail, a three-column membership transfer workspace, and a real permissions matrix.

**Architecture:** Keep the work centered in the existing `AdminGroupsSection` and `AdminSettingsTab.css` files so the layout change stays local to the Groups tab. Add small local configuration for permission categories inside the component, expand the existing test file first, then reshape the JSX and CSS to match the approved operational-panel design without changing backend contracts.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Brmble settings/admin CSS

---

## File Structure

- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`
  - Own the Groups tab structure, local draft state, membership transfer UI, scoped status messaging, and permission matrix rendering.
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`
  - Add regression coverage for the new layout structure and permission rendering before implementation.
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
  - Replace the placeholder-heavy Groups styling with denser operational-panel classes while preserving Brmble visual language.

### Task 1: Lock The New Groups Layout In Tests

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

- [ ] **Step 1: Write the failing layout-and-permissions regression tests**

Add coverage for the approved structure before touching production code:

```tsx
it('renders the selected group in the membership heading and a centered transfer workspace', () => {
  stableSnapshot.groups[0].members = [1];

  render(<AdminGroupsSection />);

  expect(screen.getByRole('heading', { name: 'Available users' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Members of "Officers"' })).toBeInTheDocument();
  expect(screen.getByText('Transfer actions')).toBeInTheDocument();
});

it('renders grouped permission categories for the selected group', () => {
  render(<AdminGroupsSection />);

  expect(screen.getByRole('heading', { name: 'General Permissions' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Moderation Permissions' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Channel Management' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Administrative Permissions' })).toBeInTheDocument();
  expect(screen.getByLabelText('Read Channels')).toBeInTheDocument();
  expect(screen.getByLabelText('Manage Groups')).toBeInTheDocument();
});

it('shows scoped status messaging above the transfer workspace', () => {
  useAclAdminMock.mockReturnValue({
    snapshot: stableSnapshot,
    loading: false,
    error: 'Not connected or invalid channel',
    refresh: vi.fn(),
    save: saveSpy,
  });

  render(<AdminGroupsSection />);

  expect(screen.getByText('Not connected or invalid channel')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused Groups test to verify it fails**

Run: `npm.cmd run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: FAIL because the component still renders `In group`, still lacks the transfer action column label, and still shows the permissions placeholder instead of grouped checkboxes.

- [ ] **Step 3: Refactor the test scaffolding so the new states are easy to exercise**

Reshape the mocks at the top of the test file so individual tests can override them cleanly:

```tsx
const { saveSpy, refreshSpy, useAclAdminMock, useAdminRegisteredUsersMock, stableSnapshot } = vi.hoisted(() => ({
  saveSpy: vi.fn(),
  refreshSpy: vi.fn(),
  useAclAdminMock: vi.fn(),
  useAdminRegisteredUsersMock: vi.fn(),
  stableSnapshot: {
    channelId: 0,
    inheritAcls: true,
    groups: [
      { name: 'Officers', inherited: false, inherit: true, inheritable: true, add: [], remove: [], members: [] },
    ],
    acls: [],
    fetchedAt: '2026-05-19T19:00:00.000Z',
    stale: false,
    warning: null,
    snapshotHash: 'snapshot-hash',
  },
}));

vi.mock('../../../hooks/useAclAdmin', () => ({
  useAclAdmin: () => useAclAdminMock(),
}));

vi.mock('./useAdminRegisteredUsers', () => ({
  useAdminRegisteredUsers: () => useAdminRegisteredUsersMock(),
}));
```

- [ ] **Step 4: Re-run the focused Groups test and keep it red for the right reason**

Run: `npm.cmd run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: FAIL only on the newly added assertions, not because the mocks are broken.

- [ ] **Step 5: Commit the test-first checkpoint**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
git commit -m "test: define groups operational panel layout"
```

### Task 2: Rebuild The Groups JSX Into An Operational Panel

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx`
- Test: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

- [ ] **Step 1: Add local permission category configuration with admin-friendly labels**

Create local configuration near the top of the component so the permission matrix is data-driven:

```tsx
import { Permission } from '../../../types/acl';

interface GroupPermissionOption {
  label: string;
  mask: number;
  disabled?: boolean;
}

interface GroupPermissionCategory {
  title: string;
  options: GroupPermissionOption[];
}

const GROUP_PERMISSION_CATEGORIES: GroupPermissionCategory[] = [
  {
    title: 'General Permissions',
    options: [
      { label: 'Read Channels', mask: Permission.Traverse },
      { label: 'Write Messages', mask: Permission.TextMessage },
      { label: 'Join Channels', mask: Permission.Enter },
      { label: 'Speak', mask: Permission.Speak },
      { label: 'Priority Speaker', mask: Permission.Whisper, disabled: true },
      { label: 'Force Push-To-Talk', mask: Permission.Whisper, disabled: true },
    ],
  },
  {
    title: 'Moderation Permissions',
    options: [
      { label: 'Mute Users', mask: Permission.MuteDeafen },
      { label: 'Move Users', mask: Permission.Move },
      { label: 'Kick Users', mask: Permission.Kick },
      { label: 'Ban Users', mask: Permission.Ban },
      { label: 'View Reports', mask: Permission.Ban, disabled: true },
      { label: 'Manage Warnings', mask: Permission.Ban, disabled: true },
    ],
  },
  {
    title: 'Channel Management',
    options: [
      { label: 'Create Channels', mask: Permission.MakeChannel },
      { label: 'Delete Channels', mask: Permission.Write, disabled: true },
      { label: 'Edit Channel Settings', mask: Permission.Write },
      { label: 'Lock Channels', mask: Permission.Write, disabled: true },
      { label: 'Create Temporary Channels', mask: Permission.MakeTempChannel },
    ],
  },
  {
    title: 'Administrative Permissions',
    options: [
      { label: 'Manage Groups', mask: Permission.Register, disabled: true },
      { label: 'Manage ACL', mask: Permission.Write },
      { label: 'View Logs', mask: Permission.Register, disabled: true },
      { label: 'Server Settings', mask: Permission.Register, disabled: true },
      { label: 'Manage Integrations', mask: Permission.Register, disabled: true },
    ],
  },
];
```

- [ ] **Step 2: Add helpers that derive selected-group permission state from ACL rules**

Keep the logic local and minimal:

```tsx
const selectedGroupPermissions = useMemo(() => {
  if (!selectedGroup) return 0;

  return (snapshot?.acls ?? [])
    .filter(rule => rule.group === selectedGroup.name)
    .reduce((combined, rule) => combined | rule.allow, 0);
}, [selectedGroup, snapshot]);

const hasSelectedPermission = (mask: number) => (selectedGroupPermissions & mask) === mask;
```

- [ ] **Step 3: Restructure the render tree into the three approved work zones**

Replace the current nested cards with:

```tsx
<section className="settings-section admin-section admin-groups-panel">
  <div className="admin-panel-header admin-groups-header">
    <h3 className="heading-section settings-section-title">Groups</h3>
  </div>

  <div className="admin-groups-rail">
    <div className="admin-groups-section-heading">Groups List</div>
    <div className="admin-groups-list">
      {/* compact group rows */}
    </div>
    <div className="admin-action-row admin-groups-actions">
      {/* add/delete buttons */}
    </div>
  </div>

  <div className="admin-groups-transfer">
    <div className="admin-groups-status">
      {/* loading/error text */}
    </div>
    <div className="admin-groups-transfer-grid">
      <div className="admin-groups-pane">
        <h4 className="heading-label">Available users</h4>
        {/* compact rows */}
      </div>
      <div className="admin-groups-transfer-actions">
        <span className="admin-groups-transfer-label">Transfer actions</span>
      </div>
      <div className="admin-groups-pane">
        <h4 className="heading-label">{`Members of "${selectedGroupName}"`}</h4>
        {/* compact rows */}
      </div>
    </div>
  </div>

  <div className="admin-groups-permissions">
    <h4 className="heading-label">Group Permissions</h4>
    {/* categories */}
  </div>

  <div className="admin-footer-row">
    <button type="button" className="btn btn-secondary" onClick={cancelChanges}>Cancel</button>
    <button type="button" className="btn btn-primary" onClick={saveChanges}>Save Changes</button>
  </div>
</section>
```

- [ ] **Step 4: Render the compact user rows and centered action strip without changing the current add/remove behavior**

Use the existing `addMember` and `removeMember` handlers, but move the buttons into denser transfer rows:

```tsx
<div className="admin-groups-user-list">
  {availableUsers.map(user => (
    <div key={user.registrationUserId} className="admin-groups-user-row">
      <div className="admin-user-identity">
        <span className="admin-user-name">{user.registeredName}</span>
        <span className="admin-user-meta">Registered ID {user.registrationUserId}</span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm admin-groups-transfer-button"
        onClick={() => addMember(user.registrationUserId)}
      >
        Add
      </button>
    </div>
  ))}
</div>
```

Mirror that for members with `Remove`.

- [ ] **Step 5: Render the permission categories as real checkbox groups**

Use the configuration from step 1:

```tsx
<div className="admin-groups-permission-sections">
  {GROUP_PERMISSION_CATEGORIES.map(category => (
    <section key={category.title} className="admin-groups-permission-section">
      <h5 className="heading-label">{category.title}</h5>
      <div className="admin-groups-permission-grid">
        {category.options.map(option => (
          <label key={option.label} className="admin-groups-permission-option">
            <input
              type="checkbox"
              checked={hasSelectedPermission(option.mask)}
              disabled
              readOnly
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </section>
  ))}
</div>
```

- [ ] **Step 6: Run the focused Groups test to verify it now passes**

Run: `npm.cmd run test -- src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

Expected: PASS with the new headings, scoped status text, and permission categories rendered.

- [ ] **Step 7: Commit the component restructure**

```bash
git add src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
git commit -m "feat: restructure admin groups editor"
```

### Task 3: Apply The Brmble Operational-Panel Styling

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`
- Test: `src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx`

- [ ] **Step 1: Add dedicated Groups panel layout classes**

Create new scoped CSS rather than overloading generic admin classes:

```css
.admin-groups-panel {
  gap: var(--space-lg);
}

.admin-groups-rail,
.admin-groups-transfer,
.admin-groups-permissions {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
}

.admin-groups-section-heading {
  color: var(--text-muted);
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Replace the oversized group tiles with a compact rail style**

Add denser row styling:

```css
.admin-groups-list {
  display: grid;
  gap: var(--space-2xs);
  max-width: 320px;
}

.admin-groups-list .admin-channel-row {
  min-height: 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
}

.admin-groups-list .admin-channel-row.selected {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 70%, transparent);
}
```

- [ ] **Step 3: Add the three-column transfer workspace styling**

Style the central editor to read like an admin transfer tool:

```css
.admin-groups-transfer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px minmax(0, 1fr);
  gap: var(--space-md);
  align-items: stretch;
}

.admin-groups-pane {
  display: grid;
  gap: var(--space-sm);
  min-height: 280px;
}

.admin-groups-transfer-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  color: var(--text-muted);
}
```

- [ ] **Step 4: Add compact row styling for the user panes and the permissions matrix**

```css
.admin-groups-user-list {
  display: grid;
  gap: var(--space-xs);
}

.admin-groups-user-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-sm);
  align-items: center;
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-overlay) 72%, transparent);
}

.admin-groups-permission-section {
  display: grid;
  gap: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.admin-groups-permission-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-xs) var(--space-md);
}
```

- [ ] **Step 5: Add the responsive fallback for narrow widths**

```css
@media (max-width: 900px) {
  .admin-groups-transfer-grid {
    grid-template-columns: 1fr;
  }

  .admin-groups-transfer-actions {
    flex-direction: row;
    justify-content: flex-start;
  }

  .admin-groups-list {
    max-width: none;
  }
}
```

- [ ] **Step 6: Run the targeted admin settings tests**

Run: `npm.cmd run test -- src/components/SettingsModal/AdminSettingsTab.test.tsx src/components/SettingsModal/admin/AdminGroupsSection.test.tsx src/components/SettingsModal/admin/AdminUsersSection.test.tsx`

Expected: PASS with all related admin-settings tests green.

- [ ] **Step 7: Commit the styling pass**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminGroupsSection.test.tsx
git commit -m "style: polish admin groups operational panel"
```

## Self-Review

- Spec coverage check:
  - Compact groups rail: covered in Task 2 step 3 and Task 3 step 2.
  - Three-column membership transfer workspace: covered in Task 1 step 1, Task 2 steps 3-4, and Task 3 step 3.
  - Scoped status messaging: covered in Task 1 step 1 and Task 2 step 3.
  - Permissions matrix: covered in Task 1 step 1, Task 2 steps 1, 2, and 5, plus Task 3 step 4.
  - Responsive behavior: covered in Task 3 step 5.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” placeholders remain in the plan.
- Type consistency:
  - Uses existing `Permission` masks from `src/Brmble.Web/src/types/acl.ts`.
  - Keeps `addMember`, `removeMember`, and `save` behavior inside `AdminGroupsSection`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-settings-admin-groups-operational-panel.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
