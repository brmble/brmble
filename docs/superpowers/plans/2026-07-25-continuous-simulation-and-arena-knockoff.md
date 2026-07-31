# Continuous Simulation And Arena Knockoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver project 3 as a reusable server-authoritative continuous-simulation runtime and its deterministic Arena Knockoff ruleset, direct realtime transport, predicted/interpolated Canvas client, accessible presentation, audio, telemetry, and release gates.

**Architecture:** Projects 1 and 2 are strict prerequisites. Keep their `DuelConfiguration`, `DuelReservation`, `IDuelGameDefinition`, `IDuelMatchRunner`, `IDuelMatchRunnerRouter`, `MatchCompletion`, `ISpectatorCoordinator`, `ForegroundActivity`, and `setRemotePlaybackPaused` names and meanings unchanged. Arena registers one `IDuelGameDefinition` with `RunnerKey="continuous"` and one continuous `IDuelMatchRunner`; project 1's existing `GameDefinitionCatalog` and `DuelMatchRunnerRouter` perform all canonicalization/start/lookup/forfeit routing, while project 2 performs continuous-match registration and authorization only. The server owns a single-process 60 Hz fixed-point simulation and emits replaceable 20 Hz Arena state only over a browser-owned WebSocket.

**Tech Stack:** .NET 10, ASP.NET Core WebSockets, C# fixed-point integer simulation, `System.Threading.Channels`, `System.Diagnostics.Metrics`, MSTest/Moq, raw Win32/WebView2 mTLS bridge, React 19, TypeScript 5.9, Canvas 2D, Web Audio, Vitest/Testing Library, CSS custom-property tokens.

---

## File Structure

### Prerequisites And Unchanged Contracts

- Complete `docs/superpowers/plans/2026-07-25-duel-orchestration-queue-ready-rematches-etas.md` and `docs/superpowers/plans/2026-07-25-generic-spectator-and-foreground-activity.md` first.
- Reuse project 1's exact stable contracts: `DuelConfiguration(GameType,Format,RulesetVersion,Options,RunnerKey)`, `IDuelGameDefinition`, `ActiveMatchReference`, `IDuelMatchRunner`, `IDuelMatchRunnerRouter`, `DuelMatchRunnerRouter`, `DuelReservation`, `DuelPlayer`, `DuelPlayerSnapshot`, `GameStartResult`, `MatchCompletion`, `ICompletedMatchSink`, `DuelOrchestrator`, `DuelQueueSnapshot`, ruleset persistence, rematches, ready checks, ETAs, and queue revisions. Runner lookup/forfeit identities are stable `DuelPlayer.UserId`, never transient session IDs.
- Reuse project 2's exact `ISpectatorCoordinator`, `SpectatorMatchDescriptor`, `SpectatorAuthorizationResult`, `SpectatorRole`, `SpectatorTransport`, and lifecycle behavior. Arena calls `RegisterContinuousMatchAsync`, `AuthorizeAsync(sessionId,userId,matchId,role)`, and `EndMatchAsync`; no new authorization interface/type is introduced and no continuous snapshot enters `SpectatorService` or the normal event bus.
- Keep `IGameEngine` limited to `AlternatingTurns` and `SimultaneousCommit`; Deathroll/RPS remain on `/games/action`, participant modals, and the normal event bus.

### Server Production Files

- Create `src/Brmble.Server/Games/Continuous/ContinuousContracts.cs`: transport-neutral continuous definition, simulation, input, snapshot, completion, and connection contracts.
- Create `src/Brmble.Server/Games/Continuous/FixedPoint.cs`: checked fixed-point vectors, integer square root, normalization, clamping, and deterministic hashing helpers.
- No production modification to `src/Brmble.Server/Games/Duels/GameDefinitionCatalog.cs` or `DuelMatchRunnerRouter.cs`: project 1 already catalogs `IDuelGameDefinition` and routes by `DuelConfiguration.RunnerKey`.
- Create `src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs`: monotonic 60 Hz scheduling, maximum-five catch-up, deadline resynchronization, and overload observations.
- Create `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs`: per-socket capacity-one replaceable snapshot queue with reliable control-message separation.
- Create `src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs`: cryptographically random, hashed, one-time 15-second capability issue/consume.
- Create `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`: initially compilable match registry/runner in Task 1, then participant attach/ack, input/heartbeat, reconnect, scheduler, snapshot socket fan-out, completion, `ForfeitAsync`, and live lookup in later tasks.
- Create `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs`: direct browser WebSocket upgrade, ticket consumption, protocol parsing, role enforcement, send/receive loops, and close cleanup.
- Create `src/Brmble.Server/Games/Continuous/ContinuousTelemetry.cs`: built-in meters and structured event records; no raw-input retention.
- Create `src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs`: every version-1 numeric gameplay and timing constant.
- Create `src/Brmble.Server/Games/Arena/ArenaModels.cs`: fixed-point Arena state, phases, players, projectiles, round/match outcomes, public snapshots, and persisted telemetry summary.
- Create `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`: deterministic phases, movement, collisions, charge/fire/cooldown/recoil, projectiles, dash, shrink, KO, BO3, and double-KO anti-loop.
- Create `src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs`: `arena-knockoff`/`bo3`/ruleset-1 configuration and simulation factory.
- Do not modify project 2's `SpectatorService` contracts: consume its existing `ISpectatorCoordinator` continuous registration/authorization/end methods.
- Modify `src/Brmble.Server/Games/GameEndpoints.cs`: issue authenticated realtime tickets only; high-frequency traffic never enters `/games/action`.
- Modify `src/Brmble.Server/Games/GamesExtensions.cs`: register Arena's definition and continuous runner alongside project 1's existing catalog/router registrations, plus ticket store, telemetry, and scheduler ownership.
- Modify `src/Brmble.Server/Program.cs`: map `/games/realtime` before reverse proxy and retain `/ws` for low-frequency events.

### Native Client Files

- Modify `src/Brmble.Client/Services/Games/GameService.cs`: add correlated `realtime-ticket` mTLS requests and return ticket/URL to React; never proxy realtime frames.
- Modify `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`: add reference-counted `game.inputCapture` hotkey suspension/resumption using the existing `InputRouter.Suspend()`/`Resume()` path.
- Modify `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`: ticket route and response correlation.
- Modify `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs`: Arena capture isolation and forced PTT release.

### Web Production Files

- Modify `docs/UI_GUIDE.md`: document Arena foreground Canvas, capture, identity, HUD, responsive, reduced-motion, audio, and session-mute patterns before UI implementation.
- Modify `src/Brmble.Web/src/api/games.ts`: exact realtime ticket response and request API while retaining project-1/2 contracts.
- Create `src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts`: protocol-v1 discriminated messages and runtime guards.
- Create `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`: matching fixed-step prediction math, world/screen transforms, interpolation, and reconciliation helpers.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts`: ticket acquisition, direct WebSocket lifecycle, attach acknowledgement, reconnect, heartbeat, input sequencing, and telemetry reports.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts`: local prediction/replay, mandatory snap rules, correction smoothing, remote/projectile/arena interpolation, and spectator no-prediction state.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts`: click-to-capture WASD/mouse/charge/fire/dash state, 30 Hz aim, 250 ms heartbeat, and neutral release.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaAudio.ts`: Web Audio unlock, restrained cues, saved volume, session mute, and teardown.
- Create `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts`: Canvas 2D uniform scale/letterbox renderer with avatar fallback and reduced-motion options.
- Create `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.tsx`: participant/spectator foreground host, accessible status/HUD, capture affordance, mute button, and lifecycle.
- Create `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.module.css`: token-only responsive foreground layout.
- Modify `src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx`: saved Arena game-volume slider in the existing Games tab.
- Modify `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`: persist `games.arenaVolume` with default `65`.
- Modify `src/Brmble.Web/src/components/Icon/Icon.tsx`: ensure the centralized map has exactly one `volume-2` and one `volume-x` definition, reusing an existing definition rather than duplicating it.
- Modify `src/Brmble.Web/src/hooks/useForegroundActivity.ts`: no contract change; consume the existing `kind: 'game'`, `gameType: 'arena-knockoff'`, and role values.
- Modify `src/Brmble.Web/src/App.tsx`: open participants from reliable lifecycle events, spectators from project-2 subscription flow, pause/restore remote shares, and close/reset consistently.

### Server And Web Tests

- Create `tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/FixedStepSchedulerTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/RealtimeTicketStoreTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/ContinuousTelemetryTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Continuous/ContinuousControlledBenchmarkTests.cs`: opt-in controlled benchmark assertions, excluded from ordinary CI.
- Create `tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Arena/ArenaCombatTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs`.
- Create `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaInput.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/Arena/useArenaAudio.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`.
- Create `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.test.tsx`.
- Create `src/Brmble.Web/src/App.arenaActivity.test.tsx`.

## Stable Continuous Contracts And Constants

Use these exact signatures. `InputSequence`, `ServerTick`, and spectator `Sequence` are distinct counters. Project-1 queue `Revision` remains unrelated.

```csharp
public enum RealtimeRole { Participant, Spectator }
public enum ContinuousMatchPhase { AwaitingParticipants, Loading, Positioning, Live, Ended }
public enum ContinuousRejectReason { StaleSequence, SequenceGap, InvalidRange, RateLimited, WrongMatch, WrongRole, PhaseDenied, Cooldown, DashSpent }

public sealed record ContinuousInput(
    long Sequence, long PredictedTick, short MoveX, short MoveY,
    short AimX, short AimY, bool Charging, bool FireReleased, bool Dash);
public sealed record ProcessedInput(long SessionId, long Sequence, long PredictedTick, long ReceivedTimestamp);
public sealed record ContinuousStepResult(bool Completed, ContinuousCompletion? Completion);
public sealed record ContinuousCompletion(
    string Outcome, string? AbandonReason, IReadOnlyList<CompletedParticipant> Participants,
    object MatchSummary, IReadOnlyDictionary<long, object> ParticipantStats);

public interface IContinuousSimulation
{
    long Tick { get; }
    ContinuousMatchPhase Phase { get; }
    void SetInput(long sessionId, ContinuousInput input);
    void SetNeutralInput(long sessionId);
    ContinuousStepResult Step();
    object ParticipantSnapshot(long sessionId, IReadOnlyDictionary<long, long> acknowledgedInputs);
    object SpectatorSnapshot();
    ulong DeterministicHash();
}

public interface IContinuousGameDefinition
{
    string GameType { get; }
    int RulesetVersion { get; }
    IContinuousSimulation Create(DuelReservation reservation);
    object PredictionConstants { get; }
}
```

`ArenaGameDefinition` implements project 1's exact `IDuelGameDefinition` and project 3's `IContinuousGameDefinition` in one class:

```csharp
public sealed class ArenaGameDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType => "arena-knockoff";
    public string RunnerKey => "continuous";
    public int RulesetVersion => 1;
    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
    {
        if (options is { Count: > 0 }) throw new InvalidGameConfigurationException("Arena options are not supported.");
        return new Dictionary<string, object?>();
    }
    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => "bo3";
    public IContinuousSimulation Create(DuelReservation reservation) => new ArenaSimulation(reservation);
    public object PredictionConstants => ArenaRulesetV1.PredictionConstants;
}
```

`ContinuousGameCoordinator` implements project 1's runner contract exactly:

```csharp
public sealed class ContinuousGameCoordinator : IDuelMatchRunner
{
    public string RunnerKey => "continuous";
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public Task<GameStartResult> StartAsync(DuelReservation reservation);
    public bool TryGetActiveMatch(long stableUserId, out ActiveMatchReference match);
    public Task ForfeitAsync(long matchId, long stableUserId, string reason);
}
```

Internally each live continuous match retains both maps from its immutable reservation: stable user ID to current participant session ID, and session ID to stable user ID. Runner ownership/forfeit uses stable IDs; realtime socket/input payloads use the currently bound session ID. Reconnect may replace the session value only after ticket authorization proves the same stable user. `DuelMatchRunnerRouter` remains project 1's sole `IDuelMatchRunnerRouter`; project 3 does not recreate or modify it.

`ArenaRulesetV1` contains no transport values and exactly these initial values:

