# Admin Channel Position Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Mumble channel positions in the admin channel list and notify admins when a position save fails.

**Architecture:** Keep the position display local to `AdminChannelsSection`, which already receives channel metadata. Route `admin.channelUpdateError` through `App.tsx` because top-right notifications are centralized there.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Brmble bridge and `<Notification>` system.

---

## File Structure

- Modify `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx` to render a right-aligned position pill in each admin channel row.
- Modify `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css` to style the channel row as a left/right flex row and style the position pill with existing CSS tokens.
- Modify `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx` to assert position pills render, including default `Position 0`.
- Modify `src/Brmble.Web/src/App.tsx` to listen for `admin.channelUpdateError`, register an info notification, and render it in the existing notification stack.
- Modify or add an app-level test in `src/Brmble.Web/src/App.*.test.tsx` for the notification event.

---

### Task 1: Render Position Pills In Admin Channel Rows

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`

- [ ] **Step 1: Write the failing tests**

In `src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx`, add assertions to the existing channels overview test, or add this focused test near the existing channel tests:

```tsx
it('shows each admin channel position in a right-side label', () => {
  render(<AdminChannelsSection channels={[
    { id: 1, name: 'Root', position: 0 },
    { id: 2, name: 'Raid', position: 12 },
    { id: 3, name: 'No Position' },
  ]} />);

  expect(screen.getByRole('row', { name: 'Root Position 0' })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: 'Raid Position 12' })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: 'No Position Position 0' })).toBeInTheDocument();
  expect(screen.getAllByText('Position 0')).toHaveLength(2);
  expect(screen.getByText('Position 12')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- --run src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected: FAIL because `Position 0` and `Position 12` are not rendered in admin channel rows.

- [ ] **Step 3: Implement the position pill markup**

In `src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx`, replace the row content:

```tsx
{channel.name}
```

with:

```tsx
<span className="admin-channel-row-name">{channel.name}</span>
<span className="admin-channel-position-pill">Position {channel.position ?? 0}</span>
```

Update the row `aria-label` from:

```tsx
aria-label={channel.name}
```

to:

```tsx
aria-label={`${channel.name} Position ${channel.position ?? 0}`}
```

- [ ] **Step 4: Implement token-based styling**

In `src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css`, update `.admin-channel-row`:

```css
.admin-channel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  width: 100%;
  min-width: 0;
  text-align: left;
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: inherit;
  cursor: pointer;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}
```

Add these rules near `.admin-channel-row`:

```css
.admin-channel-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.admin-channel-position-pill {
  flex: 0 0 auto;
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```powershell
npm test -- --run src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- src/Brmble.Web/src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx src/Brmble.Web/src/components/SettingsModal/admin/AdminChannelsSection.tsx src/Brmble.Web/src/components/SettingsModal/AdminSettingsTab.css
git commit -m "fix: show admin channel positions"
```

---

### Task 2: Show Notification When Admin Channel Update Fails

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify or create test: `src/Brmble.Web/src/App.adminChannelUpdate.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/Brmble.Web/src/App.adminChannelUpdate.test.tsx` with the same bridge mock style used by existing `App.*.test.tsx` files. The test should render `<App />`, emit `admin.channelUpdateError`, and assert notification copy appears:

```tsx
import { render, screen, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import bridge from './bridge';

vi.mock('./bridge', () => {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    default: {
      send: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      }),
      off: vi.fn((event: string, handler: (data: unknown) => void) => {
        handlers.get(event)?.delete(handler);
      }),
      __emit: (event: string, data?: unknown) => {
        handlers.get(event)?.forEach(handler => handler(data));
      },
      __reset: () => handlers.clear(),
    },
  };
});

describe('admin channel update notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (bridge as unknown as { __reset: () => void }).__reset();
  });

  it('shows an info notification when admin channel updates fail', async () => {
    render(<App />);

    await act(async () => {
      (bridge as unknown as { __emit: (event: string, data?: unknown) => void }).__emit('admin.channelUpdateError', { channelId: 7, statusCode: 403 });
    });

    expect(await screen.findByText('Channel position was not saved')).toBeInTheDocument();
    expect(screen.getByText('You need Write permission on that channel. Check the channel ACL if inheritance is disabled.')).toBeInTheDocument();
  });
});
```

If the project has required mocks for `App` tests, copy only the required setup from the nearest existing `App.*.test.tsx` file rather than broadening production code.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
npm test -- --run src/App.adminChannelUpdate.test.tsx
```

Expected: FAIL because `App.tsx` does not listen for `admin.channelUpdateError` or render this notification yet.

- [ ] **Step 3: Add notification state and bridge handler**

In `src/Brmble.Web/src/App.tsx`, add a notification state near the other notification states:

```tsx
const [adminChannelUpdateErrorVisible, setAdminChannelUpdateErrorVisible] = useState(false);
```

Inside the main bridge subscription effect, add a handler before registrations:

```tsx
const onAdminChannelUpdateError = () => {
  setAdminChannelUpdateErrorVisible(true);
  notifQueue.register('admin-channel-update-error', 'info');
};
```

Register it with the other bridge handlers:

```tsx
bridge.on('admin.channelUpdateError', onAdminChannelUpdateError);
```

Unregister it in the cleanup block:

```tsx
bridge.off('admin.channelUpdateError', onAdminChannelUpdateError);
```

- [ ] **Step 4: Render the notification**

In the existing `<div className="notification-stack">`, add this notification near other general app notifications:

```tsx
{adminChannelUpdateErrorVisible && notifQueue.isVisible('admin-channel-update-error') && (
  <Notification
    status="info"
    position="top-right"
    visible={adminChannelUpdateErrorVisible}
    title="Channel position was not saved"
    detail="You need Write permission on that channel. Check the channel ACL if inheritance is disabled."
    onDismiss={() => {
      setAdminChannelUpdateErrorVisible(false);
    }}
    onExited={() => {
      notifQueue.unregister('admin-channel-update-error');
    }}
  />
)}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```powershell
npm test -- --run src/App.adminChannelUpdate.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run focused frontend tests**

Run:

```powershell
npm test -- --run src/App.adminChannelUpdate.test.tsx src/components/SettingsModal/admin/AdminWorkspaceSections.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.adminChannelUpdate.test.tsx
git commit -m "fix: notify when admin channel position save fails"
```

---

### Task 3: Final Verification

**Files:**
- Verify all frontend files touched in Tasks 1 and 2.

- [ ] **Step 1: Run type check**

Run:

```powershell
npm run type-check
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Check git status**

Run:

```powershell
git status --short
```

Expected: only unrelated pre-existing untracked files may remain; all implementation files should be committed.
