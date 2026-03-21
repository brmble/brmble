# EoT Bit Implementation Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Mumble End-of-Transmission (EoT) bit so that other Mumble clients do not hear audio artifacts at the tail of each Brmble transmission.

**Architecture:** The EoT bit lives in bit 13 (0x2000) of the Opus size varint in a Mumble voice packet. We set it on the last packet of a transmission. On the send side: `VoicePacketBuilder` gains an `isTerminating` flag, `EncodePipeline` gains a `Flush(bool terminate)` that zero-pads partial frames and marks the final packet, and `AudioManager.StopMic()` calls `Flush(true)` before disposing. On the receive side: `ParsedVoicePacket` exposes `IsTerminating`, and `AudioManager.FeedVoice` immediately marks the user as stopped when it sees the flag instead of waiting for the 500 ms timeout.

**Tech Stack:** C# (.NET 8), MSTest, MumbleVoiceEngine library, MumbleSharp library, NAudio, native Opus codec.

---

## Key Files

| File | Role |
|------|------|
| `lib/MumbleVoiceEngine/Protocol/VoicePacketBuilder.cs` | Builds raw Mumble voice packets — add `isTerminating` parameter |
| `lib/MumbleVoiceEngine/Protocol/VoicePacketParser.cs` | Parses incoming packets — expose `IsTerminating` in `ParsedVoicePacket` |
| `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` | Accumulates PCM → Opus → packet — add `Flush(bool terminate)` |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | `StopMic()` calls `Flush(true)`; `FeedVoice()` uses `IsTerminating` |
| `lib/MumbleSharp/MumbleSharp/MumbleConnection.cs` | `UnpackVoicePacket` — pass EoT bit through to `EncodedVoice` |
| `lib/MumbleSharp/MumbleSharp/IMumbleProtocol.cs` | `EncodedVoice` signature — add `bool isTerminating` |
| `lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs` | Base `EncodedVoice` implementation — add parameter |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | `EncodedVoice` override — pass flag to `FeedVoice` |
| `tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketBuilderTest.cs` | Tests for builder |
| `tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketParserTest.cs` | Tests for parser |
| `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs` | Tests for pipeline |

## Mumble Packet Format Reminder

```
[type|target (1 byte)] [session varint] [sequence varint] [size varint] [opus data]
                                                                ^
                                                         bit 13 (0x2000) = EoT
```

- Normal packet:      `size = opusData.Length`
- Terminating packet: `size = opusData.Length | 0x2000`
- Parser always masks: `size &= 0x1FFF` to get real byte count

---

### Task 1: VoicePacketBuilder — add `isTerminating` flag

**Files:**
- Modify: `lib/MumbleVoiceEngine/Protocol/VoicePacketBuilder.cs`
- Test: `tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketBuilderTest.cs`

**Step 1: Write the failing tests**

Add to `VoicePacketBuilderTest.cs` inside the class, after the existing tests:

```csharp
[TestMethod]
public void Build_NotTerminating_NoBitSet()
{
    byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
    byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 0, target: 0, isTerminating: false);

    using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
    reader.ReadVarInt64(); // skip sequence
    int rawSize = (int)reader.ReadVarInt64();
    Assert.AreEqual(0, rawSize & 0x2000, "EoT bit must NOT be set for normal packets");
    Assert.AreEqual(3, rawSize & 0x1FFF);
}

[TestMethod]
public void Build_Terminating_SetsEotBit()
{
    byte[] opusData = new byte[] { 0xAA, 0xBB, 0xCC };
    byte[] packet = VoicePacketBuilder.Build(opusData, sequenceNumber: 0, target: 0, isTerminating: true);

    using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));
    reader.ReadVarInt64(); // skip sequence
    int rawSize = (int)reader.ReadVarInt64();
    Assert.AreNotEqual(0, rawSize & 0x2000, "EoT bit (0x2000) must be set for terminating packets");
    Assert.AreEqual(3, rawSize & 0x1FFF, "Masked size must still equal opus data length");
}
```