```csharp
public static class ArenaRulesetV1
{
    public const int Version = 1;
    public const int UnitsPerWorldUnit = 1_000;
    public const int TickRate = 60;
    public const int SnapshotRate = 20;
    public const int SnapshotEveryTicks = 3;
    public const int MaxCatchUpTicks = 5;
    public const int LoadingTicks = 60;
    public const int PositioningTicks = 180;
    public const int InitialArenaRadius = 9_000;
    public const int CombatArenaRadius = 3_500;
    public const int SpawnOffset = 3_500;
    public const int PlayerRadius = 600;
    public const int BaseMovePerTick = 90;
    public const int ChargedMovePerTick = 45;
    public const int MomentumRetentionPermille = 920;
    public const int ChargeTicks = 90;
    public const int ForcedFireTicks = 30;
    public const int ShotCooldownTicks = 24;
    public const int ProjectileRadius = 180;
    public const int ProjectilePerTick = 240;
    public const int ProjectileBaseKnockback = 130;
    public const int ProjectileBonusKnockback = 220;
    public const int RecoilBase = 45;
    public const int RecoilBonus = 105;
    public const int DashTicks = 6;
    public const int DashPerTick = 240;
    public const int OpeningHoldTicks = 600;
    public const int NormalShrinkTicks = 1_800;
    public const int CollapseTicks = 1_200;
    public const int MaxConsecutiveDoubleKos = 3;
    public const int TargetRoundWins = 2;
    public const int AimQuantizationMax = 32_767;
}
```

Every signed integer division truncates toward zero in both C# and TypeScript; multiply in signed 64-bit before division and checked-cast to `int`. `NormalizeQ15(x,y)` returns zero for zero, otherwise `length=floor(sqrt(x*x+y*y))`; vectors with `length<=32767` are unchanged, and longer vectors become `(x*32767/length,y*32767/length)`. Charge permille is `min(1000, chargeTicks*1000/90)`. `MovePerTick(q)=90-45*q/1000`, `Knockback(q)=130+220*q/1000`, and `Recoil(q)=45+105*q/1000` after clamping `q` to 0-1000.

One authoritative tick uses this exact order: (1) decrement positive cooldown and an already-running forced-fire counter; (2) normalize/install held movement and aim; when Live, charging, and cooldown zero, increment charge by one to maximum 90 and, only on the 89-to-90 transition, set forced-fire to 30; stop charging outside Live or during cooldown; (3) process dash edges in ascending session ID and set six dash ticks; (4) process fire-release or forced-fire-zero in ascending session ID, spawning projectiles, adding recoil impulse to velocity, clearing charge/forced fire, and setting cooldown 24; (5) add movement displacement directly to position using charge-adjusted speed; (6) add dash displacement when `DashTicks>0`, then decrement dash ticks; (7) integrate velocity as `position += velocity`; (8) damp each velocity component as `velocity=velocity*920/1000`; (9) resolve the one player-body overlap; (10) advance projectiles in projectile-ID order and resolve opponent hits, adding knockback impulse to opponent velocity for the next tick; (11) remove hit/out-of-arena projectiles; (12) update live shrink tick/radius; (13) evaluate both player centers against the updated radius; (14) classify/finish/reset round; (15) increment server tick and capture a snapshot when divisible by three. A release edge at charge zero fires immediately. The first forced shot occurs on the 30th tick after reaching maximum charge. Impulses change velocity only; movement/dash change position only. Collision separation changes position only and leaves velocity unchanged.

For overlap, let `dx=high.X-low.X`, `dy=high.Y-low.Y`, `distance=floor(sqrt(dx*dx+dy*dy))`, and `penetration=1200-distance`. If `distance=0`, use normal `(32767,0)`. Otherwise normal is `(dx*32767/distance,dy*32767/distance)`. Move low by `-normal*(penetration/2)/32767`; move high by `normal*(penetration-penetration/2)/32767`, so the higher session ID receives the odd unit. A projectile hit uses `(projectile.Vx,projectile.Vy)` normalized to Q15 and adds `normal.Scale(Knockback(q))`; recoil subtracts `aim.Scale(Recoil(q))`.

Shrink uses live tick `t` before step (12): `radius=9000` for `0<=t<600`; `radius=9000-(5500*(t-599)/1800)` for `600<=t<2400`; `radius=3500-(3500*(t-2399)/1200)` for `2400<=t<3600`; and `0` for `t>=3600`. Therefore radii at ticks `599,600,2399,2400,3599,3600` are `9000,8997,3500,3498,0,0`. Boundary equality is inside; only squared distance greater than squared radius is outside.

Both implementations must pass the same golden vectors:

```text
normalize(32767,32767)=(23170,23170)
normalize(-32767,32767)=(-23170,23170)
move(q=333)=76; knockback(q=333)=203; recoil(q=333)=79
velocity(350,-151) after damping=(322,-138)
coincident sessions 10/20 at (0,0) => (-600,0)/(600,0)
overlap sessions 10 at (0,0), 20 at (1000,0) => (-100,0)/(1100,0)
radius(599,600,2399,2400,3599,3600)=9000,8997,3500,3498,0,0
```

## Realtime Protocol Version 1

The browser requests `POST /games/realtime-ticket` through `GameService` with `{"matchId":91,"role":"participant"}`. Success is:

```json
{"protocolVersion":1,"ticket":"9T3rFfH8hF6Jf9vC7RMX6PjzHgMXdQ4cT3m_8FjTziQ","url":"wss://chat.example/games/realtime","expiresAt":"2026-07-25T14:30:15.0000000+00:00"}
```

The ticket has 256 random bits, is stored only as SHA-256, expires after 15 seconds, is bound to stable user ID, current Mumble session, match, and role, and is atomically removed by `TryConsume`. A failed scope check does not reveal which field differed. Reconnect always requests a new ticket.

Client-to-server messages:

```json
{"type":"attachAck","protocolVersion":1,"matchId":91,"snapshotSequence":1}
{"type":"input","protocolVersion":1,"matchId":91,"sequence":42,"predictedTick":812,"moveX":32767,"moveY":0,"aimX":23170,"aimY":23170,"charging":true,"fireReleased":false,"dash":false}
{"type":"heartbeat","protocolVersion":1,"matchId":91,"sequence":43,"predictedTick":815,"moveX":32767,"moveY":0,"aimX":23170,"aimY":23170,"charging":true}
{"type":"telemetry","protocolVersion":1,"matchId":91,"samples":20,"meanCorrection":74,"maxCorrection":310,"snaps":1}
```

Server-to-client reliable control and replaceable snapshot messages:

```json
{"type":"welcome","protocolVersion":1,"rulesetVersion":1,"matchId":91,"role":"participant","sessionId":10,"snapshotSequence":1,"serverTick":0,"tickRate":60,"snapshotRate":20,"interpolationMs":100,"maxExtrapolationMs":50,"inputHeartbeatMs":250,"neutralAfterMs":750,"reconnectGraceMs":5000,"prediction":{"unitsPerWorldUnit":1000,"playerRadius":600,"baseMovePerTick":90,"chargedMovePerTick":45,"momentumRetentionPermille":920,"chargeTicks":90,"forcedFireTicks":30,"shotCooldownTicks":24,"projectileRadius":180,"projectilePerTick":240,"projectileBaseKnockback":130,"projectileBonusKnockback":220,"recoilBase":45,"recoilBonus":105,"dashTicks":6,"dashPerTick":240},"state":{"phase":"awaitingParticipants"}}
{"type":"snapshot","protocolVersion":1,"matchId":91,"sequence":28,"serverTick":81,"generatedAtUnixMs":1784989801350,"phase":"positioning","phaseEndsAtTick":240,"score":[0,0],"consecutiveDoubleKos":0,"arena":{"radius":9000,"shrinkPhase":"hold"},"players":[{"sessionId":10,"side":0,"x":-3500,"y":0,"vx":0,"vy":0,"aimX":32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":42},{"sessionId":20,"side":1,"x":3500,"y":0,"vx":0,"vy":0,"aimX":-32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":37}],"projectiles":[]}
{"type":"inputRejected","protocolVersion":1,"matchId":91,"sequence":44,"reason":"phaseDenied"}
{"type":"connectionState","protocolVersion":1,"matchId":91,"sessionId":20,"state":"reconnecting","graceEndsAtUnixMs":1784989806000}
{"type":"matchClosed","protocolVersion":1,"matchId":91,"sequence":121,"serverTick":3601,"reason":"completed","finalState":{"phase":"ended","phaseEndsAtTick":null,"score":[2,1],"consecutiveDoubleKos":0,"arena":{"radius":0,"shrinkPhase":"collapse"},"players":[{"sessionId":10,"side":0,"x":-3010,"y":22,"vx":0,"vy":0,"aimX":32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":false,"acknowledgedInput":88},{"sessionId":20,"side":1,"x":3510,"y":14,"vx":0,"vy":0,"aimX":-32767,"aimY":0,"chargePermille":0,"forcedFireTicks":null,"cooldownTicks":0,"dashAvailable":true,"acknowledgedInput":91}],"projectiles":[]}}
```

Reliable controls use a bounded capacity-16 channel. Coalescible `connectionState` and `inputRejected` entries replace an older entry with the same `(type,sessionId)` or `(type,sequence)` key; noncoalescible `welcome` and `matchClosed` reserve two slots and a writer that cannot enqueue them closes the socket as overloaded. Snapshots use capacity one with `DropOldest`. The send loop sends at most four controls, then the latest snapshot, preventing snapshot starvation. `matchClosed` is the authoritative complete final snapshot; the server awaits its successful send (two-second timeout) before initiating normal close, and the client renders it before acknowledging the close event. Spectators cannot send input/heartbeat/telemetry.

## Task 1: Add Shared Definitions And A Compilable Continuous Coordinator

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/ContinuousContracts.cs`
- Create: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousContractTests.cs`

- [ ] **Step 1: Write failing catalog and router tests**

```csharp
[TestMethod]
public async Task ArenaConfiguration_DispatchesToContinuousRunnerWithoutChangingReservation()
{
    var reservation = TestReservation(gameType: "arena-knockoff", format: "bo3", rulesetVersion: 1,
        runnerKey: "continuous", playerOneSessionId: 10, playerOneUserId: 501,
        playerTwoSessionId: 20, playerTwoUserId: 502);
    var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);
    var continuous = new ContinuousGameCoordinator([definition], TimeProvider.System,
        Mock.Of<ICompletedMatchSink>(), Mock.Of<IGameEventPublisher>(), Mock.Of<ISpectatorCoordinator>());
    IDuelMatchRunnerRouter router = new DuelMatchRunnerRouter([continuous]);
    var result = await router.StartAsync(reservation);
    Assert.IsTrue(result.Success);
    Assert.IsTrue(router.TryGetActiveMatch(501, out var active));
    Assert.AreEqual(result.MatchId, active.MatchId);
    Assert.AreEqual(reservation.ReservationId, active.ReservationId);
    Assert.AreEqual("continuous", active.RunnerKey);
}

[TestMethod]
public void SharedCatalog_NormalizesFakeContinuousDefinition()
{
    var definition = new FakeContinuousDefinition("arena-knockoff", "bo3", 1);
    var actual = new GameDefinitionCatalog([definition]).Create("arena-knockoff", null);
    Assert.AreEqual("arena-knockoff", actual.GameType);
    Assert.AreEqual("bo3", actual.Format);
    Assert.AreEqual(1, actual.RulesetVersion);
    Assert.AreEqual(0, actual.Options.Count);
    Assert.AreEqual("continuous", actual.RunnerKey);
    Assert.ThrowsException<InvalidGameConfigurationException>(() =>
        definition.NormalizeOptions(new Dictionary<string, object?> { ["bestOf"] = 5 }));
}

[TestMethod]
public async Task ExistingRouter_ForfeitAndLookupUseStableUserId()
{
    var h = ContinuousHarness.Started(playerOneSessionId: 10, playerOneUserId: 501);
    Assert.IsTrue(h.Router.TryGetActiveMatch(501, out var active));
    await h.Router.ForfeitAsync(active.MatchId, 501, "disconnect");
    Assert.IsFalse(h.Router.TryGetActiveMatch(501, out _));
    Assert.IsFalse(h.Coordinator.TryGetActiveMatch(501, out _));
}
```

