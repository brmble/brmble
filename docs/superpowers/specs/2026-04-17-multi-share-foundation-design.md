# Multi-Share Foundation Design

**Date:** 2026-04-17
**Status:** Approved
**Scope:** Allow multiple users to share screens simultaneously within a channel

## Overview

Currently, Brmble's screen sharing is limited to one active share per channel. This design extends the system so any number of users in a channel can share their screen at the same time, and viewers can switch between them near-instantly.

This is foundational infrastructure. Features like grid view, picture-in-picture, the game overlay, and multi-view all depend on multi-share working first.

## Core Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LiveKit room topology | One room per channel | Single connection per user, near-instant track-level switching (~100-300ms vs 1-3s reconnect) |
| Room creation | Lazy -- created on first share | LiveKit auto-creates rooms when the first participant connects. No empty rooms for idle channels. |
| Room cleanup | LiveKit auto-cleans empty rooms | No explicit destroy needed |
| Shares per user | One at a time | User stops current share before starting a new one (swap) |
| Sharers per channel | Unlimited | Any channel member can share |
| Viewer model | Manual opt-in, one view at a time | Toast notification per new share. Data model supports multi-view later. |
| Share switcher UI | Channel user list monitor icons | Clickable icons, no new UI surface needed |
| Channel leave/kick | Auto-remove from LiveKit room | `RemoveParticipant` API, instant disconnection |
| Ghost share cleanup | Periodic server-side reconciliation | Every 30-60s, compare tracker to actual LiveKit room participants |
| Status icon | Always visible | idle / connecting / connected / disconnected |

## User Stories & Flows

### User Stories

**US-1: Starting a share**
> As Alice, I click the share button, pick a window, and my screen is shared with everyone in my channel. A monitor icon appears next to my name in the channel user list.

**US-2: Multiple sharers**
> As Bob, I can start sharing my screen even though Alice is already sharing in the same channel. Both of us have monitor icons. Other users can choose whose share to watch.

**US-3: Watching a share**
> As Charlie, I see monitor icons next to Alice and Bob. I click Alice's icon and her screen appears in my viewer panel. I click Bob's icon and it switches to Bob's stream.

**US-4: Toast notification**
> As Charlie, when Alice starts sharing I get a toast: "Alice is sharing their screen" with a "Watch" button. If Bob starts sharing 2 minutes later, I get another toast for Bob.

**US-5: Leaving the channel**
> As Alice, when I switch to another channel, my share automatically stops. Other viewers see a notification that my share ended. Bob's share continues unaffected.

**US-6: Getting kicked**
> As Alice, when an admin kicks me from the channel, I'm removed from the LiveKit room immediately. My share stops, my viewer closes, and other users are notified.

**US-7: Share swap**
> As Alice, if I'm already sharing and try to share again, the system stops my current share and starts the new one (swap, not stack).

### Lifecycle Flow

```
Channel exists, no LiveKit room yet
        |
        v
Alice clicks "Share Screen"
        |
        v
Client: livekit.requestToken { roomName: "gaming" }
        |
        v
Server: Creates JWT with room="gaming", identity=alice
        |  (LiveKit auto-creates the room on first connection)
        |
        v
Client: livekit-client Room.connect(url, token)
        |
        v
Client: Room.localParticipant.setScreenShareEnabled(true)
        |
        v
Client: livekit.shareStarted { roomName: "gaming" }
        |
        v
Server: ScreenShareTracker.Add("gaming", aliceShareInfo)
Server: Broadcast screenShare.started to all channel members
        |
        +------------------------------+
        v                              v
Bob's client:                   Charlie's client:
Toast: "Alice is sharing"      Toast: "Alice is sharing"
Monitor icon on Alice           Monitor icon on Alice
        |                              |
        v                              v
Bob clicks "Share Screen"       Charlie clicks Alice's
        |                       monitor icon
        v                              |
Same flow as Alice              v
(room already exists,     Client: livekit.requestToken
 Bob joins it)            Client: Room.connect (or reuse)
        |                 Client: subscribe to Alice's
        v                        screen share track
Server: ScreenShareTracker             |
  now has [alice, bob]           v
Broadcast: Bob is sharing      Alice's screen appears
All clients get Bob's                in viewer panel
monitor icon too
```

