# Channel Edit & Remove Design

**Date:** 2026-04-01  
**Status:** Implemented (PR #422)  
**Related Issues:** #421 (password protection blocked on ACL support)

---

## Overview

Implement right-click context menu options to edit and remove voice channel properties. Changes sync directly to Mumble server via Mumble protocol packets (`ChannelState`/`ChannelRemove`), not via ICE API. Matrix room names update automatically on channel rename.

---

## 1. Edit Channel Dialog

**Trigger:** Right-click channel → "Edit" (admin only, requires MakeChannel permission)

### Fields

| Field | Type | Pre-filled | Notes |
|-------|------|------------|-------|
| Name | text input | Yes (current name) | Required |
| Description | textarea | Yes (current or empty) | Optional |
| Password | section | — | "Coming soon" placeholder (see #421) |

### Behavior

- Click "Save" → send `voice.editChannel` via bridge
- If name changed → show confirmation dialog (see Section 3)
- Description change saves directly with name
- Click outside or X → close without saving

### Error Handling

- On failure: show error toast, keep dialog open for retry
- On success: close dialog silently

---

## 2. Remove Channel Dialog

**Trigger:** Right-click channel → "Remove" (admin only, requires Write permission on channel)

### Behavior

- Show confirmation modal asking "Are you sure you want to remove '{channelName}'?"
- User must type "Remove" to confirm
- On confirm → send `voice.removeChannel` via bridge
- On success: dialog closes, channel removed from tree
- On failure: show error toast, keep dialog open

### Error Handling

- On failure: show error toast, keep dialog open for retry
- On success: close dialog silently

---

## 3. Name Change Confirmation Dialog

**Trigger:** User clicks "Save" in Edit Channel with a changed name

### Content

```
Title: "Confirm Channel Rename"
Message: "Renaming '{oldName}' to '{newName}' will update the channel name for all users."
Input: "Type 'change' to confirm"
Buttons: Cancel (secondary), Confirm (primary)
```

### Behavior

- User must type "change" exactly (case-insensitive)
- Confirm button disabled until input matches
- On confirm → proceed with edit
- On cancel → return to Edit dialog

---

## 4. Context Menu Updates

### Current State

- "Edit" option exists but shows "coming soon"

### Changes

- "Edit" option wired to open EditChannelDialog (admin only, requires MakeChannel permission)
- "Remove" option added and wired to open RemoveChannelDialog (admin only, requires Write permission)
- Non-admins don't see these options (permission check on render)

---

## 5. Architecture & Data Flow

### Edit Channel Flow

```
1. User opens Edit dialog (pre-filled with current name/description)
2. User changes name/description
3. If name changed → show confirmation dialog (RenameConfirmDialog)
4. User confirms → send voice.editChannel { channelId, name, description }
5. Client bridge → Brmble.Client (MumbleAdapter)
6. MumbleAdapter sends ChannelState packet directly to Mumble server
7. Mumble broadcasts ChannelState to all clients
8. Brmble receives channelChanged event → updates local state
9. MatrixEventHandler detects OnChannelRenamed → updates Matrix room name
```

### Remove Channel Flow

```
1. User right-click → "Remove"
2. Show RemoveChannelDialog asking to type "Remove" to confirm
3. User confirms → send voice.removeChannel { channelId }
4. Client bridge → Brmble.Client (MumbleAdapter)
5. MumbleAdapter sends ChannelRemove packet directly to Mumble server
6. Mumble broadcasts ChannelRemove to all clients
7. Brmble receives channelRemoved event → removes from local state
8. MatrixEventHandler removes Matrix room
```

### Bridge Messages

| Message | Direction | Payload |
|---------|-----------|---------|
| `voice.editChannel` | Frontend → Client | `{ channelId: number, name: string, description: string }` |
| `voice.removeChannel` | Frontend → Client | `{ channelId: number }` |

---

## 6. Error Handling Summary

| Scenario | UI Response |
|----------|-------------|
| Edit fails (network/permission) | Toast error, dialog stays open |
| Create fails (network/permission) | Toast error, dialog stays open |
| Name confirmation cancelled | Return to Edit dialog |
| Success | Dialog closes, no notification needed |

---

## 7. Files Modified

### Frontend (src/Brmble.Web)

- `src/components/Sidebar/ChannelTree.tsx` — context menu handlers for Edit/Remove
- `src/components/EditChannelDialog/EditChannelDialog.tsx` + `.css` — edit dialog component
- `src/components/RenameConfirmDialog/RenameConfirmDialog.tsx` + `.css` — name change confirmation
- `src/App.tsx` — handle `voice.channelChanged` event for state updates

### Client (src/Brmble.Client)

- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — handle `voice.editChannel`, `voice.removeChannel`

---

## 8. Out of Scope

- Add Subchannel (not implemented)
- Password protection (blocked on #421 — ACL support required)
- Editing channel icon/image
- Moving channels (drag-and-drop reordering)
- Channel permissions UI

---

## 9. Dependencies

- Mumble protocol (`ChannelState`, `ChannelRemove` packets) — direct, not ICE
- `OnChannelStateChanged` event handling — already implemented
- Matrix room rename/remove — already implemented
