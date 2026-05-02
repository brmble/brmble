# Voice Activation Redesign — Design Spec

**Date:** 2026-05-02
**Status:** Approved for planning
**Branch:** `investigate/vad-rms-measurement` (will move to a feature branch in writing-plans)

## Problem

Voice Activity transmission mode in Brmble works poorly: speech is chopped, gate flickers mid-word, the local speaking indicator stales, and there is no UI to tune anything. Investigation today (`AudioManager.cs:875-937`) plus 27 s of post-APM RMS measurements (logged via temporary diagnostic; see `git log` for details) found seven concrete defects:

1. Single hardcoded RMS threshold (`VoiceActivityRmsThreshold = 300`) with no UI to change it.
2. No hysteresis — single-threshold gate flaps continuously when speech RMS straddles it.
3. No hangover — first sub-threshold frame returns early, so syllable valleys cut words in half.
4. Local-user `_currentlySpeaking` cleanup at `AudioManager.cs:1939` is gated `if (_transmissionMode == TransmissionMode.PushToTalk)`. In VAD mode the indicator is added but never removed.
5. No Mumble end-of-transmission terminator on talk-end. PTT-release got one in commit `ac3ff90`; VAD silence drops frames silently — receivers see stale speaker indicators.
6. Threshold runs on POST-APM int16 PCM. WebRTC APM (NS+AGC+HPF) introduces non-linear amplification (measured: `pre=186 → post=46` attenuation, `pre=177 → post=375` amplification). The threshold is unstable across NS levels.
7. No onset capture — first speech frame frequently misses threshold, clipping first syllables.

Codex independently confirmed all findings and added one nuance: `EncodePipeline.FlushFinal()` is **not** reusable for VAD-gate-close because (a) it emits nothing when the accumulator is already empty, and (b) `StopMicLocked()` calls it then disposes the pipeline — VAD must keep capture running.

## Goals

- **Robust speech/non-speech discrimination** even with non-stationary noise (typing, fans, brief room sounds).
- **No clipped onsets, no chopped mid-words.** Speech that the user produces must arrive intact at the receiver.
- **End-of-transmission terminator on every talk-end** so remote speaker indicators clear immediately.
- **Simple, intuitive UI** — one sensitivity dropdown + a live level meter. No power-user knobs.
- **Sensible defaults** — first-run users in a typical home/office environment get a "just works" experience.

## Non-Goals

- Continuous-mode improvements (works fine today; explicitly out of scope per user).
- PTT/PTT+ improvements (stable; uses its own terminator path from `ac3ff90`).
- Auto-calibration wizard.
- Draggable threshold lines on the meter (Mumble desktop has them; we want simpler).
- RNNoise / Silero / ML-based VAD (overkill for the goal).
- Cross-platform binaries (win-x64 only for v1).

---

## Architecture

```
WASAPI capture (44.1/48/96 kHz)
   └─► r8brain → 48 kHz mono int16                         [existing]
        └─► WebRTC APM (NS, AGC, HPF)                      [existing]
             └─► VadGate                                   [NEW]
                  ├─► WebRtcVad (libfvad P/Invoke)         [NEW]
                  ├─► RMS computation (post-APM)           [existing helper, reused]
                  ├─► Hysteresis + hangover state-machine  [NEW]
                  └─► Onset-lookback ring buffer (3 frames) [NEW]
                       │
                       ├─► gate-open  ──► EncodePipeline.SubmitPcm (lookback + current)
                       ├─► pass-through ► EncodePipeline.SubmitPcm (current frame)
                       └─► gate-close ──► EncodePipeline.EmitTerminator()  [NEW method]
```

Three new components; the rest is reconfigured or has a single new method:

- **`WebRtcVad`** in `Brmble.Audio` — P/Invoke wrapper around `libfvad`.
- **`VadGate`** in `Brmble.Audio` — pure C# state-machine, deterministic, unit-testable without native binding.
- **`EncodePipeline.EmitTerminator()`** in `lib/MumbleVoiceEngine` — emits one Opus packet with `TerminatorBit = 0x2000` without disposing the pipeline.