### Channel Leave / Kick Flow

```
Alice switches channel (or gets kicked)
        |
        v
Brmble Server detects channel leave
        |
        +-- Was Alice sharing?
        |   YES -> ScreenShareTracker.Remove("gaming", alice)
        |       -> Broadcast screenShare.stopped { userId: alice }
        |
        +-- LiveKit: RemoveParticipant("gaming", "alice")
        |       -> Alice's connection drops
        |       -> All subscribers auto-unsubscribed from her tracks
        |
        v
Other clients:
+-- RoomEvent.ParticipantDisconnected fires
+-- If watching Alice -> viewer closes, toast: "Alice's share ended"
+-- Alice's monitor icon removed
+-- Bob's share continues unaffected
```

### Room Lifecycle

```
No one sharing in channel -> No LiveKit room exists
        |
First user starts sharing -> LiveKit room auto-created on connect
        |
Multiple sharers come and go -> Room stays alive
        |
Last sharer stops -> Room becomes empty
        |
LiveKit auto-cleans empty rooms (configurable timeout)
```

### Connection Model

Users do NOT automatically connect to the LiveKit room when someone starts sharing. Share notifications travel through the existing WebSocket event bus.

**Single connection per user per channel:** LiveKit enforces that a participant identity can only have one active connection to a room at a time. A second connection with the same identity kicks the first. Therefore, the frontend uses a **single `Room` object** (`roomRef`) for both publishing (sharing) and subscribing (watching). This avoids reconnects when transitioning between sharing and watching.

| User state | In LiveKit room? | Example |
|------------|-----------------|---------|
| Not involved | No | Bob -- sees the icon, hasn't clicked Watch, isn't sharing |
| Sharing only | Yes (publishing) | Alice -- publishing her screen track |
| Watching only | Yes (subscribing) | Charlie -- subscribed to Alice's track |
| Sharing + Watching | Yes (publishing + subscribing) | Dave -- publishing his screen AND subscribed to Alice's track |

**Transitions (zero hiccup):**
- **Watch → Share:** `setScreenShareEnabled(true)` on the existing room. No reconnect. Viewer stays connected.
- **Share → Stop sharing (still watching):** `setScreenShareEnabled(false)`. Room stays connected for viewing. No hiccup.
- **Share + Watch → Stop watching:** Detach remote track. Room stays connected for sharing.
- **Stop everything:** Room disconnects only when not sharing AND not watching.

### Connection Latency

**First connection (not in room yet):** ~300ms - 1 second
```
Bridge IPC (token request + response)    ~30-40ms
Server token generation                  ~20-80ms
LiveKit Room.connect (WebSocket + ICE)   ~100-500ms
Track subscribe + first frame            ~100-350ms
```

**Switching shares (already in room):** ~100-300ms
```
Detach current track                     ~instant
Subscribe to new track + first frame     ~100-300ms
```

**Starting/stopping share while watching (already in room):** ~instant
```
setScreenShareEnabled(true/false)        ~instant (no reconnect)
Viewer subscription unaffected           ~0ms
```

## Data Model

### Server: ScreenShareTracker

Changes from single-share-per-room to multi-share-per-room:

- Key: `roomName` (channel name)
- Value: `List<ScreenShareInfo>` (one entry per active sharer)
- Each `ScreenShareInfo` contains: `UserId`, `UserName`, `MatrixUserId` (optional, used as LiveKit participant identity)
- Constraint: max one share per `UserId` per room (enforced on `share-started`)

### Server: LiveKitService

New capability:

- Add `RoomServiceClient` for server-side participant management
- New method: `RemoveParticipant(roomName, userIdentity)` -- used on channel leave, kick, and disconnect

### Frontend: useScreenShare Hook

