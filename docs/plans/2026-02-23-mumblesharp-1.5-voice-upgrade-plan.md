# Mumble 1.5.x Voice Protocol Upgrade Implementation Plan

**Goal:** Add support for Mumble 1.5.x Protobuf-based voice packets while maintaining backward compatibility with older servers.

**Architecture:** 
- Add version detection based on server's Version message
- Create new Protobuf voice packet handler alongside existing binary parser
- Route packets based on detected server version
- Keep existing Opus encoder/decoder unchanged

**Tech Stack:** C#, protobuf-net 2.4.7, MumbleUDP.proto

---

## Task 1: Add MumbleUDP.proto and Generate C# Code

**Files:**
- Create: `lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.proto`
- Create: `lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.cs`

**Step 1: Create proto file**

Create `lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.proto` with content from https://raw.githubusercontent.com/mumble-voip/mumble/master/src/MumbleUDP.proto

Note: The proto uses proto3 syntax. protobuf-net 2.4.x supports proto3 but requires some adjustments. We'll manually create the C# classes instead of using proto generation to ensure compatibility.

**Step 2: Create C# classes manually**

Create `lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.cs` with protobuf-net attributes matching the proto3 message structure:

```csharp
using ProtoBuf;

namespace MumbleProto.UDP
{
    [ProtoContract]
    public class Audio
    {
        [ProtoMember(1, IsRequired = false, Name = "target")]
        public uint Target { get; set; }
        
        [ProtoMember(2, IsRequired = false, Name = "context")]
        public uint Context { get; set; }
        
        [ProtoMember(3, IsRequired = false, Name = "sender_session")]
        public uint SenderSession { get; set; }
        
        [ProtoMember(4, IsRequired = false, Name = "frame_number")]
        public ulong FrameNumber { get; set; }
        
        [ProtoMember(5, IsRequired = false, Name = "opus_data")]
        public byte[] OpusData { get; set; }
        
        [ProtoMember(6, IsRequired = false, Name = "positional_data")]
        public float[] PositionalData { get; set; }
        
        [ProtoMember(7, IsRequired = false, Name = "volume_adjustment")]
        public float VolumeAdjustment { get; set; }
        
        [ProtoMember(16, IsRequired = false, Name = "is_terminator")]
        public bool IsTerminator { get; set; }
    }

    [ProtoContract]
    public class Ping
    {
        [ProtoMember(1, IsRequired = false, Name = "timestamp")]
        public ulong Timestamp { get; set; }
        
        [ProtoMember(2, IsRequired = false, Name = "request_extended_information")]
        public bool RequestExtendedInformation { get; set; }
        
        [ProtoMember(3, IsRequired = false, Name = "server_version_v2")]
        public ulong ServerVersionV2 { get; set; }
        
        [ProtoMember(4, IsRequired = false, Name = "user_count")]
        public uint UserCount { get; set; }
        
        [ProtoMember(5, IsRequired = false, Name = "max_user_count")]
        public uint MaxUserCount { get; set; }
        
        [ProtoMember(6, IsRequired = false, Name = "max_bandwidth_per_user")]
        public uint MaxBandwidthPerUser { get; set; }
    }
}
```

**Step 3: Verify build**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.proto lib/MumbleSharp/MumbleSharp/Packets/MumbleUDP.cs
git commit -m "feat: add MumbleUDP protobuf classes for 1.5.x voice protocol"
```

---

## Task 2: Add Server Version Tracking

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/MumbleConnection.cs`

**Step 1: Add version tracking fields**

In `MumbleConnection.cs`, add fields to track server version:

```csharp
private bool _isServerVersion15OrHigher;
private ulong _serverProtocolVersion;
```

**Step 2: Add version processing**

Find where `Version` message is processed (search for `Type.Version` in `ProcessMessage`). Add:

```csharp
case MumbleSharp.Packets.PacketType.Version:
    var version = MumbleProto.Version.Parser.ParseFrom(payload);
    if (version.VersionV2 > 0)
    {
        _serverProtocolVersion = version.VersionV2;
        // Version v2 format: (major << 22) | (minor << 12) | patch
        // 1.5.0 = (1 << 22) | (5 << 12) | 0 = 0x105000
        _isServerVersion15OrHigher = (_serverProtocolVersion >= 0x105000);
    }
    else if (version.VersionV1 > 0)
    {
        // Legacy version format
        _serverProtocolVersion = version.VersionV1;
        _isServerVersion15OrHigher = false;
    }
    break;
```

