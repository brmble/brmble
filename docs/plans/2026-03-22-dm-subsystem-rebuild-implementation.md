# DM Subsystem Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the DM subsystem so Matrix is the single source of truth for Brmble-to-Brmble DMs, fix 6 known bugs, and extract all DM state from App.tsx into a dedicated `useDMStore` hook.

**Architecture:** New `useDMStore` hook owns all DM state (contacts from `m.direct`, messages from Matrix timeline, Mumble fallback in-memory). `useMatrixClient` is cleaned up to expose DM invite auto-join and a room creation mutex. `App.tsx` delegates all DM logic to the new hook.

**Tech Stack:** React 18, TypeScript, matrix-js-sdk, WebView2 bridge

**Design doc:** `docs/plans/2026-03-22-dm-subsystem-rebuild-design.md`

---

### Task 1: Add DM invite auto-join to useMatrixClient

Fixes Bug 1 (Critical): recipients never join DM rooms because invite events are ignored.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:219-251` (sync handler area)

**Step 1: Add invite handler in the useEffect that creates the Matrix client**

In `useMatrixClient.ts`, inside the `useEffect` that sets up the client (around line 56-270), add a `Room.myMembership` listener after the existing `onSync` and `onTimeline` handlers. This listener fires when the local user's membership in any room changes:

```typescript
// Add after line 256 (after onAccountData handler setup)
const onMyMembership = (room: Room, membership: string) => {
  if (membership === 'invite') {
    // Auto-join DM room invites
    const isDirect = room.getDMInviter() !== null;
    if (isDirect) {
      client.joinRoom(room.roomId).catch(err => {
        console.error(`[Matrix] Failed to auto-join DM room ${room.roomId}:`, err);
      });
    }
  }
};
client.on(RoomMemberEvent.MyMembership as any, onMyMembership);
```

Note: `Room.getDMInviter()` is a matrix-js-sdk helper that returns the user ID of the inviter if the room was marked as a DM invite. If it returns `null`, the room is not a DM. If `getDMInviter` is not available in the SDK version, fall back to checking invite membership count <= 2.

Also add to cleanup on line 261-268:
```typescript
client.removeListener(RoomMemberEvent.MyMembership as any, onMyMembership);
```

**Step 2: Add necessary import**

At the top of `useMatrixClient.ts`, add `Room` to the matrix-js-sdk imports if not already imported, and add `RoomMemberEvent`:
```typescript
import { RoomMemberEvent } from 'matrix-js-sdk';
```

Check the existing imports first -- `Room` may already be imported.

**Step 3: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```
feat: auto-join incoming DM room invites

When a Matrix user receives an invite to a direct message room,
the client now automatically joins the room so messages are received.
Fixes the critical bug where DM recipients never joined created rooms.
```

---

### Task 2: Add room creation mutex to useMatrixClient

Fixes Bug 2 (High): rapid sends can create duplicate DM rooms.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:288-316` (`sendDMMessage` function)

**Step 1: Add pending-creation ref**

After the existing refs (around line 48), add:
```typescript
const pendingRoomCreations = useRef(new Map<string, Promise<string>>());
```

**Step 2: Wrap room creation in sendDMMessage with mutex**

Replace the `sendDMMessage` function (lines 288-316) with:

```typescript
const sendDMMessage = useCallback(async (targetMatrixUserId: string, text: string) => {
  const client = clientRef.current;
  if (!client || !credentials) return;

  let roomId = dmRoomMapRef.current.get(targetMatrixUserId);

  if (!roomId) {
    // Check if a room creation is already in flight for this user
    const pending = pendingRoomCreations.current.get(targetMatrixUserId);
    if (pending) {
      roomId = await pending;
    } else {
      // Create room with mutex
      const createPromise = (async () => {
        const createResult = await client.createRoom({
          is_direct: true,
          invite: [targetMatrixUserId],
          preset: Preset.TrustedPrivateChat,
        });
        const newRoomId = createResult.room_id;

        // Update m.direct account data
        const directEvent = client.getAccountData(EventType.Direct);
        const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
        directContent[targetMatrixUserId] = [newRoomId, ...(directContent[targetMatrixUserId] ?? [])];
        await client.setAccountData(EventType.Direct, directContent);

        // Update local maps
        setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, newRoomId));
        dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(targetMatrixUserId, newRoomId);
        roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(newRoomId, targetMatrixUserId);

        return newRoomId;
      })();

      pendingRoomCreations.current.set(targetMatrixUserId, createPromise);
      try {
        roomId = await createPromise;
      } finally {
        pendingRoomCreations.current.delete(targetMatrixUserId);
      }
    }
  }

  await client.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
}, [credentials]);
```

