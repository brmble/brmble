# Screen Share Self-Slot Bugfix Batch Implementation Plan

> **Historical note:** This implementation plan is retained as an implemented historical record for the shipped fix. The task-by-task checklist body below is intentionally preserved as the original implementation record.

**Goal:** Fix the A2 regression where clicking your own sharing row can reserve an empty viewer slot, and move the sharing monitor icon next to the `Sharing` label so mute/deafen indicators remain visible.

**Architecture:** Keep `useScreenShare` as the source of truth for real watched shares and fix the bug in the two sidebar render paths that currently conflate `sharing` and `watching` state. Update the row markup so the status area only handles mute/deafen icons, and move the monitor control into the sharing badge area for both the root sidebar list and the channel tree.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS modules-by-file (`Sidebar.css`, `ChannelTree.css`)

> **Status note:** Implemented. This plan is kept as a historical implementation record for the shipped fix, including the preserved task-by-task checklist.

---

## File Map

- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
  Purpose: stop treating the local sharer as watched; move the monitor control next to `Sharing` for tree rows.
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
  Purpose: apply the same fix to the root-channel user list.
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
  Purpose: keep the status area reserved for mute/deafen icons and style the sharing badge + monitor control together.
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`
  Purpose: style the root sidebar sharing badge + monitor control.
- Create: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
  Purpose: pin down self-share no-op behavior and remote-share toggle behavior in the tree rows.
- Create: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`
  Purpose: pin down the root sidebar row behavior and verify mute/deafen icons still render while sharing.

### Task 1: Lock Down Channel Tree Behavior With Tests

**Files:**
- Create: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Reference: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

- [ ] **Step 1: Write the failing tests for self-share and remote-share behavior**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelTree } from './ChannelTree';

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    Permission: { Move: 'Move' },
    requestPermissions: vi.fn(),
  }),
}));