**Step 3: Add property to expose version**

```csharp
public bool IsServerVersion15OrHigher => _isServerVersion15OrHigher;
```

**Step 4: Verify build and commit**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: BUILD SUCCEEDED

```bash
git add lib/MumbleSharp/MumbleSharp/MumbleConnection.cs
git commit -m "feat: add server version detection for 1.5.x protocol"
```

---

## Task 3: Create Voice Packet Handler for 1.5.x

**Files:**
- Create: `lib/MumbleSharp/MumbleSharp/Voice/VoicePacketHandler15.cs`

**Step 1: Create the handler class**

```csharp
using MumbleProto.UDP;
using MumbleSharp.Audio.Codecs;

namespace MumbleSharp
{
    public class VoicePacketHandler15
    {
        private readonly MumbleConnection _connection;
        
        public VoicePacketHandler15(MumbleConnection connection)
        {
            _connection = connection;
        }
        
        public void ProcessUDPPacket(byte[] packet, int length)
        {
            // Determine if this is an Audio or Ping packet
            // In 1.5+, the first byte indicates type:
            // 0 = Ping (new format)
            // Otherwise it's Audio with the byte as the start of protobuf data
            
            // Try to parse as Ping first
            using (var stream = new MemoryStream(packet, 0, length))
            {
                try
                {
                    var ping = Ping.Parser.ParseFrom(stream);
                    if (ping.Timestamp > 0)
                    {
                        ProcessPing(ping);
                        return;
                    }
                }
                catch { }
                
                // If not ping, try audio
                stream.Position = 0;
                var audio = Audio.Parser.ParseFrom(stream);
                ProcessAudio(audio);
            }
        }
        
        private void ProcessPing(Ping ping)
        {
            _connection.ProcessUdpPing(ping.Timestamp, ping);
        }
        
        private void ProcessAudio(Audio audio)
        {
            if (audio.OpusData == null || audio.OpusData.Length == 0)
                return;
            
            var session = audio.SenderSession;
            var sequence = (long)audio.FrameNumber;
            
            // Get codec for this user
            var codec = _connection.Protocol.GetCodec(session, SpeechCodecs.Opus);
            if (codec == null)
                return;
            
            // Determine target/context
            var target = (byte)(audio.Target > 0 ? audio.Target : 0);
            
            // Handle terminator (end of transmission)
            if (audio.IsTerminator)
            {
                // Signal end of transmission
                _connection.Protocol.EncodedVoice(audio.OpusData, session, sequence, codec, target);
            }
            else
            {
                _connection.Protocol.EncodedVoice(audio.OpusData, session, sequence, codec, target);
            }
        }
    }
}
```

**Step 2: Verify build**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Voice/VoicePacketHandler15.cs
git commit -m "feat: add Mumble 1.5.x voice packet handler"
```

---

## Task 4: Integrate Voice Packet Routing

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/MumbleConnection.cs`

**Step 1: Add handler field**

```csharp
private VoicePacketHandler15 _voicePacketHandler15;
```

**Step 2: Initialize handler**

In the constructor or connection setup, initialize:
```csharp
_voicePacketHandler15 = new VoicePacketHandler15(this);
```

**Step 3: Modify UDP packet processing**

Find `ProcessUDPPacket` method. The current code checks `type == 1` for ping. Modify to route based on version:

Current code (simplified):
```csharp
if (type == 1)
    Protocol.UdpPing(packet);
else if(VoiceSupportEnabled)
    UnpackVoicePacket(packet, type);
```

Change to:
```csharp
if (type == 1)
{
    // Ping packet - use version-appropriate handler
    if (_isServerVersion15OrHigher && packet.Length > 0)
    {
        // 1.5+ uses protobuf ping
        try
        {
            using (var stream = new MemoryStream(packet))
            {
                var ping = MumbleProto.UDP.Ping.Parser.ParseFrom(stream);
                ProcessUdpPing(BitConverter.ToUInt64(packet, 0), ping);
            }
        }
        catch
        {
            // Fall back to legacy ping processing
            Protocol.UdpPing(packet);
        }
    }
    else
    {
        Protocol.UdpPing(packet);
    }
}
else if (VoiceSupportEnabled)
{
    if (_isServerVersion15OrHigher)
    {
        // Use new protobuf-based handler
        _voicePacketHandler15.ProcessUDPPacket(packet, packet.Length);
    }
    else
    {
        // Use legacy binary handler
        UnpackVoicePacket(packet, type);
    }
}
```

