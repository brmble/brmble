# NetEQ Phase 3+4 Receive-Side Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2ms linear cross-fade in `JitterBuffer` with SoundTouch.Net WSOLA time-stretching, add Comfort Noise Generation for DTX silence gaps, tune `DelayManager` defaults for gaming latency, and surface NetEQ stats to the audio log.

**Architecture:** Four additive changes in `src/Brmble.Audio/NetEQ/`, one new NuGet dep (SoundTouch.Net, LGPL 2.1), plus configuration plumbing in `src/Brmble.Client/Services/AppConfig/` and a polling sampler in `src/Brmble.Client/Services/Voice/AudioManager.cs`. Each part is gated behind a dedicated class that can be swapped independently — `TimeStretcher`, `ComfortNoiseGenerator`, extended `JitterBufferStats`, tuned `DelayManager`.

**Tech Stack:** C# / .NET 10, SoundTouch.Net 2.3.2 (NuGet), NAudio, MSTest, Opus via existing `IOpusDecoder`.

**Spec:** `docs/superpowers/specs/2026-04-15-neteq-phase3-4-receive-quality-design.md`

---

## Execution Progress

Use this section to track which tasks are complete when resuming in a fresh session. The plan is executed via `superpowers:subagent-driven-development` (subagent-per-task + two-stage review).

| Task | Status | Commits | Notes |
|------|--------|---------|-------|
| 1. SoundTouch.Net NuGet | ✅ DONE | `8dca10e` | — |
| 2. TimeStretcher scaffold + passthrough test | ✅ DONE | `7a1e6b4`, fix `55d7abc` | Spec §43 required logging init failures; NaN-safe PCM conversion added. SoundTouch.Net 2.3.2 actually uses `SequenceDurationMs` / `SeekWindowDurationMs` / `OverlapDurationMs` (not `SequenceMs` etc. as shown in the plan below). `SoundTouchProcessor` is not `IDisposable` — use `Clear()` in `Dispose`. |
| 3. Pitch + continuity tests | ✅ DONE | `474b74e` | Plan's single-frame continuity test was replaced with 10-frame multi-boundary test (`Process_MultipleFrames_MaintainContinuity`) because SoundTouch priming delay prevents output from a single frame at tempo=1.10. |
| 4. TimeStretcher edge case tests | ✅ DONE | `6c6eebf`, polish `d51bac0` | Polish: impulse assertion was tautological (`short` range check); replaced with saturated-count + RMS bounds. |
| 5a. Wire DecisionLogic into JitterBuffer | ✅ DONE | `82c14ce`, polish `ca96b0a` | **Plan deviation**: original Task 5 assumed `GetAudio` already dispatched on PlayoutDecision with Accelerate/Decelerate/Merge branches. It did not — `DecisionLogic` was a dead field, `CrossFade` was dead code. Split into 5a (wire DecisionLogic + build branches using CrossFade) and 5b (swap Accelerate/Decelerate to TimeStretcher). Added `LastDecision` diagnostic property and unified post-branch volume/speaking-state. |
| 5b. Route Accelerate/Decelerate through TimeStretcher | ✅ DONE | `76f1504`, polish `920dbb4` | Warmup reality: TimeStretcher fed one 20ms frame at tempo 1.20 underproduces on first call, so CrossFade fallback dominates unless stretcher is kept warm. `920dbb4` adds TODO to warm from Normal path. Also added `_timeStretcher.Reset()` to silence-reset path. Merge intentionally keeps CrossFade. |
| 6. THIRD_PARTY_NOTICES.md | ✅ DONE | `cd15c7f` | — |
| 7. Extend JitterBufferStats | ✅ DONE | `e0f4ecf`, polish `56cf53d` | All 4 counters added; `MergeFrames` + `Underflows` wired in this task; `CngFrames`/`CngActiveMs` wired in Task 11. `Underflows` fires when both `_syncBuffer.AvailableSamples == 0` AND `_packetBuffer.Count == 0` (captured before PLC). |
| 8. Stats sampler in AudioManager | ✅ DONE | `b823ba8`, polish `97fe7ee` | 1 Hz `System.Threading.Timer` writing `[JB] user=... buf=... tgt=... N=... ...` to `AudioLog`. Polish: `Timer.Dispose(WaitHandle)` for in-flight callback wait + `Interlocked` re-entrancy guard + narrowed exception filter + extracted `JitterStatsInterval` constant. Timer lives only in the client; no unit tests for this (would require live Mumble). |
| 9. CNG scaffold + RMS test | ❌ REVERTED | implemented `2458f0e`, polish `dce409c`; removed `4f98f4f` | See Task 15 notes. |
| 10. CNG spectrum + fade tests | ❌ REVERTED | implemented `8c5efb8`, docs `294d1a6`; removed `4f98f4f` | See Task 15 notes. |
| 11. Integrate CNG into JitterBuffer | ❌ REVERTED | implemented `09f52c2`, fix `3dcd431`; removed `4f98f4f` | See Task 15 notes. |
| 12. Make DelayManager configurable | ✅ DONE | `de2627c` | Plan's test body had `ts += 20` — treats timestamp as ms, but `DelayManager.Update` expects samples. Fixed to `ts += 960` (one 20 ms frame @ 48 kHz). DelayManager default `maxLevel` stayed at 15 (not plan's 20) to preserve existing test behavior. |
| 13. Jitter knobs in IAppConfigService | ✅ DONE | `0a3739b`, review tweaks `bf68cbc` | `JitterConfig` record lives next to `WindowState` in `AppSettings.cs` (public). Clamp bounds are defined as private constants in `AppConfigService` (percentile `[0.50, 0.995]`, min-delay-ms `[0, 200]`). Review-suggested tests for "older config missing jitter section" and "out-of-range input clamped on write" landed in `bf68cbc`. |
| 14. Wire jitter config into AudioManager | ✅ DONE | `8009f55` | Fallback defaults `?? 0.95` / `?? 20` in AudioManager diverge from AppConfigService defaults `0.90` / `20` — deliberate, preserves legacy DelayManager behavior when `_appConfig` is null (e.g. test contexts). One-line comment at the fallback site explains this. |
| 15. Final test pass + smoke | ✅ DONE (CNG reverted) | `4f98f4f` | Live smoke with remote PTT user surfaced audible hiss around PTT transitions that tracked specifically to CNG. Bisect: setting a kill-switch `CngEnabled = false` eliminated the hiss entirely. Attempted remediation in two passes — first `bf68cbc` gated CNG training on low-energy frames (RMS < 1200); then `7be503c` dropped default `_targetRms` to 30, tightened clamp to `[30, 80]`, shortened fade to 2 ms, and removed the speech-sample anchor in `GenerateFadeIn`. Neither pass eliminated the hiss, suggesting a spectral mismatch between filtered-white-noise CNG and what the ear expects during Opus-call silence. Opus PLC alone handles silence gracefully; rather than ship dead code, commit `4f98f4f` removed CNG entirely. A future plan could revisit with SILK-style or spectrum-shaped CNG. Final: audio 49/49, client AppConfig 32/32, TimeStretcher + config plumbing + stats telemetry all retained. |

