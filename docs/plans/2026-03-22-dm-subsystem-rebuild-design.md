# DM Subsystem Rebuild Design

**Date:** 2026-03-22
**Status:** Approved

## Problem

The DM system has 6 significant bugs and architectural debt that make it unreliable:

1. **No auto-join for DM invites (Critical):** When User A creates a DM room and invites User B, nothing auto-joins B. B never receives messages.
2. **Race condition in room creation (High):** Rapid sends create duplicate DM rooms — no mutex guards concurrent `createRoom` calls.
3. **DM contacts keyed by ephemeral session ID (High):** Mumble session IDs change on reconnect, orphaning all DM contacts.
4. **`clearChatStorage()` wipes all servers' DM contacts (High):** Fires on every reconnect when Matrix credentials arrive, destroying the contact list.
5. **No local echo for Matrix DMs (Medium):** Sent messages don't appear until the Matrix sync round-trip completes.
6. **Initial sync timing (Medium):** DM room mapping may not exist when initial sync timeline events fire, causing missed messages.

DM state is spread across ~150 lines in `App.tsx` with no dedicated hook. The `useDMStore` refactor proposed in the March 1st robustness design was never completed.

## Scope

- **In scope:** Clean rebuild of the DM subsystem for Brmble-to-Brmble Matrix DMs. Fix all 6 bugs.
- **Deprioritized:** Mumble-only DMs remain as-is (ephemeral fallback), shown in mixed contact list with warning badges.
- **Out of scope:** Server-side DM bridging for OG Mumble clients (Phase 4 of architecture doc).

## Architecture

Matrix is the single source of truth for Brmble-to-Brmble DMs. localStorage is eliminated as a DM data store.

```
┌─────────────────────────────────────────┐
│  UI Layer (ChatPanel, DMContactList)     │
├─────────────────────────────────────────┤
│  useDMStore hook (state + actions)       │  <-- NEW: single owner of all DM state
│  ├── contacts: derived from m.direct     │
│  ├── messages: from Matrix sync/timeline │
│  ├── selectedUser: by Matrix user ID     │
│  └── mumbleDMs: ephemeral fallback       │
├─────────────────────────────────────────┤
│  useMatrixClient (transport)             │  <-- EXISTS: cleaned up
│  Mumble bridge (fallback transport)      │  <-- EXISTS: unchanged
└─────────────────────────────────────────┘
```

## Identity Model

DM contacts are keyed by Matrix user ID (`@user:server`). Mumble-only contacts use a synthetic key (`mumble:session:{id}`) and are marked as ephemeral with a warning badge in the UI.

## useDMStore Hook API

```typescript
interface DMStore {
  // State
  contacts: DMContact[];           // Sorted by lastMessageTime, derived from m.direct
  selectedContact: DMContact | null;
  messages: ChatMessage[];         // Messages for selected contact
  appMode: 'channels' | 'dm';

  // Actions
  selectContact(matrixUserId: string): void;
  sendMessage(content: string): Promise<void>;
  startDM(matrixUserId: string, displayName: string): void;
  clearSelection(): void;

  // Derived
  totalUnreadCount: number;
}

interface DMContact {
  matrixUserId: string;            // Primary key
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  isEphemeral: boolean;            // true for Mumble-only contacts
}
```

### Contact Population

1. On Matrix sync `PREPARED`: read `m.direct` account data, extract all user IDs with DM rooms, create `DMContact` entries.
2. Enrich with live data: match `matrixUserId` against the `users` array for current `displayName`, `avatarUrl`, online status.
3. For each contact's room, get the last event from the timeline for `lastMessage`/`lastMessageTime`.
4. Mumble-only contacts are added when a private message arrives from a user with no `matrixUserId`.

### Room Creation Mutex

```typescript
const pendingRoomCreations = useRef(new Map<string, Promise<string>>());

// In sendMessage:
let roomId = dmRoomMap.get(targetUserId);
if (!roomId) {
  const existing = pendingRoomCreations.current.get(targetUserId);
  if (existing) {
    roomId = await existing;
  } else {
    const promise = createDMRoom(targetUserId);
    pendingRoomCreations.current.set(targetUserId, promise);
    roomId = await promise;
    pendingRoomCreations.current.delete(targetUserId);
  }
}
```

## Bug Fix Strategies

### Bug 1: No auto-join for DM invites

