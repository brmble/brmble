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

## Fix Round 1

### Status

Implemented all High and Medium findings. The requested Low manual-timer test gap remains deferred.

### Changes

- Accepted stationary aim-only input and heartbeat now use `SetInput`, preserving the submitted nonzero aim.
- Arena's existing input boundary latches accepted fire/dash edges across subsequent ordinary input, heartbeat, explicit neutral release, and stale timeout until `Step` processes them.
- Arena clears each latched edge immediately after its processing stage, preventing repeats on later ticks.
- `SetNeutralInput` now clears only held movement and charging. It preserves current aim and unconsumed edge bits.
- Added Arena `RoundGeneration`, incremented only by authoritative round reset. Coordinator dash reservations clear only when this generation changes, never from pre-step `DashAvailable` state.
- Retained deterministic fake simulation tests for validation/rate/timeout control and added real Arena coordinator tests for delayed scheduler consumption.

### RED Evidence

The first focused run failed five real-Arena tests:

- Stationary aim expected `(0,32767)` but remained `(32767,0)`.
- Dash followed by heartbeat remained available because the edge was overwritten.
- Fire followed by explicit neutral produced zero projectiles because the edge was overwritten.
- Timeout before `Step` erased pending dash.
- The second pre-step dash probe returned `StaleSequence`, proving the first implementation had incorrectly accepted it after clearing the reservation from unchanged Arena state.

Mutation check: temporarily replacing the edge merge in `ArenaSimulation.SetInput` with direct assignment made both delayed-edge tests fail: dash remained available and fire produced zero projectiles. Restoring the merge returned the focused suite to green.

### Verification

- `ContinuousInputTests`: 17 passed, 0 failed.
- All Arena tests: 50 passed, 0 failed.
- `ContinuousContractTests`: 7 passed, 0 failed.
- Full `Brmble.Server.Tests`: 949 passed, 0 failed.

### Remaining Concern

- Deferred as requested: the test `ManualTimeProvider` does not model every disposed-timer callback race. Production neutral timers remain generation-guarded.

## Fix Round 2

### Status

Implemented both remaining Important findings. The deferred timer test remains out of scope.

### Changes

- Added `ArenaSimulation.RoundGeneration` to `DeterministicHash` serialization because coordinator dash acceptance depends on that future-affecting state.
- Added deterministic hash coverage that holds all other state equal, changes only `RoundGeneration`, and requires a different hash.
- Added real Arena coordinator tests that consume dash/fire, assert the corresponding input latch bit is cleared immediately after `Step`, submit an ordinary release frame, step again, and verify no stale edge remains or replays.
- Preserved the existing simulation stage order.

### RED And Mutation Evidence

- Before hash serialization changed, otherwise-identical live simulations with round generations 0 and 1 produced the same hash `8261248038652121437`; the new hash test failed.
- Removing only `player.Input = player.Input with { Dash = false };` from `ProcessDashEdges` made `Arena_ConsumedDashLatchClearsBeforeOrdinaryInputAndNextStep` fail at the immediate post-consumption `Input.Dash` assertion.
- Removing only `player.Input = player.Input with { FireReleased = false };` from `ProcessFire` made `Arena_ConsumedFireLatchClearsBeforeOrdinaryInputAndNextStep` fail at the immediate post-consumption `Input.FireReleased` assertion.
- Restoring both clears and the hash field returned all three focused tests to green.

### Verification

- `ContinuousInputTests`: 19 passed, 0 failed.
- `ArenaDeterminismTests`: 4 passed, 0 failed.
- All Arena tests: 51 passed, 0 failed.
- Full `Brmble.Server.Tests`: 952 passed, 0 failed.

### Remaining Concern

- Deferred as requested: the test `ManualTimeProvider` does not model every disposed-timer callback race. Production neutral timers remain generation-guarded.
