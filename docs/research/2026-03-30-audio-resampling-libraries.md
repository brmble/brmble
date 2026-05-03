# Audio Resampling Libraries for C#/.NET -- Research Report

**Date:** 2026-03-30
**Context:** Brmble voice chat -- real-time resampling for device rates to 48kHz, and 48kHz to 16kHz (and back) for noise suppression
**Current implementation:** Naive linear interpolation in `AudioResampler.cs` (no anti-aliasing filter, lowest quality)

---

## Quality Tier Rankings (Best to Worst)

Based on Infinite Wave SRC Comparisons (src.infinitewave.ca), lastique benchmarks, libsamplerate quality tests, and audio engineering community consensus:

### Tier 1: Audiophile / Professional Grade
| Library | Stop-band Atten. | Passband | Latency | Notes |
|---------|-----------------|----------|---------|-------|
| **SoX/libsoxr (VHQ)** | >180 dB | ~99.5% Nyquist | ~20ms at 48kHz | Gold standard for quality. Cubase 10+ uses SoX SRC. |
| **r8brain-free-src** | 49-218 dB (configurable) | 0.5%-45% transition band | Configurable | Voxengo pro audio. Used in foobar2000, REAPER via plugin. |
| **libsamplerate (Best Sinc)** | ~145 dB | ~96.6% bandwidth | Moderate | Original "Secret Rabbit Code". Reference quality. |

### Tier 2: High Quality / Real-Time Suitable
| Library | Stop-band Atten. | Passband | Latency | Notes |
|---------|-----------------|----------|---------|-------|
| **SoX/libsoxr (HQ)** | ~150 dB | ~98% Nyquist | ~10ms | Best balance of quality + speed for real-time. |
| **zita-resampler** | High | High | Low | Claims faster than libsamplerate at same quality. Linux-focused. |
| **WDL Resampler (Cockos)** | Good | Good | Low | REAPER's engine. Quality level 1-60. |
| **libsamplerate (Medium Sinc)** | ~120 dB | ~96.6% | Lower | Good balance for real-time. |

### Tier 3: Acceptable for Voice
| Library | Stop-band Atten. | Passband | Latency | Notes |
|---------|-----------------|----------|---------|-------|
| **SpeexDSP (quality 10)** | Moderate | Moderate | Very low | Used by Mumble, PulseAudio, ALSA. Known distortion issues at some ratios. |
| **WebRTC sinc resampler** | Moderate | Good | Very low | Used by Chrome/WebRTC. Optimized for voice specifically. |
| **SpeexDSP (quality 5)** | Low-Moderate | Moderate | Very low | Default for many apps. |

### Tier 4: Low Quality (avoid)
| Library | Notes |
|---------|-------|
| **Linear interpolation** | **<-- Brmble's current approach.** No anti-aliasing. Significant aliasing artifacts on downsampling. |
| **SpeexDSP (quality 1)** | Barely better than linear. |
| **Nearest-neighbor** | Worst possible. |

---

## Detailed Library Analysis for Brmble

### 1. libsoxr (SoX Resampler) -- RECOMMENDED

**Quality:** Best-in-class. Infinite Wave ranks SoX among the top resamplers alongside commercial DAW implementations.
**Performance:** Significantly faster than libsamplerate at equivalent quality. The HQ preset offers ~150 dB stopband rejection with ~10ms latency -- ideal for real-time voice.
**Integration:**
- C library with simple API (`soxr_create`, `soxr_process`, `soxr_delete`)
- No existing C# NuGet wrapper (SoxSharp wraps the SoX CLI tool, not libsoxr)
- P/Invoke is straightforward: ~5 functions to wrap
- Pre-built DLLs available, or compile from source (CMake)
- MIT-like license (LGPL for some optional components)

**Pros:**
- Highest quality at reasonable CPU cost
- Configurable quality/latency tradeoff (LQ/MQ/HQ/VHQ)
- Proven in professional audio (Cubase, Audacity, many Linux audio stacks)
- Simple, stateless-ish API (create context, feed samples, destroy)
- Handles arbitrary ratio conversions cleanly

**Cons:**
- Requires shipping native DLL (~200KB)
- No official .NET wrapper (must write ~50 lines of P/Invoke)
- ~20ms latency at VHQ (use HQ for real-time, which is ~10ms)
- Project maintenance is slow (last release 0.1.3 in 2018), but the code is mature and stable

**Verdict:** Best option for Brmble. HQ mode gives professional-grade quality with acceptable real-time latency.

---

### 2. r8brain-free-src -- STRONG ALTERNATIVE