Modified, not replaced: `AudioManager.cs` (replaces the naïve threshold check), `AudioSettings` record (one new field), `AudioSettingsTab.tsx` (new section in VAD mode), bridge protocol (three new messages).

---

## Component 1: `WebRtcVad` (libfvad binding)

### Library choice: `libfvad`

- **Source:** github.com/dpirch/libfvad — Mumble's maintained fork of Google's webrtc-vad. C-only, BSD-3-Clause, ~50 KB source.
- **Why not `WebRtcVadSharp`** (NuGet)? Unmaintained for years; we want long-term control.
- **Why not extending SoundFlow upstream?** Indirect; APM and standalone-VAD are separate WebRTC components.

### Deployment

- Prebuilt `libfvad.dll` (win-x64) committed under `lib/native/libfvad/win-x64/`.
- Build instructions (CMake one-liner) in a README next to the DLL — for future rebuilds (e.g., other architectures).
- No git submodule, no runtime build step.
- Velopack: add to publish-script's `MainPaths` alongside `r8bsrc.dll` and `webrtc-apm.dll`.
- Attribution: append to existing `SOUNDFLOW-THIRD-PARTY-NOTICES.txt`.

### P/Invoke surface

`Brmble.Audio/Native/LibFvadNative.cs`:

```csharp
[DllImport("libfvad")] static extern IntPtr fvad_new();
[DllImport("libfvad")] static extern void   fvad_free(IntPtr inst);
[DllImport("libfvad")] static extern int    fvad_set_mode(IntPtr inst, int mode);
[DllImport("libfvad")] static extern int    fvad_set_sample_rate(IntPtr inst, int rate);
[DllImport("libfvad")] static extern int    fvad_process(IntPtr inst, short[] frame, UIntPtr length);
```

Public C# class `Brmble.Audio.WebRtcVad` (`IDisposable`):

```csharp
public sealed class WebRtcVad : IDisposable
{
    public WebRtcVad(VadAggressiveness mode);
    public bool IsSpeech(ReadOnlySpan<short> frame); // 480 samples @ 48 kHz = 10 ms
    public VadAggressiveness Mode { get; set; }      // hot-swappable via fvad_set_mode
    public void Dispose();
}

public enum VadAggressiveness { Quality = 0, LowBitrate = 1, Aggressive = 2, VeryAggressive = 3 }
```

Frame size is fixed at 480 samples (10 ms @ 48 kHz). The APM already produces 10 ms-aligned output, so no extra buffering.

---

## Component 2: `VadGate` (state-machine)

Pure C# in `Brmble.Audio`, no native dependency. Caller passes time in (deterministic; no `Environment.TickCount64` reads inside the gate).

### State

```
State: Closed | Open
lastActiveMs: long  // caller-supplied timestamp of last frame where (VadTrue && Rms >= closeThreshold)
ringBuffer: short[3][480]  // last 3 frames, always populated
config: VadGateConfig (immutable snapshot, swapped via volatile ref)
```

### Per-frame logic

```
isVadSpeech = vad.IsSpeech(frame)
rms         = ComputeRms(frame)
isLoudEnoughOpen  = rms >= config.OpenThreshold
isLoudEnoughClose = rms >= config.CloseThreshold
isActive          = isVadSpeech && isLoudEnoughClose

ringBuffer.Push(frame)   // always, regardless of state

if (state == Closed)
{
    if (isVadSpeech && isLoudEnoughOpen)
    {
        state = Open
        lastActiveMs = nowMs
        return GateDecision.OpenWithLookback(ringBuffer.SnapshotPlusCurrent)
    }
    return GateDecision.Stay
}
else // Open
{
    if (isActive) lastActiveMs = nowMs

    if (nowMs - lastActiveMs >= config.HangoverMs)
    {
        state = Closed
        return GateDecision.CloseWithTerminator
    }
    return GateDecision.PassThrough(frame)
}
```

### Output type

```csharp
public abstract record GateDecision
{
    public sealed record Stay() : GateDecision;
    public sealed record OpenWithLookback(short[][] Frames) : GateDecision;
    public sealed record PassThrough(short[] Frame) : GateDecision;
    public sealed record CloseWithTerminator() : GateDecision;
}
```

### Sensitivity → config mapping

