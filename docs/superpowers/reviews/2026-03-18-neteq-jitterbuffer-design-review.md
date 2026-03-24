# Design Review: NetEQ Jitter Buffer (Phase 1+2)

**Spec:** `docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md`
**Reviewer:** Code Review Agent
**Date:** 2026-03-18

---

## Overall Assessment

This is a well-structured, thoroughly researched design spec. The NetEQ-inspired architecture is a sound approach for replacing the naive `Queue<byte[]>` pipeline with proper adaptive buffering. The problem statement accurately describes the current codebase's limitations, and the component breakdown maps cleanly to the existing code. The spec is largely implementable as-written, with several issues that should be addressed before implementation begins.

---

## Critical Issues

### C1. Per-User Volume and Local Mute Not Addressed in Integration Plan

The current `AudioManager.FeedVoice()` supports per-user volume (`_userVolumes` dictionary, `pipeline.Volume`) and local mutes (`_localMutes` HashSet). The spec's move to a single mixed `WaveOutEvent` eliminates the per-user `WaveOutEvent` where volume was applied via `UserAudioPipeline.Volume`. The spec does not describe where per-user volume and local mute will be applied in the new architecture.

**Impact:** Loss of existing user-facing functionality (per-user volume sliders, local mute).

**Recommendation:** Add a section specifying that per-user volume scaling and local mute filtering must be applied during the mixing step in `PlayoutTimer`, before samples are summed. Each `JitterBuffer.GetAudio()` output should be scaled by the user's volume before mixing. Locally-muted users should be skipped entirely.

### C2. Opus Decoder State Affinity -- Moving Decode Thread Breaks PLC

The spec says "Decode moves from network thread to playout thread (required for Opus PLC state)." This is correct -- the Opus decoder is stateful and PLC requires calling decode with null on the same decoder instance that decoded previous packets. However, the spec does not address the critical implication: **the `IOpusDecoder` instance must be owned by `JitterBuffer`, not by the caller or by `AudioManager`**.

The current `MumbleVoiceEngine.Codec.OpusDecoder.Decode()` already supports PLC (its doc says "Set srcEncodedBuffer to null to instruct the decoder that a packet was dropped"). The spec's `IOpusDecoder` interface returns `short[]`, but the existing `OpusDecoder.Decode()` writes to a `byte[]` output buffer.

**Impact:** Interface mismatch with existing decoder; unclear lifecycle ownership could cause PLC to malfunction.

**Recommendation:** (a) Explicitly state that `JitterBuffer` owns and creates the `IOpusDecoder`. (b) Decide whether the `IOpusDecoder` wrapper will convert from `byte[]` to `short[]` internally or whether `SyncBuffer`/consumers will work with `byte[]`. The conversion has a cost per frame that should be acknowledged. (c) Document that the existing `OpusDecoder` already supports PLC via null input -- the wrapper just needs to expose it.

### C3. SortedList Has O(n) Insert -- Use SortedDictionary or Custom Structure

`PacketBuffer` uses `SortedList<long, EncodedPacket>`. `SortedList` has O(n) insertion in the worst case (it maintains a contiguous array). For a jitter buffer where packets frequently arrive out of order, this means every late packet triggers an array shift. With a max of 25 frames this is small, but it is still a design choice worth reconsidering.

**Impact:** Potential micro-stalls on the network thread under burst conditions.

**Recommendation:** Either (a) switch to `SortedDictionary<long, EncodedPacket>` for O(log n) insert, or (b) document why `SortedList` is acceptable given the small capacity (25 frames). Since the buffer is tiny, `SortedList` may actually be faster due to cache locality -- but this should be an explicit decision, not an oversight.

---

## Important Issues

### I1. Ring Buffer Between PlayoutTimer and NAudio Is Under-Specified

The spec mentions a "lock-free ring buffer between timer and audio device (~100ms capacity / 5 frames)" but does not specify:
- The concrete implementation (custom? existing library?)
- The exact locking/memory-barrier strategy for the single-producer single-consumer case
- What happens when the ring buffer is full (PlayoutTimer produces faster than NAudio consumes) or empty (NAudio starves)
- How the initial fill level is managed to prevent underrun at startup

