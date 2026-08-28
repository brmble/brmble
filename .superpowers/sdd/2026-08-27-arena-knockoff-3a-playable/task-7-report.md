# Task 7 Report

## Status

Implemented complete Arena Knockoff BO3 round resolution, KO attribution, double-KO anti-loop behavior, immutable snapshot projection, completion telemetry, and deterministic hashing on `docs/arena-knockoff-revision` from base `d2238aa242e53565d9f9a850d60fafc308efec5e`.

## RED

Command:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ArenaMatchTests|FullyQualifiedName~ArenaDeterminismTests"
```

Observed expected failure before production edits: the test project did not compile because `ArenaMatchSummary` did not exist. This directly demonstrated the absent completion/telemetry contract; scoring, replay completion, and the expanded snapshot/hash behavior were likewise unavailable from `ArenaSimulation`.

## GREEN

Focused Task 7 tests:

```text
Passed: 10, Failed: 0, Skipped: 0
```

Arena preflight after integrating existing phase/combat coverage:

```text
Passed: 53, Failed: 0, Skipped: 0
```

Exact required 20-run loop:

```powershell
1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Arena"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

All 20 runs completed. Every run reported 53 passed, 0 failed, 0 skipped. The deterministic stream compared identical per-tick hashes and outcomes on every run; the loop did not stop early.

Sequential full server suite:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Result: 914 passed, 0 failed, 0 skipped, duration 39 seconds.

Additional validation: `git diff --check` produced no output.

## Implementation

- Stage 13 evaluates both player centers with strict-outside semantics after shrink; stage 14 resolves one-sided and same-tick double KOs without changing the established 15-stage call order.
- Boundary attribution tracks the latest movement/dash, velocity source (recoil or opponent projectile), body displacement, or radius-collapse event.
- Decisive rounds score one point and reset the consecutive double-KO count. Double KOs score nothing; counts 1 through 3 replay and count 4 completes a draw. First to two wins completes a decided match.
- Round reset clears momentum, projectiles, input edge sets, neutral input state, charge, forced fire, cooldown, dash state, shrink/live timing, and boundary attribution; it restores mirrored spawns and reruns Loading plus Positioning without another participant-ready gate.
- `_nextProjectileId` remains match-lifetime monotonic across resets.
- `ArenaSnapshotView` includes the protocol final-state fields and clones all mutable collections. Participant projections include per-player acknowledgements; spectator projections set every acknowledgement to null.
- Completion metadata schema 1 includes final score, rounds, double-KO replays, round durations, KO causes, shots, hits, fired/landed charge arrays, dash use, and KO radii. Participant stats are keyed in ascending stable-user-ID order and completion participants use stable user IDs, not session IDs.
- The deterministic hash serializes future-affecting scalar state, stable-user mapping, players in ascending session order, projectiles in ascending ID order, unordered sets in ascending order, inputs/edge state, telemetry, boundary attribution, and completion state. Simulation contains no RNG or wall-clock access; the seeded PRNG exists only in `ArenaDeterminismTests`.

## Files

