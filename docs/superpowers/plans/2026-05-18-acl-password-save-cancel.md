# ACL Password Save Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ACL editor's single `Apply Password` action with contextual `Cancel` and highlighted `Save` actions that appear only when required or when the password draft changes.

**Architecture:** Keep the behavior local to `AclEditorDialog`. Reuse existing `passwordInput`, `passwordEntryValue`, and `passwordDirty` state, adding derived booleans for visibility and validity instead of introducing new persisted state.

**Tech Stack:** React + TypeScript, Vitest + Testing Library, existing Brmble CSS token system.

---

## File Structure

- Modify `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`: add tests for contextual password actions and cancel revert behavior.
- Modify `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`: replace `Apply Password` with a `Cancel` / `Save` action row and derived visibility/disabled behavior.
- Modify `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`: add a compact password action row using existing button classes and design tokens.

---

### Task 1: Password Action Tests

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.test.tsx`

- [ ] **Step 1: Add a test for dirty existing password actions**

Insert this test after `preserves the password marker rule while exposing the simple password field`:

```tsx
  it('shows cancel and highlighted save only when an existing password changes', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Channel password selector');

    expect(screen.queryByRole('button', { name: 'Cancel password change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save password' })).not.toBeInTheDocument();

    fireEvent.change(passwordInput, { target: { value: '#new-secret' } });

    expect(screen.getByRole('button', { name: 'Cancel password change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save password' })).toHaveClass('btn-primary');

    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(savePassword).toHaveBeenCalledWith('#new-secret');
  });
```

- [ ] **Step 2: Add a test for cancel revert**

Insert this test after the dirty existing password test:

```tsx
  it('reverts unsaved password changes when cancel is pressed', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:#secret', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '#secret', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    const passwordInput = screen.getByLabelText('Channel password selector');

    fireEvent.change(passwordInput, { target: { value: '#draft-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel password change' }));

    expect(passwordInput).toHaveValue('#secret');
    expect(screen.queryByRole('button', { name: 'Cancel password change' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save password' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Add a test for required empty password**

Insert this test after the cancel revert test:

```tsx
  it('requires saving a non-empty password when password protection has no saved value', () => {
    hookSnapshot = {
      ...hookSnapshot,
      groups: [],
      acls: [
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '__brmble_password_marker__:', allow: 0, deny: 0 },
        { applyHere: true, applySubs: false, inherited: false, userId: null, group: '', allow: 6, deny: 0 },
      ],
    };

    render(<AclEditorDialog isOpen channelId={4} channelName="Secret" onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel password change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Channel password selector'), { target: { value: '#new-secret' } });

    expect(screen.getByRole('button', { name: 'Save password' })).not.toBeDisabled();
  });
```

- [ ] **Step 4: Update the existing save assertion test**

In `preserves the password marker rule while exposing the simple password field`, replace:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Apply Password' }));
```

with:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
```

- [ ] **Step 5: Run tests and verify they fail for the intended reason**

Run: `npm run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: tests fail because `Cancel password change` and `Save password` buttons do not exist yet, or because the old `Apply Password` button is still rendered.

---

### Task 2: Password Action Implementation

**Files:**
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.tsx`
- Modify: `src/Brmble.Web/src/components/AclEditor/AclEditorDialog.css`

- [ ] **Step 1: Add derived action state**

In `AclEditorDialog.tsx`, after:

```tsx
  const passwordEntryValue = passwordEntry?.selector ?? '';
  const passwordDirty = passwordInput !== passwordEntryValue;
```

add:

```tsx
  const passwordRequiresValue = !!passwordEntry && passwordEntryValue.trim().length === 0;
  const passwordCanSave = passwordDirty && passwordInput.trim().length > 0;
  const showPasswordActions = !!passwordEntry && (passwordRequiresValue || passwordDirty);
```

- [ ] **Step 2: Replace Apply Password with action row**

In `AclEditorDialog.tsx`, replace the existing `Apply Password` button block:

```tsx
                      <button
                        className="btn btn-secondary acl-inline-action"
                        type="button"
                        disabled={interactionsDisabled || !passwordDirty}
                        onClick={() => savePassword(passwordInput)}
                      >
                        Apply Password
                      </button>
```

with:

```tsx
                      {showPasswordActions && (
                        <div className="acl-password-actions">
                          <button
                            className="btn btn-secondary acl-password-action"
                            type="button"
                            disabled={interactionsDisabled}
                            onClick={() => setPasswordInput(passwordEntryValue)}
                            aria-label="Cancel password change"
                          >
                            Cancel
                          </button>
                          <button
                            className="btn btn-primary acl-password-action"
                            type="button"
                            disabled={interactionsDisabled || !passwordCanSave}
                            onClick={() => savePassword(passwordInput)}
                            aria-label="Save password"
                          >
                            Save
                          </button>
                        </div>
                      )}
```

- [ ] **Step 3: Add CSS for the action row**

In `AclEditorDialog.css`, replace the current `.acl-inline-action` rule if it is only used by password, or leave it unused and add:

```css
.acl-password-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.acl-password-action {
  min-width: 0;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npm run test -- src/components/AclEditor/AclEditorDialog.test.tsx`

Expected: all ACL editor tests pass.

---

### Task 3: Verification

**Files:**
- No source edits unless verification finds an issue.

- [ ] **Step 1: Run password-related tests**

Run: `npm run test -- src/components/AclEditor/AclEditorDialog.test.tsx src/hooks/usePrompt.test.tsx`

Expected: all listed tests pass.

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`

Expected: command exits 0.

- [ ] **Step 3: Build frontend**

Run: `npm run build`

Expected: Vite build succeeds and writes `dist/`.

- [ ] **Step 4: Build client so frontend assets copy**

Run from repo root: `dotnet build "src/Brmble.Client/Brmble.Client.csproj"`

Expected: build succeeds with 0 errors.

- [ ] **Step 5: Run client for manual verification**

Run from repo root: `dotnet run --project "src/Brmble.Client"`

Expected: desktop client launches using copied frontend assets. In the edit permissions password card, existing password actions are hidden until edit; empty required password shows actions; Save is highlighted and disabled until non-empty; Cancel restores previous password.

---

## Self-Review

- Spec coverage: The plan covers Save/Cancel labels, right/left layout, highlighted Save, dirty-only visibility, required empty password visibility, and cancel revert.
- Placeholder scan: No placeholders remain.
- Type consistency: Uses existing `passwordInput`, `passwordEntryValue`, `passwordDirty`, `savePassword`, and Testing Library APIs already present in the file.
