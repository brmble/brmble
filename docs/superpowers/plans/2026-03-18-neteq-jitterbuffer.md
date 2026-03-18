# NetEQ Jitter Buffer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple Queue-based audio pipeline with an adaptive NetEQ-inspired jitter buffer featuring packet reordering, adaptive delay, and Opus PLC.

**Architecture:** New `Brmble.Audio` library containing PacketBuffer (sorted encoded packet store), DelayManager (adaptive target delay via histogram), DecisionLogic (playout state machine), and JitterBuffer (orchestrator). Dedicated PlayoutTimer thread at 20ms ticks drives playout. Integrates with existing AudioManager/MumbleAdapter by replacing UserAudioPipeline.

**Tech Stack:** C# / .NET 10, NAudio, Opus (via P/Invoke), MSTest

**Spec:** `docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md`

---

## File Structure

### New Files (src/Brmble.Audio/)

| File | Responsibility |
|------|---------------|
| `src/Brmble.Audio/Brmble.Audio.csproj` | Project file, targets net10.0 |
| `src/Brmble.Audio/NetEQ/Models/EncodedPacket.cs` | Immutable record: sequence, timestamp, payload, arrival time |
| `src/Brmble.Audio/NetEQ/Models/PlayoutDecision.cs` | Enum: Normal, Expand, Accelerate, Decelerate, Merge |
| `src/Brmble.Audio/NetEQ/PacketBuffer.cs` | SortedList-based encoded packet storage with reordering |
| `src/Brmble.Audio/NetEQ/DelayManager.cs` | Relative delay calculation, histogram, target_level |
| `src/Brmble.Audio/NetEQ/DecisionLogic.cs` | Per-tick playout state machine |
| `src/Brmble.Audio/NetEQ/JitterBuffer.cs` | Public API orchestrator |
| `src/Brmble.Audio/NetEQ/PlayoutTimer.cs` | Dedicated 20ms timer thread |
| `src/Brmble.Audio/NetEQ/AudioMixer.cs` | Multi-user sample mixing + ring buffer output |
| `src/Brmble.Audio/NetEQ/RingBuffer.cs` | Lock-free SPSC ring buffer (PlayoutTimer → NAudio) |
| `src/Brmble.Audio/Codecs/IOpusDecoder.cs` | Interface for Opus decode + PLC |
| `src/Brmble.Audio/Codecs/MumbleOpusDecoder.cs` | IOpusDecoder wrapper around MumbleSharp OpusDecoder |
| `src/Brmble.Audio/Diagnostics/JitterBufferStats.cs` | Per-buffer telemetry counters |

### New Files (tests/Brmble.Audio.Tests/)

| File | Responsibility |
|------|---------------|
| `tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj` | Test project, MSTest |
| `tests/Brmble.Audio.Tests/NetEQ/PacketBufferTest.cs` | PacketBuffer unit tests |
| `tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs` | DelayManager unit tests |
| `tests/Brmble.Audio.Tests/NetEQ/DecisionLogicTest.cs` | DecisionLogic unit tests |
| `tests/Brmble.Audio.Tests/NetEQ/RingBufferTest.cs` | RingBuffer unit tests |
| `tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs` | JitterBuffer integration tests |
| `tests/Brmble.Audio.Tests/Helpers/FakeOpusDecoder.cs` | Test double for IOpusDecoder |

### Modified Files

| File | Change |
|------|--------|
| `Brmble.slnx` | Add Brmble.Audio and Brmble.Audio.Tests projects |
| `src/Brmble.Client/Brmble.Client.csproj` | Add ProjectReference to Brmble.Audio |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Replace UserAudioPipeline with JitterBuffer, single WaveOutEvent, PlayoutTimer |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Create EncodedPacket in EncodedVoice() |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `src/Brmble.Audio/Brmble.Audio.csproj`
- Create: `tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj`
- Modify: `Brmble.slnx`

- [ ] **Step 1: Create Brmble.Audio project**

```xml
<!-- src/Brmble.Audio/Brmble.Audio.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
  </PropertyGroup>
</Project>
```

- [ ] **Step 2: Create Brmble.Audio.Tests project**

```xml
<!-- tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj -->
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.7.3" />
    <PackageReference Include="MSTest.TestFramework" Version="3.7.3" />
  </ItemGroup>
  <ItemGroup>
    <ProjectReference Include="..\..\src\Brmble.Audio\Brmble.Audio.csproj" />
  </ItemGroup>
</Project>
```

- [ ] **Step 3: Add both projects to the solution**

```bash
# Check current slnx format, then add projects
dotnet sln Brmble.slnx add src/Brmble.Audio/Brmble.Audio.csproj
dotnet sln Brmble.slnx add tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj
```

- [ ] **Step 4: Verify solution builds**

Run: `dotnet build Brmble.slnx`
Expected: Build succeeded with 0 errors.

- [ ] **Step 5: Verify tests discover**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj`
Expected: 0 tests found (no tests yet), no errors.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Audio/ tests/Brmble.Audio.Tests/ Brmble.slnx
git commit -m "feat: scaffold Brmble.Audio library and test project"
```

---

## Task 2: Models (EncodedPacket, PlayoutDecision, JitterBufferStats)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/Models/EncodedPacket.cs`
- Create: `src/Brmble.Audio/NetEQ/Models/PlayoutDecision.cs`
- Create: `src/Brmble.Audio/Diagnostics/JitterBufferStats.cs`

- [ ] **Step 1: Create EncodedPacket record**

```csharp
// src/Brmble.Audio/NetEQ/Models/EncodedPacket.cs
namespace Brmble.Audio.NetEQ.Models;

/// <summary>
/// An encoded Opus packet received from the network, not yet decoded.
/// Timestamp is derived from Mumble sequence: Sequence × 960.
/// </summary>
public record EncodedPacket(
    long Sequence,
    long Timestamp,
    byte[] Payload,
    long ArrivalTimeMs
);
```

- [ ] **Step 2: Create PlayoutDecision enum**

```csharp
// src/Brmble.Audio/NetEQ/Models/PlayoutDecision.cs
namespace Brmble.Audio.NetEQ.Models;

public enum PlayoutDecision
{
    Normal,
    Expand,
    Accelerate,
    Decelerate,
    Merge
}
```

- [ ] **Step 3: Create JitterBufferStats**

```csharp
// src/Brmble.Audio/Diagnostics/JitterBufferStats.cs
namespace Brmble.Audio.Diagnostics;

public class JitterBufferStats
{
    public int BufferLevel { get; set; }
    public int TargetLevel { get; set; }
    public long TotalFrames { get; set; }
    public long NormalFrames { get; set; }
    public long ExpandFrames { get; set; }
    public long AccelerateFrames { get; set; }
    public long DecelerateFrames { get; set; }
    public long LatePackets { get; set; }
    public long DuplicatePackets { get; set; }

    public JitterBufferStats Snapshot()
    {
        return new JitterBufferStats
        {
            BufferLevel = BufferLevel,
            TargetLevel = TargetLevel,
            TotalFrames = TotalFrames,
            NormalFrames = NormalFrames,
            ExpandFrames = ExpandFrames,
            AccelerateFrames = AccelerateFrames,
            DecelerateFrames = DecelerateFrames,
            LatePackets = LatePackets,
            DuplicatePackets = DuplicatePackets,
        };
    }
}
```

- [ ] **Step 4: Verify build**

Run: `dotnet build src/Brmble.Audio/Brmble.Audio.csproj`
Expected: Build succeeded.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/
git commit -m "feat: add EncodedPacket, PlayoutDecision, and JitterBufferStats models"
```

---

## Task 3: IOpusDecoder Interface + FakeOpusDecoder

**Files:**
- Create: `src/Brmble.Audio/Codecs/IOpusDecoder.cs`
- Create: `tests/Brmble.Audio.Tests/Helpers/FakeOpusDecoder.cs`

- [ ] **Step 1: Create IOpusDecoder interface**

```csharp
// src/Brmble.Audio/Codecs/IOpusDecoder.cs
namespace Brmble.Audio.Codecs;

public interface IOpusDecoder : IDisposable
{
    /// <summary>
    /// Decode an encoded Opus packet into PCM samples.
    /// </summary>
    /// <returns>Number of samples written to output.</returns>
    int Decode(ReadOnlySpan<byte> encodedData, Span<short> output);

