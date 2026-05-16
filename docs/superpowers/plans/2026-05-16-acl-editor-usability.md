# ACL Editor Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the channel ACL editor so shared access paths are shown as groups on the left, individual user access is managed on the right, and password protection is visible as part of the same access model.

**Architecture:** Keep the existing canonical ACL snapshot and save flow intact, but add a frontend-only view model that separates shared access entries from direct user entries. Rebuild the `AclEditorDialog` around a two-pane layout, surface the existing password-token behavior as a dedicated left-side card, and preserve a safe fallback path for raw ACL data that the UI still needs to round-trip. Testing stays focused on view-model behavior and UI regressions rather than changing server-side ACL semantics.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Brmble ACL hooks and DTOs

---

## File Structure

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx`
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx`
- Optional create if extraction becomes necessary: `src/Brmble.Web/src/components/AclEditor/aclEditorViewModel.ts`
- Optional test pair if extraction happens: `src/Brmble.Web/src/components/AclEditor/aclEditorViewModel.test.ts`

**Responsibilities:**
- `AclEditorDialog.tsx`: map canonical ACL draft data into left-side shared access cards and right-side direct user controls; own layout, interactions, and save payload translation.
- `AclEditorDialog.css`: implement the two-pane visual split, readable cards, password card, and responsive mobile stacking.
- `AclEditorDialog.test.tsx`: regression coverage for focus retention, password card rendering, left/right split wording, and correct save payloads after editing shared or direct rules.
- `EditChannelDialog.tsx`: either remove the now-redundant password field or replace it with copy that sends admins to the ACL editor, depending on how tightly current flows depend on it.
- `EditChannelDialog.test.tsx`: lock in the agreed password-entry behavior after the ACL editor becomes the primary password surface.
- `aclEditorViewModel.ts` and test: only extract if the dialog mapping logic becomes hard to reason about inline; keep it small and frontend-only.

### Task 1: Add failing UI tests for the new split model

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`

- [ ] **Step 1: Add a failing test for the approved pane headings**

```tsx
it('separates shared groups from users with explicit pane headings', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#main-access', allow: 6, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: 42, group: null, allow: 6, deny: 0 },
    ],
  };

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  expect(screen.getByRole('heading', { name: 'What groups can join this channel' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Which users can join this channel' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test file and verify the new test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL because the current dialog still renders `Local Rules` and does not expose the approved two-pane headings.

- [ ] **Step 3: Add a failing test for password-card visibility in the ACL editor**

```tsx
it('shows a dedicated password access card when a Brmble-managed password token exists', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
    ],
  };

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  expect(screen.getByText('Channel password')).toBeInTheDocument();
  expect(screen.getByDisplayValue('#secret')).toBeInTheDocument();
});
```

- [ ] **Step 4: Re-run the targeted test file and verify this second test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL because password marker rules are currently filtered away and there is no dedicated password card.

- [ ] **Step 5: Add a failing test for direct-user access on the right pane**

```tsx
it('renders direct user access separately from shared group access', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#main-access', allow: 6, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: 42, group: null, allow: 6, deny: 0 },
    ],
  };

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  expect(screen.getByText('Direct user access')).toBeInTheDocument();
  expect(screen.getByText('User 42')).toBeInTheDocument();
});
```

- [ ] **Step 6: Re-run the targeted test file and verify the direct-user test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL because users are currently mixed into the same rule list as tokens and groups.

- [ ] **Step 7: Commit the red test additions**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
git commit -m "test: cover ACL editor usability redesign"
```

### Task 2: Build a frontend view model for shared access, password access, and direct users

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Optional create: `src/Brmble.Web/src/components/AclEditor/aclEditorViewModel.ts`
- Optional test: `src/Brmble.Web/src/components/AclEditor/aclEditorViewModel.test.ts`

- [ ] **Step 1: Write a failing test for preserving password-marker-backed state while exposing a password card**

```tsx
it('preserves the password marker rule while exposing the managed password selector separately', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
    ],
  };
  save.mockClear();

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  fireEvent.change(screen.getByDisplayValue('#secret'), { target: { value: '#new-secret' } });
  fireEvent.click(screen.getByText('Save ACLs'));

  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    acls: expect.arrayContaining([
      expect.objectContaining({ group: '__brmble_password_marker__:#new-secret' }),
      expect.objectContaining({ group: '#new-secret' }),
    ]),
  }));
});
```

- [ ] **Step 2: Run the targeted ACL editor test file and confirm the save-shape test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL because the current editor strips marker rules before building the draft and has no password-aware mapping.

- [ ] **Step 3: Add the minimal view-model types and mapping helpers**

```ts
type SharedAccessKind = 'password' | 'token' | 'group';