- [ ] **Step 2: Run the contract tests and verify missing types fail compilation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousContractTests`

Expected: FAIL with `CS0246` for `IContinuousGameDefinition` and `ContinuousGameCoordinator`; project 1's `IDuelGameDefinition`, `DuelMatchRunnerRouter`, `DuelConfiguration.RunnerKey`, and stable-user signatures already compile.

- [ ] **Step 3: Add a fake continuous definition using the exact project-1 definition contract**

```csharp
internal sealed class FakeContinuousDefinition : IDuelGameDefinition, IContinuousGameDefinition
{
    public string GameType { get; }
    public string RunnerKey => "continuous";
    public int RulesetVersion { get; }
    private readonly string _format;
    public FakeContinuousDefinition(string gameType, string format, int rulesetVersion) =>
        (GameType, _format, RulesetVersion) = (gameType, format, rulesetVersion);
    public IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
    {
        if (options is { Count: > 0 }) throw new InvalidGameConfigurationException("Arena options are not supported.");
        return new Dictionary<string, object?>();
    }
    public string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions) => _format;
    public IContinuousSimulation Create(DuelReservation reservation) => new FakeSimulation();
    public object PredictionConstants => new { };
}
```

Pass this fake directly to project 1's existing `GameDefinitionCatalog(IEnumerable<IDuelGameDefinition>)`. The canonical configuration assertion must include `RunnerKey="continuous"`. Do not modify the catalog, add an adapter, or create another definition/runtime-kind abstraction.

- [ ] **Step 4: Create a minimal coordinator before any later modify task**

Create `ContinuousGameCoordinator : IDuelMatchRunner` with `RunnerKey => "continuous"`, a concurrent match dictionary, monotonic match IDs, exact `StartAsync(DuelReservation)`, `TryGetActiveMatch(long stableUserId,out ActiveMatchReference)`, `ForfeitAsync(long matchId,long stableUserId,string reason)`, and `MatchCompleted`. Index both `reservation.PlayerOne.UserId` and `PlayerTwo.UserId`; retain their session IDs only inside live state for realtime input routing. Task 1 creates/removes a fake simulation and raises an abandoned completion; scheduler/socket behavior is added later. This makes Tasks 7/8 valid `Modify` operations.

- [ ] **Step 5: Prove compatibility with project 1's existing router**

Instantiate project 1's `DuelMatchRunnerRouter([continuous])`. Its existing `StartAsync` selects `reservation.Configuration.RunnerKey`, and its existing lookup/forfeit methods pass stable user IDs to the coordinator. Do not create `DuelMatchRouter`, modify `GameSessionManager`, or duplicate router ownership maps.

- [ ] **Step 6: Run focused tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousContractTests`

Expected: PASS; Task 1 compiles without Arena production types, `RunnerKey="continuous"` flows through the existing catalog/router, stable user 501 owns the match despite session 10, and no parallel abstraction exists.

- [ ] **Step 7: Commit the compiling reusable boundary**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousContracts.cs src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousContractTests.cs
git commit -m "refactor: add continuous game runtime boundaries"
```

## Task 2: Implement Checked Fixed-Point Math And Arena Ruleset V1

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/FixedPoint.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`

- [ ] **Step 1: Write failing normalization, symmetry, overflow, and curve tests**

```csharp
[DataTestMethod]
[DataRow(32767, 0, 32767, 0)]
[DataRow(32767, 32767, 23170, 23170)]
[DataRow(-32767, 32767, -23170, 23170)]
[DataRow(0, 0, 0, 0)]
public void NormalizeQ15_IsDeterministic(int x, int y, int expectedX, int expectedY) =>
    Assert.AreEqual(new FixedVec(expectedX, expectedY), FixedVec.NormalizeQ15(x, y));

[TestMethod]
public void ChargeCurves_ClampAtEndpoints()
{
    Assert.AreEqual(90, ArenaRulesetV1.MovePerTick(0));
    Assert.AreEqual(45, ArenaRulesetV1.MovePerTick(1000));
    Assert.AreEqual(350, ArenaRulesetV1.Knockback(1000));
    Assert.AreEqual(150, ArenaRulesetV1.Recoil(1000));
}

[DataTestMethod]
[DataRow(599, 9000)]
[DataRow(600, 8997)]
[DataRow(2399, 3500)]
[DataRow(2400, 3498)]
[DataRow(3599, 0)]
[DataRow(3600, 0)]
public void ArenaRadius_UsesExactInclusiveBoundaries(int tick, int radius) =>
    Assert.AreEqual(radius, ArenaRulesetV1.ArenaRadius(tick));
```

- [ ] **Step 2: Run tests and verify the math types are absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests`

Expected: FAIL with missing `FixedVec` and `ArenaRulesetV1`.

- [ ] **Step 3: Implement integer-only vector operations**

```csharp
public readonly record struct FixedVec(int X, int Y)
{
    public static FixedVec NormalizeQ15(int x, int y)
    {
        if (x == 0 && y == 0) return default;
        var length = IntegerSqrt(checked((long)x * x + (long)y * y));
        if (length <= 32_767) return new(x, y);
        return new(checked((int)(x * 32_767L / length)), checked((int)(y * 32_767L / length)));
    }
    public FixedVec Scale(int amount) => new(
        checked((int)(X * (long)amount / 32_767)), checked((int)(Y * (long)amount / 32_767)));
}
```

Use the restoring integer-square-root algorithm over `ulong`; all products widen to `long`, state writes use `checked`, and deterministic hash serialization writes fields in declared order as little-endian integers into FNV-1a 64.

- [ ] **Step 4: Add every ruleset constant and exact linear helper from the constants section**

`MovePerTick(q) = 90 - 45 * Clamp(q,0,1000) / 1000`, `Knockback(q) = 130 + 220 * q / 1000`, and `Recoil(q) = 45 + 105 * q / 1000`.

- [ ] **Step 5: Run fixed-point tests on x64**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~FixedPointTests -a x64`

Expected: PASS for axes, diagonals, zero, sign symmetry, golden curve/velocity/collision/shrink vectors, overflow rejection, and stable hash bytes.

- [ ] **Step 6: Implement and run the same golden vectors in TypeScript**

`arenaMath.ts` uses `Math.trunc`, `BigInt` for widened products and integer square root, then checked conversion to `number`. Copy the seven golden-vector lines from the Stable Contracts section into table-driven Vitest assertions; do not duplicate different expected values.

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS with byte-for-byte-equivalent integer outputs for normalization, curves, damping, collision, and shrink boundaries.

- [ ] **Step 7: Commit deterministic primitives**

```bash
git add src/Brmble.Server/Games/Continuous/FixedPoint.cs src/Brmble.Server/Games/Arena/ArenaRulesetV1.cs tests/Brmble.Server.Tests/Games/Continuous/FixedPointTests.cs src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts
git commit -m "feat: add deterministic fixed-point arena rules"
```

## Task 3: Implement Arena Phases, Movement, Collision, And Shrink

**Files:**
- Create: `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs`

- [ ] **Step 1: Write failing exact-tick phase and action-gate tests**

```csharp
[TestMethod]
public void RoundIntroduction_UsesSixtyLoadingAndOneHundredEightyPositioningTicks()
{
    var sim = ArenaHarness.AttachedAndAcknowledged();
    sim.Step(59); Assert.AreEqual(ContinuousMatchPhase.Loading, sim.Phase);
    sim.Step(1); Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
    sim.Step(179); Assert.AreEqual(ContinuousMatchPhase.Positioning, sim.Phase);
    sim.Step(1); Assert.AreEqual(ContinuousMatchPhase.Live, sim.Phase);
}

[TestMethod]
public void CoincidentPlayers_SeparateOnStableSessionIdAxis()
{
    var sim = ArenaHarness.Live(sessionIds: [20, 10]);
    sim.PlaceBoth(0, 0); sim.Step();
    Assert.IsTrue(sim.Player(10).X < sim.Player(20).X);
    Assert.IsTrue(sim.DistanceSquared() >= 1_440_000L);
}
```

- [ ] **Step 2: Run phase tests and verify simulation types are missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaPhaseAndMovementTests`

Expected: FAIL with missing Arena state and simulation.

- [ ] **Step 3: Add complete state records**

```csharp
public enum ArenaShrinkPhase { Hold, Normal, Collapse }
public enum ArenaKnockoutCause { OpponentProjectile, Recoil, DashOrMovement, Collapse }
public sealed record ArenaProjectile(long Id, long OwnerSessionId, int X, int Y, int Vx, int Vy, int ChargePermille);
public sealed class ArenaPlayerState
{
    public required long SessionId { get; init; }
    public required int Side { get; init; }
    public int X; public int Y; public int Vx; public int Vy;
    public int AimX; public int AimY; public int ChargeTicks; public int ForcedFireTicks;
    public int CooldownTicks; public int DashTicks; public bool DashAvailable = true;
    public ContinuousInput Input = new(0, 0, 0, 0, 32767, 0, false, false, false);
}
```

- [ ] **Step 4: Implement phase gates and deterministic body resolution**

Loading ignores all gameplay. Positioning applies normalized movement and body collision but ignores charge/fire/dash. Live enables all actions. Implement the exact 15-stage tick ordering, truncation, movement/velocity distinction, impulse timing, and collision formulas from Stable Continuous Contracts; no task may reorder them.

- [ ] **Step 5: Implement exact arena radius and boundary semantics**

Only Live advances shrink time. Implement the exact piecewise formulas and test all six boundary vectors `599/600/2399/2400/3599/3600`. A center with `x*x+y*y > radius*radius` is outside; equality is inside. Add tests at radius 3500 for centers `(3500,0)` inside and `(3501,0)` outside.

- [ ] **Step 6: Run phase/movement tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaPhaseAndMovementTests`

Expected: PASS for mirrored spawn, phase gates, normalized diagonal movement, charge slowdown, stable collision, no overlap, exact shrink ticks, and boundary equality.

- [ ] **Step 7: Commit the Arena movement core**

```bash
git add src/Brmble.Server/Games/Arena/ArenaModels.cs src/Brmble.Server/Games/Arena/ArenaSimulation.cs src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs tests/Brmble.Server.Tests/Games/Arena/ArenaPhaseAndMovementTests.cs
git commit -m "feat: simulate arena phases movement and collision"
```

## Task 4: Add Charge, Fire, Cooldown, Recoil, Projectiles, And Dash

**Files:**
- Modify: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaCombatTests.cs`

- [ ] **Step 1: Write failing cadence and forced-fire tests**

```csharp
[TestMethod]
public void MaximumCharge_ForceFiresAfterThirtyTicksAndStartsTwentyFourTickCooldown()
{
    var sim = ArenaHarness.Live();
    sim.HoldCharge(10, 120); sim.Step(119);
    Assert.AreEqual(0, sim.Projectiles.Count);
    sim.Step();
    Assert.AreEqual(1, sim.Projectiles.Count);
    Assert.AreEqual(24, sim.Player(10).CooldownTicks);
    Assert.AreEqual(1000, sim.Projectiles[0].ChargePermille);
}

[TestMethod]
public void ChargeDoesNotChangeProjectileRadiusOrSpeed()
{
    var low = ArenaHarness.Fire(chargeTicks: 0);
    var high = ArenaHarness.Fire(chargeTicks: 90);
    Assert.AreEqual(180, low.ProjectileRadius);
    Assert.AreEqual(low.ProjectileVelocityLengthSquared, high.ProjectileVelocityLengthSquared);
}
```

- [ ] **Step 2: Run combat tests and verify missing behavior**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaCombatTests`

Expected: FAIL because firing, projectiles, recoil, and dash are not applied.

- [ ] **Step 3: Implement edge-deduplicated fire and cooldown**

On a rising `FireReleased` edge, fire even at charge 0 only when Live and cooldown is 0. Maximum charge starts a 30-tick forced-fire counter; fire automatically when it reaches 0. Spawn at `player center + aim * (600 + 180)`, velocity `aim * 240`, apply opposite recoil, reset charge, and set cooldown 24. Ignore charge starts during cooldown.

- [ ] **Step 4: Implement projectile collision and removal**

