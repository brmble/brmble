# Plan Review: NetEQ Jitter Buffer Implementation

**Reviewer:** Claude Opus 4.6 (Senior Code Reviewer)
**Plan:** `docs/superpowers/plans/2026-03-18-neteq-jitterbuffer.md`
**Spec:** `docs/superpowers/specs/2026-03-18-neteq-jitterbuffer-design.md`
**Date:** 2026-03-18

---

## Verdict: Issues Found

The plan is thorough, well-structured, and demonstrates strong alignment with the design spec. The code is complete (no placeholders), follows TDD properly for core components, and task ordering is correct. However, there are several issues that need attention before an implementing agent can follow this plan without errors.

---

## What Was Done Well

- **Complete code for every task.** No "add validation here" or "TODO" placeholders. Every step has full, compilable code.
- **Correct TDD flow.** Tasks 4-9 all follow write-test-first, verify-failure, implement, verify-pass. Proper discipline.
- **Task ordering is sound.** Models and interfaces first, then components with no upstream dependencies, then orchestrator, then integration. No task depends on something not yet built.
- **Faithful to the spec.** PacketBuffer data structure choice, DelayManager histogram with forget factor, DecisionLogic state machine, cross-fade constants -- all match the design doc precisely.
- **Good test coverage.** 37 tests across 6 test classes covering core logic, edge cases, and integration scenarios.
- **Proper separation of concerns.** The `Brmble.Audio` library is fully independent of `Brmble.Client`, with the `IOpusDecoder` interface enabling clean testing.

---

## Critical Issues (Must Fix)

### C1: `ArrivalTimeMs` uses wrong property -- `Milliseconds` vs `TotalMilliseconds`

**File:** Plan Task 13, Step 4 (FeedVoice replacement code)
**Line in plan:** ~2139

```csharp
ArrivalTimeMs: Stopwatch.GetElapsedTime(_startTimestamp).Milliseconds
```

`TimeSpan.Milliseconds` returns only the millisecond component (0-999), NOT the total elapsed milliseconds. After 1 second, this wraps to 0. This will completely break DelayManager's relative delay calculation.

**Fix:** Use `(long)Stopwatch.GetElapsedTime(_startTimestamp).TotalMilliseconds` or track a `Stopwatch` instance and use `sw.ElapsedMilliseconds`.

Additionally, `_startTimestamp` is not defined anywhere in the plan. The plan needs to specify where this field is declared and initialized (likely `private readonly long _startTimestamp = Stopwatch.GetTimestamp();` as a field on AudioManager).

### C2: `stackalloc` in JitterBuffer.GetAudio may cause stack overflow with recursive/deep call chains

**File:** Plan Task 9, Step 3 (JitterBuffer.cs implementation)
**Lines in plan:** ~1582, 1600, 1614

The `GetAudio` method uses `stackalloc short[960]` (1920 bytes) and in the Accelerate branch, allocates a second `stackalloc short[960]`. Combined with the Merge branch also doing `stackalloc`, this puts up to 3840 bytes on the stack per call. While this won't overflow in isolation, if the PlayoutTimer thread has a small stack or other stack pressure, this could be fragile.

**Recommendation:** Convert `frame` to a pre-allocated `short[]` field on the class (like `_frameBuffer`), similar to how AudioMixer pre-allocates `_userBuffer`. This also avoids the subtle issue that `stackalloc` memory cannot be captured in closures or passed across async boundaries (not an issue here, but defensive).

### C3: Decelerate logic is incorrect -- will cause timestamp drift

**File:** Plan Task 9, Step 3 (JitterBuffer.cs, Decelerate case)
**Lines in plan:** ~1628-1636

```csharp
case PlayoutDecision.Decelerate:
    _decoder.Decode(packet!.Payload, frame);
    frame.CopyTo(output);
    _lastDecodedFrame = frame.ToArray();
    _expectedTimestamp -= FrameSize; // undo the advance below
    _stats.DecelerateFrames++;
    break;
```

Then at line ~1648: `_expectedTimestamp += FrameSize;`

The net effect is `_expectedTimestamp` stays the same, so the next `GetAudio` call will try to fetch the same timestamp again. But that packet was already consumed by `TryGetNext` (which removes it). So the next call will find no packet and trigger Expand (PLC), creating an alternating Decelerate/Expand cycle.

**Fix per spec:** Decelerate should "repeat last frame with cross-fade" -- i.e., output the decoded frame, then put additional samples into SyncBuffer for the next tick, without consuming the packet. The implementation should NOT consume the packet from the buffer. One approach: peek at the packet without removing it, decode it, output it, and don't advance `_expectedTimestamp` at all (remove the `+= FrameSize` for this case). Or: decode the packet, write 2 frames to SyncBuffer (original + cross-faded repeat), and advance `_expectedTimestamp` normally.

### C4: `SetUserVolume` signature mismatch

**File:** Plan Task 13, Step 8 vs actual AudioManager

The plan proposes:
```csharp
public void SetUserVolume(uint userId, float volume)
```