**Step 2: Run tests to confirm they fail**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Build_NotTerminating_NoBitSet|Build_Terminating_SetsEotBit" -v minimal
```

Expected: compilation error (no `isTerminating` parameter yet).

**Step 3: Update `VoicePacketBuilder.Build` signature**

Replace the entire file content:

```csharp
namespace MumbleVoiceEngine.Protocol;

public static class VoicePacketBuilder
{
    /// <summary>
    /// Build a Mumble Opus voice packet ready for encryption and sending.
    /// Set <paramref name="isTerminating"/> on the final packet of a transmission
    /// to signal End-of-Transmission (EoT) per the Mumble protocol (bit 13 of size varint).
    /// </summary>
    public static byte[] Build(byte[] opusData, long sequenceNumber, int target = 0, bool isTerminating = false)
    {
        byte typeTarget = (byte)((4 << 5) | (target & 0x1F)); // type=4 (Opus)
        byte[] sequence = Varint.Encode((ulong)sequenceNumber);
        ulong sizeValue = (ulong)opusData.Length;
        if (isTerminating)
            sizeValue |= 0x2000;
        byte[] size = Varint.Encode(sizeValue);

        byte[] packet = new byte[1 + sequence.Length + size.Length + opusData.Length];
        packet[0] = typeTarget;
        Array.Copy(sequence, 0, packet, 1, sequence.Length);
        Array.Copy(size, 0, packet, 1 + sequence.Length, size.Length);
        Array.Copy(opusData, 0, packet, 1 + sequence.Length + size.Length, opusData.Length);

        return packet;
    }
}
```

**Step 4: Run tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Build_" -v minimal
```

Expected: all `Build_*` tests pass.

**Step 5: Commit**

```
git add lib/MumbleVoiceEngine/Protocol/VoicePacketBuilder.cs tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketBuilderTest.cs
git commit -m "feat: add isTerminating (EoT bit) to VoicePacketBuilder"
```

---

### Task 2: VoicePacketParser — expose `IsTerminating` in `ParsedVoicePacket`

**Files:**
- Modify: `lib/MumbleVoiceEngine/Protocol/VoicePacketParser.cs`
- Test: `tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketParserTest.cs`

**Step 1: Write the failing tests**

Add to `VoicePacketParserTest.cs` after the existing tests:

```csharp
[TestMethod]
public void Parse_WithEotBit_IsTerminatingTrue()
{
    var ms = new MemoryStream();
    ms.WriteByte(4 << 5);  // type=Opus, target=0
    ms.WriteByte(1);        // session=1
    ms.WriteByte(0);        // sequence=0
    // size=3 with EoT bit set: 0x2003 encodes as two-byte varint
    // Mumble varint: values >= 128 use multi-byte. 0x2003 = 8195 decimal.
    // Varint encoding for 8195: first byte = (8195 >> 7) | 0x80 = 0xC0 | (8195 >> 7 & 0x3F)
    // Use Varint.Encode to get correct bytes
    byte[] sizeVarint = Varint.Encode(3 | 0x2000);
    ms.Write(sizeVarint);
    ms.Write(new byte[] { 0xAA, 0xBB, 0xCC });

    var result = VoicePacketParser.Parse(ms.ToArray());

    Assert.IsNotNull(result);
    Assert.IsTrue(result.Value.IsTerminating, "IsTerminating must be true when EoT bit is set");
    Assert.AreEqual(3, result.Value.OpusData.Length, "OpusData length must be masked (no EoT bit)");
}

[TestMethod]
public void Parse_WithoutEotBit_IsTerminatingFalse()
{
    var ms = new MemoryStream();
    ms.WriteByte(4 << 5);
    ms.WriteByte(1);
    ms.WriteByte(0);
    ms.WriteByte(3);  // size=3, no EoT bit
    ms.Write(new byte[] { 0xAA, 0xBB, 0xCC });

    var result = VoicePacketParser.Parse(ms.ToArray());

    Assert.IsNotNull(result);
    Assert.IsFalse(result.Value.IsTerminating, "IsTerminating must be false when EoT bit is absent");
}
```

