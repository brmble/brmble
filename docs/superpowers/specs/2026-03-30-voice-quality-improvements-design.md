# Voice Quality Improvements — Design Spec

**Date:** 2026-03-30
**Status:** Approved

## Problem

Outgoing voice audio in Brmble sounds noticeably worse than the official Mumble client — slightly robotic, metallic artifacts, and generally less clear. Root causes identified:

1. **Linear interpolation resampling** — the lowest quality method, introducing aliasing artifacts
2. **Suboptimal Opus encoder settings** — CBR instead of VBR, missing complexity/signal/bandwidth controls
3. **Encoder hot-reload bug** — changing bitrate/frame settings mid-session can break audio entirely

## Scope

- Replace resampler with r8brain-free-src (top-tier quality)
- Tune Opus encoder to match/exceed Mumble defaults
- Fix encoder settings hot-reload
- PTT is the primary tested mode; VAD/Continuous get DTX optimization

**Out of scope:** Voice activation improvements, incoming/playback pipeline, continuous mode fixes.

---

## 1. Resampler: r8brain-free-src

### Current State

`AudioManager.OnMicData()` performs inline linear interpolation when the capture device sample rate differs from 48kHz. A separate `AudioResampler.cs` in `Services/SpeechEnhancement/` also uses linear interpolation for the RNNoise 48kHz↔16kHz path.

### Target

Replace both resampling paths with r8brain-free-src via P/Invoke.

### r8brain Details

- **Repo:** github.com/avaneev/r8brain-free-src (MIT, v6.5)
- **Quality:** Up to 218 dB stopband attenuation, configurable
- **DLL:** Pre-built Win64 at `DLL/Win64/r8bsrc.dll` (includes AVX2 auto-dispatch)
- **API:** 5 C functions: `r8b_create`, `r8b_delete`, `r8b_clear`, `r8b_process`, `r8b_inlen`

### Integration Plan

#### New file: `lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs`

P/Invoke wrapper implementing `IDisposable`:

```
NativeMethods (static):
  - r8b_create(srcRate, dstRate, maxInLen, reqTransBand, resolution) → IntPtr
  - r8b_delete(IntPtr) → void
  - r8b_clear(IntPtr) → void
  - r8b_process(IntPtr, IntPtr input, int length, out IntPtr output) → int
  - r8b_inlen(IntPtr, int reqOutSamples) → int

R8BrainResampler (IDisposable):
  - Constructor(srcRate, dstRate, maxInLen)
    - resolution: r8brr24 (24-bit precision for 32-bit float pipeline)
    - transitionBand: 2.0 (high quality)
  - Process(ReadOnlySpan<double> input, Span<double> output) → int samplesWritten
  - Clear() — reset state (for settings changes)
  - Dispose() — release native handle
```

#### Native DLL

Place `r8bsrc.dll` (Win64) alongside `opus.dll` in the native libs path. Same deployment pattern already established.

#### Data Format Bridging

r8brain operates on `double[]`. Current pipeline uses `float[]` (WASAPI) and `short[]` (PCM).

Conversion path in `AudioManager.OnMicData()`:
1. WASAPI float → mono float (existing downmix)
2. Mono float → `double[]` (widen for r8brain)
3. r8brain resample to 48kHz
4. `double[]` → `short[]` (quantize to 16-bit PCM for Opus)

For RNNoise path (48kHz → 16kHz → 48kHz):
1. `float[]` → `double[]` (widen)
2. r8brain 48→16kHz
3. `double[]` → `float[]` (narrow for RNNoise)
4. RNNoise process
5. `float[]` → `double[]` (widen)
6. r8brain 16→48kHz
7. `double[]` → `float[]` (narrow, back to pipeline)

#### Resampler Instances

- One `R8BrainResampler` for device→48kHz (created in `StartMic`, rate from device)
- One `R8BrainResampler` for 48kHz→16kHz (RNNoise down, if denoise enabled)
- One `R8BrainResampler` for 16kHz→48kHz (RNNoise up, if denoise enabled)

Instances are created once per mic session and disposed on `StopMic` or device change.

#### Scratch Buffers

Add `double[]` scratch buffers alongside existing `_wasapiFloatScratch` / `_wasapiMonoScratch`:
- `_resampleInScratch` (double[]) — input to r8brain
- `_resampleOutScratch` (double[]) — output from r8brain

Sized based on `maxInLen` at resampler creation time.

---

## 2. Opus Encoder Tuning

### Current State (`EncodePipeline.cs`)

```csharp
_encoder = new OpusEncoder(sampleRate, channels, application)
{
    Bitrate = bitrate,
    EnableForwardErrorCorrection = true,
    Vbr = false  // CBR — incorrect comment claims "matching Mumble"
};
```

Only 3 of 10+ available Opus CTL settings are configured.

### Changes to `OpusEncoder.cs`

Add CTL properties (get/set via `opus_encoder_ctl`):

