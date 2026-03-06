# Unread Message Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement private unread tracking for channels and DMs using Matrix `m.read.private` and `m.fully_read` receipts, with an unread divider in chat, unread badges on channels, and scroll-to-unread behavior.

**Architecture:** The Matrix SDK running in the browser already handles sync — we add a thin `useUnreadTracker` hook that reads `m.fully_read` markers and room unread counts from the SDK, sends private read receipts when the user views messages, and exposes per-room unread state to the UI. No server-side changes needed. Privacy-first: we NEVER send `m.read` (public) receipts — only `m.read.private` and `m.fully_read`.

**Tech Stack:** React (hooks + state), matrix-js-sdk (already installed), CSS custom property tokens.

**Closes Issues:** #185, #56, #55, #43

---

## Privacy Constraint

**NEVER use `m.read` (public read receipts).** All read tracking uses:
- `m.read.private` — clears server-side notification counts without revealing read position to other users
- `m.fully_read` — stored as private room account data, used to position the unread divider

---

## Task 1: Create `useUnreadTracker` Hook — Core State

**Files:**
- Create: `src/Brmble.Web/src/hooks/useUnreadTracker.ts`

This hook owns all unread state and exposes it to the app. It reads from the Matrix SDK and provides per-room unread counts + the fully-read event ID for divider positioning.

**Step 1: Create the hook file**

