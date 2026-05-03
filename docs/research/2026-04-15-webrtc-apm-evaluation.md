# WebRTC APM Integration Evaluation — SoundFlow.Extensions.WebRtc.Apm vs Sonora

Date: 2026-04-15
Scope: Adding AGC2 + noise suppression (+ optional AEC) to Brmble's NAudio capture → Opus path. Target: .NET 10 Windows desktop shipped via Velopack.

## TL;DR

**Use SoundFlow.Extensions.WebRtc.Apm (Option A).** It's the only option that actually ships a Windows DLL today. Sonora is promising but still a one-person pre-1.0 research project, `sonora-ffi` only builds a static library (we can't consume it from .NET without building our own cdylib crate first), and there are no prebuilt Windows binaries. The expected effort gap is roughly 1 day vs. 1–2 weeks, for the same WebRTC algorithms.

Keep Sonora in the watch list — reassess in ~6 months once it publishes a cdylib and prebuilt releases.

## Side-by-side comparison

| Criterion | SoundFlow.Extensions.WebRtc.Apm (A) | Sonora / sonora-ffi (B) |
|---|---|---|
| Package state | NuGet `SoundFlow.Extensions.WebRtc.Apm 1.4.0` (published 2026-01-08), 3,096 downloads across 7 versions, targets `net8.0` | `sonora 0.1.0` + `sonora-ffi 0.1.0` on crates.io (2026-02-11). 761 / 16 downloads. No prebuilt release assets (v0.1.0 `assets: []`). |
| Wrapper repo | LSXPrime/SoundFlow — 449★, 50 forks, 6 open issues, last push 2026-01-09, MIT | dignifiedquire/sonora — 32★, 2 forks, 0 open issues, last push 2026-04-07, BSD-3-Clause |
| Native project | LSXPrime/webrtc-audio-processing — 2★, last commit 2025-06-16, BSD-3. Fork of PulseAudio's webrtc-audio-processing, Meson build | Pure Rust port of WebRTC M145, C API via cbindgen |
| Contributor bus factor | 1 dominant maintainer (LSXPrime, 26 commits) + 4 drive-bys | 1 dominant maintainer (dignifiedquire, 204 commits) + dependabot |
| Windows binary available? | Yes — `webrtc-apm.dll` 4.27 MB (x64), 4.21 MB (x86) in the NuGet | **No.** `sonora-ffi` Cargo.toml has `crate-type = ["staticlib", "rlib"]` only — no cdylib. README confirms build produces `libsonora_ffi.a`. No `.dll` anywhere. |
| Runtime deps beyond main DLL | SoundFlow core dep pulled transitively → `miniaudio.dll` 700 KB also lands in output. No VC++ redist required (linked statically by webrtc-audio-processing build). | N/A (must build ourselves). Rust DLL would be self-contained statically linked. |
| API covers AGC2? | Yes — `AutomaticGainControlSettings.Agc2Enabled`, separate from AGC1. `ApmConfig.SetGainController2(bool)`. Also exposes AGC1 target dBFS / compression gain / limiter, AEC mobile mode + latency, NS level (Low/Moderate/High/VeryHigh), HPF, pre-amp gain, stream delay. | Yes — AGC2 is the primary AGC ("RNN VAD-based gain controller with limiter"). `WapConfig`, `wap_apply_config`, `wap_set_capture_pre_gain`, `wap_set_stream_delay_ms`, etc. Per-frame `wap_process_stream_f32` / `wap_process_stream_i16`. |
| Input format | 10 ms frames, float32 deinterleaved `float[][]`, sample rate must be 8/16/32/48 kHz (enforced in `NoiseSuppressor` ctor) | 10 ms frames, supports both `f32` and `i16` planar via `wap_process_stream_*` |
| Standalone usability | **Yes.** `AudioProcessingModule.cs` imports only `System.Reflection` + `System.Runtime.InteropServices`; no SoundFlow types. `WebRtcApmModifier` and `NoiseSuppressor` are the graph-aware wrappers — we'd skip them and just use `AudioProcessingModule` + `ApmConfig` + `StreamConfig` directly. | N/A — we'd have to build it. |
| Installer size impact | +~5 MB (webrtc-apm.dll 4.27 MB + miniaudio.dll 0.70 MB transitive) | Unknown until we build. A cargo-built cdylib of sonora likely ~2–4 MB. |
| Validation / quality | Based on PulseAudio's `webrtc-audio-processing` (battle-tested in PipeWire/PulseAudio). Last native update 2025-06. | Claims 2400+ WebRTC M145 tests pass via `sonora-sys` FFI bridge on Ubuntu x86_64 CI; MSRV Rust 1.91. Impressive but unverified outside Ubuntu. Recent fix #15 was a panic in AEC3 adaptive FIR filter (closed 2026-04-07) — real bugs still surfacing. |
| Upgrade risk | Low. Native binary changes rarely; C ABI is stable. Previous breakage: issue #59 "entry point `webrtc_apm_get_frame_size` not found" on macOS ARM64 in 1.0.1 — closed quickly via 1.0.2. | Medium. Pre-1.0 crate, active breaking-change window. `sonora-aec3` alone has ~60 files/~300 KB of DSP code that can regress per port. |
| License attribution | Wrapper MIT, native BSD-3. Ship `SOUNDFLOW-THIRD-PARTY-NOTICES.txt` (already packaged). | BSD-3 throughout. Standard 3-clause attribution. |
| Integration effort | ~4–8 h. Direct PInvoke-style C# API. Convert Brmble's `byte[]` PCM16 → `float[][]` (one channel), 10 ms frame at 48 kHz = 480 samples, call `ProcessStream`, convert back to `byte[]` PCM16, feed `SubmitPcm`. | ~1–2 weeks. Must: (1) patch `sonora-ffi` Cargo.toml to add `cdylib`, (2) set up `cargo build --release` step in CI (cross-compile win-x64), (3) generate / commit `wap_audio_processing.h` or write a C# PInvoke map by hand, (4) add the DLL to Velopack pack step, (5) write PInvoke bindings. |