| Property | CTL Set | CTL Get | Type |
|---|---|---|---|
| `Complexity` | 4010 | 4011 | int (0-10) |
| `SignalType` | 4024 | 4025 | enum: Auto=-1000, Voice=3001, Music=3002 |
| `Bandwidth` | 4008 | 4009 | enum: Narrowband=1101..Fullband=1105 |
| `PacketLossPercentage` | 4014 | 4015 | int (0-100) |
| `Dtx` | 4016 | 4017 | bool (0/1) |

### Changes to `EncodePipeline.cs`

New constructor parameters: `bool dtx` (replaces hardcoded value).

```csharp
_encoder = new OpusEncoder(sampleRate, channels, application)
{
    Bitrate = bitrate,
    EnableForwardErrorCorrection = true,
    Vbr = true,
    Complexity = 10,
    SignalType = SignalType.Voice,
    Bandwidth = Bandwidth.Fullband,
    PacketLossPercentage = 3,
    Dtx = dtx
};
```

### DTX per Transmission Mode

| Mode | DTX | Rationale |
|---|---|---|
| Push-to-Talk | `false` | User is always speaking when key is held |
| Voice Activity | `true` | Let Opus suppress detected silence |
| Continuous | `true` | Avoid encoding/sending constant silence |

`AudioManager` receives DTX setting from `MumbleAdapter` when transmission mode changes. This triggers an `EncodePipeline` recreation (same mechanism as frame size change).

---

## 3. Encoder Hot-Reload Fix

### Current State

- `SetOpusBitrate()` stores the value but does NOT recreate the pipeline (applies via CTL at runtime — this works)
- `SetOpusFrameMs()` calls `RecreateEncodePipelineLocked()` — disposes old, creates new
- No explicit handling of sequence number continuity or audio gap

### Problem

When changing bitrate, the new value is stored in `_opusBitrate` but only applied to the encoder via CTL if the encoder exists. If the pipeline is `null` (mic not started), the setting is picked up on next `StartMic`. However, if the bitrate CTL call fails silently or the Application mode should change (crossing the 32kbps threshold changes VOIP↔Audio), the encoder is in an inconsistent state.

### Solution

Unify all Opus settings changes through `RecreateEncodePipelineLocked()`:

1. **Any Opus setting change** (bitrate, frame size, DTX) → full pipeline teardown + rebuild
2. **Sequence number preservation** — extract current sequence from old pipeline before dispose, pass to new pipeline constructor
3. **Buffer flush** — old pipeline's PCM accumulator is discarded (partial frame lost, ~0-20ms)
4. **No explicit mute** — the gap from dispose→create is <1ms (synchronous, under lock), no audible artifact expected. If testing reveals a glitch, add a single silence frame.

### Implementation

In `AudioManager`:
```
RecreateEncodePipelineLocked():
  1. long seq = _encodePipeline?.CurrentSequence ?? 0
  2. _encodePipeline?.Dispose()
  3. _encodePipeline = new EncodePipeline(
       sampleRate: 48000, channels: 1, bitrate: _opusBitrate,
       frameSize: frameSizeFromMs, dtx: _dtxEnabled,
       onPacketReady: ..., initialSequence: seq)
```

In `EncodePipeline`:
- Add `CurrentSequence` property (read-only, returns current varint sequence)
- Add `initialSequence` constructor parameter
- Add `Dispose()` implementation (if not already `IDisposable`)

In `MumbleAdapter.ApplySettings()`:
- `SetOpusBitrate()` now also calls `RecreateEncodePipelineLocked()`
- Transmission mode change → update DTX → `RecreateEncodePipelineLocked()`

---

## File Changes Summary

| File | Change |
|---|---|
| `lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs` | **NEW** — P/Invoke wrapper for r8brain |
| `lib/MumbleVoiceEngine/Audio/NativeMethods.r8brain.cs` | **NEW** — r8brain native method declarations |
| `lib/MumbleSharp/.../Opus/OpusEncoder.cs` | Add Complexity, SignalType, Bandwidth, PacketLossPercentage, Dtx properties |
| `lib/MumbleSharp/.../Opus/NativeMethods.cs` | Add CTL constants for new properties |
| `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` | Add dtx param, initialSequence param, CurrentSequence property, new Opus defaults |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | Replace inline linear resampling with R8BrainResampler, unify settings changes through RecreateEncodePipelineLocked |
| `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs` | Replace linear interpolation with R8BrainResampler for RNNoise path |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Pass DTX based on transmission mode, bitrate change triggers recreation |
| Native DLL | Ship `r8bsrc.dll` (Win64) alongside `opus.dll` |

---

## Testing

- **A/B comparison:** Record same mic input through old pipeline and new pipeline, compare spectrograms
- **PTT test:** Verify no audio glitch at key press/release boundaries
- **Settings change test:** Change bitrate and frame size mid-conversation, verify no audio breakage
- **RNNoise test:** Enable/disable denoise, verify quality improvement (not degradation)
- **Device sample rate test:** Test with devices at 44.1kHz, 48kHz, 96kHz capture rates