**To resume in a fresh session:** see instructions at the bottom of this file.

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/Brmble.Audio/NetEQ/TimeStretcher.cs` | Pitch-preserving time-stretcher wrapping `SoundTouchProcessor`. Input: short PCM @ 48k. Output: short PCM stretched by a supplied tempo ratio. Per-`JitterBuffer` instance. |
| `src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs` | Estimates noise floor RMS from the last voiced frame; emits filtered white-noise frames; cross-fades on entry/exit. Per-`JitterBuffer` instance. |
| `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs` | TDD: passthrough at ratio 1.0, compress ratio 0.8, stretch ratio 1.25, pitch preservation via FFT peak, boundary continuity across two calls, silence/impulse, init-failure fallback. |
| `tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs` | TDD: RMS matches training frame ±3 dB, low-pass spectrum, fade-in envelope monotonic, fade-out returns to speech without click. |
| `THIRD_PARTY_NOTICES.md` (repo root) | LGPL 2.1 attribution for SoundTouch. |

### Modified files

| File | Change |
|------|--------|
| `src/Brmble.Audio/Brmble.Audio.csproj` | Add `<PackageReference Include="SoundTouch.Net" Version="2.3.2" />`. |
| `src/Brmble.Audio/NetEQ/JitterBuffer.cs` | Route Accelerate/Decelerate through new `TimeStretcher` (replaces `CrossFade` for those decisions only). Track silence duration in Expand; delegate to new `ComfortNoiseGenerator` past a 60ms threshold. Record new counter increments (`MergeFrames`, `CngFrames`, `CngActiveMs`). |
| `src/Brmble.Audio/NetEQ/DelayManager.cs` | Replace internal `TargetPercentile` constant and hardcoded min/max level with constructor parameters. Backwards-compatible defaults. |
| `src/Brmble.Audio/Diagnostics/JitterBufferStats.cs` | Add fields `MergeFrames`, `CngFrames`, `CngActiveMs`, `Underflows`. Extend `Snapshot()`. |
| `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs` | Add `GetJitterTargetPercentile() / SetJitterTargetPercentile(double)` and `GetJitterMinDelayMs() / SetJitterMinDelayMs(int)`. |
| `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` | Implement the two new pairs and persist under a new `jitter` section in the JSON store. Defaults: 0.90 and 20. |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Pass config values when constructing `DelayManager` / `JitterBuffer`. Start a 1 Hz `System.Threading.Timer` that samples `jitterBuffer.GetStats()` per active user and writes a compact CSV line to `AudioLog`. |
| `tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs` | Add cases for non-default percentile and min-delay construction. |
| `tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs` | Add cases for CNG after long silence, and for `MergeFrames`/`CngFrames`/`CngActiveMs` counter increments. |

---

## Task 1: Add SoundTouch.Net NuGet dependency

**Files:**
- Modify: `src/Brmble.Audio/Brmble.Audio.csproj`

- [ ] **Step 1: Add package reference**

Open `src/Brmble.Audio/Brmble.Audio.csproj`. Inside the existing `<ItemGroup>` for package references (or a new `<ItemGroup>` if none exists), add:

```xml
<PackageReference Include="SoundTouch.Net" Version="2.3.2" />
```

- [ ] **Step 2: Restore and verify**

Run: `dotnet restore src/Brmble.Audio/Brmble.Audio.csproj`
Expected: "Restore complete" with no errors, SoundTouch.Net listed in restored packages.

Run: `dotnet build src/Brmble.Audio/Brmble.Audio.csproj`
Expected: `Build succeeded. 0 Warning(s) 0 Error(s)`.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/Brmble.Audio.csproj
git commit -m "feat(audio): add SoundTouch.Net 2.3.2 dependency"
```

---

## Task 2: Scaffold `TimeStretcher` with passthrough test (TDD)

**Files:**
- Create: `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs`
- Create: `src/Brmble.Audio/NetEQ/TimeStretcher.cs`

- [ ] **Step 1: Write failing passthrough test**

Create `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs`:

```csharp
using Brmble.Audio.NetEQ;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class TimeStretcherTest
{
    private const int SampleRate = 48000;
    private const int FrameSamples = 960; // 20ms

    [TestMethod]
    public void Process_RatioOne_ReturnsApproximatelySameLength()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var input = new short[FrameSamples];
        for (int i = 0; i < FrameSamples; i++)
            input[i] = (short)(Math.Sin(2 * Math.PI * 440 * i / SampleRate) * 8000);

        var output = new short[FrameSamples * 2];
        int produced = stretcher.Process(input, tempo: 1.0, output);

        // Pull until internal buffer drained (second call with empty flush)
        int tail = stretcher.Flush(output.AsSpan(produced));
        int total = produced + tail;

        // At tempo 1.0, total output length should match input within ±10 samples.
        Assert.IsTrue(Math.Abs(total - FrameSamples) <= 10,
            $"Expected ~{FrameSamples} samples, got {total}");
    }
}
```

- [ ] **Step 2: Run test — verify it fails**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~TimeStretcherTest.Process_RatioOne"`
Expected: FAIL with compile error — `TimeStretcher` does not exist.

- [ ] **Step 3: Create TimeStretcher with minimal implementation**

Create `src/Brmble.Audio/NetEQ/TimeStretcher.cs`:

```csharp
using SoundTouch;

namespace Brmble.Audio.NetEQ;

/// <summary>
/// Pitch-preserving time-stretching for NetEQ Accelerate / Decelerate.
/// Thin wrapper over SoundTouch.Net tuned for voice: smaller sequence/seek/overlap
/// windows than the music defaults (which add ~100ms latency).
/// </summary>
public sealed class TimeStretcher : IDisposable
{
    private readonly SoundTouchProcessor? _processor;
    private readonly bool _initOk;
    private readonly float[] _floatInScratch;
    private readonly float[] _floatOutScratch;

    public TimeStretcher(int sampleRate, int maxFrameSamples = 4096)
    {
        _floatInScratch = new float[maxFrameSamples];
        _floatOutScratch = new float[maxFrameSamples * 2];

        try
        {
            _processor = new SoundTouchProcessor
            {
                SampleRate = sampleRate,
                Channels = 1,
                Tempo = 1.0,
                Pitch = 1.0,
                Rate = 1.0,
            };
            // Voice-tuned parameters. Music defaults add ~100ms latency;
            // these bring it to ~30ms at the cost of slightly more artifacts on wide stretch.
            _processor.SetSetting(SettingId.SequenceMs, 40);
            _processor.SetSetting(SettingId.SeekWindowMs, 15);
            _processor.SetSetting(SettingId.OverlapMs, 8);
            _initOk = true;
        }
        catch
        {
            _initOk = false;
        }
    }

    public bool IsOperational => _initOk;

    /// <summary>
    /// Feed <paramref name="input"/> into the stretcher at the given tempo (1.0 = no change,
    /// &gt;1.0 compresses/accelerates, &lt;1.0 stretches/decelerates), then pull available output.
    /// Returns the number of samples written to <paramref name="output"/>.
    /// </summary>
    public int Process(ReadOnlySpan<short> input, double tempo, Span<short> output)
    {
        if (!_initOk || _processor is null)
            return 0;

        _processor.Tempo = tempo;

        // short → float
        int len = input.Length;
        for (int i = 0; i < len; i++)
            _floatInScratch[i] = input[i] / 32768.0f;

        _processor.PutSamples(_floatInScratch.AsSpan(0, len), len);

        int available = _processor.ReceiveSamples(_floatOutScratch, _floatOutScratch.Length);
        int toCopy = Math.Min(available, output.Length);
        for (int i = 0; i < toCopy; i++)
            output[i] = (short)Math.Clamp((int)(_floatOutScratch[i] * 32767.0f), short.MinValue, short.MaxValue);
        return toCopy;
    }

    /// <summary>
    /// Drain any samples still held internally. Called after the final Process of a
    /// stretching sequence.
    /// </summary>
    public int Flush(Span<short> output)
    {
        if (!_initOk || _processor is null) return 0;
        _processor.Flush();
        int available = _processor.ReceiveSamples(_floatOutScratch, _floatOutScratch.Length);
        int toCopy = Math.Min(available, output.Length);
        for (int i = 0; i < toCopy; i++)
            output[i] = (short)Math.Clamp((int)(_floatOutScratch[i] * 32767.0f), short.MinValue, short.MaxValue);
        return toCopy;
    }

    public void Reset()
    {
        _processor?.Clear();
    }

    public void Dispose()
    {
        _processor?.Dispose();
    }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~TimeStretcherTest"`
