# Brmble - Chat Persistence Architecture

## Overview

This document describes the architectural decisions for integrating persistent chat into Brmble. Matrix/Continuwuity is the **primary chat platform** — Brmble clients interact with it directly for the full-featured messaging experience (reactions, edits, threads, read receipts, rich media). Mumble TextMessage serves as a **compatibility relay** so standard Mumble clients can participate in real-time conversation, with a server-side bridge persisting their messages into Matrix via ZeroC Ice.

Brmble-to-Brmble chat works entirely through Matrix and is fully functional even if the Ice bridge is down. The bridge exists solely to bring OG Mumble clients along for persistence.

---

## 1. Design Goals

- **Matrix is the primary chat platform.** Brmble clients write directly to Matrix for the full messaging experience including reactions, edits, threads, read receipts, and rich media
- **Brmble experience comes first**, OG Mumble compatibility second. The native Brmble chat must be fully functional independent of the Mumble bridge
- **Persist OG Mumble client messages** in Matrix via a server-side bridge, so all chat history lives in one place regardless of client type
- **Full OG Mumble client support** as a permanent first-class citizen — standard clients can participate in real-time conversation and their messages are preserved
- **No visible bot users** on the Mumble server — the bridge must be invisible to connected clients
- **GPLv2 for the backend** due to ZeroC Ice dependency; all other components remain permissively licensed (see section 7)
- **Single Docker Compose deployment** on one Linux server

---

## 2. Message Flow Architecture

### 2.1 Brmble Client — Matrix Primary, Mumble Relay

Brmble clients hold both a MumbleSharp connection and a Matrix access token. **Matrix is the primary chat path** — all messages, reactions, edits, threads, and read receipts go directly to Continuwuity via the Matrix client-server API. This gives Brmble users the full messaging experience.

Additionally, the client sends a **stripped-down Mumble TextMessage** as a courtesy relay so OG Mumble clients see messages in real-time. This relay is plain HTML text only — Matrix-native features like reactions, edits, and threads have no Mumble TextMessage equivalent and are not relayed.

1. **Matrix (primary)** — direct `PUT /send` to Continuwuity using the user's Matrix access token. Full-featured: reactions, edits, threads, read receipts, rich media.
2. **Mumble TextMessage (relay)** — sent over the Mumble TCP control channel. Plain HTML text only. Ensures OG clients see the message.

This eliminates the need for a Matrix → Mumble bridge direction entirely. Brmble clients handle their own relay to Mumble. If the Mumble server or Ice bridge is down, Brmble-to-Brmble chat continues to function normally through Matrix.

### 2.2 OG Mumble Client — Bridge via Ice + Appservice

Standard Mumble clients send TextMessage through the Mumble protocol as usual. The backend captures these messages and persists them to Matrix so they appear alongside Brmble-native messages in the chat timeline:

1. **Ice callback** receives `userTextMessage(User state, TextMessage message)` from the Mumble server's RPC interface
2. **Backend resolves identity** — maps the sender's Mumble user to their Matrix user ID via the backend user table (cert_hash → matrix_user_id)
3. **Backend posts to Matrix** via the Application Service API, sending the message as the correct Matrix user
4. OG Mumble clients are unaware any of this is happening — their experience is unchanged

This bridge is the only component that depends on the Ice connection. If it goes down, Brmble-to-Brmble chat is unaffected — only OG client message persistence is interrupted.

### 2.3 Deduplication

When a Brmble client dual-writes, the Mumble server broadcasts the TextMessage to all connected clients — and the Ice callback also fires. The backend must not relay this message to Matrix a second time.

**Strategy: cert hash allowlist.** When a Brmble client authenticates with the backend (via mTLS) to obtain its Matrix token, the backend records that cert hash in an in-memory set of active Brmble sessions. When the Ice callback fires for a TextMessage, the backend checks the sender's cert hash against this set. If it's a Brmble client, the message is skipped — the client already wrote to Matrix directly.

```
On Brmble client Matrix token request:
    _brmbleCertHashes.Add(certHash)

On Ice userTextMessage callback:
    certHash = resolve from user state
    IF certHash IN _brmbleCertHashes:
        SKIP (Brmble client already dual-wrote)
    ELSE:
        POST to Matrix via appservice API
```

Cleanup: remove cert hashes from the set when Ice reports `userDisconnected` for that user, or when the Brmble client explicitly disconnects.

