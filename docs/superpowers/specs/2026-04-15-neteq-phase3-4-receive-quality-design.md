# NetEQ Phase 3+4 — Receive-Side Audio Quality & Gaming Latency — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Supersedes scope of:** `2026-03-18-neteq-jitterbuffer-design.md` Phases 3 and 4 (deferred items)

## Problem

Remote users in Brmble voice chat sometimes sound "staticy and jittery" to the listener, even though the same Opus packets decode cleanly when played through the official Mumble client. The artifact is **receive-side**, not send-side, and is worse for some senders than others. Two concrete causes:

1. **Time-stretching artifacts (Phase 3 gap).** The current NetEQ jitter buffer (`src/Brmble.Audio/NetEQ/JitterBuffer.cs`) uses a naive 2ms linear cross-fade (`JitterBuffer.CrossFade`, line 211) whenever `DecisionLogic` selects `Accelerate` or `Decelerate` to resync the buffer. On voiced speech — where pitch periods run 2–20ms — the overlap boundary misaligns pitch cycles and produces audible modulation, clicks, and "static." How often the decision fires depends on per-sender network jitter, which explains why only some users sound bad.
2. **Abrupt silence/speech transitions (Phase 4 gap).** When a sender uses Opus DTX and stops transmitting during silence, our NetEQ currently stays in Expand (PLC) indefinitely. Opus PLC is designed for short loss (<60ms) and can produce unnatural tails on longer silences, with clicky transitions when speech resumes.
3. **Receive-side latency is untuned for gaming.** `DelayManager` currently uses WebRTC-derived defaults (high percentile, conservative minimum). For a gaming voice app where latency is the top priority, the buffer runs deeper than it needs to.

## Scope

### In scope
- Replace the 2ms cross-fade in Accelerate/Decelerate with pitch-preserving WSOLA-family time-stretching via SoundTouch.Net
- Add Comfort Noise Generation (CNG) for DTX silence gaps, with smooth cross-fade into and out of speech
- Tune `DelayManager` defaults for gaming latency and expose the two most relevant knobs via `IAppConfigService`
- Expose NetEQ runtime telemetry (per-buffer decision counts, current target delay, underflow/overflow events, CNG-active duration) from the `Brmble.Audio` library; `AudioManager` samples and writes it to the existing `%LocalAppData%/Brmble/audio.log` file via `AudioLog`

### Out of scope (deferred to future specs)
- Frontend metrics dashboard consuming the new telemetry
- Full replacement of the NetEQ implementation with the Rust `neteq` crate (revisit once it reaches 1.0 and has additional production users)
- Pure-C# WSOLA port (SoundTouch.Net is our dependency for this spec)
- Send-side quality improvements (webrtc-audio-processing, AEC, AGC) — separate initiative
- Playback-side resampling upgrade (`R8BrainResampler` on the output device path)
- Upgrades to `Merge` decision (keeps existing cross-fade — splicing dissimilar frames, not stretching)
- Upgrades to `Expand` for short packet loss (keeps existing Opus decoder PLC)

## Design Decisions