Expected: 1 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/TimeStretcher.cs tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs
git commit -m "feat(audio): add TimeStretcher wrapper around SoundTouch for voice"
```

---

## Task 3: TimeStretcher — pitch preservation + boundary continuity

**Files:**
- Modify: `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs`

- [ ] **Step 1: Add pitch preservation test**

Append to the existing test class:

```csharp
    [TestMethod]
    [DataRow(0.80)] // decelerate by 20%
    [DataRow(0.90)]
    [DataRow(1.10)]
    [DataRow(1.25)] // accelerate by 25%
    public void Process_StretchRatio_PreservesPitch(double tempo)
    {
        using var stretcher = new TimeStretcher(SampleRate);
        const double freq = 440.0; // A4
        const int totalInput = FrameSamples * 20; // 400ms feed

        var input = new short[FrameSamples];
        var output = new short[FrameSamples * 2];
        var combined = new List<short>(capacity: totalInput * 2);

        for (int f = 0; f < 20; f++)
        {
            int t0 = f * FrameSamples;
            for (int i = 0; i < FrameSamples; i++)
                input[i] = (short)(Math.Sin(2 * Math.PI * freq * (t0 + i) / SampleRate) * 8000);
            int got = stretcher.Process(input, tempo, output);
            for (int i = 0; i < got; i++) combined.Add(output[i]);
        }
        int tail = stretcher.Flush(output);
        for (int i = 0; i < tail; i++) combined.Add(output[i]);

        // Compute dominant frequency via zero-crossing count.
        int crossings = 0;
        for (int i = 1; i < combined.Count; i++)
        {
            if ((combined[i - 1] < 0 && combined[i] >= 0) ||
                (combined[i - 1] >= 0 && combined[i] < 0))
                crossings++;
        }
        double seconds = combined.Count / (double)SampleRate;
        double detected = crossings / 2.0 / seconds;

        // Pitch must be preserved within ±5%.
        double error = Math.Abs(detected - freq) / freq;
        Assert.IsTrue(error < 0.05,
            $"tempo={tempo}: detected={detected:F1}Hz expected={freq:F1}Hz err={error:P1}");
    }

    [TestMethod]
    public void Process_TwoConsecutiveCalls_MaintainContinuity()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        const double freq = 300.0;

        var frame = new short[FrameSamples];
        var out1 = new short[FrameSamples * 2];
        var out2 = new short[FrameSamples * 2];

        for (int i = 0; i < FrameSamples; i++)
            frame[i] = (short)(Math.Sin(2 * Math.PI * freq * i / SampleRate) * 8000);
        int n1 = stretcher.Process(frame, tempo: 1.10, out1);

        for (int i = 0; i < FrameSamples; i++)
            frame[i] = (short)(Math.Sin(2 * Math.PI * freq * (FrameSamples + i) / SampleRate) * 8000);
        int n2 = stretcher.Process(frame, tempo: 1.10, out2);

        Assert.IsTrue(n1 > 0 && n2 > 0, "Both calls must produce output");

        // Joint sample (last of out1 → first of out2) should not jump by more than
        // the maximum expected per-sample delta for a 300 Hz sine (~3400).
        int delta = Math.Abs(out2[0] - out1[n1 - 1]);
        Assert.IsTrue(delta < 5000,
            $"Discontinuity at boundary: {out1[n1 - 1]} → {out2[0]} (delta {delta})");
    }
```

- [ ] **Step 2: Run tests — verify pass**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~TimeStretcherTest"`
Expected: 6 passed (1 passthrough + 4 stretch ratios + 1 continuity). If pitch test fails, inspect `detected` in the assertion message and compare against expected; SoundTouch voice params may need tightening.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs
git commit -m "test(audio): TimeStretcher pitch preservation + continuity"
```

---

## Task 4: TimeStretcher — silence, impulse, and init-failure fallback

**Files:**
- Modify: `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs`

- [ ] **Step 1: Add edge-case tests**

Append:

```csharp
    [TestMethod]
    public void Process_SilentInput_ProducesSilentOutput()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var silent = new short[FrameSamples];
        var output = new short[FrameSamples * 2];

        for (int f = 0; f < 10; f++)
            stretcher.Process(silent, tempo: 1.15, output);

        int tail = stretcher.Flush(output);
        for (int i = 0; i < tail; i++)
            Assert.IsTrue(Math.Abs(output[i]) < 32, $"Non-silent sample at {i}: {output[i]}");
    }

    [TestMethod]
    public void Process_ImpulseInput_DoesNotExplode()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        var impulse = new short[FrameSamples];
        impulse[0] = short.MaxValue;
        var output = new short[FrameSamples * 2];

        int produced = stretcher.Process(impulse, tempo: 1.0, output);
        int tail = stretcher.Flush(output.AsSpan(produced));

        int total = produced + tail;
        for (int i = 0; i < total; i++)
            Assert.IsTrue(output[i] >= short.MinValue && output[i] <= short.MaxValue);
    }

    [TestMethod]
    public void IsOperational_OnSuccessfulInit_ReturnsTrue()
    {
        using var stretcher = new TimeStretcher(SampleRate);
        Assert.IsTrue(stretcher.IsOperational);
    }