    /// <summary>
    /// Generate PLC audio using decoder internal state from previous frames.
    /// </summary>
    /// <returns>Number of samples written to output.</returns>
    int DecodePlc(Span<short> output);
}
```

- [ ] **Step 2: Create FakeOpusDecoder for testing**

```csharp
// tests/Brmble.Audio.Tests/Helpers/FakeOpusDecoder.cs
using Brmble.Audio.Codecs;

namespace Brmble.Audio.Tests.Helpers;

/// <summary>
/// Test double for IOpusDecoder. Generates predictable PCM output:
/// - Decode: fills output with ascending values starting from sequence-based seed
/// - DecodePlc: fills output with zeros (silence) to simulate basic PLC
/// </summary>
public class FakeOpusDecoder : IOpusDecoder
{
    public const int FrameSize = 960; // 20ms @ 48kHz
    public int DecodeCallCount { get; private set; }
    public int PlcCallCount { get; private set; }

    public int Decode(ReadOnlySpan<byte> encodedData, Span<short> output)
    {
        DecodeCallCount++;
        // Use first byte of payload as seed for predictable output
        short seed = encodedData.Length > 0 ? (short)(encodedData[0] * 100) : (short)0;
        int samples = Math.Min(FrameSize, output.Length);
        for (int i = 0; i < samples; i++)
            output[i] = (short)(seed + i);
        return samples;
    }

    public int DecodePlc(Span<short> output)
    {
        PlcCallCount++;
        int samples = Math.Min(FrameSize, output.Length);
        // PLC generates low-amplitude noise to distinguish from real decode
        for (int i = 0; i < samples; i++)
            output[i] = (short)(i % 10);
        return samples;
    }

    public void Dispose() { }
}
```

- [ ] **Step 3: Verify build**

Run: `dotnet build Brmble.slnx`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Audio/Codecs/ tests/Brmble.Audio.Tests/Helpers/
git commit -m "feat: add IOpusDecoder interface and FakeOpusDecoder test double"
```

---

## Task 4: PacketBuffer (TDD)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/PacketBuffer.cs`
- Create: `tests/Brmble.Audio.Tests/NetEQ/PacketBufferTest.cs`

- [ ] **Step 1: Write failing tests for PacketBuffer**

```csharp
// tests/Brmble.Audio.Tests/NetEQ/PacketBufferTest.cs
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class PacketBufferTest
{
    private static EncodedPacket MakePacket(long seq, long arrivalMs = 0)
    {
        return new EncodedPacket(
            Sequence: seq,
            Timestamp: seq * 960,
            Payload: new byte[] { (byte)(seq & 0xFF) },
            ArrivalTimeMs: arrivalMs
        );
    }

    [TestMethod]
    public void Insert_SinglePacket_CanRetrieve()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));

        var result = buf.TryGetNext(960);
        Assert.IsNotNull(result);
        Assert.AreEqual(1L, result.Sequence);
    }

    [TestMethod]
    public void Insert_OutOfOrder_ReturnsInOrder()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(3));
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));

        Assert.AreEqual(1L, buf.TryGetNext(960)!.Sequence);
        Assert.AreEqual(2L, buf.TryGetNext(1920)!.Sequence);
        Assert.AreEqual(3L, buf.TryGetNext(2880)!.Sequence);
    }

    [TestMethod]
    public void Insert_Duplicate_Rejected()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(1)); // duplicate

        Assert.AreEqual(1, buf.Count);
    }

    [TestMethod]
    public void TryGetNext_NoMatch_ReturnsNull()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(5));

        var result = buf.TryGetNext(960); // expects timestamp 960 (seq 1)
        Assert.IsNull(result);
    }

    [TestMethod]
    public void Insert_StalePacket_Rejected()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(10));
        buf.TryGetNext(10 * 960); // consume seq 10, advances lastDecoded

        buf.Insert(MakePacket(3)); // stale: 3 << 10
        Assert.AreEqual(0, buf.Count);
    }

    [TestMethod]
    public void Insert_ExceedsCapacity_OldestDropped()
    {
        var buf = new PacketBuffer(maxCapacity: 3);
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));
        buf.Insert(MakePacket(3));
        buf.Insert(MakePacket(4)); // should drop seq 1

        Assert.AreEqual(3, buf.Count);
        Assert.IsNull(buf.TryGetNext(960)); // seq 1 gone
        Assert.IsNotNull(buf.TryGetNext(1920)); // seq 2 present
    }

    [TestMethod]
    public void Count_ReflectsCurrentSize()
    {
        var buf = new PacketBuffer();
        Assert.AreEqual(0, buf.Count);
        buf.Insert(MakePacket(1));
        Assert.AreEqual(1, buf.Count);
        buf.TryGetNext(960);
        Assert.AreEqual(0, buf.Count);
    }

    [TestMethod]
    public void Flush_ClearsAll()
    {
        var buf = new PacketBuffer();
        buf.Insert(MakePacket(1));
        buf.Insert(MakePacket(2));
        buf.Flush();
        Assert.AreEqual(0, buf.Count);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~PacketBufferTest" -v n`
Expected: Build failure — `PacketBuffer` does not exist yet.

- [ ] **Step 3: Implement PacketBuffer**

```csharp
// src/Brmble.Audio/NetEQ/PacketBuffer.cs
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Stores encoded Opus packets sorted by timestamp.
/// Thread-safe: one producer (network thread) and one consumer (playout thread).
/// </summary>
public class PacketBuffer
{
    private readonly SortedList<long, EncodedPacket> _packets = new();
    private readonly object _lock = new();
    private readonly int _maxCapacity;
    private long _lastDecodedTimestamp = -1;

    // Packets this far behind lastDecoded are considered stale (in timestamp units).
    private const int StaleThreshold = 5 * 960; // 5 frames

    public PacketBuffer(int maxCapacity = 25) // ~500ms at 20ms/frame
    {
        _maxCapacity = maxCapacity;
    }

    public int Count
    {
        get { lock (_lock) return _packets.Count; }
    }

    /// <summary>
    /// Check if a packet with the given timestamp exists in the buffer.
    /// Does not consume the packet.
    /// </summary>
    public bool Contains(long timestamp)
    {
        lock (_lock)
            return _packets.ContainsKey(timestamp);
    }

    /// <summary>
    /// Insert an encoded packet. Rejects duplicates and stale packets.
    /// Returns true if the packet was accepted.
    /// </summary>
    public bool Insert(EncodedPacket packet)
    {
        lock (_lock)
        {
            // Reject stale
            if (_lastDecodedTimestamp >= 0 &&
                packet.Timestamp < _lastDecodedTimestamp - StaleThreshold)
                return false;

            // Reject duplicate
            if (_packets.ContainsKey(packet.Timestamp))
                return false;

            _packets.Add(packet.Timestamp, packet);

            // Enforce capacity — drop oldest
            while (_packets.Count > _maxCapacity)
                _packets.RemoveAt(0);

            return true;
        }
    }

    /// <summary>
    /// Try to retrieve the packet matching expectedTimestamp.
    /// Removes it from the buffer if found.
    /// </summary>
    public EncodedPacket? TryGetNext(long expectedTimestamp)
    {
        lock (_lock)
        {
            if (_packets.Remove(expectedTimestamp, out var packet))
            {
                _lastDecodedTimestamp = expectedTimestamp;
                return packet;
            }
            // Also advance lastDecoded even on miss (so stale check works)
            if (expectedTimestamp > _lastDecodedTimestamp)
                _lastDecodedTimestamp = expectedTimestamp;
            return null;
        }
    }

    /// <summary>
    /// Clear all packets and reset state. Used on sequence reset / reconnect.
    /// </summary>
    public void Flush()
    {
        lock (_lock)
        {
            _packets.Clear();
            _lastDecodedTimestamp = -1;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~PacketBufferTest" -v n`
Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/PacketBuffer.cs tests/Brmble.Audio.Tests/NetEQ/PacketBufferTest.cs
git commit -m "feat: implement PacketBuffer with sorted storage, reordering, and dedup"
```

---

## Task 5: DelayManager (TDD)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/DelayManager.cs`
- Create: `tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs`

- [ ] **Step 1: Write failing tests**

