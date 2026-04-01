# Channel Edit & Add Subchannel Design

**Date:** 2026-04-01  
**Status:** Approved  
**Related Issues:** #421 (password protection blocked on ACL support)

---

## Overview

Implement right-click context menu options to edit voice channel properties and create subchannels. Changes sync to Mumble server (and thus all connected clients including native Mumble) and Matrix room names update automatically.

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

## 2. Add Subchannel Dialog

**Trigger:** Right-click channel → "Add Subchannel" (admin only, requires MakeChannel permission)

### Fields

| Field | Type | Required |
|-------|------|----------|
| Name | text input | Yes |

### Behavior

- Click "Create" → send `voice.createChannel` via bridge with `parent` set to current channel ID
- No confirmation step — direct creation
- Dialog closes on success

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

- "Edit" and "Add Subchannel" options exist but show "coming soon"

### Changes

- Both options remain visible for admins
- Wire up to open respective dialogs
- Non-admins don't see these options (permission check on render)

---

## 5. Architecture & Data Flow

### Edit Channel Flow

```
1. User opens Edit dialog (pre-filled)
2. User changes name/description
3. If name changed → show confirmation dialog
4. User confirms → send voice.editChannel { channelId, name, description }
5. Client bridge → Brmble Server
6. Server → Mumble ICE API setChannelState()
7. Mumble broadcasts ChannelState to all clients
8. Brmble MatrixEventHandler detects OnChannelRenamed → updates Matrix room name
```

### Add Subchannel Flow

```
1. User opens Add Subchannel dialog
2. User enters name
3. Click "Create" → send voice.createChannel { parentId, name }
4. Client bridge → Brmble Server
5. Server → Mumble ICE API createChannel() with parent
6. Mumble broadcasts new ChannelState
7. Brmble MatrixEventHandler detects OnChannelCreated → creates Matrix room
```

### Bridge Messages

| Message | Direction | Payload |
|---------|-----------|---------|
| `voice.editChannel` | Frontend → Client → Server | `{ channelId: number, name?: string, description?: string }` |
| `voice.createChannel` | Frontend → Client → Server | `{ parentId: number, name: string }` |

---

## 6. Error Handling Summary

| Scenario | UI Response |
|----------|-------------|
| Edit fails (network/permission) | Toast error, dialog stays open |
| Create fails (network/permission) | Toast error, dialog stays open |
| Name confirmation cancelled | Return to Edit dialog |
| Success | Dialog closes, no notification needed |

---

## 7. Files to Modify

### Frontend (src/Brmble.Web)

- `src/components/Sidebar/ChannelTree.tsx` — wire up context menu handlers
- `src/components/EditChannelDialog/` — new component for edit dialog
- `src/components/AddSubchannelDialog/` — new component for add dialog
- `src/components/ConfirmRenameDialog/` — new component for name confirmation
- `src/hooks/useVoice.ts` — add/edit bridge message handlers
- `src/App.tsx` — add voice event handlers for channel updates
- CSS files for new components

### Client (src/Brmble.Client)

- `src/Brmble.Client/Bridge/NativeBridge.cs` — route voice.editChannel, voice.createChannel
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — implement editChannel, createChannel

### Server (src/Brmble.Server)

- `src/Brmble.Server/Voice/VoiceService.cs` — handle editChannel, createChannel messages
- Mumble ICE API already has `setChannelState` and `createChannel` — use those

---

## 8. Out of Scope

- Password protection (blocked on #421 — ACL support required)
- Editing channel icon/image
- Moving channels (drag-and-drop reordering)
- Channel permissions UI

---

## 9. Dependencies

- Mumble ICE API (`setChannelState`, `createChannel`) — already available
- `OnChannelRenamed` event handling — already implemented
- `OnChannelCreated` event handling — already implemented
- Matrix room creation/rename — already implemented