```

- [ ] **Step 2: Run tests — verify pass**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~TimeStretcherTest"`
Expected: 9 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs
git commit -m "test(audio): TimeStretcher edge cases (silence, impulse, init)"
```

---

## Task 5: Integrate TimeStretcher into JitterBuffer Accelerate/Decelerate

**Files:**
- Modify: `src/Brmble.Audio/NetEQ/JitterBuffer.cs`

This task replaces `CrossFade` calls for `Accelerate` and `Decelerate` decisions only. `Merge` keeps cross-fade. `Expand` is unchanged (still Opus PLC).

- [ ] **Step 1: Read current Accelerate/Decelerate handling**

Open `src/Brmble.Audio/NetEQ/JitterBuffer.cs` and locate where the switch/decision dispatch occurs around `GetAudio(Span<short>)` (public method at line 97). Find the branches for `PlayoutDecision.Accelerate` and `PlayoutDecision.Decelerate`. They currently decode and then call `CrossFade(output, outgoing, incoming)`.

- [ ] **Step 2: Add TimeStretcher field and initialize it**

Near the top of the class (around line 14–38 where other fields live), add:

```csharp
    private readonly TimeStretcher _timeStretcher;
    private const double AccelerateTempo = 1.20;
    private const double DecelerateTempo = 0.83;
    private readonly short[] _stretchScratch = new short[FrameSize * 2];
```

In the constructor, after the other field inits, add:

```csharp
        _timeStretcher = new TimeStretcher(sampleRate: 48000);
```

- [ ] **Step 3: Replace CrossFade call in Accelerate branch**

Inside the `case PlayoutDecision.Accelerate:` (or equivalent `if` branch), replace the block that performs `DecodeToOutput` + `CrossFade` with:

```csharp
        // Decode the next packet into the scratch buffer.
        DecodeToOutput(packet.Payload, _frameBuffer.AsSpan(0, FrameSize), _frameBuffer.AsSpan(0, FrameSize));

        int produced = _timeStretcher.IsOperational
            ? _timeStretcher.Process(_frameBuffer.AsSpan(0, FrameSize), AccelerateTempo, _stretchScratch)
            : 0;

        if (produced >= output.Length)
        {
            _stretchScratch.AsSpan(0, output.Length).CopyTo(output);
        }
        else
        {
            // Fallback: if the stretcher hasn't produced enough samples yet (warming up)
            // or is non-operational, use the legacy cross-fade path.
            CrossFade(output,
                outgoing: _lastDecodedFrame,
                incoming: _frameBuffer.AsSpan(0, FrameSize));
        }
        _stats.AccelerateFrames++;
```

- [ ] **Step 4: Replace CrossFade call in Decelerate branch**

Similarly, inside the Decelerate branch, replace with:

```csharp
        DecodeToOutput(packet.Payload, _frameBuffer.AsSpan(0, FrameSize), _frameBuffer.AsSpan(0, FrameSize));

        int produced = _timeStretcher.IsOperational
            ? _timeStretcher.Process(_frameBuffer.AsSpan(0, FrameSize), DecelerateTempo, _stretchScratch)
            : 0;

        if (produced >= output.Length)
        {
            _stretchScratch.AsSpan(0, output.Length).CopyTo(output);
        }
        else
        {
            CrossFade(output,
                outgoing: _lastDecodedFrame,
                incoming: _frameBuffer.AsSpan(0, FrameSize));
        }
        _stats.DecelerateFrames++;
```

- [ ] **Step 5: Dispose TimeStretcher in JitterBuffer.Dispose**

Inside `public void Dispose()` (around line 249), add:

```csharp
        _timeStretcher.Dispose();
```

- [ ] **Step 6: Reset TimeStretcher when JitterBuffer resets**

If `JitterBuffer` has a `Reset()` or packet-loss recovery path, call `_timeStretcher.Reset();` to drop stale internal state. If there is no such method, skip this step.

- [ ] **Step 7: Run existing JitterBuffer tests — verify unchanged**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~JitterBufferTest"`
Expected: all existing tests still pass. If a test relied on exact cross-fade output for Accelerate/Decelerate, accept the behavior change and update the assertion to accept either the stretched or cross-faded output depending on warmup state.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Audio/NetEQ/JitterBuffer.cs
git commit -m "feat(audio): route NetEQ Accelerate/Decelerate through TimeStretcher"
```

---

## Task 6: Add THIRD_PARTY_NOTICES.md for SoundTouch LGPL 2.1

**Files:**
- Create (or modify if exists): `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Check if file already exists**

Run: `ls THIRD_PARTY_NOTICES.md 2>/dev/null && echo EXISTS || echo MISSING`

- [ ] **Step 2: Create or append attribution**

If missing, create `THIRD_PARTY_NOTICES.md` with:

```markdown
# Third-Party Notices

Brmble uses the following third-party libraries.

## SoundTouch

License: LGPL 2.1

Source: https://codeberg.org/soundtouch/soundtouch

SoundTouch is used via the SoundTouch.Net managed NuGet port for time-stretching
in the voice receive pipeline (`src/Brmble.Audio/NetEQ/TimeStretcher.cs`).

Under LGPL 2.1 § 6, users retain the right to modify and relink the SoundTouch
portion of this software. The SoundTouch source remains available at the URL
above, and the library ships as a separately-linked assembly via NuGet.
```

If it exists, append the SoundTouch section to the end.

- [ ] **Step 3: Commit**

```bash
git add THIRD_PARTY_NOTICES.md
git commit -m "docs: add SoundTouch LGPL 2.1 attribution"
```

---

## Task 7: Extend JitterBufferStats with new counters

**Files:**
- Modify: `src/Brmble.Audio/Diagnostics/JitterBufferStats.cs`

- [ ] **Step 1: Add new fields**

Open `src/Brmble.Audio/Diagnostics/JitterBufferStats.cs`. After the existing `DecelerateFrames` line, add:

```csharp
    public long MergeFrames { get; set; }
    public long CngFrames { get; set; }
    public long CngActiveMs { get; set; }
    public long Underflows { get; set; }
```

- [ ] **Step 2: Extend `Snapshot()`**

Update the `Snapshot()` return to include the new fields:

```csharp
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
            MergeFrames = MergeFrames,
            CngFrames = CngFrames,
            CngActiveMs = CngActiveMs,
            Underflows = Underflows,
            LatePackets = LatePackets,
            DuplicatePackets = DuplicatePackets,
        };
    }
```

- [ ] **Step 3: Increment new counters in JitterBuffer**

Open `src/Brmble.Audio/NetEQ/JitterBuffer.cs`.
- In the `Merge` branch, add `_stats.MergeFrames++;` at the end.
- In the branch where we fail to produce output (buffer empty and Expand unavailable), add `_stats.Underflows++;`. (`CngFrames` / `CngActiveMs` are touched in Task 12 — no-op for now.)