User picks one of three named levels; everything else is derived. Numbers grounded in 2026-05-02 measurement (noise floor at NS=High = 0–10, keyboard peak ~160, normal speech 400–1200).

| Sensitivity | VAD Mode | Open RMS | Close RMS | Hangover ms |
|---|---|---|---|---|
| Low | 0 (Quality) | 150 | 60 | 300 |
| **Balanced** (default) | 2 (Aggressive) | 250 | 120 | 300 |
| High | 3 (VeryAggressive) | 400 | 250 | 350 |

Onset-lookback is fixed at 3 frames (30 ms) regardless of sensitivity.

### Hot-swap

`VadGate.SetSensitivity(level)` builds a new `VadGateConfig` and writes it via a single volatile reference assignment. The capture-thread reads the snapshot once per frame. No locks; mid-frame swap costs at most one frame of stale config.

### Thread model

- All frame processing on the WASAPI capture thread (single thread).
- `SetSensitivity` callable from any thread (settings UI thread).
- Meter exposes `LastRms` (`volatile float`) and `IsOpen` (`volatile bool`) for non-locking UI reads.

---

## Component 3: `EncodePipeline.EmitTerminator()`

### Why a new method

`FlushFinal()` (added in commit `ac3ff90`) emits a terminator-tagged Opus packet only if the accumulator has data, then expects the pipeline to be disposed. For VAD gate-close:

- The accumulator may be empty (talk-end happens to land on a packet boundary).
- The pipeline must keep running for the next gate-open.

### Behavior

```
EmitTerminator():
  1. If accumulator has partial samples:
       Zero-pad to a full Opus frame.
       Encode + emit with VoicePacketBuilder(terminator: true).
       Reset accumulator position.
  2. Else (accumulator empty):
       Build a single all-zero PCM frame.
       Encode + emit with VoicePacketBuilder(terminator: true).
  3. DO NOT dispose the encoder, the accumulator buffer, or any resampler.
  4. Sequence number advances normally for the emitted packet.
```

The receiver will always get a terminator packet — even at exact packet boundaries — eliminating the stale-speaker-indicator bug.

### Public surface

```csharp
public void EmitTerminator(); // in lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs
```

No new constructor parameters. Existing tests for `FlushFinal` remain valid; new tests cover the empty-accumulator path.

---

## Integration in `AudioManager.cs`

Three concrete changes:

### 1. Replace the threshold early-return (line 875)

Old:
```csharp
if (_transmissionMode == TransmissionMode.VoiceActivity &&
    !IsAboveThreshold(processedBuffer, processedBytes)) return;
```

New (inside `OnMicData`, after APM block, only when `_transmissionMode == VoiceActivity`):

```csharp
foreach (var frame in SplitInto10msFrames(processedBuffer, processedBytes))
{
    var decision = _vadGate.Process(frame, Environment.TickCount64);
    switch (decision)
    {
        case GateDecision.Stay:                 break;
        case GateDecision.OpenWithLookback ol:  foreach (var f in ol.Frames) pipeline.SubmitPcm(f); break;
        case GateDecision.PassThrough pt:       pipeline.SubmitPcm(pt.Frame); break;
        case GateDecision.CloseWithTerminator:  pipeline.EmitTerminator(); break;
    }

    if (Volatile.Read(ref _vadMeterSubscribers) > 0)
        ThrottledMeterPublish(_vadGate.LastRms, _vadGate.IsOpen);
}
```

`SplitInto10msFrames` is trivial — APM output is already a multiple of 480 samples.

### 2. Activate local-user cleanup for VAD (line ~1939)

Old:
```csharp
if (_localUserId != 0 && _currentlySpeaking.Contains(_localUserId)
    && _transmissionMode == TransmissionMode.PushToTalk)
{
    long elapsed = Environment.TickCount64 - _lastLocalAudioMs;
    if (elapsed > _voiceHoldMs) { _currentlySpeaking.Remove(_localUserId); ... }
}
```

