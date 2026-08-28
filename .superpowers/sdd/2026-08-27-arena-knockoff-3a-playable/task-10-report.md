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