- [ ] **Step 4: Run library tests — verify no regression**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/Diagnostics/JitterBufferStats.cs src/Brmble.Audio/NetEQ/JitterBuffer.cs
git commit -m "feat(audio): track Merge/Cng/Underflow counters in JitterBufferStats"
```

---

## Task 8: Sample stats in AudioManager → AudioLog

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

- [ ] **Step 1: Locate the JitterBuffer collection**

Open `src/Brmble.Client/Services/Voice/AudioManager.cs`. Find where `JitterBuffer` instances are stored (usually a dictionary keyed by user/session). Note the field name — the sampler will iterate it.

- [ ] **Step 2: Add the sampler timer field**

Near the other private fields (around the `_deviceResampler` / `_speechEnhancement` area), add:

```csharp
    private System.Threading.Timer? _jitterStatsTimer;
```

- [ ] **Step 3: Start the timer on first buffer creation**

In the method that creates a new `JitterBuffer` (first successful `userJoined` or similar), after the buffer is added to the collection, call:

```csharp
        EnsureJitterStatsTimerStarted();
```

Add this helper method:

```csharp
    private void EnsureJitterStatsTimerStarted()
    {
        if (_jitterStatsTimer != null) return;
        _jitterStatsTimer = new System.Threading.Timer(
            _ => SampleJitterStats(),
            state: null,
            dueTime: TimeSpan.FromSeconds(1),
            period: TimeSpan.FromSeconds(1));
    }

    private void SampleJitterStats()
    {
        try
        {
            // Snapshot the collection first to avoid holding the lock across the log write.
            var snapshots = new List<(uint session, Brmble.Audio.Diagnostics.JitterBufferStats stats)>();
            lock (_jitterBufferLock) // use the existing lock or enumerate a ConcurrentDictionary
            {
                foreach (var kv in _jitterBuffers) // replace with actual field name
                    snapshots.Add((kv.Key, kv.Value.GetStats()));
            }

            foreach (var (session, s) in snapshots)
            {
                AudioLog.Write(
                    $"jitter session={session} " +
                    $"buf={s.BufferLevel} tgt={s.TargetLevel} " +
                    $"N={s.NormalFrames} X={s.ExpandFrames} A={s.AccelerateFrames} " +
                    $"D={s.DecelerateFrames} M={s.MergeFrames} C={s.CngFrames} " +
                    $"cng_ms={s.CngActiveMs} under={s.Underflows} " +
                    $"late={s.LatePackets} dup={s.DuplicatePackets}");
            }
        }
        catch (Exception ex)
        {
            AudioLog.Write($"jitter sampler error: {ex.Message}");
        }
    }
```

Replace `_jitterBuffers` and `_jitterBufferLock` with the real field names used by the existing code. If the collection is a `ConcurrentDictionary`, drop the lock and iterate directly.

- [ ] **Step 4: Dispose the timer on AudioManager cleanup**

Find `Dispose()` or the voice-disconnect method and add:

```csharp
        _jitterStatsTimer?.Dispose();
        _jitterStatsTimer = null;
```

- [ ] **Step 5: Run the client and sanity-check the log**

Run: `(cd src/Brmble.Web && npm run build) && dotnet run --project src/Brmble.Client`

Connect to a test server, join a channel with another speaker for ~10 seconds, then exit.

Run: `cat "$LOCALAPPDATA/Brmble/audio.log" | tail -20`
Expected: lines beginning with `jitter session=...` every second.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(client): sample JitterBuffer stats to AudioLog at 1Hz"
```

---

## Task 9: Scaffold ComfortNoiseGenerator with RMS test (TDD)

**Files:**
- Create: `tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs`
- Create: `src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs`

- [ ] **Step 1: Write failing RMS test**

Create `tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs`:

```csharp
using Brmble.Audio.NetEQ;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests.NetEQ;

[TestClass]
public class ComfortNoiseGeneratorTest
{
    private const int SampleRate = 48000;
    private const int FrameSamples = 960;

    [TestMethod]
    public void Generator_AfterTraining_MatchesRmsWithinTolerance()
    {
        var cng = new ComfortNoiseGenerator(SampleRate);

        // Train on white noise at a known RMS.
        var rng = new Random(seed: 42);
        var trainingFrame = new short[FrameSamples];
        const int targetAmp = 1500;
        double trainingSumSq = 0;
        for (int i = 0; i < FrameSamples; i++)
        {
            int v = (int)((rng.NextDouble() * 2 - 1) * targetAmp);
            trainingFrame[i] = (short)v;
            trainingSumSq += (double)v * v;
        }
        double trainingRms = Math.Sqrt(trainingSumSq / FrameSamples);
        cng.Train(trainingFrame);

        // Generate 10 frames and measure their RMS.
        var outBuf = new short[FrameSamples];
        double sumSq = 0;
        int total = 0;
        for (int f = 0; f < 10; f++)
        {
            cng.Generate(outBuf);
            for (int i = 0; i < FrameSamples; i++)
            {
                sumSq += (double)outBuf[i] * outBuf[i];
                total++;
            }
        }
        double producedRms = Math.Sqrt(sumSq / total);

        // ±3 dB tolerance = factor of 10^(3/20) ≈ 1.413
        double ratio = producedRms / trainingRms;
        Assert.IsTrue(ratio > 1 / 1.413 && ratio < 1.413,
            $"Training RMS {trainingRms:F0}, produced RMS {producedRms:F0}, ratio {ratio:F2}");
    }
}
```

- [ ] **Step 2: Run test — verify fails**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~ComfortNoiseGeneratorTest"`
Expected: FAIL — `ComfortNoiseGenerator` does not exist.

- [ ] **Step 3: Create ComfortNoiseGenerator**

Create `src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs`:

```csharp
namespace Brmble.Audio.NetEQ;

/// <summary>
/// Fills DTX silence gaps with low-pass-filtered white noise whose RMS matches
/// the last voiced frame's noise floor. Trained lazily from live speech,
/// produces frames indefinitely once trained.
///
/// Simple on purpose: a single-pole LPF over bounded uniform noise.
/// Full LPC-based CNG (WebRTC-style) can replace this later behind the same API.
/// </summary>
public sealed class ComfortNoiseGenerator
{
    private readonly int _sampleRate;
    private readonly Random _rng = new(seed: unchecked(Environment.TickCount * 397));
    private double _targetRms = 200.0; // sane default if never trained
    private double _lpState; // single-pole filter state

    // Single-pole LPF cutoff ~2 kHz: alpha = 2πfc / (2πfc + fs)
    private const double CutoffHz = 2000.0;

    public ComfortNoiseGenerator(int sampleRate)
    {
        _sampleRate = sampleRate;
    }

    /// <summary>
    /// Update the target RMS from a (presumably low-energy end-of-speech) frame.
    /// </summary>
    public void Train(ReadOnlySpan<short> frame)
    {
        if (frame.Length == 0) return;
        double sumSq = 0;
        for (int i = 0; i < frame.Length; i++)
            sumSq += (double)frame[i] * frame[i];
        double rms = Math.Sqrt(sumSq / frame.Length);
        // Clamp to reasonable voice-noise floor range to avoid training on loud speech.
        _targetRms = Math.Clamp(rms, 50.0, 3000.0);
    }

    public void Generate(Span<short> output)
    {
        double alpha = 2.0 * Math.PI * CutoffHz / (2.0 * Math.PI * CutoffHz + _sampleRate);

        // Uniform white noise in [-1, 1]. Its RMS = 1/√3 ≈ 0.577.
        // After single-pole LPF the RMS drops by a further factor; we measure
        // empirically and scale. For alpha≈0.21 (2kHz @ 48k), filtered RMS ≈ 0.30.
        const double filteredRmsOfUnitWhite = 0.30;

        double gain = _targetRms / (filteredRmsOfUnitWhite * short.MaxValue);

        for (int i = 0; i < output.Length; i++)
        {
            double white = _rng.NextDouble() * 2.0 - 1.0;
            _lpState += alpha * (white - _lpState);
            double sample = _lpState * gain * short.MaxValue;
            output[i] = (short)Math.Clamp(sample, short.MinValue, short.MaxValue);
        }
    }

    public void Reset()
    {
        _lpState = 0;
        _targetRms = 200.0;
    }
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~ComfortNoiseGeneratorTest"`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs
git commit -m "feat(audio): add ComfortNoiseGenerator for DTX gaps"
```

---

## Task 10: ComfortNoiseGenerator — spectrum + fade tests

**Files:**
- Modify: `tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs`
- Modify: `src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs`

- [ ] **Step 1: Add spectrum test**

Append to the test class:

```csharp
    [TestMethod]
    public void Generate_OutputIsLowPassFiltered()
    {
        var cng = new ComfortNoiseGenerator(SampleRate);
        cng.Train(new short[FrameSamples]); // silent training → default RMS
        // Overwrite _targetRms indirectly: train on a higher-RMS frame
        var trainHi = new short[FrameSamples];
        var rng = new Random(7);
        for (int i = 0; i < FrameSamples; i++)
            trainHi[i] = (short)((rng.NextDouble() * 2 - 1) * 2000);
        cng.Train(trainHi);

        var buf = new short[FrameSamples * 4];
        cng.Generate(buf);

        // Zero-crossing rate indicates dominant frequency content; LPF at 2kHz
        // should give crossings < 2×2000 Hz × duration = 4000 × (buf.Length / SampleRate).
        int crossings = 0;
        for (int i = 1; i < buf.Length; i++)
        {
            if ((buf[i - 1] < 0 && buf[i] >= 0) ||
                (buf[i - 1] >= 0 && buf[i] < 0))
                crossings++;
        }
        double seconds = buf.Length / (double)SampleRate;
        double estFreq = crossings / 2.0 / seconds;
        // White noise would cross at ~SampleRate/4 = 12kHz; LPF'd should be well under 3kHz.
        Assert.IsTrue(estFreq < 3500,
            $"Crossings suggest freq ~{estFreq:F0}Hz, expected well below LPF cutoff.");
    }
```

- [ ] **Step 2: Add fade-in / fade-out API + test**

Add to `ComfortNoiseGenerator.cs`:

```csharp
    public const int FadeSamples = 240; // 5ms @ 48k

    /// <summary>
    /// Generate a frame that fades IN from speech → full CNG. The caller supplies
    /// <paramref name="boundaryAnchor"/>, which is the LAST sample of the previous
    /// speech frame — that is the value we need continuity with at output[0].
    /// </summary>
    public void GenerateFadeIn(short boundaryAnchor, Span<short> output)
    {
        Generate(output);
        int n = Math.Min(FadeSamples, output.Length);
        for (int i = 0; i < n; i++)
        {
            double t = (double)i / n;
            double blended = (1 - t) * boundaryAnchor + t * output[i];
            output[i] = (short)Math.Clamp(blended, short.MinValue, short.MaxValue);
        }
    }

    /// <summary>
    /// Apply a CNG→speech cross-fade to the first FadeSamples of an already-decoded
    /// speech frame, in place. Used when returning to Normal after a CNG interval.
    /// </summary>
    public void ApplyFadeOutToSpeech(Span<short> speechFrame)
    {
        int n = Math.Min(FadeSamples, speechFrame.Length);
        Span<short> cngTail = stackalloc short[n];
        Generate(cngTail);
        for (int i = 0; i < n; i++)
        {
            double t = (double)i / n;
            double blended = (1 - t) * cngTail[i]
                             + t * speechFrame[i];
            speechFrame[i] = (short)Math.Clamp(blended, short.MinValue, short.MaxValue);
        }
    }
```

Add tests:

```csharp
    [TestMethod]
    public void GenerateFadeIn_AnchorsAtBoundarySample()
    {
        var cng = new ComfortNoiseGenerator(SampleRate);
        cng.Train(new short[FrameSamples]);

        const short boundary = 5000;
        var output = new short[FrameSamples];
        cng.GenerateFadeIn(boundary, output);

        // First sample must equal the boundary anchor (no discontinuity).
        // (t=0 → blended = boundaryAnchor exactly)
        Assert.AreEqual(boundary, output[0]);

        // Samples beyond the fade region should be pure CNG — i.e., close to zero
        // mean but not equal to boundary. We just check it diverges.
        Assert.IsTrue(Math.Abs(output[500] - boundary) > 500,
            $"Sample past fade region ({output[500]}) is too close to boundary — fade not applied");
    }

    [TestMethod]
    public void ApplyFadeOutToSpeech_FadeRegionBlendedRestUntouched()
    {
        var cng = new ComfortNoiseGenerator(SampleRate);
        var train = new short[FrameSamples];
        var rng = new Random(3);
        for (int i = 0; i < FrameSamples; i++)
            train[i] = (short)((rng.NextDouble() * 2 - 1) * 1000);
        cng.Train(train);

        var speech = new short[FrameSamples];
        const short speechLevel = -4000;
        for (int i = 0; i < FrameSamples; i++) speech[i] = speechLevel;

        cng.ApplyFadeOutToSpeech(speech);

        // Last sample in the fade region (index 239 for FadeSamples=240) should be
        // near the speech level.
        Assert.IsTrue(Math.Abs(speech[239] - speechLevel) < 1200,
            $"End of fade region {speech[239]} did not approach {speechLevel}");

        // Samples well past the fade region must be bit-exact speech (untouched).
        Assert.AreEqual(speechLevel, speech[ComfortNoiseGenerator.FadeSamples],
            "Sample past fade region was modified — should be pure speech.");
    }
```

- [ ] **Step 3: Run tests**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~ComfortNoiseGeneratorTest"`
Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs
git commit -m "feat(audio): CNG fade-in/out + spectrum test"
```

---

## Task 11: Integrate CNG into JitterBuffer Expand path

**Files:**
- Modify: `src/Brmble.Audio/NetEQ/JitterBuffer.cs`

- [ ] **Step 1: Add CNG state fields**

Near the other fields at the top of `JitterBuffer`, add:

```csharp
    private readonly ComfortNoiseGenerator _cng;
    private const int CngEntryMs = 60;            // switch from Expand → CNG past 60ms silence
    private const int CngEntryFrames = CngEntryMs / 20; // 3 frames at 20ms per frame
    private int _consecutiveExpandFrames;         // rolling count of Expand-in-a-row
    private bool _cngActive;
    private readonly short[] _cngScratch = new short[FrameSize];
    private readonly short[] _lastSpeechTail = new short[FrameSize];