New:
```csharp
if (_localUserId != 0 && _currentlySpeaking.Contains(_localUserId) &&
    (_transmissionMode == TransmissionMode.PushToTalk ||
     _transmissionMode == TransmissionMode.VoiceActivity))
{
    long elapsed = Environment.TickCount64 - _lastLocalAudioMs;
    int graceMs = _transmissionMode == TransmissionMode.VoiceActivity ? 0 : _voiceHoldMs;
    if (elapsed > graceMs) { _currentlySpeaking.Remove(_localUserId); ... }
}
```

VAD's hangover is in the gate itself, so the speaking-state cleanup uses zero extra grace — `_lastLocalAudioMs` only updates when the gate is actually open.

### 3. Wire `voice.vadSensitivity` and `voice.vadMeterSubscribe`

Existing message-router pattern in `MumbleAdapter.cs`. Three new handlers; full surface in the bridge-protocol section below.

### `VadGate` lifecycle

- Constructed in `AudioManager` ctor with default `Balanced`.
- `SetSensitivity` called from the bridge handler (UI hot-swap).
- Disposed in `AudioManager.Dispose`.
- `WebRtcVad` instance internal to `VadGate`, disposed together.

---

## UI: `AudioSettingsTab.tsx`

### New section (visible only when `transmissionMode === 'voiceActivity'`)

```tsx
{localSettings.transmissionMode === 'voiceActivity' && (
  <>
    <div className="settings-item">
      <label>
        Sensitivity
        <span className="tooltip-icon"
              data-tooltip="How strictly background noise is rejected. Higher rejects more noise but needs clearer speech to trigger; lower picks up softer voices.">?</span>
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
    <VadLevelMeter />
  </>
)}
```

### `VadLevelMeter` component (new)

- Subscribes to `voice.vadMeter` events on mount; unsubscribes on unmount.
- Renders a horizontal bar; fill width = `min(100%, rms / 1500 * 100)`.
- Fill color: `--color-success` when gate open, `--color-bg-tertiary` when closed.
- No numbers, no draggable lines, no thresholds shown.
- Uses tokens from `UI_GUIDE.md` — does not hardcode visual values.

### Persistence

`AudioSettings` record (`AppSettings.cs`) gains one field:

```csharp
public record AudioSettings(
    ...,
    string VadSensitivity = "balanced"  // "low" | "balanced" | "high"
);
```

No additional fields; all other VAD parameters are internal defaults from the sensitivity table.

---

## Bridge protocol additions

| Message | Direction | Payload | Effect |
|---|---|---|---|
| `voice.vadSensitivity` | JS → C# | `{ value: 'low' \| 'balanced' \| 'high' }` | `VadGate.SetSensitivity(level)` (hot-swap, no pipeline recreate). |
| `voice.vadMeterSubscribe` | JS → C# | `{ enabled: bool }` | Increments/decrements `_vadMeterSubscribers` counter. Events flow only when > 0. |
| `voice.vadMeter` | C# → JS, ~20 Hz when subscribed | `{ rms: number, isOpen: bool }` | UI updates the level bar. Throttled at 50 ms in `AudioManager`. |

---

## Error handling

| Failure | Where | Behavior |
|---|---|---|
| `libfvad.dll` missing or fails to load | `WebRtcVad` ctor | Log, fall back to pure RMS-gate using the chosen sensitivity's open/close thresholds. App stays functional. |
| `fvad_process` returns -1 (invalid frame) | per frame | Treat frame as non-speech. State-machine handles naturally. No exception. |
| `VadSensitivity` missing in saved config | `AppSettings` deserialize | Default `balanced` (record default). |
| Bridge payload missing `value` field | `voice.vadSensitivity` handler | Ignore + log warning; sensitivity unchanged. |
| Meter subscribe while mic stopped | `voice.vadMeterSubscribe` | Subscription accepted; events flow once mic produces data. |
| Hot-swap mid-frame | `VadGate.SetSensitivity` | Lock-free volatile config-snapshot swap. At most one frame uses old config. |
| `EmitTerminator` called while encoder pipeline already disposed | `EncodePipeline` | Throw `ObjectDisposedException` (programming error). Caller in `AudioManager` only calls when pipeline is alive. |

---

## Testing strategy

### 1. Unit tests — `Brmble.Audio.Tests` (MSTest)

Pure deterministic tests of `VadGate` with a mock `IVadDetector`:

