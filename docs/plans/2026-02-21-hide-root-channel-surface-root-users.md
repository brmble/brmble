# Hide Root Channel & Surface Root Users Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide the Mumble root channel row from the channel tree and display root-channel users in a dedicated grey section between the "Users online" panel and the channel tree.

**Architecture:** All changes are confined to `Sidebar.tsx` and `Sidebar.css`. The root channel and its users are filtered out before being passed to `ChannelTree`, and rendered in a new `.root-users-panel` section inside Sidebar.

**Tech Stack:** React, TypeScript, CSS custom properties (existing design tokens)

---

### Task 1: Create feature branch

**Files:** none

**Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/hide-root-channel-surface-root-users
```

**Step 2: Verify**

```bash
git branch
```
Expected: `* feature/hide-root-channel-surface-root-users`

---

### Task 2: Filter root channel and users in Sidebar.tsx

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

**Step 1: Add root channel and root user derivation**

After the existing `const isReconnecting = ...` line, add:

```ts
const rootChannel = channels.find(ch => ch.parent === undefined);
const rootUsers = rootChannel ? users.filter(u => u.channelId === rootChannel.id) : [];
const nonRootChannels = rootChannel ? channels.filter(ch => ch !== rootChannel) : channels;
const nonRootUsers = rootChannel ? users.filter(u => u.channelId !== rootChannel.id) : users;
```

**Step 2: Update ChannelTree props to use filtered arrays**

Change the `<ChannelTree>` props from:
```tsx
channels={channels}
users={users}
```
to:
```tsx
channels={nonRootChannels}
users={nonRootUsers}
```

**Step 3: Add the root-users-panel JSX between server-status-panel and sidebar-divider**

After the closing `)}` of the `{connected && (...)}` server-status-panel block and before `<div className="sidebar-divider">`, insert:

```tsx
{connected && rootUsers.length > 0 && (
  <div className="root-users-panel">
    {rootUsers.map(user => (
      <div
        key={user.session}
        className={`root-user-row${user.self ? ' root-user-self' : ''}`}
        title={user.muted ? 'Muted' : user.deafened ? 'Deafened' : 'Online'}
      >
        <span className="root-user-status">
          {user.deafened ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4m-4 0h8"/></svg>
          ) : user.muted ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4m-4 0h8"/></svg>
          )}
        </span>
        <span className="root-user-name">{user.name}</span>
        {user.self && <span className="root-self-badge">(you)</span>}
      </div>
    ))}
  </div>
)}
```

**Step 4: Build and verify no TypeScript errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: build succeeds, no type errors.

---

### Task 3: Style the root-users-panel in Sidebar.css

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

**Step 1: Add styles at the end of the file**

```css
/* Root channel users (lobby) */
.root-users-panel {
  padding: 0.375rem 0.5rem;
  margin: 0 0.5rem 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.root-user-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  transition: background var(--transition-fast);
}

.root-user-row:hover {
  background: var(--bg-hover);
}

.root-user-status {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 18px;
  justify-content: center;
  opacity: 0.5;
}

.root-user-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.root-self-badge {
  font-size: 0.625rem;
  color: var(--text-muted);
  padding: 1px 6px;
  background: var(--bg-hover);
  border-radius: 8px;
  margin-left: 4px;
  flex-shrink: 0;
  opacity: 0.7;
}
```

**Step 2: Build and check visually**

```bash
cd src/Brmble.Web && npm run build
```
Expected: build succeeds.

---

### Task 4: Commit

**Step 1: Stage and commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css docs/plans/2026-02-21-hide-root-channel-design.md docs/plans/2026-02-21-hide-root-channel-surface-root-users.md
git commit -m "feat: hide root channel row and surface root users in grey lobby section"
```

---

## Verification

After implementation, confirm:

1. The root channel (id=0) no longer appears as a row in the channel tree.
2. Users in the root channel appear between the "Users online" panel and the channel list.
3. Their names are grey (`var(--text-muted)`).
4. The self user shows `(you)` badge.
5. Mute/deafen icons appear correctly.
6. Users in sub-channels are unaffected.
7. When no users are in the root channel, the root-users-panel is not rendered (no empty gap).