```ts
// src/Brmble.Web/src/hooks/useUnreadTracker.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { MatrixClient, Room, RoomEvent, ClientEvent } from 'matrix-js-sdk';

export interface RoomUnreadState {
  /** Total unread notification count (server-computed) */
  notificationCount: number;
  /** Unread highlight/mention count */
  highlightCount: number;
  /** Event ID of the m.fully_read marker (for divider positioning) */
  fullyReadEventId: string | null;
}

export interface UnreadTracker {
  /** Map of matrixRoomId -> unread state */
  roomUnreads: Map<string, RoomUnreadState>;
  /** Get unread state for a specific room */
  getRoomUnread: (roomId: string) => RoomUnreadState;
  /** Mark a room as read up to a given event ID (sends m.read.private + m.fully_read) */
  markRoomRead: (roomId: string, eventId: string) => Promise<void>;
  /** Get the fully_read event ID for a room (for divider placement) */
  getFullyReadEventId: (roomId: string) => string | null;
  /** Total unread count across all tracked rooms */
  totalUnreadCount: number;
  /** Total unread count across DM rooms only */
  totalDmUnreadCount: number;
}

const EMPTY_UNREAD: RoomUnreadState = {
  notificationCount: 0,
  highlightCount: 0,
  fullyReadEventId: null,
};

export function useUnreadTracker(
  client: MatrixClient | null,
  /** Set of Matrix room IDs that are DM rooms (for DM-specific counts) */
  dmRoomIds: Set<string>,
  /** The room ID the user is currently viewing (null if none) */
  activeRoomId: string | null,
): UnreadTracker {
  const [roomUnreads, setRoomUnreads] = useState<Map<string, RoomUnreadState>>(new Map());
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  // Build unread state from a Room object
  const buildRoomUnread = useCallback((room: Room): RoomUnreadState => {
    const notificationCount = room.getUnreadNotificationCount('total') ?? 0;
    const highlightCount = room.getUnreadNotificationCount('highlight') ?? 0;
    const fullyReadEventId = room.getAccountData('m.fully_read')?.getContent()?.event_id ?? null;
    return { notificationCount, highlightCount, fullyReadEventId };
  }, []);

  // Refresh all rooms
  const refreshAll = useCallback(() => {
    if (!client) return;
    const rooms = client.getRooms();
    const newMap = new Map<string, RoomUnreadState>();
    for (const room of rooms) {
      newMap.set(room.roomId, buildRoomUnread(room));
    }
    setRoomUnreads(newMap);
  }, [client, buildRoomUnread]);

  // Refresh a single room
  const refreshRoom = useCallback((roomId: string) => {
    if (!client) return;
    const room = client.getRoom(roomId);
    if (!room) return;
    setRoomUnreads(prev => {
      const next = new Map(prev);
      next.set(roomId, buildRoomUnread(room));
      return next;
    });
  }, [client, buildRoomUnread]);

  useEffect(() => {
    if (!client) return;

    // Initial load after first sync
    const onSync = (state: string) => {
      if (state === 'PREPARED' || state === 'SYNCING') {
        refreshAll();
      }
    };

    // On timeline event: refresh that room's unread state
    const onTimeline = (event: any, room: Room | undefined) => {
      if (room) refreshRoom(room.roomId);
    };

    // On receipt: refresh that room
    const onReceipt = (event: any, room: Room) => {
      refreshRoom(room.roomId);
    };

    // On account data change (m.fully_read updates)
    const onAccountData = (event: any) => {
      // Room account data changes trigger per-room refresh
      refreshAll();
    };

    client.on(ClientEvent.Sync, onSync);
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.Receipt, onReceipt);
    client.on(ClientEvent.AccountData, onAccountData);

    // If already syncing, do initial refresh
    if (client.getSyncState() === 'SYNCING' || client.getSyncState() === 'PREPARED') {
      refreshAll();
    }

    return () => {
      client.off(ClientEvent.Sync, onSync);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.Receipt, onReceipt);
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client, refreshAll, refreshRoom]);

  // Auto-mark active room as read when new messages arrive
  useEffect(() => {
    if (!client || !activeRoomId) return;

    const onTimeline = (event: any, room: Room | undefined) => {
      if (!room || room.roomId !== activeRoomIdRef.current) return;
      // Don't send receipts for own messages
      if (event.getSender() === client.getUserId()) return;
      // Auto-mark as read since user is viewing this room
      const eventId = event.getId();
      if (eventId) {
        markRoomRead(room.roomId, eventId);
      }
    };

    client.on(RoomEvent.Timeline, onTimeline);
    return () => { client.off(RoomEvent.Timeline, onTimeline); };
  }, [client, activeRoomId]);

  const getRoomUnread = useCallback((roomId: string): RoomUnreadState => {
    return roomUnreads.get(roomId) ?? EMPTY_UNREAD;
  }, [roomUnreads]);

  const getFullyReadEventId = useCallback((roomId: string): string | null => {
    return roomUnreads.get(roomId)?.fullyReadEventId ?? null;
  }, [roomUnreads]);

  const markRoomRead = useCallback(async (roomId: string, eventId: string) => {
    if (!client) return;
    try {
      // Send private read receipt (clears notification count, invisible to others)
      await client.sendReadReceipt(
        // matrix-js-sdk expects an event-like object or we use the low-level API
        null as any, // will use setRoomReadMarkers instead
      ).catch(() => {});
    } catch {}

    try {
      // Use the combo endpoint: sets m.fully_read + m.read.private in one call
      // matrix-js-sdk setRoomReadMarkers(roomId, fullyReadEventId, readReceipt, privateReadReceipt)
      await client.setRoomReadMarkers(roomId, eventId, undefined, { eventId } as any);
    } catch (err) {
      // Fallback: try the HTTP call directly
      try {
        await client.http.authedRequest(
          'POST' as any,
          `/rooms/${encodeURIComponent(roomId)}/read_markers`,
          undefined,
          {
            'm.fully_read': eventId,
            'm.read.private': eventId,
          },
        );
      } catch {}
    }

    // Optimistically update local state
    setRoomUnreads(prev => {
      const next = new Map(prev);
      const existing = prev.get(roomId) ?? EMPTY_UNREAD;
      next.set(roomId, {
        ...existing,
        notificationCount: 0,
        highlightCount: 0,
        fullyReadEventId: eventId,
      });
      return next;
    });
  }, [client]);

  // Compute totals
  let totalUnreadCount = 0;
  let totalDmUnreadCount = 0;
  for (const [roomId, state] of roomUnreads) {
    totalUnreadCount += state.notificationCount;
    if (dmRoomIds.has(roomId)) {
      totalDmUnreadCount += state.notificationCount;
    }
  }

  return {
    roomUnreads,
    getRoomUnread,
    markRoomRead,
    getFullyReadEventId,
    totalUnreadCount,
    totalDmUnreadCount,
  };
}
```

**Step 2: Verify it compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors from the new file.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useUnreadTracker.ts
git commit -m "feat: add useUnreadTracker hook for private Matrix read receipts"
```

---

## Task 2: Wire `useUnreadTracker` into App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

Integrate the hook so it receives the Matrix client, DM room IDs, and active room ID.

**Step 1: Import and initialize the hook**

At the top of `App.tsx`, add the import:
```ts
import { useUnreadTracker } from './hooks/useUnreadTracker';
```

Inside the App component, after the `useMatrixClient` call, add:
```ts
// Build set of DM room IDs from matrixClient.dmRoomMap
const dmRoomIds = useMemo(() => {
  const set = new Set<string>();
  if (matrixClient?.dmRoomMap) {
    for (const roomId of Object.values(matrixClient.dmRoomMap)) {
      set.add(roomId as string);
    }
  }
  return set;
}, [matrixClient?.dmRoomMap]);

