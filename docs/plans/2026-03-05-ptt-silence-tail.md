# PTT Silence Tail Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When PTT is released, send 4 Opus-encoded silence frames (80 ms) before stopping transmission, eliminating the audible click/artifact receivers hear when the stream abruptly ends.

**Architecture:** On PTT key-up, `SetPttActive(false)` no longer calls `StopMic()` immediately. Instead it gates the live mic (sets `_pttActive = false` so `OnMicData` drops real audio), starts a one-shot `System.Threading.Timer` that calls a new `StopMicWithSilenceTail()` method. That method submits 4 × 960-sample zero PCM frames through the live `EncodePipeline`, then disposes the pipeline normally. If PTT is re-pressed before the timer fires, the timer is cancelled and `StartMic()` resumes on the existing pipeline.

**Tech Stack:** C# 12, System.Threading.Timer, NAudio WaveInEvent, MumbleVoiceEngine EncodePipeline (Opus, 48 kHz mono, 960-sample frames = 20 ms each)

---

## Constants

- **Silence frames:** 4 frames × 20 ms = 80 ms tail (matches original Mumble's typical 2–5 frame tail)
- **Frame size bytes:** 960 samples × 2 bytes (int16) = 1920 bytes per silence frame
- **Timer resolution:** Windows timer fires at ~15 ms resolution; we fire it immediately (0 ms delay) and submit frames synchronously in the callback, so wall-clock delay ≈ 0 ms + encode time for 4 frames (< 5 ms)

---

### Task 1: Add `FlushSilenceTailAsync` test for `EncodePipeline`

Verify that submitting zero-filled PCM after real audio produces packets (proves the pipeline doesn't gate on content).

**Files:**
- Modify: `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs`

**Step 1: Add the test method**

Add this test to the existing `EncodePipelineTest` class (after the last existing `[TestMethod]`):

```csharp
[TestMethod]
public void SubmitSilenceFrames_ProducesPackets()
{
    // Arrange
    var packets = new List<ReadOnlyMemory<byte>>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: p => packets.Add(p));

    const int frameSize = 960;
    const int frameSizeBytes = frameSize * sizeof(short); // 1920
    const int silenceFrames = 4;

    // Act — submit 4 full frames of silence
    var silence = new byte[frameSizeBytes * silenceFrames]; // all zeros
    pipeline.SubmitPcm(silence);

    // Assert — each frame produces exactly one packet
    Assert.AreEqual(silenceFrames, packets.Count,
        "Expected one packet per silence frame");

    // Each packet must have the Opus type byte (4 << 5 = 0x80)
    foreach (var pkt in packets)
    {
        Assert.AreEqual(0x80, pkt.Span[0] & 0xE0,
            "Packet type bits must be Opus (4 << 5)");
    }

    pipeline.Dispose();
}
```

**Step 2: Run the test to confirm it passes (behaviour already exists)**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "SubmitSilenceFrames_ProducesPackets" -v normal
```

Expected: **PASS** — `EncodePipeline.SubmitPcm` already handles zero PCM correctly.

**Step 3: Commit**

```bash
git add tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs
git commit -m "test: verify EncodePipeline produces packets for silence frames"
```

---

### Task 2: Add `_pttSilenceTailTimer` field to `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Add the timer field**

In `AudioManager.cs`, find the existing timer fields around line 187 (`_shortcutReleaseTimer`). After that line, add:

```csharp
    private System.Threading.Timer? _pttSilenceTailTimer;
```

The block should look like:

```csharp
    private System.Threading.Timer? _shortcutReleaseTimer;
    private System.Threading.Timer? _pttSilenceTailTimer;
```

**Step 2: Add the silence-frame constant**

Near the top of the class constants (search for `SpeakingTimeoutMs` around line 194), add:

```csharp
    private const int PttSilenceTailFrames = 4; // 4 × 20 ms = 80 ms tail
```

**Step 3: Build to confirm no errors**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "refactor: add PTT silence tail timer field and constant"
```

---

### Task 3: Write `StopMicWithSilenceTail()` method

This is the core logic: submit N zero-PCM frames then stop the mic.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Add the method**

Place this method directly after the existing `StopMic()` method (after line 350):

```csharp
/// <summary>
/// Submits <see cref="PttSilenceTailFrames"/> silence frames through the encode pipeline
/// then disposes it. Call only when the pipeline is still alive (i.e. mic is running).
/// </summary>
private void StopMicWithSilenceTail()
{
    lock (_lock)
    {
        if (!_micStarted) return;

        // Submit silence frames before stopping so the receiver gets a graceful end-of-stream
        if (_encodePipeline != null)
        {
            const int frameSizeBytes = 960 * sizeof(short); // 1920 bytes per 20 ms frame
            var silence = new byte[frameSizeBytes * PttSilenceTailFrames];
            try
            {
                _encodePipeline.SubmitPcm(new ReadOnlySpan<byte>(silence));
                AudioLog.Write($"[Audio] Sent {PttSilenceTailFrames} silence tail frames");
            }
            catch (Exception ex)
            {
                AudioLog.Write($"[Audio] Silence tail encode failed: {ex.Message}");
            }
        }

        _waveIn?.StopRecording();
        _encodePipeline?.Dispose();
        _encodePipeline = null;
        _micStarted = false;
        AudioLog.Write("[Audio] Mic stopped (with silence tail)");
    }
}
```

**Step 2: Build to confirm no errors**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: add StopMicWithSilenceTail to send silence frames on PTT release"
```

---

### Task 4: Update `SetPttActive` to use the timer-based tail

Replace the immediate `StopMic()` call on PTT release with a timer that fires `StopMicWithSilenceTail()`.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Update `SetPttActive`**

Find the current `SetPttActive` method (lines 1274–1289):

```csharp
    /// <summary>Start or stop mic for PTT.</summary>
    private void SetPttActive(bool active)
    {
        AudioLog.Write($"[Audio] SetPttActive: active={active}, _pttActive={_pttActive}, muted={_muted}");
        _pttActive = active;
        if (active && !_muted)
        {
            AudioLog.Write("[Audio] Starting mic for PTT");
            StartMic();
        }
        else
        {
            AudioLog.Write("[Audio] Stopping mic for PTT");
            StopMic();
        }
    }
```

Replace with:

```csharp
    /// <summary>Start or stop mic for PTT.</summary>
    private void SetPttActive(bool active)
    {
        AudioLog.Write($"[Audio] SetPttActive: active={active}, _pttActive={_pttActive}, muted={_muted}");
        _pttActive = active;

        if (active && !_muted)
        {
            // Cancel any pending silence tail — PTT was re-pressed before the tail completed
            _pttSilenceTailTimer?.Dispose();
            _pttSilenceTailTimer = null;
            AudioLog.Write("[Audio] Starting mic for PTT");
            StartMic();
        }
        else
        {
            AudioLog.Write("[Audio] PTT released — scheduling silence tail");
            // Gate live mic immediately (OnMicData checks _pttActive), then
            // fire the silence tail on a background thread right away (dueTime=0).
            _pttSilenceTailTimer?.Dispose();
            _pttSilenceTailTimer = new System.Threading.Timer(_ =>
            {
                _pttSilenceTailTimer?.Dispose();
                _pttSilenceTailTimer = null;
                StopMicWithSilenceTail();
            }, null, dueTime: 0, period: Timeout.Infinite);
        }
    }
```

**Key detail:** `_pttActive = false` is set before the timer fires, so `OnMicData` (line 355: `if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;`) gates out real mic audio immediately. The pipeline stays alive only to emit the silence frames.

**Step 2: Build**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds.

**Step 3: Run all voice engine tests**

```
dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj -v normal
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: send silence tail frames on PTT release to eliminate end-of-transmission artifact"
```

---

### Task 5: Dispose timer on `AudioManager.Dispose()`

Prevent a timer callback firing after `AudioManager` is torn down.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Find the `Dispose` method**

Search for `public void Dispose()` in `AudioManager.cs`. It should contain calls to dispose timers like `_pttPollingTimer`, `_shortcutReleaseTimer`, etc.

**Step 2: Add disposal of `_pttSilenceTailTimer`**

In the `Dispose()` method, alongside the existing timer disposals, add:

```csharp
_pttSilenceTailTimer?.Dispose();
_pttSilenceTailTimer = null;
```

**Step 3: Build**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: Build succeeds.

**Step 4: Run all tests**

```
dotnet test -v normal
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "fix: dispose PTT silence tail timer in AudioManager.Dispose"
```

---

### Task 6: Manual smoke test

**What to test:**
1. Build and run in development mode:
   ```
   cd src/Brmble.Web && npm run build
   dotnet run --project src/Brmble.Client
   ```
2. Connect to a Mumble server with at least one other listener.
3. Press PTT, speak briefly, release PTT.
4. Verify: no audible click or artifact at the end of your transmission on the listener's side.
5. Rapidly press-release PTT several times — verify no crash, no pipeline leak (check logs for `[Audio] Mic stopped (with silence tail)`).
6. Press PTT, hold, release — verify `[Audio] Sent 4 silence tail frames` appears in the audio log.

---

## Edge Cases Covered

| Scenario | Handled by |
|---|---|
| PTT re-pressed during tail | `SetPttActive(true)` cancels `_pttSilenceTailTimer` before `StartMic()` |
| Opus encode throws during tail | `try/catch` in `StopMicWithSilenceTail`; failure is logged, mic still stops |
| `StopMicWithSilenceTail` called when mic not running | Early `if (!_micStarted) return;` guard |
| `AudioManager.Dispose()` while tail timer pending | Timer disposed in `Dispose()` method |
| Muted user releases PTT | `SetPttActive(false)` path still used; `StopMicWithSilenceTail` checks `!_micStarted` and exits cleanly |