```
activeShares: ScreenShareInfo[]        // all shares in the channel
watchingShare: ScreenShareInfo | null   // the one you're viewing (one at a time)
isSharing: boolean                     // are YOU sharing
remoteVideoEl: HTMLVideoElement | null  // video element for watchingShare
```

Data model designed so `watchingShares: ScreenShareInfo[]` is a future drop-in replacement for multi-view.

## API & Bridge Changes

### Server Endpoints

**Modified endpoints:**

| Endpoint | Current | New |
|----------|---------|-----|
| `POST /livekit/share-started` | Stores one share per room (overwrites) | Adds to list, rejects if user already sharing in room (409) |
| `POST /livekit/share-stopped` | Removes the single share | Removes by `userId` from the list |
| `GET /livekit/active-share` | Returns single share or 404 | Returns `{ shares: [] }` (empty array instead of 404 when none) |

**New endpoint:**

| Endpoint | Purpose |
|----------|---------|
| `DELETE /livekit/participant/{roomName}/{userId}` | Server-internal: remove a participant from the LiveKit room via `RoomServiceClient.RemoveParticipant()`. Called by server-side channel kick/leave logic, not exposed to clients. |

**Token endpoint (`POST /livekit/token`) -- no change.** Tokens grant `CanPublish` + `CanSubscribe` for the room. Publish vs subscribe is decided client-side.

### Bridge Messages

**Changed messages:**

| Message | Direction | Change |
|---------|-----------|--------|
| `livekit.activeShareResult` | C# -> JS | From `{ roomName, active, userName?, sessionId? }` to `{ roomName, shares: [{ userId, userName, matrixUserId, sessionId }] }` |
| `livekit.screenShareStopped` | C# -> JS | Adds `userId`: `{ roomName, userId }` |
| `livekit.screenShareStarted` | C# -> JS | Adds `userId`, `matrixUserId`, `sessionId`: `{ roomName, userName, userId, matrixUserId, sessionId }` |

**Unchanged messages:**

| Message | Why unchanged |
|---------|---------------|
| `livekit.requestToken` | One token per room, works for multi-share |
| `livekit.shareStarted` | Reports that this user started sharing |
| `livekit.shareStopped` | Reports that this user stopped sharing |
| `livekit.token` / `livekit.tokenError` | Token is room-scoped, not share-scoped |

### Channel Leave/Kick Integration

**`MumbleServerCallback.cs`** (user disconnect) -- already cleans up shares, needs to also call `RemoveParticipant`.

**Channel switch handler** -- when a user moves channels:
1. Call `RemoveParticipant` on the old channel's LiveKit room
2. Clean up their `ScreenShareTracker` entries
3. Broadcast `screenShare.stopped` if they were sharing

## Frontend Component Changes

### useScreenShare Hook Behavioral Changes

**Single-connection architecture:** The hook uses one `roomRef` (a single `Room` object) for both publishing and subscribing. This avoids LiveKit's identity-uniqueness constraint (one connection per identity per room) and eliminates reconnect hiccups during state transitions.

| Action | Current | New |
|--------|---------|-----|
| Someone starts sharing | Sets single `activeShare` | Appends to `activeShares[]` |
| Someone stops sharing | Clears `activeShare` | Removes from `activeShares[]` by `userId`. If it was the one you were watching, clears `watchingShare` and detaches track |
| You click Watch on a user | Connects to room, subscribes to the only track | `ensureRoom()` connects if needed (reuses existing), subscribes to that user's screen share track by `participant.identity` (matrixUserId) |
| You switch to a different sharer | N/A (only one share) | Detach current track, subscribe to new user's track. Room connection stays alive. ~100-300ms |
| You start sharing while watching | N/A | `ensureRoom()` reuses existing connection, `setScreenShareEnabled(true)`. Viewer subscription unaffected. Zero hiccup |
| You stop sharing while watching | N/A | `setScreenShareEnabled(false)`. Room stays connected for viewing. Zero hiccup |
| You stop watching while sharing | N/A | Detach remote track, clear `watchingShare`. Room stays connected for sharing |
| You stop watching (not sharing) | Disconnect from room | Detach track, disconnect room via `maybeDisconnectRoom()` |
| Channel switch | Disconnect everything | Disconnect from LiveKit room, clear all state |