**Step 2: Run tests to confirm they fail**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Parse_With" -v minimal
```

Expected: compilation error (no `IsTerminating` field yet).

**Step 3: Update `VoicePacketParser.cs`**

Replace the entire file:

```csharp
namespace MumbleVoiceEngine.Protocol;

public readonly struct ParsedVoicePacket
{
    public readonly int Codec;          // SpeechCodecs enum value (4 = Opus)
    public readonly int Target;         // SpeechTarget enum value
    public readonly uint Session;       // User session ID
    public readonly long Sequence;      // Packet sequence number
    public readonly byte[] OpusData;    // Raw Opus encoded frame
    public readonly bool IsTerminating; // True when the EoT bit (0x2000) was set in the size varint

    public ParsedVoicePacket(int codec, int target, uint session, long sequence, byte[] opusData, bool isTerminating)
    {
        Codec = codec;
        Target = target;
        Session = session;
        Sequence = sequence;
        OpusData = opusData;
        IsTerminating = isTerminating;
    }
}

public static class VoicePacketParser
{
    /// <summary>
    /// Parse a decrypted Mumble voice packet. Returns null for pings or invalid packets.
    /// <see cref="ParsedVoicePacket.IsTerminating"/> is true when the EoT bit (0x2000) was
    /// set in the size varint — the sender has ended its transmission.
    /// </summary>
    public static ParsedVoicePacket? Parse(byte[] packet)
    {
        if (packet == null || packet.Length < 2)
            return null;

        int type = (packet[0] >> 5) & 0x7;
        int target = packet[0] & 0x1F;

        // Type 1 = UDP ping, not a voice packet
        if (type == 1)
            return null;

        using var reader = new PacketReader(new MemoryStream(packet, 1, packet.Length - 1));

        uint session = (uint)reader.ReadVarInt64();
        long sequence = reader.ReadVarInt64();

        // Only Opus supported (type 4)
        if (type != 4)
            return null;

        int rawSize = (int)reader.ReadVarInt64();
        bool isTerminating = (rawSize & 0x2000) != 0;
        int size = rawSize & 0x1FFF; // Mask to 13 bits for actual byte count

        if (size == 0)
            return null;

        byte[]? data = reader.ReadBytes(size);
        if (data == null)
            return null;

        return new ParsedVoicePacket(type, target, session, sequence, data, isTerminating);
    }
}
```

**Step 4: Fix the existing `Parse_OpusPacket_ExtractsFields` test** — the existing test constructs `ParsedVoicePacket` implicitly via `VoicePacketParser.Parse`, which is fine. But the `Build_Parse_ViaServerFormat_RoundTrips` test in `VoicePacketBuilderTest.cs` calls `VoicePacketParser.Parse` and only checks existing fields — no changes needed there.

**Step 5: Run all parser + builder tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "VoicePacketParser|VoicePacketBuilder" -v minimal
```

Expected: all pass.

**Step 6: Commit**

```
git add lib/MumbleVoiceEngine/Protocol/VoicePacketParser.cs tests/MumbleVoiceEngine.Tests/Protocol/VoicePacketParserTest.cs
git commit -m "feat: expose IsTerminating (EoT bit) in ParsedVoicePacket"
```

---

### Task 3: EncodePipeline — add `Flush(bool terminate)`

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`
- Test: `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs`

**Step 1: Write the failing tests**

Add to `EncodePipelineTest.cs`:

```csharp
[TestMethod]
public void Flush_WithPartialFrame_EmitsTerminatingPacket()
{
    var packets = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000,
        channels: 1,
        bitrate: 72000,
        onPacketReady: (data) => packets.Add(data.ToArray())
    );

    // Submit half a frame — not enough to auto-emit
    pipeline.SubmitPcm(new byte[960]);
    Assert.AreEqual(0, packets.Count);

    // Flush should emit exactly one packet with EoT bit
    pipeline.Flush(terminate: true);
    Assert.AreEqual(1, packets.Count, "Flush must emit the partial frame");

    // Verify EoT bit is set in the size varint
    byte[] pkt = packets[0];
    using var reader = new PacketReader(new MemoryStream(pkt, 1, pkt.Length - 1));
    reader.ReadVarInt64(); // skip sequence
    int rawSize = (int)reader.ReadVarInt64();
    Assert.AreNotEqual(0, rawSize & 0x2000, "EoT bit must be set on Flush(terminate: true)");
}

