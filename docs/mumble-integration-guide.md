# Mumble Integration Guide

How to connect to a Mumble server, send/receive voice, and use the control plane.

## Architecture

Two libraries work together:

- **MumbleSharp** — Control plane: TCP connection, authentication, user/channel state, text messages, server events. Also handles UDP transport (encryption, sending/receiving voice packets over the wire).
- **MumbleVoiceEngine** — Voice pipeline: Opus encode/decode, PCM buffering. Replaces MumbleSharp's built-in audio pipeline which has quality issues (unbounded encoding buffer causes progressive jitter, fixed 350ms decode buffer adds latency).

```
┌─────────────────────────────────────────────────────┐
│                    Your App                          │
├──────────────────────┬──────────────────────────────┤
│   MumbleSharp        │   MumbleVoiceEngine          │
│   (control plane)    │   (voice pipeline)           │
│                      │                              │
│   Connection         │   EncodePipeline             │
│   Users / Channels   │     PCM → Opus → packet      │
│   Text messages      │                              │
│   Server events      │   UserAudioPipeline          │
│   UDP transport      │     Opus → PCM queue          │
│   Voice encryption   │     IWaveProvider for NAudio  │
└──────────────────────┴──────────────────────────────┘
```

## NuGet Dependencies

```xml
<!-- MumbleVoiceEngine.csproj -->
<PackageReference Include="NAudio.WinMM" Version="2.1.0" />
```

MumbleSharp is included as a project reference. NAudio.WinMM provides `WaveInEvent` (mic capture), `WaveOutEvent` (speaker playback), and `IWaveProvider`/`WaveFormat`.

## Native Libraries

MumbleVoiceEngine requires two native DLLs in the output directory:

- `opus.dll` — Opus audio codec
- `speexdsp.dll` — SpeexDSP (bundled but not actively used for jitter buffering)

These are copied automatically via the `.csproj` Content items.

---

## 1. Connect to Server

```csharp
using MumbleSharp;

// Create your protocol handler (extends BasicMumbleProtocol)
var protocol = new MyProtocol();

// Connect — last param enables voice support (UDP)
var connection = new MumbleConnection("mumble.example.com", 64738, protocol, voiceSupport: true);
connection.Connect(username: "Bot", password: "", tokens: Array.Empty<string>(), serverName: "mumble.example.com");

// MumbleSharp requires a processing loop on a background thread
var processThread = new Thread(() =>
{
    while (connection.State != ConnectionStates.Disconnected)
    {
        if (connection.Process())
            Thread.Yield();
        else
            Thread.Sleep(1);
    }
}) { IsBackground = true };
processThread.Start();

// Wait for server sync (connection fully established)
while (!protocol.ReceivedServerSync)
    Thread.Sleep(100);

// Now connected — protocol.LocalUser, .Users, .Channels are populated
```

### ConnectionStates

- `Connecting` — TCP handshake + TLS + authentication in progress
- `Connected` — Server sync received, fully operational
- `Disconnecting` — Shutdown in progress
- `Disconnected` — Connection closed

---

## 2. Receive Voice (Incoming Audio)

Override `EncodedVoice` in your protocol. **Do not call base** — this bypasses MumbleSharp's built-in `AudioDecodingBuffer` and uses our pipeline instead.

```csharp
using MumbleVoiceEngine.Pipeline;
using NAudio.Wave;

public class MyProtocol : BasicMumbleProtocol
{
    private readonly Dictionary<uint, UserAudioPipeline> _pipelines = new();
    private readonly Dictionary<uint, WaveOutEvent> _players = new();

    public override void EncodedVoice(byte[] data, uint userId, long sequence,
        IVoiceCodec codec, SpeechTarget target)
    {
        // DO NOT call base — we handle decoding ourselves

        // Lazy per-user pipeline creation (only when they speak)
        if (!_pipelines.TryGetValue(userId, out var pipeline))
        {
            pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            _pipelines[userId] = pipeline;

            // Wire to speaker output
            var player = new WaveOutEvent
            {
                DesiredLatency = 80,  // 80ms total buffer
                NumberOfBuffers = 4   // 4 x 20ms
            };
            player.Init(pipeline);
            player.Play();
            _players[userId] = player;
        }

        // Feed Opus data — decoded immediately, queued as PCM
        pipeline.FeedEncodedPacket(data, sequence);
    }
}
```

