# Duel Orchestration, Queue, Ready Checks, Rematches, and ETAs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver project 1 as an independently releasable, server-authoritative duel orchestration stage with atomic commitments, FIFO accepted-pair queues, ready checks, rematches, recovery snapshots, persisted ruleset versions, and server-calculated ETAs.

**Architecture:** Add a singleton `DuelOrchestrator` as the only owner of pending offers, per-user commitments, channel queue state, ready timers, and revisions; keep `GameSessionManager` focused on running one immutable `DuelConfiguration` and reporting terminal results. Publish complete `game.queueSnapshot` replacements after every mutation and on request, and derive ETA segments from a repository-backed newest-100 duration estimator. The native bridge remains the low-frequency mTLS command path, while React stores snapshots by revision, keeps Deathroll/RPS participant modals, and adds only queue, ready, and rematch controls; spectator boards and generic `ChatPanel` foreground activity remain project 2.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, C#, SQLite/Dapper, MSTest/Moq, raw Win32/WebView2 native bridge, React 19, TypeScript 5.9, Vitest/Testing Library, CSS custom-property design tokens.

---

## File Structure

### Server production files

- Create `src/Brmble.Server/Games/Duels/DuelModels.cs`: immutable orchestration commands, commitments, channel state, queue snapshot DTOs, and stable reason enums shared by projects 2 and 3.
- Create `src/Brmble.Server/Games/Duels/GameDefinitionCatalog.cs`: catalogs any `IDuelGameDefinition` (discrete now, continuous later), validates options, and produces canonical runner-routable configurations before reserving users.
- Create `src/Brmble.Server/Games/Duels/DuelWire.cs`: maps internal enums to explicit camel-case string wire DTOs so HTTP, event-bus, and direct WebSocket serialization cannot emit integers or PascalCase values.
- Create `src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs`: newest-100 grouped duration lookup, medians, conditional remaining/fallback logic, and combined queue ETAs.
- Create `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs`: one atomic lock for offers/commitments/channel FIFO state, timers, presence cleanup, advancement, snapshots, and rematches.
- Create `src/Brmble.Server/Games/CompletedMatchPersistenceQueue.cs`: background retry queue so persistence failure cannot retain the channel's active commitment.
- Modify `src/Brmble.Server/Games/IGameEngine.cs`: expose canonical ruleset version, option normalization, and pre-match format without changing discrete interaction models.
- Modify `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`: explicitly identify ruleset 1 and canonical `1v1` configuration.
- Modify `src/Brmble.Server/Games/Engines/RpsEngine.cs`: canonicalize `bestOf` once and derive `bo3`/`bo5`/`bo7` before queueing.
- Modify `src/Brmble.Server/Games/GameMatchModels.cs`: carry `RulesetVersion` through persisted and completed models and define duration sample records.
- Modify `src/Brmble.Server/Data/Database.cs`: add/migrate `ruleset_version` and create the grouped duration index.
- Modify `src/Brmble.Server/Games/GameRepository.cs`: implement `IDurationSampleRepository`, persist ruleset version, and query the newest 100 qualifying durations.
- Create `src/Brmble.Server/Games/Duels/DuelMatchRunnerRouter.cs`: resolves `DuelConfiguration.RunnerKey`, tracks active matches by stable user ID, and routes starts/forfeits to discrete or future continuous runners.
- Modify `src/Brmble.Server/Games/GameSessionManager.cs`: implement the discrete `IDuelMatchRunner`, start immutable reservations, expose stable-user active lookup/forfeit, enqueue persistence, and raise completion events after releasing runtime state.
- Modify `src/Brmble.Server/Games/GameEndpoints.cs`: route invite/respond/cancel/ready/rematch/snapshot commands to `IDuelOrchestrator`, retain discrete actions on `GameSessionManager`, and route forfeits through `IDuelMatchRunnerRouter`.
- Modify `src/Brmble.Server/Games/GamesExtensions.cs`: register the catalog, estimator, orchestrator, persistence queue, and hosted worker.
- Modify `src/Brmble.Server/Mumble/MumbleServerCallback.cs`: notify the orchestrator before removing presence and clear removed channels.
- Modify `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`: send the current channel snapshot after WebSocket registration for reconnect recovery.

### Native client files

- Modify `src/Brmble.Client/Services/Games/GameService.cs`: bridge ready/rematch commands and queue-snapshot requests over the existing mTLS paths.
- Modify `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`: keep forwarding every `game.*` event unchanged; add a focused forwarding regression test rather than a new transport.

### Web production files

- Modify `docs/UI_GUIDE.md`: document project 1's temporary queue modal, ready notification, and rematch placement while reserving embedded foreground activity for project 2.
- Modify `src/Brmble.Web/src/api/games.ts`: define queue contracts and commands for ready, rematch, and snapshot recovery.
- Create `src/Brmble.Web/src/components/Games/useDuelQueueState.ts`: revision-gated complete snapshot state and queue/ready/rematch actions.
- Create `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx`: accessible read-only active/ready/ordered queue status with server ETAs.
- Create `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css`: token-only queue modal layout.
- Modify `src/Brmble.Web/src/components/Games/useGameState.ts`: consume stable challenge IDs and retain completed configuration needed to offer a rematch.
- Modify `src/Brmble.Web/src/components/Games/DeathrollModal.tsx`: add rematch request/acceptance state to the existing participant result modal.
- Modify `src/Brmble.Web/src/components/Games/RpsModal.tsx`: add the same rematch controls without changing reveal behavior.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`: turn the existing swords badge into an accessible button when a snapshot is non-idle.
- Modify `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`: pass snapshot channel IDs and badge activation through.
- Modify `src/Brmble.Web/src/App.tsx`: own `useDuelQueueState`, open the queue modal from the badge, render ready/rematch notifications, and clear queue state on voice disconnect.

### Tests

- Create `tests/Brmble.Server.Tests/Games/Duels/GameDefinitionCatalogTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/CompletedMatchPersistenceQueueTests.cs`.
- Modify `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs`.
- Modify `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`.
- Modify `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs`.
- Modify `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`.
- Modify `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Duels/DuelMatchRunnerRouterTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`.
- Create `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`.
- Create `tests/Brmble.Client.Tests/Services/MumbleAdapterGameEventForwardingTests.cs`.
- Create `src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`.
- Create `src/Brmble.Web/src/App.duelOrchestration.test.tsx`.

## Stable Contracts For Projects 2 And 3

Use these names and shapes throughout this plan. Do not add a continuous value to `InteractionModel`; Arena will supply a different match runner in project 3 while consuming `DuelReservation`, `DuelConfiguration`, and `DuelQueueSnapshot`.

```csharp
public sealed record DuelConfiguration(
    string GameType,
    string Format,
    int RulesetVersion,
    IReadOnlyDictionary<string, object?> Options,
    string RunnerKey);

public interface IDuelGameDefinition
{
    string GameType { get; }
    string RunnerKey { get; }
    int RulesetVersion { get; }
    IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options);
    string MatchFormat(IReadOnlyDictionary<string, object?> normalizedOptions);
}

public sealed record DuelPlayer(long SessionId, long UserId, string DisplayName);

public sealed record DuelReservation(
    long ReservationId,
    int ChannelId,
    DuelPlayer PlayerOne,
    DuelPlayer PlayerTwo,
    DuelConfiguration Configuration,
    DateTimeOffset AcceptedAt,
    long AcceptanceSequence,
    long? SourceMatchId);

public enum DuelCommitmentKind { Challenge, RematchOffer, Queued, ReadyCheck, Active }
public enum DuelCancelReason { Declined, Expired, Disconnected, LeftChannel, ChannelRemoved, StartFailed }
public enum ReadyResponse { Accept, Decline }
public enum DuelRejectReason { None, Blocked, AlreadyCommitted, NotPresent, StaleOffer, NotParticipant, InvalidConfiguration }
public enum EstimateStatus { Known, Unknown }
public enum EstimateMethod { FullMedian, ConditionalRemaining, FullMedianFallback, ReadyWindow, Insufficient }

public sealed record DuelCommandResult(
    bool Success, long? OfferId, long? ReservationId, string? Error, DuelRejectReason Reason);
public sealed record ActiveMatchReference(long MatchId, long ReservationId, int ChannelId, string RunnerKey);
public sealed record GameStartResult(bool Success, long MatchId, DateTimeOffset? StartedAt, string? Error);
public sealed record MatchCompletion(
    long MatchId, long ReservationId, int ChannelId,
    DuelPlayer PlayerOne, DuelPlayer PlayerTwo,
    DuelConfiguration Configuration, DateTimeOffset EndedAt);
public sealed record DurationSample(long MatchId, long DurationMs, string Outcome, DateTimeOffset EndedAt);
public interface IDuelMatchRunner
{
    string RunnerKey { get; }
    event Func<MatchCompletion, Task>? MatchCompleted;
    Task<GameStartResult> StartAsync(DuelReservation reservation);
    bool TryGetActiveMatch(long userId, out ActiveMatchReference match);
    Task ForfeitAsync(long matchId, long userId, string reason);
}
public interface IDuelMatchRunnerRouter
{
    event Func<MatchCompletion, Task>? MatchCompleted;
    Task<GameStartResult> StartAsync(DuelReservation reservation);
    bool TryGetActiveMatch(long userId, out ActiveMatchReference match);
    Task ForfeitAsync(long matchId, long userId, string reason);
}
public interface IDuelOrchestrator
{
    Task<DuelCommandResult> CreateChallengeAsync(long inviterSessionId, long targetSessionId, string gameType, IReadOnlyDictionary<string, object?>? options);
    Task<DuelCommandResult> RespondToOfferAsync(long offerId, long responderUserId, bool accept);
    Task<DuelCommandResult> CancelOfferAsync(long offerId, long requesterUserId);
    Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response);
    Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId);
    Task<DuelQueueSnapshot> GetSnapshotForSessionAsync(long sessionId);
    Task HandlePresenceLostAsync(long userId, long oldSessionId, DuelCancelReason reason);
    Task HandleChannelRemovedAsync(int channelId);
}
public sealed record DuelPlayerSnapshot(long UserId, long SessionId, string DisplayName, bool Ready = false);
public sealed record EtaSegmentSnapshot(
    string GameType, string Format, int RulesetVersion, int SampleCount, EstimateMethod Method);
public sealed record DurationEstimate(
    EstimateStatus Status, long? Milliseconds, int SampleCount, EstimateMethod Method, bool Approximate)
{
    public static DurationEstimate Known(long milliseconds, int count, EstimateMethod method) =>
        new(EstimateStatus.Known, milliseconds, count, method, true);
    public static DurationEstimate Unknown(int count) =>
        new(EstimateStatus.Unknown, null, count, EstimateMethod.Insufficient, true);
}
public sealed record QueueEtaSnapshot(
    EstimateStatus Status,
    DateTimeOffset? EstimatedStartAt,
    long? Milliseconds,
    bool Approximate,
    IReadOnlyList<EtaSegmentSnapshot> Segments);
public sealed record ActiveDuelSnapshot(
    long MatchId,
    string Status,
    DateTimeOffset StartedAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    DurationEstimate Remaining);
public sealed record ReadyCheckSnapshot(
    long ReservationId,
    DateTimeOffset ExpiresAt,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion);
public sealed record QueuedDuelSnapshot(
    long ReservationId,
    int Position,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    string GameType,
    string Format,
    int RulesetVersion,
    QueueEtaSnapshot Eta);

public sealed record DuelQueueSnapshot(
    int SchemaVersion,
    long Generation,
    long Revision,
    int ChannelId,
    DateTimeOffset GeneratedAt,
    long CalculationTimeMs,
    ActiveDuelSnapshot? Active,
    ReadyCheckSnapshot? ReadyCheck,
    IReadOnlyList<QueuedDuelSnapshot> Queue);
public sealed record ActiveSnapshotInput(DuelConfiguration Configuration, DateTimeOffset StartedAt);
public sealed record ReadySnapshotInput(DuelReservation Reservation, DateTimeOffset ExpiresAt);
public sealed record ChannelSnapshotInput(
    int ChannelId, long Generation, long Revision, DateTimeOffset CalculatedAt,
    ActiveSnapshotInput? Active, ReadySnapshotInput? ReadyCheck,
    IReadOnlyList<DuelReservation> Queue);