But the actual `AudioManager.SetUserVolume` at line 381 has:
```csharp
public void SetUserVolume(uint userId, int percentage)
```

This method is called from `MumbleAdapter` (line 1757) with a percentage integer. The plan's replacement would break the calling code.

**Fix:** Keep the existing `int percentage` signature and convert internally, exactly as the current code does at line 383: `var volume = Math.Clamp(percentage, 0, 200) / 100f;`

---

## Important Issues (Should Fix)

### I1: Missing `SetOutputVolume` update in Task 13

The plan updates `SetUserVolume` (Step 8) but does not update `SetOutputVolume` (AudioManager line 371-378). The current code iterates `_pipelines.Values` which will no longer exist after integration. This method needs to iterate `_mixer`'s buffers instead.

**Fix:** Add a step to Task 13 that updates `SetOutputVolume`:
```csharp
public void SetOutputVolume(int percentage)
{
    _outputVolume = Math.Clamp(percentage, 0, 250) / 100f;
    // Update all buffers that don't have a per-user override
    // (implementation depends on AudioMixer exposing iteration)
}
```
This also means `AudioMixer` needs a method to iterate or update all buffer volumes, which is not currently in the plan.

### I2: Missing `_localMutes` handling in new FeedVoice

The current `FeedVoice` at line 800 checks `if (_localMutes.Contains(userId)) return;` before processing. The plan's replacement `FeedVoice` in Task 13 Step 4 checks `_deafened` but omits the `_localMutes` check. Locally muted users would still have their audio decoded and mixed, just not heard (since JitterBuffer.Volume is not set to 0 for muted users either).

**Fix:** Either add `if (_localMutes.Contains(userId)) return;` to the new FeedVoice, or set `jb.Volume = 0` when a user is locally muted (and update `SetLocalMute` accordingly).

### I3: Missing `SetLocalMute` update

Related to I2, the `SetLocalMute` method (line 392-401) only modifies `_localMutes` HashSet. With the new architecture, it should also set the JitterBuffer's volume to 0 (or stop feeding packets). The plan does not address this method at all.

### I4: `CheckSpeakingState` replacement is incomplete

**File:** Plan Task 13, Step 6

The plan provides a skeleton with a comment "(Implementation depends on current event mechanism)". This is the only place in the plan with placeholder-quality code. The current implementation (lines 1619-1637) fires `UserStoppedSpeaking` events. The new implementation needs to:
1. Iterate mixer buffers to check `IsSpeaking`
2. Track previous speaking state per user
3. Fire `UserStartedSpeaking` and `UserStoppedSpeaking` events

This requires `AudioMixer` to expose a way to enumerate user IDs and their buffers, which the current `AudioMixer` API does not provide (only `GetBuffer(uint)` and `IsUserSpeaking(uint)` exist).

**Fix:** Add a `GetActiveUserIds()` method to `AudioMixer`, and complete the `CheckSpeakingState` implementation. Also, the `UserStartedSpeaking` event is currently fired in `FeedVoice` (line 830-831) based on `_lastVoicePacket` tracking. The plan's new `FeedVoice` removes this logic but does not replace it with the JitterBuffer-based equivalent.

### I5: Test project csproj missing `TargetFramework`

**File:** Plan Task 1, Step 2

The existing `MumbleVoiceEngine.Tests.csproj` does NOT specify a `TargetFramework` (it inherits from `Directory.Build.props`). The plan's test csproj explicitly sets `<TargetFramework>net10.0</TargetFramework>`. This is fine if correct, but check whether a `Directory.Build.props` exists that sets this globally -- if so, the explicit TFM may conflict or be redundant.

Similarly, the plan's `Brmble.Audio.csproj` explicitly sets `net10.0` while the existing MumbleVoiceEngine.Tests project does not.

### I6: RingBuffer claims "lock-free" but uses locks

**File:** Plan Task 8, Step 3

The spec says "Lock-free single-producer single-consumer circular buffer" but the implementation uses `lock (_lock)`. The plan includes a note acknowledging this ("Using a lock instead of true lock-free for simplicity"), which is a reasonable deviation. However, the doc comment still says "Lock-free" which is misleading.

**Fix:** Update the XML doc comment to say "Thread-safe" instead of "Lock-free".

### I7: `Dispose` method cleanup is incomplete

**File:** Plan Task 13, Step 9

The plan shows replacing the Dispose cleanup but doesn't show removing the old `_players` / `_pipelines` / `_lastVoicePacket` cleanup code. An implementing agent needs explicit guidance to remove lines 1664-1675 and replace them.

### I8: Missing `using` statements in integration code

**File:** Plan Task 13, Steps 2-9

The plan's code snippets for AudioManager modifications don't include the necessary `using` statements:
```csharp
using Brmble.Audio.NetEQ;
using Brmble.Audio.NetEQ.Models;
using Brmble.Audio.Codecs;
using Brmble.Audio.Diagnostics;
```

An implementing agent unfamiliar with the codebase might miss these.

---

## Suggestions (Nice to Have)

### S1: Consider adding a concurrency test for PacketBuffer