Advance projectiles in ascending projectile ID. They do not compare with each other, compare only with the opposing body using radius sum 780, apply `Knockback(chargePermille)` along travel, increment shot/hit telemetry, and disappear after hit or when their center is outside current arena radius.

- [ ] **Step 5: Implement one-use collision-respecting dash**

On a deduplicated Dash edge in Live, consume availability and set six dash ticks. Each tick moves 240 along normalized movement, or aim if stationary, then resolves solid body collision. No invulnerability or boundary clamp applies; round reset restores availability.

- [ ] **Step 6: Run combat tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ArenaCombatTests`

Expected: PASS for immediate low shot, cooldown rejection, forced fire, constant projectile geometry/speed, pass-through projectiles, opponent-only hits, charge-scaled force/recoil, multiple projectiles, one-use dash, stationary aim dash, collision, and self-KO setup.

- [ ] **Step 7: Commit Arena combat**

```bash
git add src/Brmble.Server/Games/Arena/ArenaSimulation.cs tests/Brmble.Server.Tests/Games/Arena/ArenaCombatTests.cs
git commit -m "feat: add arena projectiles recoil and dash"
```

## Task 5: Complete BO3 Rounds, KO Causes, And Double-KO Anti-Loop

**Files:**
- Modify: `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- Modify: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs`

- [ ] **Step 1: Write failing round/match outcome tests**

```csharp
[TestMethod]
public void FourthConsecutiveSameTickDoubleKo_EndsMatchDrawWithoutScoreChange()
{
    var sim = ArenaHarness.Live();
    for (var replay = 1; replay <= 4; replay++)
    {
        sim.PlaceBothOutside(); sim.Step();
        if (replay < 4) { CollectionAssert.AreEqual(new[] { 0, 0 }, sim.Score.ToArray()); sim.StepRoundIntroduction(); }
    }
    Assert.IsTrue(sim.Completed);
    Assert.AreEqual("draw", sim.Completion!.Outcome);
    Assert.AreEqual(4, sim.Telemetry.DoubleKoReplays);
}

[TestMethod]
public void FirstToTwoWinsCompletesBo3AndDecisiveRoundResetsDoubleKoCounter()
{
    var sim = ArenaHarness.Live();
    sim.DoubleKo(); sim.WinRound(10); sim.WinRound(10);
    CollectionAssert.AreEqual(new[] { 2, 0 }, sim.Score.ToArray());
    Assert.AreEqual(0, sim.ConsecutiveDoubleKos);
    Assert.AreEqual("decided", sim.Completion!.Outcome);
}
```

- [ ] **Step 2: Run match tests and verify terminal behavior fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ArenaMatchTests|FullyQualifiedName~ArenaDeterminismTests"`

Expected: FAIL because scoring, replay, telemetry, and completion are incomplete.

- [ ] **Step 3: Implement same-tick terminal classification**

Evaluate both centers only after all movement, collision, recoil, projectile, and radius updates for the tick. One outside is a round loss; both outside is a double KO. Classify the most recent boundary-causing event as `OpponentProjectile`, `Recoil`, `DashOrMovement`, or `Collapse`; ordinary movement and dash share `DashOrMovement` in persisted telemetry.

- [ ] **Step 4: Reset all round state and enforce BO3/anti-loop**

Every replay/round clears momentum, projectiles, charge, forced fire, cooldown, shrink tick, and inputs; restores dash; mirrors spawn; and runs Loading plus Positioning again. Double KO does not score and increments the consecutive count. Counts 1-3 replay; count 4 completes a draw. Any decisive round resets the count; first score of 2 completes.

- [ ] **Step 5: Add deterministic stream/hash tests**

Generate the exact 3,600-input stream with seed `0xA8E1` only in the test generator, run it twice with player order `[10,20]`, and assert every-tick hashes and completion match. Run with mirrored inputs/player sides and assert mirrored scores/outcomes. Randomness is test-data generation only and never enters `ArenaSimulation`.

- [ ] **Step 6: Run all Arena simulation tests repeatedly**

Run: `1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Arena"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`

Expected: PASS all 20 runs with identical hashes, exact phases, BO3 completion, and bounded symmetric double-KO behavior.

- [ ] **Step 7: Commit complete Arena ruleset v1**

```bash
git add src/Brmble.Server/Games/Arena/ArenaModels.cs src/Brmble.Server/Games/Arena/ArenaSimulation.cs tests/Brmble.Server.Tests/Games/Arena/ArenaMatchTests.cs tests/Brmble.Server.Tests/Games/Arena/ArenaDeterminismTests.cs
git commit -m "feat: complete arena knockoff ruleset v1"
```

## Task 6: Add 60 Hz Scheduling And Replaceable 20 Hz Backpressure

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs`
- Create: `src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/FixedStepSchedulerTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs`

- [ ] **Step 1: Write failing cadence, catch-up, and replacement tests**

```csharp
[TestMethod]
public void DelayedCycle_RunsAtMostFiveTicksAndResynchronizesDeadline()
{
    var clock = new ManualTimestampClock(frequency: 60_000);
    var sut = new FixedStepScheduler(clock, tickRate: 60, maxCatchUpTicks: 5);
    sut.Start(clock.Timestamp);
    clock.AdvanceMilliseconds(200);
    var cycle = sut.PlanCycle();
    Assert.AreEqual(5, cycle.Ticks);
    Assert.IsTrue(cycle.Overloaded);
    Assert.AreEqual(clock.Timestamp + 1_000L, cycle.NextDeadline);
}

[TestMethod]
public void RationalPeriod_ProducesExactlySixtyDeadlinesPerSecond()
{
    var sut = new FixedStepScheduler(new ManualTimestampClock(10_000_000), 60, 5);
    sut.Start(0);
    CollectionAssert.AreEqual(new long[] { 166_666, 333_333, 500_000, 666_666, 833_333, 1_000_000 },
        Enumerable.Range(0, 6).Select(_ => sut.AdvanceDeadline()).ToArray());
    for (var i = 6; i < 60; i++) sut.AdvanceDeadline();
    Assert.AreEqual(10_000_000L, sut.NextDeadline);
}

[TestMethod]
public async Task SlowWriter_ReceivesLatestSnapshotNotTwentyQueuedSnapshots()
{
    var box = new RealtimeSnapshotMailbox();
    for (var i = 1; i <= 20; i++) box.ReplaceSnapshot($"s{i}");
    Assert.AreEqual("s20", await box.ReadSnapshotAsync(default));
    Assert.AreEqual(19, box.DroppedSnapshots);
}
```

- [ ] **Step 2: Run tests and verify scheduler/mailbox are missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~FixedStepSchedulerTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: FAIL with missing classes.

- [ ] **Step 3: Implement monotonic deadline arithmetic**

Use `TimeProvider.GetTimestamp()` and a rational accumulator: `basePeriod=frequency/60`, `remainder=frequency%60`, `carry+=remainder`, then add `basePeriod+(carry>=60?1:0)` and subtract 60 on carry. Never repeatedly truncate `frequency/60`. Normal catch-up advances the previous deadline once per simulated tick; after five overdue ticks, record overload, clear carry, and schedule the first new deadline from `now` with the same rational formula.

- [ ] **Step 4: Implement separate reliable and replacement queues**

Expose `WriteControl(RealtimeControl)`, `ReplaceSnapshot(string)`, `ReadNextAsync`, and `DroppedSnapshots`. Implement the bounded/coalesced capacity-16 rules from Realtime Protocol Version 1 and the maximum-four-control fairness rule; obsolete snapshots can be dropped, terminal state cannot.

- [ ] **Step 5: Run cadence tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~FixedStepSchedulerTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: PASS for 60 ticks/second, snapshots on ticks divisible by 3, five-tick maximum, resync, latest-only replacement, and reliable control ordering.

- [ ] **Step 6: Commit scheduling and backpressure**

```bash
git add src/Brmble.Server/Games/Continuous/FixedStepScheduler.cs src/Brmble.Server/Games/Continuous/RealtimeSnapshotMailbox.cs tests/Brmble.Server.Tests/Games/Continuous/FixedStepSchedulerTests.cs tests/Brmble.Server.Tests/Games/Continuous/RealtimeSnapshotMailboxTests.cs
git commit -m "feat: schedule continuous matches with snapshot backpressure"
```

## Task 7: Validate Inputs, Heartbeats, And Neutral Timeout

**Files:**
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs`

- [ ] **Step 1: Write failing sequence/rate/neutral tests**

```csharp
[TestMethod]
public void InputValidation_DeduplicatesEdgesRejectsGapAndNeutralizesAfterSevenHundredFiftyMs()
{
    var h = CoordinatorHarness.LiveArena();
    Assert.IsTrue(h.Input(10, Seq(1, dash: true)).Accepted);
    Assert.AreEqual(ContinuousRejectReason.StaleSequence, h.Input(10, Seq(1, dash: true)).Reason);
    Assert.AreEqual(ContinuousRejectReason.SequenceGap, h.Input(10, Seq(3)).Reason);
    h.AdvanceMilliseconds(751);
    Assert.IsTrue(h.InputFor(10).IsNeutral);
    Assert.IsFalse(h.Simulation.Player(10).DashAvailable);
}
```

- [ ] **Step 2: Run input tests and verify validation is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousInputTests`

Expected: FAIL because coordinator input validation is missing.

- [ ] **Step 3: Add exact limits and validation order**

Accept at most 120 total input/heartbeat messages and 30 aim-changing messages per rolling second per participant. Require exactly `sequence==lastAccepted+1`; reject `<=lastAccepted` as stale and `>lastAccepted+1` as `SequenceGap`. Require predicted tick in `[serverTick-120,serverTick+30]`, each axis in `[-32767,32767]`, normalized movement, nonzero normalized aim, matching match/participant role, and phase-legal edges. Rejected messages do not advance acknowledgement. Server welcome/snapshot always reports `acknowledgedInput`; a new connection's first legal sequence is exactly `acknowledgedInput+1`.

- [ ] **Step 4: Install neutral state on every required path**

Heartbeat carries complete held state. Track last accepted input/heartbeat monotonic timestamp; after 750 ms neutralize movement and charging without restoring spent edges. Also neutralize immediately on participant socket loss, explicit capture release input, replacement socket attach, and match teardown.

- [ ] **Step 5: Run input tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousInputTests`

Expected: PASS for exact-next ordering, gap rejection, deduplication, ranges, normalization, 120/30 Hz limits, role/phase/cooldown/dash rejection, 250 ms heartbeat acceptance, 750 ms neutralization, and acknowledgements.

- [ ] **Step 6: Commit authoritative input handling**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs
git commit -m "feat: validate continuous inputs and stale heartbeats"
```

## Task 8: Implement Participant Attach Gate, Reconnect Grace, Completion, And Persistence

**Files:**
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`

- [ ] **Step 1: Write failing attach/reconnect/completion tests**

```csharp
[TestMethod]
public async Task FirstLoadingWaitsForBothAttachAcksAndFifteenSecondFailureForfeits()
{
    var h = CoordinatorHarness.StartedArena();
    await h.AttachParticipantAsync(10, acknowledge: true);
    h.AdvanceSeconds(14); Assert.AreEqual(ContinuousMatchPhase.AwaitingParticipants, h.Phase);
    h.AdvanceSeconds(1);
    Assert.AreEqual("connection_timeout", h.CompletedMatch.AbandonReason);
    Assert.AreEqual(502, h.CompletedMatch.Participants.Single(x => x.Result == "abandoned").UserId);
}

[TestMethod]
public async Task ReconnectWithinFiveSecondsGetsCompleteSnapshotAndNoStaleInput()
{
    var h = CoordinatorHarness.LiveArena();
    await h.DisconnectAsync(10); h.AdvanceMilliseconds(4_999);
    var welcome = await h.ReattachAsync(10);
    Assert.AreEqual(h.ServerTick, welcome.ServerTick);
    Assert.AreEqual(welcome.AcknowledgedInput + 1, h.NextAcceptedSequence(10));
    Assert.IsTrue(h.InputFor(10).IsNeutral);
    Assert.IsNull(h.CompletedMatch);
}
```