```csharp
// tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs
using Brmble.Audio.NetEQ;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class DelayManagerTest
{
    private const int SampleRate = 48000;
    private const int FrameSize = 960; // 20ms

    [TestMethod]
    public void InitialTargetLevel_IsMinimum()
    {
        var dm = new DelayManager();
        Assert.AreEqual(1, dm.TargetLevel); // 1 frame minimum
    }

    [TestMethod]
    public void Update_LowJitter_TargetStaysLow()
    {
        var dm = new DelayManager();

        // Simulate 50 packets arriving with near-zero jitter
        for (int i = 0; i < 50; i++)
        {
            long timestamp = i * FrameSize;
            long arrivalMs = i * 20; // perfect 20ms spacing
            dm.Update(timestamp, arrivalMs);
        }

        // Low jitter → target should be 1 (minimum)
        Assert.AreEqual(1, dm.TargetLevel);
    }

    [TestMethod]
    public void Update_HighJitter_TargetIncreases()
    {
        var dm = new DelayManager();

        var rng = new Random(42);
        for (int i = 0; i < 100; i++)
        {
            long timestamp = i * FrameSize;
            // Add 0-80ms of random jitter
            long arrivalMs = i * 20 + rng.Next(0, 80);
            dm.Update(timestamp, arrivalMs);
        }

        // With up to 80ms jitter, target should be > 1 frame
        Assert.IsTrue(dm.TargetLevel > 1,
            $"Expected target > 1, got {dm.TargetLevel}");
    }

    [TestMethod]
    public void Update_JitterReduces_TargetShrinks()
    {
        var dm = new DelayManager();

        // First: high jitter
        var rng = new Random(42);
        for (int i = 0; i < 100; i++)
        {
            long timestamp = i * FrameSize;
            long arrivalMs = i * 20 + rng.Next(0, 100);
            dm.Update(timestamp, arrivalMs);
        }
        int highTarget = dm.TargetLevel;

        // Then: low jitter for a while (forget factor should shrink target)
        for (int i = 100; i < 300; i++)
        {
            long timestamp = i * FrameSize;
            long arrivalMs = i * 20 + rng.Next(0, 5); // minimal jitter
            dm.Update(timestamp, arrivalMs);
        }

        Assert.IsTrue(dm.TargetLevel < highTarget,
            $"Expected target to shrink from {highTarget}, got {dm.TargetLevel}");
    }

    [TestMethod]
    public void TargetLevel_NeverExceedsMax()
    {
        var dm = new DelayManager(maxLevel: 15);

        // Extreme jitter
        for (int i = 0; i < 100; i++)
        {
            long timestamp = i * FrameSize;
            long arrivalMs = i * 20 + i * 50; // accumulating delay
            dm.Update(timestamp, arrivalMs);
        }

        Assert.IsTrue(dm.TargetLevel <= 15);
    }

    [TestMethod]
    public void TargetLevel_NeverBelowMin()
    {
        var dm = new DelayManager(minLevel: 1);

        // Perfect arrivals
        for (int i = 0; i < 100; i++)
            dm.Update(i * FrameSize, i * 20);

        Assert.IsTrue(dm.TargetLevel >= 1);
    }

    [TestMethod]
    public void Reset_ClearsHistoryAndTarget()
    {
        var dm = new DelayManager();

        // Build up some state
        for (int i = 0; i < 50; i++)
            dm.Update(i * FrameSize, i * 20 + i * 10);

        dm.Reset();
        Assert.AreEqual(1, dm.TargetLevel);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~DelayManagerTest" -v n`
Expected: Build failure — `DelayManager` does not exist yet.

- [ ] **Step 3: Implement DelayManager**

```csharp
// src/Brmble.Audio/NetEQ/DelayManager.cs
namespace Brmble.Audio.NetEQ;

/// <summary>
/// Calculates the optimal jitter buffer target level using relative delay
/// measurement and a histogram with forget factor.
/// Target level is in units of frames (20ms each).
/// </summary>
public class DelayManager
{
    private const int SampleRate = 48000;
    private const int FrameSizeMs = 20;
    private const int FrameSizeSamples = 960;
    private const double ForgetFactor = 0.9993;
    private const double TargetPercentile = 0.95;
    private const int HistogramBuckets = 50; // 0–49 frames (0–980ms)
    private const int WindowDurationMs = 2000; // sliding window

    private readonly int _minLevel;
    private readonly int _maxLevel;
    private readonly double[] _histogram;
    private readonly Queue<(long iat, long arrivalMs)> _window = new();
    private long _minIat = long.MaxValue;

    public int TargetLevel { get; private set; }

    public DelayManager(int minLevel = 1, int maxLevel = 15)
    {
        _minLevel = minLevel;
        _maxLevel = maxLevel;
        _histogram = new double[HistogramBuckets];
        TargetLevel = _minLevel;
    }

    /// <summary>
    /// Update with a newly received packet's timestamp and local arrival time.
    /// </summary>
    public void Update(long timestamp, long arrivalMs)
    {
        // Compute inter-arrival time offset
        long expectedMs = timestamp * 1000 / SampleRate;
        long iat = arrivalMs - expectedMs;

        // Add to sliding window
        _window.Enqueue((iat, arrivalMs));

        // Remove entries outside the window
        while (_window.Count > 0 && arrivalMs - _window.Peek().arrivalMs > WindowDurationMs)
        {
            _window.Dequeue();
        }

        // Recompute min IAT over window
        _minIat = long.MaxValue;
        foreach (var entry in _window)
        {
            if (entry.iat < _minIat)
                _minIat = entry.iat;
        }

        // Relative delay in ms
        long relativeDelayMs = iat - _minIat;

        // Convert to frame units (bucket index)
        int bucket = (int)(relativeDelayMs / FrameSizeMs);
        bucket = Math.Clamp(bucket, 0, HistogramBuckets - 1);

        // Apply forget factor to all buckets
        for (int i = 0; i < _histogram.Length; i++)
            _histogram[i] *= ForgetFactor;

        // Add current observation
        _histogram[bucket] += 1.0;

        // Compute target level from 95th percentile
        double total = 0;
        for (int i = 0; i < _histogram.Length; i++)
            total += _histogram[i];

        if (total <= 0)
        {
            TargetLevel = _minLevel;
            return;
        }

        double cumulative = 0;
        for (int i = 0; i < _histogram.Length; i++)
        {
            cumulative += _histogram[i] / total;
            if (cumulative >= TargetPercentile)
            {
                // Bucket i represents delay of i frames; target is i+1 to buffer ahead
                TargetLevel = Math.Clamp(i + 1, _minLevel, _maxLevel);
                return;
            }
        }

        TargetLevel = _maxLevel;
    }

    public void Reset()
    {
        Array.Clear(_histogram);
        _window.Clear();
        _minIat = long.MaxValue;
        TargetLevel = _minLevel;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~DelayManagerTest" -v n`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/DelayManager.cs tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs
git commit -m "feat: implement DelayManager with relative delay and histogram"
```

---

## Task 6: DecisionLogic (TDD)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/DecisionLogic.cs`
- Create: `tests/Brmble.Audio.Tests/NetEQ/DecisionLogicTest.cs`

- [ ] **Step 1: Write failing tests**

```csharp
// tests/Brmble.Audio.Tests/NetEQ/DecisionLogicTest.cs
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class DecisionLogicTest
{
    [TestMethod]
    public void PacketAvailable_BufferAtTarget_ReturnsNormal()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 3,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);

        Assert.AreEqual(PlayoutDecision.Normal, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferAboveTarget_ReturnsAccelerate()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 6,  // target + 3
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);

        Assert.AreEqual(PlayoutDecision.Accelerate, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferBelowTarget_ReturnsDecelerate()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 0,  // target - 3
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);

        Assert.AreEqual(PlayoutDecision.Decelerate, decision);
    }

    [TestMethod]
    public void NoPacket_ReturnsExpand()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: false,
            bufferLevel: 0,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);

        Assert.AreEqual(PlayoutDecision.Expand, decision);
    }

    [TestMethod]
    public void PacketAvailable_AfterExpand_ReturnsMerge()
    {
        var logic = new DecisionLogic();
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 3,
            targetLevel: 3,
            previousDecision: PlayoutDecision.Expand);

        Assert.AreEqual(PlayoutDecision.Merge, decision);
    }

    [TestMethod]
    public void PacketAvailable_BufferSlightlyAboveTarget_ReturnsNormal()
    {
        var logic = new DecisionLogic();
        // Within threshold (±2), should be Normal
        var decision = logic.Decide(
            packetAvailable: true,
            bufferLevel: 4,  // target + 1, within threshold of 2
            targetLevel: 3,
            previousDecision: PlayoutDecision.Normal);

        Assert.AreEqual(PlayoutDecision.Normal, decision);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~DecisionLogicTest" -v n`