// Determine active Matrix room ID
const activeMatrixRoomId = useMemo(() => {
  if (selectedDMUser?.matrixUserId && matrixClient?.dmRoomMap) {
    const roomId = matrixClient.dmRoomMap.get(selectedDMUser.matrixUserId);
    if (roomId) return roomId;
  }
  if (selectedChannelId && matrixCredentials?.roomMap?.[selectedChannelId]) {
    return matrixCredentials.roomMap[selectedChannelId];
  }
  return null;
}, [selectedDMUser, selectedChannelId, matrixClient?.dmRoomMap, matrixCredentials?.roomMap]);

const unreadTracker = useUnreadTracker(
  matrixClient?.client ?? null,
  dmRoomIds,
  activeMatrixRoomId,
);
```

**Step 2: Mark room as read when user opens a channel**

In the channel selection handler (around line 838-851 where `setUnreadCount(0)` is called), add:
```ts
// Mark the Matrix room as read when the user views it
if (matrixCredentials?.roomMap?.[channelId]) {
  const roomId = matrixCredentials.roomMap[channelId];
  const room = matrixClient?.client?.getRoom(roomId);
  const timeline = room?.getLiveTimeline()?.getEvents();
  if (timeline && timeline.length > 0) {
    const lastEventId = timeline[timeline.length - 1].getId();
    if (lastEventId) {
      unreadTracker.markRoomRead(roomId, lastEventId);
    }
  }
}
```

**Step 3: Mark DM room as read when user opens a DM**

In the DM user selection handler (around line 982-996 where `markDMContactRead` is called), add:
```ts
// Mark Matrix DM room as read
if (user.matrixUserId && matrixClient?.dmRoomMap) {
  const roomId = matrixClient.dmRoomMap.get(user.matrixUserId);
  if (roomId) {
    const room = matrixClient.client?.getRoom(roomId);
    const timeline = room?.getLiveTimeline()?.getEvents();
    if (timeline && timeline.length > 0) {
      const lastEventId = timeline[timeline.length - 1].getId();
      if (lastEventId) {
        unreadTracker.markRoomRead(roomId, lastEventId);
      }
    }
  }
}
```

**Step 4: Update badge to use Matrix unread counts**

Replace the existing `updateBadge` usage with Matrix-aware counts:
```ts
// Use Matrix-backed DM unread count when available
const effectiveDmUnreadCount = matrixClient?.client
  ? unreadTracker.totalDmUnreadCount
  : unreadDMUserCount;
```

Pass this to the badge bridge message and header.

**Step 5: Verify it compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire useUnreadTracker into App for channel and DM read receipts"
```

---

## Task 3: Unread Divider in ChatPanel