**Quality:** Among the best. Configurable stop-band attenuation up to 218 dB. Used by Voxengo (professional mastering plugin developer).
**Performance:** Very fast. SSE2/AVX2/NEON optimized. Header-only C++ with pre-built Windows DLL.
**Integration:**
- **Pre-built Windows DLL included in the repo** (`r8bsrc.dll`) with C interface
- **Existing C# P/Invoke wrapper exists** (VVVV.Audio project, ~250 lines, proven code)
- Only 5 P/Invoke functions: `r8b_create`, `r8b_delete`, `r8b_process`, `r8b_clear`, `r8b_get_latency`
- MIT license

**Pros:**
- Excellent quality, arguably on par with libsoxr VHQ
- Pre-built DLL ships with the project (Win32/Win64, with AVX2 auto-dispatch)
- Battle-tested C# P/Invoke wrapper already exists to copy from
- Very low API surface -- easy to wrap and maintain
- Active development (version 5.x as of 2024)
- Designed explicitly for real-time use ("pull" mode)
- Header-only C++ if you ever need to compile custom

**Cons:**
- DLL compiled with Intel IPP (proprietary) for best performance; without IPP it uses PFFFT (still fast)
- Works with double-precision samples (need float<->double conversion)
- Less widely known than libsoxr (smaller community)
- Latency depends on quality settings and ratio

**Verdict:** Easiest high-quality integration for Brmble. The existing C# wrapper code makes this nearly drop-in.

---

### 3. NAudio WdlResamplingSampleProvider -- ALREADY IN YOUR STACK