Add an invite handler in `useMatrixClient` that auto-accepts room invites for DM rooms:

```
Matrix sync delivers invite event -> check if room is 1:1 direct -> auto-join via client.joinRoom(roomId)
```

Fires on the recipient's client when online. If offline, the invite waits until next connect and sync.

### Bug 2: Race condition / duplicate rooms

Solved by the `pendingRoomCreations` mutex. Only one `createRoom` call can be in-flight per target user.

### Bug 3: Session ID keying

Eliminated. Contacts keyed by `matrixUserId`. Session ID is only used for lookup to find `matrixUserId` from the live `users` array, never as a storage key.

### Bug 4: `clearChatStorage()` wiping everything

`clearChatStorage()` no longer touches DM data because DM contacts come from Matrix `m.direct` and DM messages come from the Matrix timeline. Modified to only clear channel localStorage caches.

### Bug 5: No local echo

Insert optimistic message with `pending: true` flag immediately on send. When the real event arrives via sync, match by transaction ID and replace.

### Bug 6: Initial sync timing

Process DM room maps from `m.direct` before processing timeline events. Call `refreshDMRoomMaps()` synchronously during the sync callback. Buffer timeline events for unknown rooms and replay after `PREPARED`.

## Data Flow

### Brmble-to-Brmble (Matrix)

```
SENDING:
User types message -> useDMStore.sendMessage(content)
  -> Insert optimistic message (pending: true)
  -> Get/create room via mutex
  -> client.sendMessage(roomId, content)
  -> On sync: replace optimistic with confirmed message

RECEIVING:
Matrix sync -> timeline event for DM room
  -> useMatrixClient identifies room as DM (via roomIdToDMUserId map)
  -> Emits event/callback to useDMStore
  -> useDMStore appends message, updates contact lastMessage/unreadCount
```

### Mumble Fallback (ephemeral)

```
SENDING:
useDMStore.sendMessage(content)
  -> Insert message locally (in-memory Map)
  -> bridge.send('voice.sendPrivateMessage', { message, targetSession })

RECEIVING:
bridge 'voice.message' with sessions field
  -> App.tsx routes to useDMStore.receiveMumbleDM(senderSession, text)
  -> useDMStore creates/finds ephemeral contact
  -> Appends message to in-memory Map
```

## Room Uniqueness

Matrix `m.direct` account data ensures one DM room per user pair regardless of who initiates. When User A creates a DM room with User B, both users' `m.direct` maps the other's ID to the same room. Subsequent DM attempts from either side discover the existing room.

Edge case: if A and B both send their first DM simultaneously (within the same sync cycle), two rooms could be created. This is extremely unlikely and both rooms would work — the first one in the `m.direct` array is always used.

## State Removal from App.tsx

The following are extracted to `useDMStore`:

- `dmContacts` state and all `upsertDMContact` calls
- `selectedDMUserId` state
- `handleSendDMMessage` function
- `handleSelectDMUser` function
- DM-related `useEffect` hooks
- DM message routing in `onVoiceMessage`
- `appMode` state

## State Removal from useChatStore.ts

- `DM_CONTACTS_KEY_PREFIX` and related localStorage operations
- DM-related keys from `clearChatStorage()`

## Migration

No data migration needed. Old localStorage DM data is orphaned and ignored. Matrix DM rooms already exist on the server and are rediscovered via `m.direct` sync.

## Testing

### Manual Scenarios (priority order)

1. **Happy path:** A sends DM to B. B receives it. B replies. A receives reply. Both see full conversation.
2. **Reconnect persistence:** A sends DM to B. Both disconnect and reconnect. Both see DM history.
3. **Offline recipient:** A sends DM to B while B is offline. B connects later, auto-joins room, sees message.
4. **Rapid sends:** A sends 5 messages quickly to B. Only 1 room is created.
5. **Mumble fallback:** A sends DM to OG Mumble user. Message goes via Mumble TextMessage. Badge shows ephemeral indicator.
6. **Unread tracking:** A sends DM to B while B is viewing channels. B sees unread badge. B opens DM, badge clears.
7. **Multi-server:** A connects to Server 1, DMs User B. A connects to Server 2. Server 2 DM list is independent.

### Unit-testable Logic

- Room creation mutex behavior
- Contact derivation from `m.direct` data
- Optimistic message insertion and replacement
