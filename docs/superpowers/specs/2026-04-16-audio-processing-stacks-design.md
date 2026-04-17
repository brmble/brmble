# Audio Processing Stacks — Design Spec

**Date:** 2026-04-16
**Branch:** `feature/apm-spike` (spike that precedes this plan)
**Related issue:** #452 (OpusEncoder crash from WASAPI thread — indirectly benefits from cleaner PCM)
**Related research:** `docs/research/2026-04-15-webrtc-apm-evaluation.md`

## Context

The APM spike landed a working WebRTC Audio Processing Module (AGC2 + NS + HPF) in the capture path via the `SoundFlow.Extensions.WebRtc.Apm` NuGet. Early listening tests are positive (noticeably leveled audio, quieter background). Before we can promote it beyond a spike we need:

1. A clean way to switch between the current "legacy" stack (amplitude AGC + RNNoise) and the new WebRTC APM stack, for comparison and bug reproduction.
2. A repeatable A/B harness so comparisons aren't dominated by speaker energy, ambient noise, or mic autogain variance between takes.

This spec defines the structural changes and the testing surface. Actual implementation steps are deferred to the plan created by `writing-plans`.

## Audience for the toggle

Developer / power user only. The UI is visible but clearly labeled as "experimental". End-user defaults do not change — a fresh install continues to use the legacy stack. Users who want the APM stack opt in via the audio settings tab.

## Scope

In scope:
- New `IAudioCapturePostProcessor` interface and three implementations (`Passthrough`, `Legacy`, `WebRtcApm`).
- `ProcessingStack` enum, default `Legacy`.
- Hot-swap support between stacks while voice is active.
- Settings UI entry next to Denoise Mode, plus a small "Testing" subsection for the virtual-mic toggle.
- Bridge plumbing to set the stack (matches `SetDenoiseMode`).
- CLI harness `tools/ApmBench` that runs a WAV through a selected stack and emits a processed WAV + basic metrics.
- Fixture WAVs committed under `tests/Brmble.Audio.Tests/fixtures/apm/`.
- Unit tests that round-trip each fixture through each stack.

Out of scope:
- AEC and render-loopback wiring (separate plan).
- Removing the legacy stack. It stays the default and the fallback.
- A user-facing "Voice processing" toggle with friendly labels. Deferred until we have evidence APM should be default.
- Custom / per-stage toggles (AGC on, NS off, etc.). Supports burden > benefit.
- VAD inside the processor. See "Design decisions" below for rationale.
- Persistent virtual-mic state — the toggle always resets to off on launch.

## Design decisions

### Interface shape

A minimal interface in `Brmble.Client/Services/Voice/`:

```csharp
public interface IAudioCapturePostProcessor : IDisposable
{
    // 16-bit PCM, 48 kHz, mono in. Same format out.
    // Returns bytes written to `output`. Implementations may buffer
    // sub-frame leftovers internally and return less than `input.Length`.
    int Process(ReadOnlySpan<byte> input, Span<byte> output);
}
```

Three implementations:

- **`PassthroughProcessor`** — copies input to output verbatim. Zero DSP. Used for stack = `None`.
- **`LegacyAudioProcessor`** — extracts the existing `ApplyAGC` and `RNNoise` blocks from `AudioManager.OnMicData` into one class. Owns its own state (`_rnnoiseRemainder` moves here). Matches current behavior byte-for-byte when selected.
- **`WebRtcApmProcessor`** — already exists from the spike. Reshape its public API to match the interface (currently compatible: `int Process(ReadOnlySpan<byte>, Span<byte>)`).

### Stack enumeration

```csharp
public enum ProcessingStack
{
    None = 0,
    Legacy = 1,      // default
    WebRtcApm = 2,
}
```

`Legacy` is the default. This preserves today's behavior for every existing user on upgrade.

### VAD location — outside the processor

Voice activity detection stays where it is today: a simple energy threshold in `AudioManager.OnMicData`, run after the processor output, gated by `TransmissionMode.VoiceActivity`.

Rationale:
- VAD is transmission policy, not DSP. Keep concerns separate.
- Interface stays one-liner.
- The `VoiceThreshold` UI slider has one well-defined meaning regardless of stack.
- APM's native VAD can be read later via `GetStatistics()` and surfaced as an *additional* signal without changing the interface.

Known behavioral nuance: APM's AGC2 lifts quiet speech, so with the same threshold, APM will trigger VAD more easily than Legacy on the same input. This is generally a user benefit (quiet voices get through) but is a measurable A/B difference and should be documented in release notes if APM ships as default.

### Hot-swap semantics

Swapping stacks while voice is active is supported on day one. The pattern exactly mirrors the existing `SetDenoiseMode`:

```csharp
// UI thread:
lock (_lock)
{
    _processor?.Dispose();
    _processor = stack switch
    {
        ProcessingStack.None => new PassthroughProcessor(),
        ProcessingStack.Legacy => new LegacyAudioProcessor(),
        ProcessingStack.WebRtcApm => new WebRtcApmProcessor(),
    };
}

// Capture thread:
IAudioCapturePostProcessor? proc;
lock (_lock) { proc = _processor; }
if (proc != null) {
    int written = proc.Process(input, outputScratch);
    // ...
}
```

Race window: the capture thread can snapshot a processor and, before calling `Process`, have it disposed on the UI thread. Window is sub-millisecond and swaps are rare. This is the same trade-off the current `RnnoiseService` swap already ships with; we accept it and note it in the spec. If it ever bites, mitigation is an interlocked exchange + a disposed-flag no-op inside each `Process`.