```

Initialize `_cng` in the constructor:

```csharp
        _cng = new ComfortNoiseGenerator(sampleRate: 48000);
```

- [ ] **Step 2: Update Normal decoding branch to train CNG**

Find the `PlayoutDecision.Normal` branch (the one that decodes and copies to `output`). After writing to `output`, add:

```csharp
        // If we're returning from a CNG interval, cross-fade the start of this
        // decoded speech frame. Must happen BEFORE we capture the tail for training,
        // so the training sample reflects unfaded speech.
        if (_cngActive)
        {
            _cng.ApplyFadeOutToSpeech(output);
            _cngActive = false;
        }

        // Keep the latest decoded frame for CNG training + fade-in reference.
        output.CopyTo(_lastSpeechTail);
        _cng.Train(_lastSpeechTail);

        _consecutiveExpandFrames = 0;
```

- [ ] **Step 3: Update Expand branch to transition into CNG**

Find the `PlayoutDecision.Expand` branch. After the existing Expand/PLC logic, add:

```csharp
        _consecutiveExpandFrames++;

        if (_consecutiveExpandFrames >= CngEntryFrames)
        {
            if (!_cngActive)
            {
                // First frame of CNG — fade in from the last sample of the previous
                // speech frame to ensure continuity at the frame boundary.
                _cng.GenerateFadeIn(_lastSpeechTail[FrameSize - 1], _cngScratch);
                _cngActive = true;
            }
            else
            {
                _cng.Generate(_cngScratch);
            }

            _cngScratch.AsSpan(0, output.Length).CopyTo(output);
            _stats.CngFrames++;
            _stats.CngActiveMs += 20; // one 20ms frame
        }
        // else: stay on Opus PLC (already wrote to output above).
```

- [ ] **Step 4: Dispose cleanup**

In `public void Dispose()`, add:

```csharp
        _cng.Reset();
```

(`ComfortNoiseGenerator` doesn't hold unmanaged resources; reset is defensive.)

- [ ] **Step 5: Add JitterBuffer CNG test**

Open `tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs`. Add:

```csharp
    [TestMethod]
    public void GetAudio_LongSilence_TransitionsToCng()
    {
        var decoder = new FakeOpusDecoder();
        var jb = new JitterBuffer(decoder);
        // Insert one packet, then starve the buffer.
        jb.InsertPacket(new EncodedPacket(sequence: 1, timestamp: 960,
            payload: new byte[] { 0 }, arrivalTimeMs: 0));

        var output = new short[960];
        // Pull 10 frames (= 200ms) of output without any new packets.
        long totalCngFrames = 0;
        for (int i = 0; i < 10; i++)
        {
            jb.GetAudio(output);
            totalCngFrames = jb.GetStats().CngFrames;
        }
        // Past the 60ms threshold (3 frames) the remaining 7 should be CNG.
        Assert.IsTrue(totalCngFrames >= 5,
            $"Expected CNG to engage after ~60ms silence, got {totalCngFrames} CNG frames");
    }
```

Adjust `FakeOpusDecoder` reference to match the test helper type that already exists in the test suite; if it doesn't exist, reuse the mock decoder used in the existing `JitterBufferTest`.

- [ ] **Step 6: Run tests**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~JitterBufferTest"`
Expected: all existing JB tests still pass, plus the new CNG test.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Audio/NetEQ/JitterBuffer.cs tests/Brmble.Audio.Tests/NetEQ/JitterBufferTest.cs
git commit -m "feat(audio): JitterBuffer engages CNG after 60ms silence"
```

---

## Task 12: Make DelayManager configurable

**Files:**
- Modify: `src/Brmble.Audio/NetEQ/DelayManager.cs`
- Modify: `tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs`

- [ ] **Step 1: Read current DelayManager constants**

Open `src/Brmble.Audio/NetEQ/DelayManager.cs`. Note: `TargetPercentile = 0.95` (line 14); `_minLevel` and `_maxLevel` are set in the constructor.

- [ ] **Step 2: Replace hardcoded percentile with instance field + constructor param**

Change line 14 from:

```csharp
    private const double TargetPercentile = 0.95;
```

to an instance field (also remove `const`):

```csharp
    private readonly double _targetPercentile;
```

Update the constructor signature (find the existing one — likely `public DelayManager(int minLevel, int maxLevel)` or similar). Change it to:

```csharp
    public DelayManager(int minLevel, int maxLevel, double targetPercentile = 0.95)
    {
        _minLevel = minLevel;
        _maxLevel = maxLevel;
        _targetPercentile = targetPercentile;
        _histogram = new double[HistogramBuckets];
    }
```

Find every use of `TargetPercentile` inside the class and replace with `_targetPercentile`.

- [ ] **Step 3: Replace existing constant-based tests with parameterized check**

Open `tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs`. Add:

```csharp
    [TestMethod]
    public void Constructor_WithCustomPercentile_UsesIt()
    {
        var dm = new DelayManager(minLevel: 1, maxLevel: 20, targetPercentile: 0.80);

        // Feed a controlled arrival pattern: 90% arrive 20ms apart, 10% arrive 200ms apart.
        long ts = 0, arrival = 0;
        var rng = new Random(11);
        for (int i = 0; i < 500; i++)
        {
            ts += 20;
            arrival += rng.NextDouble() < 0.10 ? 200 : 20;
            dm.Update(ts, arrival);
        }

        // At 0.80 percentile, the outlier spikes should be clipped → lower target.
        var dmHigh = new DelayManager(minLevel: 1, maxLevel: 20, targetPercentile: 0.99);
        ts = 0; arrival = 0;
        rng = new Random(11);
        for (int i = 0; i < 500; i++)
        {
            ts += 20;
            arrival += rng.NextDouble() < 0.10 ? 200 : 20;
            dmHigh.Update(ts, arrival);
        }

        Assert.IsTrue(dm.TargetLevel <= dmHigh.TargetLevel,
            $"Lower percentile ({dm.TargetLevel}) should not exceed higher ({dmHigh.TargetLevel})");
    }
```

- [ ] **Step 4: Run DelayManager tests**

Run: `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter "FullyQualifiedName~DelayManagerTest"`
Expected: all existing tests + new test pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/NetEQ/DelayManager.cs tests/Brmble.Audio.Tests/NetEQ/DelayManagerTest.cs
git commit -m "refactor(audio): make DelayManager target percentile configurable"
```

---

## Task 13: Add jitter knobs to IAppConfigService + AppConfigService

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`

- [ ] **Step 1: Extend the interface**

Open `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs`. Add:

```csharp
    double GetJitterTargetPercentile();
    void SetJitterTargetPercentile(double value);

    int GetJitterMinDelayMs();
    void SetJitterMinDelayMs(int value);