## Option A deep findings

- NuGet metadata: <https://www.nuget.org/packages/SoundFlow.Extensions.WebRtc.Apm> — 1.0.0 (2025-05-18) through 1.4.0 (2026-01-08), 7 stable versions.
- Source location: `Extensions/SoundFlow.Extensions.WebRtc.Apm/AudioProcessingModule.cs` (34 KB). Key public surface (verified):
  - `ApmError ProcessStream(float[][] src, StreamConfig inputConfig, StreamConfig outputConfig, float[][] dest)`
  - `ApmError ProcessReverseStream(float[][] src, StreamConfig in, StreamConfig out, float[][] dest)`
  - `void SetStreamDelayMs(int delayMs)` / `int GetStreamDelayMs()`
  - `int GetRecommendedStreamAnalogLevel()` / `SetStreamAnalogLevel(int)`
  - `ApmError ApplyConfig(ApmConfig)`, `ApmConfig.SetGainController2(bool)`, etc.
  - `ApmError Initialize(StreamConfig input, StreamConfig output, StreamConfig reverseInput, StreamConfig reverseOutput)`
- Loader: custom `DllImportResolver` tries platform-prefixed names first — good for our Velopack layout.
- DLL `webrtc-apm.dll` (x64) = 4,266,236 bytes. No VC++ redist requirement found in native repo's Meson crossfile.
- Red flags:
  - Project includes a `STATEMENT.md` at repo root that at least one consumer (issue #68) described as an off-topic political rant shipped via publish profile. Cosmetic, but to be aware of when pulling the NuGet — it ends up in package root.
  - Native fork is a 3-commit repo, effectively a snapshot. If the native fork goes stale and we need a CVE fix, we'd have to fork and rebuild (non-trivial Meson + C++20 build).
  - Transitive pull of `SoundFlow` core and `miniaudio.dll` even though we don't use the graph. We could trim by vendoring just `AudioProcessingModule.cs` + the DLL and removing the core dep — but that forks us off upstream.

## Option B deep findings

- crates.io metadata: `sonora` 0.1.0 (761 downloads), `sonora-ffi` 0.1.0 (16 downloads). Both published 2026-02-11. Single version.
- Repo: <https://github.com/dignifiedquire/sonora> — 32★, 14 closed issues (mostly dependabot, one real AEC3 panic fix #15), no releases with artifacts.
- C API surface verified in `crates/sonora-ffi/src/functions.rs`: `wap_create`, `wap_create_with_config`, `wap_apply_config`, `wap_initialize`, `wap_process_stream_f32`, `wap_process_stream_i16`, `wap_process_reverse_stream_*`, `wap_set_stream_delay_ms`, `wap_set_capture_pre_gain`, `wap_set_stream_analog_level`, `wap_recommended_stream_analog_level`, `wap_get_statistics`, `wap_destroy`. Clean C ABI, good comments, `ffi_guard!` panic catcher. **API is not thread-safe** per README.
- Build command: `cargo build --release -p sonora-ffi` → `target/release/libsonora_ffi.a`. No cdylib. Header autogenerated at `crates/sonora-ffi/include/wap_audio_processing.h`.
- Validation claims: "WebRTC M145 (branch-heads/7632), 2400+ tests pass via `sonora-sys` bridge on Ubuntu x86_64". CI runs on Linux only for the C++ comparison; Rust CI also covers macOS/Windows/Android/iOS but without the C++ cross-check. AEC3 panic fix on 2026-04-07 means algorithm is not settled yet.
- Red flags:
  - No Windows binary, no release workflow (`release.yml` 404s).
  - 16 total sonora-ffi downloads — basically nobody has consumed it from C yet. We'd be the canary.
  - Rust 1.91 MSRV + submodules (`.gitmodules` present, likely C++ reference for validation) = heavier CI footprint.
  - Alternative Rust bindings exist: **`tonarino/webrtc-audio-processing`** — 309 stars, updated 2026-04-15, wraps the C++ library. If we want Rust, that's a more established route than sonora.

## Concrete next step (1-day spike)

1. Create `feature/apm-spike` worktree.
2. `dotnet add package SoundFlow.Extensions.WebRtc.Apm --version 1.4.0` on `Brmble.Client`.
3. Write `AudioProcessingPipeline.cs` in `Services/Voice/` that owns an `AudioProcessingModule` + `ApmConfig` configured for 48 kHz mono, 10 ms frame, AGC2 on, NS=High, HPF on, AEC off for v1.
4. In `AudioManager.OnMicData`, buffer `byte[]` PCM16 to a ring, pull 480-sample frames, convert `short → float` (`/32768f`) into `float[1][480]`, call `ProcessStream`, convert back to `short` / `byte[]`, forward to `EncodePipeline.SubmitPcm`.
5. Measure: native DLL size in publish output, startup time delta, CPU cost on a 10 min capture, A/B blind listen vs. pass-through.
6. Decision gate: if CPU <3 % single-core and listeners prefer processed audio, land it. If the 5 MB installer bump is unacceptable, revisit trimming the transitive SoundFlow core dep by vendoring `AudioProcessingModule.cs` + DLL only.

Defer the AEC work — needs `ProcessReverseStream` fed from WASAPI render loopback, which is a separate chunk.
