# Matrix DM Support Design

**Issue:** #112
**Date:** 2026-02-28

## Summary

Enable direct messages between Brmble users via Matrix 1:1 rooms. Classic Mumble users without a Matrix account fall back to the existing Mumble private message + localStorage path.

## Routing Logic

Dual-path DM routing based on whether the recipient has a Matrix account:

- **Brmble users** (have `matrixUserId`) -> Matrix 1:1 rooms via `matrix-js-sdk`
- **Classic Mumble users** (no `matrixUserId`) -> Mumble private messages + localStorage (existing path, unchanged)

## Server Changes

### MumbleAdapter

Add `matrixUserId` to user payloads:

- Include in `voice.connected` -> `users[]` array
- Include in `voice.userJoined` events
- Lookup by cert hash from the auth database at sync time
- Users without a Matrix account get `matrixUserId: null`

## Frontend Changes

### User State

- Store `matrixUserId` on each user in the users list alongside session/name
- When opening a DM, check `recipient.matrixUserId` to decide routing path

### Matrix DM Rooms

- **Discovery:** Use `m.direct` account data from Matrix sync to find existing DM rooms
- **Creation:** `createRoom({ is_direct: true, invite: [matrixUserId] })` for new conversations
- **Receiving:** Listen to `RoomEvent.Timeline` for DM rooms (filter by `m.direct` rooms)
- **Sending:** `matrixClient.sendMessage(dmRoomId, content)`

### DM Contact List

- Matrix users: contacts derived from `m.direct` rooms (no localStorage)
- Mumble-only users: contacts stay in localStorage (existing path)
- Merge both lists in UI, sorted by most recent message

### Message History

- Start fresh for Matrix DMs -- no migration from localStorage
- Old localStorage data remains accessible until cleared naturally

## What Stays the Same

- Channel messages (already on Matrix)
- Mumble-only DM path (unchanged)
- DM UI components (DMContactList, ChatPanel) -- adapted, not replaced
- Bridge protocol for voice events