### UserAudioPipeline

- Implements `IWaveProvider` — NAudio pulls PCM via `Read()`
- `FeedEncodedPacket(byte[] opusData, long sequence)` — call from network thread, decodes Opus immediately and queues PCM
- `Read()` — called by NAudio audio thread, dequeues PCM, fills silence when empty
- Thread-safe (lock between feed and read)
- Format: 48kHz, 16-bit, mono

### Cleanup on User Leave

```csharp
protected override void UserLeft(User user)
{
    base.UserLeft(user);

    if (_players.Remove(user.Id, out var player))
    {
        player.Stop();
        player.Dispose();
    }
    if (_pipelines.Remove(user.Id, out var pipeline))
        pipeline.Dispose();
}
```

---

## 3. Send Voice (Microphone)

Use our `EncodePipeline` and send directly via `Connection.SendVoice()`. **Do not use `Channel.SendVoice(pcm)`** — MumbleSharp's encoding buffer is unbounded and causes progressive jitter after ~30 seconds.

```csharp
using MumbleVoiceEngine.Pipeline;

public class MyProtocol : BasicMumbleProtocol
{
    private EncodePipeline? _encodePipeline;

    public void SendMicAudio(ReadOnlySpan<byte> pcm)
    {
        _encodePipeline ??= new EncodePipeline(
            sampleRate: 48000, channels: 1, bitrate: 72000,
            onPacketReady: packet =>
            {
                Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
            });

        _encodePipeline.SubmitPcm(pcm);
    }
}
```

### Microphone Capture with NAudio

```csharp
var waveIn = new WaveInEvent
{
    DeviceNumber = -1,          // System default input device
    BufferMilliseconds = 20,    // Match Opus 20ms frame size
    WaveFormat = new WaveFormat(48000, 16, 1)  // 48kHz, 16-bit, mono
};

waveIn.DataAvailable += (_, e) =>
{
    protocol.SendMicAudio(new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded));
};

waveIn.StartRecording();

// To stop:
waveIn.StopRecording();
waveIn.Dispose();
```

### EncodePipeline

- `SubmitPcm(ReadOnlySpan<byte> pcm)` — accumulates PCM, encodes Opus when a full 20ms frame (960 samples) is ready, fires callback with the complete voice packet
- Encodes synchronously on the calling thread — no background thread, no queue, no accumulation
- Voice packet format: `[type|target byte] [sequence varint] [opus size varint] [opus data]`
- Bitrate: configurable (72kbps default, good quality for voice)

---

## 4. Control Plane

### Protocol Events (override in your BasicMumbleProtocol subclass)

```csharp
// User lifecycle
protected override void UserJoined(User user) { }
protected override void UserLeft(User user) { }

// User state changes
protected override void UserStateChannelChanged(User user, uint oldChannelId) { }
protected override void UserStateMutedChanged(User user, bool oldSelfMuted, bool oldMuted, bool oldSuppress) { }
protected override void UserStateDeafChanged(User user, bool oldSelfDeaf, bool oldDeaf) { }
protected override void UserStateNameChanged(User user, string oldName) { }
protected override void UserStateCommentChanged(User user, string oldComment) { }

// Channels
protected override void ChannelJoined(Channel channel) { }
protected override void ChannelLeft(Channel channel) { }

// Messages
protected override void PersonalMessageReceived(PersonalMessage message) { }
protected override void ChannelMessageReceived(ChannelMessage message) { }

// Connection
public override void Reject(MumbleProto.Reject reject) { }
```

### Users

