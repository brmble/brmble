# Lobby User Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add right-click context menus to Lobby (root channel) user rows in `Sidebar.tsx`, matching the ChannelTree behaviour: "Send Direct Message" for non-self users, plus a placeholder "Information" item for all users (self and non-self).

**Architecture:** `Sidebar` manages its own `contextMenu` state (same shape as `ChannelTree`). It renders the shared `ContextMenu` component with an `items` array built per-user — DM item shown only for non-self users, Information item always shown. No new components needed.

**Tech Stack:** React 18, TypeScript, existing `ContextMenu` component at `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx`

---

### Task 1: Add context-menu state and handler to Sidebar

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

**Step 1: Import `useState` and `ContextMenu`/`ContextMenuItem` at the top of `Sidebar.tsx`**

Current imports (lines 1-3):
```tsx
import { ChannelTree } from '../ChannelTree';
import type { Channel, User, ConnectionStatus } from '../../types';
import './Sidebar.css';
```

Replace with:
```tsx
import { useState } from 'react';
import { ChannelTree } from '../ChannelTree';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import type { Channel, User, ConnectionStatus } from '../../types';
import './Sidebar.css';
```

**Step 2: Add context-menu state inside the `Sidebar` function body, just after the existing derived values (after line 48)**

Add after:
```tsx
  const nonRootUsers = rootChannel ? users.filter(u => u.channelId !== rootChannel.id) : users;
```

Insert:
```tsx
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    userName: string;
    isSelf: boolean;
  } | null>(null);
```

**Step 3: Wire `onContextMenu` onto each `.root-user-row` div**

Current user row (lines 103-122):
```tsx
              <div
                key={user.session}
                className={`root-user-row${user.self ? ' root-user-self' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                title={user.deafened ? 'Deafened' : user.muted ? 'Muted' : 'Online'}
              >
```

Replace with:
```tsx
              <div
                key={user.session}
                className={`root-user-row${user.self ? ' root-user-self' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                title={user.deafened ? 'Deafened' : user.muted ? 'Muted' : 'Online'}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self });
                }}
              >
```

**Step 4: Render `<ContextMenu>` at the bottom of the `<aside>`, just before the closing tag**

After the `</div>` that closes `.sidebar-channels` (before `</aside>`), add:
```tsx
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            ...(!contextMenu.isSelf && onStartDM ? [{
              label: 'Send Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              label: 'Information',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="8" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              onClick: () => { /* placeholder — implement later */ },
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
```

**Step 5: Build frontend and verify no TypeScript errors**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ...ms` with 0 errors.

**Step 6: Build .NET client**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```
Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx
git commit -m "feat: add right-click context menu to Lobby user rows

Shows 'Send Direct Message' for non-self users and a placeholder
'Information' item for all users, matching ChannelTree behaviour.
Uses the shared ContextMenu component."
```

---

### Also: Add "Information" placeholder to ChannelTree context menu

The user also wants "Information" to appear in the existing ChannelTree right-click (under "Send Direct Message"). Currently ChannelTree only shows the DM option.

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx`

**Step 1: Also update ChannelTree to show menu for self users**

Current guard (line 184-189):
```tsx
                onContextMenu={(e) => {
                  if (!user.self && onStartDM) {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name });
                  }
                }}
```

Replace with (always open menu, track `isSelf`):
```tsx
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, userId: String(user.session), userName: user.name, isSelf: !!user.self });
                }}
```

**Step 2: Update ChannelTree state type to include `isSelf`**

Find the existing state initialisation (line 38 area):
```tsx
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string } | null>(null);
```

Replace with:
```tsx
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; userName: string; isSelf: boolean } | null>(null);
```

**Step 3: Update ChannelTree's `<ContextMenu>` items array to conditionally show DM and always show Information**

Current items (lines 218-230):
```tsx
          items={[
            {
              label: 'Send Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => {
                if (onStartDM) onStartDM(contextMenu.userId, contextMenu.userName);
              },
            },
          ]}
```

Replace with:
```tsx
          items={[
            ...(!contextMenu.isSelf && onStartDM ? [{
              label: 'Send Direct Message',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              ),
              onClick: () => onStartDM(contextMenu.userId, contextMenu.userName),
            }] : []),
            {
              label: 'Information',
              icon: (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="8" />
                  <line x1="12" y1="12" x2="12" y2="16" />
                </svg>
              ),
              onClick: () => { /* placeholder — implement later */ },
            },
          ]}
```

**Step 4: Build and verify**

```bash
cd src/Brmble.Web && npm run build
```
Expected: `✓ built in ...ms` with 0 errors.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelTree.tsx
git commit -m "feat: add Information placeholder and self-user menu to ChannelTree

ChannelTree now opens context menu on right-click for all users
(self and non-self). DM option still hidden for self. Information
placeholder item added below DM for future implementation."
```

---

### Final: dotnet build

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```
Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`