**Quality:** Good but not great. Based on Cockos WDL resampler (REAPER's engine). Quality level 1-60.
**Performance:** Fully managed C#, so slower than native but adequate for voice.
**Integration:**
- Already a dependency via NAudio
- `new WdlResamplingSampleProvider(source, targetRate)` -- one line
- Works with ISampleProvider/IWaveProvider pipeline

**Pros:**
- Zero additional dependencies (NAudio already in project)
- Fully managed -- no native DLL to ship
- Well-tested, widely used in .NET audio projects
- Simple API that fits NAudio pipeline
- Cross-platform (no Windows-only dependencies)

**Cons:**
- Quality is mid-tier (good enough for voice, not audiophile)
- Known issues with certain sample rate ratios (e.g., 16kHz to 44.1kHz)
- ISampleProvider interface may not fit your buffer-based pipeline
- Performance overhead vs native (matters less for voice than music)
- Mark Heath (NAudio author) himself recommends it mainly as a fallback when MediaFoundationResampler is unavailable

**Verdict:** Fastest path to improvement over linear interpolation. Good enough for voice, but not the best available.

---

### 4. SpeexDSP Resampler -- ALREADY SHIPPING

**Quality:** Moderate at quality 10. Known distortion issues (documented in PulseAudio bug reports for 44.1kHz<->48kHz conversion).
**Performance:** Very fast, very low latency. Designed for real-time voice.
**Integration:**
- `speexdsp.dll` is **already in your project** (in `lib/MumbleVoiceEngine/Native/`)
- Mumble uses this resampler
- Concentus (pure C# Opus) includes a managed port of the Speex resampler
- P/Invoke: `speex_resampler_init`, `speex_resampler_process_float`, `speex_resampler_destroy`

**Pros:**
- Already shipping with Brmble (zero new dependencies)
- Extremely low latency
- Used by Mumble, PulseAudio, ALSA, Android audio
- Quality 10 is acceptable for voice
- Well-documented API

**Cons:**
- Documented distortion issues at certain ratios (44.1k<->48k is notably problematic)
- Quality 10 still measurably worse than libsoxr HQ or r8brain
- 48kHz<->16kHz (3x ratio) may show more artifacts than small-ratio conversions
- Cubic interpolation approach has inherent quality ceiling

**Verdict:** Pragmatic choice since it's already present. But for the 48kHz<->16kHz noise suppression path, a higher-quality resampler would be noticeably better.

---

### 5. Concentus SpeexDSP Resampler (Managed C#)

**Quality:** Same as SpeexDSP (it's a direct port).
**Performance:** ~40-50% speed of native SpeexDSP due to managed overhead.
**Integration:**
- NuGet: `Concentus` (includes Opus codec + Speex resampler)
- Pure C#, no native dependencies

**Pros:**
- Pure managed, cross-platform
- Bit-exact with native Speex resampler
- Comes bundled with Opus codec

**Cons:**
- Same quality limitations as native SpeexDSP
- Slower than native (managed array overhead)
- Opus codec is redundant if you already have opus.dll

**Verdict:** Only useful if you want to eliminate all native dependencies. Not recommended given Brmble already uses native opus.dll.

---

### 6. NWaves Resampler (Managed C#)

**Quality:** Research-grade. Band-limited resampling with anti-aliasing filtering.
**Performance:** Managed C#, designed for offline/research use.
**Integration:**
- NuGet: `NWaves` (0.9.6)
- `Resampler.Resample(signal, newRate)` or buffer-based overloads

**Pros:**
- Pure managed C#
- Good documentation and educational code
- Multiple resampling modes (decimation, interpolation, band-limited)

**Cons:**
- Designed for research/education, not real-time production
- Performance not optimized for real-time
- Quality is acceptable but not comparable to libsoxr/r8brain
- Small user base for production voice applications

**Verdict:** Not recommended for Brmble's real-time requirements.

---

### 7. MediaFoundationResampler (Windows API)

**Quality:** Good. Microsoft's built-in resampler, quality level 1-60.
**Performance:** Native Windows, hardware-accelerated on some systems.
**Integration:**
- Available through NAudio: `new MediaFoundationResampler(source, targetFormat)`
- Windows Vista+ only (fine for Brmble)

**Pros:**
- No additional DLLs -- uses Windows built-in codec
- Good quality at highest setting
- Well-integrated with NAudio

**Cons:**
- Windows-only (not a concern for Brmble today, but limits future portability)
- COM-based -- thread affinity concerns with WebView2 app
- "Desktop Experience" required on Windows Server
- Harder to use in buffer-based (non-streaming) pipeline

**Verdict:** Viable but the COM/threading model makes it risky in Brmble's Win32+WebView2 architecture.

---

## What Other Voice Apps Use

| Application | Resampler | Notes |
|------------|-----------|-------|
| **Mumble** | SpeexDSP | Quality 3-10 depending on configuration |
| **Discord** | Proprietary / WebRTC-based | Internal stack not publicly documented; uses 48kHz Opus throughout |
| **WebRTC (Chrome)** | Custom sinc resampler | Derived from Speex concepts but custom implementation |
| **PulseAudio** | SpeexDSP | Known quality issues, considering alternatives |
| **PipeWire** | Custom (based on Speex concepts) | Improved implementation |
| **REAPER** | WDL Resampler (Cockos) | Quality 60 mode |
| **Audacity** | libsoxr | Switched from libsamplerate for better performance |
| **foobar2000** | r8brain (via plugin), SoX | Multiple options available |

---

## Recommendation for Brmble

### Short-term (immediate improvement):
**Use NAudio WdlResamplingSampleProvider** in `AudioResampler.cs`. This replaces your linear interpolation with a proper anti-aliased sinc resampler using zero new dependencies. Quality jump from Tier 4 to Tier 2.

### Medium-term (best quality):
**Integrate r8brain via P/Invoke**. The existing C# wrapper from VVVV.Audio makes this straightforward. Ship `r8bsrc.dll` alongside your existing `opus.dll` and `speexdsp.dll`. Quality jump to Tier 1.

### Alternative medium-term:
**Integrate libsoxr HQ via P/Invoke**. Slightly more work than r8brain (need to build DLL from source or find pre-built), but arguably the most proven resampler in the open-source audio world.

### For the noise suppression path specifically (48kHz <-> 16kHz):
This is a 3:1 ratio, which is one of the "easier" ratios for resamplers (integer relationship). Even SpeexDSP quality 10 should handle this adequately. However, the round-trip (down then up) amplifies any artifacts. A Tier 1 resampler here will produce noticeably cleaner results.

---

## Sources

- [Infinite Wave SRC Comparisons](https://src.infinitewave.ca/) -- comprehensive spectrogram database
- [Audio sample rate converters comparison (lastique)](https://lastique.github.io/src_test/) -- Speex vs SoXR benchmarks
- [r8brain-free-src GitHub](https://github.com/avaneev/r8brain-free-src) -- library source and DLL
- [VVVV.Audio R8BrainSampleRateConverter.cs](https://github.com/tebjan/VVVV.Audio/blob/master/Source/VVVV.Audio.Signals/Filters/R8BrainSampleRateConverter.cs) -- existing C# P/Invoke wrapper
- [NAudio Resampling Documentation](https://github.com/naudio/NAudio/blob/master/Docs/Resampling.md)
- [NAudio WDL Resampler article (Mark Heath)](https://www.markheath.net/post/fully-managed-input-driven-resampling-wdl)
- [libsamplerate Quality](https://libsndfile.github.io/libsamplerate/quality.html)
- [libsoxr GitHub](https://github.com/chirlu/soxr)
- [SpeexDSP Resampler (DeepWiki)](https://deepwiki.com/xiph/speexdsp/2.3-resampler)
- [Mumble Resample.cpp](https://github.com/mumble-voip/mumble/blob/master/src/tests/Resample.cpp)
- [Concentus (managed Opus + Speex)](https://github.com/lostromb/concentus)
- [NWaves .NET DSP library](https://github.com/ar1st0crat/NWaves)
- [CSCore .NET Audio Library](https://github.com/filoe/cscore)
