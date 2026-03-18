# NetEQ Jitter Buffer — Design Spec (Phase 1+2)

**Date:** 2026-03-18
**Issue:** #324
**Scope:** Adaptive jitter buffer with packet loss concealment for Brmble voice chat
**Approach:** NetEQ-inspired, custom-built for Mumble protocol

---

## Problem Statement

The current `UserAudioPipeline` uses a simple `Queue<byte[]>` that decodes Opus packets eagerly on the network thread and buffers decoded PCM. This causes:

- **Popping** at packet boundaries due to lack of cross-fading between frames
- **Stutter** from out-of-order packets (queue cannot reorder) and fixed buffer sizing
- **Distortion** from missing packet loss concealment — silence is inserted instead of synthetic audio

## Goals

1. Eliminate popping, stutter, and distortion under real-world network conditions
2. Adaptive buffering that responds to changing jitter without manual tuning
3. Opus PLC integration for seamless packet loss handling
4. Clean, testable architecture that serves as foundation for future WSOLA time-stretching (phase 3)
5. Differentiate Brmble audio quality from vanilla Mumble

## Non-Goals (This Phase)

- WSOLA time-stretching (phase 3 — separate issue)
- Comfort noise generation / DTX handling (phase 4 — separate issue)
- Metrics dashboard in the UI (phase 4)

---

## Architecture

### Library Structure

A new `Brmble.Audio` project, separate from `Brmble.Client`, for isolation and testability.

```
src/Brmble.Audio/
├── Brmble.Audio.csproj
├── NetEQ/
│   ├── JitterBuffer.cs          — public API, orchestrator
│   ├── PacketBuffer.cs          — priority queue for encoded packets
│   ├── DelayManager.cs          — relative delay + histogram → target_level
│   ├── DecisionLogic.cs         — state machine: Normal/Expand/Accelerate/Decelerate
│   ├── SyncBuffer.cs            — circular buffer for decoded PCM
│   ├── PlayoutTimer.cs          — dedicated high-res timer thread (20ms tick)
│   └── Models/
│       ├── EncodedPacket.cs     — timestamp, sequence, payload
│       └── PlayoutDecision.cs   — enum + metadata per tick
├── Codecs/
│   └── IOpusDecoder.cs          — interface for Opus decode + PLC
└── Diagnostics/
    └── JitterBufferStats.cs     — telemetry (buffer level, PLC rate, late packets)
```

### Public API

```csharp
public class JitterBuffer : IDisposable
{
    // Network thread calls this on incoming packet
    void InsertPacket(EncodedPacket packet);

    // PlayoutTimer calls this every 20ms
    // ALWAYS returns exactly 960 samples (20ms @ 48kHz mono)
    short[] GetAudio();

    // Diagnostics
    JitterBufferStats GetStats();

    // Lifecycle
    void Start();
    void Stop();
}
```

One `JitterBuffer` instance per speaker. `AudioManager` creates one per user, replacing the current `UserAudioPipeline`.

---

## Component Design

### 1. PacketBuffer

Stores encoded (not decoded) Opus packets, sorted by timestamp.

**Data structure:** `SortedList<long, EncodedPacket>` keyed on timestamp.

**`EncodedPacket` model:**
```csharp
public record EncodedPacket(
    long Sequence,          // Mumble sequence counter
    long Timestamp,         // Derived: Sequence × 960 (samples per frame)
    byte[] Payload,         // Opus-encoded data
    long ArrivalTimeMs      // Local clock at receipt
);
```

**Behavior:**
- Thread-safe via `lock` (one producer: network thread, one consumer: playout thread)
- Rejects duplicates (same sequence)
- Rejects stale packets (sequence < last_decoded - threshold)
- Maximum capacity: 500ms of packets (~25 frames)
- `TryGetNext(long expectedTimestamp)` — returns matching packet or `null`
- On `InsertPacket`: also updates `DelayManager` with arrival time

**Why `SortedList` instead of `Queue`:**
The current `Queue<byte[]>` cannot reorder — if packet 5 arrives before packet 4, they play in wrong order. A sorted structure on timestamp resolves this, directly fixing stutter and distortion.