[TestMethod]
public void Flush_WithNoPartialFrame_EmitsNothing()
{
    var packets = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000,
        channels: 1,
        bitrate: 72000,
        onPacketReady: (data) => packets.Add(data.ToArray())
    );

    // Pipeline is empty — flush should not send a spurious packet
    pipeline.Flush(terminate: true);
    Assert.AreEqual(0, packets.Count, "Flush with empty accumulator must emit nothing");
}

[TestMethod]
public void Flush_WithExactFrame_SetsEotBitOnLastEmittedPacket()
{
    // Submit exactly one full frame via SubmitPcm (which auto-emits), then flush
    // to verify that a subsequent flush on an empty buffer emits nothing.
    var packets = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000,
        channels: 1,
        bitrate: 72000,
        onPacketReady: (data) => packets.Add(data.ToArray())
    );

    pipeline.SubmitPcm(new byte[960 * 2]); // full frame → auto-emits without EoT
    Assert.AreEqual(1, packets.Count);

    // The auto-emitted packet must NOT have EoT bit
    using var reader0 = new PacketReader(new MemoryStream(packets[0], 1, packets[0].Length - 1));
    reader0.ReadVarInt64();
    int rawSize0 = (int)reader0.ReadVarInt64();
    Assert.AreEqual(0, rawSize0 & 0x2000, "Auto-emitted packet must not have EoT bit");

    // Flush with empty accumulator — no extra packet
    pipeline.Flush(terminate: true);
    Assert.AreEqual(1, packets.Count, "Flush on empty accumulator must not emit extra packet");
}
```

**Step 2: Run tests to confirm they fail**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Flush_" -v minimal
```

Expected: compilation error (no `Flush` method yet).

**Step 3: Add `Flush` to `EncodePipeline`**

Replace `EncodePipeline.cs` in full:

```csharp
namespace MumbleVoiceEngine.Pipeline;

using MumbleVoiceEngine.Codec;
using MumbleVoiceEngine.Protocol;

/// <summary>
/// Encode pipeline: accumulates PCM → Opus encode → voice packet.
/// Emits complete voice packets via callback when a full frame is encoded.
/// </summary>
public class EncodePipeline : IDisposable
{
    private readonly OpusEncoder _encoder;
    private readonly int _frameSize;        // samples per frame (960)
    private readonly int _frameSizeBytes;   // bytes per frame (1920 for mono 16-bit)
    private readonly byte[] _accumulator;
    private int _accumulatorPos;
    private long _sequenceNumber;
    private readonly Action<ReadOnlyMemory<byte>> _onPacketReady;
    private int _target;

    public EncodePipeline(int sampleRate, int channels, int bitrate,
        Action<ReadOnlyMemory<byte>> onPacketReady, int frameSize = 960)
    {
        _frameSize = frameSize;
        _frameSizeBytes = frameSize * sizeof(short) * channels;
        _accumulator = new byte[_frameSizeBytes];
        _onPacketReady = onPacketReady;

        _encoder = new OpusEncoder(sampleRate, channels)
        {
            Bitrate = bitrate,
            EnableForwardErrorCorrection = true
        };
    }

    public void SetTarget(int target) => _target = target;

    public void ResetSequence() => _sequenceNumber = 0;

    /// <summary>
    /// Submit raw PCM audio. Voice packets are emitted via onPacketReady
    /// when a full Opus frame has been accumulated and encoded.
    /// </summary>
    public void SubmitPcm(ReadOnlySpan<byte> pcm)
    {
        int offset = 0;
        while (offset < pcm.Length)
        {
            int needed = _frameSizeBytes - _accumulatorPos;
            int toCopy = Math.Min(needed, pcm.Length - offset);
            pcm.Slice(offset, toCopy).CopyTo(_accumulator.AsSpan(_accumulatorPos));
            _accumulatorPos += toCopy;
            offset += toCopy;

            if (_accumulatorPos >= _frameSizeBytes)
            {
                EncodeAndEmit(isTerminating: false);
                _accumulatorPos = 0;
            }
        }
    }

    /// <summary>
    /// Flush any buffered PCM as the final packet of a transmission.
    /// If the accumulator holds a partial frame it is zero-padded to a full frame,
    /// encoded, and emitted with the EoT bit set (when <paramref name="terminate"/> is true).
    /// If the accumulator is empty this is a no-op.
    /// Call this when the user stops transmitting (PTT release, VAD end, etc.).
    /// </summary>
    public void Flush(bool terminate = true)
    {
        if (_accumulatorPos == 0)
            return;

        // Zero-pad the rest of the accumulator to complete the frame
        Array.Clear(_accumulator, _accumulatorPos, _frameSizeBytes - _accumulatorPos);
        _accumulatorPos = 0;

        EncodeAndEmit(isTerminating: terminate);
    }

    private void EncodeAndEmit(bool isTerminating)
    {
        var encoded = new byte[_frameSizeBytes]; // max output (actual will be much smaller)
        int encodedLen = _encoder.Encode(_accumulator, 0, encoded, 0, _frameSize);

        var opusData = new byte[encodedLen];
        Array.Copy(encoded, opusData, encodedLen);

        byte[] packet = VoicePacketBuilder.Build(opusData, _sequenceNumber, _target, isTerminating);
        _sequenceNumber++;

        _onPacketReady(packet);
    }

    public void Dispose()
    {
        _encoder.Dispose();
    }
}
```

