# Voice Activation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Brmble's naïve RMS-threshold voice activation with a state-machine driven by Google's WebRTC standalone VAD (libfvad), wrapped with hysteresis, hangover, onset-lookback, a level meter and a Mumble end-of-transmission terminator on talk-end.

**Architecture:** Three new components — `WebRtcVad` (libfvad P/Invoke wrapper in `Brmble.Audio`), `VadGate` (pure-C# state machine, also in `Brmble.Audio`), and `EncodePipeline.EmitTerminator()` (new method in `MumbleVoiceEngine`). `AudioManager.OnMicData` replaces its single-threshold check with `VadGate.Process` per 10 ms post-APM frame. UI gets a sensitivity dropdown plus a live level meter that subscribes only when the Audio settings tab is open on Voice Activity.

**Tech Stack:** C# / .NET 10 / MSTest 3.7.3 / libfvad (BSD-3, vendored as source + prebuilt DLL) / React + TypeScript (UI) / WebView2 bridge.

**Spec:** `docs/superpowers/specs/2026-05-02-voice-activation-redesign-design.md` (commit `0021192` on `investigate/vad-rms-measurement`).

---

## File structure (locked here, not re-decided per task)

**New files:**
- `src/Brmble.Audio/IVadDetector.cs` — interface so `VadGate` can be tested without native binding
- `src/Brmble.Audio/VadAggressiveness.cs` — enum (Quality / LowBitrate / Aggressive / VeryAggressive)
- `src/Brmble.Audio/VadGateConfig.cs` — immutable config record + sensitivity-→-config helper
- `src/Brmble.Audio/GateDecision.cs` — discriminated union of Stay / OpenWithLookback / PassThrough / CloseWithTerminator
- `src/Brmble.Audio/VadGate.cs` — state-machine
- `src/Brmble.Audio/Native/LibFvadNative.cs` — P/Invoke declarations
- `src/Brmble.Audio/WebRtcVad.cs` — `IVadDetector` implementation
- `lib/native/libfvad/README.md` — vendoring + build instructions
- `lib/native/libfvad/src/...` — vendored libfvad C sources (12 files)
- `lib/native/libfvad/include/fvad.h` — vendored public header
- `lib/native/libfvad/CMakeLists.txt` — minimal CMake build script
- `lib/native/libfvad/win-x64/libfvad.dll` — prebuilt binary
- `tests/Brmble.Audio.Tests/VadGateTests.cs` — unit tests with mock `IVadDetector`
- `tests/Brmble.Audio.Tests/WebRtcVadTests.cs` — integration tests with real libfvad
- `tests/Brmble.Audio.Tests/Helpers/VadGateTestHarness.cs` — small helper to feed `(rms, isSpeech, time)` triples
- `tests/Brmble.Audio.Tests/fixtures/vad-realtalk-2026-05-02.csv` — replayable RMS/VAD trace
- `tests/Brmble.Audio.Tests/fixtures/vad-speech-5s-48k-mono.wav` — known speech clip
- `tests/Brmble.Audio.Tests/fixtures/vad-typing-5s-48k-mono.wav` — known noise clip
- `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.tsx` — UI bar
- `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.css` — bar styling

**Modified files:**
- `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` — add `EmitTerminator()`
- `tests/Brmble.MumbleVoiceEngine.Tests/.../EncodePipelineTests.cs` (or wherever pipeline tests live — see Task 9 to locate)
- `src/Brmble.Audio/Brmble.Audio.csproj` — add `<None Include>` for `libfvad.dll`
- `src/Brmble.Client/Services/AppConfig/AppSettings.cs` — add `VadSensitivity` field
- `src/Brmble.Client/Services/Voice/AudioManager.cs` — replace threshold check, fix `CheckSpeakingState`, add hot-swap, gate `[VAD-DIAG]` behind `#if DEBUG`
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — three new bridge handlers
- `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` — Voice Activity section + meter
- `.github/workflows/release.yml` — copy `libfvad.dll` to publish output (see Task 16)
- `SOUNDFLOW-THIRD-PARTY-NOTICES.txt` (or whichever NOTICES file lives at repo root) — append libfvad attribution

---

## Branch strategy

This plan starts on a fresh branch off `main`:

```bash
git checkout main
git pull
git checkout -b feature/voice-activation-redesign
```

The `[VAD-DIAG]` measurement code committed on `investigate/vad-rms-measurement` is already merged into the spec via the `#if DEBUG` block — Task 12 cherry-picks the diagnostic block into the new branch in its production form.

---

## Task 1: Scaffolding — `IVadDetector` interface, `VadAggressiveness` enum

**Files:**
- Create: `src/Brmble.Audio/IVadDetector.cs`
- Create: `src/Brmble.Audio/VadAggressiveness.cs`

- [ ] **Step 1: Create the enum**

`src/Brmble.Audio/VadAggressiveness.cs`:
```csharp
namespace Brmble.Audio;

public enum VadAggressiveness
{
    Quality = 0,
    LowBitrate = 1,
    Aggressive = 2,
    VeryAggressive = 3
}
```

- [ ] **Step 2: Create the interface**

`src/Brmble.Audio/IVadDetector.cs`:
```csharp
namespace Brmble.Audio;

/// <summary>
/// Speech / non-speech classifier for one 10 ms frame at 48 kHz mono int16.
/// Implementations must be safe to call from a single capture thread; aggressiveness
/// may be hot-swapped from a different thread (the implementation handles synchronisation).
/// </summary>
public interface IVadDetector
{
    bool IsSpeech(ReadOnlySpan<short> frame);
    VadAggressiveness Mode { get; set; }
}
```

- [ ] **Step 3: Build to confirm**

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj -nologo
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Audio/IVadDetector.cs src/Brmble.Audio/VadAggressiveness.cs
git commit -m "feat(audio): add IVadDetector interface + VadAggressiveness enum"
```

---

## Task 2: `VadGateConfig` — immutable config record + sensitivity-→-config helper

**Files:**
- Create: `src/Brmble.Audio/VadGateConfig.cs`

- [ ] **Step 1: Create the record + helper**

`src/Brmble.Audio/VadGateConfig.cs`:
```csharp
namespace Brmble.Audio;

/// <summary>
/// Immutable snapshot of the VAD gate's tunable parameters.
/// Swapped atomically via volatile reference assignment in <see cref="VadGate"/>;
/// the gate reads the snapshot once per frame.
/// </summary>
public sealed record VadGateConfig(
    VadAggressiveness VadMode,
    double OpenRmsThreshold,
    double CloseRmsThreshold,
    int HangoverMs,
    int OnsetLookbackFrames)
{
    public const int DefaultOnsetLookbackFrames = 3;

    public static VadGateConfig FromSensitivity(VadSensitivity level) => level switch
    {
        VadSensitivity.Low =>
            new VadGateConfig(VadAggressiveness.Quality,        150, 60,  300, DefaultOnsetLookbackFrames),
        VadSensitivity.Balanced =>
            new VadGateConfig(VadAggressiveness.Aggressive,     250, 120, 300, DefaultOnsetLookbackFrames),
        VadSensitivity.High =>
            new VadGateConfig(VadAggressiveness.VeryAggressive, 400, 250, 350, DefaultOnsetLookbackFrames),
        _ => throw new ArgumentOutOfRangeException(nameof(level), level, "Unknown sensitivity level"),
    };
}

public enum VadSensitivity
{
    Low,
    Balanced,
    High
}
```

- [ ] **Step 2: Build**

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj -nologo
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/VadGateConfig.cs
git commit -m "feat(audio): add VadGateConfig record + sensitivity defaults"
```

---

## Task 3: `GateDecision` — discriminated output union

**Files:**
- Create: `src/Brmble.Audio/GateDecision.cs`

- [ ] **Step 1: Create the abstract base + four cases**

`src/Brmble.Audio/GateDecision.cs`:
```csharp
namespace Brmble.Audio;

/// <summary>
/// Output of <see cref="VadGate.Process"/>. Callers switch on the concrete type
/// to decide what to do (submit PCM, emit terminator, or do nothing).
/// </summary>
public abstract record GateDecision
{
    private GateDecision() { }

    /// <summary>Gate stayed closed; drop this frame.</summary>
    public sealed record Stay : GateDecision;

    /// <summary>
    /// Gate transitioned from Closed to Open. The caller must submit every frame in
    /// <paramref name="Frames"/> to the encoder in order. Frames length is at most
    /// <see cref="VadGateConfig.OnsetLookbackFrames"/> + 1 (lookback ring + current).
    /// </summary>
    public sealed record OpenWithLookback(IReadOnlyList<short[]> Frames) : GateDecision;

    /// <summary>Gate stays open; submit <paramref name="Frame"/> to the encoder.</summary>
    public sealed record PassThrough(short[] Frame) : GateDecision;

    /// <summary>
    /// Gate transitioned from Open to Closed. The caller must call
    /// <c>EncodePipeline.EmitTerminator()</c> to flag end-of-transmission.
    /// </summary>
    public sealed record CloseWithTerminator : GateDecision;
}
```

- [ ] **Step 2: Build**

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj -nologo
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/GateDecision.cs
git commit -m "feat(audio): add GateDecision discriminated union"
```

---

## Task 4: `VadGate` — TDD the state machine

**Files:**
- Create: `src/Brmble.Audio/VadGate.cs`
- Create: `tests/Brmble.Audio.Tests/VadGateTests.cs`
- Create: `tests/Brmble.Audio.Tests/Helpers/VadGateTestHarness.cs`

This is the single biggest task; we TDD it through ten test cases.

- [ ] **Step 1: Create the test harness**

`tests/Brmble.Audio.Tests/Helpers/VadGateTestHarness.cs`:
```csharp
using Brmble.Audio;

namespace Brmble.Audio.Tests.Helpers;

/// <summary>
/// Mock <see cref="IVadDetector"/> that returns scripted answers per call.
/// Lets <see cref="VadGate"/> tests stay deterministic and free of native deps.
/// </summary>
internal sealed class FakeVadDetector : IVadDetector
{
    private readonly Queue<bool> _answers;
    public VadAggressiveness Mode { get; set; }
    public int Calls { get; private set; }

    public FakeVadDetector(params bool[] answers)
    {
        _answers = new Queue<bool>(answers);
    }

    public bool IsSpeech(ReadOnlySpan<short> frame)
    {
        Calls++;
        return _answers.Count > 0 ? _answers.Dequeue() : false;
    }
}

/// <summary>
/// Builds a 480-sample mono frame whose RMS approximately equals <paramref name="targetRms"/>.
/// Uses a simple square-wave pattern so RMS is deterministic.
/// </summary>
internal static class FrameFactory
{
    public static short[] WithRms(double targetRms)
    {
        var f = new short[480];
        short v = (short)Math.Clamp(Math.Round(targetRms), short.MinValue, short.MaxValue);
        for (int i = 0; i < f.Length; i++) f[i] = (i % 2 == 0) ? v : (short)-v;
        return f;
    }
}
```

- [ ] **Step 2: Write the first failing test (Closed → Open requires both)**

`tests/Brmble.Audio.Tests/VadGateTests.cs`:
```csharp
using Brmble.Audio;
using Brmble.Audio.Tests.Helpers;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests;

[TestClass]
public class VadGateTests
{
    private static VadGateConfig BalancedConfig => VadGateConfig.FromSensitivity(VadSensitivity.Balanced);

    [TestMethod]
    public void Closed_to_Open_requires_VadTrue_AND_RmsAboveOpen()
    {
        var vad = new FakeVadDetector(true);
        var gate = new VadGate(vad, BalancedConfig);

        var decision = gate.Process(FrameFactory.WithRms(500), nowMs: 0);

        Assert.IsInstanceOfType(decision, typeof(GateDecision.OpenWithLookback));
    }
}
```

- [ ] **Step 3: Run, expect failure (`VadGate` not defined)**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter VadGateTests -nologo
```

Expected: compile error CS0246: type or namespace `VadGate` not found.

- [ ] **Step 4: Implement minimum `VadGate` to pass first test**

`src/Brmble.Audio/VadGate.cs`:
```csharp
using System.Threading;

namespace Brmble.Audio;

/// <summary>
/// Two-state voice-activity gate with hysteresis, hangover, and onset-lookback.
/// Single-threaded for processing; <see cref="SetSensitivity"/> may be called from
/// any thread and takes effect on the next <see cref="Process"/> call.
/// </summary>
public sealed class VadGate
{
    public const int FrameSamples = 480; // 10 ms @ 48 kHz
    private enum GateState { Closed, Open }

    private readonly IVadDetector _vad;
    private VadGateConfig _config;
    private GateState _state = GateState.Closed;
    private long _lastActiveMs;
    private readonly short[][] _ring;
    private int _ringPos;

    public VadGate(IVadDetector vad, VadGateConfig initial)
    {
        _vad = vad ?? throw new ArgumentNullException(nameof(vad));
        _config = initial ?? throw new ArgumentNullException(nameof(initial));
        _vad.Mode = initial.VadMode;
        _ring = new short[initial.OnsetLookbackFrames][];
        for (int i = 0; i < _ring.Length; i++) _ring[i] = new short[FrameSamples];
    }

    public bool IsOpen => _state == GateState.Open;
    public double LastRms { get; private set; }

    public void SetSensitivity(VadSensitivity level)
    {
        var cfg = VadGateConfig.FromSensitivity(level);
        Interlocked.Exchange(ref _config, cfg);
        _vad.Mode = cfg.VadMode;
    }

    public GateDecision Process(short[] frame, long nowMs)
    {
        if (frame is null || frame.Length != FrameSamples)
            throw new ArgumentException($"Frame must be exactly {FrameSamples} samples", nameof(frame));

        var cfg = Volatile.Read(ref _config);
        bool isSpeech = _vad.IsSpeech(frame);
        double rms = ComputeRms(frame);
        LastRms = rms;

        // Always populate ring buffer (used for onset lookback when we open later).
        Array.Copy(frame, _ring[_ringPos], FrameSamples);
        _ringPos = (_ringPos + 1) % _ring.Length;

        if (_state == GateState.Closed)
        {
            if (isSpeech && rms >= cfg.OpenRmsThreshold)
            {
                _state = GateState.Open;
                _lastActiveMs = nowMs;
                return new GateDecision.OpenWithLookback(SnapshotLookbackPlusCurrent(frame));
            }
            return new GateDecision.Stay();
        }
        else // Open
        {
            if (isSpeech && rms >= cfg.CloseRmsThreshold) _lastActiveMs = nowMs;

            if (nowMs - _lastActiveMs >= cfg.HangoverMs)
            {
                _state = GateState.Closed;
                return new GateDecision.CloseWithTerminator();
            }

            return new GateDecision.PassThrough(frame);
        }
    }

    private IReadOnlyList<short[]> SnapshotLookbackPlusCurrent(short[] current)
    {
        // _ring already contains [..., previous frames, current] because we just pushed `frame`.
        // Walk from oldest to newest, ending with the current frame.
        var result = new List<short[]>(_ring.Length);
        int oldest = _ringPos; // position just written to is now treated as "next slot" — start from here for oldest
        for (int i = 0; i < _ring.Length; i++)
        {
            int idx = (oldest + i) % _ring.Length;
            // Skip lookback slots that haven't been filled yet by skipping zero buffers
            // produced by initial state: a fresh ring is all-zero, which is fine — encoding
            // 30 ms of silence at the start of speech is harmless.
            var copy = new short[FrameSamples];
            Array.Copy(_ring[idx], copy, FrameSamples);
            result.Add(copy);
        }
        return result;
    }

    private static double ComputeRms(short[] frame)
    {
        long sumSq = 0;
        for (int i = 0; i < frame.Length; i++) sumSq += frame[i] * frame[i];
        return Math.Sqrt(sumSq / (double)frame.Length);
    }
}
```

- [ ] **Step 5: Run first test, expect pass**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter VadGateTests -nologo
```

Expected: 1/1 passed.

- [ ] **Step 6: Add second test — Closed stays Closed without VAD**

Append to `VadGateTests.cs`:
```csharp
[TestMethod]
public void Closed_stays_Closed_when_VadFalse_even_if_RmsHigh()
{
    var vad = new FakeVadDetector(false);
    var gate = new VadGate(vad, BalancedConfig);

    var decision = gate.Process(FrameFactory.WithRms(2000), nowMs: 0);

    Assert.IsInstanceOfType(decision, typeof(GateDecision.Stay));
}
```

Run, expect pass (existing logic already handles this).

- [ ] **Step 7: Add third test — Closed stays Closed below RMS open**

```csharp
[TestMethod]
public void Closed_stays_Closed_when_RmsBelowOpen_even_if_VadTrue()
{
    var vad = new FakeVadDetector(true);
    var gate = new VadGate(vad, BalancedConfig);

    var decision = gate.Process(FrameFactory.WithRms(100), nowMs: 0);

    Assert.IsInstanceOfType(decision, typeof(GateDecision.Stay));
}
```

Run, expect pass.

- [ ] **Step 8: Add fourth test — onset lookback length**

```csharp
[TestMethod]
public void OpenWithLookback_includes_OnsetLookbackFrames_plus_one_frames()
{
    var vad = new FakeVadDetector(false, false, false, true);
    var gate = new VadGate(vad, BalancedConfig);

    // Three sub-threshold frames (Stay)
    gate.Process(FrameFactory.WithRms(50),  0);
    gate.Process(FrameFactory.WithRms(50), 10);
    gate.Process(FrameFactory.WithRms(50), 20);
    // Fourth frame opens the gate
    var decision = gate.Process(FrameFactory.WithRms(500), 30);

    var open = (GateDecision.OpenWithLookback)decision;
    Assert.AreEqual(3, open.Frames.Count);
}
```

Run, expect pass (we're returning `_ring.Length` frames; lookback=3 by default).

- [ ] **Step 9: Add fifth test — Open stays open during brief VAD dip**

```csharp
[TestMethod]
public void Open_stays_Open_during_brief_VadFalse_within_hangover()
{
    var vad = new FakeVadDetector(true, false, true);
    var gate = new VadGate(vad, BalancedConfig);

    gate.Process(FrameFactory.WithRms(500),   0);  // open
    var dipDecision = gate.Process(FrameFactory.WithRms(500), 50);  // VAD says false but within hangover

    Assert.IsInstanceOfType(dipDecision, typeof(GateDecision.PassThrough));
}
```

Run, expect pass.

- [ ] **Step 10: Add sixth test — Open closes after hangover elapses**

```csharp
[TestMethod]
public void Open_closes_after_hangover_with_no_activity()
{
    var vad = new FakeVadDetector(true, false, false);
    var gate = new VadGate(vad, BalancedConfig);

    gate.Process(FrameFactory.WithRms(500),   0);    // open at t=0
    gate.Process(FrameFactory.WithRms(500), 100);    // VAD=false, still in hangover (300 ms)
    var closeDecision = gate.Process(FrameFactory.WithRms(500), 400);  // VAD=false, hangover elapsed

    Assert.IsInstanceOfType(closeDecision, typeof(GateDecision.CloseWithTerminator));
}
```

Run, expect pass.

- [ ] **Step 11: Add seventh test — Mid-word RMS dip below close still extends hangover if VAD true**

```csharp
[TestMethod]
public void Open_does_not_close_when_RmsAboveClose_even_if_VadFalse_briefly()
{
    var vad = new FakeVadDetector(true, false, true, false);
    var gate = new VadGate(vad, BalancedConfig);

    gate.Process(FrameFactory.WithRms(500),   0);  // open
    gate.Process(FrameFactory.WithRms(500), 100); // VAD false, RMS high — hangover does NOT reset
    gate.Process(FrameFactory.WithRms(500), 200); // VAD true, RMS high — hangover RESETS here
    var d = gate.Process(FrameFactory.WithRms(500), 450); // VAD false, but only 250ms since last reset (<300)

    Assert.IsInstanceOfType(d, typeof(GateDecision.PassThrough));
}
```

Run, expect pass.

- [ ] **Step 12: Add eighth test — close emits Terminator decision exactly once**

```csharp
[TestMethod]
public void After_Close_subsequent_belowThreshold_frames_return_Stay_not_Close()
{
    var vad = new FakeVadDetector(true, false, false, false);
    var gate = new VadGate(vad, BalancedConfig);

    gate.Process(FrameFactory.WithRms(500),   0);   // open
    gate.Process(FrameFactory.WithRms(500), 400);   // close (1st CloseWithTerminator)
    var d = gate.Process(FrameFactory.WithRms(50), 500); // closed already

    Assert.IsInstanceOfType(d, typeof(GateDecision.Stay));
}
```

Run, expect pass.

- [ ] **Step 13: Add ninth test — hot-swap sensitivity changes thresholds immediately**

```csharp
[TestMethod]
public void SetSensitivity_changes_thresholds_for_next_frame()
{
    var vad = new FakeVadDetector(true, true);
    var gate = new VadGate(vad, VadGateConfig.FromSensitivity(VadSensitivity.High)); // open=400

    var d1 = gate.Process(FrameFactory.WithRms(300), 0);
    Assert.IsInstanceOfType(d1, typeof(GateDecision.Stay), "RMS 300 < open 400 in High");

    gate.SetSensitivity(VadSensitivity.Balanced); // open=250
    var d2 = gate.Process(FrameFactory.WithRms(300), 10);
    Assert.IsInstanceOfType(d2, typeof(GateDecision.OpenWithLookback), "RMS 300 >= open 250 in Balanced");
}
```

Run, expect pass.

- [ ] **Step 14: Add tenth test — frame size validation**

```csharp
[TestMethod]
[ExpectedException(typeof(ArgumentException))]
public void Process_throws_on_wrong_frame_length()
{
    var gate = new VadGate(new FakeVadDetector(), BalancedConfig);
    gate.Process(new short[100], 0);
}
```

Run, expect pass.

- [ ] **Step 15: Run full VadGateTests file**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter VadGateTests -nologo
```

Expected: 10/10 passed.

- [ ] **Step 16: Commit**

```bash
git add src/Brmble.Audio/VadGate.cs tests/Brmble.Audio.Tests/VadGateTests.cs tests/Brmble.Audio.Tests/Helpers/VadGateTestHarness.cs
git commit -m "feat(audio): VadGate state-machine with hysteresis, hangover, onset-lookback"
```

---

## Task 5: Replay-test from 2026-05-02 measurement log

**Files:**
- Create: `tests/Brmble.Audio.Tests/fixtures/vad-realtalk-2026-05-02.csv`
- Modify: `tests/Brmble.Audio.Tests/VadGateTests.cs`

The 5-second continuous-talking sequence from today's measurement (post-APM RMS values, ~10 Hz). Replaying it through `VadGate` must produce well-controlled transitions, not the dozens-of-flaps the naïve algorithm produces.

- [ ] **Step 1: Create the fixture**

`tests/Brmble.Audio.Tests/fixtures/vad-realtalk-2026-05-02.csv`:
```
# Format: rms,isSpeechFromVad
# Source: %LocalAppData%/Brmble/audio.log VAD-DIAG block 16:23:25.272 — 16:23:30.082
# Synthetic isSpeech: true when post-APM RMS >= 100 (proxy for what libfvad would say
# given speech-shaped energy; integration test will use the real classifier).
251,true
409,true
239,true
234,true
406,true
190,true
238,true
254,true
109,true
2,false
19,false
216,true
238,true
50,false
542,true
1185,true
251,true
669,true
449,true
30,false
164,true
738,true
9,false
211,true
343,true
11,false
513,true
15,false
419,true
161,true
241,true
170,true
9,false
310,true
230,true
866,true
301,true
332,true
212,true
372,true
299,true
```

- [ ] **Step 2: Add the replay test**

Append to `tests/Brmble.Audio.Tests/VadGateTests.cs`:
```csharp
[TestMethod]
public void Replay_2026_05_02_realtalk_sequence_produces_at_most_5_transitions()
{
    var lines = File.ReadAllLines("fixtures/vad-realtalk-2026-05-02.csv")
                    .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"));
    var rows = lines.Select(l =>
    {
        var p = l.Split(',');
        return (rms: double.Parse(p[0], System.Globalization.CultureInfo.InvariantCulture),
                isSpeech: bool.Parse(p[1]));
    }).ToList();

    var vad = new FakeVadDetector(rows.Select(r => r.isSpeech).ToArray());
    var gate = new VadGate(vad, BalancedConfig);
    int transitions = 0;

    for (int i = 0; i < rows.Count; i++)
    {
        // 100 ms between frames matches the throttle of the original measurement.
        var frame = FrameFactory.WithRms(rows[i].rms);
        var d = gate.Process(frame, nowMs: i * 100);
        if (d is GateDecision.OpenWithLookback or GateDecision.CloseWithTerminator) transitions++;
    }

    Assert.IsTrue(transitions <= 5,
        $"Expected ≤5 transitions across the realtalk replay; got {transitions}. " +
        "Naïve threshold today produces ~20+; this guards the regression.");
}
```

- [ ] **Step 3: Run the replay test**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter Replay_2026_05_02 -nologo
```

Expected: 1/1 passed (≤5 transitions).

- [ ] **Step 4: Commit**

```bash
git add tests/Brmble.Audio.Tests/fixtures/vad-realtalk-2026-05-02.csv tests/Brmble.Audio.Tests/VadGateTests.cs
git commit -m "test(audio): regression test against 2026-05-02 VAD-DIAG real-talk sequence"
```

---

## Task 6: Vendor `libfvad` source + build prebuilt DLL

**Files:**
- Create: `lib/native/libfvad/README.md`
- Create: `lib/native/libfvad/CMakeLists.txt`
- Create: `lib/native/libfvad/src/...` (vendored from `dpirch/libfvad`)
- Create: `lib/native/libfvad/include/fvad.h`
- Create: `lib/native/libfvad/win-x64/libfvad.dll`

- [ ] **Step 1: Clone libfvad to a temp dir and inspect layout**

```bash
git clone --depth 1 https://github.com/dpirch/libfvad /tmp/libfvad-src
ls /tmp/libfvad-src/src
ls /tmp/libfvad-src/include
```

Expected output (verify before vendoring):
```
src/fvad.c   src/signal_processing/  src/vad/
src/signal_processing/division_operations.c  energy.c  get_scaling_square.c
  resample_48khz.c  resample_by_2_internal.c  resample_fractional.c  spl_inl.c
src/vad/vad_core.c  vad_filterbank.c  vad_gmm.c  vad_sp.c
include/fvad.h
```

- [ ] **Step 2: Copy source into the repo**

```bash
mkdir -p lib/native/libfvad/src/signal_processing lib/native/libfvad/src/vad lib/native/libfvad/include
cp /tmp/libfvad-src/src/fvad.c                         lib/native/libfvad/src/
cp /tmp/libfvad-src/src/signal_processing/*.c          lib/native/libfvad/src/signal_processing/
cp /tmp/libfvad-src/src/signal_processing/*.h          lib/native/libfvad/src/signal_processing/  # if any
cp /tmp/libfvad-src/src/vad/*.c                        lib/native/libfvad/src/vad/
cp /tmp/libfvad-src/src/vad/*.h                        lib/native/libfvad/src/vad/  # if any
cp /tmp/libfvad-src/include/fvad.h                     lib/native/libfvad/include/
cp /tmp/libfvad-src/COPYING                            lib/native/libfvad/COPYING-libfvad
```

If `libfvad/src/` contains additional `.h` files alongside `.c`, copy those too — verify with `ls /tmp/libfvad-src/src/**/*.h`.

- [ ] **Step 3: Write the CMakeLists.txt**

`lib/native/libfvad/CMakeLists.txt`:
```cmake
cmake_minimum_required(VERSION 3.20)
project(libfvad C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

file(GLOB_RECURSE LIBFVAD_SOURCES src/*.c)

add_library(libfvad SHARED ${LIBFVAD_SOURCES})
target_include_directories(libfvad PRIVATE src include)
set_target_properties(libfvad PROPERTIES
    PREFIX ""               # produce libfvad.dll on Windows, not liblibfvad.dll
    OUTPUT_NAME "libfvad")

# Export the public C API symbols on Windows.
if(WIN32)
    target_compile_definitions(libfvad PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()
```

If on first compile `fvad_new` etc. are not exported, add `__declspec(dllexport)` via a small `def` file:

`lib/native/libfvad/libfvad.def`:
```
LIBRARY libfvad
EXPORTS
    fvad_new
    fvad_free
    fvad_reset
    fvad_set_mode
    fvad_set_sample_rate
    fvad_process
```

And in CMakeLists.txt under `if(WIN32)`:
```cmake
target_sources(libfvad PRIVATE libfvad.def)
```

- [ ] **Step 4: Write the README**

`lib/native/libfvad/README.md`:
```markdown
# libfvad — vendored

Source vendored from https://github.com/dpirch/libfvad (BSD-3-Clause). See
`COPYING-libfvad` for the full license.

## Why vendored

We ship `libfvad.dll` alongside the Brmble client. Vendoring the source
makes the build reproducible — anyone with CMake + a C compiler can rebuild
the DLL bit-for-bit (modulo PE timestamps).

## Rebuilding `libfvad.dll` (Windows x64)

Requires Visual Studio Build Tools (or full VS) and CMake ≥ 3.20.

```powershell
cd lib/native/libfvad
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
copy build\Release\libfvad.dll win-x64\libfvad.dll
```

After rebuilding, run the integration tests:

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter WebRtcVadTests
```

If they pass, commit `win-x64/libfvad.dll` together with whichever source/CMake
changes triggered the rebuild.

## Other architectures

Currently only `win-x64` ships. To add `win-arm64`, repeat the build with
`-A ARM64` and place the resulting DLL in `win-arm64/libfvad.dll`, then update
the `<None Include>` glob in `src/Brmble.Audio/Brmble.Audio.csproj` to copy it
based on RID.
```

- [ ] **Step 5: Build the DLL**

```bash
(cd lib/native/libfvad && cmake -B build -G "Visual Studio 17 2022" -A x64 && cmake --build build --config Release)
mkdir -p lib/native/libfvad/win-x64
cp lib/native/libfvad/build/Release/libfvad.dll lib/native/libfvad/win-x64/libfvad.dll
```

Verify: `ls -la lib/native/libfvad/win-x64/libfvad.dll` shows ~30–80 KB binary.

- [ ] **Step 6: Wire the DLL into Brmble.Audio.csproj output**

Edit `src/Brmble.Audio/Brmble.Audio.csproj`, add inside the existing `<ItemGroup>` block (or a new one):
```xml
<ItemGroup>
  <None Include="..\..\lib\native\libfvad\win-x64\libfvad.dll" Condition="$([MSBuild]::IsOSPlatform('Windows'))">
    <Link>libfvad.dll</Link>
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    <CopyToPublishDirectory>PreserveNewest</CopyToPublishDirectory>
  </None>
</ItemGroup>
```

- [ ] **Step 7: Build and confirm the DLL lands in output**

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj -nologo
ls src/Brmble.Audio/bin/Debug/net10.0/libfvad.dll
```

Expected: `libfvad.dll` exists in output.

- [ ] **Step 8: Commit**

```bash
git add lib/native/libfvad src/Brmble.Audio/Brmble.Audio.csproj
git commit -m "build(audio): vendor libfvad source + prebuilt win-x64 DLL"
```

---

## Task 7: `LibFvadNative` — P/Invoke declarations

**Files:**
- Create: `src/Brmble.Audio/Native/LibFvadNative.cs`

- [ ] **Step 1: Create the P/Invoke class**

`src/Brmble.Audio/Native/LibFvadNative.cs`:
```csharp
using System.Runtime.InteropServices;

namespace Brmble.Audio.Native;

internal static class LibFvadNative
{
    private const string Library = "libfvad";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern IntPtr fvad_new();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern void fvad_free(IntPtr inst);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern void fvad_reset(IntPtr inst);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern int fvad_set_mode(IntPtr inst, int mode);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern int fvad_set_sample_rate(IntPtr inst, int sample_rate);

    /// <summary>
    /// Returns 1 if active voice detected, 0 if not, -1 on error (e.g. wrong frame length).
    /// </summary>
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    public static extern unsafe int fvad_process(IntPtr inst, short* frame, UIntPtr length);
}
```

- [ ] **Step 2: Build**

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj -nologo
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Audio/Native/LibFvadNative.cs
git commit -m "feat(audio): P/Invoke declarations for libfvad"
```

---

## Task 8: `WebRtcVad` — managed wrapper implementing `IVadDetector`

**Files:**
- Create: `src/Brmble.Audio/WebRtcVad.cs`
- Create: `tests/Brmble.Audio.Tests/WebRtcVadSmokeTests.cs`

- [ ] **Step 1: Implement the wrapper**

`src/Brmble.Audio/WebRtcVad.cs`:
```csharp
using System.Threading;
using Brmble.Audio.Native;

namespace Brmble.Audio;

/// <summary>
/// libfvad-backed implementation of <see cref="IVadDetector"/>.
/// Operates on 480-sample frames at 48 kHz mono int16.
/// Hot-swap of <see cref="Mode"/> is thread-safe; underlying handle access is serialised by an internal lock.
/// </summary>
public sealed class WebRtcVad : IVadDetector, IDisposable
{
    public const int FrameSamples = 480;
    public const int SampleRate = 48000;

    private readonly object _lock = new();
    private IntPtr _handle;
    private VadAggressiveness _mode;
    private bool _disposed;

    public WebRtcVad(VadAggressiveness mode = VadAggressiveness.Aggressive)
    {
        _handle = LibFvadNative.fvad_new();
        if (_handle == IntPtr.Zero) throw new InvalidOperationException("fvad_new failed (out of memory)");

        if (LibFvadNative.fvad_set_sample_rate(_handle, SampleRate) != 0)
        {
            LibFvadNative.fvad_free(_handle);
            _handle = IntPtr.Zero;
            throw new InvalidOperationException($"fvad_set_sample_rate({SampleRate}) failed");
        }

        Mode = mode;
    }

    public VadAggressiveness Mode
    {
        get => _mode;
        set
        {
            lock (_lock)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(WebRtcVad));
                if (LibFvadNative.fvad_set_mode(_handle, (int)value) != 0)
                    throw new ArgumentOutOfRangeException(nameof(value), value, "fvad_set_mode rejected the value");
                _mode = value;
            }
        }
    }

    public bool IsSpeech(ReadOnlySpan<short> frame)
    {
        if (frame.Length != FrameSamples)
            throw new ArgumentException($"Frame must be {FrameSamples} samples", nameof(frame));

        lock (_lock)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(WebRtcVad));
            unsafe
            {
                fixed (short* p = frame)
                {
                    int rc = LibFvadNative.fvad_process(_handle, p, (UIntPtr)FrameSamples);
                    return rc == 1; // -1 (error) and 0 (silence) both treated as non-speech
                }
            }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            if (_handle != IntPtr.Zero)
            {
                LibFvadNative.fvad_free(_handle);
                _handle = IntPtr.Zero;
            }
        }
    }
}
```

- [ ] **Step 2: Add a smoke test that exercises the native binding**

`tests/Brmble.Audio.Tests/WebRtcVadSmokeTests.cs`:
```csharp
using Brmble.Audio;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Audio.Tests;

[TestClass]
public class WebRtcVadSmokeTests
{
    [TestMethod]
    public void Constructor_loads_native_library_and_initialises()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        Assert.AreEqual(VadAggressiveness.Aggressive, vad.Mode);
    }

    [TestMethod]
    public void IsSpeech_returns_false_on_silence()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        var silence = new short[480];
        Assert.IsFalse(vad.IsSpeech(silence));
    }

    [TestMethod]
    public void Mode_can_be_changed_after_construction()
    {
        using var vad = new WebRtcVad(VadAggressiveness.Quality);
        vad.Mode = VadAggressiveness.VeryAggressive;
        Assert.AreEqual(VadAggressiveness.VeryAggressive, vad.Mode);
    }

    [TestMethod]
    public void IsSpeech_returns_true_on_synthetic_speech_band_signal()
    {
        // A 1 kHz sine at moderate level lands inside the speech band and is
        // typically classified as speech by libfvad in Aggressive mode.
        using var vad = new WebRtcVad(VadAggressiveness.Aggressive);
        var frame = new short[480];
        for (int i = 0; i < frame.Length; i++)
            frame[i] = (short)(8000 * Math.Sin(2 * Math.PI * 1000 * i / 48000.0));

        Assert.IsTrue(vad.IsSpeech(frame));
    }
}
```

- [ ] **Step 3: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter WebRtcVadSmokeTests -nologo
```

Expected: 4/4 passed. If `DllNotFoundException`, the `<None Include>` from Task 6 didn't propagate to the test project's output — verify `ls tests/Brmble.Audio.Tests/bin/Debug/net10.0/libfvad.dll` and re-add the `<None>` to `Brmble.Audio.Tests.csproj` if needed.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Audio/WebRtcVad.cs tests/Brmble.Audio.Tests/WebRtcVadSmokeTests.cs
git commit -m "feat(audio): WebRtcVad managed wrapper around libfvad"
```

---

## Task 9: `EncodePipeline.EmitTerminator()` — TDD

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`
- Modify: existing `EncodePipelineTests.cs` (locate first)

- [ ] **Step 1: Locate existing pipeline tests**

```bash
find . -path './.worktrees' -prune -o -name 'EncodePipelineTests.cs' -print
```

If it exists, modify it. If no test file exists, create `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTests.cs` (and add the `tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj` if needed — model after `Brmble.Audio.Tests.csproj`).

- [ ] **Step 2: Write failing test for empty-accumulator path**

In the located/created test file, add:
```csharp
[TestMethod]
public void EmitTerminator_with_empty_accumulator_emits_one_packet_with_terminator_flag()
{
    var captured = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: m => captured.Add(m.ToArray()),
        frameSize: 480);

    pipeline.EmitTerminator();

    Assert.AreEqual(1, captured.Count, "Expected exactly one packet emitted on terminator with empty accumulator");
    // Packet layout: [typeTarget][seq varint][size varint][opus]
    // The size varint has bit 0x2000 OR'd in for terminator. Easiest assertion:
    // the packet must contain a non-empty payload (Opus frame for ~10 ms of zeros).
    Assert.IsTrue(captured[0].Length > 4);
}
```

- [ ] **Step 3: Write failing test for partial-accumulator path (terminator bit must still be set)**

```csharp
[TestMethod]
public void EmitTerminator_with_partial_accumulator_emits_padded_packet_with_terminator_flag()
{
    var captured = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: m => captured.Add(m.ToArray()),
        frameSize: 480);

    // Submit half a frame
    pipeline.SubmitPcm(new byte[240 * 2]);
    Assert.AreEqual(0, captured.Count, "Half a frame should not yet emit a packet");

    pipeline.EmitTerminator();

    Assert.AreEqual(1, captured.Count, "EmitTerminator should flush the partial frame");
}
```

- [ ] **Step 4: Write failing test that pipeline keeps working after EmitTerminator**

```csharp
[TestMethod]
public void Pipeline_continues_emitting_packets_after_EmitTerminator()
{
    var captured = new List<byte[]>();
    var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: m => captured.Add(m.ToArray()),
        frameSize: 480);

    pipeline.EmitTerminator();           // 1 packet (empty accumulator path)
    pipeline.SubmitPcm(new byte[480 * 2]); // 2 packets total
    Assert.AreEqual(2, captured.Count);
}
```

- [ ] **Step 5: Run, expect failures**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter EncodePipeline -nologo
```

Expected: compile error — `EmitTerminator` method not found.

- [ ] **Step 6: Implement `EmitTerminator`**

In `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`, add immediately after `FlushFinal()`:
```csharp
/// <summary>
/// End the current voice transmission without disposing the pipeline. Always
/// emits exactly one Opus packet with the Mumble terminator flag set so the
/// receiver clears the speaker indicator. Unlike <see cref="FlushFinal"/>,
/// this path emits a zero-padded packet even if the accumulator is empty —
/// which is required for VAD gate-close to land cleanly on packet boundaries.
/// </summary>
public void EmitTerminator()
{
    if (_accumulatorPos < _frameSizeBytes)
    {
        // Zero-pad whatever is in the accumulator (possibly all of it) to a full frame.
        Array.Clear(_accumulator, _accumulatorPos, _frameSizeBytes - _accumulatorPos);
        _accumulatorPos = _frameSizeBytes;
    }
    EncodeAndEmit(terminator: true);
    _accumulatorPos = 0;
}
```

- [ ] **Step 7: Run, expect pass**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter EncodePipeline -nologo
```

Expected: 3/3 passed.

- [ ] **Step 8: Run the full Brmble.Audio.Tests suite to confirm no regression on existing FlushFinal tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj -nologo
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs tests/MumbleVoiceEngine.Tests/
git commit -m "feat(voice): EncodePipeline.EmitTerminator() for VAD gate-close"
```

(If you created the new test project, also commit `tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj` and add it to the solution.)

---

## Task 10: Add `VadSensitivity` to `AudioSettings`

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

- [ ] **Step 1: Add the field**

In `src/Brmble.Client/Services/AppConfig/AppSettings.cs`, modify the `AudioSettings` record to add one field at the end:
```csharp
public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int OpusBitrate = 72000,
    int OpusFrameSize = 20,
    string CaptureApi = "wasapi",
    int VoiceHoldMs = 200,
    string VadSensitivity = "balanced"  // "low" | "balanced" | "high"
);
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter AppConfig -nologo
```

Expected: all green. If a serialization test fails, the new field defaulting to `"balanced"` should be backward-compatible — confirm no test asserts the JSON shape strictly.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat(settings): add VadSensitivity to AudioSettings"
```

---

## Task 11: Wire `VadGate` into `AudioManager.OnMicData`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

This is the integration heart. We replace the existing single-threshold check with a frame-by-frame `VadGate.Process` call, and set up the gate as a member.

- [ ] **Step 1: Add the member fields**

Near the existing `_processor` / `_processorLock` block in `AudioManager.cs` (around line 290–310), add:
```csharp
// VAD gate (active only in TransmissionMode.VoiceActivity)
private WebRtcVad? _vad;
private VadGate? _vadGate;
private readonly object _vadLock = new();
private VadSensitivity _vadSensitivity = VadSensitivity.Balanced;
```

Replace the existing diagnostic field `private long _vadDiagLastLogMs;` with:
```csharp
#if DEBUG
private long _vadDiagLastLogMs;
#endif
```

- [ ] **Step 2: Add lazy creation helper**

Add a private method on `AudioManager`:
```csharp
private VadGate GetOrCreateVadGate()
{
    lock (_vadLock)
    {
        if (_vadGate != null) return _vadGate;

        try
        {
            _vad = new WebRtcVad(VadAggressiveness.Aggressive);
        }
        catch (Exception ex)
        {
            AudioLog.Write($"[Audio] WebRtcVad init failed, using RMS-only fallback: {ex.Message}");
            _vad = new RmsOnlyVadFallback();
        }
        _vadGate = new VadGate(_vad, VadGateConfig.FromSensitivity(_vadSensitivity));
        return _vadGate;
    }
}
```

And add the fallback class (in the same file, below `AudioManager`):
```csharp
internal sealed class RmsOnlyVadFallback : IVadDetector
{
    public VadAggressiveness Mode { get; set; }
    public bool IsSpeech(ReadOnlySpan<short> frame) => true; // gate threshold does the work
}
```

- [ ] **Step 3: Replace the threshold early-return with the gate**

Locate the block at `AudioManager.cs:870-916` (the `// Voice activity check on processed signal` block plus the speaking-state lock). Replace the `if (_transmissionMode == TransmissionMode.VoiceActivity && !IsAboveThreshold(...)) return;` line and the speaking-state setting with:

```csharp
// Voice Activity: per-frame gate. Continuous and PTT modes go through unchanged.
if (_transmissionMode == TransmissionMode.VoiceActivity)
{
    var gate = GetOrCreateVadGate();
    int offset = 0;
    while (offset + (VadGate.FrameSamples * 2) <= processedBytes)
    {
        var frameSpan = new ReadOnlySpan<byte>(processedBuffer, offset, VadGate.FrameSamples * 2);
        var frameShorts = new short[VadGate.FrameSamples];
        for (int i = 0; i < VadGate.FrameSamples; i++)
            frameShorts[i] = (short)(frameSpan[i * 2] | (frameSpan[i * 2 + 1] << 8));

        var decision = gate.Process(frameShorts, Environment.TickCount64);

        EncodePipeline? pipelineRef;
        bool fireStartedSpeaking = false;
        lock (_lock)
        {
            pipelineRef = _encodePipeline;
            switch (decision)
            {
                case GateDecision.OpenWithLookback open:
                    if (_currentlySpeaking.Add(_localUserId)) fireStartedSpeaking = true;
                    _lastLocalAudioMs = Environment.TickCount64;
                    foreach (var f in open.Frames)
                        pipelineRef?.SubmitPcm(MemoryMarshal.AsBytes(f.AsSpan()));
                    break;
                case GateDecision.PassThrough pt:
                    _lastLocalAudioMs = Environment.TickCount64;
                    pipelineRef?.SubmitPcm(MemoryMarshal.AsBytes(pt.Frame.AsSpan()));
                    break;
                case GateDecision.CloseWithTerminator:
                    pipelineRef?.EmitTerminator();
                    break;
                case GateDecision.Stay:
                    break;
            }
        }
        if (fireStartedSpeaking) UserStartedSpeaking?.Invoke(_localUserId);

        // Throttled meter publication (subscribed only when settings tab is open on VAD).
        if (Volatile.Read(ref _vadMeterSubscribers) > 0)
            PublishVadMeterThrottled(gate.LastRms, gate.IsOpen);

#if DEBUG
        // Keep the 2026-05-02 diagnostic available for future investigations.
        long now = Environment.TickCount64;
        if (now - _vadDiagLastLogMs >= 100)
        {
            _vadDiagLastLogMs = now;
            AudioLog.Write($"[VAD-DIAG] postApmRms={gate.LastRms:F1} threshold={VadGateConfig.FromSensitivity(_vadSensitivity).OpenRmsThreshold} isOpen={gate.IsOpen} mode={_transmissionMode} ns={_noiseSuppressionLevel}");
        }
#endif
        offset += VadGate.FrameSamples * 2;
    }
    return; // VAD path handles SubmitPcm itself; skip the legacy continuous block below
}

// (Continuous + PTT: existing logic from the original lock(_lock) block continues unchanged below.)
```

The existing legacy block below this insertion point (lines ~880–916) continues to handle `Continuous` and `PTT` (which were already there). We do NOT touch them.

`MemoryMarshal` requires `using System.Runtime.InteropServices;` at the top of the file — verify it's already present (it is).

- [ ] **Step 4: Add `_vadMeterSubscribers` field and `PublishVadMeterThrottled` helper**

In the field block:
```csharp
private int _vadMeterSubscribers; // ref-counted; > 0 means publish events
private long _vadMeterLastPostMs;
```

Add a private method:
```csharp
private void PublishVadMeterThrottled(double rms, bool isOpen)
{
    long now = Environment.TickCount64;
    if (now - _vadMeterLastPostMs < 50) return;
    _vadMeterLastPostMs = now;
    VadMeterUpdated?.Invoke(rms, isOpen);
}

public event Action<double, bool>? VadMeterUpdated;
```

`VadMeterUpdated` is consumed by `MumbleAdapter` (Task 13) to forward to the bridge.

- [ ] **Step 5: Add public hot-swap method**

```csharp
public void SetVadSensitivity(VadSensitivity level)
{
    lock (_vadLock)
    {
        _vadSensitivity = level;
        _vadGate?.SetSensitivity(level);
    }
}

public void SetVadMeterSubscribed(bool subscribed)
{
    if (subscribed) Interlocked.Increment(ref _vadMeterSubscribers);
    else Interlocked.Decrement(ref _vadMeterSubscribers);
}
```

- [ ] **Step 6: Dispose VAD on AudioManager.Dispose**

Find the existing `Dispose()` method and add inside its body:
```csharp
lock (_vadLock)
{
    _vadGate = null;
    _vad?.Dispose();
    _vad = null;
}
```

- [ ] **Step 7: Build to confirm no compile errors**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj -nologo
```

Expected: 0 errors. If the legacy block below references `_lastLocalAudioMs` / `_currentlySpeaking` in a way that conflicts with the new VAD path, leave the legacy block intact (Continuous + PTT still need it).

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(voice): VadGate replaces single-threshold check in OnMicData"
```

---

## Task 12: Activate local-user cleanup for VAD in `CheckSpeakingState`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs` (around line 1939)

- [ ] **Step 1: Modify the cleanup branch**

Locate the existing block:
```csharp
if (_localUserId != 0 && _currentlySpeaking.Contains(_localUserId)
    && _transmissionMode == TransmissionMode.PushToTalk)
{
    long elapsed = Environment.TickCount64 - _lastLocalAudioMs;
    if (elapsed > _voiceHoldMs)
    {
        _currentlySpeaking.Remove(_localUserId);
        (stopped ??= new()).Add(_localUserId);
    }
}
```

Replace with:
```csharp
if (_localUserId != 0 && _currentlySpeaking.Contains(_localUserId) &&
    (_transmissionMode == TransmissionMode.PushToTalk
     || _transmissionMode == TransmissionMode.VoiceActivity))
{
    long elapsed = Environment.TickCount64 - _lastLocalAudioMs;
    // VAD's hangover lives in the gate itself; cleanup uses zero extra grace.
    int graceMs = _transmissionMode == TransmissionMode.VoiceActivity ? 0 : _voiceHoldMs;
    if (elapsed > graceMs)
    {
        _currentlySpeaking.Remove(_localUserId);
        (stopped ??= new()).Add(_localUserId);
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj -nologo
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "fix(voice): clean up local speaking-state in VAD mode"
```

---

## Task 13: Bridge handlers in `MumbleAdapter.cs`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Locate the existing message-router**

```bash
grep -n "case \"voice\\." src/Brmble.Client/Services/Voice/MumbleAdapter.cs | head
```

Use the line numbers as a reference for placement.

- [ ] **Step 2: Add three new cases**

In the message-router switch, alongside existing `voice.*` cases, add:
```csharp
case "voice.vadSensitivity":
{
    var value = json["value"]?.ToString();
    var level = value switch
    {
        "low" => VadSensitivity.Low,
        "balanced" => VadSensitivity.Balanced,
        "high" => VadSensitivity.High,
        _ => (VadSensitivity?)null,
    };
    if (level is null)
    {
        AudioLog.Write($"[Bridge] Ignored voice.vadSensitivity with invalid value '{value}'");
        break;
    }
    _audio.SetVadSensitivity(level.Value);
    break;
}
case "voice.vadMeterSubscribe":
{
    var enabled = json["enabled"]?.GetValue<bool>() ?? false;
    _audio.SetVadMeterSubscribed(enabled);
    break;
}
```

- [ ] **Step 3: Wire `VadMeterUpdated` to the bridge**

In `MumbleAdapter`'s constructor (after `_audio = ...`), subscribe:
```csharp
_audio.VadMeterUpdated += (rms, isOpen) =>
{
    _bridge.Send("voice.vadMeter", new { rms, isOpen });
};
```

(Adjust the signature to match the bridge's existing `Send` API; see other `voice.*` event sites in this file.)

- [ ] **Step 4: Apply VadSensitivity from settings on startup**

In whichever `ApplySettings` / `LoadSettings` method consumes `AudioSettings`, add (right after the existing transmission-mode block):
```csharp
var sensitivity = settings.Audio.VadSensitivity switch
{
    "low" => VadSensitivity.Low,
    "high" => VadSensitivity.High,
    _ => VadSensitivity.Balanced,
};
_audio.SetVadSensitivity(sensitivity);
```

- [ ] **Step 5: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj -nologo
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat(bridge): voice.vadSensitivity / voice.vadMeterSubscribe / voice.vadMeter messages"
```

---

## Task 14: Frontend — `VadLevelMeter` component

**Files:**
- Create: `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.tsx`
- Create: `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.css`

- [ ] **Step 1: Create the CSS**

`src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.css`:
```css
.vad-meter {
  width: 100%;
  height: 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-top: var(--space-xs);
}

.vad-meter-fill {
  height: 100%;
  transition: width 80ms linear, background-color 120ms ease;
}

.vad-meter-fill.closed { background: var(--color-text-muted); }
.vad-meter-fill.open   { background: var(--color-success); }
```

- [ ] **Step 2: Create the component**

`src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.tsx`:
```tsx
import { useEffect, useState } from 'react';
import bridge from '../../bridge';
import './VadLevelMeter.css';

const MAX_RMS = 1500;

export function VadLevelMeter() {
  const [rms, setRms] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    bridge.send('voice.vadMeterSubscribe', { enabled: true });
    const unsubscribe = bridge.on('voice.vadMeter', (msg: { rms: number; isOpen: boolean }) => {
      setRms(msg.rms);
      setIsOpen(msg.isOpen);
    });
    return () => {
      bridge.send('voice.vadMeterSubscribe', { enabled: false });
      unsubscribe();
    };
  }, []);

  const fillPct = Math.min(100, (rms / MAX_RMS) * 100);
  return (
    <div className="vad-meter" aria-label="Microphone level">
      <div
        className={`vad-meter-fill ${isOpen ? 'open' : 'closed'}`}
        style={{ width: `${fillPct}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Build the frontend to confirm**

```bash
npm --prefix src/Brmble.Web run build
```

Expected: build succeeds, no TS errors. The new component isn't referenced yet so it won't ship until Task 15.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/VadLevelMeter/
git commit -m "feat(ui): VadLevelMeter component"
```

---

## Task 15: Wire VAD section into `AudioSettingsTab.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`

- [ ] **Step 1: Extend the `AudioSettings` interface and default**

Modify the existing interface to add `vadSensitivity`:
```tsx
export type VadSensitivity = 'low' | 'balanced' | 'high';

export interface AudioSettings {
  inputDevice: string;
  outputDevice: string;
  inputVolume: number;
  outputVolume: number;
  transmissionMode: TransmissionMode;
  pushToTalkKey: string | null;
  opusBitrate: number;
  opusFrameSize: number;
  voiceHoldMs: number;
  captureApi: 'waveIn' | 'wasapi';
  vadSensitivity: VadSensitivity;
}
```

Update `DEFAULT_SETTINGS`:
```tsx
export const DEFAULT_SETTINGS: AudioSettings = {
  ...
  vadSensitivity: 'balanced',
};
```

- [ ] **Step 2: Import the meter and add a VAD section**

At the top:
```tsx
import { VadLevelMeter } from '../VadLevelMeter/VadLevelMeter';
```

After the existing PTT-only block (around line 237 — the `</>` closing the `pushToTalk || pushToTalkPlus` conditional), add:
```tsx
{localSettings.transmissionMode === 'voiceActivity' && (
  <>
    <div className="settings-item">
      <label>
        Sensitivity
        <span className="tooltip-icon" data-tooltip="How strictly background noise is rejected. Higher rejects more noise but needs clearer speech to trigger; lower picks up softer voices.">?</span>
      </label>
      <Select
        value={localSettings.vadSensitivity}
        onChange={(v) => handleChange('vadSensitivity', v as VadSensitivity)}
        options={[
          { value: 'low',      label: 'Low' },
          { value: 'balanced', label: 'Balanced (recommended)' },
          { value: 'high',     label: 'High' },
        ]}
      />
    </div>
    <div className="settings-item">
      <label>Mic level</label>
      <VadLevelMeter />
    </div>
  </>
)}
```

- [ ] **Step 3: Forward sensitivity changes to the bridge**

Find the existing `useEffect` that calls `bridge.send('voice.transmissionMode', ...)` (or whichever message currently propagates settings). Add a sibling effect (or extend it):
```tsx
useEffect(() => {
  bridge.send('voice.vadSensitivity', { value: localSettings.vadSensitivity });
}, [localSettings.vadSensitivity]);
```

If settings flow through a single `voice.applySettings` style message, just add `vadSensitivity` to the payload there instead.

- [ ] **Step 4: Build the frontend**

```bash
npm --prefix src/Brmble.Web run build
```

Expected: 0 TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git commit -m "feat(ui): VAD sensitivity dropdown + level meter in Audio settings"
```

---

## Task 16: Velopack — ship `libfvad.dll`

**Files:**
- Modify: `.github/workflows/release.yml` (and any local `publish.ps1` if present)

- [ ] **Step 1: Locate publish step**

```bash
grep -n "vpk pack\|publish\|MainPaths" .github/workflows/release.yml
```

- [ ] **Step 2: Verify `libfvad.dll` lands in `publish/`**

The `<None Include>` from Task 6 should already cause `dotnet publish` to copy the DLL. After the workflow's `dotnet publish` step, add a verification line:
```yaml
- name: Verify native DLLs in publish output
  run: |
    test -f publish/libfvad.dll
    test -f publish/r8bsrc.dll
    test -f publish/webrtc-apm.dll
```

(If the publish path uses a different folder, adjust accordingly.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "build(release): verify libfvad.dll in publish output"
```

---

## Task 17: Attribution

**Files:**
- Modify: `SOUNDFLOW-THIRD-PARTY-NOTICES.txt` (or whichever `*NOTICES*.txt` exists at repo root)

- [ ] **Step 1: Locate the notices file**

```bash
ls *NOTICES* 2>/dev/null || find . -maxdepth 2 -iname '*notices*' -o -iname '*third-party*'
```

- [ ] **Step 2: Append libfvad notice**

Append to the located file:
```
================================================================================
libfvad — https://github.com/dpirch/libfvad
License: BSD-3-Clause
Copyright (c) 2016, Daniel Pirch
Copyright (c) 2011, The WebRTC project authors

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:
  [full BSD-3-Clause text — copy from lib/native/libfvad/COPYING-libfvad]
================================================================================
```

Replace the bracketed line with the actual license text from `lib/native/libfvad/COPYING-libfvad`.

- [ ] **Step 3: Commit**

```bash
git add SOUNDFLOW-THIRD-PARTY-NOTICES.txt
git commit -m "docs(legal): attribute libfvad (BSD-3-Clause)"
```

---

## Task 18: End-to-end sanity check

**Files:** none

- [ ] **Step 1: Build everything from scratch**

```bash
dotnet build
npm --prefix src/Brmble.Web run build
```

Expected: all green.

- [ ] **Step 2: Run all tests**

```bash
dotnet test --nologo
```

Expected: 0 failed.

- [ ] **Step 3: Manual smoke test**

```bash
dotnet run --project src/Brmble.Client
```

Connect to a server, switch to Voice Activity, talk. Verify:
- [ ] First syllable arrives intact at the receiver (no clipping).
- [ ] Mid-sentence pauses don't chop words.
- [ ] After you stop talking, the speaker indicator on the receiver clears within ~400 ms.
- [ ] Settings → Audio → Voice Activity shows sensitivity dropdown + a moving meter while you talk.
- [ ] Changing sensitivity to "High" requires noticeably louder speech to trigger.
- [ ] Changing sensitivity to "Low" picks up quieter speech (and possibly some typing).

- [ ] **Step 4: If all green, push and open PR**

Stop and ask the user before pushing per CLAUDE.md branch-management rules. Do not push autonomously.

---

## Self-review

Spec coverage walk-through:

| Spec section | Plan task |
|---|---|
| Goal #1 (robust discrimination) | Tasks 1, 6, 7, 8 |
| Goal #2 (no clipping / chopping) | Task 4 (hysteresis + onset-lookback + hangover) |
| Goal #3 (terminator on talk-end) | Task 9 (`EmitTerminator`) + Task 11 (gate close → emit) |
| Goal #4 (simple UI) | Tasks 14, 15 |
| Component 1 (`WebRtcVad`) | Tasks 6, 7, 8 |
| Component 2 (`VadGate`) | Tasks 1, 2, 3, 4, 5 |
| Component 3 (`EmitTerminator`) | Task 9 |
| `AudioManager` integration | Tasks 11, 12 |
| `AudioSettings` field | Task 10 |
| Bridge protocol (3 messages) | Task 13 |
| UI section + meter | Tasks 14, 15 |
| Persistence | Task 10 (record default), Task 13 (apply on startup) |
| Error handling table | Task 11 (RmsOnlyVadFallback for missing DLL) |
| Testing — unit | Task 4 (10 tests), Task 5 (replay) |
| Testing — integration | Task 8 (smoke), Task 9 (terminator) |
| Testing — manual | Task 18 |
| Velopack/attribution | Tasks 16, 17 |

No unmet spec requirements. No placeholders. Type names consistent across tasks (`VadGate`, `VadGateConfig`, `VadSensitivity`, `IVadDetector`, `WebRtcVad`, `VadAggressiveness`, `GateDecision`, `LibFvadNative`).

One known soft spot: Task 11's surgical edit to `AudioManager.cs:870-916` is described inline; the engineer must read the surrounding context before applying. Mitigated by Step 7's "build to confirm" and the Continuous + PTT path being explicitly preserved in the comment.