### 2.4 Complete Flow Diagrams

**OG Mumble client sends a channel message:**

```
OG Client              Mumble Server           Backend (Ice)          Continuwuity
   |                        |                       |                      |
   |-- TextMessage -------->|                       |                      |
   |                        |-- Ice callback ------>|                      |
   |                        |   userTextMessage     |                      |
   |                        |                       | not in Brmble set    |
   |                        |                       | resolve user + room  |
   |                        |                       |-- PUT /send -------->|
   |                        |                       |   (as @42:server)    | stored
```

**Brmble client sends a channel message:**

```
Brmble Client          Mumble Server           Backend (Ice)          Continuwuity
   |                        |                       |                      |
   |-- PUT /send (primary) -|---------------------------------------------->| stored
   |-- TextMessage (relay)->|                       |                      | (+ reactions,
   |                        |-- Ice callback ------>|                      |   edits, threads)
   |                        |   userTextMessage     |                      |
   |                        |                       | IN Brmble set → skip |
```

**Brmble client sends a reaction/edit (Matrix-only, no Mumble equivalent):**

```
Brmble Client                                                         Continuwuity
   |                                                                       |
   |-- PUT /send (reaction/edit) ----------------------------------------->| stored
   |                                                                       |
   (no Mumble relay — TextMessage cannot express reactions or edits)
```

---

## 3. ZeroC Ice Integration

### 3.1 Why Ice

The Mumble server (mumble-server) supports ZeroC Ice as its stable, officially supported RPC interface. Ice provides server-side callbacks for all relevant events without requiring a client connection to the Mumble server. This means:

- **No bot user** visible in the user list
- **No connection slot** consumed
- **No audio codec negotiation** or UDP handling
- **Full event access** — text messages, user connects/disconnects, channel changes, user state changes

The alternative — Mumble's gRPC support — was removed from the codebase entirely. The Mumble team described it as experimental, unstable, and unmaintained. Ice is the only viable RPC option.

### 3.2 Why Not MumbleSharp for the Bridge

A MumbleSharp connection in the backend would appear as a connected user (bot) on the Mumble server. This is visible to all clients, consumes a connection slot, and feels unclean for end users. Ice avoids this entirely by operating at the server management level.

### 3.3 Ice Configuration

The mumble-server container needs Ice enabled in its configuration:

```ini
ice="tcp -h 0.0.0.0 -p 6502"
icesecretread=<shared-secret>
icesecretwrite=<shared-secret>
```

The backend connects to `tcp -h mumble-server -p 6502` over the Docker internal network. Port 6502 is never exposed externally.

### 3.4 Ice Callbacks Used

The backend registers a `ServerCallback` with the Mumble server via Ice and uses the following callbacks:

| Callback | Purpose |
|---|---|
| `userTextMessage(User, TextMessage)` | Capture OG client messages for Matrix persistence |
| `userConnected(User)` | Track connected users, maintain session → cert hash mapping |
| `userDisconnected(User)` | Clean up session tracking, remove from Brmble cert hash set |
| `userStateChanged(User)` | Detect username changes, update Matrix display names |
| `channelCreated(Channel)` | Create corresponding Matrix room |
| `channelRemoved(Channel)` | Archive corresponding Matrix room |
| `channelStateChanged(Channel)` | Sync channel renames to Matrix room names |

This replaces MumbleSharp in the backend entirely. The backend no longer maintains a Mumble client connection — all Mumble server awareness flows through Ice.

### 3.5 Backend Implementation

The backend uses the `zeroc.ice.net` NuGet package (3.7.x) with the Mumble server's Slice definition (`MumbleServer.ice`) compiled to C# stubs via `slice2cs`.

```csharp
// Pseudocode — register callback on startup
var communicator = Ice.Util.initialize();
var proxy = MumbleServer.ServerPrxHelper.checkedCast(
    communicator.stringToProxy("s/1:tcp -h mumble-server -p 6502"));

var callback = new BrmbleBridgeCallback(matrixAppService, userRepository);
proxy.addCallback(callback);
```

```csharp
public class BrmbleBridgeCallback : MumbleServer.ServerCallbackDisp_
{
    public override void userTextMessage(
        MumbleServer.User state, 
        MumbleServer.TextMessage message, 
        Ice.Current current)
    {
        // Dedup: skip if sender is a Brmble client
        // Resolve sender to Matrix user
        // Post to Matrix via appservice API
    }
    
    // ... other callback implementations
}
```

