# PLC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Packet Loss Concealment (PLC) in UserAudioPipeline to replace silence with interpolated audio when packets are lost.

**Architecture:** Modify UserAudioPipeline to track sequence numbers, detect gaps, and call Opus decoder with null to trigger PLC. Uses dynamic frame sizing with fallback to 960 samples (20ms @ 48kHz).

**Tech Stack:** C#, MumbleVoiceEngine, OpusDecoder, NAudio

---

## Implementation

### Task 1: Add sequence tracking fields to UserAudioPipeline

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs`

**Step 1: Add PLC fields**

In `UserAudioPipeline.cs`, add these fields after `_volume`:

```csharp
private const int MAX_PLC_FRAMES = 20;
private const int MAX_GAP_FRAMES = 20;
private long _lastSequence = -1;
private int _samplesPerFrame;
```

**Step 2: Initialize _samplesPerFrame in constructor**

Add after `_decoder = new OpusDecoder(sampleRate, channels)`:

```csharp
_samplesPerFrame = 960; // Default: 20ms @ 48kHz
```

**Step 3: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs
git commit -m "feat: add PLC tracking fields to UserAudioPipeline"
```

---

### Task 2: Implement dynamic frame size detection

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs:48-62`

**Step 1: Modify FeedEncodedPacket to detect frame size**

Replace the current `FeedEncodedPacket` method with one that detects frame size on first packet:

```csharp
public void FeedEncodedPacket(byte[] opusData, long sequence)
{
    var samples = OpusDecoder.GetSamples(opusData, 0, opusData.Length, _sampleRate);
    if (samples <= 0) return;

    // Detect frame size from first packet
    if (_lastSequence == -1)
    {
        _samplesPerFrame = samples;
    }

    // Handle sequence gaps (PLC)
    if (_lastSequence >= 0 && sequence > _lastSequence + 1)
    {
        int missed = (int)(sequence - _lastSequence - 1);
        missed = Math.Min(missed, MAX_PLC_FRAMES);

        for (int i = 0; i < missed; i++)
        {
            var plcFrame = new byte[_samplesPerFrame * _bytesPerSample];
            _decoder.Decode(null, 0, 0, plcFrame, 0);
            lock (_lock)
            {
                _pcmQueue.Enqueue(plcFrame);
            }
        }
    }

    // Skip duplicates
    if (sequence == _lastSequence)
        return;

    // Update sequence
    _lastSequence = sequence;

    // Decode and queue
    var decoded = new byte[samples * _bytesPerSample];
    _decoder.Decode(opusData, 0, opusData.Length, decoded, 0);

    lock (_lock)
    {
        _pcmQueue.Enqueue(decoded);
    }
}
```

**Step 2: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/UserAudioPipeline.cs
git commit -m "feat: add PLC gap detection and frame size detection"
```

---

### Task 3: Add PLC tests

**Files:**
- Modify: `tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs`

**Step 1: Write failing test for single packet loss**

Add test method:

```csharp
[TestMethod]
public void FeedOpus_WithSingleGap_ProducesPlcAudio()
{
    using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
    using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };

    // Send packet at sequence 0
    pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, 0), sequence: 0);
    
    // Skip sequence 1 (lost packet)
    // Send packet at sequence 2
    pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, 2), sequence: 2);

    // Read all 3 frames worth of PCM (2 normal + 1 PLC)
    var pcmOut = new byte[960 * 2 * 3];
    int read = pipeline.Read(pcmOut, 0, pcmOut.Length);

    Assert.AreEqual(960 * 2 * 3, read);
    // PLC frame should have some non-zero audio (not silence)
    // Check middle frame (the PLC one)
    bool plcFrameHasAudio = false;
    for (int i = 960 * 2; i < 960 * 2 * 2; i++)
    {
        if (pcmOut[i] != 0)
        {
            plcFrameHasAudio = true;
            break;
        }
    }
    Assert.IsTrue(plcFrameHasAudio, "PLC frame should contain audio, not silence");
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/MumbleVoiceEngine.Tests --filter "FullyQualifiedName~UserAudioPipelineTest.FeedOpus_WithSingleGap_ProducesPlcAudio"`

Expected: Should fail (PLC not yet producing non-zero)

**Step 3: Commit test**

```bash
git add tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs
git commit -m "test: add PLC gap detection test"
```

---

### Task 4: Add burst loss test

**Files:**
- Modify: `tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs`

**Step 1: Write test for multiple consecutive lost packets**

Add test method:

```csharp
[TestMethod]
public void FeedOpus_WithBurstLoss_ProducesPlcAudio()
{
    using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
    using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };

    // Send packet at sequence 0
    pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, 0), sequence: 0);
    
    // Skip sequences 1-3 (3 lost packets)
    // Send packet at sequence 4
    pipeline.FeedEncodedPacket(EncodeSineFrame(encoder, 4), sequence: 4);

    // Read all 5 frames worth of PCM (2 normal + 3 PLC)
    var pcmOut = new byte[960 * 2 * 5];
    int read = pipeline.Read(pcmOut, 0, pcmOut.Length);

    Assert.AreEqual(960 * 2 * 5, read);
}
```

**Step 2: Run test to verify**

Run: `dotnet test tests/MumbleVoiceEngine.Tests --filter "FullyQualifiedName~UserAudioPipelineTest.FeedOpus_WithBurstLoss_ProducesPlcAudio"`

Expected: PASS (if implementation is correct)

**Step 3: Commit**

```bash
git add tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs
git commit -m "test: add burst loss PLC test"
```

---

### Task 5: Add duplicate packet test

**Files:**
- Modify: `tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs`

**Step 1: Write test for duplicate sequence**

Add test method:

```csharp
[TestMethod]
public void FeedOpus_WithDuplicateSequence_SkipsDuplicate()
{
    using var pipeline = new UserAudioPipeline(sampleRate: 48000, channels: 1);
    using var encoder = new OpusEncoder(48000, 1) { Bitrate = 72000 };

    var frame = EncodeSineFrame(encoder, 0);
    pipeline.FeedEncodedPacket(frame, sequence: 0);
    pipeline.FeedEncodedPacket(frame, sequence: 0); // Duplicate

    // Should only get 1 frame, not 2
    var pcmOut = new byte[960 * 2];
    int read = pipeline.Read(pcmOut, 0, pcmOut.Length);

    Assert.AreEqual(960 * 2, read);
}
```

**Step 2: Run test**

Run: `dotnet test tests/MumbleVoiceEngine.Tests --filter "FullyQualifiedName~UserAudioPipelineTest.FeedOpus_WithDuplicateSequence_SkipsDuplicate"`

Expected: PASS

**Step 3: Commit**

```bash
git add tests/MumbleVoiceEngine.Tests/Pipeline/UserAudioPipelineTest.cs
git commit -m "test: add duplicate packet handling test"
```

---

## Verification

**Step 1: Run all tests**

Run: `dotnet test tests/MumbleVoiceEngine.Tests`

Expected: All tests pass

**Step 2: Build solution**

Run: `dotnet build`

Expected: Build succeeds

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | UserAudioPipeline.cs | Add PLC tracking fields |
| 2 | UserAudioPipeline.cs | Implement gap detection and PLC |
| 3 | UserAudioPipelineTest.cs | Test single packet loss |
| 4 | UserAudioPipelineTest.cs | Test burst loss |
| 5 | UserAudioPipelineTest.cs | Test duplicate handling |

**Plan complete and saved to `docs/plans/2026-03-17-plc-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
