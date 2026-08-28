# Task 10 Report

## Status

Implemented the continuous participant attach gate, reconnect grace, scheduler ownership, terminal completion routing, and Arena registration on `docs/arena-knockoff-revision` from base `f280ed1e000626f303957203457d58ab01adc141`.

## TDD Evidence

The new `ContinuousGameCoordinatorTests` were written before production changes. The first focused run failed at compile time because the required `AttachResult` and attach lifecycle API did not exist:

```text
error CS0246: The type or namespace name 'AttachResult' could not be found
```

After implementing the API, the next run exposed two behavioral failures: both acknowledged participants did not enter Loading because initial snapshot sequences were incorrectly shared, and the terminal test encountered the correctly queued `welcome` before `matchClosed`. The implementation moved snapshot sequences to participant streams and the test drained mailbox order without weakening the terminal assertion.

Final focused coordinator result:

```text
Passed: 10, Failed: 0, Skipped: 0
```

## Implementation

- `StartAsync` validates canonical Arena Knockoff configuration and distinct stable/transient participants, preserves stable-user ownership, publishes `game.started`, and arms one generation-checked 15-second attach timer.
- `AttachParticipantAsync`, `AcknowledgeAttach`, and `DetachAsync` implement participant-only authorization, complete welcome/snapshot delivery, exact matching snapshot acknowledgement, transient session replacement, immediate neutral input, surviving-peer `connectionState`, and generation-safe five-second reconnect grace.
- Arena simulation identity remains on original session IDs while accepted input routing moves to the authorized replacement session. The participant acknowledgement counter survives replacement, so the first accepted input remains exactly `acknowledgedInput + 1`.
- The scheduler starts only after both initial attach acknowledgements, runs at 60 Hz through `FixedStepScheduler`, does not pause during reconnect grace, and emits participant snapshots every third simulation tick through `RealtimeSnapshotMailbox.ReplaceSnapshot` without socket awaits.
- Snapshot, welcome, connection, and terminal JSON use web camel-case properties and camel-case enum strings. `serverTick` is envelope-only; Task 7's immutable view remains unchanged.
- Completion is claimed once under the match lock, cancels timers/scheduler, queues `matchClosed` before teardown, synchronously enqueues `CompletedMatch`, releases both stable-user index entries, isolates `MatchCompleted` subscribers, then publishes `game.ended` best-effort.
- Completed records use `arena-knockoff`, `bo3`, ruleset 1, stable user IDs, Task 7 match summary metadata, and Task 7 per-participant metadata. A sink acceptance exception is logged critically but cannot block ownership release or queue advancement.
- `ArenaGameDefinition` is registered as one singleton under both `IDuelGameDefinition` and `IContinuousGameDefinition`; `ContinuousGameCoordinator` is registered as an `IDuelMatchRunner` beside the existing discrete runner.
- No world snapshots are sent through `IGameEventPublisher`.
- No `Spectators` source file, `ISpectatorCoordinator` injection/call, router replacement, catalog replacement, or presence-flow change was made.

## Verification

Exact required lifecycle gate:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~GameSessionManagerTests|FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~SpectatorServiceTests|FullyQualifiedName~GamesExtensionsTests"
```

```text
Passed: 159, Failed: 0, Skipped: 0
```

Sequential full server suite:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

```text
Passed: 962, Failed: 0, Skipped: 0
```

`SpectatorServiceTests` ran unmodified in the focused gate. `git diff --check` is clean.

## Files

- `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- `src/Brmble.Server/Games/GamesExtensions.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-10-report.md`

## Concerns

- Task 12 remains responsible for awaiting successful `matchClosed` socket transmission before normal WebSocket close. Task 10 guarantees terminal mailbox ordering and reserves the terminal control through the existing mailbox contract.
- `ICompletedMatchSink.Enqueue` is a synchronous queue-acceptance boundary. The coordinator does not create an unobserved task; persistence retries remain owned by `CompletedMatchPersistenceQueue`.
- The pre-existing untracked `.opencode/plans` files were not read, modified, staged, or removed.

## Fix Round 1

### Review Findings Addressed