interface SharedAccessEntry {
  kind: SharedAccessKind;
  label: string;
  selector: string;
  allow: number;
  deny: number;
  applyHere: boolean;
  applySubs: boolean;
  markerRuleIndex?: number;
  sourceRuleIndex: number;
}

interface DirectUserEntry {
  userId: number;
  allow: number;
  deny: number;
  applyHere: boolean;
  applySubs: boolean;
  sourceRuleIndex: number;
}

const PASSWORD_MARKER_PREFIX = '__brmble_password_marker__:';

function buildSharedAccessEntries(acls: AclRule[]): SharedAccessEntry[] {
  const markerBySelector = new Map<string, number>();
  acls.forEach((rule, index) => {
    if (rule.group?.startsWith(PASSWORD_MARKER_PREFIX)) {
      markerBySelector.set(rule.group.slice(PASSWORD_MARKER_PREFIX.length), index);
    }
  });

  return acls.flatMap((rule, index) => {
    if (rule.inherited || rule.userId != null || !rule.group) return [];
    if (rule.group.startsWith(PASSWORD_MARKER_PREFIX)) return [];

    const isPassword = markerBySelector.has(rule.group);
    return [{
      kind: isPassword ? 'password' : rule.group.startsWith('#') ? 'token' : 'group',
      label: isPassword ? 'Channel password' : rule.group,
      selector: rule.group,
      allow: rule.allow,
      deny: rule.deny,
      applyHere: rule.applyHere,
      applySubs: rule.applySubs,
      markerRuleIndex: markerBySelector.get(rule.group),
      sourceRuleIndex: index,
    }];
  });
}

function buildDirectUserEntries(acls: AclRule[]): DirectUserEntry[] {
  return acls.flatMap((rule, index) => (
    !rule.inherited && rule.userId != null
      ? [{ userId: rule.userId, allow: rule.allow, deny: rule.deny, applyHere: rule.applyHere, applySubs: rule.applySubs, sourceRuleIndex: index }]
      : []
  ));
}
```

- [ ] **Step 4: Update `AclEditorDialog` draft hydration to keep raw ACLs and derive the two frontend collections**

```ts
const [draft, setDraft] = useState<AclDraft | null>(null);

useEffect(() => {
  if (!snapshot) return;
  setDraft({
    inheritAcls: snapshot.inheritAcls,
    groups: snapshot.groups,
    acls: snapshot.acls,
  });
}, [snapshot]);

const sharedAccessEntries = useMemo(
  () => draft ? buildSharedAccessEntries(draft.acls) : [],
  [draft],
);

const directUserEntries = useMemo(
  () => draft ? buildDirectUserEntries(draft.acls) : [],
  [draft],
);
```

- [ ] **Step 5: Add a password-aware update helper that rewrites both token and marker rules together**

```ts
const updatePasswordEntry = (entry: SharedAccessEntry, nextSelector: string) => {
  setDraft(current => {
    if (!current) return current;
    const acls = [...current.acls];
    acls[entry.sourceRuleIndex] = { ...acls[entry.sourceRuleIndex], group: nextSelector };
    if (entry.markerRuleIndex != null) {
      acls[entry.markerRuleIndex] = {
        ...acls[entry.markerRuleIndex],
        group: `${PASSWORD_MARKER_PREFIX}${nextSelector}`,
      };
    }
    return { ...current, acls };
  });
};
```

- [ ] **Step 6: Run the ACL editor tests and confirm the mapping layer now supports the new shape**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: Some tests still fail because the old UI is still rendered, but the new save-shape and data-preservation behavior should now be reachable in code.

- [ ] **Step 7: Commit the view-model groundwork**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx
git commit -m "refactor: add ACL editor shared access view model"
```