- [ ] **Step 2: Run coordinator tests and verify lifecycle failures**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousGameCoordinatorTests`

Expected: FAIL because attach acknowledgement, reconnect grace, and completion routing are incomplete.

- [ ] **Step 3: Implement start and first-round gate**

`StartAsync(DuelReservation)` requires `reservation.Configuration.RunnerKey == RunnerKey`, validates canonical Arena config, creates AwaitingParticipants state, indexes stable users from `DuelPlayer.UserId`, stores current realtime sessions from `DuelPlayer.SessionId`, publishes reliable `game.started` through the normal event bus, and arms one generation-safe 15-second timer. Each participant socket receives welcome plus complete sequence 1 and must send matching `attachAck`; only both acknowledgements transition to Loading. Spectator sockets do not satisfy the gate.

- [ ] **Step 4: Implement non-pausing five-second reconnect grace**

Socket loss immediately neutralizes input and publishes `connectionState`; simulation continues. A fresh participant ticket/socket for the same stable user may replace its transient session mapping, sends a complete snapshot containing the last accepted input acknowledgement, and resumes at exactly `acknowledgedInput+1`. Grace expiry calls `ContinuousGameCoordinator.ForfeitAsync(matchId,stableUserId,"realtime_disconnect")`. Project 1 already routes voice leave/disconnect immediately through `IDuelMatchRunnerRouter.TryGetActiveMatch(stableUserId,...)` and `ForfeitAsync(...,stableUserId,...)`; do not modify that presence flow.

- [ ] **Step 5: Build shared completion records and release before persistence retry**

Produce `CompletedMatch("arena-knockoff", channelId, "bo3", 1, outcome, abandonReason, startedAt, endedAt, participants, metadataJson)` with persisted participant IDs from `DuelPlayer.UserId`, never session IDs. Metadata schema 1 contains final score, rounds played, double-KO replays, round durations, KO causes, shot/hit counts, fired/landed charge arrays, dash use, and KO radii. Enqueue through project 1's `ICompletedMatchSink`, remove stable-user indexes, raise unchanged `MatchCompletion(matchId,reservationId,channelId,playerOne,playerTwo,configuration,endedAt)`, then publish `game.ended`; never await persistence before queue advancement.

- [ ] **Step 6: Register the definition and runner in project 1's existing collections**

Register `ArenaGameDefinition` once as concrete, `IDuelGameDefinition`, and `IContinuousGameDefinition`. Register `ContinuousGameCoordinator` once as concrete and another `IDuelMatchRunner`; project 1's existing `DuelMatchRunnerRouter(IEnumerable<IDuelMatchRunner>)` discovers both `RunnerKey="discrete"` and `RunnerKey="continuous"`. Inject project 2's existing `ISpectatorCoordinator` into the coordinator. Do not replace `IDuelMatchRunnerRouter`, alter `GameSessionManager`, or bind continuous state to the discrete spectator source.

- [ ] **Step 7: Run continuous plus discrete lifecycle tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~GameSessionManagerTests|FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~SpectatorServiceTests|FullyQualifiedName~MumbleServerCallbackTests"`

Expected: PASS; initial gate, later immediate Loading, reconnect, immediate voice forfeit, persistence enqueue, queue advancement, and Deathroll/RPS behavior coexist.

- [ ] **Step 8: Commit coordinator lifecycle integration**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs
git commit -m "feat: coordinate continuous match lifecycle and reconnects"
```

## Task 9: Issue Bounded One-Time Tickets Through Existing mTLS GameService

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs`
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `src/Brmble.Server/appsettings.json`
- Modify: `src/Brmble.Client/Services/Games/GameService.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeTicketStoreTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`

- [ ] **Step 1: Write failing expiry/scope/race/native tests**

```csharp
[TestMethod]
public async Task ConcurrentConsumption_AllowsExactlyOneUse()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch);
    var issued = store.Issue(100, 10, 91, RealtimeRole.Participant);
    var results = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ =>
        Task.Run(() => store.TryConsume(issued.Token, out _))));
    Assert.AreEqual(1, results.Count(x => x));
}

[TestMethod]
public void Issue_EnforcesPerUserAndGlobalBoundsAndScavengesExpiredTickets()
{
    var store = TicketHarness.Create(now: DateTimeOffset.UnixEpoch, globalLimit: 10, perUserLimit: 2);
    store.Issue(100, 10, 91, RealtimeRole.Participant);
    store.Issue(100, 10, 91, RealtimeRole.Participant);
    Assert.ThrowsException<RealtimeTicketLimitException>(() => store.Issue(100, 10, 91, RealtimeRole.Participant));
    store.AdvanceSeconds(15); store.Scavenge();
    Assert.AreEqual(0, store.Count);
}
```

Native test sends `games.request` with `{ action:"realtime-ticket", matchId:91, role:"participant", requestId:7 }` and asserts POST `games/realtime-ticket` plus one correlated response.

- [ ] **Step 2: Run ticket/native tests and verify missing routes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~RealtimeTicketStoreTests`

Expected: FAIL with missing ticket store.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~GameServiceTests`

Expected: FAIL because `realtime-ticket` is unknown.

- [ ] **Step 3: Implement hashed one-time ticket storage**

Use `RandomNumberGenerator.GetBytes(32)`, Base64URL without padding, SHA-256 dictionary key, `TimeProvider`, and a single lock around scope validation/removal. `Issue` returns expiry `now+15s`; `TryConsume` removes before returning and rejects `now>=expiresAt`. Enforce maximum 2 outstanding tickets per stable user and 10,000 globally. Scavenge expired entries on every issue/consume and from a 5-second `PeriodicTimer`; dispose stops the timer. Never log token, token hash, query string, or full WebSocket URL.

- [ ] **Step 4: Add authenticated role authorization endpoint**

Resolve certificate stable user and current session exactly as existing games endpoints. Call project 2's exact `ISpectatorCoordinator.AuthorizeAsync(sessionId,user.UserId,matchId, role == "participant" ? SpectatorRole.Participant : SpectatorRole.Spectator)`. The descriptor's canonical configuration must have `RunnerKey="continuous"`; reject any other runner. Return stable reasons `matchNotLive|notParticipant|notSameChannel|notPresent|ticketLimit`. Apply a fixed-window endpoint limiter of 10 requests per stable certificate/user per minute. Return configured `Games:RealtimePublicWebSocketUrl`; never derive authority from untrusted `Host`. Production rejects missing/non-wss URL. Development derivation requires trusted forwarded-header configuration and allowed hosts.

- [ ] **Step 5: Add the correlated native request case**

Serialize only `{ matchId, role }`, call the existing `_postJsonAsync`, and use `SendResponse`; do not add a native WebSocket or cache tickets.

- [ ] **Step 6: Run ticket and native tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeTicketStoreTests|FullyQualifiedName~GameEndpoints"`

Expected: PASS for 15-second boundary, one use, scope, authorization, and stable errors.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~GameServiceTests`

Expected: PASS with exact route/body/response correlation.

- [ ] **Step 7: Commit ticket issuance**

```bash
git add src/Brmble.Server/Games/Continuous/RealtimeTicketStore.cs src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GamesExtensions.cs src/Brmble.Server/Program.cs src/Brmble.Server/appsettings.json src/Brmble.Client/Services/Games/GameService.cs tests/Brmble.Server.Tests/Games/Continuous/RealtimeTicketStoreTests.cs tests/Brmble.Client.Tests/Services/GameServiceTests.cs
git commit -m "feat: issue scoped one-time realtime game tickets"
```

## Task 10: Add Direct Browser WebSocket And Role-Safe Protocol

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs`
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `src/Brmble.Server/appsettings.json`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs`

- [ ] **Step 1: Write failing WebSocket protocol tests**

Test missing/expired/reused ticket rejection, participant welcome constants, spectator read-only rejection, malformed/oversized JSON, stale protocol version, 64 KiB cap, Origin allowlist, attach-time revalidation, close cleanup, bounded/coalesced control ordering, final-snapshot-before-close, and latest-snapshot backpressure. Use ASP.NET Core TestServer's `server.CreateWebSocketClient()` because `ClientWebSocket` cannot connect to the in-memory TestServer transport.

- [ ] **Step 2: Run endpoint tests and verify route is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~RealtimeGameEndpointTests`

Expected: FAIL with HTTP 404 for `/games/realtime`.

- [ ] **Step 3: Implement upgrade and atomic attachment**

Accept only WebSocket GET with one `ticket` query value and an `Origin` exactly in configured `Games:RealtimeAllowedOrigins`; reject absent/unlisted Origin outside Development. Consume the ticket, then revalidate immediately before `AcceptWebSocketAsync` by calling exact `ISpectatorCoordinator.AuthorizeAsync(boundSessionId,boundStableUserId,boundMatchId,boundRole)` again and requiring returned descriptor `Configuration.RunnerKey == "continuous"`. For participant attach, additionally require `ContinuousGameCoordinator.TryGetActiveMatch(boundStableUserId,out active)` and matching `active.MatchId`; update its internal session mapping only after both checks. A consumed ticket that loses authorization fails and cannot be retried. Use UTF-8 text only, pooled fragmented buffer capped at 65,536 bytes, camel-case enums, and `InvalidPayloadData` for malformed/version/match mismatch. Logging middleware logs path only and redacts query; endpoint logs connection ID/match ID/role, never token or URL.

- [ ] **Step 4: Implement independent receive/send loops**

Participant receive handles exact protocol messages; spectator receive permits only close. Send loop applies capacity-16/coalescing/four-control fairness. On terminal state it sends `matchClosed.finalState`, awaits successful send up to two seconds, marks terminal delivered, then sends normal close. Client tests must show final state rendered before socket close state is applied. Cancellation of either loop calls `DetachAsync(connectionId)` once; timeout starts participant grace or removes spectator.

- [ ] **Step 5: Map endpoint without touching `/ws`**

Add `app.Map("/games/realtime", RealtimeGameEndpoint.HandleAsync);` after `UseWebSockets` and before `MapReverseProxy`. Normal lifecycle/queue events remain on project-1 event bus.

- [ ] **Step 6: Run endpoint/backpressure tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeGameEndpointTests|FullyQualifiedName~RealtimeSnapshotMailboxTests"`

Expected: PASS for direct role-scoped traffic, protocol examples, limits, replacement, and cleanup.

- [ ] **Step 7: Commit realtime transport**

```bash
git add src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs src/Brmble.Server/Program.cs src/Brmble.Server/appsettings.json tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs
git commit -m "feat: add direct browser realtime game websocket"
```

## Task 11: Authorize Arena Spectators But Stream Only On Realtime Sockets

**Files:**
- Modify: `src/Brmble.Server/Games/Arena/ArenaModels.cs`
- Modify: `src/Brmble.Server/Games/Arena/ArenaSimulation.cs`
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs`

- [ ] **Step 1: Write failing complete-view and authorization tests**

Assert Arena realtime spectator welcome/snapshots include phase/timing, score, arena radius/shrink phase, both positions/velocities/aim/charge/forced-fire/cooldown/dash, and all projectiles, but no participant acknowledgements. Assert exact project-2 calls: `RegisterContinuousMatchAsync(descriptor)` on start, `AuthorizeAsync(sessionId,userId,matchId,SpectatorRole.Spectator)` accepts same-channel/rejects cross-channel, and `EndMatchAsync(matchId,channelId,finalSequence)` occurs once; publisher receives zero Arena `game.spectatorSnapshot` events.

- [ ] **Step 2: Run coordinator/spectator tests and verify realtime authorization is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousGameCoordinatorTests`

Expected: FAIL because Arena realtime spectator authorization/registration is absent.

- [ ] **Step 3: Define one complete Arena snapshot shape**

Use immutable `ArenaSnapshotView` for realtime world state. Participant envelopes add each player's acknowledgement; spectator envelopes omit all acknowledgements. Snapshot sequence increments once per generated 20 Hz replacement under match lock. The project-1 configuration remains canonical `arena-knockoff/bo3/1`; no `SpectatorSourceFrame` is created for Arena.

- [ ] **Step 4: Register project-2 lifecycle without feeding its snapshot source**