PacketBuffer is documented as thread-safe, but there are no tests verifying concurrent Insert + TryGetNext from different threads. A stress test with `Parallel.For` would increase confidence.

### S2: AudioMixer.OnTick holds lock during GetAudio calls

The `OnTick` method holds `_lock` while calling `buffer.GetAudio()` for every user. Since `GetAudio` does decoding work, this blocks `AddBuffer`/`RemoveBuffer` for the duration of all decoding. Consider copying the buffer list under lock, then calling `GetAudio` outside the lock.

### S3: Consider MergeFrames stat counter

The spec mentions Merge as a distinct decision type, and there is a counter for every other decision type in `JitterBufferStats`. But the Merge case in JitterBuffer.GetAudio increments `NormalFrames` (line ~1605). Consider adding a `MergeFrames` counter for diagnostics fidelity.

### S4: Cross-fade in Accelerate produces wrong output length

**File:** Plan Task 9, Step 3 (CrossFade method, lines ~1668-1682)

The `CrossFade` method copies `FrameSize - OverlapSamples` from `outgoing`, then `OverlapSamples` of cross-fade. Total output = `FrameSize` samples. But the Accelerate case per spec should "decode two frames, cross-fade the tail of frame 1 with the head of frame 2, output one combined frame (960 samples)." The current implementation copies the first `864` samples from frame 1, then cross-fades 96 samples using the tail of frame 1 and head of frame 2. This means the output is 864 samples of frame 1 + 96 blended samples, but none of frame 2's main body (samples 96-959) is included. The spec intends the output to contain the beginning of frame 1 and the end of frame 2, blended in the middle.

**Recommendation:** For Accelerate, the cross-fade region should blend the tail of frame 1 with the head of frame 2, and then include the rest of frame 2. This would be:
```
output[0..nonOverlap] = outgoing[0..nonOverlap]       // first part of frame 1
output[nonOverlap..FrameSize] = crossfade(outgoing tail, incoming head)  // blend
```
But then the remaining samples from frame 2 (incoming[OverlapSamples..]) are lost. The correct approach per NetEQ is to take the first half of frame 1 and second half of frame 2, with cross-fade in the middle -- so the split point should be ~FrameSize/2, not FrameSize-96.

---

## Spec vs Plan Deviation Summary

| Aspect | Spec | Plan | Assessment |
|--------|------|------|------------|
| RingBuffer | Lock-free SPSC | Lock-based | Acceptable (noted in plan) |
| SyncBuffer usage | Used in GetAudio flow | Created but not used by JitterBuffer | See note below |
| Start/Stop on JitterBuffer | `Start()` / `Stop()` methods | Not implemented | Minor gap |
| `IsSpeaking` property | Described in spec | Implemented in JitterBuffer | Matches |
| Merge stat tracking | Implicit | Counted as NormalFrames | Minor deviation |

**Note on SyncBuffer:** The plan creates SyncBuffer (Task 5) with full TDD, but the JitterBuffer orchestrator (Task 9) never uses it. The JitterBuffer directly writes to the output span without going through SyncBuffer. This means SyncBuffer is dead code in this plan. The spec says "GetAudio() reads 960 samples (20ms) per tick from this buffer" -- so either JitterBuffer should write decoded PCM into SyncBuffer and read from it, or SyncBuffer should be removed from this phase. The current approach (direct output) works fine since each GetAudio call produces exactly one frame, but it deviates from the spec architecture.

---

## Task Completeness Checklist

| Task | Complete? | Notes |
|------|-----------|-------|
| 1 - Scaffolding | Yes | |
| 2 - Models | Yes | |
| 3 - IOpusDecoder + Fake | Yes | |
| 4 - PacketBuffer | Yes | |
| 5 - SyncBuffer | Yes | Dead code -- not used by JitterBuffer |
| 6 - DelayManager | Yes | |
| 7 - DecisionLogic | Yes | |
| 8 - RingBuffer | Yes | |
| 9 - JitterBuffer | **Partial** | Decelerate bug (C3), stackalloc concern (C2), cross-fade issue (S4) |
| 10 - PlayoutTimer | Yes | |
| 11 - AudioMixer | Yes | |
| 12 - MumbleOpusDecoder | Yes | |
| 13 - AudioManager integration | **Partial** | ArrivalTimeMs bug (C1), signature mismatch (C4), missing SetOutputVolume (I1), missing local mute (I2/I3), incomplete speaking detection (I4) |
| 14 - MumbleAdapter | Yes | Correctly identified no changes needed |
| 15 - Full test suite | Yes | |
| 16 - Follow-up issues | Yes | |

---

## Recommendation

Fix the 4 critical issues (C1-C4) and the 4 most important issues (I1-I4) before handing this plan to an implementing agent. The core library code (Tasks 1-8, 10-12) is solid and ready to implement. Task 9 (JitterBuffer) needs the Decelerate fix. Task 13 (integration) needs the most work -- it has several gaps where the plan doesn't fully account for existing AudioManager behavior.

A developer with no context could follow Tasks 1-12 successfully. They would hit problems at Task 13 due to the incomplete integration steps and the method signature mismatch.