public interface IDurationSampleRepository
{
    Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
        string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs);
}
```

`DuelOrchestrator` keys its single-commitment map by stable database `UserId`, never by Mumble session. `DuelPlayer.SessionId` is the routing/presence address captured for that commitment. A second live session mapped to the same stable user cannot create another commitment. An actual Mumble disconnect/session replacement cancels the old commitment per the presence rules; an application WebSocket reconnect leaves the Mumble session unchanged and recovers through a complete snapshot.

Internal enums never cross a serialization boundary directly. `DuelWire.ToSnapshot(DuelQueueSnapshot)` returns wire records whose `status`, `method`, and reasons are `string` values produced by exhaustive switches such as `EstimateStatus.Known => "known"` and `EstimateMethod.ConditionalRemaining => "conditionalRemaining"`; contract tests serialize those wire records with each real boundary's camel-case property options.

Canonical event payloads are camel-cased by the event bus:

```json
{
  "type": "game.queueSnapshot",
  "schemaVersion": 1,
  "generation": 2,
  "revision": 18,
  "channelId": 7,
  "generatedAt": "2026-07-25T14:30:00.0000000+00:00",
  "calculationTimeMs": 3,
  "active": {
    "matchId": 91,
    "status": "live",
    "startedAt": "2026-07-25T14:29:20.0000000+00:00",
    "players": [{ "sessionId": 10, "displayName": "Alice" }, { "sessionId": 20, "displayName": "Bob" }],
    "gameType": "rps",
    "format": "bo3",
    "rulesetVersion": 1,
    "remaining": { "status": "known", "milliseconds": 24000, "sampleCount": 14, "method": "conditionalRemaining", "approximate": true }
  },
  "readyCheck": null,
  "queue": [{
    "reservationId": 102,
    "position": 1,
    "players": [{ "sessionId": 30, "displayName": "Cara" }, { "sessionId": 40, "displayName": "Dan" }],
    "gameType": "deathroll",
    "format": "1v1",
    "rulesetVersion": 1,
    "eta": {
      "status": "known",
      "estimatedStartAt": "2026-07-25T14:30:24.0000000+00:00",
      "milliseconds": 24000,
      "approximate": true,
      "segments": [{ "gameType": "rps", "format": "bo3", "rulesetVersion": 1, "sampleCount": 14, "method": "conditionalRemaining" }]
    }
  }]
}
```

An unknown ETA retains diagnostic counts and has no client-computed value:

```json
{
  "status": "unknown",
  "estimatedStartAt": null,
  "milliseconds": null,
  "approximate": true,
  "segments": [{ "gameType": "rps", "format": "bo3", "rulesetVersion": 1, "sampleCount": 9, "method": "insufficient" }]
}
```

## Task 1: Canonical Game Configuration And Ruleset Contracts

**Files:**
- Create: `src/Brmble.Server/Games/Duels/DuelModels.cs`
- Create: `src/Brmble.Server/Games/Duels/GameDefinitionCatalog.cs`
- Create: `src/Brmble.Server/Games/Duels/DuelWire.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/Games/IGameEngine.cs:19-77`
- Modify: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`
- Modify: `src/Brmble.Server/Games/Engines/RpsEngine.cs:44-69,259`
- Create: `tests/Brmble.Server.Tests/Games/Duels/GameDefinitionCatalogTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs`

- [ ] **Step 1: Write failing catalog and wire tests for canonical format, future definitions, and string enums**

```csharp
[TestMethod]
public void Create_RpsBestOfFive_ReturnsCanonicalConfiguration()
{
    var catalog = new GameDefinitionCatalog([new DeathrollEngine(), new RpsEngine()]);
    var result = catalog.Create("rps", new Dictionary<string, object?> { ["bestOf"] = 5L });
    Assert.AreEqual("bo5", result.Format);
    Assert.AreEqual(1, result.RulesetVersion);
    Assert.AreEqual(5, result.Options["bestOf"]);
}

[TestMethod]
public void Create_InvalidRpsBestOf_ThrowsStableValidationError()
{
    var catalog = new GameDefinitionCatalog([new RpsEngine()]);
    var ex = Assert.ThrowsException<InvalidGameConfigurationException>(
        () => catalog.Create("rps", new Dictionary<string, object?> { ["bestOf"] = 9 }));
    Assert.AreEqual("RPS bestOf must be 3, 5, or 7.", ex.Message);
}

[TestMethod]
public void Create_ContinuousDefinition_IsAdmittedWithoutIGameEngine()
{
    IDuelGameDefinition arena = new FakeDefinition("arena-knockoff", "continuous", "bo3", 2);
    var result = new GameDefinitionCatalog([arena]).Create("arena-knockoff", null);
    Assert.AreEqual("continuous", result.RunnerKey);
    Assert.AreEqual(2, result.RulesetVersion);
}

[TestMethod]
public void SnapshotWire_UsesCamelCaseStringEnums()
{
    var json = JsonSerializer.Serialize(DuelWire.ToSnapshot(QueueSnapshotWithUnknownFallback()), DuelWire.JsonOptions);
    StringAssert.Contains(json, "\"status\":\"unknown\"");
    StringAssert.Contains(json, "\"method\":\"fullMedianFallback\"");
    Assert.IsFalse(json.Contains("\"status\":1"));
    Assert.IsFalse(json.Contains("FullMedianFallback"));
}

[TestMethod]
public void EventAndDirectWebSocketSerializers_ProduceSameWireContract()
{
    var payload = DuelWire.ToEvent(QueueSnapshotWithUnknownFallback());
    var eventBusJson = JsonSerializer.Serialize(payload,
        new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
    var directSocketJson = JsonSerializer.Serialize(payload, DuelWire.JsonOptions);
    Assert.AreEqual(JsonDocument.Parse(eventBusJson).RootElement.ToString(),
        JsonDocument.Parse(directSocketJson).RootElement.ToString());
    var errorJson = JsonSerializer.Serialize(
        new GameErrorWire("A player is committed.", DuelWire.Reason(DuelRejectReason.AlreadyCommitted)), DuelWire.JsonOptions);
    StringAssert.Contains(errorJson, "\"reason\":\"alreadyCommitted\"");
}
```

- [ ] **Step 2: Run the focused tests and verify the missing types fail compilation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameDefinitionCatalogTests|FullyQualifiedName~DuelSerializationTests"`

Expected: FAIL with `CS0246` for `GameDefinitionCatalog`, `IDuelGameDefinition`, and `DuelWire`.

- [ ] **Step 3: Add the canonical contracts and engine methods**

```csharp
public interface IGameEngine : IDuelGameDefinition
{
    string GameType { get; }
    InteractionModel InteractionModel { get; }
    string RunnerKey => "discrete";
    int RulesetVersion => 1;
    IReadOnlyDictionary<string, object?> NormalizeOptions(IReadOnlyDictionary<string, object?>? options)
        => new Dictionary<string, object?>();
    string MatchFormat(IReadOnlyDictionary<string, object?> options) => "1v1";
    // Transitional overload retained through Task 4 so all existing manager/tests compile.
    string MatchFormat(object state) => "1v1";
}

public sealed class GameDefinitionCatalog
{
    private readonly IReadOnlyDictionary<string, IDuelGameDefinition> _definitions;
    public GameDefinitionCatalog(IEnumerable<IDuelGameDefinition> definitions) =>
        _definitions = definitions.ToDictionary(x => x.GameType, StringComparer.OrdinalIgnoreCase);

    public DuelConfiguration Create(string gameType, IReadOnlyDictionary<string, object?>? options)
    {
        if (!_definitions.TryGetValue(gameType, out var definition))
            throw new InvalidGameConfigurationException($"Unknown game type '{gameType}'.");
        var normalized = definition.NormalizeOptions(options);
        return new(definition.GameType, definition.MatchFormat(normalized), definition.RulesetVersion, normalized, definition.RunnerKey);
    }
}

public static class DuelWire
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public static string Status(EstimateStatus value) => value switch
    {
        EstimateStatus.Known => "known",
        EstimateStatus.Unknown => "unknown",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
    public static string Method(EstimateMethod value) => value switch
    {
        EstimateMethod.FullMedian => "fullMedian",
        EstimateMethod.ConditionalRemaining => "conditionalRemaining",
        EstimateMethod.FullMedianFallback => "fullMedianFallback",
        EstimateMethod.ReadyWindow => "readyWindow",
        EstimateMethod.Insufficient => "insufficient",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
    public static string Reason(DuelRejectReason value) => value switch
    {
        DuelRejectReason.None => "none",
        DuelRejectReason.Blocked => "blocked",
        DuelRejectReason.AlreadyCommitted => "alreadyCommitted",
        DuelRejectReason.NotPresent => "notPresent",
        DuelRejectReason.StaleOffer => "staleOffer",
        DuelRejectReason.NotParticipant => "notParticipant",
        DuelRejectReason.InvalidConfiguration => "invalidConfiguration",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
    public static DuelQueueSnapshotWire ToSnapshot(DuelQueueSnapshot snapshot) =>
        DuelQueueSnapshotWire.From(snapshot, Status, Method);
}

public sealed record DurationEstimateWire(string Status, long? Milliseconds, int SampleCount, string Method, bool Approximate);
public sealed record EtaSegmentWire(string GameType, string Format, int RulesetVersion, int SampleCount, string Method);
public sealed record QueueEtaWire(string Status, DateTimeOffset? EstimatedStartAt, long? Milliseconds, bool Approximate, IReadOnlyList<EtaSegmentWire> Segments);
public sealed record ActiveDuelWire(long MatchId, string Status, DateTimeOffset StartedAt, IReadOnlyList<DuelPlayerSnapshot> Players, string GameType, string Format, int RulesetVersion, DurationEstimateWire Remaining);
public sealed record ReadyCheckWire(long ReservationId, DateTimeOffset ExpiresAt, IReadOnlyList<DuelPlayerSnapshot> Players, string GameType, string Format, int RulesetVersion);
public sealed record QueuedDuelWire(long ReservationId, int Position, IReadOnlyList<DuelPlayerSnapshot> Players, string GameType, string Format, int RulesetVersion, QueueEtaWire Eta);
public sealed record DuelQueueSnapshotWire(int SchemaVersion, long Generation, long Revision, int ChannelId, DateTimeOffset GeneratedAt, long CalculationTimeMs, ActiveDuelWire? Active, ReadyCheckWire? ReadyCheck, IReadOnlyList<QueuedDuelWire> Queue);
public sealed record GameQueueSnapshotEvent(
    string Type, int SchemaVersion, long Generation, long Revision, int ChannelId,
    DateTimeOffset GeneratedAt, long CalculationTimeMs, ActiveDuelWire? Active,
    ReadyCheckWire? ReadyCheck, IReadOnlyList<QueuedDuelWire> Queue);
public sealed record GameErrorWire(string Error, string Reason);
```

Add `public static GameQueueSnapshotEvent ToEvent(DuelQueueSnapshot snapshot)` and implement it by first calling `ToSnapshot`, then flattening the wire snapshot into `GameQueueSnapshotEvent("game.queueSnapshot", wire.SchemaVersion, wire.Generation, ...)`, matching the canonical top-level JSON payload; do not nest it under `snapshot`. Implement `DuelQueueSnapshotWire.From` by mapping every nested active/ready/queue/ETA object and calling the supplied `Status`/`Method` functions for every enum field. Do not use `JsonStringEnumConverter`, because its naming policy could diverge between event-bus and direct WebSocket serializers.

In `RpsEngine`, parse numeric `JsonElement`, `long`, or `int`, return `new Dictionary<string, object?> { ["bestOf"] = bestOf }`, and implement `MatchFormat(options) => $"bo{(int)options["bestOf"]!}"`. Deathroll returns empty options and `1v1`. Keep `InitialState(..., options)` consuming the normalized dictionary.

Register each engine as one singleton exposed through both contracts so the catalog is not coupled to discrete engines:

```csharp
services.AddSingleton<DeathrollEngine>();
services.AddSingleton<RpsEngine>();
services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<DeathrollEngine>());
services.AddSingleton<IGameEngine>(sp => sp.GetRequiredService<RpsEngine>());
services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<DeathrollEngine>());
services.AddSingleton<IDuelGameDefinition>(sp => sp.GetRequiredService<RpsEngine>());
services.AddSingleton<GameDefinitionCatalog>();
```

- [ ] **Step 4: Run catalog and engine tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameDefinitionCatalogTests|FullyQualifiedName~DuelSerializationTests|FullyQualifiedName~RpsEngineTests|FullyQualifiedName~DeathrollEngineTests"`

