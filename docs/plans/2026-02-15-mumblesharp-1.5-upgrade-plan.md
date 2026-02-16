# MumbleSharp 1.5.x Protocol Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update MumbleSharp library to support Mumble protocol 1.5.x for connecting to modern Mumble servers.

**Architecture:** Update proto files and generated C# code to match latest Mumble 1.5.x protocol specification from https://raw.githubusercontent.com/mumble-voip/mumble/master/src/Mumble.proto

**Tech Stack:** C#, ProtoBuf, MumbleSharp

---

## Task 1: Update Proto File

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/Packets/mumble.proto`

**Step 1: Replace proto file with latest version**

Replace the entire content of `mumble.proto` with the latest Mumble proto from https://raw.githubusercontent.com/mumble-voip/mumble/master/src/Mumble.proto

The key changes include:
- Version: `version` → `version_v1`, new `version_v2` field
- Authenticate: add `client_type` field
- Reject: add `NoNewConnections = 9`
- ChannelState: add `is_enter_restricted`, `can_enter`
- UserRemove: add `ban_certificate`, `ban_ip`
- UserState: add `listening_channel_add`, `listening_channel_remove`, `listening_volume_adjustment`
- PermissionDenied: add `ChannelListenerLimit`, `UserListenerLimit`
- ServerConfig: add `recording_allowed`
- SuggestConfig: `version` → `version_v1`, add `version_v2`
- UserStats: add `rolling_stats`
- New: PluginDataTransmission message

**Step 2: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Packets/mumble.proto
git commit -m "feat: update mumble.proto to 1.5.x protocol"
```

---

## Task 2: Update Generated C# Code (Mumble.cs)

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/Packets/Mumble.cs`

**Step 1: Update Version class**

Add `VersionV2` property (field number 5):

```csharp
[global::ProtoBuf.ProtoMember(5)]
public ulong VersionV2
{
    get { return __pbn__VersionV2.GetValueOrDefault(); }
    set { __pbn__VersionV2 = value; }
}
public bool ShouldSerializeVersionV2() => __pbn__VersionV2 != null;
public void ResetVersionV2() => __pbn__VersionV2 = null;
private ulong? __pbn__VersionV2;
```

**Step 2: Update Authenticate class**

Add `ClientType` property (field number 6):

```csharp
[global::ProtoBuf.ProtoMember(6, Name = @"client_type")]
[global::System.ComponentModel.DefaultValue(0)]
public int ClientType
{
    get { return __pbn__ClientType.GetValueOrDefault(); }
    set { __pbn__ClientType = value; }
}
public bool ShouldSerializeClientType() => __pbn__ClientType != null;
public void ResetClientType() => __pbn__ClientType = null;
private int? __pbn__ClientType;
```

**Step 3: Update Reject.RejectType enum**

Add new enum value:
```csharp
NoNewConnections = 9;
```

**Step 4: Update ChannelState class**

Add `IsEnterRestricted` and `CanEnter` properties:
```csharp
[global::ProtoBuf.ProtoMember(12)]
public bool IsEnterRestricted
{
    get { return __pbn__IsEnterRestricted.GetValueOrDefault(); }
    set { __pbn__IsEnterRestricted = value; }
}
private bool? __pbn__IsEnterRestricted;

[global::ProtoBuf.ProtoMember(13)]
public bool CanEnter
{
    get { return __pbn__CanEnter.GetValueOrDefault(); }
    set { __pbn__CanEnter = value; }
}
private bool? __pbn__CanEnter;
```

**Step 5: Update UserRemove class**

Add `BanCertificate` and `BanIp` properties:
```csharp
[global::ProtoBuf.ProtoMember(5)]
public bool BanCertificate
{
    get { return __pbn__BanCertificate.GetValueOrDefault(); }
    set { __pbn__BanCertificate = value; }
}
private bool? __pbn__BanCertificate;

[global::ProtoBuf.ProtoMember(6)]
public bool BanIp
{
    get { return __pbn__BanIp.GetValueOrDefault(); }
    set { __pbn__BanIp = value; }
}
private bool? __pbn__BanIp;
```

**Step 6: Update UserState class**

Add nested VolumeAdjustment class and new properties:
```csharp
[global::ProtoBuf.ProtoContract()]
public partial class VolumeAdjustment : global::ProtoBuf.IExtensible
{
    private global::ProtoBuf.IExtension __pbn__extensionData;
    global::ProtoBuf.IExtension global::ProtoBuf.IExtensible.GetExtensionObject(bool createIfMissing)
        => global::ProtoBuf.Extensible.GetExtensionObject(ref __pbn__extensionData, createIfMissing);

    [global::ProtoBuf.ProtoMember(1)]
    public uint ListeningChannel { get; set; }
    
    [global::ProtoBuf.ProtoMember(2)]
    public float VolumeAdjustment_ { get; set; }
}

