# MumbleSharp 1.5.x Protocol Upgrade Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan after this design.

**Goal:** Update MumbleSharp library to support Mumble protocol 1.5.x for connecting to modern Mumble servers.

**Architecture:** Update proto files and generated C# code to match latest Mumble 1.5.x protocol specification from https://raw.githubusercontent.com/mumble-voip/mumble/master/src/Mumble.proto

**Tech Stack:** C#, ProtoBuf, MumbleSharp

---

## Protocol Changes Summary

### Priority 1: Basic Connectivity (Required)

| Message | Field | Type | Description |
|---------|-------|------|-------------|
| Version | `version_v2` | uint64 | New version format (patch can exceed 255) |
| Authenticate | `client_type` | int32 | 0=REGULAR, 1=BOT |
| Reject | `NoNewConnections` | enum | Server not accepting connections |
| ChannelState | `is_enter_restricted` | bool | Channel has enter restrictions |
| ChannelState | `can_enter` | bool | User can enter channel |

### Priority 2: Extended Features

| Message | Field | Type | Description |
|---------|-------|------|-------------|
| UserState | `listening_channel_add` | repeated uint32 | Channels user is listening to |
| UserState | `listening_channel_remove` | repeated uint32 | Channels user stopped listening to |
| UserState | `listening_volume_adjustment` | repeated VolumeAdjustment | Per-channel volume |
| UserRemove | `ban_certificate` | bool | Ban by certificate |
| UserRemove | `ban_ip` | bool | Ban by IP |
| PermissionDenied | `ChannelListenerLimit` | enum | Listener limit reached |
| PermissionDenied | `UserListenerLimit` | enum | Listener proxy limit |
| ServerConfig | `recording_allowed` | bool | Recording feature allowed |
| SuggestConfig | `version_v2` | uint64 | Suggested version (new format) |
| UserStats | `rolling_stats` | RollingStats | Extended stats |

### Priority 3: New Messages

| Message | Description |
|---------|-------------|
| PluginDataTransmission | Send plugin messages between clients |

---

## Implementation Approach

### 1. Proto File Update
- Replace `lib/MumbleSharp/MumbleSharp/Packets/mumble.proto` with latest from Mumble master
- Use proto2 syntax (existing)

### 2. Generated C# Code
- Update `lib/MumbleSharp/MumbleSharp/Packets/Mumble.cs` to match new proto
- Add new fields as C# properties with ProtoMember attributes

### 3. Model Updates
- Update Channel model for new fields (`IsEnterRestricted`, `CanEnter`)
- Update User model for listener proxy fields
- Update UserRemove for new ban fields

### 4. Connection/Protocol
- Update version negotiation to support both v1 and v2 formats
- Add client_type to Authenticate message

---

## Testing

1. Connect to a Mumble 1.5.x server (e.g., standard Mumble server)
2. Verify connection succeeds
3. Verify channel list sync works
4. Verify user list sync works
5. Test voice (if server supports)

---

## Reference

- Original Mumble proto: https://raw.githubusercontent.com/mumble-voip/mumble/master/src/Mumble.proto
- Version format issue: https://github.com/mumble-voip/mumble/issues/5827