**Step 4: Run all pipeline tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "EncodePipeline" -v minimal
```

Expected: all pass.

**Step 5: Commit**

```
git add lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs
git commit -m "feat: add Flush(terminate) to EncodePipeline for EoT packet"
```

---

### Task 4: MumbleSharp — thread EoT bit through `UnpackVoicePacket` and `EncodedVoice`

This task propagates the parsed EoT bit from the wire all the way to the application's `EncodedVoice` override so `AudioManager` can act on it immediately.

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/MumbleConnection.cs:211-241`
- Modify: `lib/MumbleSharp/MumbleSharp/IMumbleProtocol.cs`
- Modify: `lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs` (line ~726)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:1630-1636`

> Note: MumbleSharp has its own test coverage that isn't part of `MumbleVoiceEngine.Tests`. There are no unit tests for `MumbleConnection.UnpackVoicePacket` (it requires a live socket). Verify via a full build instead.

**Step 1: Update `MumbleConnection.UnpackVoicePacket`**

In `MumbleConnection.cs` at line ~228, change:

```csharp
// BEFORE
int size = (int)reader.ReadVarInt64();
size &= 0x1fff;

if (size == 0)
    return;

byte[] data = reader.ReadBytes(size);
if (data == null)
    return;

Protocol.EncodedVoice(data, session, sequence, codec, target);
```

```csharp
// AFTER
int rawSize = (int)reader.ReadVarInt64();
bool isTerminating = (rawSize & 0x2000) != 0;
int size = rawSize & 0x1FFF;

if (size == 0)
    return;

byte[] data = reader.ReadBytes(size);
if (data == null)
    return;