---

## 4. Matrix Application Service

### 4.1 Purpose

A Matrix Application Service (appservice) allows the backend to send messages to Continuwuity as any registered user. When the bridge relays an OG Mumble client's message, it posts to the corresponding Matrix room as that user's Matrix account — making bridged messages indistinguishable from native Matrix messages.

### 4.2 Registration

The appservice is push-only — it sends messages into Matrix but does not need to receive events from Matrix (since all chat input comes from the Mumble/Ice side or directly from Brmble clients).

Registration file (`brmble-bridge.yaml`):

```yaml
id: brmble-bridge
url: null
as_token: <generated-secret>
hs_token: <generated-secret>
sender_localpart: brmble-bridge
namespaces:
  users:
    - exclusive: false
      regex: "@.*:yourserver"
  rooms: []
  aliases: []
```

The `url: null` setting means Continuwuity will not attempt to push events to the appservice. The bridge only writes, never reads from Matrix.

This file is registered with Continuwuity via its configuration.

### 4.3 Sending Messages as a User

The appservice uses the Matrix client-server API with the `user_id` query parameter:

```
PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}?user_id=@42:yourserver
Authorization: Bearer <as_token>

{
    "msgtype": "m.text",
    "body": "plain text fallback",
    "format": "org.matrix.custom.html",
    "formatted_body": "<b>bold</b> HTML content"
}
```

- `as_token` authenticates the appservice
- `user_id` specifies which user the message appears from
- `txnId` is a unique idempotency key (e.g. UUID or hash of session + timestamp)

No Matrix SDK is required in the backend — these are simple HTTP PUT requests.

---

## 5. Room Topology

### 5.1 Channel → Room Mapping

Each Mumble channel maps to a Matrix room. The mapping is stored in the backend database:

```sql
CREATE TABLE channel_room_map (
    mumble_channel_id  INTEGER NOT NULL,
    matrix_room_id     TEXT NOT NULL UNIQUE,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mumble_channel_id)
);
```

### 5.2 Room Lifecycle

**On backend startup:** The backend queries all existing Mumble channels via Ice (`Server.getChannels()`). For each channel, it checks `channel_room_map` and creates any missing Matrix rooms via the appservice API.

**On channel creation:** The Ice `channelCreated` callback fires. The backend creates a new Matrix room and stores the mapping.

**On channel removal:** The Ice `channelRemoved` callback fires. The backend can archive the Matrix room (leave it readable but prevent new messages) or leave it as-is.

**On channel rename:** The Ice `channelStateChanged` callback fires. The backend updates the Matrix room name to match.

### 5.3 Room Membership

When a user's Matrix account is provisioned (first registration via the auth system), the appservice joins them to all channel rooms. The appservice can invite and auto-join users on their behalf.

### 5.4 Channel Tree → Matrix Space

Mumble's channel tree structure can optionally map to Matrix Spaces (a Space is a Matrix room that contains other rooms). This provides hierarchy in Matrix clients. Not essential for initial implementation.

### 5.5 Direct Messages

OG Mumble DMs target a session ID (transient per-connection). When the Ice callback receives a TextMessage with `session` targets instead of `channel_id` targets:

1. Resolve both sender and recipient cert hashes from the session → user mapping
2. Find or create a Matrix DM room between the two users
3. Post the message to that room via the appservice

This is lower priority than channel bridging and can be implemented in a later phase.

---

## 6. Message Format Translation

### 6.1 OG Mumble → Matrix (Ice Bridge)

Mumble TextMessage content is HTML. Matrix also supports HTML via the `formatted_body` field. The two are mostly compatible, but the bridge should sanitize incoming Mumble HTML:

**Allowed tags:** `b`, `i`, `em`, `strong`, `a`, `code`, `pre`, `br`, `p`, `ul`, `ol`, `li`

**Stripped:** `img`, `script`, `style`, `iframe`, embedded objects, event handlers

The `body` field in the Matrix event requires a plain text fallback — strip all HTML tags.

### 6.2 Brmble → Mumble (Client Relay)

When the Brmble client relays a message to Mumble TextMessage, it sends only the text content as HTML. Matrix-native features are not relayed because Mumble TextMessage has no way to express them:

| Matrix feature | Mumble TextMessage relay |
|---|---|
| Plain text / HTML | Relayed as HTML |
| Reactions | Not relayed |
| Message edits | Not relayed |
| Threads | Not relayed (appears as flat message) |
| Read receipts | Not relayed |
| Rich media (images, files) | Not relayed (could send a link) |
| Reply/quote | Could relay as quoted HTML, optional |

OG Mumble clients see a text-only view of the conversation. This is an acceptable tradeoff — full-featured chat is a Brmble experience, and OG clients retain the same functionality they have always had.

---

## 7. Licensing

### 7.1 Impact of ZeroC Ice

ZeroC Ice is licensed under GPLv2. The `zeroc.ice.net` NuGet package is linked directly into the ASP.NET backend binary, which means the backend must be distributed under GPLv2.

### 7.2 Practical Implications

- **The backend is licensed GPLv2.** Anyone who distributes a modified version must release their changes under GPLv2.
- **Hosting is unaffected.** GPLv2 only triggers on distribution of binaries/source, not on running software as a service. Anyone can host Brmble commercially without releasing modifications.
- **The Brmble client is unaffected.** It's a separate program communicating over HTTP/WebSocket, not linked against Ice.
- **Other Brmble components are unaffected.** The React frontend, MumbleSharp fork (client-side), MumbleVoiceEngine — all remain under their own permissive licenses.

### 7.3 Why This Is Acceptable

- Mumble itself is GPLv2 — Brmble's backend being GPLv2 is consistent with the ecosystem
- GPLv2 prevents closed-source forks, which aligns with Brmble's open-source values
- Commercial hosting remains unrestricted due to the SaaS provision in GPLv2
- The copyleft is contained to the server-side backend component only

---

## 8. What OG Mumble Clients Experience

Standard Mumble clients connecting to a Brmble server see:

- **Normal Mumble behavior** — connect, chat, voice, everything works as expected
- **Text messages from Brmble users** appear in real-time as TextMessage (relayed by the Brmble client)
- **Matrix-only features are invisible** — reactions, edits, threads, and read receipts from Brmble users are not relayed and OG clients are unaware of them
- **No bot users** or bridge artifacts visible in the user list
- **No chat history** on reconnect — Mumble has no history mechanism, and this doesn't change
- **Their messages are persisted** in Matrix without their knowledge — if they ever switch to the Brmble client, their full chat history is there

---

## 9. Updated Docker Compose Topology

| Container | Ports | Notes |
|---|---|---|
| mumble-server | Configured TCP+UDP port | Stock image, Ice enabled (`ice="tcp -h 0.0.0.0 -p 6502"`) |
| backend | Internal only (or 443 for client API) | ASP.NET Core, connects to Mumble via Ice, runs Matrix appservice logic |
| continuwuity | Internal only (8448 for federation if needed) | Matrix server, appservice registered for bridge |
| livekit | 7880, 7881, UDP range | SFU for screen sharing |

The backend no longer requires a MumbleSharp connection to the Mumble server. All server-side Mumble awareness flows through the Ice RPC interface.

---

## 10. Implementation Phases

### Phase 1: Brmble Client Direct Matrix Chat
- Implement Matrix room list and message display in the React frontend (Matrix JS SDK)
- Brmble client sends messages directly to Matrix via the user's access token
- Full Matrix feature support: reactions, edits, threads, read receipts
- Brmble-to-Brmble chat is fully functional after this phase

### Phase 2: Ice Integration + OG Client Persistence
- Add `zeroc.ice.net` to the backend
- Compile `MumbleServer.ice` to C# stubs
- Connect to Mumble server via Ice on startup
- Register `ServerCallback`
- Implement channel → Matrix room mapping and creation
- Bridge OG client channel messages to Matrix via appservice

### Phase 3: Brmble → Mumble Relay + Deduplication
- Brmble client sends stripped-down TextMessage to Mumble alongside Matrix writes
- Add Brmble session tracking in the backend for deduplication
- Verify deduplication works correctly with multiple Brmble clients online
- OG Mumble clients can now see Brmble messages in real-time

### Phase 4: DM Bridging
- Handle session-targeted TextMessage via Ice callback
- Implement Matrix DM room creation and mapping
- Bridge OG client DMs to Matrix

### Phase 5: Room Membership Sync
- Auto-join users to Matrix rooms on account provisioning
- Sync channel membership changes (if applicable)
- Optional: Map Mumble channel tree to Matrix Spaces