At start, call `ISpectatorCoordinator.RegisterContinuousMatchAsync(new SpectatorMatchDescriptor(matchId,channelId,configuration,players,SpectatorTransport.DedicatedRealtime))`; `configuration.RunnerKey` is `continuous`. At each snapshot tick place immutable public view directly into attached realtime socket mailboxes. Ticket/attach authorization calls `AuthorizeAsync` with exact session/stable-user IDs and role. At completion call `EndMatchAsync` once. Project 2 owns move/disconnect/channel cleanup authorization state; the realtime endpoint independently detaches sockets when revalidation fails or transport closes. It never invokes `IGameEventPublisher` for Arena state.

- [ ] **Step 5: Run spectator integration tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousGameCoordinatorTests`

Expected: PASS with complete realtime attach/reconnect snapshots, monotonic sequence, same-channel authorization, zero event-bus Arena snapshots, lifecycle cleanup, and role separation.

- [ ] **Step 6: Commit shared spectator integration**

```bash
git add src/Brmble.Server/Games/Arena/ArenaModels.cs src/Brmble.Server/Games/Arena/ArenaSimulation.cs src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs
git commit -m "feat: expose arena through shared spectator contracts"
```

## Task 12: Add Typed Browser Connection, Sequenced Input, And Reconnect

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx`

- [ ] **Step 1: Write failing ticket/socket/heartbeat tests**

```tsx
it('opens the direct URL, acknowledges welcome, sequences changes, and heartbeats at 250ms', async () => {
  vi.useFakeTimers();
  api.requestRealtimeTicket.mockResolvedValue(ticket(91, 'participant'));
  const { result } = renderHook(() => useArenaConnection({ matchId: 91, role: 'participant' }));
  socket.serverMessage(welcome({ snapshotSequence: 1 }));
  expect(socket.sent[0]).toEqual({ type: 'attachAck', protocolVersion: 1, matchId: 91, snapshotSequence: 1 });
  act(() => result.current.sendInput({ moveX: 32767, moveY: 0, aimX: 32767, aimY: 0, charging: false, fireReleased: false, dash: false }));
  expect(socket.sent[1].sequence).toBe(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(socket.sent[2]).toMatchObject({ type: 'heartbeat', sequence: 2 });
});

it('resumes at acknowledgedInput plus one and renders finalState before close', async () => {
  const h = connectedArena({ acknowledgedInput: 87 });
  h.sendHeldState(right);
  expect(h.lastSent().sequence).toBe(88);
  h.serverMessage(matchClosed({ sequence: 121, finalScore: [2, 1] }));
  expect(h.view().score).toEqual([2, 1]);
  h.socketClose();
  expect(h.view().closedReason).toBe('completed');
});
```

- [ ] **Step 2: Run hook tests and verify protocol files are missing**

Run: `npm test -- --run src/components/Games/Arena/useArenaConnection.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because realtime API and hook do not exist.

- [ ] **Step 3: Add exact protocol-v1 unions and runtime guards**

Define every JSON example field from this plan as `ArenaClientMessage`/`ArenaServerMessage`; guards reject wrong protocol, noninteger numeric fields, duplicate player IDs, nonmonotonic snapshot sequence, and unknown discriminants. Do not use `any`.

- [ ] **Step 4: Implement ticket API and socket lifecycle**

`requestRealtimeTicket(matchId, role): Promise<RealtimeTicket>` uses `bridgeRequest` action `realtime-ticket` in WebView and POST otherwise. `useArenaConnection` opens `new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`)` directly, never through bridge. It sends attach ack only after a valid complete welcome.

- [ ] **Step 5: Implement bounded input production and reconnection**

Send held-state changes/edges immediately, aim changes at most every 34 ms, and complete heartbeat every 250 ms. Initialize `nextSequence=welcome.acknowledgedInput+1`; every sent input/heartbeat consumes exactly one sequence. Record `{sequence,predictedTick,fromTick,toTick,input}` until acknowledged. On reconnect clear pending inputs, install neutral locally, and set next sequence from the new welcome acknowledgement plus one. Retry fresh tickets at 250, 500, 1000, and 2000 ms within grace. Spectators obtain authorization through project 2 but all state arrives on their dedicated realtime socket. `matchClosed` applies and renders complete `finalState` synchronously before the browser close event can mark transport closed.

- [ ] **Step 6: Run hook tests and type-check**

Run: `npm test -- --run src/components/Games/Arena/useArenaConnection.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for direct URL, ack, sequence, edges, 30 Hz aim, heartbeat, stale snapshot rejection, fresh-ticket reconnect, role, and teardown.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with protocol payloads fully typed.

- [ ] **Step 7: Commit browser realtime state**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/Arena/arenaProtocol.ts src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx
git commit -m "feat: connect browser directly to arena realtime"
```

## Task 13: Implement Prediction, Reconciliation, And Interpolation

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts`
- Modify: `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx`

- [ ] **Step 1: Write failing replay/interpolation/snap tests**

```ts
it('resets to authority and replays each unacknowledged held interval', () => {
  const next = reconcile(authority({ x: 1000, acknowledgedInput: 7, serverTick: 100 }), [
    predicted(8, 101, 103, right), predicted(9, 104, 105, chargingRight),
  ], predictionConstants);
  expect(next.replayedTicks).toBe(5);
  expect(next.pending.map(x => x.sequence)).toEqual([8, 9]);
});

it('caps extrapolation at 50ms then holds latest and never predicts spectators', () => {
  expect(sampleTimeline(framesAt(0, 50), 125, 100, 50, 'spectator')).toEqual(frameAt(100));
});
```

- [ ] **Step 2: Run state tests and verify helpers are missing**

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because prediction/reconciliation/interpolation do not exist.

- [ ] **Step 3: Mirror only prediction-relevant fixed-step rules**

Use integer positions/velocities and server-provided constants for local movement, charge slowdown, dash, recoil, and immediate projectile presentation. Never predict hits, opponent impulses, KO, score, phase, or shrink outcomes. Store each input's exact predicted tick interval.

- [ ] **Step 4: Reconcile acknowledgements and mandatory snaps**

Reset local player to authority, discard sequences `<= acknowledgedInput`, replay remaining intervals, and calculate correction magnitude. Smooth corrections `<=300` fixed units over 100 ms. Snap immediately if correction is larger, predicted center is outside current radius, players overlap, phase/score changed, local KO differs, or replay would retain an invalid cooldown/dash state.

- [ ] **Step 5: Add 100 ms interpolation and 50 ms cap**

Keep timestamp/sequence ordered complete frames. Render remote players, projectiles, arena radius, and all spectator entities at `now-100ms`; linearly interpolate integer values and shortest normalized aim direction. Extrapolate velocity for at most 50 ms, then hold. Never extrapolate phase, score, projectile creation/removal, or KO.

- [ ] **Step 6: Run state tests**

Run: `npm test -- --run src/components/Games/Arena/arenaMath.test.ts src/components/Games/Arena/useArenaState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for interval replay, ack pruning, smoothing, every mandatory snap, jitter/loss ordering, 100 ms buffer, 50 ms cap, and spectator no-prediction.

- [ ] **Step 7: Commit client simulation presentation state**

```bash
git add src/Brmble.Web/src/components/Games/Arena/arenaMath.ts src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.ts src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx
git commit -m "feat: predict and reconcile arena client state"
```

## Task 14: Build Responsive Accessible Canvas Rendering

**Files:**
- Modify: `docs/UI_GUIDE.md`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.tsx`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.module.css`
- Create: `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.test.tsx`

- [ ] **Step 1: Add the UI guide pattern before UI code**

Document: shared upper `ChatPanel` foreground only; no modal; Canvas world fixed at `[-10000,10000]` both axes; uniform scale and letterboxing; permanent names/outlines/side notches; blue/red are supplementary; click-to-capture status; participant controls versus read-only spectator; aim/charge/forced-fire/cooldown/dash/shrink/score/countdown visible without sound; icon-only session mute with Tooltip; token-only shell; Classic/Retro Terminal; desktop/narrow; reduced-motion removes shake/flashes/trail animation but not state.

- [ ] **Step 2: Write failing transforms/drawing/accessibility tests**

Assert 1000x600 canvas uses scale `0.03`, horizontal offset `200`, pointer `(500,300)` maps `(0,0)`, resize preserves geometry, avatar error uses fallback, aim line always exists, charge max length is world-space 2200, trail is thinner than orb diameter, and DOM status exposes phase/score/cooldown/dash/capture independent of Canvas/color.

- [ ] **Step 3: Run renderer/activity tests and verify files are missing**

Run: `npm test -- --run src/components/Games/Arena/ArenaRenderer.test.ts src/components/Games/Arena/ArenaActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because renderer/activity do not exist.

- [ ] **Step 4: Implement Canvas scaling and identity**

Use `ResizeObserver`, device pixel ratio, `scale=min(cssWidth/20000,cssHeight/20000)`, centered offsets, and inverse pointer transform. Clip avatars to radius 600. Side 0 uses theme primary presentation plus left notch; side 1 uses danger presentation plus right notch; both have names and distinct double/single outlines. Failed/missing image renders existing Brmble logo asset immediately.

- [ ] **Step 5: Draw complete public gameplay state**

Draw circular arena/shrink state, orb hit shape, short presentation-only trail, thin neutral aim line, textured charge line up to 2200 world units, forced-fire numeric countdown attached to line, cooldown arc plus text, dash marker, phase countdown, BO3 score, and reconnect state. Do not draw aim cone, spread, charge ring, recoil indicator, health, or damage.

- [ ] **Step 6: Add responsive token-only shell and reduced motion**

Use only existing `--space-*`, `--text-*`, `--bg-*`, `--accent-*`, `--radius-*`, `--font-*`, `--glass-*`, `--shadow-*`, and transition tokens. `prefers-reduced-motion` disables nonessential shake, flash, and moving trail while Canvas timing/state remains unchanged.

- [ ] **Step 7: Run UI tests/type-check**

Run: `npm test -- --run src/components/Games/Arena/ArenaRenderer.test.ts src/components/Games/Arena/ArenaActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for transforms, fallback, complete cues, role controls, semantic status, and reduced motion.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 8: Commit Arena presentation**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.ts src/Brmble.Web/src/components/Games/Arena/ArenaRenderer.test.ts src/Brmble.Web/src/components/Games/Arena/ArenaActivity.tsx src/Brmble.Web/src/components/Games/Arena/ArenaActivity.module.css src/Brmble.Web/src/components/Games/Arena/ArenaActivity.test.tsx
git commit -m "feat: render accessible responsive arena canvas"
```

## Task 15: Add Click Input Capture And Native PTT/Hotkey Isolation

**Files:**
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaInput.test.tsx`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [ ] **Step 1: Write failing capture/release/isolation tests**

```tsx
it.each(['Escape', 'blur', 'visibilitychange', 'socket', 'unmount'])('%s releases capture and sends neutral', reason => {
  const h = inputHarness();
  h.clickBoard(); h.hold('KeyW'); h.releaseBy(reason);
  expect(h.lastInput()).toMatchObject({ moveX: 0, moveY: 0, charging: false, fireReleased: false, dash: false });
  expect(bridge.send).toHaveBeenLastCalledWith('game.inputCapture', { captureId: h.captureId, active: false });
});
```

Native test starts PTT, handles `game.inputCapture {active:true}`, asserts forced `PttStateChanged(false)` and no shortcut/PTT dispatch until the matching release.

- [ ] **Step 2: Run web/native input tests and verify missing capture API**

Run: `npm test -- --run src/components/Games/Arena/useArenaInput.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because the hook does not exist.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~InputRouterSuspendTests|FullyQualifiedName~MumbleAdapterBridgeTests"`

Expected: FAIL because `game.inputCapture` is not routed.

- [ ] **Step 3: Implement click-owned capture**

Only a participant board click activates capture. Capture-phase listeners map WASD, pointer aim, left-button hold/release, and Space edge; normalize diagonal state before sending. Prevent default/propagation only while captured. Ignore key repeat for dash. Spectator never installs gameplay listeners.

- [ ] **Step 4: Release held state on all specified lifecycle events**

Escape, `window.blur`, hidden `visibilitychange`, socket disconnect, role/match change, close, and unmount synchronously clear local held state, send one neutral state when connected, and send bridge capture false. Chat/global shortcuts work when released.

- [ ] **Step 5: Add reference-counted native isolation**