Expected: Build failure — `DecisionLogic` does not exist yet.

- [ ] **Step 3: Implement DecisionLogic**

```csharp
// src/Brmble.Audio/NetEQ/DecisionLogic.cs
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Per-tick playout decision state machine.
/// Decides whether to play normally, accelerate, decelerate, expand (PLC), or merge.
/// </summary>
public class DecisionLogic
{
    private const int AccelerateThreshold = 2; // frames above target to trigger
    private const int DecelerateThreshold = 2; // frames below target to trigger

    /// <summary>
    /// Decide what to do for this 20ms tick.
    /// </summary>
    /// <param name="packetAvailable">Whether the expected packet is in the buffer.</param>
    /// <param name="bufferLevel">Current number of packets in the buffer.</param>
    /// <param name="targetLevel">Target buffer level from DelayManager.</param>
    /// <param name="previousDecision">The decision from the previous tick.</param>
    public PlayoutDecision Decide(
        bool packetAvailable,
        int bufferLevel,
        int targetLevel,
        PlayoutDecision previousDecision)
    {
        if (!packetAvailable)
            return PlayoutDecision.Expand;

        // Transition from PLC back to real audio
        if (previousDecision == PlayoutDecision.Expand)
            return PlayoutDecision.Merge;

        // Buffer level check
        if (bufferLevel > targetLevel + AccelerateThreshold)
            return PlayoutDecision.Accelerate;

        if (bufferLevel < targetLevel - DecelerateThreshold)
            return PlayoutDecision.Decelerate;

        return PlayoutDecision.Normal;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~DecisionLogicTest" -v n`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/DecisionLogic.cs tests/Brmble.Audio.Tests/NetEQ/DecisionLogicTest.cs
git commit -m "feat: implement DecisionLogic playout state machine"
```

---

## Task 7: RingBuffer (TDD)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/RingBuffer.cs`
- Create: `tests/Brmble.Audio.Tests/NetEQ/RingBufferTest.cs`

- [ ] **Step 1: Write failing tests**

```csharp
// tests/Brmble.Audio.Tests/NetEQ/RingBufferTest.cs
using Brmble.Audio.NetEQ;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class RingBufferTest
{
    [TestMethod]
    public void Write_ThenRead_ReturnsSamples()
    {
        var rb = new RingBuffer(capacity: 4800);
        short[] data = Enumerable.Range(0, 960).Select(i => (short)i).ToArray();
        rb.Write(data);

        var output = new short[960];
        int read = rb.Read(output);
        Assert.AreEqual(960, read);
        Assert.AreEqual((short)0, output[0]);
        Assert.AreEqual((short)959, output[959]);
    }

    [TestMethod]
    public void Read_Empty_ReturnsZero()
    {
        var rb = new RingBuffer(capacity: 4800);
        var output = new short[960];
        int read = rb.Read(output);
        Assert.AreEqual(0, read);
    }

    [TestMethod]
    public void Write_Overrun_DropsOldest()
    {
        var rb = new RingBuffer(capacity: 1920); // 2 frames
        short[] frame1 = Enumerable.Repeat((short)1, 960).ToArray();
        short[] frame2 = Enumerable.Repeat((short)2, 960).ToArray();
        short[] frame3 = Enumerable.Repeat((short)3, 960).ToArray();

        rb.Write(frame1); // fills 1/2
        rb.Write(frame2); // fills 2/2
        rb.Write(frame3); // overrun: drops frame1

        var output = new short[960];
        rb.Read(output);
        Assert.AreEqual((short)2, output[0]); // frame1 was dropped
    }

    [TestMethod]
    public void AvailableSamples_TracksState()
    {
        var rb = new RingBuffer(capacity: 4800);
        Assert.AreEqual(0, rb.AvailableSamples);
        rb.Write(new short[960]);
        Assert.AreEqual(960, rb.AvailableSamples);
        rb.Read(new short[960]);
        Assert.AreEqual(0, rb.AvailableSamples);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~RingBufferTest" -v n`
Expected: Build failure — `RingBuffer` does not exist yet.

- [ ] **Step 3: Implement RingBuffer**

```csharp
// src/Brmble.Audio/NetEQ/RingBuffer.cs
namespace Brmble.Audio.NetEQ;

/// <summary>
/// Single-producer single-consumer ring buffer for PCM samples.
/// Used between PlayoutTimer (writer) and NAudio callback (reader).
/// Uses a lock for simplicity — contention is negligible at 20ms intervals.
/// On overrun, oldest samples are dropped.
/// </summary>
public class RingBuffer
{
    private readonly short[] _buffer;
    private volatile int _readPos;
    private volatile int _writePos;
    private volatile int _count;
    private readonly object _lock = new();

    public RingBuffer(int capacity = 4800) // 100ms at 48kHz
    {
        _buffer = new short[capacity];
    }

    public int AvailableSamples
    {
        get { lock (_lock) return _count; }
    }

    public void Write(ReadOnlySpan<short> samples)
    {
        lock (_lock)
        {
            for (int i = 0; i < samples.Length; i++)
            {
                if (_count >= _buffer.Length)
                {
                    // Overrun: advance read position (drop oldest)
                    _readPos = (_readPos + 1) % _buffer.Length;
                    _count--;
                }
                _buffer[_writePos] = samples[i];
                _writePos = (_writePos + 1) % _buffer.Length;
                _count++;
            }
        }
    }

    public int Read(Span<short> output)
    {
        lock (_lock)
        {
            int toRead = Math.Min(output.Length, _count);
            for (int i = 0; i < toRead; i++)
            {
                output[i] = _buffer[_readPos];
                _readPos = (_readPos + 1) % _buffer.Length;
            }
            _count -= toRead;
            return toRead;
        }
    }
}
```