Expected: PASS; invalid formats are rejected before any user commitment is created.

- [ ] **Step 5: Build the solution to prove the transitional interface is compile-safe**

Run: `dotnet build`

Expected: PASS; existing `GameSessionManager` and tests still compile through `MatchFormat(object state)` while the catalog uses pre-match configuration.

- [ ] **Step 6: Commit the configuration boundary**

```bash
git add src/Brmble.Server/Games/Duels/DuelModels.cs src/Brmble.Server/Games/Duels/GameDefinitionCatalog.cs src/Brmble.Server/Games/Duels/DuelWire.cs src/Brmble.Server/Games/IGameEngine.cs src/Brmble.Server/Games/Engines/DeathrollEngine.cs src/Brmble.Server/Games/Engines/RpsEngine.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/Duels/GameDefinitionCatalogTests.cs tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs
git commit -m "refactor: define canonical duel configurations"
```

## Task 2: Persist Ruleset Versions And Query Duration Samples

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs:95-143,145-175`
- Modify: `src/Brmble.Server/Games/GameMatchModels.cs:3-40`
- Modify: `src/Brmble.Server/Games/GameRepository.cs:12-56`
- Modify: `tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameTestHelpers.cs`

- [ ] **Step 1: Write failing migration, insert, and newest-100 query tests**

```csharp
[TestMethod]
public async Task Initialize_MigratesRulesetVersionAndCreatesDurationIndex()
{
    var (_, db) = GameTestHelpers.NewRepoWithDb();
    using var conn = db.CreateConnection();
    Assert.AreEqual(1L, await conn.QuerySingleAsync<long>(
        "SELECT COUNT(*) FROM pragma_table_info('game_matches') WHERE name='ruleset_version'"));
    Assert.AreEqual(1L, await conn.QuerySingleAsync<long>(
        "SELECT COUNT(*) FROM pragma_index_list('game_matches') WHERE name='ix_game_matches_duration_group'"));
}

[TestMethod]
public async Task GetDurationSamples_ReturnsNewestHundredQualifyingRowsInGroup()
{
    var (repo, db) = GameTestHelpers.NewRepoWithDb();
    await GameTestHelpers.InsertDurationRowsAsync(db, "rps", "bo3", 2, 105, includeAbandoned: true);
    var samples = await repo.GetDurationSamplesAsync("rps", "bo3", 2, elapsedGreaterThanMs: null);
    Assert.AreEqual(100, samples.Count);
    Assert.AreEqual(105_000L, samples[0].DurationMs);
    Assert.IsFalse(samples.Any(x => x.Outcome == "abandoned"));
}
```

- [ ] **Step 2: Run repository tests and verify schema/model failures**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~GameRepositoryTests`

Expected: FAIL because `ruleset_version`, `DurationSample`, and `GetDurationSamplesAsync` do not exist.

- [ ] **Step 3: Add the additive migration and explicit model field**

```sql
ruleset_version INTEGER NOT NULL DEFAULT 1
```

```csharp
var hasRulesetVersion = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('game_matches') WHERE name='ruleset_version'");
if (hasRulesetVersion == 0)
    conn.Execute("ALTER TABLE game_matches ADD COLUMN ruleset_version INTEGER NOT NULL DEFAULT 1");
conn.Execute("""
    CREATE INDEX IF NOT EXISTS ix_game_matches_duration_group
    ON game_matches(game_type, format, ruleset_version, ended_at);
    """);

public record CompletedMatch(
    string GameType, int ChannelId, string Format, int RulesetVersion,
    string Outcome, string? AbandonReason, DateTimeOffset StartedAt,
    DateTimeOffset EndedAt, IReadOnlyList<CompletedParticipant> Participants,
    string? MetadataJson = null)
{
    public CompletedMatch(
        string GameType, int ChannelId, string Format,
        string Outcome, string? AbandonReason, DateTimeOffset StartedAt,
        DateTimeOffset EndedAt, IReadOnlyList<CompletedParticipant> Participants,
        string? MetadataJson = null)
        : this(GameType, ChannelId, Format, 1, Outcome, AbandonReason, StartedAt, EndedAt, Participants, MetadataJson) { }
}

public class GameRepository : IDurationSampleRepository
{
    // Existing persistence and statistics methods remain here.
}
```

Update the insert columns/values to include `ruleset_version` and `@RulesetVersion`. Keep the delegating constructor that supplies ruleset `1` until Task 4 updates every `CompletedMatch` producer; this preserves source compatibility for existing manager/tests at the Task 2 commit.

- [ ] **Step 4: Add the exact newest-100 qualifying query**

```csharp
public async Task<IReadOnlyList<DurationSample>> GetDurationSamplesAsync(
    string gameType, string format, int rulesetVersion, long? elapsedGreaterThanMs)
{
    using var conn = _db.CreateConnection();
    var rows = await conn.QueryAsync<(long MatchId, long DurationMs, string Outcome, string EndedAt)>("""
        SELECT id AS MatchId, duration_ms AS DurationMs, outcome AS Outcome, ended_at AS EndedAt
        FROM game_matches
        WHERE game_type = @gameType
          AND format = @format
          AND ruleset_version = @rulesetVersion
          AND outcome IN ('decided', 'draw')
          AND duration_ms > 0
          AND (@elapsedGreaterThanMs IS NULL OR duration_ms > @elapsedGreaterThanMs)
        ORDER BY ended_at DESC, id DESC
        LIMIT 100;
        """, new { gameType, format, rulesetVersion, elapsedGreaterThanMs });
    return rows.Select(x => new DurationSample(
        x.MatchId, x.DurationMs, x.Outcome, DateTimeOffset.Parse(x.EndedAt))).ToArray();
}
```

- [ ] **Step 5: Run repository tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~GameRepositoryTests`

Expected: PASS, including existing rows reading as ruleset version 1 and abandoned rows being excluded.

- [ ] **Step 6: Build the solution before the persistence commit**

Run: `dotnet build`

Expected: PASS; old `CompletedMatch` call sites compile through the temporary default and repository tests pass.

- [ ] **Step 7: Commit the persistence schema**

```bash
git add src/Brmble.Server/Data/Database.cs src/Brmble.Server/Games/GameMatchModels.cs src/Brmble.Server/Games/GameRepository.cs tests/Brmble.Server.Tests/Games/GameRepositoryTests.cs tests/Brmble.Server.Tests/Games/GameTestHelpers.cs
git commit -m "feat: persist duel ruleset versions"
```

## Task 3: Implement Duration Medians, Remaining Estimates, And ETA Propagation

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelModels.cs`
- Create: `src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs`
- Create: `tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs`

- [ ] **Step 1: Write failing estimator tests for every statistical rule**

```csharp
[DataTestMethod]
[DataRow(9, false)]
[DataRow(10, true)]
public async Task FullEstimate_RequiresTenSamples(int count, bool known)
{
    var repo = new StubDurationRepository(Enumerable.Range(1, count).Select(i => (long)i * 1000));
    var estimate = await new DuelDurationEstimator(repo).EstimateDurationAsync(Config("rps", "bo3", 1));
    Assert.AreEqual(known, estimate.Status == EstimateStatus.Known);
    Assert.AreEqual(count, estimate.SampleCount);
}

[TestMethod]
public async Task RemainingEstimate_UsesConditionalMedianThenClampedFallback()
{
    var repo = new StubDurationRepository(full: Repeat(20_000, 10), conditional: Repeat(30_000, 9));
    var estimate = await new DuelDurationEstimator(repo).EstimateRemainingAsync(Config("rps", "bo3", 1), 25_000);
    Assert.AreEqual(0L, estimate.Milliseconds);
    Assert.AreEqual(EstimateMethod.FullMedianFallback, estimate.Method);
    Assert.AreEqual(10, estimate.SampleCount);
}

[TestMethod]
public void Combine_UnknownRequiredSegmentMakesOnlyAffectedEtaUnknown()
{
    var known = DurationEstimate.Known(20_000, 15, EstimateMethod.FullMedian);
    var unknown = DurationEstimate.Unknown(9);
    Assert.AreEqual(EstimateStatus.Known, DuelDurationEstimator.Combine([known]).Status);
    Assert.AreEqual(EstimateStatus.Unknown, DuelDurationEstimator.Combine([known, unknown]).Status);
}

[TestMethod]
public async Task BuildEtas_ExcludesOwnDurationAndIncludesEarlierReservations()
{
    var sut = new DuelDurationEstimator(new StubDurationRepository(full: Repeat(10_000, 10)));
    var etas = await sut.BuildEtasAsync(Input(activeRemainingMs: 5_000,
        queue: [Reservation(1), Reservation(2)]));
    Assert.AreEqual(5_000L, etas[0].Milliseconds);
    Assert.AreEqual(15_000L, etas[1].Milliseconds);
    Assert.AreEqual(2, etas[1].Segments.Count);
}
```

Also add tests for odd median `[1, 4, 9] => 4`, even median `[1, 4, 9, 20] => 6`, outliers, group isolation, newest 100, and old timestamps remaining eligible.

- [ ] **Step 2: Run estimator tests and verify they fail on missing implementation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelDurationEstimatorTests`

Expected: FAIL with missing estimator and estimate types.

- [ ] **Step 3: Implement exact median and estimate methods**

```csharp
public sealed class DuelDurationEstimator
{
    private const int MinimumSamples = 10;
    private readonly IDurationSampleRepository _repository;
    public DuelDurationEstimator(IDurationSampleRepository repository) => _repository = repository;

    public async Task<DurationEstimate> EstimateDurationAsync(DuelConfiguration config)
    {
        var samples = await _repository.GetDurationSamplesAsync(
            config.GameType, config.Format, config.RulesetVersion, null);
        return samples.Count >= MinimumSamples
            ? DurationEstimate.Known(Median(samples.Select(x => x.DurationMs)), samples.Count, EstimateMethod.FullMedian)
            : DurationEstimate.Unknown(samples.Count);
    }

    public async Task<DurationEstimate> EstimateRemainingAsync(DuelConfiguration config, long elapsedMs)
    {
        var conditional = await _repository.GetDurationSamplesAsync(config.GameType, config.Format, config.RulesetVersion, elapsedMs);
        if (conditional.Count >= MinimumSamples)
            return DurationEstimate.Known(Median(conditional.Select(x => x.DurationMs - elapsedMs)), conditional.Count, EstimateMethod.ConditionalRemaining);
        var full = await EstimateDurationAsync(config);
        return full.Status == EstimateStatus.Known
            ? DurationEstimate.Known(Math.Max(0, full.Milliseconds!.Value - elapsedMs), full.SampleCount, EstimateMethod.FullMedianFallback)
            : full;
    }

    internal static long Median(IEnumerable<long> values)
    {
        var ordered = values.Order().ToArray();
        if (ordered.Length == 0) throw new ArgumentException("Median requires at least one value.", nameof(values));
        var middle = ordered.Length / 2;
        return ordered.Length % 2 == 1 ? ordered[middle] : checked((ordered[middle - 1] + ordered[middle]) / 2);
    }

    public static DurationEstimate Combine(IReadOnlyList<DurationEstimate> segments)
    {
        var insufficient = segments.FirstOrDefault(x => x.Status == EstimateStatus.Unknown);
        if (insufficient is not null) return DurationEstimate.Unknown(insufficient.SampleCount);
        return DurationEstimate.Known(segments.Sum(x => x.Milliseconds!.Value),
            segments.Where(x => x.Method != EstimateMethod.ReadyWindow).Select(x => x.SampleCount).DefaultIfEmpty(0).Min(),
            EstimateMethod.FullMedian);
    }