**Step 3: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new errors

**Step 4: Commit**

```
fix: prevent duplicate DM room creation on rapid sends

Adds a mutex (pendingRoomCreations ref) so concurrent sendDMMessage calls
for the same target user wait for the first createRoom call to complete
instead of each creating their own room.
```

---

### Task 3: Create the useDMStore hook skeleton

This is the core of the rebuild. Create the new hook that will own all DM state.

**Files:**
- Create: `src/Brmble.Web/src/hooks/useDMStore.ts`

**Step 1: Create the hook file with types and skeleton**

```typescript
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { ChatMessage, User } from '../types';

// --- Types ---

export interface DMContact {
  /** Primary key: Matrix user ID for Brmble users, "mumble:session:{id}" for Mumble-only */
  id: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  /** true for Mumble-only contacts (no Matrix ID, ephemeral session) */
  isEphemeral: boolean;
  /** Mumble session ID, used for Mumble fallback sends */
  sessionId?: number;
}

export interface DMStoreOptions {
  /** Matrix DM messages from useMatrixClient, keyed by matrixUserId */
  matrixDmMessages: Map<string, ChatMessage[]> | undefined;
  /** Matrix DM room map from useMatrixClient, keyed by matrixUserId -> roomId */
  matrixDmRoomMap: Map<string, string> | undefined;
  /** Send a Matrix DM */
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  /** Fetch DM history from Matrix */
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
  /** Current live users list */
  users: User[];
  /** Current username (self) */
  username: string;
  /** Bridge send function for Mumble fallback */
  bridgeSend: (event: string, data: unknown) => void;
  /** Matrix unread count for DM rooms */
  matrixDmUnreadCount: number;
}

export interface DMStore {
  // State
  contacts: DMContact[];
  selectedContact: DMContact | null;
  messages: ChatMessage[];
  appMode: 'channels' | 'dm';

  // Actions
  selectContact: (id: string) => void;
  sendMessage: (content: string) => void;
  startDM: (matrixUserId: string, displayName: string) => void;
  clearSelection: () => void;
  toggleMode: () => void;
  closeDM: (id: string) => void;

  // For bridge handler: receive a Mumble private message
  receiveMumbleDM: (senderSession: number, senderName: string, text: string, media?: ChatMessage['media']) => void;

  // Derived
  totalUnreadCount: number;

  // For components that need the raw appMode ref
  appModeRef: React.RefObject<'channels' | 'dm'>;
  selectedContactIdRef: React.RefObject<string | null>;
}

export function useDMStore(options: DMStoreOptions): DMStore {
  const {
    matrixDmMessages,
    matrixDmRoomMap,
    sendMatrixDM,
    fetchDMHistory,
    users,
    username,
    bridgeSend,
    matrixDmUnreadCount,
  } = options;

  // --- Core state ---
  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [mumbleDmMessages, setMumbleDmMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [mumbleContacts, setMumbleContacts] = useState<DMContact[]>([]);

  // --- Refs for bridge callbacks ---
  const appModeRef = useRef<'channels' | 'dm'>('channels');
  const selectedContactIdRef = useRef<string | null>(null);

  useEffect(() => { appModeRef.current = appMode; }, [appMode]);
  useEffect(() => { selectedContactIdRef.current = selectedContactId; }, [selectedContactId]);

  // --- Derive Matrix contacts from m.direct (matrixDmRoomMap) ---
  const matrixContacts: DMContact[] = useMemo(() => {
    if (!matrixDmRoomMap || matrixDmRoomMap.size === 0) return [];

    return Array.from(matrixDmRoomMap.keys()).map(matrixUserId => {
      const user = users.find(u => u.matrixUserId === matrixUserId);
      const msgs = matrixDmMessages?.get(matrixUserId);
      const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

      return {
        id: matrixUserId,
        displayName: user?.name ?? matrixUserId.split(':')[0].replace('@', ''),
        avatarUrl: user?.avatarUrl,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp ? lastMsg.timestamp.getTime() : undefined,
        unreadCount: 0, // Will be filled by unread tracker integration
        isEphemeral: false,
        sessionId: user?.session,
      };
    });
  }, [matrixDmRoomMap, matrixDmMessages, users]);

  // --- Combine Matrix + Mumble contacts, sorted by most recent ---
  const contacts: DMContact[] = useMemo(() => {
    const all = [...matrixContacts, ...mumbleContacts];
    all.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    return all;
  }, [matrixContacts, mumbleContacts]);

  // --- Selected contact ---
  const selectedContact = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find(c => c.id === selectedContactId) ?? null;
  }, [selectedContactId, contacts]);

  // --- Messages for selected contact ---
  const messages: ChatMessage[] = useMemo(() => {
    if (!selectedContactId) return [];

    // Matrix contact
    if (!selectedContactId.startsWith('mumble:session:')) {
      return matrixDmMessages?.get(selectedContactId) ?? [];
    }

    // Mumble fallback
    return mumbleDmMessages.get(selectedContactId) ?? [];
  }, [selectedContactId, matrixDmMessages, mumbleDmMessages]);

  // --- Actions ---

  const selectContact = useCallback((id: string) => {
    setSelectedContactId(id);
    setAppMode('dm');

    // Fetch Matrix DM history if this is a Matrix contact
    if (!id.startsWith('mumble:session:') && fetchDMHistory) {
      fetchDMHistory(id).catch(console.error);
    }
  }, [fetchDMHistory]);

  const startDM = useCallback((matrixUserId: string, displayName: string) => {
    setSelectedContactId(matrixUserId);
    setAppMode('dm');

    if (fetchDMHistory) {
      fetchDMHistory(matrixUserId).catch(console.error);
    }
  }, [fetchDMHistory]);

  const clearSelection = useCallback(() => {
    setSelectedContactId(null);
    setAppMode('channels');
  }, []);

  const toggleMode = useCallback(() => {
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!selectedContactId || !content || !username) return;

    if (!selectedContactId.startsWith('mumble:session:')) {
      // Matrix path
      if (sendMatrixDM) {
        sendMatrixDM(selectedContactId, content).catch(console.error);
      }
    } else {
      // Mumble fallback path
      const sessionId = parseInt(selectedContactId.replace('mumble:session:', ''), 10);
      if (!isNaN(sessionId)) {
        // Add local message
        const msg: ChatMessage = {
          id: `local-${Date.now()}-${Math.random()}`,
          channelId: selectedContactId,
          sender: username,
          content,
          timestamp: new Date(),
        };
        setMumbleDmMessages(prev => {
          const next = new Map(prev);
          const existing = next.get(selectedContactId!) ?? [];
          next.set(selectedContactId!, [...existing, msg]);
          return next;
        });

        // Send via Mumble bridge
        bridgeSend('voice.sendPrivateMessage', {
          message: content,
          targetSession: sessionId,
        });

        // Update Mumble contact lastMessage
        setMumbleContacts(prev => prev.map(c =>
          c.id === selectedContactId
            ? { ...c, lastMessage: content, lastMessageTime: Date.now() }
            : c
        ));
      }
    }
  }, [selectedContactId, username, sendMatrixDM, bridgeSend]);

  const receiveMumbleDM = useCallback((senderSession: number, senderName: string, text: string, media?: ChatMessage['media']) => {
    // Check if this sender has a Matrix ID -- if so, skip (Matrix handles it)
    const senderUser = users.find(u => u.session === senderSession);
    if (senderUser?.matrixUserId) return;

    const contactId = `mumble:session:${senderSession}`;
    const msg: ChatMessage = {
      id: `mumble-${Date.now()}-${Math.random()}`,
      channelId: contactId,
      sender: senderName,
      content: text,
      timestamp: new Date(),
      media,
    };

    // Add message
    setMumbleDmMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(contactId) ?? [];
      next.set(contactId, [...existing, msg]);
      return next;
    });

    // Upsert Mumble contact
    const isViewing = appModeRef.current === 'dm' && selectedContactIdRef.current === contactId;
    setMumbleContacts(prev => {
      const existing = prev.find(c => c.id === contactId);
      if (existing) {
        return prev.map(c => c.id === contactId ? {
          ...c,
          displayName: senderName,
          lastMessage: text,
          lastMessageTime: Date.now(),
          unreadCount: isViewing ? 0 : c.unreadCount + 1,
        } : c);
      }
      return [...prev, {
        id: contactId,
        displayName: senderName,
        lastMessage: text,
        lastMessageTime: Date.now(),
        unreadCount: isViewing ? 0 : 1,
        isEphemeral: true,
        sessionId: senderSession,
      }];
    });
  }, [users]);

  const closeDM = useCallback((id: string) => {
    if (id.startsWith('mumble:session:')) {
      setMumbleContacts(prev => prev.filter(c => c.id !== id));
      setMumbleDmMessages(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
    // For Matrix contacts, we don't remove from m.direct -- just deselect if active
    if (selectedContactId === id) {
      setSelectedContactId(null);
    }
  }, [selectedContactId]);

  // --- Unread count ---
  const mumbleUnreadCount = useMemo(() =>
    mumbleContacts.reduce((sum, c) => sum + c.unreadCount, 0),
  [mumbleContacts]);

  const totalUnreadCount = matrixDmUnreadCount + mumbleUnreadCount;

  // --- Reset on disconnect (users array becomes empty) ---
  useEffect(() => {
    if (users.length === 0) {
      setAppMode('channels');
      setSelectedContactId(null);
      setMumbleDmMessages(new Map());
      setMumbleContacts([]);
    }
  }, [users.length]);

  return {
    contacts,
    selectedContact,
    messages,
    appMode,
    selectContact,
    sendMessage,
    startDM,
    clearSelection,
    toggleMode,
    closeDM,
    receiveMumbleDM,
    totalUnreadCount,
    appModeRef,
    selectedContactIdRef,
  };
}
```