Note: Using a lock instead of true lock-free for simplicity and correctness. At 20ms tick intervals, contention is negligible. Can be optimized later if profiling shows issues.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~RingBufferTest" -v n`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/RingBuffer.cs tests/Brmble.Audio.Tests/NetEQ/RingBufferTest.cs
git commit -m "feat: implement SPSC RingBuffer for playout-to-NAudio bridge"
```

---

## Task 8: JitterBuffer Orchestrator (TDD)

**Files:**
- Create: `src/Brmble.Audio/NetEQ/JitterBuffer.cs`
- Create: `tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs`

This is the core orchestrator that ties everything together.

- [ ] **Step 1: Write failing tests**

```csharp
// tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs
using Brmble.Audio.Codecs;
using Brmble.Audio.Diagnostics;
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;
using Brmble.Audio.Tests.Helpers;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class JitterBufferTest
{
    private const int FrameSize = 960;

    private static EncodedPacket MakePacket(long seq, long arrivalMs = 0)
    {
        return new EncodedPacket(
            Sequence: seq,
            Timestamp: seq * FrameSize,
            Payload: new byte[] { (byte)(seq & 0xFF), 0x01, 0x02 },
            ArrivalTimeMs: arrivalMs
        );
    }

    [TestMethod]
    public void GetAudio_NoPackets_ReturnsPLC()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        var output = new short[FrameSize];
        jb.GetAudio(output);

        // Should have called PLC
        Assert.AreEqual(1, decoder.PlcCallCount);
        Assert.AreEqual(0, decoder.DecodeCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.ExpandFrames);
    }

    [TestMethod]
    public void InsertThenGetAudio_DecodesNormally()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        // Insert first packet
        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        Assert.AreEqual(1, decoder.DecodeCallCount);
        Assert.AreEqual(0, decoder.PlcCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.NormalFrames);
    }

    [TestMethod]
    public void OutOfOrderPackets_ReorderedCorrectly()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        // Insert out of order
        jb.InsertPacket(MakePacket(1, arrivalMs: 5));
        jb.InsertPacket(MakePacket(0, arrivalMs: 10)); // late but not stale

        var output = new short[FrameSize];

        // First GetAudio should decode seq 0 (timestamp 0)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.DecodeCallCount);

        // Second GetAudio should decode seq 1 (timestamp 960)
        jb.GetAudio(output);
        Assert.AreEqual(2, decoder.DecodeCallCount);
    }

    [TestMethod]
    public void MissingPacket_TriggersPLC_ThenMerge()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        // Insert seq 0 and seq 2 (seq 1 is missing)
        jb.InsertPacket(MakePacket(0, arrivalMs: 0));
        jb.InsertPacket(MakePacket(2, arrivalMs: 40));

        var output = new short[FrameSize];

        // Tick 1: decode seq 0 (Normal)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.DecodeCallCount);

        // Tick 2: seq 1 missing → PLC (Expand)
        jb.GetAudio(output);
        Assert.AreEqual(1, decoder.PlcCallCount);

        // Tick 3: seq 2 available, previous was Expand → Merge
        jb.GetAudio(output);
        Assert.AreEqual(2, decoder.DecodeCallCount);

        var stats = jb.GetStats();
        Assert.AreEqual(1L, stats.ExpandFrames);
        Assert.IsTrue(stats.NormalFrames > 0 || stats.TotalFrames == 3);
    }

    [TestMethod]
    public void GetAudio_AlwaysReturnsSamples()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        // Call 100 times without inserting anything
        var output = new short[FrameSize];
        for (int i = 0; i < 100; i++)
            jb.GetAudio(output);

        // Should never throw, always produce output
        Assert.AreEqual(100, decoder.PlcCallCount);
    }

    [TestMethod]
    public void Volume_ScalesOutput()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);
        jb.Volume = 0.5f;

        jb.InsertPacket(MakePacket(0, arrivalMs: 0));

        var output = new short[FrameSize];
        jb.GetAudio(output);

        // FakeOpusDecoder with payload[0]=0 produces seed=0, so samples = 0,1,2,...
        // At 0.5 volume, sample[100] should be ~50
        Assert.IsTrue(output[100] < 100,
            $"Expected scaled output, got {output[100]}");
    }

    [TestMethod]
    public void Stats_TracksAllDecisions()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);

        // 5 PLC frames
        var output = new short[FrameSize];
        for (int i = 0; i < 5; i++)
            jb.GetAudio(output);

        var stats = jb.GetStats();
        Assert.AreEqual(5L, stats.TotalFrames);
        Assert.AreEqual(5L, stats.ExpandFrames);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~JitterBufferTest" -v n`
Expected: Build failure — `JitterBuffer` class does not exist yet.

- [ ] **Step 3: Implement JitterBuffer**

```csharp
// src/Brmble.Audio/NetEQ/JitterBuffer.cs
using Brmble.Audio.Codecs;
using Brmble.Audio.Diagnostics;
using Brmble.Audio.NetEQ.Models;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Adaptive jitter buffer for a single speaker. Orchestrates PacketBuffer,
/// DelayManager, and DecisionLogic to produce continuous PCM output.
/// Thread safety: InsertPacket() from network thread, GetAudio() from playout thread.
/// </summary>
public class JitterBuffer : IDisposable
{
    private const int FrameSize = 960; // 20ms at 48kHz

    private readonly IOpusDecoder _decoder;
    private readonly PacketBuffer _packetBuffer;
    private readonly DelayManager _delayManager;
    private readonly DecisionLogic _decisionLogic;
    private readonly JitterBufferStats _stats;

    // Pre-allocated buffers to avoid GC pressure on the playout thread
    private readonly short[] _frameBuffer = new short[FrameSize];
    private readonly short[] _secondFrameBuffer = new short[FrameSize];

    // Cross-fade buffer for Merge/Accelerate/Decelerate
    private const int OverlapSamples = 96; // 2ms at 48kHz

    private long _expectedTimestamp;
    private PlayoutDecision _previousDecision = PlayoutDecision.Normal;
    private readonly short[] _lastDecodedFrame = new short[FrameSize]; // for Merge cross-fade
    private bool _hasLastDecodedFrame;
    private bool _firstPacketReceived;
    private bool _disposed;

    // Sequence reset detection
    private const int SequenceResetThreshold = 100;
    private long _lastInsertedSequence = -1;

    public float Volume { get; set; } = 1.0f;

    public bool IsSpeaking { get; private set; }
    private int _realAudioTicks;
    private const int SpeakingThreshold = 3; // ticks of real audio to count as speaking

    public JitterBuffer(IOpusDecoder decoder)
    {
        _decoder = decoder;
        _packetBuffer = new PacketBuffer();
        _delayManager = new DelayManager();
        _decisionLogic = new DecisionLogic();
        _stats = new JitterBufferStats();
    }

    /// <summary>
    /// Insert an encoded packet from the network thread.
    /// </summary>
    public void InsertPacket(EncodedPacket packet)
    {
        // Detect sequence reset (large backward jump)
        if (_lastInsertedSequence >= 0 &&
            packet.Sequence < _lastInsertedSequence - SequenceResetThreshold)
        {
            _packetBuffer.Flush();
            _delayManager.Reset();
            _expectedTimestamp = packet.Timestamp;
            _firstPacketReceived = false;
        }

        _lastInsertedSequence = packet.Sequence;

        // Set expected timestamp from first packet
        if (!_firstPacketReceived)
        {
            _expectedTimestamp = packet.Timestamp;
            _firstPacketReceived = true;
        }

        if (!_packetBuffer.Insert(packet))
        {
            _stats.DuplicatePackets++;
            return;
        }

        _delayManager.Update(packet.Timestamp, packet.ArrivalTimeMs);
    }

    /// <summary>
    /// Produce 20ms (960 samples) of audio for the playout thread.
    /// Always writes exactly FrameSize samples to output.
    /// </summary>
    public void GetAudio(Span<short> output)
    {
        if (output.Length < FrameSize)
            throw new ArgumentException($"Output must be at least {FrameSize} samples");

        _stats.TotalFrames++;
        _stats.BufferLevel = _packetBuffer.Count;
        _stats.TargetLevel = _delayManager.TargetLevel;

        // Peek to see if the expected packet is available (don't consume yet)
        bool packetAvailable = _packetBuffer.Contains(_expectedTimestamp);

        // Track late packets
        if (!packetAvailable && _firstPacketReceived)
        {
            if (_packetBuffer.Count > 0)
                _stats.LatePackets++;
        }

        var decision = _decisionLogic.Decide(
            packetAvailable,
            _packetBuffer.Count,
            _delayManager.TargetLevel,
            _previousDecision);

        // Use pre-allocated buffers instead of stackalloc to avoid
        // stack pressure on the playout thread
        Span<short> frame = _frameBuffer;

        // Consume the packet only for decisions that need it
        EncodedPacket? packet = decision != PlayoutDecision.Decelerate
            ? _packetBuffer.TryGetNext(_expectedTimestamp)
            : null;

        switch (decision)
        {
            case PlayoutDecision.Normal:
                _decoder.Decode(packet!.Payload, frame);
                frame[..FrameSize].CopyTo(output);
                frame[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.NormalFrames++;
                break;

            case PlayoutDecision.Expand:
                _decoder.DecodePlc(frame);
                frame[..FrameSize].CopyTo(output);
                frame[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.ExpandFrames++;
                break;

            case PlayoutDecision.Merge:
                Span<short> mergeFrame = _secondFrameBuffer;
                _decoder.Decode(packet!.Payload, mergeFrame);
                // Cross-fade from PLC to real audio
                if (_hasLastDecodedFrame)
                    CrossFade(output, _lastDecodedFrame, mergeFrame);
                else
                    mergeFrame[..FrameSize].CopyTo(output);
                mergeFrame[..FrameSize].CopyTo(_lastDecodedFrame);
                _hasLastDecodedFrame = true;
                _stats.NormalFrames++; // Merge counts as normal
                break;

            case PlayoutDecision.Accelerate:
                // Decode current packet and next packet, cross-fade to skip one
                _decoder.Decode(packet!.Payload, frame);
                var nextPacket = _packetBuffer.TryGetNext(_expectedTimestamp + FrameSize);
                if (nextPacket != null)
                {
                    Span<short> nextFrame = _secondFrameBuffer;
                    _decoder.Decode(nextPacket.Payload, nextFrame);
                    CrossFade(output, frame, nextFrame);
                    _expectedTimestamp += FrameSize; // skip extra frame
                    nextFrame[..FrameSize].CopyTo(_lastDecodedFrame);
                }
                else
                {
                    frame[..FrameSize].CopyTo(output);
                    frame[..FrameSize].CopyTo(_lastDecodedFrame);
                }
                _hasLastDecodedFrame = true;
                _stats.AccelerateFrames++;
                break;

            case PlayoutDecision.Decelerate:
                // Do NOT consume the packet — we'll decode it again next tick.
                // Output a repeat of the last frame with cross-fade to stretch time.
                if (_hasLastDecodedFrame)
                {
                    // Cross-fade last frame with itself to produce a smooth repeat
                    _lastDecodedFrame.AsSpan(0, FrameSize).CopyTo(output);
                }
                else
                {
                    // No previous frame — generate PLC as fallback
                    _decoder.DecodePlc(frame);
                    frame[..FrameSize].CopyTo(output);
                    frame[..FrameSize].CopyTo(_lastDecodedFrame);
                    _hasLastDecodedFrame = true;
                }
                // Don't advance expectedTimestamp — same packet will be consumed next tick
                _expectedTimestamp -= FrameSize; // undo the advance below
                _stats.DecelerateFrames++;
                break;
        }

        // Apply volume
        float vol = Volume;
        if (vol < 0.999f || vol > 1.001f)
        {
            for (int i = 0; i < FrameSize; i++)
                output[i] = (short)Math.Clamp(output[i] * vol, short.MinValue, short.MaxValue);
        }

        // Advance expected timestamp
        _expectedTimestamp += FrameSize;

        // Update speaking state
        bool isRealAudio = decision is PlayoutDecision.Normal
            or PlayoutDecision.Merge
            or PlayoutDecision.Accelerate
            or PlayoutDecision.Decelerate;

        if (isRealAudio)
            _realAudioTicks = Math.Min(_realAudioTicks + 1, SpeakingThreshold + 1);
        else
            _realAudioTicks = Math.Max(_realAudioTicks - 1, 0);

        IsSpeaking = _realAudioTicks >= SpeakingThreshold;
        _previousDecision = decision;
    }

    /// <summary>
    /// Linear cross-fade between outgoing and incoming frames.
    /// </summary>
    private static void CrossFade(Span<short> output, ReadOnlySpan<short> outgoing, ReadOnlySpan<short> incoming)
    {
        // Copy non-overlapping part from outgoing
        int nonOverlap = FrameSize - OverlapSamples;
        outgoing[..nonOverlap].CopyTo(output);

        // Cross-fade the overlap region
        for (int i = 0; i < OverlapSamples; i++)
        {
            float alpha = (float)i / OverlapSamples;
            output[nonOverlap + i] = (short)(
                outgoing[nonOverlap + i] * (1 - alpha) +
                incoming[i] * alpha);
        }
    }

    public JitterBufferStats GetStats() => _stats.Snapshot();

    public void Dispose()
    {
        if (!_disposed)
        {
            _decoder.Dispose();
            _disposed = true;
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Audio.Tests/ --filter "FullyQualifiedName~JitterBufferTest" -v n`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/JitterBuffer.cs tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs
git commit -m "feat: implement JitterBuffer orchestrator with PLC, cross-fade, and stats"
```

---

## Task 9: PlayoutTimer

**Files:**
- Create: `src/Brmble.Audio/NetEQ/PlayoutTimer.cs`

No TDD for this — it's a timing/threading component best verified via integration. The JitterBuffer tests already cover the logic it drives.

- [ ] **Step 1: Implement PlayoutTimer**

```csharp
// src/Brmble.Audio/NetEQ/PlayoutTimer.cs
using System.Diagnostics;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Dedicated high-priority thread that calls a callback every 20ms.
/// Uses Stopwatch-based drift compensation for accurate timing.
/// </summary>
public class PlayoutTimer : IDisposable
{
    private const int TickIntervalMs = 20;
    private readonly Action _onTick;
    private Thread? _thread;
    private volatile bool _running;

