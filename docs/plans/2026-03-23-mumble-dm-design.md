# Mumble DM Design

**Date:** 2026-03-23
**Status:** Approved

## Problem

After the DM subsystem rebuild, Brmble-to-Brmble DMs work via Matrix. But when a Brmble user tries to DM a pure Mumble user (someone with no Brmble account), nothing happens — the context menu checks for `matrixUserId` and bails if absent. Mumble private message handling was stripped out of the frontend entirely.

Pure Mumble users are a first-class citizen of the voice server. They should be reachable via DM from Brmble users.

## Scope

- **In scope:** Brmble user sending/receiving DMs with pure Mumble users via Mumble's native private message system.
- **Out of scope:** Pure Mumble-to-Mumble DMs (handled natively by Mumble, not our concern). Server-side DM bridging. Matrix rooms for Mumble users.

## Decisions

1. **Transport:** Mumble native private messages. Ephemeral — only while both users are online (or until the Brmble user disconnects).
2. **UI:** Unified DM contact list. Mumble DM contacts appear alongside Matrix DM contacts with a visual "online only" indicator.
3. **Persistence:** Conversation kept in memory until the Brmble user disconnects from the server. If the Mumble user disconnects and reconnects (matched by cert hash), the conversation reattaches.
4. **Transport selection:** If the target has a `matrixUserId` (from `SessionMappingService`), use Matrix. Only users with NO Matrix identity get Mumble PMs. This means a registered Brmble user on a Mumble client still gets Matrix DMs (they'll see them when they next open Brmble).
5. **No manual dismiss:** Mumble DM conversations are cleared automatically on Brmble disconnect. No close/dismiss button needed.

## Architecture

```
┌─────────────────────────────────────────┐
│  UI Layer (ChatPanel, DMContactList)     │
├─────────────────────────────────────────┤
│  useDMStore hook (state + actions)       │
│  ├── Matrix contacts (existing)          │
│  └── Mumble contacts (NEW)              │
│      ├── keyed by mumbleCertHash        │
│      ├── in-memory messages only        │
│      └── cleared on disconnect          │
├─────────────────────────────────────────┤
│  useMatrixClient (Matrix transport)      │  <-- unchanged
│  MumbleAdapter.cs (Mumble transport)     │  <-- existing plumbing, now used
└─────────────────────────────────────────┘
```

No server-side changes required. The Brmble client talks directly to the Mumble server for PMs (via MumbleSharp in `MumbleAdapter.cs`), and directly to Matrix for DMs. The server doesn't bridge anything for this scenario.

## Contact Model

```typescript
interface DMContact {
  // Common fields
  displayName: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageTime?: number;

  // Matrix DM (existing)
  matrixUserId?: string;     // e.g., "@2:noscope.it"
  matrixRoomId?: string;

  // Mumble DM (new)
  mumbleCertHash?: string;   // stable identity across reconnects
  mumbleSessionId?: number;  // current session (null if offline)
  isEphemeral: boolean;      // true for Mumble DMs, false for Matrix
}
```

A contact has either `matrixUserId` or `mumbleCertHash`, never both. If a user has a Matrix identity, they always go through Matrix regardless of what client they're using.

## Transport Selection

```
User initiates DM from context menu
  ├── target has matrixUserId? ──→ Matrix DM (existing flow)
  └── target has no matrixUserId? ──→ Mumble PM (new flow)
```

The check happens on the frontend using user list data that `SessionMappingService` already broadcasts. The frontend already receives `matrixUserId` (or null) for each user in the channel tree.

## Message Flow

### Sending (Brmble → Mumble user)

```
User types message → useDMStore.sendMessage(content)
  → Insert optimistic message (local echo)
  → bridge.send('voice.sendPrivateMessage', { targetSession, text })
  → MumbleAdapter.cs → MumbleSharp → Mumble server → target user
```

### Receiving (Mumble user → Brmble)

```
MumbleAdapter.cs receives TextMessage with sessions target
  → bridge sends 'voice.message' { sender, sessionId, certHash, text, isPrivate: true }
  → App.tsx routes to useDMStore
  → Look up sender by certHash
  → If contact exists → append message
  → If no contact → auto-create ephemeral contact, append message
  → Increment unread count
```

### Reconnection

```
Mumble user disconnects:
  → User list update removes their session
  → DM contact's mumbleSessionId set to null
  → UI shows contact as offline
  → Message input disabled (can't deliver)

Mumble user reconnects:
  → User list update adds new session with same certHash
  → DM contact's mumbleSessionId updated to new value
  → UI shows contact as online again
  → Conversation history (in memory) preserved
```

### Cleanup

All Mumble DM contacts and messages are cleared when the Brmble user disconnects from the server.

## Frontend Changes

### useDMStore.ts

- Add Mumble contact state: `mumbleContacts` map keyed by `certHash`
- Add Mumble message storage: in-memory `Map<certHash, ChatMessage[]>`
- Extend `sendMessage()` to dispatch to Mumble bridge when `contact.isEphemeral`
- Add `receiveMumbleDM(certHash, sessionId, displayName, text)` action
- Add `updateMumbleSession(certHash, sessionId | null)` for connect/disconnect
- Add `clearMumbleContacts()` for server disconnect cleanup
- Merge Mumble contacts into the unified contact list (sorted by lastMessageTime alongside Matrix contacts)

### App.tsx

- Un-ignore `voice.message` with `isPrivate: true` — route to `useDMStore.receiveMumbleDM()`
- Handle user list updates to detect Mumble user connect/disconnect — call `updateMumbleSession()`
- Extend `handleStartDMFromContextMenu` with Mumble path for users without `matrixUserId`
- On server disconnect: call `clearMumbleContacts()`

### DMContactList.tsx

- Show "online only" indicator for ephemeral contacts
- Show offline state when `mumbleSessionId` is null
- Disable message input when Mumble contact is offline

### MumbleAdapter.cs

- Verify `voice.message` includes `certHash` for the sender (the session mapping data should have this; may need a small addition to include cert hash in the message payload)

## Server Changes

Minimal. Verify that user list broadcast events include `certHash` for all users (not just Brmble users). If not, add cert hash to the user connected/user list events in `SessionMappingService`.

## Testing

### Manual Scenarios

1. **Happy path:** Brmble user sends DM to pure Mumble user. Mumble user receives it. Mumble user replies. Brmble user sees reply.
2. **Auto-create contact:** Mumble user sends first DM to Brmble user. Contact auto-created in DM list.
3. **Reconnection:** Mumble user disconnects, shown as offline. Reconnects — conversation preserved, shown as online.
4. **Session cleanup:** Brmble user disconnects from server. All Mumble DM contacts cleared.
5. **Transport selection:** Right-click a user with Matrix ID → Matrix DM. Right-click a user without → Mumble DM.
6. **Brmble user on Mumble client:** Right-click them → Matrix DM (they have a Matrix ID even though they're on a Mumble client).
7. **Offline send blocked:** Mumble contact offline → message input disabled, cannot send.
8. **Unread tracking:** Mumble DM arrives while viewing channels → unread badge appears.
