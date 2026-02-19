# Chat Persistence — Matrix Plumbing + Ice Integration Design

**Date:** 2026-02-20
**Spec:** `docs/chat-persistance-spec.md`, `docs/server/chat-persistance-architecture.md`
**Scope:** Phase 2 — fill in all server-side TODO stubs for the Matrix bridge and ZeroC Ice integration. Auth layer (`UserRepository`, `AuthService`, `AuthEndpoints`) is handled in a separate branch.

---

## What We're Building

The full server-side pipeline that captures OG Mumble client messages via ZeroC Ice and persists them into Matrix via the appservice API:

```
OG Mumble Client
  → Mumble Server
    → Ice callback (MumbleServerCallback)
      → IMumbleEventHandler (MatrixEventHandler)
        → MatrixService (dedup + relay)
          → MatrixAppService (HTTP PUT to Continuwuity)
```

Brmble clients post directly to Matrix from the React frontend and are unaffected by this pipeline.

---

## Section 1 — Data Layer (`ChannelRepository`)

Fill in three Dapper methods against the existing `channel_room_map` SQLite table:

- `GetRoomId(int mumbleChannelId) → string?` — SELECT by channel id
- `Insert(int mumbleChannelId, string matrixRoomId)` — INSERT OR IGNORE
- `Delete(int mumbleChannelId)` — DELETE by channel id

No schema changes. Table already created in `Database.Initialize()`.

---

## Section 2 — Matrix HTTP Layer (`MatrixAppService`)

Three methods, all using `Authorization: Bearer {as_token}` from `Matrix:AppServiceToken` config. Base URL from `Matrix:HomeserverUrl`.

**`SendMessage(string roomId, string displayName, string text)`**
- `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`
- Body: `{ "msgtype": "m.text", "body": "[{displayName}]: {text}" }`
- `txnId` = `Guid.NewGuid().ToString()`
- Used for all OG Mumble client messages (no `user_id` param — posts as bridge bot)

**`CreateRoom(string name) → string roomId`**
- `POST /_matrix/client/v3/createRoom`
- Body: `{ "name": "{name}", "preset": "private_chat" }`
- Returns `room_id` from response

**`SetRoomName(string roomId, string name)`**
- `PUT /_matrix/client/v3/rooms/{roomId}/state/m.room.name`
- Body: `{ "name": "{name}" }`

---

## Section 3 — Orchestration (`MatrixService` + `MatrixEventHandler`)

**`MatrixService.RelayMessage(MumbleUser sender, string text, int channelId)`**
1. If `_activeSessions.IsBrmbleClient(sender.CertHash)` → return (dedup: Brmble client already wrote to Matrix directly)
2. `roomId = _channelRepository.GetRoomId(channelId)` → if null, return silently (unmapped channel)
3. Strip HTML from `text` to plain text (Mumble TextMessage is HTML; spec §6.1)
4. `await _appService.SendMessage(roomId, sender.Name, plainText)`

**`MatrixService.EnsureChannelRoom(MumbleChannel channel)`**
- If `_channelRepository.GetRoomId(channel.Id)` is not null → already mapped, skip
- Otherwise: `roomId = await _appService.CreateRoom(channel.Name)` → `_channelRepository.Insert(channel.Id, roomId)`

**`MatrixEventHandler`** wires `IMumbleEventHandler` to `MatrixService`:

| Event | Action |
|---|---|
| `OnUserTextMessage` | `RelayMessage` |
| `OnChannelCreated` | `EnsureChannelRoom` |
| `OnChannelRemoved` | `_channelRepository.Delete` (Matrix room kept, just unmapped) |
| `OnChannelRenamed` | `_appService.SetRoomName` |
| `OnUserConnected` | no-op (session tracking is auth layer's responsibility) |
| `OnUserDisconnected` | no-op |

---

## Section 4 — Ice Layer (`MumbleServerCallback` + `MumbleIceService`)

**Dependencies:**
- Add `zeroc.ice.net` NuGet package (3.7.x)
- Add `MumbleServer.ice` Slice definition to the project
- Compile to C# stubs via `slice2cs` (or MSBuild task)

**`MumbleServerCallback`** extends `MumbleServer.ServerCallbackDisp_` (Slice-generated):

| Ice method | Dispatches to |
|---|---|
| `userTextMessage(state, msg)` | `OnUserTextMessage(MumbleUser, msg.text, msg.channels[0])` |
| `userConnected(state)` | `OnUserConnected` |
| `userDisconnected(state)` | `OnUserDisconnected` |
| `channelCreated(channel)` | `OnChannelCreated` |
| `channelRemoved(channel)` | `OnChannelRemoved` |
| `channelStateChanged(channel)` | `OnChannelRenamed` |

Ice callbacks are synchronous — dispatch via `Task.Run(...)` to avoid blocking the Ice thread.

**`MumbleIceService`** (`IHostedService`):

`StartAsync`:
1. Init Ice communicator with config (`Ice:Host`, `Ice:Port`, `Ice:Secret`)
2. Connect to Mumble server proxy
3. Call `server.getChannels()` → `MatrixService.EnsureChannelRoom` for each (startup sync)
4. Register `MumbleServerCallback` via `server.addCallback(callback)`
5. If connection fails → log warning, do not throw (Brmble-to-Brmble chat unaffected)

`StopAsync`:
- Destroy Ice communicator cleanly

Config keys: `Ice:Host`, `Ice:Port`, `Ice:Secret`.

---

## Out of Scope

- User provisioning for OG Mumble clients (no Matrix accounts created for unregistered users)
- Room membership sync (auto-join users to rooms) — Phase 5
- Matrix DM bridging — Phase 4
- Matrix Spaces (channel tree hierarchy) — optional, Phase 5
- Continuwuity admin API calls
- Ice reconnection / retry logic