### Settings UI

The stack selector is a dropdown inline with the existing Denoise Mode control in Settings → Voice. Label: "Audio processing stack (experimental)". Options: `None / Legacy (default) / WebRTC APM`. Help text one line beneath: "Experimental — WebRTC APM replaces the legacy AGC and noise reduction."

A separate "Testing" subsection at the bottom of the same tab holds:

- A checkbox "Replay test fixture instead of microphone" (off by default, not persisted across launches).
- A dropdown populated from `tests/Brmble.Audio.Tests/fixtures/apm/` plus a "Browse…" button for arbitrary 48 kHz mono WAVs.

Both controls route through the existing JS↔C# bridge. The stack selector persists via the same settings store used by Denoise Mode.

### Virtual mic mechanics

When the toggle is ON:
- `AudioManager.StartMicCapture` skips `WasapiCapture` construction.
- Spawns a `FixtureWaveProvider : IWaveIn` that reads the selected WAV, loops on EOF, and raises `DataAvailable` with 20 ms frames at 48 kHz mono (matching WASAPI's cadence).
- Frames flow through the real pipeline: selected processor → `SpeechEnhancement` (if the user has it enabled) → VAD → Opus → network.
- PTT gate and VAD threshold are bypassed only inside the virtual-mic path — point of the feature is continuous playback for a listener to A/B. Mute still mutes.
- On launch, always resets to OFF, regardless of stored setting. Prevents the "my mic is broken" support scenario.

SpeechEnhancement (ONNX) stays orthogonal and user-controlled. The Testing subsection notes that for a fair A/B you should disable it.

### CLI harness

New console project `tools/ApmBench/ApmBench.csproj`, added to the solution. References `Brmble.Client` if the WinExe reference works; otherwise we extract the three processor classes into a small `Brmble.AudioProcessing` class library (decided at implementation time).

Usage:

```
dotnet run --project tools/ApmBench -- \
  --in  tests/Brmble.Audio.Tests/fixtures/apm/near_speech.wav \
  --stack apm \
  --out  /tmp/near_speech-apm.wav \
  [--metrics]
```

Assertions: input must be 48 kHz mono 16-bit PCM. The tool bails with a clear message if not — no on-the-fly resampling, because that would confound comparisons.

With `--metrics`, prints a plain-text table:

```
Input:    -23.1 dBFS RMS   -6.2 dBFS peak   0 clipped samples
Output:   -14.7 dBFS RMS   -2.1 dBFS peak   0 clipped samples
Delta:    +8.4 dB RMS      +4.1 dB peak
Frames:   1500 (10000 ms)  Stack: apm
```

### Fixtures

2–3 reference clips from Chromium's `resources/voice_engine/` tree (BSD-3-Clause), committed to `tests/Brmble.Audio.Tests/fixtures/apm/`:

- `near_speech.wav` — canonical APM near-end speech.
- `far_end.wav` — far-end signal. Useful later for AEC tests.
- `noise_speech.wav` — speech with mild background noise.

Total ~1–2 MB. A `README.md` in that folder records the upstream path, the commit SHA they were taken from, and BSD-3 attribution.

## Testing

- `WebRtcApmProcessor` and `LegacyAudioProcessor` unit tests — round-trip each fixture through each stack, assert:
  - No exceptions.
  - Output length equals input length within ±`FrameBytes` (processors may buffer one frame).
  - Output RMS is within a broad sanity range (catches all-zero or saturating regressions).
- `PassthroughProcessor` unit test — byte-equal input and output.
- `ApmBench` integration test — runs the CLI end-to-end on one fixture per stack and snapshots the metrics line (loose tolerance) so future regressions surface as test failures.

No GUI / E2E automated test for the settings toggle or virtual mic in this plan. Manual smoke-test is enough given the audience.

## Rollback

Defaulting `ProcessingStack.Legacy` means the binary ships the new code paths but takes the identical route through `LegacyAudioProcessor` that users experience today. If anything goes wrong in the extraction, symptom is "APM stack broken" — set the default back, ship a hotfix, the legacy path is unaffected.

If the interface extraction itself has a bug that breaks Legacy, it shows up on every user and we revert the PR. The new code is opt-in by stack but the *extraction* is unavoidable; this is the main real risk of the plan. Mitigation: a before/after byte-equality test comparing a small fixture through the pre-extraction path (captured once) and the new `LegacyAudioProcessor`.

## Risks and open questions

- **Race in `Process`/swap**: accepted as documented above. Revisit if it bites.
- **Output gain on APM**: the spike uses `OutputGain = 1.5`. The plan should lift this to a constant on `WebRtcApmProcessor` and leave it at 1.5 until we have more data. If listeners report APM as "too hot", lower it; if "too quiet", raise.
- **Brmble.Client reference from the CLI tool**: if Windows-only targeting (`net10.0-windows`) blocks the tool from building on Linux CI, we extract to a class library. Decided at implementation time.
- **Fixture licensing**: Chromium's `resources/voice_engine/` is BSD-3. The `README.md` in the fixtures folder must carry the attribution; this is a real requirement, not a nicety.

## Follow-up work (explicitly deferred)

- AEC + render loopback wiring. Needs a separate design, because it changes the playback path and requires a reverse-stream call into APM.
- Promoting APM to default and redesigning the UI with friendly labels. Blocked on field feedback from this plan.
- Removing the legacy stack. Only after APM has been default for at least one release with no reported regressions.
- Adding WebRTC's native VAD as an additional transmission signal via `GetStatistics()`.