[global::ProtoBuf.ProtoMember(21)]
public global::System.Collections.Generic.List<uint> ListeningChannelAdd { get; private set; } = new();

[global::ProtoBuf.ProtoMember(22)]
public global::System.Collections.Generic.List<uint> ListeningChannelRemove { get; private set; } = new();

[global::ProtoBuf.ProtoMember(23)]
public global::System.Collections.Generic.List<VolumeAdjustment> ListeningVolumeAdjustment { get; private set; } = new();
```

**Step 7: Update PermissionDenied.DenyType enum**

Add new enum values:
```csharp
ChannelListenerLimit = 12;
UserListenerLimit = 13;
```

**Step 8: Update ServerConfig class**

Add `RecordingAllowed` property:
```csharp
[global::ProtoBuf.ProtoMember(7)]
public bool RecordingAllowed
{
    get { return __pbn__RecordingAllowed.GetValueOrDefault(); }
    set { __pbn__RecordingAllowed = value; }
}
private bool? __pbn__RecordingAllowed;
```

**Step 9: Update SuggestConfig class**

Replace `Version` with `VersionV1` and add `VersionV2`:
```csharp
// Rename existing Version (field 1) to VersionV1
[global::ProtoBuf.ProtoMember(1, Name = @"version_v1")]
public uint VersionV1 { get; set; }

[global::ProtoBuf.ProtoMember(4, Name = @"version_v2")]
public ulong VersionV2 { get; set; }
```

**Step 10: Update UserStats class**

Add RollingStats nested class and property:
```csharp
[global::ProtoBuf.ProtoContract()]
public partial class RollingStats
{
    [global::ProtoBuf.ProtoMember(1)]
    public uint TimeWindow { get; set; }
    
    [global::ProtoBuf.ProtoMember(2)]
    public Stats FromClient { get; set; }
    
    [global::ProtoBuf.ProtoMember(3)]
    public Stats FromServer { get; set; }
}

[global::ProtoBuf.ProtoMember(20)]
public RollingStats RollingStats { get; set; }
```

**Step 11: Add PluginDataTransmission class**

Add new message class at end of file:
```csharp
[global::ProtoBuf.ProtoContract()]
public partial class PluginDataTransmission
{
    [global::ProtoBuf.ProtoMember(1)]
    public uint SenderSession { get; set; }
    
    [global::ProtoBuf.ProtoMember(2)]
    public global::System.Collections.Generic.List<uint> ReceiverSessions { get; private set; } = new();
    
    [global::ProtoBuf.ProtoMember(3)]
    public byte[] Data { get; set; }
    
    [global::ProtoBuf.ProtoMember(4)]
    public string DataID { get; set; }
}
```

**Step 12: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Packets/Mumble.cs
git commit -m "feat: add 1.5.x protocol fields to generated C# code"
```

---

## Task 3: Update Model Classes

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/Model/Channel.cs`
- Modify: `lib/MumbleSharp/MumbleSharp/Model/User.cs`

**Step 1: Update Channel model**

Add new properties to Channel class:
```csharp
public bool IsEnterRestricted { get; set; }
public bool CanEnter { get; set; }
```

**Step 2: Update User model**

Add listener-related properties:
```csharp
public List<uint> ListeningChannels { get; } = new();
public Dictionary<uint, float> ListeningVolumeAdjustments { get; } = new();
```

**Step 3: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Model/Channel.cs lib/MumbleSharp/MumbleSharp/Model/User.cs
git commit -m "feat: add 1.5.x fields to Channel and User models"
```

---

## Task 4: Update Connection/Protocol

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/MumbleConnection.cs`
- Modify: `lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs`

**Step 1: Update version handling**

In MumbleConnection.cs, find where Version is sent and update to include both v1 and v2 formats.

The version format:
- v1: `(major << 16) | (minor << 8) | patch` 
- v2: `((ulong)major << 32) | ((ulong)minor << 16) | patch`

For Mumble 1.5.x, we should advertise version 1.5.0 (v1: 0x010500, v2: 0x0001000500000000)

**Step 2: Update Authenticate message**

Ensure ClientType is set (0 for regular client)

**Step 3: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/MumbleConnection.cs lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs
git commit -m "feat: update version negotiation for 1.5.x"
```

---

## Task 5: Build and Test

**Step 1: Build the solution**

```bash
dotnet build
```

**Step 2: Run the client to test**

```bash
dotnet run --project src/Brmble.Client
```

Verify:
- Connection to Mumble server succeeds
- Channel list loads correctly
- User list loads correctly

**Step 3: Commit**

```bash
git add .
git commit -m "test: verify 1.5.x protocol works"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update proto file | mumble.proto |
| 2 | Update generated C# code | Mumble.cs |
| 3 | Update model classes | Channel.cs, User.cs |
| 4 | Update connection handling | MumbleConnection.cs, BasicMumbleProtocol.cs |
| 5 | Build and test | - |