- Added one deterministic `ParticipantView` projection boundary. Arena simulation IDs remain unchanged internally, while every player session ID, projectile owner session ID, acknowledgement-bearing player identity, reconnect welcome/state/snapshot, and `matchClosed.finalState` uses the participant's current realtime session ID.
- Scheduler snapshot fan-out now includes only participants whose current connection completed the matching attach acknowledgement. The complete attach snapshot remains at its advertised sequence while simulation continues for the opponent; ordinary fan-out resumes after acknowledgement.
- `SubmitInput` now requires both a current connection ID and completed attach acknowledgement. Detached original sessions, stale receive-loop calls during grace, and replacement sessions before acknowledgement cannot alter simulation input or advance acknowledgement.
- Added `RealtimeSnapshotMailbox.SealTerminal`, an explicit atomic terminal operation compatible with the existing Task 8 mailbox contract. It discards pending snapshots, enqueues one `matchClosed`, and rejects all later controls/snapshots. Attach, connection-state, scheduler snapshot, and terminal writes are coordinated under match state locking, so successful attach cannot publish a post-terminal welcome.
- Scheduler and timer completion tasks are observed. Unexpected scheduler exceptions route through exactly-once completion with `scheduler_error`; timeout completion faults are logged rather than becoming unobserved tasks.
- Completion now claims terminal state first, detaches scheduler/timer references under lock, cancels and disposes resources outside the lock, and isolates terminal projection, neutralization, metadata serialization, sink acceptance, each completion subscriber, and lifecycle publication. Stable-user indexes and `MatchCompleted` are attempted even if terminal projection or persistence acceptance fails.
- Scheduler completion never awaits its own task. A continuation observes scheduler termination and disposes its cancellation source after exit; matches that never started a scheduler dispose the source directly.
- Updated pre-existing continuous input harnesses to establish an acknowledged participant connection before testing input behavior. Arena tests that manually own simulation stepping attach only after reaching Live, avoiding a competing scheduler.

### RED And Race Evidence

First focused RED after adding reconnect projection, detached input, and unacknowledged snapshot tests:

```text
Failed: 3, Passed: 11
ReconnectWireProjectionUsesCurrentSessionIdsEverywhere: current session 11 absent
DetachedAndReplacementPreAckInputsCannotAdvanceAcknowledgement: detached input accepted
UnacknowledgedReconnectKeepsAttachSnapshotWhileSimulationAdvances: expected sequence 2, actual 4
```

Second focused RED after adding terminal seal and attach/completion race tests:

```text
Failed: 3, Passed: 14
MatchClosedSealsMailboxAndNoSnapshotOrControlCanFollowIt: post-terminal outbound remained
AttachRacingCompletionNeverWritesAfterTerminal: post-terminal outbound remained
ReconnectFinalStateUsesCurrentSessionAndProjectileOwnerIds: current session 11 absent
```

The initial implicit mailbox seal regressed three existing Task 8 reserved-capacity tests because those unit tests deliberately enqueue multiple terminal controls. This proved sealing must be an explicit coordinator operation rather than changing ordinary `WriteControl` semantics. `SealTerminal` preserved all 27 combined coordinator/mailbox tests.

Third focused RED after adding scheduler and projection fault tests:

```text
Failed: 3, Passed: 17
SchedulerFaultCompletesAndReleasesOwnership: ownership remained active
FinalProjectionFaultStillReleasesOwnershipAndAttemptsCompletionStages: snapshot exception escaped
NaturalSimulationCompletionPersistsThenRaisesAndPublishesEnded: scheduler was not reached by the initial virtual-time harness
```

The scheduler harness was then synchronized with scheduler startup before advancing virtual time. Production fault handling completed the match and released ownership; final projection failure no longer prevented sink, index release, completion subscriber, or `game.ended` attempts.

Mutation/race coverage directly protects these corrections:

- Restoring raw `ParticipantSnapshot` at any attach, cadence, or terminal projection site fails exact player/projectile reconnect ID assertions.
- Restoring mailbox fan-out for unacknowledged participants changes the retained attach snapshot sequence and fails deterministically.
- Weakening the active acknowledged connection predicate accepts detached or replacement pre-ack input.
- Removing terminal sealing exposes a queued snapshot/control after `matchClosed`; the 25-iteration attach/completion race also detects post-terminal output.
- Removing scheduler exception completion leaves stable ownership indexed; throwing final projection and sink fixtures verify stage isolation.
- Scheduler snapshots assert `serverTick % 3 == 0`; reconnect grace tests continue to prove simulation advancement.

### Verification

Coordinator tests:

```text
Passed: 21, Failed: 0, Skipped: 0
```

All prior Continuous and Arena tests:

```text
Passed: 128, Failed: 0, Skipped: 0
```

Exact lifecycle gate, including unmodified `SpectatorServiceTests`:

```text
Passed: 170, Failed: 0, Skipped: 0
```

Sequential full server suite:

```text
Passed: 973, Failed: 0, Skipped: 0
```

### Fix Round 1 Files

- `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-10-report.md`

### Remaining Concerns

- Task 12 still owns awaiting successful terminal socket transmission before normal WebSocket close. The mailbox now guarantees that no coordinator outbound can follow its terminal item.
- If terminal view serialization itself fails, no valid `matchClosed.finalState` can be produced; cleanup, persistence acceptance, ownership release, completion subscribers, and `game.ended` still proceed independently and the failure is logged.
- No Spectator service/source, spectator injection, world-state event publication, router/catalog replacement, or `.opencode/plans` file was changed.