- `Closed_to_Open_requires_VadTrue_AND_RmsAboveOpen`
- `Open_stays_open_during_brief_VadFalse_within_hangover`
- `Open_closes_after_hangover_elapsed`
- `Open_to_Closed_emits_TerminatorDecision`
- `Onset_lookback_includes_3_prior_frames_on_open`
- `Mid_word_VadDip_does_not_close_within_hangover`
- `Hot_swap_sensitivity_changes_thresholds_immediately`
- `Reproduce_5s_realtalk_sequence_from_2026_05_02_measurement` — replay the actual 248-sample VAD-DIAG sequence and assert ≤5 open/close transitions (vs. the dozens the naïve algorithm produces today).

### 2. Integration tests — `WebRtcVad` with libfvad

Two tests load `libfvad.dll` and process committed WAV fixtures:

- `LibFvad_classifies_known_speech_clip_correctly` — fixture `Fixtures/speech-5s-48k-mono.wav`, assert >50% speech-frames at `Aggressive` mode.
- `LibFvad_rejects_known_noise_clip` — fixture `Fixtures/typing-5s-48k-mono.wav`, assert <10% speech-frames at `Aggressive` mode.

### 3. Manual debug retention

The `VAD-DIAG` log line in `AudioManager.OnMicData` (added today on `investigate/vad-rms-measurement`) is kept in tree behind `#if DEBUG`. Re-enables instantly for future investigations without rebuilding measurement infrastructure.

### What we explicitly do not test

- A/B listening tests vs. Mumble desktop (subjective).
- Performance benchmarks (libfvad is microseconds per frame; no risk).
- Cross-platform (win-x64 only for v1).

---

## File changes summary

| File | Change |
|---|---|
| `lib/native/libfvad/win-x64/libfvad.dll` | **NEW** — prebuilt binary |
| `lib/native/libfvad/README.md` | **NEW** — build instructions |
| `src/Brmble.Audio/Native/LibFvadNative.cs` | **NEW** — P/Invoke declarations |
| `src/Brmble.Audio/WebRtcVad.cs` | **NEW** — managed wrapper |
| `src/Brmble.Audio/VadGate.cs` | **NEW** — state-machine |
| `src/Brmble.Audio/VadGateConfig.cs` | **NEW** — immutable snapshot record |
| `src/Brmble.Audio/GateDecision.cs` | **NEW** — output types |
| `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` | Add `EmitTerminator()` method |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Replace threshold check with `VadGate.Process`; activate VAD branch in `CheckSpeakingState`; remove `IsAboveThreshold`/`ComputeRms` (move to `VadGate`); keep VAD-DIAG behind `#if DEBUG` |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Three new bridge handlers |
| `src/Brmble.Client/Services/AppConfig/AppSettings.cs` | Add `VadSensitivity` field |
| `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx` | New VAD section + `VadLevelMeter` import |
| `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.tsx` | **NEW** |
| `src/Brmble.Web/src/components/VadLevelMeter/VadLevelMeter.css` | **NEW** |
| `tests/Brmble.Audio.Tests/VadGateTests.cs` | **NEW** — unit tests |
| `tests/Brmble.Audio.Tests/WebRtcVadTests.cs` | **NEW** — integration tests |
| `tests/Brmble.Audio.Tests/Fixtures/speech-5s-48k-mono.wav` | **NEW** |
| `tests/Brmble.Audio.Tests/Fixtures/typing-5s-48k-mono.wav` | **NEW** |
| Velopack publish script | Include `libfvad.dll` in `MainPaths` |
| `SOUNDFLOW-THIRD-PARTY-NOTICES.txt` | Append libfvad BSD-3 attribution |

---

## Open items for the implementation plan

These are details left to the implementation phase, not design decisions:

- Exact CMake-build invocation and hash of the prebuilt DLL.
- Where `SplitInto10msFrames` lives (helper method on `WebRtcApmProcessor` or local to `AudioManager`).
- Whether the `#if DEBUG` VAD-DIAG line stays as-is or moves behind a settings flag (`enableVadDebugLog`) for production troubleshooting.
- Source of the `speech-5s-48k-mono.wav` fixture (record fresh under known conditions, or use a public-domain corpus snippet).