    public async Task<IReadOnlyList<QueueEtaSnapshot>> BuildEtasAsync(ChannelSnapshotInput input)
    {
        var accumulated = new List<DurationEstimate>();
        var segmentMeta = new List<EtaSegmentSnapshot>();
        if (input.Active is not null)
            Add(await EstimateRemainingAsync(input.Active.Configuration,
                Math.Max(0, (long)(input.CalculatedAt - input.Active.StartedAt).TotalMilliseconds)), input.Active.Configuration);
        if (input.ReadyCheck is not null)
        {
            Add(DurationEstimate.Known(Math.Max(0, (long)(input.ReadyCheck.ExpiresAt - input.CalculatedAt).TotalMilliseconds), int.MaxValue, EstimateMethod.ReadyWindow), input.ReadyCheck.Reservation.Configuration);
            Add(await EstimateDurationAsync(input.ReadyCheck.Reservation.Configuration), input.ReadyCheck.Reservation.Configuration);
        }
        var result = new List<QueueEtaSnapshot>(input.Queue.Count);
        foreach (var reservation in input.Queue)
        {
            var combined = Combine(accumulated);
            result.Add(new(combined.Status,
                combined.Status == EstimateStatus.Known ? input.CalculatedAt.AddMilliseconds(combined.Milliseconds!.Value) : null,
                combined.Milliseconds, true, segmentMeta.ToArray()));
            Add(await EstimateDurationAsync(reservation.Configuration), reservation.Configuration);
        }
        return result;

        void Add(DurationEstimate estimate, DuelConfiguration config)
        {
            accumulated.Add(estimate);
            segmentMeta.Add(new(config.GameType, config.Format, config.RulesetVersion, estimate.SampleCount, estimate.Method));
        }
    }
}
```

Use the stable `ChannelSnapshotInput`, `ActiveSnapshotInput`, and `ReadySnapshotInput` records defined in Task 1. The test must assert ETA 1 excludes its own duration, ETA 2 includes queue entry 1's duration, and unknown propagates from the first insufficient required segment.

- [ ] **Step 4: Run estimator tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelDurationEstimatorTests`

Expected: PASS for thresholds, newest-100, medians, grouping, no cutoff, conditional remaining, fallback, clamp, and unknown propagation.

- [ ] **Step 5: Commit ETA calculation**

```bash
git add src/Brmble.Server/Games/Duels/DuelModels.cs src/Brmble.Server/Games/Duels/DuelDurationEstimator.cs tests/Brmble.Server.Tests/Games/Duels/DuelDurationEstimatorTests.cs
git commit -m "feat: calculate server-side duel queue ETAs"
```

## Task 4: Extract Active Match Runtime And Make Persistence Non-Blocking

**Files:**
- Create: `src/Brmble.Server/Games/CompletedMatchPersistenceQueue.cs`
- Create: `src/Brmble.Server/Games/Duels/DuelMatchRunnerRouter.cs`
- Modify: `src/Brmble.Server/Games/Duels/DuelModels.cs`
- Modify: `src/Brmble.Server/Games/GameMatchModels.cs`
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/CompletedMatchPersistenceQueueTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/Duels/DuelMatchRunnerRouterTests.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`

- [ ] **Step 1: Write failing runtime-boundary tests**

```csharp
[TestMethod]
public async Task StartAsync_UsesReservationConfigurationAndRaisesCompletion()
{
    var reservation = TestReservation(gameType: "rps", format: "bo5", rulesetVersion: 3, options: new() { ["bestOf"] = 5 });
    var completion = new TaskCompletionSource<MatchCompletion>();
    var manager = NewRuntime(onCompleted: x => { completion.SetResult(x); return Task.CompletedTask; });
    var started = await manager.StartAsync(reservation);
    await PlayRpsToCompletion(manager, started.MatchId, reservation.PlayerOne.SessionId, reservation.PlayerTwo.SessionId, targetWins: 3);
    var result = await completion.Task;
    Assert.AreEqual(reservation.ReservationId, result.ReservationId);
    Assert.AreEqual(3, result.Configuration.RulesetVersion);
}

[TestMethod]
public async Task Completion_ReleasesRuntimeBeforePersistenceRetry()
{
    var sink = new BlockingCompletedMatchSink();
    var manager = NewRuntime(sink: sink);
    var started = await manager.StartAsync(TestReservation());
    await manager.ForfeitAsync(started.MatchId, TestReservation().PlayerOne.UserId, "forfeit");
    Assert.IsFalse(manager.IsMatchLive(started.MatchId));
    Assert.AreEqual(1, sink.Enqueued.Count);
}

[TestMethod]
public async Task Router_RoutesStartLookupAndForfeitByRunnerKeyAndStableUserId()
{
    var discrete = new FakeRunner("discrete");
    var continuous = new FakeRunner("continuous");
    var router = new DuelMatchRunnerRouter([discrete, continuous]);
    var reservation = TestReservation(runnerKey: "continuous", playerOneUserId: 501);
    var started = await router.StartAsync(reservation);
    Assert.AreSame(reservation, continuous.Starts.Single());
    Assert.IsTrue(router.TryGetActiveMatch(501, out var active));
    await router.ForfeitAsync(started.MatchId, 501, "left_channel");
    Assert.AreEqual((started.MatchId, 501L, "left_channel"), continuous.Forfeits.Single());
}
```

- [ ] **Step 2: Run focused tests and verify the old invite-owning API fails them**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameSessionManagerTests|FullyQualifiedName~CompletedMatchPersistenceQueueTests|FullyQualifiedName~DuelMatchRunnerRouterTests"`

Expected: FAIL because `StartAsync(DuelReservation)`, `DuelMatchRunnerRouter`, stable-user active lookup, and `ICompletedMatchSink` are absent.

- [ ] **Step 3: Define the match-runner boundary and retry sink**

```csharp
public interface IDuelMatchRunner
{
    string RunnerKey { get; }
    event Func<MatchCompletion, Task>? MatchCompleted;
    Task<GameStartResult> StartAsync(DuelReservation reservation);
    bool TryGetActiveMatch(long userId, out ActiveMatchReference match);
    Task ForfeitAsync(long matchId, long userId, string reason);
}

public interface ICompletedMatchSink { void Enqueue(CompletedMatch match); }

public sealed class DuelMatchRunnerRouter : IDuelMatchRunnerRouter
{
    private readonly IReadOnlyDictionary<string, IDuelMatchRunner> _runners;
    private readonly ConcurrentDictionary<long, IDuelMatchRunner> _runnerByMatch = new();
    public event Func<MatchCompletion, Task>? MatchCompleted;
    public DuelMatchRunnerRouter(IEnumerable<IDuelMatchRunner> runners)
    {
        _runners = runners.ToDictionary(x => x.RunnerKey, StringComparer.Ordinal);
        foreach (var runner in _runners.Values) runner.MatchCompleted += ForwardCompletionAsync;
    }
    public async Task<GameStartResult> StartAsync(DuelReservation reservation)
    {
        if (!_runners.TryGetValue(reservation.Configuration.RunnerKey, out var runner))
            return new(false, 0, null, $"Runner '{reservation.Configuration.RunnerKey}' is unavailable.");
        var result = await runner.StartAsync(reservation);
        if (result.Success) _runnerByMatch[result.MatchId] = runner;
        return result;
    }
    public bool TryGetActiveMatch(long userId, out ActiveMatchReference match)
    {
        foreach (var runner in _runners.Values)
            if (runner.TryGetActiveMatch(userId, out match)) return true;
        match = null!;
        return false;
    }
    public Task ForfeitAsync(long matchId, long userId, string reason) =>
        _runnerByMatch.TryGetValue(matchId, out var runner) ? runner.ForfeitAsync(matchId, userId, reason) : Task.CompletedTask;
    private async Task ForwardCompletionAsync(MatchCompletion completion)
    {
        _runnerByMatch.TryRemove(completion.MatchId, out _);
        if (MatchCompleted is not null) await MatchCompleted(completion);
    }
}
```

`CompletedMatchPersistenceQueue` uses `Channel<CompletedMatch>`, implements `ICompletedMatchSink` and `BackgroundService`, retries `SaveCompletedMatchAsync` after `1s, 5s, 30s`, then every 60 seconds until shutdown, and logs each failure. `GameSessionManager` must remove its live dictionary entry and invoke `MatchCompleted` in a `finally` path after enqueueing, never await database persistence before releasing orchestration.

Register `GameSessionManager` as `IDuelMatchRunner`, register `DuelMatchRunnerRouter` as `IDuelMatchRunnerRouter`, and register the persistence queue as one singleton exposed as both `ICompletedMatchSink` and hosted service:

```csharp
services.AddSingleton<GameSessionManager>();
services.AddSingleton<IDuelMatchRunner>(sp => sp.GetRequiredService<GameSessionManager>());
services.AddSingleton<DuelMatchRunnerRouter>();
services.AddSingleton<IDuelMatchRunnerRouter>(sp => sp.GetRequiredService<DuelMatchRunnerRouter>());
services.AddSingleton<CompletedMatchPersistenceQueue>();
services.AddSingleton<ICompletedMatchSink>(sp => sp.GetRequiredService<CompletedMatchPersistenceQueue>());
services.AddHostedService(sp => sp.GetRequiredService<CompletedMatchPersistenceQueue>());
```

- [ ] **Step 4: Replace challenge methods with `StartAsync` while preserving action semantics**

```csharp
public async Task<GameStartResult> StartAsync(DuelReservation reservation)
{
    if (!_engines.TryGetValue(reservation.Configuration.GameType, out var engine))
        return new(false, 0, null, "Game engine is unavailable.");
    var matchId = Interlocked.Increment(ref _matchIdCounter);
    var startedAt = _clock.GetUtcNow();
    var match = LiveMatch.FromReservation(matchId, reservation, engine,
        engine.InitialState(
            [new(reservation.PlayerOne.SessionId), new(reservation.PlayerTwo.SessionId)],
            _rng, reservation.Configuration.Options), startedAt);
    if (!_matches.TryAdd(matchId, match)) return new(false, 0, null, "Match id collision.");
    await PublishStartedAsync(match);
    StartTurnTimer(match, TurnTimeout);
    return new(true, matchId, startedAt, null);
}

public bool TryGetActiveMatch(long userId, out ActiveMatchReference match)
{
    if (_userIdToMatch.TryGetValue(userId, out var matchId) && _matches.TryGetValue(matchId, out var live))
    {
        match = new(matchId, live.ReservationId, live.ChannelId, RunnerKey);
        return true;
    }
    match = null!;
    return false;
}

public Task ForfeitAsync(long matchId, long userId, string reason)
{
    if (!_matches.TryGetValue(matchId, out var match)) return Task.CompletedTask;
    var player = match.Players.SingleOrDefault(x => x.UserId == userId);
    return player is null ? Task.CompletedTask : ForfeitSessionAsync(matchId, player.SessionId, reason);
}
```

Build every `CompletedMatch` with `match.Configuration.Format` and `match.Configuration.RulesetVersion`, update all manager/test constructors, then remove Task 2's delegating ruleset-1 `CompletedMatch` constructor. Keep participant `game.started`, `game.stateUpdated`, `game.ended`, feed events, turn timers, authorization, and Deathroll/RPS views unchanged. `MumbleServerCallback` compiles at this boundary by accepting `IDuelMatchRunnerRouter` and using `TryGetActiveMatch(mapping.UserId, ...)`/`ForfeitAsync(..., mapping.UserId, ...)`; Task 6 adds queue cleanup callbacks. Retain the existing public `InviteAsync`/`RespondAsync` methods and their old private pending-invite fields as `[Obsolete("Use DuelOrchestrator after Task 5")]` transitional code so `GameEndpoints` and existing invite tests compile at this commit; Task 5 switches every consumer and deletes that block.

- [ ] **Step 5: Run runtime and persistence tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameSessionManagerTests|FullyQualifiedName~CompletedMatchPersistenceQueueTests|FullyQualifiedName~DuelMatchRunnerRouterTests|FullyQualifiedName~MumbleServerCallbackTests"`

Expected: PASS; existing Deathroll/RPS play tests still pass and persistence retries do not block completion callbacks.

- [ ] **Step 6: Build all projects before the runtime boundary commit**

Run: `dotnet build`

Expected: PASS with `GameSessionManager`, callback consumers, router tests, and all `CompletedMatch` call sites migrated.

- [ ] **Step 7: Verify only the documented transitional endpoint still calls manager invite APIs**

Run: `git grep -n "GameSessionManager.*InviteAsync\|\.InviteAsync(\|TryGetActiveMatch(user.SessionId" -- src tests`

Expected: existing `GameEndpoints`/legacy manager invite tests may still call obsolete `InviteAsync` until Task 5; no `TryGetActiveMatch(user.SessionId)` or session-keyed active lookup remains.

- [ ] **Step 8: Commit the runtime extraction**