**Recommendation:** Add a subsection describing the ring buffer design. For a single-producer, single-consumer scenario on .NET, a simple approach is a `byte[]` with two `volatile int` cursors (read/write head). Specify the underrun behavior (output silence) and overrun behavior (drop oldest). Also specify the initial pre-fill (e.g., 40ms / 2 frames) before NAudio starts reading.

### I2. Mumble Sequence Number to Timestamp Mapping Needs More Detail

The spec states: "Sequence number mapping: Mumble's sequence counter x 960 = timestamp in samples." However, Mumble's sequence counter behavior has nuances:
- The sequence counter in `EncodedVoice()` is a `long` that represents the Opus frame sequence number from the sending client.
- Mumble 1.5+ clients may send multi-frame packets (the existing `UserAudioPipeline.FeedEncodedPacket` already handles this via `OpusDecoder.GetSamples()`).
- The sequence counter may reset or have gaps when a user stops and restarts talking.

**Recommendation:** Add handling for: (a) sequence number wraps/resets (detect large backward jumps and reset the jitter buffer state), (b) multi-frame packets where one Mumble packet contains multiple Opus frames, (c) the initial packet after silence (first packet sets the baseline, no PLC for the gap before it).

### I3. Speaking Detection Integration Not Addressed

The current `AudioManager` has speaking detection logic: `_lastVoicePacket` dictionary, `_speakingTimer`, `SpeakingTimeoutMs`, and fires `SpeakingChanged` events that drive the UI (showing who is talking). The spec does not mention how this integrates with the new architecture.

**Recommendation:** Specify that `InsertPacket()` updates the speaking-detection timestamp, and that `AudioManager` continues to own the speaking timer. Alternatively, move speaking detection into `JitterBuffer` and expose it via `JitterBufferStats`.

### I4. User Lifecycle (Join/Leave/Reconnect) Not Covered

The current `AudioManager` has `RemoveUser(uint userId)` which disposes the pipeline and player for a departing user. The spec says "One JitterBuffer instance per speaker. AudioManager creates one per user" but does not cover:
- When a `JitterBuffer` is created (lazy on first packet? eager on user join?)
- When it is disposed (user leaves channel? user stops talking? idle timeout?)
- What happens if a user disconnects and reconnects (new JitterBuffer or reset existing?)

**Recommendation:** Add a lifecycle section. The natural approach is: create lazily on first `InsertPacket`, dispose on `RemoveUser`, and add a `Reset()` method for sequence discontinuities (user stops/starts talking).

### I5. Deafen Behavior Needs Specification

The current `AudioManager` implements deafen by disposing all user pipelines and players. With the new architecture (single `WaveOutEvent`, centralized mixer), deafen needs a different approach.

**Recommendation:** Specify that deafen stops all `JitterBuffer` instances (or skips them during mixing) and that the single `WaveOutEvent` stays alive but outputs silence. Packets received while deafened should be dropped at `InsertPacket` (as the spec does for the current `FeedVoice` which returns early if `_deafened`).

### I6. Cross-Fade Overlap for Accelerate/Decelerate Needs More Detail

The spec mentions "linear cross-fade at boundaries (2ms overlap)" for Accelerate and "repeat last frame with cross-fade" for Decelerate, but does not specify:
- Exactly which samples are overlapped (tail of frame N with head of frame N+1?)
- How the Decelerate repeat interacts with the SyncBuffer (is the repeated frame written to SyncBuffer, extending it?)
- Whether the cross-fade length (2ms = 96 samples at 48kHz) is configurable

This matters because incorrect cross-fading is the current source of popping -- getting this wrong defeats a primary goal.

**Recommendation:** Add pseudocode for both cross-fade operations, showing the exact sample-level math. For Accelerate: overlap the last 96 samples of the dropped frame with the first 96 samples of the next frame using linear interpolation. For Decelerate: copy the current frame, then cross-fade the last 96 samples of the copy with the first 96 samples of the original's end.

---

## Minor Issues / Suggestions

### S1. The Merge Decision Needs a Trigger Condition

The DecisionLogic lists a "Merge" decision for "transition from PLC back to real audio" but does not specify when it is triggered. Is it when: (a) the first real packet arrives after one or more Expand decisions? (b) only after N consecutive Expands? The flow diagram does not include Merge.