Generate one UUID `captureId` per mounted participant activity and include it in every `game.inputCapture` message. Native keeps `HashSet<string> activeCaptureIds`; adding the first ID calls existing `InputRouter.Suspend()` (releasing PTT/shortcuts), removing the last calls `Resume()`, duplicate add/remove is idempotent, and voice/window teardown clears the set then resumes. A stale false for an old ID cannot resume while a new ID remains. Reject blank/over-128-character IDs. Do not create Arena-specific native key bindings.

- [ ] **Step 6: Run capture/native tests**

Run: `npm test -- --run src/components/Games/Arena/useArenaInput.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for click ownership, controls, normalization, every release path, and spectator read-only state.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~InputRouterSuspendTests|FullyQualifiedName~MumbleAdapterBridgeTests"`

Expected: PASS with PTT released and all configured global shortcuts isolated only during capture.

- [ ] **Step 7: Commit input capture isolation**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaInput.ts src/Brmble.Web/src/components/Games/Arena/useArenaInput.test.tsx src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat: isolate arena input capture from voice hotkeys"
```

## Task 16: Add Restrained Audio, Saved Volume, And Session Mute

**Files:**
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaAudio.ts`
- Create: `src/Brmble.Web/src/components/Games/Arena/useArenaAudio.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/Arena/ArenaActivity.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx`
- Create: `src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.test.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx`
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
- Modify: `docs/UI_GUIDE.md`
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

- [ ] **Step 1: Write failing audio/settings tests**

Assert default saved Arena volume 65, slider persists 0-100, first board interaction resumes `AudioContext`, cues fire once per authoritative sequence for charge/max/fire/impact/dash/countdown/KO/collapse, pan clamps to `[-0.25,0.25]`, session mute sets gain 0 without changing saved volume, and teardown stops oscillators/closes context.

- [ ] **Step 2: Run web/native settings tests and verify missing game audio setting**

Run: `npm test -- --run src/components/Games/Arena/useArenaAudio.test.tsx src/components/SettingsModal/GamesSettingsTab.test.tsx src/components/SettingsModal/SettingsModal.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because Arena audio/settings are absent.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~AppConfigServiceTests`

Expected: FAIL because `GamesSettings` is absent.

- [ ] **Step 3: Persist an additive games setting**

Add `public record GamesSettings(int ArenaVolume = 65);` and non-null `AppSettings.Games`. Web `AppSettings.games.arenaVolume` defaults to 65 and clamps integer 0-100. Thread `games={settings.games}` and `onGamesChange={handleGamesChange}` from `SettingsModal` into `GamesSettingsTab`; `handleGamesChange` updates local settings and sends the complete `settings.set` payload through the existing persistence path. Test initial load, slider change, bridge payload, modal reopen, and old native config migration. Put the slider in Games tab using `settings-item settings-slider` and `SettingsHelp` text: `Controls Arena sound effects. Voice volume is unchanged.`

- [ ] **Step 4: Implement Web Audio cues**

Use one master gain `savedVolume/100 * 0.35`, subtle stereo panning maximum 0.25, short oscillators/noise envelopes, and sequence keys to suppress replay duplicates. Audio never drives state. Charge buildup stops on release/neutral; max warning and collapse are rate-limited; voice output is untouched.

- [ ] **Step 5: Add accessible session mute**

Use `Tooltip`, `Icon name="volume-2"|"volume-x"`, `aria-label="Mute Arena sounds"|"Unmute Arena sounds"`, and `aria-pressed`. Mute state belongs to the mounted activity and resets next session; it never writes settings. Update `docs/UI_GUIDE.md` section 11's **Media** row to include `volume-2` and `volume-x` with note `Arena session audio on/off`; do not leave the icon registry undocumented.

- [ ] **Step 6: Run audio/settings tests**

Run: `npm test -- --run src/components/Games/Arena/useArenaAudio.test.tsx src/components/Games/Arena/ArenaActivity.test.tsx src/components/SettingsModal/GamesSettingsTab.test.tsx src/components/SettingsModal/SettingsModal.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for unlock, complete cue list, subtle pan, saved volume, session mute, accessibility, and teardown.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~AppConfigServiceTests`

Expected: PASS for default, round-trip, and old-config migration.

- [ ] **Step 7: Commit Arena audio**

```bash
git add src/Brmble.Web/src/components/Games/Arena/useArenaAudio.ts src/Brmble.Web/src/components/Games/Arena/useArenaAudio.test.tsx src/Brmble.Web/src/components/Games/Arena/ArenaActivity.tsx src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.tsx src/Brmble.Web/src/components/SettingsModal/GamesSettingsTab.test.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx src/Brmble.Web/src/components/SettingsModal/SettingsModal.test.tsx src/Brmble.Web/src/components/Icon/Icon.tsx docs/UI_GUIDE.md src/Brmble.Client/Services/AppConfig/AppSettings.cs tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "feat: add configurable arena game audio"
```

## Task 17: Wire Participant/Spectator Foreground Activity End To End

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Games/DuelActivity.tsx`
- Modify: `src/Brmble.Web/src/hooks/useForegroundActivity.ts`
- Create: `src/Brmble.Web/src/App.arenaActivity.test.tsx`

- [ ] **Step 1: Write failing participant/spectator/foreground tests**

Assert reliable `game.started` for local Arena participant opens `{kind:'game',channelId:7,matchId:91,gameType:'arena-knockoff',role:'participant'}`; spectator activation opens the same with spectator role; exactly one foreground exists; remote shares pause while local broadcast persists; close restores shares; channel leave/disconnect resets socket/input/audio/activity; Deathroll/RPS participant modals remain unchanged.

- [ ] **Step 2: Run App tests and verify Arena is not rendered**

Run: `npm test -- --run src/App.arenaActivity.test.tsx src/App.spectatorActivity.test.tsx src/hooks/useForegroundActivity.test.ts src/hooks/useScreenShare.test.ts`

Working directory: `src/Brmble.Web`

Expected: FAIL because Arena lifecycle is not coordinated.

- [ ] **Step 3: Open the existing project-2 descriptor without changing its type**

Participants open from authoritative lifecycle only when game type is `arena-knockoff`; spectators open from the project-2 swords/foreground flow. When active game metadata identifies Arena, do not call `useSpectatorState.subscribe`; open the existing game descriptor and let `requestRealtimeTicket(...,'spectator')` reach `ISpectatorCoordinator.AuthorizeAsync`. `RunnerKey` remains a server orchestration field and is not added to the project-2 web descriptor. Deathroll/RPS continue using their existing discrete subscribe API. Do not add a descriptor variant or second foreground store.

- [ ] **Step 4: Render role-specific Arena in generic ChatPanel slot**

Choose `ArenaActivity` when foreground game type is Arena and pass participant/spectator role. Keep project-2 `DuelActivity` queue metadata available around spectator selection, but only one board occupies the foreground. Call existing `setRemotePlaybackPaused(true)` while open and false on close; preserve local screen publication.

- [ ] **Step 5: Coordinate terminal and lifecycle cleanup**

`game.ended` marks lifecycle terminal but does not discard realtime state or close locally. `matchClosed.finalState` is the source of the final board; after applying it, release capture and let the server close normally while leaving final score visible until the user closes. Voice leave/disconnect, channel replacement, foreground replacement, and unmount immediately close socket, neutralize, stop audio, reset project-2 spectator authorization, restore shares, and clear descriptor. Participant reconnect keeps the same descriptor.

- [ ] **Step 6: Run integrated web tests/build**

Run: `npm test -- --run src/App.arenaActivity.test.tsx src/App.spectatorActivity.test.tsx src/components/Games/Arena/ArenaActivity.test.tsx src/hooks/useForegroundActivity.test.ts src/hooks/useScreenShare.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS for both roles, one foreground, direct socket, queue/spectator integration, media preservation, and cleanup.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with TypeScript and Vite succeeding.

- [ ] **Step 7: Commit foreground integration**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Games/DuelActivity.tsx src/Brmble.Web/src/hooks/useForegroundActivity.ts src/Brmble.Web/src/App.arenaActivity.test.tsx
git commit -m "feat: integrate arena participant and spectator activity"
```

## Task 18: Add Operational Telemetry And Controlled Load Gates

**Files:**
- Create: `src/Brmble.Server/Games/Continuous/ContinuousTelemetry.cs`
- Modify: `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs`
- Modify: `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousTelemetryTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Continuous/ContinuousControlledBenchmarkTests.cs`
- Modify: `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts`

- [ ] **Step 1: Write failing metric and load tests**

Use `MeterListener` unit tests to assert instruments `brmble.games.realtime.active_matches`, `active_sockets`, `active_spectators`, `tick_lateness_ms`, `catch_up_ticks`, `snapshot_bytes`, `snapshots_dropped`, `inputs_rejected`, `sequence_gaps`, `reconnect_grace_started`, `reconnect_recovered`, `reconnect_forfeited`, `reconciliation_mean`, `reconciliation_max`, and `reconciliation_snaps`. The separate controlled benchmark loads 20 matches, 40 participants, 100 spectators for 10,000 ticks with five deliberately slow sockets.

- [ ] **Step 2: Run load tests and verify instruments are absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~ContinuousTelemetryTests`

Expected: FAIL because telemetry instruments are absent.

- [ ] **Step 3: Implement built-in metrics and structured logs**

Use meter name `Brmble.Server.Games.Continuous`, tags only `game.type`, `role`, `reject.reason`, and `ruleset.version`; never tag user/session/match IDs. Structured lifecycle logs may include match ID. Do not log or persist raw input bodies. Record serialized UTF-8 snapshot bytes and mailbox replacement count.

- [ ] **Step 4: Add bounded client reconciliation summaries**

Every 10 seconds, only while participant socket is attached, send aggregate samples/mean/max/snap count; reset accumulator after send. Server accepts at most one report per 10 seconds, validates nonnegative integers and max 100,000 fixed units, records metrics, and retains no report object.

- [ ] **Step 5: Enforce automated load thresholds**

The deterministic unit portion asserts every match reaches exactly 10,000 steps, snapshots are 3,333 or 3,334, mailbox depth is one, slow sockets drop obsolete snapshots, and reliable terminal controls arrive. Mark environment-sensitive memory/p99 methods `[TestCategory("ControlledBenchmark")]` and guard them with `BRMBLE_RUN_CONTROLLED_BENCHMARKS=1`; record managed-memory growth below 128 MiB and p99 callback work below 8 ms only on the documented dedicated release host. Ordinary CI runs telemetry/deterministic load assertions but never fails on shared-runner wall-clock or GC noise.

- [ ] **Step 6: Run load tests**

Run: `$env:BRMBLE_RUN_CONTROLLED_BENCHMARKS='1'; dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -c Release --filter TestCategory=ControlledBenchmark`

Expected on the dedicated host: PASS for 20 concurrent channel matches, 140 sockets, slow-client replacement, cadence, memory, and p99 thresholds. This command is a release/manual gate, not ordinary CI.

- [ ] **Step 7: Commit telemetry and load gates**

```bash
git add src/Brmble.Server/Games/Continuous/ContinuousTelemetry.cs src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousTelemetryTests.cs tests/Brmble.Server.Tests/Games/Continuous/ContinuousControlledBenchmarkTests.cs src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts
git commit -m "test: add arena realtime telemetry and load gates"
```

## Task 19: Final Verification, Load Test, And Manual Playtest

**Files:**
- Modify only if verification exposes a project-3 defect: files already listed in Tasks 1-18

- [ ] **Step 1: Run every server test**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS with zero failures, including project-1 orchestration, project-2 privacy, continuous runtime, and Arena rules.

- [ ] **Step 2: Run every native client test**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS with zero failures, including ticket correlation and PTT/hotkey isolation.

- [ ] **Step 3: Run every web test and production build**

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failed Vitest tests.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with no protocol widening.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with a Vite production bundle.

- [ ] **Step 4: Build the complete solution and repeat determinism/races**

Run: `dotnet build -c Release`

Expected: PASS with zero errors.

Run: `1..50 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -c Release --filter "FullyQualifiedName~ArenaDeterminismTests|FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~RealtimeTicketStoreTests"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`

Expected: PASS all 50 runs with identical hashes, one ticket consumer, generation-safe gates/grace, and no duplicate completion.

- [ ] **Step 5: Run the release load gate**