```bash
git add src/Brmble.Server/Games/CompletedMatchPersistenceQueue.cs src/Brmble.Server/Games/Duels/DuelMatchRunnerRouter.cs src/Brmble.Server/Games/Duels/DuelModels.cs src/Brmble.Server/Games/GameMatchModels.cs src/Brmble.Server/Games/GameSessionManager.cs src/Brmble.Server/Games/GamesExtensions.cs src/Brmble.Server/Mumble/MumbleServerCallback.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs tests/Brmble.Server.Tests/Games/CompletedMatchPersistenceQueueTests.cs tests/Brmble.Server.Tests/Games/Duels/DuelMatchRunnerRouterTests.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs
git commit -m "refactor: separate duel runtime from orchestration"
```

## Task 5: Implement Atomic Commitments, FIFO Acceptance, And Immediate Starts

**Files:**
- Create: `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs`
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`
- Create: `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`
- Create: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

- [ ] **Step 1: Write failing atomicity and ordering tests**

```csharp
[TestMethod]
public async Task SimultaneousChallenges_ReserveUserExactlyOnce()
{
    var sut = NewOrchestrator(users: SameChannel((10, 501), (20, 502), (200, 502), (30, 503)));
    var results = await Task.WhenAll(
        Task.Run(() => sut.CreateChallengeAsync(10, 20, "deathroll", null)),
        Task.Run(() => sut.CreateChallengeAsync(30, 200, "rps", Rps(3))));
    Assert.AreEqual(1, results.Count(x => x.Success));
    Assert.AreEqual(1, sut.CommitmentCountForUserForTest(502));
}

[TestMethod]
public async Task SecondSessionForSameStableUser_CannotCreateAnotherCommitment()
{
    var sut = NewOrchestrator(users: SameChannel((10, 501), (20, 502), (200, 502), (30, 503)));
    await sut.CreateChallengeAsync(10, 20, "deathroll", null);
    Assert.AreEqual(1, sut.CommitmentCountForUserForTest(502));
    var second = await sut.CreateChallengeAsync(30, 200, "rps", Rps(3));
    Assert.AreEqual(DuelRejectReason.AlreadyCommitted, second.Reason);
}

[TestMethod]
public async Task SessionLossCancelsStableUserCommitmentBeforeReplacementSessionCanCommit()
{
    var sut = NewOrchestrator(users: SameChannel((10, 501), (20, 502), (30, 503)));
    await sut.CreateChallengeAsync(10, 20, "deathroll", null);
    await sut.HandlePresenceLostAsync(502, 20, DuelCancelReason.Disconnected);
    sut.Presence.ReplaceSession(502, oldSessionId: 20, newSessionId: 200, channelId: 1);
    var replacement = await sut.CreateChallengeAsync(30, 200, "rps", Rps(3));
    Assert.IsTrue(replacement.Success);
}

[TestMethod]
public async Task Acceptance_UsesAcceptanceSequenceAndStartsIdlePairImmediately()
{
    var runner = new FakeMatchRunner();
    var sut = NewOrchestrator(runner: runner, users: SameChannel((10, 501), (20, 502), (30, 503), (40, 504), (50, 505), (60, 506)));
    var first = await sut.CreateChallengeAsync(10, 20, "deathroll", null);
    await sut.RespondToOfferAsync(first.OfferId!.Value, responderUserId: 502, accept: true);
    var older = await sut.CreateChallengeAsync(30, 40, "rps", Rps(3));
    var newer = await sut.CreateChallengeAsync(50, 60, "deathroll", null);
    await sut.RespondToOfferAsync(newer.OfferId!.Value, responderUserId: 506, accept: true);
    await sut.RespondToOfferAsync(older.OfferId!.Value, responderUserId: 504, accept: true);
    Assert.AreEqual(10, runner.Starts.Single().PlayerOne.SessionId);
    var queue = sut.QueueForTest(1).ToArray();
    CollectionAssert.AreEqual(new long[] { newer.ReservationId!.Value, older.ReservationId!.Value }, queue.Select(x => x.ReservationId).ToArray());
    Assert.IsTrue(queue.All(x => x.ReservationId != newer.OfferId && x.ReservationId != older.OfferId));
}
```

Add races for simultaneous acceptance/rematch, unavailable-before-accept, one pending incoming/outgoing total, different-channel queues, and a newly accepted pair while completion is advancing.

- [ ] **Step 2: Run orchestrator tests and verify missing implementation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelOrchestratorTests`

Expected: FAIL with missing `DuelOrchestrator` and command result types.

- [ ] **Step 3: Implement one lock and one commitment map**

```csharp
private readonly object _gate = new();
private readonly Dictionary<long, DuelOffer> _offers = [];
private readonly Dictionary<long, UserCommitment> _commitmentsByUserId = [];
private readonly Dictionary<int, ChannelDuelState> _channels = [];
private long _offerId;
private long _reservationId;
private long _acceptanceSequence;

private long NextOfferIdLocked() => ++_offerId;
private long NextReservationIdLocked() => ++_reservationId;
private long NextAcceptanceSequenceLocked() => ++_acceptanceSequence;

private bool TryCommitPair(DuelPlayer first, DuelPlayer second, DuelCommitmentKind kind, long id, out string? error)
{
    if (_commitmentsByUserId.ContainsKey(first.UserId) || _commitmentsByUserId.ContainsKey(second.UserId))
    {
        error = "A player already has an unresolved duel commitment.";
        return false;
    }
    _commitmentsByUserId[first.UserId] = new(kind, id);
    _commitmentsByUserId[second.UserId] = new(kind, id);
    error = null;
    return true;
}
```

Perform the final presence/channel validation, stable-user pair commitment, offer insertion, acceptance removal, fresh reservation-ID allocation, FIFO append, channel reservation, and revision increment only inside `_gate`. Maintain independent monotonic `_offerId` and `_reservationId` counters; `OfferId` is never copied into `ReservationId`. Never `await` while holding `_gate`; capture immutable publications/start work, release the lock, then execute effects. Pending offers do not occupy a channel slot, but reserve both stable users for 30 seconds. Resolve current stable identity from each command's session, but use the captured session only for participant event routing until presence loss cancels it.

- [ ] **Step 4: Implement acceptance and start failure advancement**

```csharp
private StartDecision AcceptLocked(DuelOffer offer, DateTimeOffset now)
{
    var reservation = offer.ToReservation(
        reservationId: NextReservationIdLocked(),
        acceptedAt: now,
        acceptanceSequence: NextAcceptanceSequenceLocked());
    var channel = GetChannelLocked(offer.ChannelId);
    TransitionPairLocked(offer.Players, DuelCommitmentKind.Queued, reservation.ReservationId);
    if (channel.Active is null && channel.ReadyCheck is null && channel.Queue.Count == 0 && !channel.Advancing)
    {
        channel.Advancing = true;
        TransitionPairLocked(offer.Players, DuelCommitmentKind.Active, reservation.ReservationId);
        BumpLocked(channel);
        return StartDecision.Immediate(reservation);
    }
    channel.Queue.Enqueue(reservation);
    BumpLocked(channel);
    return StartDecision.Queued(reservation);
}
```

After `runner.StartAsync`, set `ActiveDuel` and clear `Advancing` under `_gate`. On failure, publish `game.commitmentCanceled` with reason `startFailed`, release both users, clear the slot, and immediately call advancement so no failed reservation blocks the channel.

Implement `IDuelOrchestrator`. Inject `GameDefinitionCatalog` and `IDuelMatchRunnerRouter`; `CreateChallengeAsync` calls the catalog before entering `_gate`, and all start/active-forfeit routing goes through the router. Register one singleton as both concrete and interface only after Tasks 1 and 4 have registered dependencies:

```csharp
services.AddSingleton<DuelOrchestrator>();
services.AddSingleton<IDuelOrchestrator>(sp => sp.GetRequiredService<DuelOrchestrator>());
```

Switch `/games/invite` and `/games/respond` to `IDuelOrchestrator`, migrate endpoint tests to stable user authorization, then delete Task 4's obsolete `GameSessionManager` invite/pending block and its legacy invite tests. `GameSessionManager` retains only active runtime/action APIs after this step.

- [ ] **Step 5: Run atomicity/FIFO tests repeatedly**

Run:

```powershell
1..20 | ForEach-Object {
    dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelOrchestratorTests
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: PASS on all 20 runs with exactly one commitment per stable user and acceptance-order FIFO.

- [ ] **Step 6: Build after removing transitional manager challenge ownership**

Run: `dotnet build`

Expected: PASS; `/games/invite` and `/games/respond` resolve through `IDuelOrchestrator`, and no production code requires the deleted manager pending-invite block.

- [ ] **Step 7: Commit core orchestration**

```bash
git add src/Brmble.Server/Games/Duels/DuelOrchestrator.cs src/Brmble.Server/Games/GamesExtensions.cs src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat: orchestrate atomic FIFO duel commitments"
```

## Task 6: Add Ready Checks, Timers, Presence Cleanup, And Channel Cleanup

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs:159-225`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`

- [ ] **Step 1: Write failing ready and cleanup state-machine tests**

```csharp
[TestMethod]
public async Task Completion_PromotesFirstPresentPair_AndStartsAfterBothReady()
{
    var (sut, runner, clock) = NewQueuedOrchestrator();
    await runner.CompleteActiveAsync();
    var ready = sut.SnapshotForTest(1).ReadyCheck!;
    Assert.AreEqual(clock.GetUtcNow().AddSeconds(15), ready.ExpiresAt);
    await sut.RespondReadyAsync(ready.ReservationId, 503, ReadyResponse.Accept);
    Assert.AreEqual(1, runner.Starts.Count);
    await sut.RespondReadyAsync(ready.ReservationId, 504, ReadyResponse.Accept);
    Assert.AreEqual(2, runner.Starts.Count);
}

[DataTestMethod]
[DataRow("decline")]
[DataRow("timeout")]
[DataRow("disconnect")]
[DataRow("leftChannel")]
public async Task ReadyFailure_RemovesPairAndImmediatelyAdvances(string failure)
{
    var sut = await BuildTwoWaitingPairsAsync();
    await FailCurrentReadyAsync(sut, failure);
    Assert.AreEqual(50, sut.SnapshotForTest(1).ReadyCheck!.Players[0].SessionId);
    Assert.IsFalse(sut.HasCommitmentForUserForTest(503));
    Assert.IsFalse(sut.HasCommitmentForUserForTest(504));
}

[TestMethod]
public async Task ChannelRemoval_PreservesLifetimeRevisionAndIncrementsGeneration()
{
    var sut = await BuildActiveChannelAsync(channelId: 1);
    var before = sut.SnapshotForTest(1);
    await sut.HandleChannelRemovedAsync(1);
    await sut.AcceptPairInChannelAsync(1, 30, 40);
    var after = sut.SnapshotForTest(1);
    Assert.IsTrue(after.Generation > before.Generation);
    Assert.IsTrue(after.Revision > before.Revision);
}
```

Add tests that disconnected/left users cancel offers and queued entries, active matches still call `ForfeitAsync`, stale timer generations do nothing, invalid queue entries are skipped, channel removal clears all ephemeral state, and an empty snapshot is published.

- [ ] **Step 2: Run focused state-machine and callback tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~MumbleServerCallbackTests"`

Expected: FAIL because ready responses and orchestrator presence callbacks are absent.

- [ ] **Step 3: Add server-owned ready windows and generation-safe timers**

```csharp
private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(15);

private sealed record ReadyCheck(
    DuelReservation Reservation,
    DateTimeOffset ExpiresAt,
    HashSet<long> ReadyUserIds,
    long Generation,
    Timer Timer);

public Task<DuelCommandResult> RespondReadyAsync(long reservationId, long userId, ReadyResponse response)
```

On completion: release active users first, dequeue until both users are still Brmble-connected in the same channel, transition the first valid pair to `ReadyCheck`, arm one timer, increment revision, publish. Decline/timeout/disconnect/leave removes both commitments and calls the same advancement loop. A stale callback must compare channel ready generation and reservation ID before mutating.

- [ ] **Step 4: Wire presence before destructive membership updates**

```csharp
// DispatchUserDisconnected, before session/membership removal:
await _duelOrchestrator.HandlePresenceLostAsync(mapping.UserId, user.SessionId, DuelCancelReason.Disconnected);

// DispatchUserStateChanged, before membership.Update when channelChanged:
await _duelOrchestrator.HandlePresenceLostAsync(mapping.UserId, user.SessionId, DuelCancelReason.LeftChannel);

public async Task DispatchChannelRemoved(MumbleChannel channel)
{
    await _duelOrchestrator.HandleChannelRemovedAsync(channel.Id);
    await Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));
}
```