```

- [ ] **Step 2: Implement in AppConfigService**

Open `src/Brmble.Client/Services/AppConfig/AppConfigService.cs`. Find where the existing config values live (there is likely a dictionary, a POCO, or discrete keys). Follow the same pattern. Example assuming a POCO with a `Jitter` section:

```csharp
    // Add to the root config POCO:
    public JitterConfig Jitter { get; set; } = new();

    public class JitterConfig
    {
        public double TargetPercentile { get; set; } = 0.90;
        public int MinDelayMs { get; set; } = 20;
    }
```

Then in `AppConfigService`:

```csharp
    public double GetJitterTargetPercentile()
    {
        var value = _config.Jitter.TargetPercentile;
        // Guard against out-of-range values from a hand-edited file.
        return Math.Clamp(value, 0.50, 0.995);
    }

    public void SetJitterTargetPercentile(double value)
    {
        _config.Jitter.TargetPercentile = Math.Clamp(value, 0.50, 0.995);
        Save();
    }

    public int GetJitterMinDelayMs()
    {
        return Math.Clamp(_config.Jitter.MinDelayMs, 0, 200);
    }

    public void SetJitterMinDelayMs(int value)
    {
        _config.Jitter.MinDelayMs = Math.Clamp(value, 0, 200);
        Save();
    }
```

If the existing config layer uses a flat dictionary or individual `Get/Set<T>` helpers instead of a POCO, adapt by reading/writing keys `"jitter.targetPercentile"` (double) and `"jitter.minDelayMs"` (int) via those helpers. Defaults must still be 0.90 and 20 respectively.

- [ ] **Step 3: Build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: `Build succeeded`.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/
git commit -m "feat(config): add jitter target percentile + min delay knobs"
```

---

## Task 14: Wire jitter config into AudioManager → DelayManager construction

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Audio/NetEQ/JitterBuffer.cs` (constructor may need to accept min-delay)

- [ ] **Step 1: Identify current JitterBuffer construction**

Open `src/Brmble.Client/Services/Voice/AudioManager.cs`. Search for `new JitterBuffer(`. Note the existing argument list.

- [ ] **Step 2: Pass config values through**

Near the `JitterBuffer` / `DelayManager` creation site, read the two knobs from the injected `IAppConfigService`:

```csharp
            double percentile = _appConfig.GetJitterTargetPercentile();
            int minDelayMs = _appConfig.GetJitterMinDelayMs();
            int minLevel = Math.Max(1, minDelayMs / 20); // frames, 20ms each
```

- [ ] **Step 3: Propagate into DelayManager**

Two places may need changes depending on the existing code:

A. If `JitterBuffer` creates `DelayManager` internally, update the `JitterBuffer` constructor to accept `int minLevel`, `int maxLevel`, and `double targetPercentile`, and forward them. Example:

```csharp
    public JitterBuffer(IOpusDecoder decoder,
                        int minLevel = 1,
                        int maxLevel = 20,
                        double targetPercentile = 0.90)
    {
        // ...existing...
        _delayManager = new DelayManager(minLevel, maxLevel, targetPercentile);
        // ...existing...
    }
```

B. If the caller constructs `DelayManager` and passes it in, update the call site in `AudioManager` instead.

Adapt in `AudioManager`:

```csharp
            var jb = new JitterBuffer(decoder, minLevel, maxLevel: 20, targetPercentile: percentile);
```

- [ ] **Step 4: Build and test**

Run: `dotnet build`
Run: `dotnet test`
Expected: all pass.

- [ ] **Step 5: Live smoke test**

Run the client (`dotnet run --project src/Brmble.Client`). In `%LocalAppData%/Brmble/audio.log`, confirm the `tgt=` values are close to `minLevel` (i.e., ~1 frame / 20ms) under good network conditions.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs src/Brmble.Audio/NetEQ/JitterBuffer.cs
git commit -m "feat(audio): propagate jitter config to DelayManager"
```

---

## Task 15: Final test pass + integration replay

**Files:** none — verification only.

- [ ] **Step 1: Run the full solution test suite**

Run: `dotnet test`
Expected: all test projects pass.

- [ ] **Step 2: Live-call smoke test**

Start the client, connect to a Mumble server, join a channel with at least one known historically-staticy remote user.

Listen for 2 minutes. Watch `%LocalAppData%/Brmble/audio.log` `tail -f` in a second terminal.

Verify:
- `A=` and `D=` counters increment during speech from the staticy user
- `C=` counter increments during their silent pauses (if they use DTX)
- `tgt=` stays low (1–3 frames) under good network conditions
- No audible static clicks / modulations on voiced speech where previously present

- [ ] **Step 3: Final commit if any tuning tweaks were applied**

If the live test prompted any constant adjustments (e.g., `AccelerateTempo`, CNG alpha), commit:

```bash
git add <changed files>
git commit -m "tune(audio): live-call tuning from integration test"
```

- [ ] **Step 4: Report completion**

Produce a summary of what changed and ask the user to review before pushing. Do NOT push or open a PR automatically (per project branch rules).

---

## Resuming in a Fresh Session

Start Claude Code from the repo root (`C:\dev\brmble\brmble`), then paste this prompt verbatim:

```
I'm resuming implementation of the NetEQ Phase 3+4 receive-side quality work.

- Worktree: .worktrees/neteq-phase3-receive-quality/
- Branch:   feature/neteq-phase3-receive-quality
- Plan:     docs/superpowers/plans/2026-04-15-neteq-phase3-receive-quality.md
- Spec:     docs/superpowers/specs/2026-04-15-neteq-phase3-4-receive-quality-design.md

Use the superpowers:subagent-driven-development skill (subagent-per-task with
two-stage review: spec compliance first, then code quality).

The plan's "Execution Progress" section at the top lists which tasks are
complete. Resume at the first `pending` task.

Before dispatching the next task: (1) confirm the baseline is still clean by
running `dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj` in
the worktree, and (2) note any plan deviations from the Execution Progress
table so the implementer subagent does not re-trip on the same API issues
(SoundTouch.Net setting names, non-Disposable SoundTouchProcessor, JitterBufferStats
location at src/Brmble.Audio/Diagnostics/, etc.).

Proceed through all remaining tasks. Do not push; ask before opening a PR.
```

## Self-Review Checklist

After all tasks complete, confirm:

- [ ] Spec section coverage — every in-scope item in `docs/superpowers/specs/2026-04-15-neteq-phase3-4-receive-quality-design.md` is implemented.
- [ ] `TimeStretcher.Process` returns a stretched frame and falls back to `CrossFade` on under-production (warmup) or when `!IsOperational`.
- [ ] `ComfortNoiseGenerator` trains from the latest non-Expand frame and fades in/out on transitions.
- [ ] `DelayManager` honors the user-configured target percentile and minimum delay floor.
- [ ] `JitterBuffer.GetStats()` returns a snapshot containing all new counters.
- [ ] `AudioManager` periodically logs those stats via `AudioLog`.
- [ ] `THIRD_PARTY_NOTICES.md` includes SoundTouch LGPL 2.1 attribution.
- [ ] No remaining calls to `CrossFade` for `Accelerate` or `Decelerate` in `JitterBuffer` (Merge still uses it).
- [ ] `dotnet test` is green.