    public PlayoutTimer(Action onTick)
    {
        _onTick = onTick;
    }

    public void Start()
    {
        if (_running) return;
        _running = true;
        _thread = new Thread(RunLoop)
        {
            Name = "Brmble.PlayoutTimer",
            Priority = ThreadPriority.AboveNormal,
            IsBackground = true
        };
        _thread.Start();
    }

    public void Stop()
    {
        _running = false;
        _thread?.Join(timeout: TimeSpan.FromMilliseconds(200));
        _thread = null;
    }

    private void RunLoop()
    {
        var sw = Stopwatch.StartNew();
        long nextTickMs = TickIntervalMs;

        while (_running)
        {
            long elapsed = sw.ElapsedMilliseconds;
            long sleepMs = nextTickMs - elapsed;

            if (sleepMs > 1)
                Thread.Sleep((int)(sleepMs - 1)); // sleep most of the wait

            // Spin-wait for the remaining time for precision
            while (sw.ElapsedMilliseconds < nextTickMs && _running)
                Thread.SpinWait(10);

            if (!_running) break;

            try
            {
                _onTick();
            }
            catch (Exception)
            {
                // Don't let callback exceptions kill the timer thread.
                // In production, log this.
            }

            // Drift compensation: schedule next tick relative to start,
            // not relative to when this tick completed
            nextTickMs += TickIntervalMs;

            // If we've fallen behind by more than 3 ticks, reset
            if (sw.ElapsedMilliseconds > nextTickMs + TickIntervalMs * 3)
                nextTickMs = sw.ElapsedMilliseconds + TickIntervalMs;
        }
    }

    public void Dispose()
    {
        Stop();
    }
}
```

- [ ] **Step 2: Verify build**

Run: `dotnet build src/Brmble.Audio/Brmble.Audio.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/NetEQ/PlayoutTimer.cs
git commit -m "feat: implement PlayoutTimer with drift-compensated 20ms tick"
```

---

## Task 10: AudioMixer

**Files:**
- Create: `src/Brmble.Audio/NetEQ/AudioMixer.cs`

- [ ] **Step 1: Implement AudioMixer**

```csharp
// src/Brmble.Audio/NetEQ/AudioMixer.cs
namespace Brmble.Audio.NetEQ;

/// <summary>
/// Mixes audio from multiple JitterBuffers into a single output stream.
/// Drives the PlayoutTimer tick: calls GetAudio on each buffer, mixes, writes to RingBuffer.
/// </summary>
public class AudioMixer : IDisposable
{
    private const int FrameSize = 960;

    private readonly Dictionary<uint, JitterBuffer> _buffers = new();
    private readonly RingBuffer _ringBuffer;
    private readonly PlayoutTimer _timer;
    private readonly object _lock = new();

    // Reusable buffers to avoid allocation on audio thread
    private readonly short[] _mixBuffer = new short[FrameSize];
    private readonly short[] _userBuffer = new short[FrameSize];
    private readonly int[] _mixAccumulator = new int[FrameSize]; // int to avoid overflow

    public RingBuffer Output => _ringBuffer;

    public AudioMixer()
    {
        _ringBuffer = new RingBuffer(capacity: 4800); // 100ms
        _timer = new PlayoutTimer(OnTick);
    }

    public void Start() => _timer.Start();
    public void Stop() => _timer.Stop();

    public void AddBuffer(uint userId, JitterBuffer buffer)
    {
        lock (_lock)
            _buffers[userId] = buffer;
    }

    public void RemoveBuffer(uint userId)
    {
        lock (_lock)
        {
            if (_buffers.Remove(userId, out var buffer))
                buffer.Dispose();
        }
    }

    public JitterBuffer? GetBuffer(uint userId)
    {
        lock (_lock)
            return _buffers.TryGetValue(userId, out var buf) ? buf : null;
    }

    /// <summary>
    /// Check if a user is currently speaking.
    /// </summary>
    public bool IsUserSpeaking(uint userId)
    {
        lock (_lock)
            return _buffers.TryGetValue(userId, out var buf) && buf.IsSpeaking;
    }