Resolve the callback's session to stable `mapping.UserId` before removing mappings. `HandlePresenceLostAsync(userId, oldSessionId, reason)` removes pending/queued/ready commitments by stable user ID; for active users it calls `_runnerRouter.TryGetActiveMatch(userId, out active)` then `_runnerRouter.ForfeitAsync(active.MatchId, userId, reasonWire)`, and releases only on completion. Keep `_channelClocks[channelId] = ChannelClock(Generation, Revision)` for process lifetime even after removing ephemeral state: channel removal increments both, publishes empty, and the next state reuses the higher values. Process restart alone resets clocks, matching ephemeral persistence scope.

- [ ] **Step 5: Run ready/presence tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~MumbleServerCallbackTests"`

Expected: PASS for decline, timeout, disconnect, movement, stale timers, start failures, and channel removal.

- [ ] **Step 6: Commit ready and cleanup behavior**

```bash
git add src/Brmble.Server/Games/Duels/DuelOrchestrator.cs tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs src/Brmble.Server/Mumble/MumbleServerCallback.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs
git commit -m "feat: add duel ready checks and presence cleanup"
```

## Task 7: Add Consensual Rematches At Queue Tail

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`

- [ ] **Step 1: Write failing rematch tests**

```csharp
[TestMethod]
public async Task AcceptedRematch_PreservesConfigurationAndJoinsCurrentTail()
{
    var sut = await CompletedRpsBo5Async(rulesetVersion: 4);
    await sut.QueueAnotherPairAsync(30, 40);
    var offer = await sut.RequestRematchAsync(sourceMatchId: 91, requesterUserId: 501);
    await sut.RespondToOfferAsync(offer.OfferId!.Value, responderUserId: 502, accept: true);
    var queue = sut.QueueForTest(1).ToArray();
    Assert.AreEqual(2, queue.Length);
    Assert.AreEqual("bo5", queue[1].Configuration.Format);
    Assert.AreEqual(4, queue[1].Configuration.RulesetVersion);
    Assert.AreEqual(5, queue[1].Configuration.Options["bestOf"]);
    Assert.AreEqual(91L, queue[1].SourceMatchId);
}
```

Add tests for either participant requesting, non-participant rejection, 30-second expiry, simultaneous requests producing one offer, both users being reserved during the offer, disconnect/channel change invalidation, and idle acceptance starting immediately.

- [ ] **Step 2: Run rematch tests and verify missing APIs**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests&Name~Rematch"`

Expected: FAIL because completed match sources and rematch commands are absent.

- [ ] **Step 3: Retain bounded in-memory completed sources and create rematch offers**

```csharp
public sealed record CompletedDuelSource(
    long MatchId, int ChannelId, DuelPlayer PlayerOne, DuelPlayer PlayerTwo,
    DuelConfiguration Configuration, DateTimeOffset CompletedAt);

public Task<DuelCommandResult> RequestRematchAsync(long sourceMatchId, long requesterUserId)
```

Store completed sources for 30 minutes or the newest 1,000 entries, whichever removes first; this is ephemeral authorization/configuration state, not queue persistence. Under `_gate`, verify the requester participated, both users are currently available in the source channel, atomically reserve both as `RematchOffer`, create a 30-second offer addressed to the other player, and publish `game.rematchOffered`. Acceptance uses the same `AcceptLocked` path and therefore can never bypass the queue.

- [ ] **Step 4: Run rematch tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests&Name~Rematch"`

Expected: PASS with exact game/options/format/ruleset preservation and tail insertion.

- [ ] **Step 5: Commit rematches**

```bash
git add src/Brmble.Server/Games/Duels/DuelOrchestrator.cs tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs
git commit -m "feat: add consensual queued rematches"
```

## Task 8: Publish Complete Versioned Snapshots And Recover On Reconnect

**Files:**
- Modify: `src/Brmble.Server/Games/Duels/DuelOrchestrator.cs`
- Modify: `src/Brmble.Server/Games/Duels/DuelModels.cs`
- Modify: `src/Brmble.Server/Games/Duels/DuelWire.cs`
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs:7-117`
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs:37-69`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Modify: `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`

- [ ] **Step 1: Write failing snapshot contract and recovery tests**

```csharp
[TestMethod]
public async Task EveryMutation_PublishesCompleteMonotonicSnapshotIncludingEmpty()
{
    var sut = NewOrchestrator();
    await AcceptAndCompleteAsync(sut);
    var snapshots = Published<DuelQueueSnapshot>("game.queueSnapshot");
    Assert.IsTrue(snapshots.Zip(snapshots.Skip(1)).All(x => x.First.Revision < x.Second.Revision));
    Assert.IsNull(snapshots[^1].Active);
    Assert.IsNull(snapshots[^1].ReadyCheck);
    Assert.AreEqual(0, snapshots[^1].Queue.Count);
}

[TestMethod]
public async Task ConcurrentMutations_PublishSnapshotsInRevisionOrderPerChannel()
{
    var sut = NewOrchestrator(publisher: DelayingPublisher.DelayRevision(2));
    await Task.WhenAll(sut.AcceptPairInChannelAsync(1, 10, 20), sut.AcceptPairInChannelAsync(1, 30, 40));
    var revisions = Published<DuelQueueSnapshot>("game.queueSnapshot").Select(x => x.Revision).ToArray();
    CollectionAssert.AreEqual(revisions.Order().ToArray(), revisions);
}

[TestMethod]
public async Task WebSocketConnect_SendsCurrentChannelSnapshotToOnlyThatUser()
{
    var orchestrator = new Mock<IDuelSnapshotProvider>();
    orchestrator.Setup(x => x.GetSnapshotForSessionAsync(10)).ReturnsAsync(QueueSnapshot(channelId: 7, revision: 12));
    await ConnectWebSocketAsAsync(userId: 5, sessionId: 10);
    AssertJsonMessage("game.queueSnapshot", x => x.GetProperty("revision").GetInt64() == 12);
}

[TestMethod]
public async Task QueueGet_ReturnsAuthenticatedUsersCurrentCompleteSnapshot()
{
    var duels = new Mock<IDuelOrchestrator>();
    duels.Setup(x => x.GetSnapshotForSessionAsync(10)).ReturnsAsync(QueueSnapshot(channelId: 7, generation: 2, revision: 12));
    await using var factory = new BrmbleServerFactory().WithService(duels.Object);
    var client = factory.CreateAuthenticatedClient(userId: 501, sessionId: 10);
    var payload = await client.GetFromJsonAsync<JsonElement>("/games/queue");
    Assert.AreEqual(2L, payload.GetProperty("generation").GetInt64());
    Assert.AreEqual(12L, payload.GetProperty("revision").GetInt64());
}
```

- [ ] **Step 2: Run snapshot tests and verify missing provider/API behavior**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~DuelSerializationTests|FullyQualifiedName~GameEndpointsTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: FAIL because complete snapshots and reconnect delivery are absent.

- [ ] **Step 3: Build immutable snapshots under lock and ETAs outside lock**

```csharp
private async Task PublishSnapshotAsync(int channelId)
{
    var lane = _snapshotLanes.GetOrAdd(channelId, _ => new SemaphoreSlim(1, 1));
    await lane.WaitAsync();
    try
    {
        ChannelSnapshotInput input;
        lock (_gate) input = SnapshotInputLocked(channelId, _clock.GetUtcNow());
        lock (_gate)
            if (_lastPublishedRevision.TryGetValue(channelId, out var published) && input.Revision <= published)
                return;
        var started = Stopwatch.GetTimestamp();
        var snapshot = await _estimator.BuildSnapshotAsync(input);
        snapshot = snapshot with { CalculationTimeMs = (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds };
        await _publisher.PublishToChannelAsync(channelId, DuelWire.ToEvent(snapshot));
        lock (_gate) _lastPublishedRevision[channelId] = snapshot.Revision;
    }
    finally { lane.Release(); }
}
```

`Revision` starts at 1 on the first accepted queue mutation and increments for active starting/live, enqueue/dequeue, ready response/failure, completion, cancellation, and channel clear. `Generation` starts at 1, increments when a channel is removed/recreated, and remains in `_channelClocks` for process lifetime. Challenge creation/decline changes private commitments but does not mutate the channel queue. Snapshot `Queue` is always complete. One `SemaphoreSlim` lane per channel serializes calculation/publication; while holding the lane, rebuild from current state and skip publication when `input.Revision <= _lastPublishedRevision[channelId]`. This prevents revision 12 arriving before revision 11 or an older queued publication arriving after 12; different channels publish concurrently. Clients compare `(generation, revision)`, accepting a higher generation or the same generation with higher revision.

- [ ] **Step 4: Add authenticated request and reconnect recovery**

```csharp
app.MapGet("/games/queue", async (HttpContext ctx, ..., DuelOrchestrator duels, ISessionMappingService sessions) =>
{
    var user = await ResolveUserAsync(ctx, certs, users);
    if (user is null) return Results.Unauthorized();
    if (!sessions.TryGetSessionByUserId(user.UserId, out var session)) return Results.BadRequest();
    return Results.Ok(await duels.GetSnapshotForSessionAsync(session));
});
```

After `eventBus.AddClient`, `BrmbleWebSocketHandler` resolves the session and sends the same current complete snapshot directly to that socket. If no channel state exists, return schema 1 with the process-lifetime generation/revision, or generation 0/revision 0 if the channel has never been seen, and null/empty fields. Do not replay old events.

- [ ] **Step 5: Run snapshot/reconnect tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~DuelOrchestratorTests|FullyQualifiedName~DuelSerializationTests|FullyQualifiedName~GameEndpointsTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: PASS with complete snapshots, calculation time/sample counts, empty idle snapshots, and one-shot reconnect recovery.

- [ ] **Step 6: Commit snapshots and recovery**

```bash
git add src/Brmble.Server/Games/Duels/DuelOrchestrator.cs src/Brmble.Server/Games/Duels/DuelModels.cs src/Brmble.Server/Games/Duels/DuelWire.cs src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/Duels/DuelOrchestratorTests.cs tests/Brmble.Server.Tests/Games/Duels/DuelSerializationTests.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs
git commit -m "feat: publish recoverable duel queue snapshots"
```

## Task 9: Expose Orchestration Commands Through Server And Native Bridge

**Files:**
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs`
- Modify: `src/Brmble.Client/Services/Games/GameService.cs:47-54,88-141`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2712-2722`
- Modify: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Create: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterGameEventForwardingTests.cs`

- [ ] **Step 1: Write failing native bridge routing tests**

```csharp
[TestMethod]
public async Task RegisterHandlers_RoutesReadyRematchAndQueueRequest()
{
    var harness = GameServiceHarness.Create();
    harness.Send("game.ready", new { reservationId = 42, ready = true });
    harness.Send("game.rematch", new { sourceMatchId = 91 });
    harness.Send("games.request", new { action = "queue", requestId = 7 });
    await harness.DrainAsync();
    CollectionAssert.Contains(harness.PostPaths, "games/ready");
    CollectionAssert.Contains(harness.PostPaths, "games/rematch");
    CollectionAssert.Contains(harness.GetPaths, "games/queue");
}

[TestMethod]
public async Task Forwarding_PreservesQueueSnapshotGenerationRevisionAndStringEnums()
{
    var harness = MumbleAdapterWebSocketHarness.Create();
    harness.Receive("""{"type":"game.queueSnapshot","generation":3,"revision":9,"queue":[],"status":"unknown","method":"fullMedianFallback"}""");
    var forwarded = harness.SingleBridgeMessage("game.queueSnapshot");
    Assert.AreEqual(3L, forwarded.GetProperty("generation").GetInt64());
    Assert.AreEqual("unknown", forwarded.GetProperty("status").GetString());
    Assert.AreEqual("fullMedianFallback", forwarded.GetProperty("method").GetString());
}