Run on the dedicated benchmark host: `$env:BRMBLE_RUN_CONTROLLED_BENCHMARKS='1'; dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -c Release --filter TestCategory=ControlledBenchmark`

Expected: PASS all Task-18 concurrency, cadence, backpressure, memory, and latency thresholds.

- [ ] **Step 6: Start a four-client manual environment**

Run: `dotnet run --project src/Brmble.Server -c Release`

Run in another terminal: `npm run dev`

Working directory: `src/Brmble.Web`

Run in four additional terminals: `dotnet run --project src/Brmble.Client -- --allow-multiple`

Expected: two Arena participants and two same-channel spectators connect. Move one spectator to another voice channel and verify its fresh Arena spectator ticket request is rejected with `notSameChannel`.

- [ ] **Step 7: Execute the gameplay and transport playtest script**

Verify mirrored spawns; 1-second Loading and visible 3-second Positioning; no attack/dash before Live; normalized diagonals; public aim; textured charge and forced-fire countdown; immediate low shot plus cooldown; fixed projectile speed/size; projectile pass-through; recoil self-KO; one dash; collision; hold/shrink/collapse; BO3; same-tick double-KO replay and fourth-loop draw. Disconnect a participant for 3 seconds and recover with neutral state, then for over 5 seconds and verify match forfeit; leave voice and verify immediate forfeit. Throttle one spectator to Slow 3G and confirm participants remain responsive and obsolete snapshots do not backlog.

Expected: every outcome is server-owned and no simulation pause, stale input replay, duplicated edge, or queue blockage occurs.

- [ ] **Step 8: Execute UI, accessibility, audio, and integration playtest script**

Verify desktop and narrow window, Classic and Retro Terminal, 100% and 200% scaling, keyboard focus, semantic phase/score/cooldown/dash text, names/outlines/notches without relying on red/blue, avatar failure fallback, pointer transform after resize, reduced motion, click capture/Escape/focus/visibility release, chat shortcuts after release, PTT silence during capture, participant prediction, spectator interpolation/no prediction, saved volume after restart, session mute not persisted, voice intelligibility, remote screen media pause/restore, local broadcast continuation, project-1 queue/rematch/ETA behavior, and unchanged Deathroll/RPS participant modals.

Expected: no cue depends exclusively on color/audio, chat remains below exactly one foreground activity, and shares restore with prior focus/quality.

- [ ] **Step 9: Record balancing gate results before release approval**

Play at least 30 rounds with sides swapped every round. Record round duration, side winner, fired charge band `0-249|250-499|500-749|750-1000`, hits, dash use, recoil KO, and collapse KO from persisted telemetry. Require all rounds terminate; neither side exceeds 65% wins in this small gate; no charge band exceeds 60% of winning hits; median round is 15-60 seconds; at least one successful defense occurs without dash; voice remains intelligible at volume 65. A failed gate changes `ArenaRulesetV1`, increments its version, and repeats deterministic/load/playtest verification before release.

- [ ] **Step 10: Confirm a clean implementation worktree**

Run: `git status --short`

Expected: no project-3 production/test files are modified. If a defect was found, return to its owning task, add a failing regression test, repeat that task's fail/pass commands and commit boundary, then rerun Task 19. Leave unrelated files untouched.

## Specification Coverage Matrix And Self-Review

| Requirement | Plan coverage | Decision / evidence |
|---|---|---|
| Separate reusable continuous contract/runtime | File Structure, Tasks 1, 6-8 | `IContinuousGameDefinition`/`IContinuousSimulation`; Task 1 creates a compilable coordinator and preserves discrete `IGameEngine`. |
| Reuse project 1 contracts/names | Prerequisites, Tasks 1, 8, 17 | Existing `GameDefinitionCatalog`/`DuelMatchRunnerRouter`; `RunnerKey="continuous"`; stable-user runner lookup/forfeit; exact reservation/completion/queue/ETA/rematch contracts. |
| Reuse project 2 spectator/foreground/media contracts | Prerequisites, Tasks 9, 11, 17 | `SpectatorService` authorizes/cleans lifecycle only; existing `ForegroundActivity` and `setRemotePlaybackPaused`; no Arena event-bus snapshots. |
| 60 Hz, 20 Hz, maximum five catch-up | Constants, Task 6 | Rational monotonic deadlines, snapshots every third tick, maximum five and overload resync tests. |
| Ordered input, predicted tick/interval, validation | Protocol, Tasks 7, 12-13 | Exact `lastAccepted+1`, sequence-gap rejection, ranges/rates/roles/phases, and exact replay intervals. |
| 30 Hz aim, 250 ms heartbeat, 750 ms neutral | Tasks 7, 12, 15 | Client rate bounds plus server timeout and every capture/socket loss path. |
| Replaceable snapshot backpressure | Protocol, Tasks 6, 10, 18 | Capacity-one snapshots plus bounded/coalesced capacity-16 controls and fairness; slow-client gate. |
| One-time scoped 15-second tickets via mTLS GameService | Task 9 | 256-bit hash-only token, atomic consume, scavenging, 2/user and 10,000 global bounds, endpoint rate limit. |
| Direct browser WebSocket, not native/event bus | Tasks 9-12 | Trusted configured public `wss` URL, Origin allowlist, attach revalidation, TestServer WebSocket tests; `/ws` remains lifecycle only. |
| Participant/spectator role separation | Tasks 8-12, 17 | Gate accepts participants only; spectator read-only; same-channel authorization retained. |
| Initial 15-second attach plus ack | Task 8 | Both participant sockets receive complete welcome and ack sequence before first Loading; timeout forfeits. |
| Five-second reconnect grace/no pause/fresh state | Task 8, Task 12 | Neutral immediately, simulation continues, new ticket/complete snapshot, stale inputs cleared, next sequence from ack+1. |
| Shared persistence, queue advancement, rematches, ETAs | Tasks 1, 8, 17 | Unchanged project-1 completion and sink release the active commitment; `bo3`/ruleset 1 group stats. |
| Deterministic fixed-point/no randomness | Tasks 2-5 | Exact 15-stage ordering/formulas/truncation, C#/TS golden vectors, stable IDs, per-tick hashes, no RNG dependency. |
| BO3 and full round reset | Task 5 | First to two; positions/momentum/projectiles/charge/cooldown/shrink/dash reset. |
| Loading/Positioning/Live exact gates | Tasks 3, 8 | 60/180 ticks; first Loading waits for attach; later rounds enter immediately. |
| Solid collision and coincident fallback | Task 3 | Stable session-ID order, integer normal, deterministic axis, no contact knockback. |
| Charge/aim/forced fire/cooldown | Tasks 4, 14 | Exact curves/ticks and public non-color presentation; click rate cannot bypass 24 ticks. |
| Projectile rules | Task 4 | Constant orb/speed/radius, visual-only trail, opposing player only, pass-through, coexist/remove rules. |
| Knockback/recoil/no health | Tasks 4-5 | Deterministic charge curves affect momentum only; positional boundary is sole loss condition. |
| One dash per round, no invulnerability/pass-through | Tasks 4-5 | Six fixed steps, movement/aim direction, body collision, self-KO, reset on replay. |
| Hold/shrink/collapse to zero | Tasks 2-3, 5 | Piecewise formulas and exact 599/600/2399/2400/3599/3600 boundary vectors. |
| Same-tick double KO anti-loop | Task 5 | Three replays without score; fourth consecutive draw; decisive reset. |
| Public Arena spectator view | Task 11 | Complete dedicated realtime state only; project-2 service carries authorization/lifecycle and publishes zero Arena snapshots. |
| Prediction/reconciliation | Task 13 | Local movement/slowdown/dash/recoil/fire presentation; authority reset and interval replay; mandatory snap cases. |
| Interpolation/extrapolation | Task 13 | 100 ms remote/spectator buffer, one 50 ms interval cap, then hold; spectators never predict. |
| No rewind/lag compensation | Tasks 3-5, 13 | Single current authoritative timeline; client correction only. |
| Responsive Canvas and fixed geometry | Task 14 | Fixed 20,000-square view, uniform letterbox, inverse pointer transform, resize tests. |
| Avatar fallback/stable sides/non-color identity | Task 14 | Clipped avatar, immediate Brmble fallback, names/outlines/notches, stable side. |
| Aim/charge presentation exclusions | Task 14 | Thin aim, textured fixed-length charge and countdown; no cone/spread/ring/recoil indicator. |
| Accessibility/reduced motion | Tasks 14, 19 | Semantic DOM cues, token themes, narrow layout, motion fallback, manual Classic/Retro gate. |
| Terminal state before socket close | Protocol, Tasks 10, 12 | Reliable `matchClosed.finalState`, send completion awaited, client renders before processing close. |
| Click capture and PTT/hotkey isolation | Task 15 | UUID `captureId` set prevents stale release; every release path neutralizes; native suspension releases PTT. |
| Audio cues, saved volume, session mute | Task 16 | Complete prop threading/tests, native migration, UI guide icon table, volume 65 persisted, quick mute session-only. |
| Match telemetry | Tasks 5, 8 | Result/reason/score/rounds/double KOs/durations/causes/shots/hits/charges/dash/radius persisted. |
| Operational telemetry/no raw inputs | Task 18 | Required gauges/counters/histograms and aggregate client corrections; bounded tags; no input retention. |
| Multiple matches/fan-out/slow clients | Tasks 18-19 | Deterministic CI checks plus opt-in dedicated-host memory/p99 benchmark; no flaky shared-CI timing gate. |
| Balance and human playtest criteria | Task 19 | Side symmetry, charge bands, cadence, max-charge risk, dash optionality, recoil, collapse, voice/cue checks. |
| Initial-release non-goals | All tasks | No BO5, classes/upgrades/health/randomness/projectile cancellation/invulnerability/rewind/replays/mobile/gamepad/horizontal scale. |

Self-review results:

- Both approved specs were checked section by section. Framework project 3 requirements map to Tasks 1 and 6-12/17-18; every Arena gameplay, client, accessibility, audio, telemetry, load, and playtest requirement maps to Tasks 2-5 and 12-19.
- Project-1 names retain one meaning. Queue `Revision`, realtime snapshot `sequence`, input `sequence`, `offerId`, `reservationId`, and `matchId` are not conflated. Arena deliberately does not use project-2 `SpectatorSnapshot.Sequence` because its state never enters that transport.
- Continuous simulation remains separate from `IGameEngine`; Deathroll/RPS do not acquire realtime sockets or continuous interaction values.
- Type consistency was checked across C# and TypeScript for protocol version 1, `arena-knockoff`, `bo3`, ruleset 1, exact input-next semantics, final state, participant/spectator roles, timing values, and prediction constants.
- Commit boundaries were audited: Task 1 creates only continuous contracts/coordinator/tests, consumes project 1's existing catalog/router with a fake `IDuelGameDefinition`, and creates the coordinator before any modify task; Task 2 creates shared TS math before Task 13 modifies it; ticket/endpoint/settings/telemetry commits include every listed file and test.
- Test realism was audited: collection assertions compare arrays, WebSocket integration uses TestServer's client, rational deadline expected values use the declared timestamp frequency, and environment-sensitive benchmarks are opt-in.
- Placeholder scan was checked; each implementation action specifies concrete behavior, paths, commands, expected outcomes, and no deferred marker remains.
- Primary determinism risk is accidental floating-point or unstable collection iteration. Tasks 2-5 require exact ordering, widened integer arithmetic, C#/TS golden vectors, declared field order, stable IDs, and repeated hashes.
- Primary runtime risk is a slow socket stalling the simulation. Tasks 6/10 separate immutable capture from send loops, bound/coalesce controls, replace snapshots at capacity one, and guarantee terminal final state.
- Primary security risk is treating a realtime ticket or proxy authority as trusted. Tasks 9-10 add hash-only bounded tickets, scavenging, rate limits, configured `wss`, forwarded-header allowlists, Origin checks, attach-time authorization, and log redaction.
- Primary client risk is prediction changing outcomes. Task 13 explicitly limits prediction to local presentation and snaps for boundary, overlap, phase, score, KO, cooldown, and dash authority conflicts.
- Initial balance constants are concrete enough for deterministic implementation but remain subject to Task-19 human gates; any material change creates a new ruleset version so persisted statistics and ETAs never mix.
