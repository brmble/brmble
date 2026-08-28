# Task 9 Report

## Status

Implemented and verified.

## Boundary

- Added the exact `InputResult` API and `ContinuousGameCoordinator.SubmitInput(long matchId, long sessionId, RealtimeRole role, ContinuousInput input, bool isHeartbeat)`.
- Stable match ownership remains indexed by `DuelPlayer.UserId`; realtime input identity uses the reservation's current `SessionId`.
- Validation order is match/session, role, exact-next sequence, predicted tick and vector ranges, phase/cooldown/dash legality, then rolling rate limits.
- Rejections preserve the last acknowledged input. Accepted messages alone advance acknowledgement and occupy the accepted-message rate windows.
- Predicted ticks are inclusive in `[serverTick - 120, serverTick + 30]`.
- Movement accepts any supplied vector with integer length at most `32767`; aim additionally must be nonzero. Accepted vectors are not normalized or otherwise rewritten by the coordinator.
- Heartbeats carry complete held state and reject fire/dash edges.
- Per-participant monotonic rolling windows accept 120 messages and 30 aim changes per second; entries expire at an elapsed time of exactly one second.
- Accepted input or heartbeat rearms a generation-safe `TimeProvider` timer. Input becomes neutral strictly after 750 ms, preserving consumed fire/dash state.
- Explicit all-neutral input neutralizes immediately. Match teardown neutralizes both participants and disposes stale timers.
- Match and participant input state is protected by the match lock for future scheduler/socket concurrency.

## TDD Evidence

RED:

`dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousInputTests`

Failed with `CS1061`: `ContinuousGameCoordinator` had no `SubmitInput` definition.

GREEN and regression verification:

- `ContinuousInputTests`: 11 passed, 0 failed.
- Combined `ContinuousInputTests`, `ContinuousContractTests`, and Arena tests: 68 passed, 0 failed.
- Full `Brmble.Server.Tests`: 943 passed, 0 failed.
- `git diff --check`: clean.

## Concerns

- Participant socket loss and replacement socket attach APIs are intentionally Task 10 scope. Task 10 must invoke immediate neutralization from those paths; Task 9 implements the currently available explicit release, stale timeout, and match teardown paths without adding attach/scheduler lifecycle early.
- Cooldown and dash availability are Arena simulation state. The coordinator reads the completed `ArenaSimulation` player state for forced-fire cooldown and round-reset availability while retaining submission-time edge reservations until the simulation consumes an accepted edge.

## Files

- `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-9-report.md`