**Participant identity:** LiveKit tokens use `matrixUserId` as the participant identity (e.g. `@alice:brmble.local`). The `connectAsViewer` function looks up participants by this identity, not the numeric database userId. The `matrixUserId` is threaded through: server broadcast → bridge → frontend `ShareInfo`.

### Channel User List

- Show monitor icon next to every user who is sharing (not just one)
- Make the icon clickable -- clicking it calls `connectAsViewer(userId)`
- Visual distinction for the share you're currently watching (highlighted icon or "watching" indicator)
- Tooltip on hover: "Watch [username]'s screen"

### Viewer Panel (ScreenShareViewer)

- Label showing whose share you're watching: "Watching Alice's screen"
- If the sharer you're watching stops, the panel closes with a toast
- No auto-switch to another share -- user opts in manually

### Notifications

- Each new share triggers a top-right `<Notification>` (info status) with a "Watch" button and X close
- Notifications use the `notifQueue` system (max 3 visible, priority-sorted)
- Clicking "Watch" on a notification while already watching someone switches the viewer
- Notifications auto-dismiss after 8 seconds
- The notification filters by `sessionId !== selfUser.session` to avoid notifying you about your own share

### Service Status (App.tsx)

| Status | Meaning |
|--------|---------|
| `idle` | Not connected to LiveKit room |
| `connecting` | Token requested, connecting to room |
| `connected` | In the LiveKit room (sharing, watching, or both) |
| `disconnected` | Connection dropped unexpectedly |

Transitions:
- `idle -> connecting`: user clicks Share or Watch
- `connecting -> connected`: Room.connect() succeeds
- `connected -> idle`: user stops sharing AND stops watching
- `connected -> disconnected`: WebSocket drops
- `disconnected -> connecting`: auto-reconnect

### State Cleanup Matrix

| Event | Clear activeShares? | Clear watchingShare? | Disconnect LiveKit? |
|-------|-------------------|---------------------|-------------------|
| Channel switch | Yes, full reset | Yes | Yes |
| Kicked from channel | Yes, full reset | Yes | Yes (server also removes you) |
| Sharer you're watching stops | No, remove them from list | Yes (if it was them) | Only if not sharing (`maybeDisconnectRoom`) |
| You stop sharing | No | No | Only if also not watching (`maybeDisconnectRoom`) |
| You stop watching | No | Yes | Only if also not sharing (`maybeDisconnectRoom`) |
| You start sharing while watching | No | No (keep watching) | No (reuses same room connection) |
| You stop sharing while watching | No | No (keep watching) | No (room stays connected for viewing) |
| LiveKit connection drops | Keep list (from WS events) | Yes | Already disconnected, trigger reconnect |

## Error Handling

| Scenario | Handling |
|----------|---------|
| User tries to start a second share | Server returns 409 Conflict. Client stops existing share first, then starts new one (swap). |
| `share-stopped` called but user isn't sharing | Success silently -- idempotent |
| `RemoveParticipant` for user not in room | Catch and ignore -- idempotent cleanup |
| Token request for user not in channel | Server returns 403 Forbidden |
| LiveKit Room.connect() fails | Don't call `share-started` on server, show error to user |
| LiveKit server is down | Clear "Screen sharing unavailable" error state |
| Ghost/stale share (user crashed) | Periodic reconciliation (30-60s) compares tracker to actual LiveKit room participants via `RoomServiceClient.ListParticipants()`, removes stale entries and broadcasts `screenShare.stopped` |

## Testing Strategy

### Server Tests

**ScreenShareTrackerTests.cs:**

