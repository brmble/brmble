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
    // Constructor — each JitterBuffer owns its own IOpusDecoder instance.
    // The decoder MUST be exclusive to this buffer (Opus PLC is state-dependent).
    JitterBuffer(IOpusDecoder decoder);

    // Network thread calls this on incoming packet
    void InsertPacket(EncodedPacket packet);

    // PlayoutTimer calls this every 20ms
    // Writes exactly 960 samples into the provided buffer (20ms @ 48kHz mono)
    // The caller owns the buffer to avoid GC pressure on the audio thread.
    void GetAudio(Span<short> output);

    // Per-user volume (0.0 – 1.0). Applied during GetAudio() before output.
    float Volume { get; set; }

    // Diagnostics
    JitterBufferStats GetStats();

    // Lifecycle
    void Start();
    void Stop();
}
```

One `JitterBuffer` instance per speaker. `AudioManager` creates one per user, replacing the current `UserAudioPipeline`. Each `JitterBuffer` owns its `IOpusDecoder` — this is required because Opus PLC depends on the decoder's internal state from previous frames. The decoder is disposed when the `JitterBuffer` is disposed.

---

## Component Design

### 1. PacketBuffer

Stores encoded (not decoded) Opus packets, sorted by timestamp.

**Data structure:** `SortedList<long, EncodedPacket>` keyed on timestamp. Note: `SortedList` has O(n) insert due to array shifting, but at a maximum capacity of ~25 frames this is negligible. `SortedDictionary` (O(log n) insert) was considered but loses cache locality and ordered enumeration efficiency at this small size.

**`EncodedPacket` model:**
```csharp
public record EncodedPacket(
    long Sequence,          // Mumble sequence counter
    long Timestamp,         // Derived: Sequence × 960 (samples per frame)
    byte[] Payload,         // Opus-encoded data
    long ArrivalTimeMs      // Local clock at receipt (Stopwatch.GetElapsedTime())
);
```

**Mumble sequence number edge cases:**
- **Sequence resets:** Mumble may reset sequence numbers on reconnect or new speech burst. Detect large backward jumps (e.g., > 100 frames) and reset the buffer state (flush PacketBuffer, reset DelayManager histogram).
- **Multi-frame packets:** Some Mumble encodings pack multiple frames per packet. For Opus this is uncommon but possible — if detected, split into individual `EncodedPacket` entries with sequential timestamps.
- **First packet after silence:** The first packet of a new speech burst should reset the expected timestamp tracker rather than being treated as "late".

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
- **Accelerate** — buffer too full, drop one frame with linear cross-fade at boundaries
- **Decelerate** — buffer too low, repeat last frame with cross-fade
- **Merge** — transition from PLC back to real audio, cross-fade between PLC output and new decoded frame to prevent clicks

**Cross-fade pseudocode (Accelerate/Decelerate/Merge):**
```
overlap_samples = 96  // 2ms at 48kHz
for i in 0..overlap_samples:
    alpha = i / overlap_samples           // 0.0 → 1.0
    output[i] = (short)(outgoing[i] * (1 - alpha) + incoming[i] * alpha)
```
For **Accelerate**: decode two frames, cross-fade the tail of frame 1 with the head of frame 2, output one combined frame (960 samples). The extra frame is consumed, shrinking the buffer.
For **Decelerate**: output current frame, then cross-fade its tail with a repeated copy of itself, producing one extra frame of output. The buffer grows by one frame.
For **Merge**: cross-fade the last PLC frame with the first real decoded frame.

Phase 3 will replace the simple cross-fade in Accelerate/Decelerate with WSOLA for inaudible time-stretching.

### 4. SyncBuffer

Circular buffer for decoded PCM samples. Holds output from decode or PLC operations. `GetAudio()` reads 960 samples (20ms) per tick from this buffer.

Capacity: 4 frames (80ms) — enough to hold decoded output while the playout timer consumes it.

### 5. PlayoutTimer

Dedicated high-priority thread that drives the playout loop.

**Design:**
- `Thread` with `ThreadPriority.AboveNormal`
- `Stopwatch`-based timing loop targeting 20ms intervals with drift compensation: track cumulative expected time vs actual elapsed time, adjusting each sleep to stay aligned with the 20ms grid
- Each tick: calls `GetAudio()` on all active `JitterBuffer` instances, mixes output, writes to ring buffer
- Mixing: sample-by-sample addition with `Math.Clamp` to `short.MinValue`/`short.MaxValue`
- Per-user volume is applied inside `JitterBuffer.GetAudio()` before returning samples

**Ring buffer (PlayoutTimer → NAudio):**
- Lock-free single-producer single-consumer circular buffer
- Capacity: 100ms (5 × 960 samples = 4800 samples)
- PlayoutTimer writes mixed PCM each tick; NAudio callback reads on demand
- If NAudio reads faster than writes (underrun): output silence. If writes overtake reads (overrun): drop oldest samples. Both conditions are logged in stats.

### 6. IOpusDecoder

```csharp
public interface IOpusDecoder : IDisposable
{
    // Decode encoded Opus data into PCM samples.
    // Writes into the provided span to avoid allocation.
    // Returns number of samples written.
    int Decode(ReadOnlySpan<byte> encodedData, Span<short> output);

    // Generate PLC audio (packet loss concealment).
    // Uses decoder internal state from previous frames.
    // Returns number of samples written.
    int DecodePlc(Span<short> output);
}
```

The implementation wraps MumbleSharp's `OpusDecoder`, adapting its `byte[]`-based API to the `Span<short>` interface (MumbleSharp decodes to `byte[]` which is reinterpreted as `short[]`). Each `JitterBuffer` owns its decoder instance exclusively — sharing decoders would corrupt PLC state. The interface enables unit testing with mock decoders.

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
- **Per-user volume and local mute:** Preserved via `JitterBuffer.Volume` property. Setting volume to 0.0 effectively mutes a user. The current per-user volume functionality maps directly to this property.
- **Deafen:** When self-deafened, `AudioManager` stops reading from the ring buffer (outputs silence to NAudio) rather than stopping individual buffers. This preserves jitter buffer state so audio resumes cleanly when undeafened.
- **Speaking detection:** `JitterBuffer` exposes an `IsSpeaking` property based on whether `GetAudio()` returned real audio (Normal/Accelerate/Decelerate) vs silence/PLC in the last N ticks. `AudioManager` polls this to emit `voice.userSpeaking`/`voice.userSilent` bridge events, replacing the current detection in `UserAudioPipeline`.

### User Lifecycle
- **User joins channel:** `AudioManager` creates a new `JitterBuffer` with a fresh `IOpusDecoder` instance
- **User leaves channel:** `AudioManager` disposes the `JitterBuffer` (which disposes the decoder)
- **Reconnect:** All `JitterBuffer` instances are disposed and recreated — no state carries over between connections
- **User starts speaking after silence:** First packet triggers a buffer reset (see "First packet after silence" in PacketBuffer section)

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