```csharp
// Enumerate all users
foreach (var user in protocol.Users)
{
    user.Id;          // uint — session ID
    user.Name;        // string
    user.Channel;     // Channel object
    user.Muted;       // bool — server muted
    user.Deaf;        // bool — server deafened
    user.SelfMuted;   // bool — self muted
    user.SelfDeaf;    // bool — self deafened
    user.Suppress;    // bool — suppressed
    user.Comment;     // string
}

// Local user
var me = protocol.LocalUser;

// Send private message to a user
user.SendMessage("hello");
```

### Channels

```csharp
// Enumerate all channels
foreach (var channel in protocol.Channels)
{
    channel.Id;          // uint
    channel.Name;        // string
    channel.Description; // string
    channel.Temporary;   // bool
    channel.Users;       // IEnumerable<User>
}

// Join a channel
channel.Join();

// Send text message to channel
channel.SendMessage("hello", recursive: false);

// Send HTML message (supports <img>, <a>, basic formatting)
channel.SendMessage("<b>bold</b> text", recursive: false);
```

### Transport

```csharp
// Force TCP tunnel for voice (instead of UDP)
connection.ForceTcp = true;

// Check connection state
if (connection.State == ConnectionStates.Connected) { }
```

---

## 5. Threading Model

| Thread | What runs on it |
|--------|----------------|
| **Process thread** | `connection.Process()` loop — handles all MumbleSharp TCP/UDP packet processing, fires protocol events (`UserJoined`, `EncodedVoice`, etc.) |
| **Mic callback thread** | NAudio `WaveInEvent.DataAvailable` — fires when mic buffer is ready. `SendMicAudio` encodes Opus synchronously here. |
| **Audio playback thread** | NAudio `WaveOutEvent` calls `UserAudioPipeline.Read()` to pull decoded PCM. One thread per `WaveOutEvent` instance. |

Key threading notes:
- `UserAudioPipeline` is thread-safe (lock between `FeedEncodedPacket` on process thread and `Read` on audio thread)
- `EncodePipeline.SubmitPcm` runs on the mic callback thread — no background thread
- Protocol event handlers (`UserJoined`, `EncodedVoice`, etc.) run on the process thread
- `Connection.SendVoice()` is called from the mic callback thread (through the encode pipeline callback)

---

## 6. Disconnect and Cleanup

```csharp
// Stop mic
waveIn.StopRecording();
waveIn.Dispose();

// Stop all playback and dispose pipelines
foreach (var player in _players.Values)
{
    player.Stop();
    player.Dispose();
}
foreach (var pipeline in _pipelines.Values)
    pipeline.Dispose();

// Dispose encode pipeline
_encodePipeline?.Dispose();

// Close connection
connection.Close();
```

---

## 7. Quick Reference

### What to use from MumbleSharp

- `MumbleConnection` — connect, process loop, send voice packets
- `BasicMumbleProtocol` — subclass for events, access `Users`/`Channels`/`LocalUser`
- `User` / `Channel` — state and actions (join, send message)
- `Connection.SendVoice(ArraySegment<byte>)` — send pre-encoded voice packets

### What NOT to use from MumbleSharp

- `Channel.SendVoice(ArraySegment<byte> pcm)` — goes through unbounded `AudioEncodingBuffer`, causes progressive jitter. Use `EncodePipeline` + `Connection.SendVoice()` instead.
- `User.Voice` / `AudioDecodingBuffer` — fixed 350ms buffer, poor quality. Override `EncodedVoice` and use `UserAudioPipeline` instead.
- MumbleSharp's encoding thread (`IsEncodingThreadRunning`) — not used, our encode pipeline is synchronous.

### What to use from MumbleVoiceEngine

- `UserAudioPipeline` — per-user Opus decode + PCM queue (implements `IWaveProvider`)
- `EncodePipeline` — PCM accumulate + Opus encode + voice packet build (synchronous)

### Audio Parameters

| Parameter | Value |
|-----------|-------|
| Sample rate | 48000 Hz |
| Bit depth | 16-bit |
| Channels | 1 (mono) |
| Frame size | 960 samples (20ms) |
| Frame bytes | 1920 bytes |
| Opus bitrate | 72000 bps |
| Codec | Opus (type 4 in Mumble protocol) |