    private void OnTick()
    {
        Array.Clear(_mixAccumulator);

        lock (_lock)
        {
            foreach (var buffer in _buffers.Values)
            {
                buffer.GetAudio(_userBuffer);
                for (int i = 0; i < FrameSize; i++)
                    _mixAccumulator[i] += _userBuffer[i];
            }
        }

        // Clip to short range
        for (int i = 0; i < FrameSize; i++)
            _mixBuffer[i] = (short)Math.Clamp(_mixAccumulator[i], short.MinValue, short.MaxValue);

        _ringBuffer.Write(_mixBuffer);
    }

    public void Dispose()
    {
        _timer.Dispose();
        lock (_lock)
        {
            foreach (var buffer in _buffers.Values)
                buffer.Dispose();
            _buffers.Clear();
        }
    }
}
```

- [ ] **Step 2: Verify build**

Run: `dotnet build src/Brmble.Audio/Brmble.Audio.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/NetEQ/AudioMixer.cs
git commit -m "feat: implement AudioMixer with multi-user mixing and ring buffer output"
```

---

## Task 11: MumbleOpusDecoder Wrapper

**Files:**
- Create: `src/Brmble.Audio/Codecs/MumbleOpusDecoder.cs`
- Modify: `src/Brmble.Audio/Brmble.Audio.csproj` (add reference to MumbleSharp)

- [ ] **Step 1: Add MumbleSharp project reference**

Add to `src/Brmble.Audio/Brmble.Audio.csproj`:
```xml
<ItemGroup>
  <ProjectReference Include="..\..\lib\MumbleSharp\MumbleSharp\MumbleSharp.csproj" />
</ItemGroup>
```

- [ ] **Step 2: Implement MumbleOpusDecoder**

```csharp
// src/Brmble.Audio/Codecs/MumbleOpusDecoder.cs
using MumbleSharp.Audio.Codecs.Opus;

namespace Brmble.Audio.Codecs;

/// <summary>
/// IOpusDecoder wrapper around MumbleSharp's OpusDecoder.
/// Adapts the byte[]-based API to Span-based interface.
/// </summary>
public class MumbleOpusDecoder : IOpusDecoder
{
    private const int FrameSize = 960;
    private readonly OpusDecoder _decoder;
    private readonly byte[] _decodeBuffer; // MumbleSharp outputs bytes (PCM16)
    private bool _disposed;

    public MumbleOpusDecoder(int sampleRate = 48000, int channels = 1)
    {
        _decoder = new OpusDecoder(sampleRate, channels);
        _decodeBuffer = new byte[FrameSize * channels * sizeof(short)];
    }

    public int Decode(ReadOnlySpan<byte> encodedData, Span<short> output)
    {
        byte[] encoded = encodedData.ToArray();
        int bytesDecoded = _decoder.Decode(encoded, 0, encoded.Length, _decodeBuffer, 0);
        int samples = bytesDecoded / sizeof(short);

        // Reinterpret byte[] as short[]
        int toCopy = Math.Min(samples, output.Length);
        for (int i = 0; i < toCopy; i++)
        {
            output[i] = (short)(_decodeBuffer[i * 2] | (_decodeBuffer[i * 2 + 1] << 8));
        }

        return toCopy;
    }

    public int DecodePlc(Span<short> output)
    {
        // MumbleSharp's OpusDecoder supports PLC by passing null
        int bytesDecoded = _decoder.Decode(null!, 0, 0, _decodeBuffer, 0);
        int samples = bytesDecoded / sizeof(short);

        int toCopy = Math.Min(samples, output.Length);
        for (int i = 0; i < toCopy; i++)
        {
            output[i] = (short)(_decodeBuffer[i * 2] | (_decodeBuffer[i * 2 + 1] << 8));
        }

        return toCopy;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _decoder.Dispose();
            _disposed = true;
        }
    }
}
```

- [ ] **Step 3: Verify build**

Run: `dotnet build src/Brmble.Audio/Brmble.Audio.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Audio/
git commit -m "feat: implement MumbleOpusDecoder wrapper with PLC support"
```

---

## Task 12: Integrate into AudioManager

**Files:**
- Modify: `src/Brmble.Client/Brmble.Client.csproj` (add ProjectReference)
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

This is the biggest integration step. It replaces `UserAudioPipeline` + per-user `WaveOutEvent` with `AudioMixer` + `JitterBuffer` + single `WaveOutEvent`.

- [ ] **Step 1: Add Brmble.Audio reference to Brmble.Client**

Add to `src/Brmble.Client/Brmble.Client.csproj`:
```xml
<ProjectReference Include="..\Brmble.Audio\Brmble.Audio.csproj" />
```

- [ ] **Step 2: Add AudioMixer field and IWaveProvider adapter to AudioManager**

In `AudioManager.cs`, add these fields (replacing `_pipelines` and `_players` dictionaries):

```csharp
// Replace these:
//   private readonly Dictionary<uint, UserAudioPipeline> _pipelines = new();
//   private readonly Dictionary<uint, WaveOutEvent> _players = new();
// With:
private AudioMixer? _mixer;
private WaveOutEvent? _outputPlayer;
private readonly long _startTimestamp = Stopwatch.GetTimestamp();
```

Add an inner `IWaveProvider` adapter that reads from the mixer's ring buffer:

```csharp
private class MixerWaveProvider : IWaveProvider
{
    private readonly RingBuffer _ringBuffer;
    public WaveFormat WaveFormat { get; } = new WaveFormat(48000, 16, 1);

    public MixerWaveProvider(RingBuffer ringBuffer) => _ringBuffer = ringBuffer;

    // Pre-allocated buffer for reading from ring buffer (avoid stackalloc)
    private readonly short[] _readBuffer = new short[4800]; // matches RingBuffer capacity

    public int Read(byte[] buffer, int offset, int count)
    {
        int samplesToRead = Math.Min(count / sizeof(short), _readBuffer.Length);
        int read = _ringBuffer.Read(_readBuffer.AsSpan(0, samplesToRead));

        // Convert short[] to byte[] for NAudio
        for (int i = 0; i < read; i++)
        {
            buffer[offset + i * 2] = (byte)(_readBuffer[i] & 0xFF);
            buffer[offset + i * 2 + 1] = (byte)((_readBuffer[i] >> 8) & 0xFF);
        }

        // Fill remainder with silence
        int bytesWritten = read * sizeof(short);
        if (bytesWritten < count)
            Array.Clear(buffer, offset + bytesWritten, count - bytesWritten);

        return count; // always return requested amount (silence-padded)
    }
}
```

- [ ] **Step 3: Update AudioManager initialization**

Replace the per-user `WaveOutEvent` creation in the constructor / `Start()` method with:

```csharp
// In the Start/Init method where audio is set up:
_mixer = new AudioMixer();
_outputPlayer = new WaveOutEvent { DesiredLatency = 80, NumberOfBuffers = 4 };
_outputPlayer.Init(new MixerWaveProvider(_mixer.Output));
_outputPlayer.Play();
_mixer.Start();
```

- [ ] **Step 4: Update FeedVoice method**

Replace the current `FeedVoice` method (lines ~793-830 in `AudioManager.cs`):

```csharp
public void FeedVoice(uint userId, byte[] opusData, long sequence)
{
    if (_deafened || _mixer == null) return;

    // Respect local mute — don't create buffers for locally muted users
    if (_localMutes.Contains(userId)) return;

    var jb = _mixer.GetBuffer(userId);
    if (jb == null)
    {
        // First packet from this user — create JitterBuffer
        var decoder = new MumbleOpusDecoder(sampleRate: 48000, channels: 1);
        jb = new JitterBuffer(decoder);

        // Apply per-user volume if set
        if (_userVolumes.TryGetValue(userId, out var vol))
            jb.Volume = vol;
        else
            jb.Volume = _outputVolume;

        _mixer.AddBuffer(userId, jb);
    }

    var packet = new EncodedPacket(
        Sequence: sequence,
        Timestamp: sequence * 960,
        Payload: opusData,
        ArrivalTimeMs: (long)Stopwatch.GetElapsedTime(_startTimestamp).TotalMilliseconds
    );
    jb.InsertPacket(packet);
}
```

Note: `_startTimestamp` is captured via `Stopwatch.GetTimestamp()` at AudioManager construction. `TotalMilliseconds` (not `Milliseconds`) gives the total elapsed time — `Milliseconds` wraps at 1000ms which would break the DelayManager.

- [ ] **Step 5: Update RemoveUser method**

```csharp
public void RemoveUser(uint userId)
{
    _mixer?.RemoveBuffer(userId);
    // Speaking event will be handled by the speaking detection timer
}
```

- [ ] **Step 6: Update speaking detection**

Replace the `_lastVoicePacket` based detection in `CheckSpeakingState`. Remove the `_lastVoicePacket` dictionary and `_speakingUsers` set. Replace with a set tracking the previous speaking state, and poll `AudioMixer.IsUserSpeaking()`:

```csharp
private readonly HashSet<uint> _currentlySpeaking = new();