| Test | Description |
|------|-------------|
| Add multiple shares to same room | List grows, each entry preserved |
| Add duplicate share (same user, same room) | Rejection / returns false |
| Remove specific share by userId | Only that share removed, others intact |
| Remove share that doesn't exist | Idempotent, no error |
| Get shares for room with none | Empty list, not null |
| Get shares for room with multiple | All returned |
| Cleanup by userId across rooms | All entries for that user cleaned |

**ScreenShareEndpointTests.cs:**

| Test | Description |
|------|-------------|
| POST share-started twice, different users | Both recorded, 200 each |
| POST share-started twice, same user | First 200, second 409 |
| POST share-stopped removes correct user | Other shares remain |
| GET active-share returns multiple shares | Array response format |
| GET active-share returns empty array when none | Not 404, empty `{ shares: [] }` |
| POST token for user not in channel | 403 Forbidden |
| RemoveParticipant on channel kick | LiveKit SDK called, tracker cleaned |

**Reconciliation tests:**

| Test | Description |
|------|-------------|
| Stale share detected | Tracker entry without matching LiveKit participant removed |
| Valid share not removed | Tracker and LiveKit agree, no change |
| Stale share broadcasts stopped | `screenShare.stopped` sent on removal |

### Frontend Tests

**useScreenShare.test.ts:**

| Test | Description |
|------|-------------|
| Receives multiple screenShareStarted events | `activeShares` list grows correctly |
| Receives screenShareStopped for specific user | Only that user removed from list |
| Watch a share subscribes to correct track | Track matched by `participant.identity` (matrixUserId) |
| Switch from one share to another | Detaches old track, subscribes new, video element updates |
| Stop watching while still sharing | Room stays connected, only viewer state clears |
| Stop sharing while still watching | Room stays connected via `maybeDisconnectRoom`, only share state clears. Zero hiccup |
| Start sharing while watching | `setScreenShareEnabled(true)` on same room, viewer unaffected. Zero hiccup |
| Stop both disconnects from room | Room disconnected via `maybeDisconnectRoom`, status goes to `idle` |
| Channel switch clears all state | `activeShares` empty, `watchingShare` null, room disconnected |
| Toast per new share | Each `screenShareStarted` triggers a notification (top-right, not bottom toast) |
| Click Watch on notification while watching another | Switches viewer to new share |

### Integration / E2E Scenarios (manual test scripts)

| Scenario | Steps | Expected |
|----------|-------|----------|
| Happy path multi-share | Alice shares, Bob shares, Charlie watches Alice, switches to Bob | Both streams visible in sequence, no errors |
| Sharer leaves | Alice shares, Charlie watches, Alice switches channel | Charlie's viewer closes, toast "Alice's share ended", icon gone |
| Kick flow | Alice shares, admin kicks Alice | Alice removed from LiveKit, share stops, viewers notified |
| Ghost cleanup | Alice shares, kill Alice's client process | Mumble disconnect fires cleanup. If not, reconciliation catches it within 30-60s |
| Rapid switching | Charlie clicks between 3 sharers quickly | No crashes, last clicked sharer's stream shown, no orphaned subscriptions |
| Share swap | Alice is sharing, clicks Share again with different window | Old share stops, new share starts, viewers see brief interruption then new stream |

## Related Feature List (out of scope for this spec)

This spec is part of a larger LiveKit feature roadmap. The following sub-projects are planned as separate design cycles:

- **B. Broadcaster Controls** -- window picker, audio capture, region capture, quality presets
- **C. Viewing Experience** -- pop-out window, PiP, fullscreen polish, zoom & pan
- **D. Game Overlay** -- transparent always-on-top window with voice indicators, share status, PiP
- **E. Token & Security** -- token scoping, rotation, revocation, endpoint auth
- **F. Connection & Reliability** -- auto-reconnect, quality indicators, graceful degradation
- **G. UI/UX Polish** -- keyboard shortcuts, context menus, notification sounds, viewer list
- **H. Clips & Screenshots** -- frame capture, short clip recording, auto-post to chat
- **I. Performance & Quality** -- simulcast, dynacast, hardware encoding, codec selection
- **J. Viewer Interaction** -- remote cursor display, emoji reactions, invite to watch
