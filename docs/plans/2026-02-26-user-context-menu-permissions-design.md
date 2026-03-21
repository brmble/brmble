# Design: User Context Menu with Permission Sync

**Date:** 2026-02-26
**Topic:** Add more options to user context menu
**Related Issue:** #50

---

## Overview

This design implements additional right-click context menu options for users in voice channels, with full permission-based visibility matching original Mumble behavior. The implementation includes permission sync from server, admin actions (mute/deafen/move/kick), and comprehensive tests.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   React UI      │────▶│   Bridge     │────▶│  MumbleSharp    │
│                 │     │   (C#)       │     │                 │
│ - ContextMenu   │◀────│              │◀────│ - Permissions   │
│ - Permission    │     │ - voice.*    │     │ - UserState     │
│   State Store   │     │ - permission │     │ - UserRemove    │
└─────────────────┘     └──────────────┘     └─────────────────┘
```

## Backend (C#)

### New Bridge Messages

| Message | Direction | Description |
|---------|-----------|-------------|
| `voice.permissionQuery` | JS → C# | Request permissions for a channel |
| `voice.permissions` | C# → JS | Receive permission updates from server |
| `voice.mute` | JS → C# | Mute a user (requires MuteDeafen) |
| `voice.unmute` | JS → C# | Unmute a user |
| `voice.deafen` | JS → C# | Deafen a user (requires MuteDeafen) |
| `voice.undeafen` | JS → C# | Undeafen a user |
| `voice.setPrioritySpeaker` | JS → C# | Set priority speaker (requires MuteDeafen) |
| `voice.move` | JS → C# | Move user to channel (requires Move) |
| `voice.kick` | JS → C# | Kick user from server (requires Move) |
| `voice.kick` with ban | JS → C# | Ban user (requires Ban + root channel) |

### Permission Caching

- When entering a channel, request `PermissionQuery` via MumbleSharp
- Cache permissions in `Channel.Permissions` 
- Server sends `PermissionQuery` message when permissions change
- Forward permission updates to frontend via bridge

## Frontend (React)

### State

```typescript
interface Permissions {
  channelId: number;
  value: number; // Mumble Permission bitmask
}

interface ContextMenuState {
  x: number;
  y: number;
  userId: string;
  userName: string;
  isSelf: boolean;
  channelId: number;
}
```

### Permission Flags

```typescript
const Permission = {
  Write: 0x1,
  Traverse: 0x2,
  Enter: 0x4,
  Speak: 0x8,
  MuteDeafen: 0x10,
  Move: 0x20,
  MakeChannel: 0x40,
  LinkChannel: 0x80,
  Whisper: 0x100,
  TextMessage: 0x200,
  MakeTempChannel: 0x400,
  Kick: 0x10000,
  Ban: 0x20000,
  Register: 0x40000,
  SelfRegister: 0x80000,
};
```

### Context Menu Items

**All Users:**
- Send Direct Message ✓ (existing)
- View Comment
- Information

**Self User:**
- Local Mute/Unmute
- Volume Adjustment (slider)
- Reset Comment
- Reset Avatar

**Admin (MuteDeafen permission):**
- Mute/Unmute
- Deafen/Undeafen
- Priority Speaker

**Admin (Move permission):**
- Move to...
- Kick

**Admin (Ban permission + root channel):**
- Ban

### Menu Visibility Logic

```typescript
function getMenuItems(user: User, permissions: number, currentChannel: Channel): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  
  // All users
  items.push({ label: 'Send Direct Message', ... });
  items.push({ label: 'View Comment', ... });
  items.push({ label: 'Information', ... });
  
  if (user.self) {
    // Self actions
    items.push({ label: user.muted ? 'Unmute' : 'Mute', ... });
    items.push({ label: 'Volume', ... });
  } else {
    // Admin actions for other users
    if (permissions & Permission.MuteDeafen) {
      items.push({ label: user.muted ? 'Unmute' : 'Mute', ... });
      items.push({ label: user.deafened ? 'Undeafen' : 'Deafen', ... });
      items.push({ label: 'Priority Speaker', ... });
    }
    
    if (permissions & Permission.Move) {
      items.push({ label: 'Move to...', ... });
      items.push({ label: 'Kick', ... });
    }
    
    if ((permissions & Permission.Ban) && currentChannel.id === 0) {
      items.push({ label: 'Ban', ... });
    }
  }
  
  return items;
}
```

## Data Flow

1. **On channel join:**
   - Client → Server: `PermissionQuery { channel_id: X }`
   - Server evaluates ACLs, returns permissions
   - Client ← Server: `PermissionQuery { channel_id: X, permissions: 0xNN }`
   - Store in permissions map

2. **On context menu open:**
   - Check cached permissions for current channel
   - Show/hide menu items based on permissions + target user

3. **On admin action:**
   - Construct protocol message (UserState or UserRemove)
   - Send to server
   - Server validates permissions
   - Server broadcasts update to all clients
   - All clients update UI

## Testing Strategy

### Unit Tests (Brmble.Client.Tests)

**New: MumbleAdapterPermissionTests.cs**
- `PermissionQuery_UpdatesChannelPermissions()` - Verifies permissions cached on channel
- `PermissionDenied_SendsErrorToBridge()` - Verifies errors forwarded to JS
- `Mute_SendsCorrectUserState()` - Verifies mute command format
- `Unmute_SendsCorrectUserState()` - Verifies unmute command format  
- `Deafen_SendsCorrectUserState()` - Verifies deafen command format
- `Move_SendsCorrectUserState_WithChannelId()` - Verifies move includes channel
- `Kick_SendsCorrectUserRemove()` - Verifies kick sends UserRemove message

**New: ContextMenuPermissionTests.cs (or frontend equivalent)**
- `MenuItems_ShownBasedOnPermissions()` - Tests visibility logic
- `SelfUser_HidesAdminOptions()` - Self can't admin themselves
- `MuteOption_RequiresMuteDeafenPermission()` - Permission gating

## Implementation Steps

1. Add voice service methods for permission sync in MumbleAdapter
2. Add bridge message handlers for new voice.* messages
3. Add unit tests for permission handling
4. Add frontend permission state management
5. Update ContextMenu component with new items
6. Add unit tests for menu visibility logic
7. Wire up actions to backend

## Related Files

- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` - Voice service implementation
- `src/Brmble.Web/src/components/ContextMenu/ContextMenu.tsx` - UI component
- `src/Brmble.Web/src/components/ChannelTree.tsx` - User list with context menu
- `lib/MumbleSharp/MumbleSharp/Model/Permissions.cs` - Permission enum
- `tests/Brmble.Client.Tests/` - Unit tests

## References

- Investigation: `docs/investigations/2026-02-26-mumble-user-context-menu-implementation.md`
- Original Mumble Protocol: https://wiki.mumble.info/wiki/Protocol
- Mumble ACL Documentation: https://wiki.mumble.info/wiki/ACL_and_Groups