### 2. DelayManager

Determines the ideal buffer size (`target_level`) based on measured network jitter.

**Relative delay calculation:**

For each incoming packet:
```
iat = arrival_ms - (timestamp / 48000 × 1000)
relative_delay = iat - min(iat in sliding window)
```

The "fastest" packet in the window is the anchor (0ms delay). All other packets are expressed as offset from it. This is more robust than inter-arrival delay because it correctly detects accumulating delay.

**Histogram with forget factor:**

- Buckets in units of 20ms (one frame)
- `forget_factor = 0.9993` per packet — older measurements gradually weigh less
- Buffer shrinks quickly when network improves
- `target_level` = 95th percentile of the histogram

**Bounds:**
- Minimum: 1 frame (20ms) — always buffer at least one frame ahead
- Maximum: 15 frames (300ms) — cap to limit latency
- Sliding window: 2 seconds of packets

### 3. DecisionLogic

State machine that decides per 20ms tick what action to take.

**Flow:**
```
GetAudio() call
    │
    ▼
┌─────────────────────────────┐
│ PCM remaining in SyncBuffer │──Yes──► Return 20ms PCM
│ from previous decode?       │
└──────────┬──────────────────┘
           │ No
           ▼
┌─────────────────────────────┐
│ Expected packet available   │
│ in PacketBuffer?            │
└──────┬──────────┬───────────┘
       │ Yes      │ No
       ▼          ▼
   ┌────────┐  ┌──────────────────┐
   │ Decode │  │ EXPAND           │
   │ Opus   │  │ opus_decode(NULL)│
   └───┬────┘  │ = PLC audio      │
       │       └──────────────────┘
       ▼
┌─────────────────────────────────┐
│ buffer_level vs target_level    │
│                                 │
│ buffer > target + 2 frames?     │
│   → ACCELERATE (drop 1 frame,  │
│     cross-fade boundaries)      │
│                                 │
│ buffer < target - 2 frames?     │
│   → DECELERATE (repeat frame    │
│     with cross-fade)            │
│                                 │
│ Otherwise:                      │
│   → NORMAL (play decoded frame) │
└─────────────────────────────────┘
```

**Decisions:**
- **Normal** — decode packet, output at normal speed
- **Expand (PLC)** — no packet available, use `opus_decode(NULL)` to generate synthetic audio
- **Accelerate** — buffer too full, drop one frame with linear cross-fade at boundaries (2ms overlap)
- **Decelerate** — buffer too low, repeat last frame with cross-fade
- **Merge** — transition from PLC back to real audio, cross-fade between PLC output and new decoded frame to prevent clicks

Phase 3 will replace the simple cross-fade in Accelerate/Decelerate with WSOLA for inaudible time-stretching.

### 4. SyncBuffer

Circular buffer for decoded PCM samples. Holds output from decode or PLC operations. `GetAudio()` reads 960 samples (20ms) per tick from this buffer.

Capacity: 4 frames (80ms) — enough to hold decoded output while the playout timer consumes it.

### 5. PlayoutTimer

Dedicated high-priority thread that drives the playout loop.

**Design:**
- `Thread` with `ThreadPriority.AboveNormal`
- `Stopwatch`-based timing loop targeting 20ms intervals
- Each tick: calls `GetAudio()` on all active `JitterBuffer` instances, mixes output, writes to ring buffer
- Mixing: sample-by-sample addition with clipping

### 6. IOpusDecoder

```csharp
public interface IOpusDecoder : IDisposable
{
    short[] Decode(byte[] encodedData);   // normal decode
    short[] DecodePlc();                   // packet loss concealment
}
```

Wrapper around MumbleSharp's `OpusDecoder`. The interface enables unit testing with mock decoders.

---

## Threading Model