**Step 4: Add method for protobuf ping handling**

```csharp
internal void ProcessUdpPing(ulong timestamp, MumbleProto.UDP.Ping ping)
{
    // Handle extended ping info from 1.5+ servers
    if (ping.RequestExtendedInformation)
    {
        // Server is requesting extended info - we could respond
        // For now, just track the timestamp like legacy
    }
    
    // Use existing ping processing with timestamp
    var pingData = new byte[8];
    BitConverter.GetBytes(timestamp).CopyTo(pingData, 0);
    Protocol.UdpPing(pingData);
}
```

**Step 5: Verify build**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: BUILD SUCCEEDED

**Step 6: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/MumbleConnection.cs
git commit -m "feat: route UDP voice packets based on server version"
```

---

## Task 5: Test with Mumble 1.5.x Server

**Files:**
- Test: Connect to actual Mumble 1.5.x server

**Step 1: Create test connection**

Use existing test infrastructure or create simple test to connect to your Mumble 1.5.x server.

**Step 2: Verify version detection**

Add debug output:
```csharp
Console.WriteLine($"Server version: {_serverProtocolVersion}, Is 1.5+: {_isServerVersion15OrHigher}");
```

**Step 3: Test voice receive**

- Join a channel with other users talking
- Verify audio packets are received and decoded
- Check no exceptions in logs

**Step 4: Test voice transmit**

- Transmit audio to server
- Verify other clients can hear you

**Step 5: Commit test results**

```bash
git commit -m "test: verify 1.5.x voice protocol works"
```

---

## Task 6: Test Backward Compatibility

**Files:**
- Test: Connect to Mumble 1.2.x/1.4.x server

**Step 1: Test with older server**

Connect to a pre-1.5 Mumble server and verify:
- Version detection correctly identifies old server
- Voice still works using legacy protocol

**Step 2: Commit**

```bash
git commit -m "test: verify backward compatibility with older servers"
```

---

## Task 7: Create Integration Test

**Files:**
- Create: `tests/MumbleVoiceEngine.Tests/VoiceProtocol15Tests.cs`

**Step 1: Write tests**

```csharp
using Xunit;

namespace MumbleVoiceEngine.Tests
{
    public class VoiceProtocol15Tests
    {
        [Fact]
        public void Audio_Parses_SenderSession()
        {
            // Create sample Audio protobuf message
            var audio = new MumbleProto.UDP.Audio
            {
                SenderSession = 123,
                FrameNumber = 456,
                OpusData = new byte[] { 0x00, 0x01, 0x02 }
            };
            
            using var stream = new MemoryStream();
            audio.WriteTo(stream);
            stream.Position = 0;
            
            var parsed = MumbleProto.UDP.Audio.Parser.ParseFrom(stream);
            
            Assert.Equal(123u, parsed.SenderSession);
            Assert.Equal(456UL, parsed.FrameNumber);
        }
        
        [Fact]
        public void Ping_Parses_ExtendedInfo()
        {
            var ping = new MumbleProto.UDP.Ping
            {
                Timestamp = 12345,
                ServerVersionV2 = 0x105000,
                UserCount = 10,
                MaxUserCount = 100,
                MaxBandwidthPerUser = 72000
            };
            
            using var stream = new MemoryStream();
            ping.WriteTo(stream);
            stream.Position = 0;
            
            var parsed = MumbleProto.UDP.Ping.Parser.ParseFrom(stream);
            
            Assert.Equal(12345UL, parsed.Timestamp);
            Assert.Equal(0x105000UL, parsed.ServerVersionV2);
            Assert.Equal(10u, parsed.UserCount);
        }
    }
}
```

**Step 2: Run tests**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj`
Expected: Tests pass

**Step 3: Commit**

```bash
git add tests/MumbleVoiceEngine.Tests/VoiceProtocol15Tests.cs
git commit -m "test: add Mumble 1.5.x voice protocol tests"
```

---

## Summary

Total tasks: 7
- Tasks 1-4: Implementation
- Tasks 5-6: Testing  
- Task 7: Unit tests

After completing all tasks, push branch and create PR:
```bash
git push -u origin feature/mumble-1.5-voice-protocol
gh pr create --title "feat: Mumble 1.5.x voice protocol support" --body "..."
```
