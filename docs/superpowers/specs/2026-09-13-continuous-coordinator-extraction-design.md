# Continuous Coordinator Extraction — Design

**Status:** implemented on `refactor/continuous-coordinator-extraction` (see the plan's *Status* for the deviations). Sequenced after
`fix/arena-unconditional-acknowledgement` and `feature/arena-input-scheduling` have merged.

**Origin:** the second-opinion review of the realtime netcode work
(`docs/superpowers/reviews/2026-09-13-realtime-acknowledgement-and-latency-review.md`, §3).
PR #646 was meant to lay the base for realtime games beyond Arena Knockoff. The runner seam it
introduced is right; the continuous coordinator behind it is not yet game-agnostic. This design
makes it so **before** a second continuous game is started, while there is still exactly one
implementation to keep passing.

**Plan:** `docs/superpowers/plans/2026-09-13-continuous-coordinator-extraction.md`.

Line anchors are against `main` at `2f89650e` and will have moved by the time this is
implemented; they identify the sites, not the lines.

---

## What is already right

`DuelOrchestrator` owns challenges, queues and ready checks per channel and knows nothing about
how a match is played. `DuelMatchRunnerRouter` dispatches a `DuelReservation` to an
`IDuelMatchRunner` by `RunnerKey`: `"discrete"` is `GameSessionManager` over `IGameEngine`
(RPS, Deathroll); `"continuous"` is `ContinuousGameCoordinator` over
`IContinuousGameDefinition` / `IContinuousSimulation` (Arena). Completion flows back through
`MatchCompleted` on the runner. Spectating, persistence and stats hang off the same
completion. None of that changes.

The discrete side is the model for the continuous side: `IGameEngine` is the only place a game
is named, `GameSessionManager` never casts to a concrete engine, and the one method that
tempts a shortcut (`SpectatorView`) has no default implementation so a new engine cannot
compile until its author decides. That is the standard to reach.

## What leaks

Every place `ContinuousGameCoordinator` knows it is running Arena:

| Site | Leak | Kind |
|---|---|---|
| `StartAsync` `:90-96` | `"arena-knockoff"` canonical-configuration check inline | game identity |
| `AttachParticipantAsync` `:181` | `ArenaRulesetV1.TickRate`, `.SnapshotRate`, and the literal welcome tuning `100, 50, 250, 750, 5000` (interpolation, max extrapolation, heartbeat, neutral-after, reconnect grace) | timing constants |
| `AcknowledgeAttach` `:211-213` | `is ArenaSimulation arena` → `arena.MarkParticipantReady(...)` | concrete cast |
| `SubmitInput` `:312-320` | `is ArenaSimulation` to find the player for cooldown, and to read `RoundGeneration` | concrete cast |
| `SubmitInput` `:335-350`, `:377-381` | cooldown / dash-spent stripping with `ArenaRulesetV1.ShotCooldownTicks`, `participant.CooldownUntilTick`, `participant.DashSpent`, `participant.RoundGeneration` | game rules in the coordinator |
| `CompleteAsync` `:516` | `game.ended` hardcodes `gameType = "arena-knockoff", format = "bo3", rulesetVersion = 1` | **bug for game #2**; `game.started` at `:117-125` already reads the reservation |
| `RunSchedulerAsync` `:663`, `:678` | `ArenaRulesetV1.TickRate`, `.MaxCatchUpTicks`, `.SnapshotEveryTicks` | timing constants |
| `ParticipantView` `:740` | `is not ArenaSnapshotView` → per-player session-id rewrite over `Players` and `Projectiles` | concrete view type |
| `CreateParticipants` `:877` | `is ArenaSimulation` to seed the aim used by the aim-rate budget | concrete cast |
| `ContinuousInput` (`ContinuousContracts.cs`) | the wire input *is* Arena's input: move, aim, charging, fire, dash | wire shape |
| `ContinuousRejectReason` | `Cooldown`, `DashSpent` have not been returned since the strip path landed; `PhaseDenied` likewise | dead members |
| `ParticipantInputState` | `AimX/AimY`, `CooldownUntilTick`, `DashSpent`, `RoundGeneration` | Arena state on a generic participant |

The client mirrors this: `useArenaConnection` (ticket, welcome, sequencing, heartbeat, clock,
lead, reconnect) and the authority timeline in `useArenaState` are generic; only
`arenaMath`, `ArenaRenderer`, `useArenaInput` and the knockout presentation are Arena.

## Design

### Principle

After Finding 3, the coordinator refuses only at the connection level and every game-level
refusal is a strip. A strip is a pure function from `(simulation state, input)` to `input`,
and it belongs to the game. Once it moves, the coordinator has no reason left to know which
game it is running.

### Interface changes

`IContinuousGameDefinition` gains the timing it currently borrows from `ArenaRulesetV1`:

```csharp
public sealed record ContinuousTiming(
    int TickRate, int SnapshotEveryTicks, int MaxCatchUpTicks,
    int InterpolationMs, int MaxExtrapolationMs, int InputHeartbeatMs,
    int NeutralAfterMs, int ReconnectGraceMs);

public interface IContinuousGameDefinition
{
    string GameType { get; }
    int RulesetVersion { get; }
    ContinuousTiming Timing { get; }
    object PredictionConstants { get; }
    /// Rejects a reservation whose configuration this game cannot run. Replaces the
    /// inline "Arena configuration is not canonical" check.
    string? ValidateConfiguration(DuelConfiguration configuration);
    IContinuousSimulation Create(DuelReservation reservation);
}
```

`IContinuousSimulation` gains the three things the coordinator currently reaches through casts
for:

```csharp
public interface IContinuousSimulation
{
    long Tick { get; }
    ContinuousMatchPhase Phase { get; }
    /// Called once per participant when their attach is acknowledged. Arena moves its
    /// AwaitingParticipants → Loading transition behind this.
    void MarkParticipantReady(long sessionId);
    /// Game-level admission. Returns the input as the game will accept it — fields
    /// stripped or substituted, never rejected. Called at install time, against the state
    /// the input will meet. No default: a new game must decide what it refuses.
    ContinuousInput Admit(long sessionId, ContinuousInput input);
    void SetInput(long sessionId, ContinuousInput input);
    void SetNeutralInput(long sessionId);
    ContinuousStepResult Step();
    /// Snapshot with wire session ids already substituted. The coordinator passes the
    /// simulation-id → current-session-id map; the game applies it to whatever fields
    /// carry identity. Replaces the ArenaSnapshotView rewrite in ParticipantView.
    object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs,
        IReadOnlyDictionary<long, long> wireSessionIds);
    object SpectatorSnapshot(IReadOnlyDictionary<long, long> wireSessionIds);
    ulong DeterministicHash();
}
```

`Admit` is the important one. `ArenaSimulation.Admit` takes over the cooldown / dash-spent /
phase strip **and** the per-round dash reservation that `ParticipantInputState.DashSpent` and
`RoundGeneration` track today — those are Arena's bookkeeping and move into `ArenaPlayerState`.
`CooldownUntilTick` goes the same way (or is dropped in favour of `player.CooldownTicks`, which
`ProcessFire` already enforces; the plan asks for the equivalence to be proven, not assumed).

The aim-rate budget stays in the coordinator: it is a message-rate concern, like the message
and heartbeat budgets. But "aim" is Arena's word. The budget is generalised to **"the
direction-like fields of the input changed"**, which the input shape below makes expressible
without naming Arena.

### The input shape

`ContinuousInput` is kept as a fixed record — a generic "N axes + buttons" shape buys nothing
until a second game asks for something Arena's shape lacks — but it is **documented as the
continuous wire input**, its fields are grouped as `Held` (move, aim, charging) and `Edges`
(fire, dash), and the coordinator only ever touches it through those groups (heartbeat = held
only; edges stripped under rate limit; direction-change = the aim pair). A second game that
needs different fields is the moment to revisit this, with two concrete games in hand rather
than one and a guess.

### Wire changes

None to message shapes. `game.ended` starts carrying the reservation's real `gameType`,
`format`, `rulesetVersion` and `options`, which for Arena today are the hardcoded values, so
nothing observable changes for it.

### Dead code

`ContinuousRejectReason` loses `PhaseDenied`, `Cooldown`, `DashSpent`. The client's
`staleSequence` / `sequenceGap` handling in `useArenaConnection.ts` — unreachable since Finding
3 — is removed at the same time, along with the tests that pin it.

### Client split

`useArenaConnection` becomes `useRealtimeConnection` (generic: ticket, welcome, sequence,
heartbeat, `serverClock`, `inputLead`, pending intervals, reconnect) parameterised by the
message parser and the welcome type; `useArenaState` keeps Arena's prediction and rendering and
consumes it. The authority timeline (`timelineRef`, `sampleTimeline` inputs) is also generic
and moves out with it. This is a rename-and-split with no behaviour change, pinned by the
existing tests moving with their code.

## Non-goals

- No second game is built here. The proof that the extraction is complete is that the
  coordinator, `RealtimeGameEndpoint` and `useRealtimeConnection` contain no string, type or
  constant from the `Arena` namespace, checked by a test that greps for it.
- No change to snapshot cadence, tick rate or any tuning constant — they move, they do not
  change.
- No change to the discrete side.
