# Mumble Registration Detection Design

## Problem

When a user is registered on a Mumble server, the server overrides whatever username the client sends and uses the registered name instead. The client currently has no way to know this happened (except through the Brmble Server API, which only works for servers running Brmble Server). We need to detect registration status from the Mumble protocol itself and display the registered name in the server edit form.

## Approach

Read `UserState.user_id` and `UserState.hash` from the Mumble protocol — fields that are already deserialized by MumbleSharp but currently discarded. This works with any Mumble server, not just ones running Brmble Server. The existing Brmble Server API check remains as the primary source; protocol-level detection serves as a fallback for plain Mumble servers.

## Design

### Layer 1: MumbleSharp User Model

Add properties to the `User` model in `lib/MumbleSharp/`:

- `RegisteredUserId` (`uint?`) — from `UserState.user_id`. Null means not registered.
- `CertificateHash` (`string?`) — from `UserState.hash`.
- `IsRegistered` (`bool`, computed) — returns `RegisteredUserId != null`.

Update `BasicMumbleProtocol.UserState()` to read these two fields from incoming messages and store them on the `User` object. The protobuf fields are already deserialized; the handler just ignores them today.

These properties apply to all users, not just the local user. For now we only use `LocalUser`'s values.

### Layer 2: MumbleAdapter Bridge Messages

After connecting (and after auto-registration completes), MumbleAdapter checks `LocalUser.IsRegistered` and sends:

```
voice.registrationStatus → {
  registered: bool,
  registeredName: string | null   // LocalUser.Name when registered
}
```

Timing:
1. After initial connection completes (within the `voice.connected` flow).
2. After auto-registration completes — hook into the `UserState` update that sets `LocalUser.RegisteredUserId`.

MumbleAdapter also persists the registration info to the server entry config via `servers.update`, so the data is available even when disconnected. Values refresh on each new connection.

### Layer 3: Frontend — Username Field in Server Edit Form

**When registered (`registered === true`):**
- Username field shows `registeredName` (the server-assigned name).
- Field is disabled (non-editable) — already implemented.
- A checkmark icon (SVG) appears inside the input on the right side.
- Tooltip: "Registered as [name] on this server".

**When not registered:**
- Username field is editable, no checkmark.
- Falls back to active profile name if empty (existing behavior).

CSS: Wrap the input in a container with a positioned checkmark icon when `registered` is true. Use design tokens for the checkmark color.

No changes to the server list card view — registration status only appears in the edit form.

### Data Persistence

The `ServerEntry` TypeScript interface already has an optional `registered` field. We add `registeredName` (optional string) alongside it. Both are persisted to config.json and refreshed on each connection.

The C# `ServerEntry` record does not currently have these fields — they are stored as extra properties in the JSON and handled by the bridge message layer. No C# record change needed if the existing config serialization is flexible enough; otherwise add `Registered` and `RegisteredName` fields.

## Out of Scope

- Showing registration status for other users (possible with the same data, deferred).
- Showing registration status on the server list card (user chose edit form only).
- Removing the Brmble Server API registration check (kept as primary source).