```
┌──────────────────────────────────────────────────────┐
│  Network thread (MumbleSharp)                        │
│                                                      │
│  EncodedVoice() ──► JitterBuffer.InsertPacket()      │
│                     (lock on PacketBuffer)            │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  PlayoutTimer thread (dedicated, high-priority)      │
│                                                      │
│  Every 20ms:                                         │
│    for each active JitterBuffer:                     │
│      samples[user] = buffer.GetAudio()  // 960 PCM   │
│                                                      │
│    mixed = Mix(samples)  // sample-by-sample add     │
│    ringBuffer.Write(mixed)                           │
│                                                      │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  NAudio WaveOutEvent callback                        │
│                                                      │
│  Read() ──► ringBuffer.Read()                        │
│             (lock-free ring buffer between timer      │
│              and audio device)                        │
└──────────────────────────────────────────────────────┘
```

**Key change from current architecture:**
- Per-user `WaveOutEvent` → single `WaveOutEvent` for mixed output
- Decode moves from network thread to playout thread (required for Opus PLC state)
- Lock-free ring buffer between `PlayoutTimer` and NAudio callback (~100ms capacity / 5 frames)

---

## Integration with Existing Code

### Changes to `AudioManager`
- `UserAudioPipeline` replaced by `JitterBuffer` per user
- `EncodePipeline` (mic → Opus encode → send) remains unchanged
- Per-user `WaveOutEvent` replaced by single `WaveOutEvent` on mixed output
- `PlayoutTimer` owned by `AudioManager`, which also contains the mixer

### Changes to `MumbleAdapter`
- `EncodedVoice()` creates `EncodedPacket` (with `ArrivalTimeMs`) and calls `JitterBuffer.InsertPacket()`
- Sequence number mapping: Mumble's sequence counter × 960 = timestamp in samples

### IOpusDecoder Implementation
- Wraps MumbleSharp's existing `OpusDecoder`
- PLC via `opus_decode(decoder, NULL, 0, pcm, frame_size, 0)`

---

## Diagnostics

`JitterBufferStats` exposes per-buffer metrics:

| Metric | Description |
|--------|-------------|
| `BufferLevel` | Current number of frames in PacketBuffer |
| `TargetLevel` | Current target delay in frames |
| `TotalFrames` | Total GetAudio() calls |
| `NormalFrames` | Frames decoded normally |
| `ExpandFrames` | Frames generated by PLC |
| `AccelerateFrames` | Frames dropped (buffer too full) |
| `DecelerateFrames` | Frames repeated (buffer too low) |
| `LatePackets` | Packets arrived after their playout time |
| `DuplicatePackets` | Duplicate packets rejected |

Exposed via bridge message `voice.jitterStats` for optional frontend debugging.

---

## Testing Strategy

All core components are testable in isolation via `IOpusDecoder` mock:

- **PacketBuffer:** insertion, ordering, duplicate rejection, stale packet rejection, capacity limits
- **DelayManager:** relative delay calculation, histogram updates, target level convergence, forget factor behavior
- **DecisionLogic:** state transitions for all scenarios (normal, expand, accelerate, decelerate, merge)
- **JitterBuffer (integration):** end-to-end with simulated network conditions (jitter, loss, reordering, bursts)
- **PlayoutTimer:** timing accuracy verification

Test project: `tests/Brmble.Audio.Tests/`

---

## Follow-Up Issues

To be created after this phase ships:

1. **Phase 3: WSOLA Time-Stretching** — Pitch detection via autocorrelation, Waveform Similarity Overlap-Add for accelerate/decelerate, replacing the simple cross-fade. This enables inaudible speed adjustment.
2. **Phase 4: Comfort Noise & Polish** — CNG generation during DTX silences, tuning of forget factor / percentile / min-max delay, metrics dashboard in frontend, extended diagnostics.

---

## References

- [WebRTC NetEQ source](https://chromium.googlesource.com/external/webrtc/+/HEAD/modules/audio_coding/neteq/)
- [webrtcHacks deep dive (June 2025)](https://webrtchacks.com/how-webrtcs-neteq-jitter-buffer-provides-smooth-audio/)
- [ACM paper: Improved Jitter Buffer Management](https://dl.acm.org/doi/fullHtml/10.1145/3410449)
- [libopus PLC docs](https://opus-codec.org/docs/opus_api-1.5/group__opus__decoder.html)
- [Mumble audio pipeline reference](https://github.com/mumble-voip/mumble)