1. **Use SoundTouch.Net (NuGet) for time-stretching, not a pure-C# port or Signalsmith Stretch.** Rationale: SoundTouch.Net is a pure managed port, shipped as `SoundTouch.Net` 2.3.2 on NuGet, so no additional native DLL or P/Invoke is required. It is WSOLA-family (same algorithm we would port) and is proven in Audacity and other production apps. The default parameters are tuned for music (~100ms latency); we configure for voice with `SEQUENCE_MS=40`, `SEEKWINDOW_MS=15`, `OVERLAP_MS=8` as a starting point, with empirical tuning during implementation.
2. **Voice-tuned SoundTouch only; keep an escape hatch.** If the voice-tuned SoundTouch still adds too much latency or has quality issues, the `TimeStretcher` class is the single swap point; a future change can replace its innards with Signalsmith Stretch (behind a P/Invoke shim) or a hand-rolled WSOLA with no other call sites affected.
3. **Simple RMS-scaled filtered white noise for CNG, not a full LPC-based comfort noise model.** Rationale: the full WebRTC CNG port (LPC coefficients, spectral matching) is ~500 lines of DSP and overkill for filling DTX gaps in a voice chat. A one-pole low-passed white-noise generator whose RMS matches the end-of-speech noise floor is sufficient for "it sounds natural, not silent, not clicky." If perceptual testing later shows this is insufficient we can upgrade the generator; the API stays stable.
4. **Silence-detection threshold for CNG entry: 60ms of continuous Expand.** Rationale: short packet loss should keep using Opus PLC (that's what it is designed for); longer gaps (DTX or sustained loss) transition to CNG. The 60ms threshold is the generally-accepted boundary where PLC quality degrades.
5. **Expose two `DelayManager` knobs via `IAppConfigService`, ship gaming-optimized defaults.** Rationale: advanced users can retune for their network; defaults are tuned down from WebRTC norms because Brmble is a gaming voice app. The two knobs are:
   - Target delay percentile (default: lowered from `0.95` to `0.90` — accept more time-stretch events in exchange for less buffer depth)
   - Minimum target delay floor (default: lowered to 20ms)
6. **Backend-only telemetry in this spec.** `JitterBufferStats` (already referenced by the earlier Phase 1+2 plan) is finalized as an immutable snapshot type inside the `Brmble.Audio` library and exposed via `JitterBuffer.Stats`. The client-side `AudioManager` samples it on a low-frequency timer (e.g., once per second) and writes via the existing `AudioLog` helper, preserving the existing layering (no backward dependency from `Brmble.Audio` onto client code). Frontend visualization is deferred to its own spec so this change does not block on React work.
7. **Per-`JitterBuffer` instance state.** Both `TimeStretcher` and `ComfortNoiseGenerator` are stateful (carrying waveform tail / noise spectrum state across frames) and must be instantiated per remote user, matching the existing one-`JitterBuffer`-per-user model.
8. **Graceful degradation on library failures.** If SoundTouch.Net initialization fails for any reason, `TimeStretcher` falls back to the existing cross-fade path and logs a warning. Audio must never silence because of a time-stretcher bug.

## Architecture

### New files

| File | Responsibility |
|------|----------------|
| `src/Brmble.Audio/NetEQ/TimeStretcher.cs` | Thin wrapper around `SoundTouchProcessor`. Voice-tuned parameters. Exposes `Process(ReadOnlySpan<short> input, double stretchRatio, Span<short> output)`. Per-`JitterBuffer` instance. |
| `src/Brmble.Audio/NetEQ/ComfortNoiseGenerator.cs` | Estimates noise floor RMS from the last decoded voiced frame, generates filtered white noise at matching level, performs cross-fade into/out of speech. Per-`JitterBuffer` instance. |
| `src/Brmble.Audio/NetEQ/JitterBufferStats.cs` | Finalized from the original Phase 1+2 plan. Immutable snapshot record exposing: decision counts (Normal/Expand/Accelerate/Decelerate/Merge/CNG), current target delay (ms), underflow/overflow counters, CNG-active duration (ms). Returned by `JitterBuffer.Stats` property for the client to sample. |
| `tests/Brmble.Audio.Tests/NetEQ/TimeStretcherTest.cs` | Unit tests: sine-wave pitch preservation through stretch ratios, boundary continuity across calls, ±25% stretch ratio sanity, silence/impulse edge cases, initialization failure fallback. |
| `tests/Brmble.Audio.Tests/NetEQ/ComfortNoiseGeneratorTest.cs` | Unit tests: RMS matching, cross-fade continuity on entry/exit, steady-state spectrum, handoff from Expand. |

### Modified files

| File | Change |
|------|--------|
| `src/Brmble.Audio/Brmble.Audio.csproj` | Add `<PackageReference Include="SoundTouch.Net" Version="2.3.2" />` |
| `src/Brmble.Audio/NetEQ/JitterBuffer.cs` | Route `Accelerate` and `Decelerate` through `TimeStretcher`. Add silence-duration tracking in Expand path; transition to `ComfortNoiseGenerator` past 60ms threshold. Emit stats on every tick. |
| `src/Brmble.Audio/NetEQ/DelayManager.cs` | Accept configurable target-delay percentile and minimum-delay floor via constructor; read from `IAppConfigService` in composition root. |
| `src/Brmble.Client/Services/AppConfig/IAppConfigService.cs` | Add `GetJitterTargetPercentile()` / `SetJitterTargetPercentile(double)` and `GetJitterMinDelayMs()` / `SetJitterMinDelayMs(int)`. Defaults: 0.90 and 20ms. |
| `src/Brmble.Client/Services/AppConfig/AppConfigService.cs` | Implement the new getters/setters; persist to the existing JSON config store. |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Pass the new config values when constructing `JitterBuffer` / `DelayManager`. Sample `JitterBuffer.Stats` on a ~1 Hz timer and emit a compact line to `AudioLog`. |
| `THIRD_PARTY_NOTICES.md` (create if missing) | Add SoundTouch LGPL 2.1 attribution with link to source. |

### Data flow

```
Opus packet arrives
  → MumbleAdapter → JitterBuffer.Insert(EncodedPacket)
  → PacketBuffer (sorted)

Playout tick (every 20ms):
  JitterBuffer.GetNext():
    → DelayManager tells us current target delay (from histogram + config)
    → DecisionLogic chooses action:
         Normal    → decode next packet, emit PCM
         Expand    → Opus PLC (no packets available)
                       → track silence duration counter
                       → if > 60ms:
                            ComfortNoiseGenerator.NextFrame() (with cross-fade on entry)
         Accelerate→ decode, then TimeStretcher.Process(ratio < 1.0)
         Decelerate→ decode, then TimeStretcher.Process(ratio > 1.0)
         Merge     → existing cross-fade (unchanged)
    → On return to Normal from CNG: cross-fade out of noise into decoded speech
    → JitterBufferStats.RecordDecision(decision)
  → AudioMixer → RingBuffer → NAudio WaveOutEvent
```

### Configuration surface

New entries in `AppConfigService` JSON:

```json
{
  "jitter": {
    "targetPercentile": 0.90,
    "minDelayMs": 20
  }
}
```

Both values readable/writable at runtime; changes take effect at next `JitterBuffer` reset (new user joining a channel). No UI for these in this spec — accessible only via config file or a future debug settings panel.

## Testing Strategy

### Unit (TDD)
- **`TimeStretcherTest`:**
  - Sine wave at 440Hz input, stretched to 0.85× — FFT of output still peaks at ~440Hz within ±5Hz (pitch preserved)
  - Two consecutive stretch calls on the same sine produce continuous waveform (no step discontinuity at the join)
  - Stretch ratio 1.0 is a no-op (bit-exact passthrough not required, but near-transparent)
  - Silence input produces silence output
  - Init failure (simulated): falls back to legacy cross-fade, logs warning
- **`ComfortNoiseGeneratorTest`:**
  - RMS of output tracks RMS of last-fed voiced frame within ±3dB
  - Cross-fade on entry produces smooth amplitude envelope (no step at transition sample)
  - Steady-state spectrum is low-pass filtered white (no tonal artifacts)
  - Hand-off back to speech cross-fades cleanly (no click at exit sample)

### Regression
- Existing `JitterBufferTest`, `DelayManagerTest`, `DecisionLogicTest`, `PacketBufferTest`, `RingBufferTest` continue to pass
- New test cases for `DelayManager` with non-default percentile / min-delay

### Integration
- Record a 30-second "staticy sender" trace (Opus packets + arrival timestamps) from a real call. Replay it through the old and new NetEQ offline. Diff the decoded WAVs and manually audition both.
- Latency measurement: instrument `DelayManager.TargetDelayMs` into `JitterBufferStats`; confirm gaming-default config produces average target delay in the 20–40ms range under typical home-internet conditions.

### Manual
- Live call with a historically "staticy" remote user before vs after. Note improvements and any regressions.
- Live call with a known DTX-heavy user (whispers + long silences). Confirm CNG produces natural-sounding quiet instead of clicks.

## Rollout & Risks

### Rollout
- Single PR on branch `feature/neteq-phase3-receive-quality` (worktree per project branch rules).
- Part A (WSOLA) can land standalone if Parts C+D run long; Parts B (DelayManager tuning) can ship with A.
- No feature flag — backend-only, behavior change is per-user-instance and safe to rollback by reverting the PR.

### Risks
1. **SoundTouch voice-tuned latency higher than expected.** Mitigation: `TimeStretcher` is the single swap point; Signalsmith Stretch (P/Invoke) or a hand-rolled WSOLA replace it in-place with no other code changes. Success criterion during tuning: `TimeStretcher` internal buffering stays under 10ms added on top of the 20ms Opus frame, and `DelayManager.TargetDelayMs` averages 20–40ms under normal network conditions.
2. **Aggressive `DelayManager` defaults cause excessive Accelerate/Decelerate firings.** Mitigation: Part A must be robust before Part B defaults ship aggressively; empirical measurement in staging before merging.
3. **CNG sounds synthetic or hissy.** Mitigation: noise generator is behind a stable interface; we can upgrade from RMS-scaled filtered white noise to LPC-based CNG in a later spec if perceptual feedback demands it. Gate rollout on at least two real-world tests with DTX-heavy senders.
4. **SoundTouch.Net LGPL 2.1 license compliance.** Mitigation: Brmble ships the library as a NuGet-managed assembly (dynamic linking equivalent). Add third-party attribution and link to SoundTouch source in `THIRD_PARTY_NOTICES.md` per LGPL 2.1 § 6.
5. **Interaction between Part A and Part C on long-stretch-after-long-silence scenarios.** Mitigation: integration test that exercises "CNG active for 2 seconds, then sudden burst of packets requiring Decelerate" — ensures clean transition back through stretching.

## References

- Existing NetEQ implementation: `src/Brmble.Audio/NetEQ/`
- Phase 1+2 design: `docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md`
- SoundTouch.Net NuGet: `SoundTouch.Net` 2.3.2
- SoundTouch source: https://codeberg.org/soundtouch/soundtouch
- WebRTC NetEQ algorithm reference: https://webrtc.googlesource.com/src/+/HEAD/modules/audio_coding/neteq/g3doc/index.md
- Rust `neteq` crate (deferred full replacement): https://crates.io/crates/neteq
- Cross-fade we are replacing: `src/Brmble.Audio/NetEQ/JitterBuffer.cs:211`