### Task 3: Replace the mixed rule list with the approved two-pane layout

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`

- [ ] **Step 1: Add a failing test for the new card labels and direct-user section**

```tsx
it('renders shared access cards with human-readable labels', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#main-access', allow: 6, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: 'vip', allow: 518, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: 42, group: null, allow: 6, deny: 0 },
    ],
  };

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  expect(screen.getByText('Token')).toBeInTheDocument();
  expect(screen.getByText('Group')).toBeInTheDocument();
  expect(screen.getByText('Direct user access')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the ACL editor test file and verify the layout-label test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL because the dialog still renders unlabeled mixed rows.

- [ ] **Step 3: Replace the current local-rules section JSX with the two-pane structure**

```tsx
<section className="acl-split-layout">
  <div className="acl-pane">
    <div className="acl-pane-header">
      <h3 className="heading-section settings-section-title">What groups can join this channel</h3>
      <p className="acl-section-copy">Shared access paths live here: password access, tokens, and named groups.</p>
    </div>
    <div className="acl-card-list">
      {sharedAccessEntries.map(entry => (
        <article key={`${entry.kind}-${entry.sourceRuleIndex}`} className={`acl-access-card acl-access-card--${entry.kind}`}>
          {/* card content */}
        </article>
      ))}
    </div>
  </div>

  <div className="acl-pane">
    <div className="acl-pane-header">
      <h3 className="heading-section settings-section-title">Which users can join this channel</h3>
      <p className="acl-section-copy">Manage one-off access here without editing raw numeric selectors.</p>
    </div>
    <section className="acl-direct-users">
      <h4 className="acl-subheading">Direct user access</h4>
      {/* user rows */}
    </section>
  </div>
</section>
```

- [ ] **Step 4: Add the CSS for split panes, cards, badges, and responsive collapse**

```css
.acl-split-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-lg);
}

.acl-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 0;
}

.acl-card-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.acl-access-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}

.acl-access-badge {
  align-self: flex-start;
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

@media (max-width: 960px) {
  .acl-split-layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Re-run the ACL editor tests and verify the new pane headings and labels pass**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: PASS for the pane-heading and label tests, with any remaining failures concentrated around password editing and user actions that still need wiring.

- [ ] **Step 6: Commit the layout rewrite**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
git commit -m "feat: redesign ACL editor into group and user panes"
```

### Task 4: Wire the password card to the existing managed token workflow

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`

- [ ] **Step 1: Add a failing test for updating the password card value**

```tsx
it('updates the managed password selector from the password card', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
    ],
  };
  save.mockClear();

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Channel password selector'), { target: { value: '#new-secret' } });
  fireEvent.click(screen.getByText('Save ACLs'));

  expect(save).toHaveBeenCalledWith(expect.objectContaining({
    acls: expect.arrayContaining([
      expect.objectContaining({ group: '#new-secret' }),
      expect.objectContaining({ group: '__brmble_password_marker__:#new-secret' }),
    ]),
  }));
});
```

- [ ] **Step 2: Run the ACL editor test file and verify the password-input test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL until the dedicated password input is rendered and wired.

- [ ] **Step 3: Implement the password card input and button copy in the left pane**

```tsx
{entry.kind === 'password' && (
  <label className="acl-field">
    <span className="acl-field-label">Channel password selector</span>
    <input
      className="brmble-input"
      aria-label="Channel password selector"
      value={entry.selector}
      onChange={e => updatePasswordEntry(entry, e.target.value)}
    />
    <span className="acl-field-help">
      Empty means no password protection. Brmble updates only the managed password token rule.
    </span>
  </label>
)}
```

- [ ] **Step 4: Re-run the ACL editor test file and verify password behavior passes**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: PASS for password-card presence and managed-selector update tests.

- [ ] **Step 5: Commit the password-card integration**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
git commit -m "feat: show channel password inside ACL editor"
```

