# Channel Moderator ACL System

## Overview

Implement a channel-level moderator permission system where admins can assign users as moderators for specific voice channels. Moderators gain configurable powers (kick, ban, rename, password, description) scoped to their assigned channels. The system uses dual-validation (Brmble DB + Mumble) for robust permission enforcement.

## Background

Brmble currently has basic permission bits for channels but lacks a moderator assignment system. This feature enables:

- Admins to define moderator roles with specific permissions
- Assigning registered users as moderators for specific channels
- Moderators to perform channel management actions within their granted scope
- Consistent permission enforcement across Brmble and Mumble

## Data Model

### Database Tables

**ModeratorRole**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | TEXT | Role display name (e.g., "Senior Moderator") |
| permissions | INTEGER | Bitmask of allowed actions |
| created_at | TIMESTAMP | Creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

**ModeratorAssignment**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| role_id | UUID | FK → ModeratorRole |
| channel_id | INTEGER | Mumble channel ID |
| user_id | INTEGER | Mumble user session ID |
| assigned_by | INTEGER | User ID who made the assignment |
| assigned_at | TIMESTAMP | Assignment timestamp |

### Permission Bits

```
Kick          = 0x001  (1)
Ban           = 0x002  (2)
RenameChannel = 0x004  (4)
SetPassword   = 0x008  (8)
EditDesc      = 0x010  (16)
```

### Constraints

- Only registered Mumble users can be assigned as moderators
- A user can have multiple assignments (different channels, different roles)
- The same role can be assigned to multiple users per channel

## Architecture

### Components

1. **ModeratorStore** - Server-side service managing CRUD for roles and assignments
2. **MumbleGroupSync** - Syncs moderator assignments to Mumble ACL groups
3. **PermissionEnforcer** - Dual-validation middleware for moderation actions
4. **Frontend UI** - Channel edit window with "Manage Moderators" tab

### Data Flow

```
Admin Action (UI)
    ↓
Brmble.Server (ModeratorStore)
    ↓
Database (ModeratorRole, ModeratorAssignment)
    ↓
MumbleGroupSync (sync to Mumble ACL group brmble_mod_<channelId>)
    ↓
Confirmation to UI
```

### Mumble Group Sync

**Group naming:** `brmble_mod_<channelId>` (e.g., `brmble_mod_5`)

**Sync triggers:**
- Assignment created → Add user to Mumble group
- Assignment deleted → Remove user from Mumble group
- Role permissions changed → No sync needed (permissions enforced by Brmble, not Mumble ACL)

**Scope:** Groups are applied on the specific channel only, not inherited by child channels.

## Permission Enforcement

### Dual-Validation Flow

1. Client sends moderation action (kick, ban, rename, etc.)
2. Server extracts: requesting user, target channel, action type
3. **Brmble validation:**
   - Query `ModeratorAssignment` for user + channel
   - Get associated `ModeratorRole.permissions`
   - Check required permission bit is set
4. **Mumble validation:**
   - Send permission query to Mumble for the channel
   - Verify user has equivalent Mumble ACL permissions
5. **Decision:**
   - Both pass → Execute action
   - Either fails → Reject with 403 Forbidden

### Actions and Required Permissions

| Action | Permission Bit |
|--------|----------------|
| Kick user from channel | Kick (0x001) |
| Ban user from channel | Ban (0x002) |
| Rename channel | RenameChannel (0x004) |
| Set/clear channel password | SetPassword (0x008) |
| Edit channel description | EditDesc (0x010) |

## API Endpoints

### Role Management (Admin only)

**GET /api/admin/moderator-roles**
- Returns all moderator roles

**POST /api/admin/moderator-roles**
- Body: `{ name: string, permissions: number }`
- Creates new role

**PUT /api/admin/moderator-roles/:id**
- Body: `{ name?: string, permissions?: number }`
- Updates existing role

**DELETE /api/admin/moderator-roles/:id**
- Deletes role (cascades to assignments)

### Assignment Management

**GET /api/channels/:channelId/moderators**
- Returns moderators for a channel
- Accessible by: admins, moderators of that channel

**POST /api/channels/:channelId/moderators**
- Body: `{ userId: number, roleId: UUID }`
- Creates assignment
- Admin only
- Syncs to Mumble group

**DELETE /api/channels/:channelId/moderators/:assignmentId**
- Removes assignment
- Admin only
- Syncs to Mumble group

### Moderation Actions (Permission-gated)

**POST /api/voice/kick**
- Body: `{ userId: number, channelId: number, reason?: string }`

**POST /api/voice/ban**
- Body: `{ userId: number, channelId: number, duration?: number }`

**PATCH /api/channels/:channelId**
- Body: `{ name?: string, password?: string | null, description?: string }`

## Frontend Components

### Channel Edit Window (Brmble-style modal)

- Accessed via right-click channel → "Edit"
- Tabbed interface: General, Manage Moderators, ...

### Manage Moderators Tab

**Admin view:**
- List of current moderators with role names
- Add moderator button → opens user search + role dropdown
- Remove button per moderator entry
- Create/edit role buttons

**Moderator view (read-only):**
- Same list displayed
- All controls disabled/hidden
- Banner or indicator: "View only - contact admin to modify"

### Moderator Role Modal

- Role name input
- Permission checkboxes:
  - [ ] Kick users
  - [ ] Ban users
  - [ ] Rename channel
  - [ ] Set/change channel password
  - [ ] Edit channel description
- Save/Cancel buttons

### Contextual Actions

Users with moderator permissions see additional options:
- Right-click user in channel → Kick, Ban (if permitted)
- Channel edit cog → Edit Name, Password, Description (if permitted)

## Security Considerations

1. **Registered users only** - Assignments limited to registered Mumble users
2. **Channel scoping** - Moderators can only act on channels they're assigned to
3. **Dual validation** - Both Brmble and Mumble must agree on permissions
4. **Audit logging** - Log all assignment changes and moderation actions
5. **Input validation** - Validate all IDs, UUIDs, and permission bits server-side

## Dependencies

- Existing MumbleSharp integration
- Existing permission bits in `usePermissions.ts`
- New server-side tables in Brmble database
- New API endpoints in Brmble.Server

## Out of Scope

- Meta groups (@all, @in, @out, @~sub) - not implementing Mumble's full ACL system
- Channel inheritance for moderator assignments
- ACL rule evaluation order - using simple bitmask check
- Moderator role templates/presets beyond basic CRUD