vi.mock('../../hooks/usePrompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('../../bridge', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../UserTooltip/UserTooltip', () => ({
  UserTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const channels = [
  { id: 1, name: 'Battlebutt' },
];

const makeUser = (overrides: Partial<Parameters<typeof ChannelTree>[0]['users'][number]> = {}) => ({
  session: 11,
  name: 'Brmble_Qy',
  channelId: 1,
  muted: false,
  deafened: false,
  self: false,
  ...overrides,
});

describe('ChannelTree screen share rows', () => {
  it('does not let the local sharer trigger watch behavior', () => {
    const onWatchScreenShare = vi.fn();

    render(
      <ChannelTree
        channels={channels}
        users={[makeUser({ self: true })]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        sharingUserSession={11}
        onWatchScreenShare={onWatchScreenShare}
        activeShares={[]}
        watchingShares={[]}
      />,
    );

    const row = screen.getByText('Brmble_Qy').closest('.user-row');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);
    expect(onWatchScreenShare).not.toHaveBeenCalled();
    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /watch screen share from Brmble_Qy/i })).not.toBeInTheDocument();
  });

  it('keeps remote sharers watchable from the sharing badge area', () => {
    const onWatchScreenShare = vi.fn();
    const onStopWatching = vi.fn();

    render(
      <ChannelTree
        channels={channels}
        users={[makeUser({ session: 22, name: 'Query' })]}
        currentChannelId={1}
        onJoinChannel={vi.fn()}
        onWatchScreenShare={onWatchScreenShare}
        onStopWatching={onStopWatching}
        activeShares={[{ roomName: 'channel-1', userName: 'Query', userId: 22, sessionId: 22, matrixUserId: '@query:test' }]}
        watchingShares={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /watch screen share from Query/i }));
    expect(onWatchScreenShare).toHaveBeenCalledWith('channel-1', 22, '@query:test');
    expect(onStopWatching).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new test file and confirm it fails**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx`

Expected: FAIL because the current implementation still renders a watch button for the local sharer and still routes the local row into `onWatchScreenShare`.

- [ ] **Step 3: Add local-share guards and move the monitor control in `ChannelTree.tsx`**

Update the user-row block so it computes explicit booleans and only renders an interactive monitor button for remote sharers.

```tsx
const share = activeShares?.find(s => s.sessionId === user.session);
const isLocalSharer = user.session === sharingUserSession;
const isRemoteSharer = !!share;
const isSharingUser = isLocalSharer || isRemoteSharer;
const isWatchingUser = !!share && !!watchingShares?.some(s => s.userId === share.userId);

onDoubleClick={isRemoteSharer
  ? () => onWatchScreenShare?.(`channel-${channel.id}`, share.userId, share.matrixUserId)
  : undefined}

<span className="user-status-area">
  {user.deafened && (
    <Icon name="headphones-off" size={11} className="user-status-icon user-status-icon--deaf" strokeWidth={2.5} />
  )}
  {user.muted && (
    <Icon name="mic-off" size={11} className="user-status-icon user-status-icon--muted" strokeWidth={2.5} />
  )}
</span>

{isSharingUser && (
  <span className="sharing-badge">
    <span>Sharing</span>
    {isRemoteSharer && (
      <button
        type="button"
        className={`sharing-badge-toggle${isWatchingUser ? ' sharing-badge-toggle--watching' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isWatchingUser) onStopWatching?.(share.userId);
          else onWatchScreenShare?.(`channel-${channel.id}`, share.userId, share.matrixUserId);
        }}
        aria-label={`${isWatchingUser ? 'Watching' : 'Watch'} screen share from ${user.name}`}
        aria-pressed={isWatchingUser}
      >
        <Icon name="monitor" size={11} className="sharing-badge-icon" stroke="var(--accent-primary)" strokeWidth={2.5} />
      </button>
    )}
    {isLocalSharer && (
      <span className="sharing-badge-icon-wrap" aria-hidden="true">
        <Icon name="monitor" size={11} className="sharing-badge-icon" stroke="var(--accent-primary)" strokeWidth={2.5} />
      </span>
    )}
  </span>
)}
```

- [ ] **Step 4: Add the matching `ChannelTree.css` styles**

Replace the old share-button styling with badge-local styling.

```css
.user-status-area {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  width: 24px;
  flex-shrink: 0;
}

.sharing-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-2xs);
  color: var(--accent-primary);
  padding: 1px var(--space-xs);
  background: var(--accent-primary-subtle);
  border-radius: var(--radius-md);
  margin-left: var(--space-2xs);
  flex-shrink: 0;
}

.sharing-badge-toggle,
.sharing-badge-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sharing-badge-toggle {
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.sharing-badge-toggle:hover {
  background: var(--accent-primary-wash);
}

.sharing-badge-toggle--watching {
  background: var(--accent-secondary-subtle);
}

.sharing-badge-toggle--watching .sharing-badge-icon {
  stroke: var(--accent-secondary) !important;
}
```

- [ ] **Step 5: Run the test file again and confirm it passes**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx`

Expected: PASS with both tests green.

- [ ] **Step 6: Commit the channel-tree slice**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
git commit -m "fix(web): prevent self-share watch in channel tree"
```

### Task 2: Mirror The Fix In The Root Sidebar User List

**Files:**
- Create: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

- [ ] **Step 1: Write the failing root-sidebar tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    Permission: { Move: 'Move' },
    requestPermissions: vi.fn(),
  }),
}));

vi.mock('../../hooks/useServiceStatus', () => ({
  useServiceStatus: () => ({
    statuses: {
      voice: { state: 'idle' },
      chat: { state: 'idle' },
      server: { state: 'idle' },
      livekit: { state: 'idle' },
    },
  }),
}));

vi.mock('../../hooks/useResizable', () => ({
  useResizable: () => ({ width: 340, isDragging: false, handleProps: {} }),
}));

vi.mock('../../contexts/ProfileContext', () => ({
  useProfileFingerprint: () => 'test-fingerprint',
}));

vi.mock('../../hooks/usePrompt', () => ({
  prompt: vi.fn(),
}));

vi.mock('../../bridge', () => ({
  default: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../UserTooltip/UserTooltip', () => ({
  UserTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const channels = [{ id: 0, parent: 0, name: 'Root' }];

describe('Sidebar root share rows', () => {
  it('does not render a watch button for the local sharer in the root list', () => {
    const onWatchScreenShare = vi.fn();

    render(
      <Sidebar
        channels={channels}
        users={[{ session: 11, name: 'Brmble_Qy', channelId: 0, self: true }]}
        connectionStatus="connected"
        onJoinChannel={vi.fn()}
        onSelectChannel={vi.fn()}
        sharingUserSession={11}
        onWatchScreenShare={onWatchScreenShare}
        activeShares={[]}
        watchingShares={[]}
      />,
    );

    const row = screen.getByText('Brmble_Qy').closest('.root-user-row');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);
    expect(onWatchScreenShare).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /watch screen share from Brmble_Qy/i })).not.toBeInTheDocument();
  });

  it('keeps mute and deafen icons visible while a remote user is sharing', () => {
    render(
      <Sidebar
        channels={channels}
        users={[{ session: 22, name: 'Query', channelId: 0, muted: true, deafened: true }]}
        connectionStatus="connected"
        onJoinChannel={vi.fn()}
        onSelectChannel={vi.fn()}
        activeShares={[{ roomName: 'channel-0', userName: 'Query', userId: 22, sessionId: 22 }]}
        watchingShares={[]}
      />,
    );

    expect(screen.getByText('Sharing')).toBeInTheDocument();
    expect(document.querySelector('.user-status-icon--muted')).not.toBeNull();
    expect(document.querySelector('.user-status-icon--deaf')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the root-sidebar tests and confirm they fail**

Run: `npm run test -- src/components/Sidebar/Sidebar.test.tsx`

Expected: FAIL because the current root-row implementation still exposes the local share as watchable and still uses the status area for the monitor button.

- [ ] **Step 3: Apply the same boolean split and badge layout to `Sidebar.tsx`**

Use the same structure as Task 1, adjusted for the root room name.

```tsx
const share = activeShares?.find(s => s.sessionId === user.session);
const isLocalSharer = user.session === sharingUserSession;
const isRemoteSharer = !!share;
const isSharingUser = isLocalSharer || isRemoteSharer;
const isWatchingUser = !!share && !!watchingShares?.some(s => s.userId === share.userId);
const roomName = `channel-${rootChannel?.id ?? 0}`;

onDoubleClick={isRemoteSharer
  ? () => onWatchScreenShare?.(roomName, share.userId, share.matrixUserId)
  : undefined}

<span className="user-status-area">
  {user.deafened && (
    <Icon name="headphones-off" size={11} className="user-status-icon user-status-icon--deaf" strokeWidth="2.5" />
  )}
  {user.muted && (
    <Icon name="mic-off" size={11} className="user-status-icon user-status-icon--muted" strokeWidth="2.5" />
  )}
</span>

{isSharingUser && (
  <span className="sharing-badge">
    <span>Sharing</span>
    {isRemoteSharer ? (
      <button
        type="button"
        className={`sharing-badge-toggle${isWatchingUser ? ' sharing-badge-toggle--watching' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (isWatchingUser) onStopWatching?.(share.userId);
          else onWatchScreenShare?.(roomName, share.userId, share.matrixUserId);
        }}
        aria-label={`${isWatchingUser ? 'Watching' : 'Watch'} screen share from ${user.name}`}
        aria-pressed={isWatchingUser}
      >
        <Icon name="monitor" size={11} className="sharing-badge-icon" stroke="var(--accent-primary)" strokeWidth="2.5" />
      </button>
    ) : (
      <span className="sharing-badge-icon-wrap" aria-hidden="true">
        <Icon name="monitor" size={11} className="sharing-badge-icon" stroke="var(--accent-primary)" strokeWidth="2.5" />
      </span>
    )}
  </span>
)}
```

- [ ] **Step 4: Update `Sidebar.css` to support the moved sharing control**

Add the same badge-local styles used in `ChannelTree.css` so the root list renders consistently.

```css
.sharing-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-2xs);
  color: var(--accent-primary);
  padding: 1px var(--space-xs);
  background: var(--accent-primary-subtle);
  border-radius: var(--radius-md);
  margin-left: var(--space-2xs);
  flex-shrink: 0;
}