## Fix Round 2

### Findings Addressed

- `AttachParticipantAsync` now checks whether the requested current session ID belongs to another participant before removing any connection/session mapping or changing attach sequence state. A collision returns `sessionInUse`; the original participant remains detached and the opponent's mapping/connection remains usable.
- Collision coverage creates an Arena projectile before reconnect, rejects reconnect onto the opponent's session, then reconnects to a unique session and asserts exactly two unique projected player IDs and that every projectile owner belongs to that projected player set.
- `RealtimeSnapshotMailbox.SealTerminal` now returns whether `matchClosed` was physically queued. It always seals and discards the pending snapshot atomically before testing capacity. On full controls it sets `Overloaded`, returns `false`, preserves already queued controls, and rejects all later controls/snapshots. On success it returns `true` and queues the terminal control.
- Coordinator completion checks the boolean seal result and logs an overloaded terminal mailbox. Task 12 can use the existing `Overloaded` signal to close without a terminal frame when physical capacity is exhausted.
- Replaced synthetic completion race coverage with controlled overlap tests. Attach-vs-completion blocks inside `ParticipantSnapshot` while attach owns the match lock, starts completion and proves it cannot complete until projection releases, then verifies terminal ordering. Completion-vs-completion blocks the first completion inside `ICompletedMatchSink.Enqueue` after terminal claim, starts and completes a second forfeit while the first pipeline is still blocked, then verifies one sink enqueue and one completion event.
- Added a direct reconnect cadence test: drain the attach welcome/snapshot, acknowledge the exact reconnect sequence, advance the scheduler, and require a subsequent snapshot with a strictly greater sequence.

### RED Evidence

The first focused run after adding explicit terminal result assertions failed to compile:

```text
error CS0815: Cannot assign void to an implicitly-typed variable
```

This directly demonstrated that `SealTerminal` exposed no success/failure contract. After implementing the boolean fail-closed contract and pre-mutation collision check, the combined coordinator/mailbox suite passed 35 tests.

The first coordinator run with real-overlap tests passed both barrier-controlled races. One unrelated cadence test exposed the existing virtual-time startup race because scheduler `Task.Run` had not initialized its deadline before time advanced. Synchronizing scheduler startup in that test restored deterministic behavior without changing production cadence.

### Race Mechanics

- Attach-vs-completion uses `BlockingProjectionSimulation.ProjectionEntered` and `ReleaseProjection`. `AttachParticipantAsync` blocks in projection while holding `state.SyncRoot`; `ForfeitAsync` starts on another task and is asserted incomplete until the barrier releases. This proves actual contention on the coordinator critical section rather than task scheduling order.
- Completion-vs-completion uses `BlockingSink.Entered` and `Release`. The first completion has already removed the match and marked it inactive before blocking in sink acceptance. The second forfeit executes concurrently and returns while the first remains blocked, proving the exactly-once claim gate independently of downstream completion latency.
- Mailbox pressure fills all 16 physical control slots, leaves a pending snapshot, calls `SealTerminal`, then attempts later snapshot/control writes. The seal reports `false`, `Overloaded` is true, no snapshot survives, no new terminal is inserted, and no post-seal control is accepted.

### Mutation Evidence

- Moving the session collision check after `state.Participants.Remove` or removing it overwrites the opponent mapping; the opponent input assertion and unique projected ID assertions fail.
- Omitting unconditional `_sealed = true` or snapshot discard on the full-capacity branch allows post-seal writes or the pending snapshot to drain; the pressure test fails.
- Returning success when terminal enqueue fails contradicts the explicit `false` assertion and hides overload from coordinator handling.
- Removing the reconnect `AttachAcknowledged` fan-out gate or failing to resume it after acknowledgement causes either the prior retained-attach-snapshot test or the new greater-sequence cadence test to fail.
- Replacing barrier-controlled races with sequential execution cannot satisfy the assertions that completion remains blocked during attach projection or that the first completion remains blocked while the second has returned.

### Verification

```text
ContinuousGameCoordinatorTests: 25 passed, 0 failed
RealtimeSnapshotMailboxTests: 12 passed, 0 failed
ContinuousInputTests: 19 passed, 0 failed
All Continuous and Arena tests: 134 passed, 0 failed
Exact lifecycle gate: 174 passed, 0 failed
Full server suite: 979 passed, 0 failed
```

### Fix Round 2 Files

- `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`
- `tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-10-report.md`

### Remaining Concerns

- A physically full control mailbox cannot accept `matchClosed`; it is now permanently sealed and marked overloaded, so Task 12 must close the socket through its overload path without waiting for terminal delivery.
- No spectator files, spectator dependency/call, world-state event publication, router/catalog replacement, or `.opencode/plans` file was changed.