private void CheckSpeakingState(object? state)
{
    if (_mixer == null) return;

    lock (_lock)
    {
        // Check all users with active buffers
        foreach (uint userId in _mixer.GetActiveUserIds())
        {
            bool speaking = _mixer.IsUserSpeaking(userId);
            bool wasSpeaking = _currentlySpeaking.Contains(userId);

            if (speaking && !wasSpeaking)
            {
                _currentlySpeaking.Add(userId);
                UserStartedSpeaking?.Invoke(userId);
            }
            else if (!speaking && wasSpeaking)
            {
                _currentlySpeaking.Remove(userId);
                UserStoppedSpeaking?.Invoke(userId);
            }
        }

        // Clean up users that were removed
        _currentlySpeaking.IntersectWith(_mixer.GetActiveUserIds());
    }
}
```

This also requires adding `GetActiveUserIds()` to `AudioMixer`:

```csharp
// In AudioMixer, add:
public IReadOnlyCollection<uint> GetActiveUserIds()
{
    lock (_lock)
        return _buffers.Keys.ToArray();
}
```

- [ ] **Step 7: Update SetDeafened**

```csharp
public void SetDeafened(bool deafened)
{
    _deafened = deafened;
    if (deafened)
    {
        // Mute output — mixer keeps running to preserve buffer state
        _outputPlayer?.Stop();
    }
    else
    {
        _outputPlayer?.Play();
    }
}
```

**Note:** This changes behavior from the current destroy-and-recreate approach. The old code fired `UserStoppedSpeaking` for all users on deafen. The new code does not — speaking indicators should be suppressed on the frontend when self-deafened, independent of speaking events. Verify the frontend handles this (the `voice.selfDeafChanged` bridge message should be sufficient).

- [ ] **Step 8: Update per-user volume**

Update the existing `SetUserVolume` method to also set volume on the JitterBuffer. Keep the existing signature (`int percentage`) and convert to float for the JitterBuffer:

```csharp
// In the existing SetUserVolume method, after storing to _userVolumes, add:
var jb = _mixer?.GetBuffer(userId);
if (jb != null)
    jb.Volume = volume; // volume is already a float in _userVolumes
```

Similarly, update `SetOutputVolume` to apply the new global volume to all active buffers that don't have a per-user override:

```csharp
// In SetOutputVolume, after setting _outputVolume:
if (_mixer != null)
{
    foreach (uint userId in _mixer.GetActiveUserIds())
    {
        if (!_userVolumes.ContainsKey(userId))
        {
            var jb = _mixer.GetBuffer(userId);
            if (jb != null) jb.Volume = _outputVolume;
        }
    }
}
```

- [ ] **Step 9: Update Dispose**

```csharp
// In Dispose:
_mixer?.Dispose();
_outputPlayer?.Stop();
_outputPlayer?.Dispose();
```

- [ ] **Step 10: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded. There may be warnings about unused `UserAudioPipeline` — that's expected.

- [ ] **Step 11: Commit**

```bash
git add src/Brmble.Client/
git commit -m "feat: integrate JitterBuffer into AudioManager, replacing UserAudioPipeline"
```

---

## Task 13: Update MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2133-2139`

- [ ] **Step 1: Update EncodedVoice method**

The current method (line 2133-2139) already passes data directly to `AudioManager.FeedVoice()`. The signature stays the same — `AudioManager.FeedVoice` now creates `EncodedPacket` internally. No change needed here unless the `ArrivalTimeMs` needs to be captured at this layer.

If you need higher precision arrival time (captured before AudioManager lock):

```csharp
public override void EncodedVoice(byte[] data, uint userId, long sequence,
    IVoiceCodec codec, SpeechTarget target)
{
    _audioManager?.FeedVoice(userId, data, sequence);
}
```

This stays unchanged — the arrival timestamp is captured inside `FeedVoice`.

- [ ] **Step 2: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit (if changes were made)**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "refactor: update MumbleAdapter for jitter buffer integration"
```

---

## Task 14: Run Full Test Suite

- [ ] **Step 1: Run all Brmble.Audio tests**

Run: `dotnet test tests/Brmble.Audio.Tests/ -v n`
Expected: All tests pass (PacketBuffer: 8, DelayManager: 7, DecisionLogic: 6, RingBuffer: 4, JitterBuffer: 7 = ~32 tests).

- [ ] **Step 2: Run existing MumbleVoiceEngine tests**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/ -v n`
Expected: All existing tests still pass (no regressions).

- [ ] **Step 3: Run full solution build**

Run: `dotnet build Brmble.slnx`
Expected: Build succeeded with 0 errors.

- [ ] **Step 4: Commit any fixes if needed**

---

## Task 15: Create Follow-Up Issues

Create GitHub issues for the remaining NetEQ phases.

- [ ] **Step 1: Create Phase 3 issue (WSOLA Time-Stretching)**

```bash
gh issue create \
  --title "Phase 3: WSOLA time-stretching for NetEQ jitter buffer" \
  --body "## Context
Continuation of #324 (NetEQ jitter buffer). Phase 1+2 (adaptive delay + PLC) uses simple linear cross-fade for Accelerate/Decelerate. This phase replaces it with WSOLA for inaudible time-stretching.

## Scope
- Pitch detection via autocorrelation
- Waveform Similarity Overlap-Add (WSOLA) for Accelerate (time-compression)
- WSOLA for Decelerate/Preemptive Expand (time-stretching)
- Merge improvement using WSOLA cross-fade

## References
- Design spec: docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md
- WebRTC source: modules/audio_coding/neteq/accelerate.cc, preemptive_expand.cc, time_stretch.cc
- Library: src/Brmble.Audio/NetEQ/"
```

- [ ] **Step 2: Create Phase 4 issue (Comfort Noise & Polish)**

```bash
gh issue create \
  --title "Phase 4: Comfort noise, DTX handling, and metrics for NetEQ jitter buffer" \
  --body "## Context
Continuation of #324 (NetEQ jitter buffer). Final phase for production-grade audio quality.

## Scope
- Comfort Noise Generation (CNG) during DTX silences
- Noise profile estimation from last good frames
- Tuning: forget factor, percentile, min/max delay bounds
- Frontend metrics dashboard (buffer level, PLC rate, latency)
- Extended JitterBufferStats with histograms
- voice.jitterStats bridge message implementation

## References
- Design spec: docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md
- WebRTC source: modules/audio_coding/neteq/comfort_noise.cc
- Library: src/Brmble.Audio/NetEQ/"
```

- [ ] **Step 3: Commit** (no code changes, just issue tracking)

---

## Summary

| Task | Component | Tests | Estimated Steps |
|------|-----------|-------|-----------------|
| 1 | Project scaffolding | — | 6 |
| 2 | Models | — | 5 |
| 3 | IOpusDecoder + Fake | — | 4 |
| 4 | PacketBuffer | 8 | 5 |
| 5 | DelayManager | 7 | 5 |
| 6 | DecisionLogic | 6 | 5 |
| 7 | RingBuffer | 4 | 5 |
| 8 | JitterBuffer | 7 | 5 |
| 9 | PlayoutTimer | — | 3 |
| 10 | AudioMixer | — | 3 |
| 11 | MumbleOpusDecoder | — | 4 |
| 12 | AudioManager integration | — | 11 |
| 13 | MumbleAdapter integration | — | 3 |
| 14 | Full test suite | all | 4 |
| 15 | Follow-up issues | — | 3 |
| **Total** | | **~32** | **~76** |

Tasks 1-11 are independent library work in `Brmble.Audio` and can be done in isolation. Tasks 12-13 are the integration with the existing client. Task 14 validates everything. Task 15 creates tracking for future work.