Protocol.EncodedVoice(data, session, sequence, codec, target, isTerminating);
```

**Step 2: Update `IMumbleProtocol.EncodedVoice`**

In `IMumbleProtocol.cs`, find:

```csharp
void EncodedVoice(byte[] packet, uint userSession, long sequence, IVoiceCodec codec, SpeechTarget target);
```

Change to:

```csharp
void EncodedVoice(byte[] packet, uint userSession, long sequence, IVoiceCodec codec, SpeechTarget target, bool isTerminating = false);
```

**Step 3: Update `BasicMumbleProtocol.EncodedVoice`**

In `BasicMumbleProtocol.cs` at line ~726:

```csharp
// BEFORE
public virtual void EncodedVoice(byte[] data, uint userId, long sequence, IVoiceCodec codec, SpeechTarget target)
```

```csharp
// AFTER
public virtual void EncodedVoice(byte[] data, uint userId, long sequence, IVoiceCodec codec, SpeechTarget target, bool isTerminating = false)
```

The body does not need to change — `BasicMumbleProtocol` feeds into `AudioDecodingBuffer` which is bypassed by `MumbleAdapter`.

**Step 4: Update `MumbleAdapter.EncodedVoice`**

In `MumbleAdapter.cs` at line 1630:

```csharp
// BEFORE
public override void EncodedVoice(byte[] data, uint userId, long sequence,
    IVoiceCodec codec, SpeechTarget target)
{
    // Don't call base — we use our own decode pipeline instead of
    // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
    _audioManager?.FeedVoice(userId, data, sequence);
}
```

```csharp
// AFTER
public override void EncodedVoice(byte[] data, uint userId, long sequence,
    IVoiceCodec codec, SpeechTarget target, bool isTerminating = false)
{
    // Don't call base — we use our own decode pipeline instead of
    // MumbleSharp's AudioDecodingBuffer (fixed 350ms buffer, poor quality).
    _audioManager?.FeedVoice(userId, data, sequence, isTerminating);
}
```

**Step 5: Build to verify no compilation errors**

```
dotnet build
```

Expected: 0 errors, 0 warnings (or only pre-existing warnings).

**Step 6: Commit**

```
git add lib/MumbleSharp/MumbleSharp/MumbleConnection.cs lib/MumbleSharp/MumbleSharp/IMumbleProtocol.cs lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: thread EoT isTerminating flag through MumbleSharp EncodedVoice"
```

---

### Task 5: AudioManager — send EoT on stop, receive EoT for immediate stop detection

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

There are no unit tests for `AudioManager` (it requires hardware audio). Verify via build.

**Step 1: Update `StopMic()` to call `Flush(true)` before disposing**

In `AudioManager.cs` at line ~338, change `StopMic()`:

```csharp
// BEFORE
public void StopMic()
{
    lock (_lock)
    {
        if (!_micStarted) return;

        _waveIn?.StopRecording();
        _encodePipeline?.Dispose();
        _encodePipeline = null;
        _micStarted = false;
        AudioLog.Write("[Audio] Mic stopped");
    }
}
```

```csharp
// AFTER
public void StopMic()
{
    lock (_lock)
    {
        if (!_micStarted) return;

        // Flush partial frame with EoT bit before tearing down.
        // This tells other Mumble clients the transmission has ended and
        // prevents audio artifacts (clicks/pops) at the tail.
        _encodePipeline?.Flush(terminate: true);

        _waveIn?.StopRecording();
        _encodePipeline?.Dispose();
        _encodePipeline = null;
        _micStarted = false;
        AudioLog.Write("[Audio] Mic stopped");
    }
}
```

**Step 2: Update `FeedVoice` signature and add EoT handling**

In `AudioManager.cs` at line ~510, change `FeedVoice`:

```csharp
// BEFORE
public void FeedVoice(uint userId, byte[] opusData, long sequence)
```

```csharp
// AFTER
public void FeedVoice(uint userId, byte[] opusData, long sequence, bool isTerminating = false)
```

Then, after the `pipeline.FeedEncodedPacket(opusData, sequence);` call (line ~538), add EoT handling. The existing block looks like:

```csharp
pipeline.FeedEncodedPacket(opusData, sequence);

// Speaking detection: track first packet after silence
var now = DateTime.UtcNow;
if (!_lastVoicePacket.ContainsKey(userId))
    startedSpeaking = true;
_lastVoicePacket[userId] = now;
```

Change it to:

```csharp
pipeline.FeedEncodedPacket(opusData, sequence);