### Task 5: Replace raw user-id editing with direct-user controls that stay compatible with current ACL data

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`

- [ ] **Step 1: Add a failing test for rendering direct users in a dedicated list**

```tsx
it('shows direct users in a dedicated right-side list', () => {
  hookSnapshot = {
    ...hookSnapshot,
    acls: [
      { applyHere: true, applySubs: false, inherited: false, userId: 42, group: null, allow: 6, deny: 0 },
      { applyHere: true, applySubs: false, inherited: false, userId: 84, group: null, allow: 4, deny: 0 },
    ],
  };

  render(<AclEditorDialog isOpen channelId={4} channelName="Main channel" onClose={vi.fn()} />);

  expect(screen.getByText('User 42')).toBeInTheDocument();
  expect(screen.getByText('User 84')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the ACL editor test file and verify the dedicated-list test fails**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: FAIL until the right-side direct-user section is rendered from `directUserEntries`.

- [ ] **Step 3: Add direct-user rows with permission summaries and keep update helpers index-based**

```tsx
<div className="acl-user-list">
  {directUserEntries.map(entry => (
    <article key={`direct-user-${entry.sourceRuleIndex}`} className="acl-user-card">
      <div className="acl-user-card-header">
        <strong>{`User ${entry.userId}`}</strong>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeRule(entry.sourceRuleIndex)}>
          Remove
        </button>
      </div>
      <div className="acl-permissions">
        {permissionRows.map(([label, bit]) => (
          <label key={`${entry.userId}-${label}`}>
            <input
              type="checkbox"
              checked={(entry.allow & bit) !== 0}
              onChange={e => updateRule(entry.sourceRuleIndex, {
                allow: e.target.checked ? entry.allow | bit : entry.allow & ~bit,
              })}
            />
            {`Allow ${label}`}
          </label>
        ))}
      </div>
    </article>
  ))}
</div>
```

- [ ] **Step 4: Re-run the ACL editor tests and verify direct-user rendering passes**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: PASS for dedicated direct-user rendering, while broader search-by-name support can still remain future-facing if the current session/user data is not yet available in this dialog.

- [ ] **Step 5: Commit the direct-user section**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx
git commit -m "feat: separate direct user access in ACL editor"
```

### Task 6: Align the channel edit dialog with the ACL editor as the primary password surface

**Files:**
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx`
- Modify: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx`

- [ ] **Step 1: Add a failing test for the new password guidance copy**

```tsx
it('explains that channel password management lives in the ACL editor', () => {
  render(
    <EditChannelDialog
      isOpen
      initialName="Main channel"
      initialDescription=""
      initialPassword=""
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );

  expect(screen.getByText(/Permissions.*ACL editor/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the edit-channel test file and verify the new copy test fails**

Run: `npm.cmd run test -- src/components/EditChannelDialog/EditChannelDialog.test.tsx`

Expected: FAIL because the current dialog still treats password token entry as a first-class field inside the channel edit form.

- [ ] **Step 3: Replace or demote the old password field with ACL-editor guidance**

```tsx
<div className="form-group">
  <label>Password Access</label>
  <p className="edit-channel-hint">
    Channel password access is managed from the Permissions dialog so it stays visible alongside other group access rules.
  </p>
</div>
```

- [ ] **Step 4: Re-run the edit-channel test file and verify the guidance behavior passes**

Run: `npm.cmd run test -- src/components/EditChannelDialog/EditChannelDialog.test.tsx`

Expected: PASS, with any old password-field-specific tests updated to the new ACL-editor-first model.

- [ ] **Step 5: Commit the password-entry handoff**

```bash
git add src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx
git commit -m "feat: move channel password guidance to ACL editor"
```

### Task 7: Full verification and cleanup

**Files:**
- Modify if needed: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify if needed: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`
- Modify if needed: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`
- Modify if needed: `src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx`

- [ ] **Step 1: Run the focused frontend tests for ACL and channel-edit flows**

Run: `npm.cmd run test -- src/components/AclEditor/AclEditorDialog.test.tsx src/components/EditChannelDialog/EditChannelDialog.test.tsx`

Expected: PASS with all updated usability and password-flow expectations green.

- [ ] **Step 2: Run the existing ACL hook tests to verify the redesign did not break the save/load contract**

Run: `npm.cmd run test -- src/hooks/useAclAdmin.test.tsx`

Expected: PASS with no changes required in the bridge-backed hook API.

- [ ] **Step 3: Run a production build for the web client**

Run: `npm run build`

Expected: PASS with no TypeScript or styling import errors.

- [ ] **Step 4: Manual verification checklist**

Run these checks in the app:

1. Open `Permissions for Main channel` and confirm the left heading says `What groups can join this channel`.
2. Confirm the right heading says `Which users can join this channel`.
3. Verify a managed password token renders as a visible password card.
4. Edit the password card and confirm save preserves the managed marker behavior.
5. Verify direct user rules render in the right pane instead of mixed with groups.
6. Confirm the selector field no longer loses focus while typing.
7. Verify mobile-width layout stacks cleanly into a single column without clipped controls.

Expected: All checks succeed, with no hidden raw selector field as the default primary editing surface.

- [ ] **Step 5: Commit the final verification fixes**

```bash
git add src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.tsx src/Brmble.Web/src/components/EditChannelDialog/EditChannelDialog.test.tsx
git commit -m "feat: ship ACL editor usability redesign"
```

## Self-Review

### Spec coverage

- Two-pane split: covered in Task 3.
- Left pane group wording: covered in Task 3.
- Password card in left pane: covered in Task 4 and Task 6.
- Right pane user focus: covered in Task 5.
- Human-readable language over raw selectors: covered in Tasks 3, 4, and 6.
- Preserve existing ACL semantics and save flow: covered in Task 2 and rechecked in Task 7.

### Placeholder scan

No `TODO`, `TBD`, or “implement later” placeholders remain. Each task names exact files, commands, and expected outcomes.

### Type consistency

The plan consistently uses `SharedAccessEntry`, `DirectUserEntry`, `PASSWORD_MARKER_PREFIX`, and index-based ACL updates built on the existing `AclRule` draft array. Password-specific behavior always rewrites both the visible selector rule and the marker rule together.