- `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- `tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs`
- `tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs`
- `tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-7-report.md`

## Self-Review And Concerns

- Snapshot schema was checked against the protocol sample. Enum wire casing remains the responsibility of the realtime serializer introduced by later transport tasks; this task returns the typed immutable view and does not add transport serialization.
- Existing radius-schedule cases at live ticks 3599 and 3600 could no longer observe a live simulation at radius zero because complete stage-13 behavior correctly resolves the overlapping players first. Those two assertions now call the frozen pure `ArenaRulesetV1.ArenaRadius` schedule; all earlier schedule boundaries still exercise live simulation.
- `"abandoned"` remains a valid `ContinuousCompletion` outcome contract, but simulation-driven terminal paths produce only `"decided"` or `"draw"`; abandonment is coordinator/forfeit-driven and was explicitly outside this task's coordinator boundary.
- No `SpectatorService`, event-bus snapshot, coordinator behavior, `SpectatorSourceFrame`, new service abstraction, or production randomness was added.
- The protected untracked `.opencode/plans` files were not read, edited, staged, or removed.

## Fix Round 1

### Review Findings Addressed

- Removed `ServerTick` from `ArenaSnapshotView`; the later realtime transport envelope owns simulation `Tick`.
- Replaced array-backed `Players` and `Projectiles` projections with `ReadOnlyCollection` instances. Snapshot tests now attempt mutation of score, players, and projectiles and require `NotSupportedException` for all three.
- Replaced persistent last-displacement KO attribution with per-tick inside-to-outside transition evidence. Movement, dash, velocity integration using the remembered recoil/projectile source, body collision, and radius collapse record a cause only when that stage actually crosses the boundary. A later displacement while already outside cannot overwrite it.
- Replaced the symmetric determinism fixture with an asymmetric seeded stream. The normal run has literal expected score `[2,0]` and outcome `decided`; its distinct transformed mirror has literal expected score `[0,2]` and outcome `decided`.
- Snapshot serialization now asserts the exact top-level, arena, player, and projectile property sets; absence of `serverTick`; `live` and `hold` enum values under web camel-case options plus `JsonStringEnumConverter(JsonNamingPolicy.CamelCase)`; and immutable collections.

### RED Evidence

Focused command before production changes:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ArenaMatchTests|FullyQualifiedName~ArenaDeterminismTests"
```

Result: 3 failed, 10 passed, 0 skipped.

- `MovementExitIsNotOverwrittenByLaterRecoilVelocityWhileAlreadyOutside`: expected `DashOrMovement`, actual `Recoil`.
- `RecoilVelocityExitIsNotOverwrittenByLaterCollisionWhileAlreadyOutside`: expected `Recoil`, actual `DashOrMovement`.
- `ParticipantSnapshotMatchesExactProtocolShapeAndIsImmutable`: expected 7 top-level properties, actual 8 because `serverTick` leaked into final state.

### Mutation Evidence

Temporarily mutated decisive scoring from `outside[0] == 0 ? 1 : 0` to unconditional side `0`, then ran:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~MirroredInputsAndSides_ProduceMirroredScores"
```

Result: 1 failed, 0 passed. The mirrored literal expected score was `[0,2]`; the side-biased mutation produced `[2,0]`. The mutation was immediately reverted before GREEN verification.

The competing-event tests also serve as overwrite mutation evidence: they failed against the prior implementation's unconditional later-stage cause assignments and pass only when attribution is gated by an actual inside-to-outside transition.

### GREEN Evidence

Focused Task 7 tests after correction:

```text
Passed: 14, Failed: 0, Skipped: 0
```

All Arena tests:

```text
Passed: 57, Failed: 0, Skipped: 0
```

Exact 20-run loop:

```powershell
1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Arena"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

All 20 runs completed; every run reported 57 passed, 0 failed, 0 skipped.

Sequential full server suite:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Result: 918 passed, 0 failed, 0 skipped, duration 39 seconds.

### Files

- `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- `tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs`
- `tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs`
- `.superpowers/sdd/2026-08-27-arena-knockoff-3a-playable/task-7-report.md`

### Concerns

- The intended serializer configuration is asserted explicitly in Task 7 tests. The later coordinator/endpoint task must use equivalent web camel-case naming and camel-case enum conversion when placing this view into snapshot and `matchClosed.finalState` envelopes.
- Direct test placement outside the arena has no simulated transition event, so terminal classification retains the documented `DashOrMovement` fallback. Runtime movement, dash, velocity, collision, and collapse exits all carry explicit transition evidence.
- No stage was inserted, removed, or reordered; the existing 15-stage simulation sequence and timing remain unchanged.
- No spectator routing, event-bus snapshot, coordinator change, production RNG, or `.opencode/plans` change was introduced.