if (isTerminating)
{
    // EoT received — remove from tracking immediately so UserStoppedSpeaking fires
    // right away instead of waiting for the SpeakingTimeoutMs timer.
    _lastVoicePacket.Remove(userId);
}
else
{
    // Speaking detection: track first packet after silence
    var now = DateTime.UtcNow;
    if (!_lastVoicePacket.ContainsKey(userId))
        startedSpeaking = true;
    _lastVoicePacket[userId] = now;
}
```

Also add an `AudioLog` entry for diagnostics. Full updated block:

```csharp
pipeline.FeedEncodedPacket(opusData, sequence);

if (isTerminating)
{
    // EoT packet: sender has ended their transmission.
    // Remove immediately so the speaking indicator clears without waiting
    // for the SpeakingTimeoutMs poll.
    AudioLog.Write($"[Audio] EoT received for user {userId}");
    _lastVoicePacket.Remove(userId);
}
else
{
    var now = DateTime.UtcNow;
    if (!_lastVoicePacket.ContainsKey(userId))
        startedSpeaking = true;
    _lastVoicePacket[userId] = now;
}
```

Note: the `UserStoppedSpeaking` event is fired outside the lock after the `startedSpeaking` check. When `isTerminating` is true, `startedSpeaking` remains false and `_lastVoicePacket.Remove` happens inside the lock. The timer (`CheckSpeakingState`) will simply find nothing to remove on its next tick. The `UserStoppedSpeaking` event needs to fire — add this flag:

Full updated `FeedVoice` method (replace the body from line ~510):

```csharp
public void FeedVoice(uint userId, byte[] opusData, long sequence, bool isTerminating = false)
{
    if (_deafened) return;

    bool startedSpeaking = false;
    bool stoppedSpeakingByEot = false;
    lock (_lock)
    {
        if (_localMutes.Contains(userId)) return;

        if (!_pipelines.TryGetValue(userId, out var pipeline))
        {
            var userVolume = _userVolumes.TryGetValue(userId, out var v) ? v : _outputVolume;
            pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
            pipeline.Volume = userVolume;
            _pipelines[userId] = pipeline;

            var player = new WaveOutEvent
            {
                DesiredLatency = _outputDelayMs,
                NumberOfBuffers = 4
            };
            player.Init(pipeline);
            player.Play();
            _players[userId] = player;

            AudioLog.Write($"[Audio] Created playback pipeline for user {userId}");
        }

        pipeline.FeedEncodedPacket(opusData, sequence);

        if (isTerminating)
        {
            // EoT packet: sender has ended their transmission.
            // Remove immediately so the speaking indicator clears without waiting
            // for the SpeakingTimeoutMs poll.
            AudioLog.Write($"[Audio] EoT received for user {userId}");
            stoppedSpeakingByEot = _lastVoicePacket.Remove(userId);
        }
        else
        {
            var now = DateTime.UtcNow;
            if (!_lastVoicePacket.ContainsKey(userId))
                startedSpeaking = true;
            _lastVoicePacket[userId] = now;
        }
    }

    if (startedSpeaking)
        UserStartedSpeaking?.Invoke(userId);

    if (stoppedSpeakingByEot)
        UserStoppedSpeaking?.Invoke(userId);
}
```

**Step 3: Build**

```
dotnet build
```

Expected: 0 errors.

**Step 4: Commit**

```
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: send EoT on StopMic, clear speaking state immediately on EoT receive"
```

---

### Task 6: Run full test suite and verify

**Step 1: Run all tests**

```
dotnet test
```

Expected: all existing tests pass, new tests pass.

**Step 2: If any pre-existing tests fail**, investigate whether the `VoicePacketParser` struct constructor change broke anything. The `ParsedVoicePacket` constructor now takes 6 arguments. Any test that constructs `ParsedVoicePacket` directly (not via `VoicePacketParser.Parse`) must be updated to add `isTerminating: false`.

**Step 3: Commit if any test fixes were needed**

```
git add -A
git commit -m "fix: update tests for ParsedVoicePacket constructor with IsTerminating"
```

---

### Task 7: Create feature branch before any commits

> **Do this before Task 1 if not already on a feature branch.**

```
git checkout -b feature/eot-bit
```

All commits from Tasks 1–6 should be on this branch.