**Step 2: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new errors (the hook is not used yet)

**Step 3: Commit**

```
feat: create useDMStore hook for centralized DM state management

New hook that derives contacts from Matrix m.direct data, handles
Mumble fallback DMs in-memory, and exposes a clean API for all DM
operations. This replaces the ~150 lines of DM state scattered in App.tsx.
```

---

### Task 4: Wire useDMStore into App.tsx and remove old DM state

This is the largest task. We replace all DM state/handlers in App.tsx with the new hook.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add useDMStore import and instantiation**

At the top of App.tsx, add the import:
```typescript
import { useDMStore } from './hooks/useDMStore';
```

Inside the component, after the existing `useMatrixClient` and `useUnreadTracker` calls, instantiate the hook. You need to wire up the `bridgeSend` function -- look for how the bridge is accessed (it's `bridge.send` where `bridge` is from the WebView2 bridge). The `matrixDmUnreadCount` comes from `useUnreadTracker`'s `totalDmUnreadCount`.

```typescript
const dmStore = useDMStore({
  matrixDmMessages: matrixClient.dmMessages,
  matrixDmRoomMap: matrixClient.dmRoomMap,
  sendMatrixDM: matrixClient.sendDMMessage,
  fetchDMHistory: matrixClient.fetchDMHistory,
  users,
  username,
  bridgeSend: (event, data) => bridge.send(event, data),
  matrixDmUnreadCount: unreadTracker.totalDmUnreadCount,
});
```

**Step 2: Remove old DM state declarations**

Remove these lines from App.tsx (approximate line numbers from the investigation):

- Line 182: `const [dmContacts, setDmContacts] = ...`
- Line 183: `const [appMode, setAppMode] = ...` (now owned by dmStore)
- Line 184: `const [selectedDMUserId, setSelectedDMUserIdRaw] = ...`
- Line 185: `const [selectedDMUserName, setSelectedDMUserName] = ...`
- Lines 189-192: `setSelectedDMUserId` wrapper
- Line 161: `const [dmDividerTs, setDmDividerTs] = ...` (keep this -- it's for the unread divider, handled separately)
- Line 346: `const dmKey = ...`
- Line 347: `const { messages: dmMessages, addMessage: addDMMessage } = useChatStore(dmKey);`
- Lines 368-375: `selectedDMUserIdRef`, `appModeRef`, `setAppModeRef`, `addDMMessageRef` refs
- Lines 397-403: `loadDMContacts` useEffect

**Step 3: Remove old DM handler functions**

Remove:
- Lines 1275-1296: `handleSendDMMessage` function (replaced by `dmStore.sendMessage`)
- Lines 1431-1447: `handleSelectDMUser` function (replaced by `dmStore.selectContact` / `dmStore.startDM`)
- Lines 1449-1457: `handleCloseDMConversation` (replaced by `dmStore.closeDM`)
- Lines 1387-1390: `toggleDMMode` (replaced by `dmStore.toggleMode`)
- Lines 1392-1399: `localTotalDmUnreadCount` / `totalDmUnreadCount` (replaced by `dmStore.totalUnreadCount`)
- Lines 1416-1429: `dmContactsWithComments` (contacts are already enriched in useDMStore)
- Lines 1475-1479: `activeDmMessages` selection (replaced by `dmStore.messages`)

**Step 4: Remove DM contact update effect**

Remove lines 1142-1159 (the effect that updates dmContacts from matrixDmMessages). The new hook handles this internally.

**Step 5: Update onVoiceMessage handler to use dmStore**

In the `onVoiceMessage` handler (lines 656-709), replace the DM routing section (lines 694-708) with:

```typescript
// DM routing
const senderSession = d.senderSession as number;
const senderName = d.sender as string;
const text = d.message as string;
dmStore.receiveMumbleDM(senderSession, senderName, text, media);
```

Remove the old code that calls `addDMMessage`, `addMessageToStore`, and `upsertDMContact` for DMs.

**Step 6: Update onServerCredentials to NOT clear DM data**

In `onServerCredentials` (line 634), `clearChatStorage()` still runs but it no longer needs to clear DM contacts (since they come from Matrix). Verify that `clearChatStorage()` in `useChatStore.ts` no longer deletes DM-related keys -- we'll fix that in Task 5.

**Step 7: Update disconnect handler**

In `onVoiceDisconnected` (around line 621), remove `setAppMode('channels')` -- the useDMStore handles this via its `users.length === 0` effect.

**Step 8: Update all references to old DM state**

Replace throughout App.tsx:
- `appMode` -> `dmStore.appMode`
- `setAppMode(...)` -> (use dmStore actions instead, e.g. `dmStore.clearSelection()` or `dmStore.toggleMode()`)
- `selectedDMUserId` -> `dmStore.selectedContact?.id ?? null`
- `selectedDMUserName` -> `dmStore.selectedContact?.displayName ?? ''`
- `totalDmUnreadCount` -> `dmStore.totalUnreadCount`
- `dmContactsWithComments` -> `dmStore.contacts`
- `activeDmMessages` -> `dmStore.messages`
- `handleSendDMMessage` -> `dmStore.sendMessage`
- `handleSelectDMUser` -> update: the old function took `(userId, userName)` where userId was a session ID. The new `dmStore.selectContact` takes a contact `id` (matrixUserId or `mumble:session:X`). Update call sites.
- `handleCloseDMConversation` -> `dmStore.closeDM`
- `toggleDMMode` -> `dmStore.toggleMode`
- `appModeRef` -> `dmStore.appModeRef`
- `selectedDMUserIdRef` -> `dmStore.selectedContactIdRef`

**Step 9: Update DMContactList rendering**

The `DMContactList` component props need updating. Currently it receives:
```tsx
<DMContactList
  contacts={dmContactsWithComments}
  selectedUserId={selectedDMUserId}
  onSelectContact={handleSelectDMUser}
  onCloseConversation={handleCloseDMConversation}
  onlineUserIds={users.filter(u => !u.self).map(u => String(u.session))}
  visible={appMode === 'dm'}
/>
```

Replace with:
```tsx
<DMContactList
  contacts={dmStore.contacts}
  selectedUserId={dmStore.selectedContact?.id ?? null}
  onSelectContact={(id, _name) => dmStore.selectContact(id)}
  onCloseConversation={dmStore.closeDM}
  onlineUserIds={users.filter(u => !u.self).map(u => u.matrixUserId ?? `mumble:session:${u.session}`)}
  visible={dmStore.appMode === 'dm'}
/>
```

Note: The `DMContactList` component's props interface will need updating in Task 6 to match the new `DMContact` shape from useDMStore.

**Step 10: Update DM ChatPanel rendering**

Replace the DM ChatPanel props:
```tsx
<ChatPanel
  channelId={dmStore.selectedContact ? `dm-${dmStore.selectedContact.id}` : undefined}
  channelName={dmStore.selectedContact?.displayName ?? ''}
  messages={dmStore.messages}
  currentUsername={username}
  onSendMessage={dmStore.sendMessage}
  isDM={true}
  matrixClient={matrixClient.client}
  matrixRoomId={dmStore.selectedContact && matrixClient.dmRoomMap ? matrixClient.dmRoomMap.get(dmStore.selectedContact.id) ?? null : null}
  readMarkerTs={dmDividerTs}
  users={users}
/>
```

**Step 11: Update context menu "Start DM" handlers**

In `Sidebar.tsx` and `ChannelTree.tsx`, the "Send Direct Message" context menu items call a handler that passes `(sessionId, userName)`. These need to be updated to pass `matrixUserId` instead. Find the handler wiring in App.tsx and update:

Where `handleSelectDMUser` was passed as a prop (search for `onStartDM` or similar), replace with a wrapper:
```typescript
const handleStartDMFromContextMenu = (sessionIdStr: string, userName: string) => {
  const user = users.find(u => String(u.session) === sessionIdStr);
  if (user?.matrixUserId) {
    dmStore.startDM(user.matrixUserId, userName);
  } else {
    // Mumble fallback
    dmStore.selectContact(`mumble:session:${sessionIdStr}`);
  }
};
```

Pass this as the callback to sidebar/channel tree context menus.

**Step 12: Remove old DM imports**

Remove from the import at line 26:
- `loadDMContacts`
- `upsertDMContact`
- `markDMContactRead`
- `removeDMContact`

Remove the `StoredDMContact` type import (line 28).

**Step 13: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Fix any remaining type errors.

**Step 14: Commit**

```
refactor: wire useDMStore into App.tsx, remove old DM state

Replaces ~150 lines of scattered DM state management in App.tsx with
the centralized useDMStore hook. DM contacts are now derived from
Matrix m.direct data instead of localStorage. All DM actions route
through the hook.
```

---

### Task 5: Clean up useChatStore (remove DM localStorage)

Fixes Bug 4: `clearChatStorage()` wiping all DM contacts.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Remove DM contact functions and types**

Remove the following from `useChatStore.ts`:
- Line 110: `DM_CONTACTS_KEY_PREFIX` constant
- Lines 114-116: `dmContactsKey` helper
- Lines 118-124: `StoredDMContact` interface
- Lines 126-134: `loadDMContacts` function
- Lines 136-138: `saveDMContacts` function
- Lines 140-169: `upsertDMContact` function
- Lines 171-179: `markDMContactRead` function
- Lines 181-185: `removeDMContact` function

**Step 2: Update clearChatStorage**

Replace the `clearChatStorage` function (lines 88-93) to only clear channel data:
```typescript
export function clearChatStorage() {
  const serverRootKey = `${STORAGE_KEY_PREFIX}server-root`;
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_KEY_PREFIX) && k !== serverRootKey)
    .forEach(k => localStorage.removeItem(k));
}
```

The key change: removed the `|| k.startsWith(DM_CONTACTS_KEY_PREFIX)` clause.

**Step 3: Update exports**

Remove the DM-related functions from the module's exports. The functions were individually exported, so removing them is sufficient.

**Step 4: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Expected: No new errors (old callers were removed in Task 4)

**Step 5: Commit**

```
fix: remove DM data from localStorage, stop clearChatStorage wiping contacts

DM contacts are now derived from Matrix m.direct account data.
clearChatStorage() no longer deletes DM-related localStorage keys,
fixing the bug where reconnecting wiped all DM contacts across all servers.
```

---

### Task 6: Update DMContactList component for new contact shape

**Files:**
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`

**Step 1: Update DMContact interface to match useDMStore**

Replace the internal `DMContact` interface (lines 8-17) with an import from useDMStore:
```typescript
import type { DMContact } from '../../hooks/useDMStore';
```

**Step 2: Update DMContactListProps**

Update the props to use the new contact shape:
```typescript
interface DMContactListProps {
  contacts: DMContact[];
  selectedUserId: string | null;
  onSelectContact: (id: string, displayName: string) => void;
  onCloseConversation: (id: string) => void;
  onlineUserIds: string[];
  visible: boolean;
}
```

**Step 3: Update rendering to use new field names**

Throughout the component, update field access:
- `contact.userId` -> `contact.id`
- `contact.userName` -> `contact.displayName`
- `contact.unread` -> `contact.unreadCount`
- `contact.lastMessageTime` is now `number | undefined` (epoch ms) instead of `Date`. Update the time formatting to handle this:
  ```typescript
  const time = contact.lastMessageTime ? new Date(contact.lastMessageTime) : undefined;
  ```

**Step 4: Add ephemeral badge for Mumble-only contacts**

For contacts where `contact.isEphemeral === true`, add a small warning indicator next to their name. This can be a simple title/tooltip:
```tsx
{contact.isEphemeral && (
  <span className="dm-ephemeral-badge" title="Messages with this user won't be saved">!</span>
)}
```

Add minimal CSS in `DMContactList.css`:
```css
.dm-ephemeral-badge {
  color: var(--text-muted);
  font-size: 0.7em;
  margin-left: 4px;
  opacity: 0.7;
}
```

**Step 5: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`

**Step 6: Commit**

```
refactor: update DMContactList for new DMContact shape from useDMStore

Contacts are now keyed by Matrix user ID instead of session ID.
Adds ephemeral badge indicator for Mumble-only contacts whose
messages won't persist.
```

---

### Task 7: Update Sidebar and ChannelTree DM context menus

The context menus that initiate DMs currently pass session IDs. They need to work with the new identity model.

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

**Step 1: Investigate how DM is initiated from context menus**

Read the relevant sections of `Sidebar.tsx` and `ChannelTree.tsx` to find:
- The "Send Direct Message" / "Start DM" menu items
- What callback they invoke and what arguments they pass
- How the callback prop is typed

**Step 2: Update callbacks**

The context menu callbacks should pass `matrixUserId` when available, falling back to session-based ID. The `handleStartDMFromContextMenu` wrapper added in Task 4 Step 11 handles the conversion, so the context menu just needs to pass what it has.

If the callback currently takes `(sessionId: string, userName: string)`, update it to pass `(user.matrixUserId ?? \`mumble:session:${user.session}\`, user.name)` where `user` is the right-clicked user object.

The exact changes depend on how the components are structured -- read the files first.

**Step 3: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`

**Step 4: Commit**

```
refactor: update sidebar DM context menus for Matrix user ID identity

Context menus now pass Matrix user IDs when available for DM initiation,
falling back to mumble:session: prefix for OG Mumble users.
```

---

### Task 8: Fix initial sync timing for DM messages (Bug 6)

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

**Step 1: Add buffering for pre-PREPARED DM timeline events**

In the `useEffect` that creates the Matrix client, add a flag and buffer:

```typescript
let isPrepared = false;
const bufferedDmEvents: Array<{ room: any; event: any }> = [];
```

**Step 2: Update the timeline handler**

In the `onTimeline` handler (lines 80-197), in the DM message section (after line 140), add:

```typescript
const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
if (!dmUserId) {
  // Room not yet mapped -- might be a DM room discovered during initial sync
  // Buffer if we haven't completed initial sync yet
  if (!isPrepared && room?.roomId) {
    bufferedDmEvents.push({ room, event });
  }
  return;
}
```

**Step 3: Replay buffered events after PREPARED**

In the `onSync` handler, after `refreshDMRoomMaps` is called on `PREPARED`:

```typescript
if (state === 'PREPARED') {
  isPrepared = true;
  const directEvent = client.getAccountData(EventType.Direct);
  if (directEvent) {
    refreshDMRoomMaps(directEvent.getContent() as Record<string, string[]>);
  }
  // Replay any DM timeline events that arrived before room maps were ready
  for (const { room, event } of bufferedDmEvents) {
    onTimeline(event, room, undefined, false, { liveEvent: false });
  }
  bufferedDmEvents.length = 0;
}
```

**Step 4: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`

**Step 5: Commit**

```
fix: buffer DM timeline events until initial sync completes

DM room maps from m.direct may not be populated when early timeline
events arrive during initial sync. Events for unmapped rooms are now
buffered and replayed after PREPARED state fires.
```

---

### Task 9: Add local echo for Matrix DMs (Bug 5)

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useDMStore.ts`
- Modify: `src/Brmble.Web/src/types/index.ts`

**Step 1: Add `pending` field to ChatMessage type**

In `types/index.ts`, add an optional `pending` field to `ChatMessage`:
```typescript
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  timestamp: Date;
  type?: 'system';
  html?: boolean;
  media?: MediaAttachment[];
  pending?: boolean;  // <-- add this
}
```

**Step 2: Add optimistic message state to useDMStore**

In `useDMStore.ts`, add state for pending messages:
```typescript
const [pendingMessages, setPendingMessages] = useState<Map<string, ChatMessage[]>>(new Map());
```

**Step 3: Update sendMessage to insert optimistic message**

In the Matrix path of `sendMessage`:
```typescript
if (!selectedContactId.startsWith('mumble:session:')) {
  // Insert optimistic local echo
  const optimisticMsg: ChatMessage = {
    id: `pending-${Date.now()}-${Math.random()}`,
    channelId: selectedContactId,
    sender: username,
    content,
    timestamp: new Date(),
    pending: true,
  };
  setPendingMessages(prev => {
    const next = new Map(prev);
    const existing = next.get(selectedContactId!) ?? [];
    next.set(selectedContactId!, [...existing, optimisticMsg]);
    return next;
  });

  if (sendMatrixDM) {
    sendMatrixDM(selectedContactId, content)
      .then(() => {
        // Remove optimistic message -- the real one arrives via sync
        setPendingMessages(prev => {
          const next = new Map(prev);
          const existing = next.get(selectedContactId!) ?? [];
          next.set(selectedContactId!, existing.filter(m => m.id !== optimisticMsg.id));
          return next;
        });
      })
      .catch(console.error);
  }
}
```

**Step 4: Merge pending messages into the messages output**

Update the `messages` useMemo to include pending messages:
```typescript
const messages: ChatMessage[] = useMemo(() => {
  if (!selectedContactId) return [];

  if (!selectedContactId.startsWith('mumble:session:')) {
    const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
  }

  return mumbleDmMessages.get(selectedContactId) ?? [];
}, [selectedContactId, matrixDmMessages, mumbleDmMessages, pendingMessages]);
```

**Step 5: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`

**Step 6: Commit**

```
feat: add local echo for Matrix DMs

Sent DM messages now appear immediately in the chat as pending messages,
then are replaced when the confirmed event arrives via Matrix sync.
Eliminates the visible delay between sending and seeing your own message.
```

---

### Task 10: Update DM unread divider integration

The unread divider (`dmDividerTs`) logic in App.tsx needs to work with the new useDMStore.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (lines 1644-1694 area)

**Step 1: Update the DM divider snapshot effect**

The existing effect (around lines 1644-1694) watches `selectedDMUserId` and `appMode` to snapshot the unread divider timestamp and mark the room as read. Update it to use `dmStore.selectedContact` and `dmStore.appMode`:

```typescript
useEffect(() => {
  if (dmStore.appMode !== 'dm' || !dmStore.selectedContact) {
    return;
  }
  const contact = dmStore.selectedContact;
  if (contact.isEphemeral) return; // No unread tracking for Mumble DMs

  const roomId = matrixClient.dmRoomMap?.get(contact.id);
  if (!roomId) return;

  // Snapshot the divider timestamp
  const ts = unreadTracker.getMarkerTimestamp(roomId);
  setDmDividerTs(ts);

  // Mark as read
  const room = matrixClient.client?.getRoom(roomId);
  if (room) {
    const lastEvent = room.getLastLiveEvent();
    if (lastEvent?.getId()) {
      unreadTracker.markRoomRead(roomId, lastEvent.getId()!).catch(console.error);
    }
  }
}, [dmStore.appMode, dmStore.selectedContact, matrixClient.dmRoomMap, matrixClient.client, unreadTracker]);
```

**Step 2: Verify the build compiles**

Run: `cd src/Brmble.Web && npx tsc --noEmit`

**Step 3: Commit**

```
fix: update DM unread divider to work with new useDMStore
```

---

### Task 11: Final cleanup and build verification

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (remove any dead code)
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts` (verify clean)

**Step 1: Search for any remaining references to old DM patterns**

Search for:
- `dmContacts` (should not exist in App.tsx)
- `selectedDMUserId` (should not exist in App.tsx)
- `selectedDMUserName` (should not exist in App.tsx)
- `handleSendDMMessage` (should not exist)
- `handleSelectDMUser` (should not exist)
- `handleCloseDMConversation` (should not exist)
- `upsertDMContact` (should not exist anywhere)
- `loadDMContacts` (should not exist)
- `markDMContactRead` (should not exist)
- `removeDMContact` (should not exist)
- `DM_CONTACTS_KEY_PREFIX` (should not exist)
- `StoredDMContact` (should not exist)

**Step 2: Remove the `DMConversation` type if unused**

In `types/index.ts`, the `DMConversation` type (lines 52-58) may now be unused. Check for references and remove if no longer needed.

**Step 3: Remove `mapStoredContacts` utility**

In App.tsx, the `mapStoredContacts` function (lines 128-135) is no longer needed. Remove it.

**Step 4: Full build check**

Run: `cd src/Brmble.Web && npx tsc --noEmit`
Run: `cd src/Brmble.Web && npm run build`

Both must succeed with no errors.

**Step 5: Commit**

```
refactor: remove dead DM code and verify clean build
```

---

## Summary of Tasks

| Task | Description | Fixes |
|------|-------------|-------|
| 1 | Auto-join DM room invites | Bug 1 (Critical) |
| 2 | Room creation mutex | Bug 2 (High) |
| 3 | Create useDMStore hook | Core rebuild |
| 4 | Wire useDMStore into App.tsx | Bug 3 (High) + core rebuild |
| 5 | Clean up useChatStore | Bug 4 (High) |
| 6 | Update DMContactList component | UI update |
| 7 | Update context menu DM initiation | Identity model |
| 8 | Fix initial sync timing | Bug 6 (Medium) |
| 9 | Add local echo for Matrix DMs | Bug 5 (Medium) |
| 10 | Update unread divider integration | Reconnect fix |
| 11 | Final cleanup and build verification | Cleanup |