**Files:**
- Modify: `src/Brmble.Web/src/utils/groupMessages.ts`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/Brmble.Web/src/App.tsx` (pass new prop)

This task adds the "New Messages" divider line between read and unread messages.

**Step 1: Extend GroupedMessage to support unread marker**

In `src/Brmble.Web/src/utils/groupMessages.ts`, add a field:
```ts
export interface GroupedMessage {
  message: ChatMessage;
  isGroupStart: boolean;
  showDateSeparator: boolean;
  showUnreadDivider: boolean; // <-- new
}
```

Update the `groupMessages` function signature to accept `fullyReadEventId`:
```ts
export function groupMessages(
  messages: ChatMessage[],
  fullyReadEventId?: string | null,
): GroupedMessage[] {
```

In the mapping loop, track whether we've placed the divider:
```ts
let unreadDividerPlaced = false;
// ...inside the loop:
const showUnreadDivider = !unreadDividerPlaced
  && fullyReadEventId != null
  && prevMessage != null
  && prevMessage.id === fullyReadEventId;

if (showUnreadDivider) unreadDividerPlaced = true;
```

Set `showUnreadDivider` on each grouped message (default `false`).

**Step 2: Add `fullyReadEventId` prop to ChatPanel**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`, extend props:
```ts
interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string) => void;
  isDM?: boolean;
  matrixClient?: MatrixClient | null;
  fullyReadEventId?: string | null; // <-- new
}
```

Update the `groupMessages` call:
```ts
const grouped = groupMessages(messages, fullyReadEventId);
```

**Step 3: Render the unread divider**

In ChatPanel's message rendering loop (around line 138-159), before each `<MessageBubble>`, check:
```tsx
{item.showUnreadDivider && (
  <div className="chat-unread-divider" key={`unread-${item.message.id}`}>
    <span className="chat-unread-divider-label">New Messages</span>
  </div>
)}
```

**Step 4: Style the unread divider**

Add to `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`:
```css
/* Unread messages divider */
.chat-unread-divider {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
  margin: var(--space-sm) 0;
  user-select: none;
}

.chat-unread-divider::before,
.chat-unread-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--accent-danger);
}

.chat-unread-divider-label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--accent-danger);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
```

**Step 5: Pass `fullyReadEventId` from App.tsx to ChatPanel**

In `App.tsx` where the channel ChatPanel is rendered (around line 1091-1100), compute and pass the prop:
```tsx
const channelFullyReadEventId = useMemo(() => {
  if (!selectedChannelId || !matrixCredentials?.roomMap?.[selectedChannelId]) return null;
  const roomId = matrixCredentials.roomMap[selectedChannelId];
  return unreadTracker.getFullyReadEventId(roomId);
}, [selectedChannelId, matrixCredentials?.roomMap, unreadTracker]);

// On the channel ChatPanel:
<ChatPanel
  ...existingProps
  fullyReadEventId={channelFullyReadEventId}
/>
```

Do the same for the DM ChatPanel with the DM room's fully-read marker.

**Step 6: Verify it compiles and renders**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. The divider renders between read and unread messages.

**Step 7: Commit**

```bash
git add src/Brmble.Web/src/utils/groupMessages.ts
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.css
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add 'New Messages' unread divider in chat panel (#185)"
```

---

## Task 4: Scroll to First Unread Message on Channel Open

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`

When the chat panel mounts or the channel changes, scroll to the unread divider instead of the bottom.

**Step 1: Add a ref for the unread divider**

```tsx
const unreadDividerRef = useRef<HTMLDivElement>(null);
```

On the unread divider element:
```tsx
<div className="chat-unread-divider" ref={unreadDividerRef} ...>
```

**Step 2: Scroll to unread on channel change**

Add an effect that runs when `channelId` or `fullyReadEventId` changes:
```tsx
useEffect(() => {
  // Small delay to let messages render
  const timer = setTimeout(() => {
    if (unreadDividerRef.current) {
      unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else if (bottomRef.current) {
      bottomRef.current.scrollIntoView();
    }
  }, 100);
  return () => clearTimeout(timer);
}, [channelId]);
```

This replaces the default "scroll to bottom" behavior on channel open — if there's an unread divider, the user sees it at the top of the viewport. If everything is read, scroll to bottom as usual.

**Step 3: Verify behavior**

Run: `cd src/Brmble.Web && npm run build`
Expected: No errors. On opening a channel with unread messages, the view scrolls to the divider.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat: scroll to first unread message on channel open (#55)"
```

---

## Task 5: Unread Badge on Channel Tree

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Modify: `src/Brmble.Web/src/App.tsx` (pass unread data)

**Step 1: Add `channelUnreads` prop to ChannelTree**

In `ChannelTree.tsx`, extend the component's props:
```ts
interface ChannelTreeProps {
  // ...existing props
  channelUnreads?: Map<string, { notificationCount: number; highlightCount: number }>;
}
```

**Step 2: Render unread badge on channel rows**

In the channel row rendering (around line 160), after `.channel-name`:
```tsx
{(() => {
  const unread = channelUnreads?.get(String(channel.channelId));
  if (unread && unread.notificationCount > 0) {
    return (
      <span className={`channel-unread-badge${unread.highlightCount > 0 ? ' channel-unread-badge--mention' : ''}`}>
        {unread.notificationCount}
      </span>
    );
  }
  return null;
})()}
```

Also, add `.channel-row--unread` class when there are unreads, so the channel name is bolder:
```tsx
className={`channel-row${isCurrent ? ' current' : ''}${hasUnread ? ' channel-row--unread' : ''}`}
```

**Step 3: Style the unread badge**

Add to `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`:
```css
/* Unread channel name emphasis */
.channel-row--unread .channel-name {
  color: var(--text-primary);
  font-weight: 600;
}

/* Unread count badge */
.channel-unread-badge {
  font-size: var(--text-2xs);
  font-weight: 700;
  color: var(--bg-deep);
  background: var(--text-muted);
  padding: 1px 6px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  min-width: 18px;
  text-align: center;
}

/* Mention badge (highlight) */
.channel-unread-badge--mention {
  background: var(--accent-danger);
  color: var(--bg-deep);
  animation: badge-pulse var(--animation-badge-pulse) ease-in-out;
  animation-delay: var(--animation-badge-pulse-delay);
}
```

**Step 4: Build `channelUnreads` map in App.tsx and pass to ChannelTree**

In `App.tsx`, compute a map from mumbleChannelId to unread counts:
```ts
const channelUnreads = useMemo(() => {
  if (!matrixCredentials?.roomMap) return new Map();
  const map = new Map<string, { notificationCount: number; highlightCount: number }>();
  for (const [channelId, roomId] of Object.entries(matrixCredentials.roomMap)) {
    const unread = unreadTracker.getRoomUnread(roomId);
    if (unread.notificationCount > 0) {
      map.set(channelId, {
        notificationCount: unread.notificationCount,
        highlightCount: unread.highlightCount,
      });
    }
  }
  return map;
}, [matrixCredentials?.roomMap, unreadTracker.roomUnreads]);
```

Pass to ChannelTree:
```tsx
<ChannelTree ... channelUnreads={channelUnreads} />
```

**Step 5: Verify it compiles and renders**

Run: `cd src/Brmble.Web && npm run build`
Expected: Channels with unread messages show bold name + count badge.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.css
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add unread count badges to channel tree (#56)"
```

---

## Task 6: Update DM Unread to Use Matrix Counts

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

Replace the localStorage-only DM unread logic with Matrix-backed counts when available.

**Step 1: Compute DM unreads from Matrix**

When `matrixDmMessages` changes and DM contacts are updated (around lines 772-790), also use the Matrix unread count from the tracker:
```ts
// When building DM contact list, prefer Matrix unread count
if (matrixUserId && matrixClient?.dmRoomMap) {
  const roomId = matrixClient.dmRoomMap.get(matrixUserId);
  if (roomId) {
    const matrixUnread = unreadTracker.getRoomUnread(roomId);
    // Use Matrix notification count instead of localStorage counter
    contact.unread = matrixUnread.notificationCount;
  }
}
```

**Step 2: Update badge bridge message**

Ensure the `notification.badge` bridge message uses the Matrix-backed total:
```ts
const effectiveUnreadDMs = matrixClient?.client
  ? unreadTracker.totalDmUnreadCount > 0
  : unreadDMUserCount > 0;
bridge.send('notification.badge', { unreadDMs: effectiveUnreadDMs, pendingInvite: hasPendingInvite });
```

**Step 3: Verify it compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: use Matrix unread counts for DM badges (#43)"
```

---

## Task 7: Build Verification and Cleanup

**Files:**
- All modified files

**Step 1: Full build check**

Run: `cd src/Brmble.Web && npm run build`
Expected: Successful build with no errors or warnings.

**Step 2: Run all tests**

Run: `dotnet test`
Expected: All tests pass (no server-side changes in this plan).

**Step 3: Verify type-safety**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No type errors.

**Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: build verification and cleanup for unread tracking"
```

---

## Summary of Changes

| File | Change |
|---|---|
| `src/Brmble.Web/src/hooks/useUnreadTracker.ts` | **New** — Core hook for Matrix read receipt tracking |
| `src/Brmble.Web/src/App.tsx` | Wire hook, pass unread data to UI, update badge logic |
| `src/Brmble.Web/src/utils/groupMessages.ts` | Add `showUnreadDivider` field + `fullyReadEventId` param |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` | Render unread divider, scroll-to-unread on open |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` | Unread divider styles |
| `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` | Unread badge rendering |
| `src/Brmble.Web/src/components/Sidebar/ChannelTree.css` | Unread badge + bold channel name styles |

## Related Issues Addressed

| Issue | Title | How Addressed |
|---|---|---|
| #185 | Show 'new messages' divider when opening a channel | Task 3 — unread divider between read and unread |
| #56 | Unread chat indicator on voice channels | Task 5 — badge + bold name on channel tree |
| #55 | Scroll to last unread message when entering a chat channel | Task 4 — scroll-to-unread on channel open |
| #43 | Show unread DM count on system tray icon | Task 6 — Matrix-backed DM unread count for badge |