[TestMethod]
public async Task CancelOffer_RequiresAuthenticatedOwnerAndUsesOfferId()
{
    var duels = new Mock<IDuelOrchestrator>();
    duels.Setup(x => x.CancelOfferAsync(72, 999)).ReturnsAsync(
        new DuelCommandResult(false, 72, null, "Only the inviter can cancel this offer.", DuelRejectReason.NotParticipant));
    duels.Setup(x => x.CancelOfferAsync(72, 501)).ReturnsAsync(
        new DuelCommandResult(true, 72, null, null, DuelRejectReason.None));
    await using var factory = new BrmbleServerFactory().WithService(duels.Object);
    var stranger = factory.CreateAuthenticatedClient(userId: 999, sessionId: 99);
    var owner = factory.CreateAuthenticatedClient(userId: 501, sessionId: 10);
    var denied = await stranger.PostAsJsonAsync("/games/offers/cancel", new { offerId = 72 });
    Assert.AreEqual(HttpStatusCode.BadRequest, denied.StatusCode);
    Assert.AreEqual("notParticipant", (await denied.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
    Assert.AreEqual(HttpStatusCode.OK,
        (await owner.PostAsJsonAsync("/games/offers/cancel", new { offerId = 72 })).StatusCode);
}

[TestMethod]
public async Task Forfeit_RoutesByAuthenticatedStableUser()
{
    var router = new Mock<IDuelMatchRunnerRouter>();
    router.Setup(x => x.TryGetActiveMatch(501, out It.Ref<ActiveMatchReference>.IsAny))
        .Returns((long _, out ActiveMatchReference match) => { match = new(91, 44, 7, "continuous"); return true; });
    await using var factory = new BrmbleServerFactory().WithService(router.Object);
    var owner = factory.CreateAuthenticatedClient(userId: 501, sessionId: 200);
    Assert.AreEqual(HttpStatusCode.OK,
        (await owner.PostAsJsonAsync("/games/forfeit", new { matchId = 91 })).StatusCode);
    router.Verify(x => x.ForfeitAsync(91, 501, "forfeit"), Times.Once);
}
```

- [ ] **Step 2: Run client tests and verify missing routes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~GameServiceTests|FullyQualifiedName~MumbleAdapterGameEventForwardingTests"`

Expected: FAIL because `game.ready`, `game.rematch`, `game.cancelOffer`, queue request routing, endpoint coverage, and forwarding tests are absent.

- [ ] **Step 3: Add exact endpoint DTOs and bridge mappings**

```csharp
public record OfferResponseDto(long OfferId, bool Accept);
public record CancelOfferDto(long OfferId);
public record ReadyDto(long ReservationId, bool Ready);
public record RematchDto(long SourceMatchId);

bridge.RegisterHandler("game.invite", d => PostAsync("games/invite", d));
bridge.RegisterHandler("game.respond", d => PostAsync("games/respond", d));
bridge.RegisterHandler("game.cancelOffer", d => PostAsync("games/offers/cancel", d));
bridge.RegisterHandler("game.ready", d => PostAsync("games/ready", d));
bridge.RegisterHandler("game.rematch", d => PostAsync("games/rematch", d));
```

Server endpoints resolve the authenticated stable user and its current Mumble session, but authorize ownership/commitments by stable user ID. Add `POST /games/offers/cancel` calling `CancelOfferAsync(offerId, user.UserId)`; only the offer's inviter may cancel, stale/foreign IDs return stable `staleOffer`/`notParticipant` reasons, and cancellation publishes to both participants. `/games/forfeit` calls `IDuelMatchRunnerRouter.TryGetActiveMatch(user.UserId, ...)` and `ForfeitAsync(matchId, user.UserId, "forfeit")`, allowing future continuous matches to use the same endpoint. Return wire strings `{ "error": "...", "reason": "alreadyCommitted|notPresent|staleOffer|notParticipant" }`, never serialized enums.

- [ ] **Step 4: Add queue GET handling to `games.request`**

```csharp
case "queue":
{
    var result = await _getAsync(cert, new Uri(baseUri, "games/queue"));
    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
    break;
}
```

No native queue cache is introduced: WebSocket `game.queueSnapshot` events already pass through the prefix forwarding path, and request responses go directly to React.

- [ ] **Step 5: Run client and server endpoint tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~GameServiceTests|FullyQualifiedName~MumbleAdapterGameEventForwardingTests"`

Expected: PASS with exact route/body forwarding and structured errors.

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~GameEndpointsTests`

Expected: PASS for authenticated session resolution and command routing.

- [ ] **Step 6: Build server and native client before committing transport changes**

Run: `dotnet build`

Expected: PASS with real `GameEndpointsTests`, `GameServiceTests`, and `MumbleAdapterGameEventForwardingTests` compiling.

- [ ] **Step 7: Commit command transport**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Client/Services/Games/GameService.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs tests/Brmble.Client.Tests/Services/GameServiceTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterGameEventForwardingTests.cs
git commit -m "feat: bridge duel queue and ready commands"
```

## Task 10: Add Revision-Gated Web State And API Contracts

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts`
- Create: `src/Brmble.Web/src/components/Games/useDuelQueueState.ts`
- Create: `src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/useGameState.ts`

- [ ] **Step 1: Write failing hook tests for replacement, stale rejection, recovery, and commands**

```tsx
it('replaces only with a newer revision and keeps an empty idle snapshot', () => {
  const { result } = renderHook(() => useDuelQueueState());
  act(() => emit('game.queueSnapshot', snapshot(7, 1, 4, [reservation(1)])));
  act(() => emit('game.queueSnapshot', snapshot(7, 1, 3, [])));
  expect(result.current.byChannel.get(7)?.queue).toHaveLength(1);
  act(() => emit('game.queueSnapshot', snapshot(7, 1, 5, [])));
  expect(result.current.byChannel.get(7)?.queue).toEqual([]);
});

it('accepts a higher generation and clears the old channel on movement', () => {
  const { result } = renderHook(() => useDuelQueueState());
  act(() => emit('game.queueSnapshot', snapshot(7, 1, 12, [reservation(1)])));
  act(() => emit('voice.channelChanged', { previousChannelId: 7, channelId: 8 }));
  expect(result.current.byChannel.has(7)).toBe(false);
  act(() => emit('game.queueSnapshot', snapshot(7, 2, 1, [])));
  expect(result.current.byChannel.get(7)?.generation).toBe(2);
});

it('sends ready and rematch payloads without calculating ETA locally', () => {
  const { result } = renderHook(() => useDuelQueueState());
  act(() => result.current.respondReady(42, true));
  act(() => result.current.requestRematch(91));
  expect(bridge.send).toHaveBeenCalledWith('game.ready', { reservationId: 42, ready: true });
  expect(bridge.send).toHaveBeenCalledWith('game.rematch', { sourceMatchId: 91 });
});
```

- [ ] **Step 2: Run hook tests and verify missing contracts**

Run: `npm test -- --run src/components/Games/useDuelQueueState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because the hook and queue interfaces do not exist.

- [ ] **Step 3: Add exact TypeScript snapshot contracts**

```ts
export interface EstimateSegment {
  gameType: string; format: string; rulesetVersion: number;
  sampleCount: number;
  method: 'fullMedian' | 'conditionalRemaining' | 'fullMedianFallback' | 'readyWindow' | 'insufficient';
}
export interface QueueEta {
  status: 'known' | 'unknown';
  estimatedStartAt: string | null;
  milliseconds: number | null;
  approximate: true;
  segments: EstimateSegment[];
}
export interface DuelQueueSnapshot {
  schemaVersion: 1; generation: number; revision: number; channelId: number; generatedAt: string;
  calculationTimeMs: number; active: ActiveDuelSnapshot | null;
  readyCheck: ReadyCheckSnapshot | null; queue: QueuedDuelSnapshot[];
}
```

Implement `respondReady(reservationId, ready)`, `requestRematch(sourceMatchId)`, `respondOffer(offerId, accept)`, `cancelOffer(offerId)`, and `getQueueSnapshot()` with WebView and fetch branches matching existing API style. The cancellation implementation is exact:

```ts
export async function cancelOffer(offerId: number): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    bridge.send('game.cancelOffer', { offerId });
    return;
  }
  return unwrap(await fetch('/games/offers/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId }),
  }));
}
```

- [ ] **Step 4: Implement revision-gated state and reconnect request**

```ts
const applySnapshot = (next: DuelQueueSnapshot) => setByChannel(current => {
  const previous = current.get(next.channelId);
  if (previous && (next.generation < previous.generation ||
      (next.generation === previous.generation && next.revision <= previous.revision))) return current;
  const updated = new Map(current);
  updated.set(next.channelId, next);
  return updated;
});
```

Subscribe once to `game.queueSnapshot` and `voice.channelChanged`. On movement, delete `previousChannelId` immediately before requesting the new channel snapshot, so an old badge/modal cannot survive after authorization changes. Expose `requestSnapshot()` for `App` to call after voice connection; `reset()` clears every channel. Do not decrement ETA milliseconds or derive start times in React: display server timestamps/values as approximate snapshots.

- [ ] **Step 5: Update participant state for offer IDs and completed source match IDs**

Replace pending `matchId` terminology with `offerId` for `game.invited`, `game.invitePending`, decline, expiry, and cancellation. `cancelInvite` calls authenticated `gamesApi.cancelOffer(out.offerId)` rather than `/games/forfeit`. Keep live `matchId` unchanged. Store `ended.matchId` as the rematch `sourceMatchId`; preserve all participant board state and modal selection.

- [ ] **Step 6: Run web state tests and type check**

Run: `npm test -- --run src/components/Games/useDuelQueueState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS, including stale revision rejection.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with no queue payload widening to `any`.

- [ ] **Step 7: Commit web state contracts**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/useDuelQueueState.ts src/Brmble.Web/src/components/Games/useDuelQueueState.test.tsx src/Brmble.Web/src/components/Games/useGameState.ts
git commit -m "feat: store versioned duel queue snapshots"
```

## Task 11: Add Minimal Queue, Ready, And Rematch UI Without Spectator Foreground Activity

**Files:**
- Modify: `docs/UI_GUIDE.md`
- Create: `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx`
- Create: `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css`
- Create: `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`
- Modify: `src/Brmble.Web/src/components/Games/DeathrollModal.tsx`
- Modify: `src/Brmble.Web/src/components/Games/RpsModal.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx:52-75,274-396`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:30-99,442-464`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Modify: `src/Brmble.Web/src/App.tsx:920-1005,4262-4277,4477-4827`
- Create: `src/Brmble.Web/src/App.duelOrchestration.test.tsx`

- [ ] **Step 1: Document the stage-specific UI pattern before changing UI code**

Add a `Project 1 Duel Queue Pattern` section to `docs/UI_GUIDE.md` with these exact rules: the swords badge is a button for active/ready/non-empty accepted queue state; project 1 opens a shared token-styled modal containing metadata only; ready checks use one persistent top-right `warning` notification with Ready primary action and `x` as decline; participant result modals offer Rematch; no spectator board, screen-share pause, `ChatPanel` foreground state, or new toast system is introduced until project 2.

- [ ] **Step 2: Write failing queue modal and badge tests**

```tsx
it('renders ordered pairs and server Unknown without deriving an ETA', () => {
  render(<DuelQueueModal snapshot={snapshotWithKnownAndUnknown()} resolveName={resolveName} onClose={vi.fn()} />);
  expect(screen.getByText('1. Cara vs Dan')).toBeInTheDocument();
  expect(screen.getByText('About 24s')).toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});

it('activates the swords button without joining the channel', () => {
  const onOpenDuelQueue = vi.fn();
  const onJoinChannel = vi.fn();
  render(<ChannelTree channels={[channel]} users={[]} duelChannelIds={new Set([1])} onOpenDuelQueue={onOpenDuelQueue} onJoinChannel={onJoinChannel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open duel activity for General' }));
  expect(onOpenDuelQueue).toHaveBeenCalledWith(1);
  expect(onJoinChannel).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run UI tests and verify components/props are missing**

Run: `npm test -- --run src/components/Games/DuelQueueModal.test.tsx src/components/Sidebar/ChannelTree.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because `DuelQueueModal` and `onOpenDuelQueue` do not exist.

- [ ] **Step 4: Implement the minimal queue modal**

```tsx
export function DuelQueueModal({ snapshot, resolveName, onClose }: DuelQueueModalProps) {
  return <div className="modal-overlay" onClick={onClose}>
    <div className={`glass-panel animate-slide-up ${styles.modal}`} onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close duel queue"><Icon name="x" size={20} /></button>
      <div className="modal-header">
        <h2 className="heading-title modal-title">Duel activity</h2>
        <p className="modal-subtitle">One match at a time. Accepted pairs play in order.</p>
      </div>
      {snapshot.active && <section aria-label="Active duel">{renderPair(snapshot.active.players, resolveName)} · {gameDisplayName(snapshot.active.gameType)} · {snapshot.active.format}</section>}
      {snapshot.readyCheck && <section aria-label="Ready check">Ready check · {renderReadyState(snapshot.readyCheck, resolveName)}</section>}
      <ol className={styles.queue}>{snapshot.queue.map(entry => <li key={entry.reservationId}>
        <span>{entry.position}. {renderPair(entry.players, resolveName)}</span>
        <span>{gameDisplayName(entry.gameType)} · {entry.format}</span>
        <span>{entry.eta.status === 'known' ? `About ${formatDuration(entry.eta.milliseconds!)}` : 'Unknown'}</span>
      </li>)}</ol>
    </div>
  </div>;
}
```

Use only `--space-*`, `--text-*`, `--bg-*`, `--accent-*`, `--radius-*`, `--font-*`, `--glass-*`, and transition tokens in the CSS module. Verify Classic and Retro Terminal manually.

- [ ] **Step 5: Make the existing badge accessible and actionable**

Replace the passive `<span className="channel-duel-icon">` with a `Tooltip`-wrapped `<button type="button" className="channel-duel-icon" aria-label={...}>`; stop propagation and call `onOpenDuelQueue(channel.id)`. Keep it next to the access icon and do not add a row-status container.

- [ ] **Step 6: Add ready and rematch UI tests**

```tsx
it('shows one persistent ready notification and decline uses dismiss', () => {
  renderConnectedApp({ readyCheck: readyForSelf(42) });
  expect(screen.getByRole('alert')).toHaveTextContent('Ready to play?');
  fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
  expect(bridge.send).toHaveBeenCalledWith('game.ready', { reservationId: 42, ready: true });
});

it('requests a rematch from the existing participant result modal', () => {
  renderEndedRpsMatch({ matchId: 91 });
  fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
  expect(bridge.send).toHaveBeenCalledWith('game.rematch', { sourceMatchId: 91 });
});
```

- [ ] **Step 7: Render notifications and participant rematch actions in `App`**

Use queue IDs `game-ready` and `game-rematch`. Ready is `warning`, `duration={null}`, `countdownMs` derived from server `expiresAt`, primary action `Ready`, and close invokes `respondReady(id, false)`. Incoming rematch is `info`, `duration={null}`, `countdownMs`, primary `Accept`, and close declines. After a completed participant match, pass `onRematch={() => duelQueue.requestRematch(ended.matchId)}` and `rematchPending` into the existing Deathroll/RPS modals; render one `Rematch` secondary button beside `Close`. Do not close or replace participant modals automatically.

- [ ] **Step 8: Replace boolean duel state with snapshot-derived channel IDs and recovery**

```tsx
const duelQueue = useDuelQueueState();
const duelChannelIds = useMemo(() => new Set(
  [...duelQueue.byChannel.values()]
    .filter(snapshot => snapshot.active || snapshot.readyCheck || snapshot.queue.length > 0)
    .map(snapshot => snapshot.channelId)
), [duelQueue.byChannel]);
```

On `voice.connected`, call `duelQueue.requestSnapshot()`. On `voice.disconnected`, call both `gameState.reset()` and `duelQueue.reset()`. Remove the `game.duelState` listener. Open `DuelQueueModal` only for the selected snapshot; closing it changes no server subscription because project 1 snapshots are low-frequency channel events.

- [ ] **Step 9: Run UI tests, type check, and build**

Run: `npm test -- --run src/components/Games/DuelQueueModal.test.tsx src/components/Games/useDuelQueueState.test.tsx src/components/Sidebar/ChannelTree.test.tsx src/App.duelOrchestration.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for ordering, Unknown display, ready decline/accept, rematch, badge keyboard activation, stale revisions, and disconnect clearing.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with a Vite production bundle.

- [ ] **Step 10: Commit minimal project 1 UI**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/Games/DuelQueueModal.tsx src/Brmble.Web/src/components/Games/DuelQueueModal.module.css src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx src/Brmble.Web/src/components/Games/DeathrollModal.tsx src/Brmble.Web/src/components/Games/RpsModal.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.duelOrchestration.test.tsx
git commit -m "feat: add duel queue ready and rematch UI"
```

## Task 12: Final Verification And Release-Stage Self-Review

**Files:**
- Modify only if verification finds a project 1 defect: files already listed in Tasks 1-11

- [ ] **Step 1: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run all native client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run all web tests**

Run: `npm test`

Working directory: `src/Brmble.Web`

Expected: PASS with zero failed Vitest tests.

- [ ] **Step 4: Build the complete solution and frontend**

Run: `dotnet build`

Expected: PASS with zero errors.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with TypeScript and Vite succeeding.

- [ ] **Step 5: Run race and lifecycle tests repeatedly**

Run:

```powershell
1..50 | ForEach-Object {
    dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~DuelOrchestratorTests
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: PASS on all 50 runs; no duplicate commitments, queue reordering, stale timer mutation, or blocked advancement.

- [ ] **Step 6: Perform a two-client manual release-stage check**

Run: `dotnet run --project src/Brmble.Server`

Run in a second terminal: `npm run dev`

Working directory: `src/Brmble.Web`

Run in third and fourth terminals: `dotnet run --project src/Brmble.Client`

Verify: two accepted pairs play FIFO; idle acceptance starts without ready; waiting acceptance gets a ready check after completion; timeout advances; rematch joins behind an existing pair; disconnect/move clears pending/queued/ready state; reconnect receives one complete snapshot; Unknown displays below 10 samples; Deathroll and RPS remain participant modals; opening queue status does not alter screen shares.

Expected: all behaviors match the automated contracts, and both Classic and Retro Terminal layouts remain usable.

- [ ] **Step 7: Confirm verification did not create uncommitted project 1 changes**

Run: `git status --short`

Expected: no project 1 production or test files are modified. If verification found a defect, return to the task that owns the exact file, add a failing regression test, repeat that task's fail/pass commands, and use that task's explicit `git add` and commit boundary before repeating this final verification task. Leave unrelated workspace files untouched.

## Specification Coverage Matrix And Self-Review

| Requirement | Plan coverage | Decision / evidence |
|---|---|---|
| One unresolved commitment per stable user, atomically | Tasks 5-7 | One `_gate` and `_commitmentsByUserId`; concurrent sessions cannot duplicate commitments, while actual session loss cancels before replacement; race/session tests cover both. |
| Private 30-second challenges; acceptance-order FIFO | Tasks 5, 9, 10 | Offers publish only to participants; queue order uses accepted timestamp plus monotonic sequence. |
| One active duel per channel; accepted-pair queue | Tasks 5-6 | Queue contains `DuelReservation` pairs, never unanswered offers or individuals. |
| Immediate idle start without second confirmation | Task 5 | `AcceptLocked` marks channel advancing and starts immediately. |
| Ready checks only after waiting; both confirm in server window | Task 6 | 15-second generation-safe ready timer; start only after both responses. |
| Decline/timeout/disconnect/leave skips and advances | Task 6 | Shared failure path removes pair and loops immediately. |
| New acceptance cannot jump advancement | Tasks 5-6 | `ChannelDuelState.Advancing` occupies the channel transition under the same lock. |
| Presence and channel-removal cleanup | Task 6 | Callback ordering preserves old membership for cleanup; complete ephemeral channel state is removed. |
| Active disconnect/forfeit semantics preserved | Tasks 4, 6 | Active users delegate to existing game-specific forfeit path; commitment releases on completion callback. |
| Ephemeral queue state not restart-persisted | Tasks 5-8 | Offers, reservations, ready checks, completed rematch sources remain singleton memory only. |
| Rematch consent, 30 seconds, tail, exact configuration | Task 7 | Source record retains game/options/format/ruleset/players; normal acceptance path enforces tail or idle start. |
| Complete versioned snapshots; stale revision protection | Tasks 8, 10 | Schema 1 complete payloads, process-lifetime generation/revision clocks, serialized per-channel publication lanes, and React tuple comparison. |
| Empty idle, movement clearing, and reconnect snapshot | Tasks 8, 10-11 | Revisioned empty publication, immediate old-channel deletion on movement, and authenticated GET/WebSocket recovery. |
| Active/ready/full queue/player/game/format/ruleset/position | Stable contracts, Tasks 8, 11 | Explicit DTO and JSON payload; queue modal renders all project 1 metadata. |
| `ruleset_version` migration/index/model/insert/query | Task 2 | Non-null default 1 and `(game_type, format, ruleset_version, ended_at)` index. |
| Newest 100, median, no calendar cutoff, minimum 10 | Tasks 2-3 | Exact SQL and threshold/median/old-row tests. |
| Exclude abandoned and non-start lifecycle timings | Task 2 | Query accepts only persisted `decided`/`draw`, positive-duration live matches; offers/ready/cancel are never rows. |
| Conditional remaining and fallback clamp | Task 3 | Conditional newest-100 survivors first; full median minus elapsed clamped to zero second. |
| Unknown propagation, sample counts, calculation time | Tasks 3, 8, 10-11 | Segment diagnostics retained in known/unknown payloads; clients display server result only. |
| Persistence failure cannot hold channel | Task 4 | Runtime release and completion callback are independent of retrying background persistence. |
| Stable errors and stale commands | Tasks 5-9 | Offer/reservation IDs, timer generations, participant checks, and machine reason codes. |
| Future continuous definitions and match routing | Tasks 1, 4-6 | `IDuelGameDefinition` admits non-engine definitions; `RunnerKey` and `IDuelMatchRunnerRouter` route start, lookup, presence, and API forfeits. |
| Wire enum compatibility | Tasks 1, 8-10 | Explicit exhaustive string DTO mapping and server/native contract tests enforce camel-case strings at every boundary. |
| Separate offer/reservation identity and secure cancellation | Tasks 5, 9-10 | Independent counters and authenticated owner-only `/games/offers/cancel`; pending cancellation never uses match forfeit. |
| Compile-safe incremental commits | Tasks 1, 2, 4 | Transitional engine/model overloads plus full `dotnet build` gates before each boundary commit. |
| Minimal independently releasable queue/ready/rematch UI | Tasks 10-11 | Snapshot store, actionable badge, queue modal, ready/rematch notifications/actions. |
| Preserve Deathroll/RPS participant modals | Tasks 4, 10-11 | Existing participant views, timers, reveal, and modal selection remain; only rematch controls are added. |
| Defer generic spectator foreground activity | File Structure, Task 11 | No spectator state/public views/subscriptions, `ChatPanel` media activity, or screen-share pause/restore work. |
| Arena project dependency: shared orchestration/config/ruleset | Stable contracts, Tasks 1, 4-8 | Arena can later supply a dedicated runner while reusing reservation, queue, snapshot, completion, and ETA contracts. |
| Arena game/simulation/transport specifics | Explicitly deferred | Physics, realtime tickets/WebSocket, bo3 rounds, prediction, rendering, audio, telemetry, and spectator interpolation belong to project 3. |

Self-review results:

- Both approved specs were checked. Every framework project 1 requirement is assigned above; Arena's only project 1 dependency is stable shared configuration/orchestration/ruleset persistence, while every Arena-specific requirement remains deliberately outside this plan.
- No spectator public view, subscription, board, foreground-activity arbitration, or remote-media pause/restore is included. Those are project 2, including the permanent embedded queue/spectator activity that will replace the temporary project 1 queue modal.
- Type consistency was checked: `DuelConfiguration.RunnerKey`, `IDuelGameDefinition`, `IDuelMatchRunnerRouter`, stable `UserId`, transient `SessionId`, distinct `offerId`/`reservationId`/`matchId`/`sourceMatchId`, `rulesetVersion`, and `(generation, revision)` retain one meaning throughout.
- Placeholder scan was checked: implementation steps provide concrete signatures, payloads, SQL, commands, and expected outcomes; no deferred implementation marker is used.
- Main implementation risk: `GameSessionManager` extraction touches mature participant lifecycle code. Task 4 requires retaining all existing engine/action/feed tests before orchestration proceeds.
- Operational risk: in-memory queues and process-lifetime clocks intentionally disappear on server restart. During one process, channel removal cannot roll revisions backward; after restart, reconnect receives generation 0/revision 0 empty state, matching approved non-persistence.
- UI transition risk: project 1's queue modal is intentionally temporary. `docs/UI_GUIDE.md` must label it as the release-stage pattern so project 2 can replace it with the approved upper-`ChatPanel` foreground activity without preserving accidental modal compatibility.