**Recommendation:** Add Merge to the flow diagram. The trigger should be: "previous decision was Expand AND expected packet is now available." The implementation cross-fades the last PLC output with the newly decoded real audio.

### S2. `GetAudio()` Returns `short[]` -- Consider Returning into a Caller-Provided Buffer

Allocating a new `short[960]` array every 20ms per user will create GC pressure. With 10 users, that is 500 allocations/second of 1920-byte arrays.

**Recommendation:** Consider `int GetAudio(Span<short> output)` or at minimum reuse a pre-allocated buffer per `JitterBuffer` instance. This is especially important since the playout timer is time-sensitive and GC pauses could cause audio glitches.

### S3. PlayoutTimer Stopwatch Drift Compensation

The spec says "Stopwatch-based timing loop targeting 20ms intervals" but does not specify how drift is handled. A naive `Thread.Sleep(20)` will accumulate drift.

**Recommendation:** Use the standard drift-compensation pattern: track `nextTickTime` and sleep for `max(0, nextTickTime - Stopwatch.Elapsed)`, advancing `nextTickTime += 20ms` each tick regardless of actual sleep duration.

### S4. Thread Priority May Be Insufficient on Windows

`ThreadPriority.AboveNormal` is a modest priority boost. For real-time audio on Windows, `ThreadPriority.Highest` or using MMCSS (`AvSetMmThreadCharacteristics("Pro Audio", ...)`) would provide better scheduling guarantees.

**Recommendation:** Consider MMCSS for the playout thread, or at minimum use `ThreadPriority.Highest`. Document the rationale for whichever choice is made.

### S5. Diagnostic Bridge Message Format Not Specified

The spec mentions `voice.jitterStats` bridge message but does not specify the JSON payload shape. Since the frontend will need to parse this, the format should be defined.

**Recommendation:** Add a sample JSON payload showing the fields from `JitterBufferStats` and whether stats are per-user or aggregated.

### S6. Maximum Delay Cap Inconsistency

The spec states PacketBuffer capacity is "500ms of packets (~25 frames)" but DelayManager maximum is "15 frames (300ms)". If the target can never exceed 300ms, packets beyond that are dead weight in the buffer.

**Recommendation:** Align these values. Either reduce PacketBuffer capacity to match the max target (e.g., 20 frames / 400ms to give some headroom above the 300ms target), or explain why the extra 200ms of buffer capacity is useful (e.g., for burst absorption before the delay manager reacts).

### S7. No Mention of Audio Device Switching

The current `AudioManager` does not appear to have dynamic device switching, but the move to a single `WaveOutEvent` makes this a future concern. If the user changes audio output device, the single `WaveOutEvent` would need to be recreated.

**Recommendation:** Acknowledge this as a known limitation or add a note about how device changes interact with the `PlayoutTimer` and ring buffer.

---

## What the Spec Does Well

- **Problem statement** accurately describes the real issues in the current `Queue<byte[]>` pipeline, validated against the actual `UserAudioPipeline` source code.
- **Component separation** is clean -- PacketBuffer, DelayManager, DecisionLogic, and SyncBuffer have clear single responsibilities.
- **Threading model** diagram is precise and correctly identifies the three threads involved.
- **Testing strategy** is practical -- the `IOpusDecoder` interface enables meaningful unit tests without native Opus dependencies.
- **Phased approach** (deferring WSOLA and comfort noise) is wise scope management.
- **The decision to store encoded packets** (not decoded PCM) is correct and well-justified -- this enables PLC and proper reordering.
- **References** are specific and relevant, not generic padding.

---

## Summary

| Category | Count |
|----------|-------|
| Critical | 3 |
| Important | 6 |
| Minor/Suggestions | 7 |

The three critical issues (per-user volume in the mixer, decoder ownership/interface mismatch, and SortedList performance characteristics) should be resolved in the spec before implementation begins. The important issues are implementation details that could be resolved during coding but would benefit from upfront design decisions, particularly the ring buffer design (I1) and user lifecycle management (I4). The minor suggestions are optimizations and polish that can be addressed iteratively.

**Verdict:** The spec is strong architecturally and would benefit from a revision pass addressing C1-C3 and I1-I4 before handing off to implementation.