.sharing-badge-toggle,
.sharing-badge-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sharing-badge-toggle {
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.sharing-badge-toggle:hover {
  background: var(--accent-primary-wash);
}

.sharing-badge-toggle--watching {
  background: var(--accent-secondary-subtle);
}

.sharing-badge-toggle--watching .sharing-badge-icon {
  stroke: var(--accent-secondary) !important;
}
```

- [ ] **Step 5: Run the root-sidebar tests again and confirm they pass**

Run: `npm run test -- src/components/Sidebar/Sidebar.test.tsx`

Expected: PASS with both tests green.

- [ ] **Step 6: Commit the root-sidebar slice**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
git commit -m "fix(web): move share monitor out of sidebar status slot"
```

### Task 3: Run Focused Regression Verification

**Files:**
- Modify if needed: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify if needed: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

- [ ] **Step 1: Run both new sidebar test files together**

Run: `npm run test -- src/components/Sidebar/ChannelTree.test.tsx src/components/Sidebar/Sidebar.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run the existing screen-share hook tests to make sure no watch-state assumptions broke**

Run: `npm run test -- src/hooks/useScreenShare.test.ts`

Expected: PASS.

- [ ] **Step 3: Run a production web build for final UI safety**

Run: `npm run build`

Expected: Vite build completes successfully with no TypeScript or bundling errors.

- [ ] **Step 4: Perform manual verification in the app**

Manual checklist:

```text
1. Start sharing your own screen.
2. Click and double-click your own row in the current channel.
3. Verify no empty screen-share tile appears.
4. Watch one or more remote shares while still sharing yourself.
5. Verify only remote watched shares appear in the grid.
6. Verify the monitor icon sits next to the Sharing badge for all sharers.
7. Verify muted/deafened sharers still show those icons.
```

- [ ] **Step 5: Commit the verified bugfix batch**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx
git commit -m "fix(web): prevent self-share empty viewer slot"
```

## Self-Review

- Spec coverage: the plan covers local self-share no-op behavior, remote watch toggle preservation, icon relocation, mute/deafen visibility, and regression verification.
- Placeholder scan: removed vague testing language and included concrete test files, commands, and implementation snippets for each step.
- Type consistency: all tasks use the existing `onWatchScreenShare(roomName, userId?, matrixUserId?)` and `onStopWatching(userId)` signatures and keep watch state tied to `ShareInfo`.
