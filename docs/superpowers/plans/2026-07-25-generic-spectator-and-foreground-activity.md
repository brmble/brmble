# Generic Spectator And Foreground Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver project 2 as an independently releasable, privacy-safe spectator system for Deathroll and RPS with explicit same-channel subscriptions, an embedded generic duel activity, and lossless screen-share foreground switching.

**Architecture:** Project 1 is a strict prerequisite: retain its `DuelConfiguration`, `DuelReservation`, `ActiveDuelSnapshot`, `DuelQueueSnapshot`, `IDuelMatchRunner`, `GameStartResult`, `MatchCompletion`, complete queue revisions, and `offerId`/`reservationId`/`matchId` meanings exactly. A singleton `SpectatorService` owns a serialized current-match/subscription registry: discrete `GameSessionManager` pushes low-frequency complete frames into it for subscriber-only event-bus delivery, while future continuous coordinators register lifecycle metadata and use it only for authorization/role validation before their dedicated realtime transport. React combines discrete snapshots with project 1 queue snapshots in one upper-`ChatPanel` foreground activity, while `useScreenShare` pauses and restores remote LiveKit screen video/audio publications without changing watched shares, focus, quality, room membership, or local publishing.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, C#, MSTest/Moq, raw Win32/WebView2 native bridge, React 19, TypeScript 5.9, Vitest/Testing Library, LiveKit Client SDK, CSS custom-property design tokens.

---

## File Structure

### Prerequisite

- Complete `docs/superpowers/plans/2026-07-25-duel-orchestration-queue-ready-rematches-etas.md` first. This plan compiles against its `src/Brmble.Server/Games/Duels/DuelModels.cs`, `DuelConfiguration`, `DuelReservation`, `DuelPlayerSnapshot`, `DuelQueueSnapshot`, `IDuelMatchRunner`, `GameStartResult`, `MatchCompletion`, `GET /games/queue`, native queue bridge, `src/Brmble.Web/src/api/games.ts` queue contracts, and `useDuelQueueState`; do not recreate, widen, or rename those contracts.

### Server production files

- Create `src/Brmble.Server/Games/Spectators/SpectatorModels.cs`: stable project-2/project-3 lifecycle/authorization and discrete wire contracts, subscriber close reasons, and dedicated Deathroll/RPS spectator DTOs.
- Create `src/Brmble.Server/Games/Spectators/SpectatorService.cs`: serialized current-match and explicit-subscription registry, same-channel authorization, generation-checked subscriber-only discrete publication, lifecycle revalidation, and cleanup.
- Modify `src/Brmble.Server/Games/IGameEngine.cs`: require a dedicated privacy-safe `SpectatorView(object state)`; never infer it from a participant view.
- Modify `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`: retain public roll history and return `DeathrollSpectatorView`.
- Modify `src/Brmble.Server/Games/Engines/RpsEngine.cs`: return an `RpsSpectatorView` containing commitment booleans but no unresolved throw values.
- Modify `src/Brmble.Server/Games/GameSessionManager.cs`: push complete low-frequency discrete frames and exactly-once terminal lifecycle into `ISpectatorCoordinator`, assigning monotonic per-match spectator sequences under the match lock.
- Reuse `src/Brmble.Server/Games/EventBusGameEventPublisher.cs` unchanged: its existing `IGameEventPublisher.PublishToUsersAsync` is the discrete subscriber transport; never use channel broadcast for spectator snapshots.
- Modify `src/Brmble.Server/Games/GameEndpoints.cs`: add authenticated subscribe/unsubscribe endpoints resolving certificate identity to the current Mumble session.
- Modify `src/Brmble.Server/Games/GamesExtensions.cs`: register `SpectatorService` once and bind it to the current discrete match source.
- Modify `src/Brmble.Server/Mumble/MumbleServerCallback.cs`: invalidate spectator subscriptions before disconnect/channel membership destruction and on channel removal.
- Modify `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`: clear a user's spectator subscription when their final application WebSocket closes, forcing an explicit fresh subscribe after reconnect.

### Native client files

- Modify `src/Brmble.Client/Services/Games/GameService.cs`: tunnel correlated spectator subscribe/unsubscribe requests through the existing mTLS games request path.
- Modify `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`: no production routing change; its existing `game.*` prefix remains the spectator event transport.

### Web production files

- Modify `docs/UI_GUIDE.md`: replace the temporary project-1 queue modal guidance with the generic foreground activity, spectator board, queue, accessibility, and remote-media pause/restore pattern.
- Modify `src/Brmble.Web/src/api/games.ts`: add exact spectator snapshot unions and subscribe/unsubscribe API calls while retaining project-1 queue contracts.
- Create `src/Brmble.Web/src/components/Games/useSpectatorState.ts`: explicit subscription lifecycle, match/sequence gating, close handling, and reset.
- Create `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx`: read-only Deathroll board with turn, ceiling, last roll, and complete public history.
- Create `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`: read-only RPS score/commitment board with unresolved choices hidden and resolved-round reveal.
- Create `src/Brmble.Web/src/components/Games/DuelActivity.tsx`: generic board host plus complete active/ready/ordered queue state from `DuelQueueSnapshot`.
- Create `src/Brmble.Web/src/components/Games/DuelActivity.module.css`: token-only embedded activity layout for desktop/mobile and Classic/Retro Terminal.
- Create `src/Brmble.Web/src/hooks/useForegroundActivity.ts`: stable exactly-one foreground descriptor and close/reset API that Arena can consume in project 3.
- Modify `src/Brmble.Web/src/hooks/useScreenShare.ts`: idempotently pause/restore only remote screen video/audio subscriptions and reconcile shares that end while paused.
- Modify `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`: render one generic foreground activity above chat, with screen shares as the fallback.
- Modify `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`: reuse the existing split sizing/divider pattern for the generic activity slot.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`: use project 1's actionable swords button to open the embedded activity, not a modal or channel join.
- Modify `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`: thread `onOpenDuelActivity` through the existing channel tree boundary.
- Modify `src/Brmble.Web/src/App.tsx`: coordinate queue state, spectator subscriptions, foreground ownership, channel lifecycle, and remote-media pause/restoration.
- Delete `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx`: project 2 replaces the temporary project-1 modal.
- Delete `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css`: embedded `DuelActivity` owns the permanent layout.
- Delete `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`: equivalent and broader coverage moves to `DuelActivity.test.tsx`.

### Tests

- Create `tests/Brmble.Server.Tests/Games/Spectators/SpectatorViewContractTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/Spectators/SpectatorServiceTests.cs`.
- Modify `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`.
- Create `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`.
- Modify `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`.
- Modify `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`.
- Modify `tests/Brmble.Client.Tests/Services/GameServiceTests.cs` from project 1.
- Modify `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`.
- Create `src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx`.
- Create `src/Brmble.Web/src/components/Games/DuelActivity.test.tsx`.
- Create `src/Brmble.Web/src/hooks/useForegroundActivity.test.ts`.
- Modify `src/Brmble.Web/src/hooks/useScreenShare.test.ts`.
- Modify `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`.
- Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx` from project 1.
- Create `src/Brmble.Web/src/App.spectatorActivity.test.tsx`.

## Stable Project 2 Contracts For Project 3

`SpectatorService` is the sole owner of spectator authorization, role, current-match identity, and subscription lifecycle. Discrete games call `PublishDiscreteFrameAsync`; those low-frequency Deathroll/RPS replacements may use the existing event bus. Arena project 3 calls `RegisterContinuousMatchAsync`, `AuthorizeAsync`, and `EndMatchAsync`, but sends its 20 Hz frames only over its dedicated browser-owned realtime WebSocket; `SpectatorService`, `IGameEventPublisher`, the Brmble `/ws` event bus, NativeBridge, and `game.spectatorSnapshot` must never carry Arena simulation frames.

```csharp
public enum SpectatorTransport { DiscreteEventBus, DedicatedRealtime }
public enum SpectatorRole { Spectator, Participant }

public sealed record SpectatorMatchDescriptor(
    long MatchId,
    int ChannelId,
    DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    SpectatorTransport Transport);

public interface ISpectatorCoordinator
{
    Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame);
    Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match);
    Task<SpectatorAuthorizationResult> AuthorizeAsync(
        long sessionId, long userId, long matchId, SpectatorRole role);
    Task EndMatchAsync(long matchId, int channelId, long finalSequence);
}

public sealed record SpectatorSourceFrame(
    long MatchId,
    int ChannelId,
    DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence,
    DateTimeOffset GeneratedAt,
    object View);

public sealed record SpectatorAuthorizationResult(
    bool Success,
    SpectatorMatchDescriptor? Match,
    string? Error,
    SpectatorSubscribeReason Reason);

public enum SpectatorCloseReason
{
    Unsubscribed,
    MatchEnded,
    AuthorizationLost,
    Disconnected,
    ChannelRemoved,
    Replaced
}

public sealed record SpectatorSnapshot(
    int SchemaVersion,
    long MatchId,
    int ChannelId,
    string GameType,
    string Format,
    int RulesetVersion,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence,
    DateTimeOffset GeneratedAt,
    object View);
```

`PublishDiscreteFrameAsync` updates the service-owned descriptor/current frame and fans low-frequency frames to explicit discrete subscribers. `RegisterContinuousMatchAsync` stores descriptor/lifecycle state only. `AuthorizeAsync` is the project-3 ticket boundary: it validates current match, role, and same-channel presence but returns no simulation frame and creates no event-bus frame stream.

```ts
export type ForegroundActivity =
  | { kind: 'duel'; channelId: number; matchId: number | null }
  | { kind: 'game'; channelId: number; matchId: number; gameType: string; role: 'participant' | 'spectator' };

export interface ForegroundActivityController {
  activity: ForegroundActivity | null;
  open: (activity: ForegroundActivity) => void;
  close: () => void;
  reset: () => void;
}
```

Canonical subscriber event payloads are complete replacements:

```json
{
  "type": "game.spectatorSnapshot",
  "schemaVersion": 1,
  "matchId": 91,
  "channelId": 7,
  "gameType": "rps",
  "format": "bo3",
  "rulesetVersion": 1,
  "players": [
    { "sessionId": 10, "displayName": "Alice", "ready": false },
    { "sessionId": 20, "displayName": "Bob", "ready": false }
  ],
  "sequence": 4,
  "generatedAt": "2026-07-25T14:30:04.0000000+00:00",
  "view": {
    "kind": "rps",
    "bestOf": 3,
    "targetWins": 2,
    "roundNumber": 2,
    "roundWins": [1, 0],
    "committed": [true, false],
    "finished": false,
    "winnerId": null,
    "lastRound": {
      "roundNumber": 1,
      "sequence": 1,
      "pick0": "rock",
      "pick1": "scissors",
      "winnerId": 10,
      "tie": false
    }
  }
}
```

Unresolved RPS payloads contain `committed` booleans only. They never contain `myPick`, `opponentPicked`, `picks`, `pick0`, or `pick1` for the current unresolved round. Resolved throws exist only under `lastRound`.

## Task 1: Define Dedicated Privacy-Safe Spectator Views

**Files:**
- Create: `src/Brmble.Server/Games/Spectators/SpectatorModels.cs`
- Modify: `src/Brmble.Server/Games/IGameEngine.cs:19-49`
- Modify: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`
- Modify: `src/Brmble.Server/Games/Engines/RpsEngine.cs`
- Create: `tests/Brmble.Server.Tests/Games/Spectators/SpectatorViewContractTests.cs`

- [ ] **Step 1: Write failing dedicated-view and unresolved-RPS privacy contract tests**

```csharp
[TestMethod]
public void RpsSpectatorView_UnresolvedRoundContainsCommitmentBitsButNoThrowValues()
{
    var engine = new RpsEngine();
    var state = engine.InitialState([new(10), new(20)], new StubRandom(),
        new Dictionary<string, object?> { ["bestOf"] = 3 });
    engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["pick"] = "rock" }, new StubRandom());

    var json = JsonSerializer.Serialize(engine.SpectatorView(state), CamelCaseJson);
    using var doc = JsonDocument.Parse(json);
    var root = doc.RootElement;
    CollectionAssert.AreEqual(new[] { true, false }, root.GetProperty("committed").EnumerateArray().Select(x => x.GetBoolean()).ToArray());
    Assert.IsFalse(root.TryGetProperty("myPick", out _));
    Assert.IsFalse(root.TryGetProperty("opponentPicked", out _));
    Assert.IsFalse(root.TryGetProperty("picks", out _));
    Assert.IsFalse(json.Contains("rock", StringComparison.OrdinalIgnoreCase));
}

[TestMethod]
public void DeathrollSpectatorView_ContainsCompletePublicRollHistory()
{
    var engine = new DeathrollEngine();
    var state = engine.InitialState([new(10), new(20)], new SequenceRandom(60, 30));
    engine.ApplyAction(state, 10, Roll(), new SequenceRandom(60));
    engine.ApplyAction(state, 20, Roll(), new SequenceRandom(30));
    var view = (DeathrollSpectatorView)engine.SpectatorView(state);
    CollectionAssert.AreEqual(new[] { 60, 30 }, view.History.Select(x => x.Value).ToArray());
    CollectionAssert.AreEqual(new long[] { 10, 20 }, view.History.Select(x => x.SessionId).ToArray());
}
```

- [ ] **Step 2: Run the contract tests and verify the missing API fails compilation**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~SpectatorViewContractTests`

Expected: FAIL with `CS1061` for `IGameEngine.SpectatorView` and missing spectator DTO types.

- [ ] **Step 3: Add exact source, wire, and game-view contracts**

```csharp
namespace Brmble.Server.Games.Spectators;

public sealed record DeathrollRollSnapshot(long Sequence, long SessionId, int Value, int Ceiling);
public sealed record DeathrollSpectatorView(
    string Kind,
    IReadOnlyList<long> Players,
    long? CurrentPlayer,
    int Ceiling,
    int? LastRoll,
    bool Finished,
    long? LoserId,
    IReadOnlyList<DeathrollRollSnapshot> History);

public sealed record RpsResolvedRoundSnapshot(
    int RoundNumber, int Sequence, string Pick0, string Pick1, long? WinnerId, bool Tie);
public sealed record RpsSpectatorView(
    string Kind,
    IReadOnlyList<long> Players,
    int BestOf,
    int TargetWins,
    int RoundNumber,
    IReadOnlyList<int> RoundWins,
    IReadOnlyList<bool> Committed,
    bool Finished,
    long? WinnerId,
    RpsResolvedRoundSnapshot? LastRound);

public interface IGameEngine
{
    // Existing project-1 members remain unchanged.
    object PublicView(object state, long forUserId);
    object SpectatorView(object state);
}
```

- [ ] **Step 4: Implement engine-owned views without participant-view reuse**

```csharp
// Deathroll State
public readonly List<DeathrollRollSnapshot> History = [];

// DoRoll, after value is known and before terminal branching
s.History.Add(new(s.History.Count + 1L, userId, value, top));

public object SpectatorView(object state)
{
    var s = (State)state;
    return new DeathrollSpectatorView(
        "deathroll", s.Players, s.LoserId is null ? s.Players[s.CurrentIndex] : null,
        s.Ceiling, s.LastRoll, s.LoserId is not null, s.LoserId, s.History.ToArray());
}
```

```csharp
public object SpectatorView(object state)
{
    var s = (State)state;
    return new RpsSpectatorView(
        "rps", s.Players, s.BestOf, s.TargetWins, s.RoundNumber, s.RoundWins.ToArray(),
        new[] { s.Picks[0] is not null, s.Picks[1] is not null },
        s.WinnerId is not null || s.Drawn, s.WinnerId,
        s.Last is null ? null : new(
            s.Last.RoundNumber, s.Last.Seq,
            s.Last.P0?.ToString().ToLowerInvariant() ?? "none",
            s.Last.P1?.ToString().ToLowerInvariant() ?? "none",
            s.Last.WinnerId, s.Last.Tie));
}
```

- [ ] **Step 5: Run engine and privacy contracts**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SpectatorViewContractTests|FullyQualifiedName~DeathrollEngineTests|FullyQualifiedName~RpsEngineTests"`

Expected: PASS; unresolved RPS JSON has commitment booleans and no current throw values, while resolved `lastRound` and Deathroll history are complete.

- [ ] **Step 6: Commit the public-view boundary**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorModels.cs src/Brmble.Server/Games/IGameEngine.cs src/Brmble.Server/Games/Engines/DeathrollEngine.cs src/Brmble.Server/Games/Engines/RpsEngine.cs tests/Brmble.Server.Tests/Games/Spectators/SpectatorViewContractTests.cs
git commit -m "feat: define privacy-safe duel spectator views"
```

## Task 2: Produce Complete Low-Frequency Discrete Match Frames

**Files:**
- Modify: `src/Brmble.Server/Games/Spectators/SpectatorModels.cs`
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`
- Modify: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`

- [ ] **Step 1: Write failing source tests for start, action, timeout, terminal, and exactly-once concurrency**

```csharp
[TestMethod]
public async Task SpectatorFrames_AreCompleteAndMonotonicAcrossStartAndActions()
{
    var manager = NewProjectOneManager();
    var coordinator = new RecordingSpectatorCoordinator();
    var manager = NewProjectOneManager(coordinator);
    var started = await manager.StartAsync(TestReservation(gameType: "deathroll"));
    await manager.ActionAsync(started.MatchId, 10, Roll());
    Assert.AreEqual(2, coordinator.Frames.Count);
    CollectionAssert.AreEqual(new long[] { 1, 2 }, coordinator.Frames.Select(x => x.Sequence).ToArray());
    Assert.IsInstanceOfType<DeathrollSpectatorView>(coordinator.Frames[1].View);
    Assert.AreEqual("1v1", coordinator.Frames[1].Configuration.Format);
}

[TestMethod]
public async Task SpectatorTimeout_PublishesOneCompleteNextSequence()
{
    var coordinator = new RecordingSpectatorCoordinator();
    var manager = NewProjectOneManager(coordinator);
    var started = await manager.StartAsync(TestReservation());
    await manager.FireTurnTimeoutForTestAsync(started.MatchId);
    Assert.AreEqual(2, coordinator.Frames.Count);
    Assert.AreEqual(2L, coordinator.Frames[^1].Sequence);
}

[TestMethod]
public async Task SpectatorCompletion_EndsExactlyOnceAfterFinalFrame()
{
    var coordinator = new RecordingSpectatorCoordinator();
    var manager = NewProjectOneManager(coordinator);
    var started = await manager.StartAsync(TestReservation());
    await Task.WhenAll(
        manager.ForfeitAsync(started.MatchId, 10, "forfeit"),
        manager.ForfeitAsync(started.MatchId, 10, "forfeit"));
    Assert.AreEqual(1, coordinator.Ended.Count);
    Assert.AreEqual(coordinator.Frames[^1].Sequence, coordinator.Ended.Single().FinalSequence);
}

[TestMethod]
public async Task SpectatorConcurrentActionAndTimeout_AssignUniqueOrderedSequences()
{
    var coordinator = new RecordingSpectatorCoordinator();
    var manager = NewProjectOneManager(coordinator);
    var started = await manager.StartAsync(TestReservation());
    await Task.WhenAll(
        manager.ActionAsync(started.MatchId, manager.GetCurrentPlayer(started.MatchId), Roll()),
        manager.FireTurnTimeoutForTestAsync(started.MatchId));
    var sequences = coordinator.Frames.Select(x => x.Sequence).ToArray();
    CollectionAssert.AreEqual(sequences.Distinct().Order().ToArray(), sequences);
}

[TestMethod]
public async Task SpectatorNormalTerminal_PublishesTerminalFrameThenEndsWithItsSequence()
{
    var coordinator = new RecordingSpectatorCoordinator();
    var manager = NewProjectOneManager(coordinator, random: new SequenceRandom(1));
    var started = await manager.StartAsync(TestReservation());
    await manager.ActionAsync(started.MatchId, manager.GetCurrentPlayer(started.MatchId), Roll());
    Assert.IsTrue(((DeathrollSpectatorView)coordinator.Frames[^1].View).Finished);
    Assert.AreEqual(coordinator.Frames[^1].Sequence, coordinator.Ended.Single().FinalSequence);
}
```

- [ ] **Step 2: Run focused manager tests and verify the coordinator interface is absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameSessionManagerTests&Name~Spectator"`

Expected: FAIL with missing `ISpectatorCoordinator` and discrete frame/lifecycle calls.

- [ ] **Step 3: Add the stable coordinator interface and immutable frame types**

```csharp
public interface ISpectatorCoordinator
{
    Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame);
    Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match);
    Task<SpectatorAuthorizationResult> AuthorizeAsync(long sessionId, long userId, long matchId, SpectatorRole role);
    Task EndMatchAsync(long matchId, int channelId, long finalSequence);
}

public sealed record SpectatorSourceFrame(
    long MatchId, int ChannelId, DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players, long Sequence,
    DateTimeOffset GeneratedAt, object View);
```

- [ ] **Step 4: Implement atomic frame capture in `GameSessionManager`**

```csharp
private sealed class LiveMatch
{
    // Existing project-1 fields remain.
    public long SpectatorSequence;
    public bool SpectatorEnded;
}

private SpectatorSourceFrame CaptureSpectatorFrameLocked(LiveMatch match)
{
    var frame = new SpectatorSourceFrame(
        match.MatchId, match.ChannelId, match.Configuration,
        match.Players.Select(id => new DuelPlayerSnapshot(id, NameOf(match, id))).ToArray(),
        ++match.SpectatorSequence, _clock.GetUtcNow(), match.Engine.SpectatorView(match.State));
    return frame;
}
```

Capture under `match.Lock` after start state exists and after every action/timeout mutation. Call `_spectators.PublishDiscreteFrameAsync(frame)` after releasing the match lock; this is low-frequency discrete state only. In every normal/forfeit completion path, set `SpectatorEnded` under `match.Lock`, remove the runtime, then call `_spectators.EndMatchAsync(matchId, channelId, finalSequence)` exactly once. A forfeit emits no fabricated frame, so `finalSequence` equals the latest complete frame sequence. Concurrent action/timeout callbacks still serialize on `match.Lock`; stale timer generations remain no-ops and consume no sequence.

- [ ] **Step 5: Run source and existing participant lifecycle tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~GameSessionManagerTests`

Expected: PASS; start/action/timeout sequences are unique and ordered, terminal lifecycle is exactly once under concurrent completion attempts, and existing participant/feed/completion behavior remains unchanged.

- [ ] **Step 6: Commit the source boundary**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorModels.cs src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat: publish sequence-numbered discrete spectator frames"
```

## Task 3: Implement Explicit Authorized Subscriber Fan-Out

**Files:**
- Create: `src/Brmble.Server/Games/Spectators/SpectatorService.cs`
- Create: `tests/Brmble.Server.Tests/Games/Spectators/SpectatorServiceTests.cs`

- [ ] **Step 1: Write failing linearizability, authorization, subscriber-only, and generation tests**

```csharp
[TestMethod]
public async Task Subscribe_SameChannelReturnsFreshCompleteSnapshot_AndCrossChannelRejects()
{
    var sut = NewService(Present((10, 7, 100), (30, 8, 300)));
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 4));
    var accepted = await sut.SubscribeAsync(sessionId: 10, userId: 100, matchId: 91);
    var rejected = await sut.SubscribeAsync(sessionId: 30, userId: 300, matchId: 91);
    Assert.IsTrue(accepted.Success);
    Assert.AreEqual(4, accepted.Snapshot!.Sequence);
    Assert.AreEqual(SpectatorSubscribeReason.NotSameChannel, rejected.Reason);
}

[TestMethod]
public async Task SourceUpdate_PublishesOnlyToExplicitCurrentSubscriber()
{
    var (sut, publisher) = await NewServiceHarnessAsync();
    await sut.SubscribeAsync(10, 100, 91);
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 2));
    CollectionAssert.AreEquivalent(new long[] { 100 }, publisher.LastUsers.ToArray());
    Assert.IsFalse(publisher.AllUsers.Contains(200));
}

[TestMethod]
public async Task SubscribeToSecondMatch_ReplacesFirstSubscription()
{
    var (sut, publisher) = await NewServiceHarnessAsync(twoMatches: true);
    await sut.SubscribeAsync(10, 100, 91);
    await sut.SubscribeAsync(10, 100, 92);
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 8));
    Assert.AreEqual(0, publisher.Count("game.spectatorSnapshot", userId: 100));
}

[TestMethod]
public async Task StaleSourceSequence_IsNotRepublished()
{
    var (sut, publisher) = await NewServiceHarnessAsync();
    await sut.SubscribeAsync(10, 100, 91);
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 6));
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 5));
    Assert.AreEqual(1, publisher.Count("game.spectatorSnapshot", userId: 100));
}

[TestMethod]
public async Task Subscribe_RacingMatchEnd_CannotInsertDeadSubscription()
{
    var presence = new BlockingPresence(channelId: 7);
    var sut = NewService(presence);
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 4));
    var subscribe = sut.SubscribeAsync(10, 100, 91);
    await presence.ValidationStarted;
    await sut.EndMatchAsync(91, 7, 4);
    presence.ReleaseValidation();
    var result = await subscribe;
    Assert.IsFalse(result.Success);
    Assert.AreEqual(SpectatorSubscribeReason.MatchNotLive, result.Reason);
    Assert.IsFalse(sut.IsSubscribedForTest(100));
}

[TestMethod]
public async Task Subscribe_RacingChannelMove_RechecksPresenceBeforeInsertion()
{
    var presence = new MutablePresence((10, 7, 100));
    var sut = NewService(presence);
    await sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 4));
    presence.BeforeSecondRead = () => presence.Move(10, 8);
    var result = await sut.SubscribeAsync(10, 100, 91);
    Assert.IsFalse(result.Success);
    Assert.AreEqual(SpectatorSubscribeReason.NotSameChannel, result.Reason);
    Assert.AreEqual(2, presence.ReadCount);
}

[TestMethod]
public async Task Publish_RacingUnsubscribe_RechecksGenerationBeforeSend()
{
    var beforePublish = new BlockingTransitionHook();
    var (sut, publisher) = await NewServiceHarnessAsync(beforePublish: beforePublish);
    await sut.SubscribeAsync(10, 100, 91);
    var publish = sut.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 2));
    await beforePublish.Entered;
    await sut.UnsubscribeAsync(10, 100);
    beforePublish.Release();
    await publish;
    Assert.AreEqual(0, publisher.Count("game.spectatorSnapshot", userId: 100));
}

[TestMethod]
public async Task ContinuousMatch_AuthorizesRoleButNeverPublishesRealtimeFrames()
{
    var (sut, publisher) = await NewServiceHarnessAsync(registerDiscrete: false);
    await sut.RegisterContinuousMatchAsync(Descriptor(
        matchId: 300, channelId: 7, transport: SpectatorTransport.DedicatedRealtime,
        players: [Player(10), Player(20)]));
    var spectator = await sut.AuthorizeAsync(30, 300, 300, SpectatorRole.Spectator);
    var participant = await sut.AuthorizeAsync(10, 100, 300, SpectatorRole.Participant);
    var impostor = await sut.AuthorizeAsync(30, 300, 300, SpectatorRole.Participant);
    Assert.IsTrue(spectator.Success);
    Assert.IsTrue(participant.Success);
    Assert.AreEqual(SpectatorSubscribeReason.NotParticipant, impostor.Reason);
    Assert.AreEqual(0, publisher.Count("game.spectatorSnapshot"));
    await Assert.ThrowsExceptionAsync<InvalidOperationException>(
        () => sut.PublishDiscreteFrameAsync(Frame(matchId: 300, channelId: 7, sequence: 1)));
}
```

- [ ] **Step 2: Run service tests and verify the service is missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~SpectatorServiceTests`

Expected: FAIL with missing `SpectatorService`, subscribe result, and reason types.

- [ ] **Step 3: Add exact subscription result and snapshot contracts**

```csharp
public enum SpectatorSubscribeReason { None, MatchNotLive, NotPresent, NotSameChannel, NotParticipant }
public sealed record SpectatorSubscribeResult(
    bool Success, SpectatorSnapshot? Snapshot, string? Error, SpectatorSubscribeReason Reason);

public sealed record SpectatorSnapshot(
    int SchemaVersion, long MatchId, int ChannelId, string GameType, string Format,
    int RulesetVersion, IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence, DateTimeOffset GeneratedAt, object View);

public sealed record SpectatorClosed(long MatchId, int ChannelId, SpectatorCloseReason Reason);
```

- [ ] **Step 4: Implement one explicit subscription per stable user**

```csharp
private sealed class Subscription
{
    public required long UserId { get; init; }
    public required long SessionId { get; init; }
    public required long MatchId { get; init; }
    public required int ChannelId { get; init; }
    public required long Generation { get; init; }
    public long LastSequence { get; set; }
    public SemaphoreSlim DeliveryGate { get; } = new(1, 1);
}
private sealed record CurrentMatch(SpectatorMatchDescriptor Descriptor, SpectatorSourceFrame? LatestFrame);
private sealed record SessionAuthorization(long UserId, int? ChannelId, long Epoch, bool Connected);
private readonly SemaphoreSlim _transitions = new(1, 1);
private readonly Dictionary<long, Subscription> _byUser = [];
private readonly Dictionary<long, CurrentMatch> _matches = [];
private readonly Dictionary<long, SessionAuthorization> _authorizationBySession = [];
private long _subscriptionGeneration;

public async Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, long matchId)
{
    CurrentMatch? optimistic;
    await _transitions.WaitAsync();
    try { _matches.TryGetValue(matchId, out optimistic); }
    finally { _transitions.Release(); }
    if (optimistic?.LatestFrame is not { } firstFrame)
        return Failed(SpectatorSubscribeReason.MatchNotLive);
    if (!TryAuthorizePresence(sessionId, userId, firstFrame.ChannelId, out var firstFailure))
        return firstFailure;

    await _transitions.WaitAsync();
    try
    {
        // Re-read both mutable authorities immediately before insertion while
        // end/move transitions are serialized by this same semaphore.
        if (!_matches.TryGetValue(matchId, out var current) || current.LatestFrame is not { } latest)
            return Failed(SpectatorSubscribeReason.MatchNotLive);
        if (!TryAuthorizeCurrentLocked(sessionId, userId, latest.ChannelId, out var secondFailure))
            return secondFailure;

        var snapshot = ToSnapshot(latest);
        _byUser[userId] = new Subscription {
            UserId = userId, SessionId = sessionId, MatchId = matchId,
            ChannelId = latest.ChannelId, LastSequence = snapshot.Sequence,
            Generation = ++_subscriptionGeneration,
        };
        return new(true, snapshot, null, SpectatorSubscribeReason.None);
    }
    finally { _transitions.Release(); }
}

public Task UnsubscribeAsync(long sessionId, long userId)
{
    return RemoveSerializedAsync(sessionId, userId);
}
```

`HandlePresenceLostAsync`, `HandleChannelChangedAsync`, `HandleChannelRemovedAsync`, `HandleTransportDisconnectedAsync`, `PublishDiscreteFrameAsync`, and `EndMatchAsync` use the same `_transitions` semaphore. Subscribe performs an optimistic match/presence check without retaining `_transitions`, then acquires `_transitions` and re-reads current match plus service-owned session authorization immediately before insertion. `HandleChannelChangedAsync` increments the session epoch and writes `{ userId, newChannelId, connected: true }`; `HandlePresenceLostAsync` writes `{ channelId: null, connected: false }` before removing subscriptions. `TryAuthorizeCurrentLocked` prefers this authoritative callback state and otherwise performs a fresh `_presence.TryGetChannel` read and caches it. This closes the gap between the pre-update callback and external `_channelMembership.Update`: a subscribe after the callback sees the new channel even if membership still reports the old one. Never hold global `_transitions` across `_publisher` I/O; per-subscription `DeliveryGate` provides publish/removal linearization.

- [ ] **Step 5: Publish updates only to matching explicit subscribers**

```csharp
public async Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame)
{
    List<Subscription> candidates;
    await _transitions.WaitAsync();
    try
    {
        _matches[frame.MatchId] = new(
            new(frame.MatchId, frame.ChannelId, frame.Configuration, frame.Players, SpectatorTransport.DiscreteEventBus),
            frame);
        candidates = _byUser.Values
            .Where(x => x.MatchId == frame.MatchId && frame.Sequence > x.LastSequence)
            .ToList();
    }
    finally { _transitions.Release(); }

    foreach (var candidate in candidates)
    {
        await _beforePublish(candidate.UserId, frame.MatchId); // internal no-op hook; tests block here
        await candidate.DeliveryGate.WaitAsync();
        try
        {
            await _transitions.WaitAsync();
            bool current;
            try
            {
                current = _matches.ContainsKey(frame.MatchId)
                    && _byUser.TryGetValue(candidate.UserId, out var sub)
                    && ReferenceEquals(sub, candidate)
                    && sub.Generation == candidate.Generation
                    && frame.Sequence > sub.LastSequence;
                if (current) sub!.LastSequence = frame.Sequence;
            }
            finally { _transitions.Release(); }
            if (current)
                await _publisher.PublishToUsersAsync(
                    new HashSet<long> { candidate.UserId }, ToEvent(ToSnapshot(frame)));
        }
        finally { candidate.DeliveryGate.Release(); }
    }
}
```

Removal/replacement first acquires the affected subscription's `DeliveryGate`, then `_transitions`, removes/increments generation, releases `_transitions`, and finally releases `DeliveryGate`. Fan-out takes the same gates in that order, rechecks reference plus generation immediately before send, and holds only the per-user delivery gate across targeted I/O. Therefore a publish either linearizes before unsubscribe, or a completed unsubscribe guarantees no later send from the stale candidate. The internal constructor-injected `Func<long,long,Task> beforePublish` defaults to `Task.CompletedTask` and exists only to deterministically test the pre-check race. Subscribe initial state is returned in the authenticated HTTP response, not broadcast. Discrete updates use `PublishToUsersAsync`, never `PublishToChannelAsync`. `RegisterContinuousMatchAsync` stores only a `DedicatedRealtime` descriptor; `PublishDiscreteFrameAsync` rejects that transport with `InvalidOperationException`, preventing Arena frames from entering this path.

- [ ] **Step 6: Run service tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~SpectatorServiceTests`

Expected: PASS for serialized end/move versus subscribe, two-read authorization, fresh complete response, replacement generations, subscriber-only fan-out, pre-publish generation recheck, stale source suppression, and continuous-transport rejection.

- [ ] **Step 7: Commit the subscription service**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorService.cs src/Brmble.Server/Games/Spectators/SpectatorModels.cs tests/Brmble.Server.Tests/Games/Spectators/SpectatorServiceTests.cs
git commit -m "feat: add explicit duel spectator subscriptions"
```

## Task 4: Clean Up And Revalidate Every Spectator Lifecycle

**Files:**
- Modify: `src/Brmble.Server/Games/Spectators/SpectatorService.cs`
- Modify: `tests/Brmble.Server.Tests/Games/Spectators/SpectatorServiceTests.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- Modify: `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`

- [ ] **Step 1: Write failing cleanup and revalidation tests**

```csharp
[DataTestMethod]
[DataRow("unsubscribe", SpectatorCloseReason.Unsubscribed)]
[DataRow("disconnect", SpectatorCloseReason.Disconnected)]
[DataRow("move", SpectatorCloseReason.AuthorizationLost)]
[DataRow("completion", SpectatorCloseReason.MatchEnded)]
[DataRow("channelRemoved", SpectatorCloseReason.ChannelRemoved)]
public async Task Lifecycle_RemovesSubscriptionAndStopsFutureUpdates(string lifecycle, SpectatorCloseReason reason)
{
    var harness = await SubscribedHarnessAsync();
    await harness.ApplyLifecycleAsync(lifecycle);
    Assert.IsFalse(harness.Service.IsSubscribedForTest(100));
    Assert.AreEqual(reason, harness.LastCloseReason);
    await harness.Service.PublishDiscreteFrameAsync(Frame(matchId: 91, channelId: 7, sequence: 9));
    Assert.AreEqual(0, harness.Publisher.SnapshotCountAfterLifecycle);
}

[TestMethod]
public async Task DispatchUserStateChanged_RemovesSpectatorBeforeMembershipMoves()
{
    var spectators = new Mock<ISpectatorLifecycle>();
    var membership = new Mock<IChannelMembershipService>();
    membership.Setup(x => x.TryGetChannel(10, out It.Ref<int>.IsAny))
        .Callback(new TryGetChannelCallback((int _, out int channel) => channel = 7)).Returns(true);
    var order = new List<string>();
    spectators.Setup(x => x.HandleChannelChangedAsync(10, 8))
        .Callback(() => order.Add("spectator")).Returns(Task.CompletedTask);
    membership.Setup(x => x.Update(10, 8)).Callback(() => order.Add("membership"));
    var callback = CreateCallback([], channelMembership: membership.Object, spectators: spectators.Object);
    await callback.DispatchUserStateChanged(new MumbleUser("Alice", "", 10), 8);
    CollectionAssert.AreEqual(new[] { "spectator", "membership" }, order);
}

[TestMethod]
public async Task RealChannelMove_InvalidatesOldSubscriptionAndRejectsOldMatchResubscribe()
{
    var harness = await SubscribedCallbackHarnessAsync(sessionId: 10, userId: 100, oldChannel: 7, newChannel: 8);
    await harness.Callback.DispatchUserStateChanged(new MumbleUser("Alice", "", 10), 8);
    Assert.IsFalse(harness.Spectators.IsSubscribedForTest(100));
    var retry = await harness.Spectators.SubscribeAsync(10, 100, 91);
    Assert.AreEqual(SpectatorSubscribeReason.NotSameChannel, retry.Reason);
}

[TestMethod]
public async Task FinalWebSocketClose_RemovesSubscriptionButOneOfTwoSocketsClosingDoesNot()
{
    var spectators = new Mock<ISpectatorLifecycle>();
    await CloseSocketForUserAsync(userId: 100, remainingSocket: true, spectators.Object);
    spectators.Verify(x => x.HandleTransportDisconnectedAsync(100), Times.Never);
    await CloseSocketForUserAsync(userId: 100, remainingSocket: false, spectators.Object);
    spectators.Verify(x => x.HandleTransportDisconnectedAsync(100), Times.Once);
}
```

- [ ] **Step 2: Run lifecycle tests and verify cleanup APIs are missing**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SpectatorServiceTests|FullyQualifiedName~MumbleServerCallbackTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: FAIL because spectator lifecycle callbacks and final-WebSocket cleanup are absent.

- [ ] **Step 3: Add one lifecycle interface and generation-safe removal**

```csharp
public interface ISpectatorLifecycle
{
    Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason);
    Task HandleChannelChangedAsync(long sessionId, int newChannelId);
    Task HandleChannelRemovedAsync(int channelId);
    Task HandleTransportDisconnectedAsync(long userId);
}
```

Each removal method finds the candidate under `_transitions`, releases it, acquires that candidate's `DeliveryGate`, reacquires `_transitions`, and removes only if the same object/generation is still current. It captures immutable `SpectatorClosed` publication data, releases `_transitions`, publishes the close event while still holding the per-user gate, then releases the gate. `EndMatchAsync` first tombstones/removes the current match under `_transitions`, then removes affected subscriptions through the same per-user path with `MatchEnded`. A late discrete frame with a terminal match ID is rejected by a bounded terminal-ID tombstone (newest 1,000 or 30 minutes) so completion cannot be resurrected by delayed manager work.

- [ ] **Step 4: Revalidate before membership destruction in `MumbleServerCallback`**

```csharp
// DispatchUserDisconnected, before sessionMapping/channelMembership removal:
await _spectators.HandlePresenceLostAsync(user.SessionId, SpectatorCloseReason.Disconnected);

// DispatchUserStateChanged, before _channelMembership.Update when channelChanged:
if (channelChanged)
    await _spectators.HandleChannelChangedAsync(user.SessionId, channelId);

public async Task DispatchChannelRemoved(MumbleChannel channel)
{
    await _spectators.HandleChannelRemovedAsync(channel.Id);
    await _duelOrchestrator.HandleChannelRemovedAsync(channel.Id); // project 1 remains authoritative for queue cleanup
    await Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));
}
```

- [ ] **Step 5: Force explicit resubscribe after the final application socket closes**

```csharp
finally
{
    eventBus.RemoveClient(ws);
    if (!eventBus.HasConnectedClient(user.Id))
    {
        await spectators.HandleTransportDisconnectedAsync(user.Id);
        activeSessions.Deactivate(hash);
    }
}
```

Do not send a spectator snapshot from WebSocket registration. Project 1 still sends the low-frequency queue snapshot; project 2 requires the web app to explicitly call subscribe again when the activity is reopened/recovered.

- [ ] **Step 6: Run lifecycle tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SpectatorServiceTests|FullyQualifiedName~MumbleServerCallbackTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"`

Expected: PASS for close, real callback-ordered channel moves, disconnect, completion, channel removal, delayed-frame suppression, and final-socket cleanup.

- [ ] **Step 7: Commit lifecycle enforcement**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorService.cs tests/Brmble.Server.Tests/Games/Spectators/SpectatorServiceTests.cs src/Brmble.Server/Mumble/MumbleServerCallback.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs
git commit -m "fix: revalidate spectator subscriptions across lifecycle changes"
```

## Task 5: Expose Spectator Commands Through Server And Native Bridge

**Files:**
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs`
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs`
- Create: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`
- Modify: `src/Brmble.Client/Services/Games/GameService.cs`
- Modify: `tests/Brmble.Client.Tests/Services/GameServiceTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [ ] **Step 1: Write failing endpoint and native routing tests**

```csharp
[TestMethod]
public async Task RegisterHandlers_RoutesCorrelatedSpectatorSubscribeAndUnsubscribe()
{
    var harness = GameServiceHarness.Create();
    harness.Send("games.request", new { action = "spectator-subscribe", matchId = 91, requestId = 7 });
    harness.Send("games.request", new { action = "spectator-unsubscribe", requestId = 8 });
    await harness.DrainAsync();
    CollectionAssert.Contains(harness.PostPaths, "games/spectators/subscribe");
    CollectionAssert.Contains(harness.PostPaths, "games/spectators/unsubscribe");
    Assert.AreEqual(2, harness.Messages("games.response").Count);
}

[TestMethod]
public void MumbleAdapter_ForwardsSpectatorSnapshotUnchanged()
{
    var adapter = CreateAdapterWithBridge(out var bridge);
    InvokePrivate(adapter, "HandleWebSocketMessage", """
        {"type":"game.spectatorSnapshot","matchId":91,"sequence":4,"view":{"kind":"rps","committed":[true,false]}}
        """);
    var sent = NativeBridgeTestHarness.DrainMessages(bridge).Single(x => x.Type == "game.spectatorSnapshot");
    StringAssert.Contains(sent.DataJson, "\"sequence\":4");
}

[TestMethod]
public async Task SubscribeEndpoint_ReturnsStructuredReasonForCrossChannelUser()
{
    var response = await PostAsUserAsync("/games/spectators/subscribe", userId: 100, new { matchId = 91 });
    Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    var body = await response.Content.ReadFromJsonAsync<JsonElement>();
    Assert.AreEqual("notSameChannel", body.GetProperty("reason").GetString());
}

[TestMethod]
public async Task SubscribeBridgeFailure_PreservesStructuredReason()
{
    var harness = GameServiceHarness.Create(postResult: Failure(400,
        "{\"error\":\"You must be in the match channel to spectate.\",\"reason\":\"notSameChannel\"}"));
    harness.Send("games.request", new { action = "spectator-subscribe", matchId = 91, requestId = 7 });
    await harness.DrainAsync();
    var response = harness.Messages("games.response").Single();
    Assert.AreEqual("notSameChannel", response.Data.GetProperty("reason").GetString());
}
```

- [ ] **Step 2: Run client and endpoint tests and verify routes are absent**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter FullyQualifiedName~GameEndpointsTests`

Expected: FAIL because real spectator endpoint mapping and reason payloads are absent.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~GameServiceTests|FullyQualifiedName~MumbleAdapterBridgeTests&Name~Spectator"`

Expected: FAIL because spectator request actions are unknown.

- [ ] **Step 3: Add authenticated server endpoints with stable errors**

```csharp
public sealed record SpectatorSubscribeDto(long MatchId);

app.MapPost("/games/spectators/subscribe", async (
    SpectatorSubscribeDto dto, HttpContext ctx, ICertificateHashExtractor certs,
    UserRepository users, ISessionMappingService sessions, SpectatorService spectators) =>
{
    var user = await ResolveUserAsync(ctx, certs, users);
    if (user is null) return Results.Unauthorized();
    if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
        return Results.BadRequest(new { error = "You must be connected to Brmble.", reason = "notPresent" });
    var result = await spectators.SubscribeAsync(session, user.UserId, dto.MatchId);
    return result.Success
        ? Results.Ok(result.Snapshot)
        : Results.BadRequest(new { error = result.Error, reason = SpectatorReasonCode(result.Reason) });
});

app.MapPost("/games/spectators/unsubscribe", async (
    HttpContext ctx, ICertificateHashExtractor certs, UserRepository users,
    ISessionMappingService sessions, SpectatorService spectators) =>
{
    var user = await ResolveUserAsync(ctx, certs, users);
    if (user is null) return Results.Unauthorized();
    if (sessions.TryGetSessionByUserId(user.UserId, out var session))
        await spectators.UnsubscribeAsync(session, user.UserId);
    return Results.Ok(new { unsubscribed = true });
});

static string SpectatorReasonCode(SpectatorSubscribeReason reason) => reason switch
{
    SpectatorSubscribeReason.MatchNotLive => "matchNotLive",
    SpectatorSubscribeReason.NotPresent => "notPresent",
    SpectatorSubscribeReason.NotSameChannel => "notSameChannel",
    SpectatorSubscribeReason.NotParticipant => "notParticipant",
    _ => "none",
};
```

- [ ] **Step 4: Register the singleton against the discrete source**

```csharp
services.AddSingleton<SpectatorService>(sp => new SpectatorService(
    sp.GetRequiredService<IGamePresence>(),
    sp.GetRequiredService<IGameEventPublisher>()));
services.AddSingleton<ISpectatorLifecycle>(sp => sp.GetRequiredService<SpectatorService>());
services.AddSingleton<ISpectatorCoordinator>(sp => sp.GetRequiredService<SpectatorService>());
```

Update the project-1 `GameSessionManager` registration to inject `ISpectatorCoordinator`; do not register a second manager or change `IDuelMatchRunner` ownership. `EventBusGameEventPublisher` needs no production edit because `PublishToUsersAsync` already provides the required targeted discrete delivery.

- [ ] **Step 5: Add correlated native POST cases**

```csharp
case "spectator-subscribe":
{
    var matchId = data.GetProperty("matchId").GetInt64();
    var body = JsonSerializer.Serialize(new { matchId });
    var result = await _postJsonAsync(cert, new Uri(baseUri, "games/spectators/subscribe"), body);
    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error, ParseReason(result.Error));
    break;
}
case "spectator-unsubscribe":
{
    var result = await _postJsonAsync(cert, new Uri(baseUri, "games/spectators/unsubscribe"), "{}");
    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error, ParseReason(result.Error));
    break;
}
```

Extend native `games.response` to include `reason` and parse `{ error, reason }` exactly as `PostAsync` already does. Extend web `BridgeResponse` with `reason?: string`; on failure reject `new GameApiError(response.error ?? fallback, response.reason)`, not plain `Error`, so WebView and fetch paths preserve the same machine code.

```csharp
private void SendResponse(
    int? requestId, bool success, string? body, int statusCode, string? error, string? reason = null)
{
    _bridge?.Send("games.response", new { requestId, success, body, statusCode, error, reason });
    _bridge?.NotifyUiThread();
}

private static string? ParseReason(string? body) => ParseErrorBody(body, 0).reason;
```

```ts
interface BridgeResponse {
  requestId?: number;
  success?: boolean;
  body?: string;
  statusCode?: number;
  error?: string;
  reason?: string;
}

reject(new GameApiError(
  response.error ?? (response.statusCode ? `Request failed (${response.statusCode}).` : 'Request failed.'),
  response.reason,
));
```

- [ ] **Step 6: Run server/native transport tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~GameEndpointsTests|FullyQualifiedName~SpectatorServiceTests"`

Expected: PASS for authenticated session resolution and stable `matchNotLive|notPresent|notSameChannel` failures.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~GameServiceTests|FullyQualifiedName~MumbleAdapterBridgeTests&Name~Spectator"`

Expected: PASS with correlated initial snapshots, unsubscribe responses, and unchanged `game.*` event forwarding.

- [ ] **Step 7: Commit spectator transport**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs src/Brmble.Client/Services/Games/GameService.cs tests/Brmble.Client.Tests/Services/GameServiceTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat: bridge spectator subscription commands"
```

## Task 6: Add Sequence-Gated Web Spectator State

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts`
- Create: `src/Brmble.Web/src/components/Games/useSpectatorState.ts`
- Create: `src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx`

- [ ] **Step 1: Write failing subscribe, stale-sequence, replacement, and cleanup tests**

```tsx
it('accepts a fresh complete subscribe snapshot and rejects stale event sequences', async () => {
  api.subscribeSpectator.mockResolvedValue(rpsSnapshot(91, 7, 4));
  const { result } = renderHook(() => useSpectatorState());
  await act(() => result.current.subscribe(91));
  act(() => emit('game.spectatorSnapshot', rpsSnapshot(91, 7, 3)));
  expect(result.current.snapshot?.sequence).toBe(4);
  act(() => emit('game.spectatorSnapshot', rpsSnapshot(91, 7, 5)));
  expect(result.current.snapshot?.sequence).toBe(5);
});

it('unsubscribes the old match before replacing it and clears on server close', async () => {
  api.subscribeSpectator.mockResolvedValueOnce(deathrollSnapshot(91, 7, 1)).mockResolvedValueOnce(rpsSnapshot(92, 7, 1));
  const { result } = renderHook(() => useSpectatorState());
  await act(() => result.current.subscribe(91));
  await act(() => result.current.subscribe(92));
  expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1);
  act(() => emit('game.spectatorClosed', { matchId: 92, channelId: 7, reason: 'matchEnded' }));
  expect(result.current.snapshot).toBeNull();
});

it('does not let the initial response overwrite a newer event that arrived first', async () => {
  const initial = deferred<SpectatorSnapshot>();
  api.subscribeSpectator.mockReturnValue(initial.promise);
  const { result } = renderHook(() => useSpectatorState());
  let subscribing!: Promise<void>;
  act(() => { subscribing = result.current.subscribe(91); });
  act(() => emit('game.spectatorSnapshot', rpsSnapshot(91, 7, 5)));
  initial.resolve(rpsSnapshot(91, 7, 4));
  await act(() => subscribing);
  expect(result.current.snapshot?.sequence).toBe(5);
});

it('serializes replacement and compensates when the superseded subscribe resolves late', async () => {
  const first = deferred<SpectatorSnapshot>();
  const firstStarted = deferred<void>();
  api.subscribeSpectator
    .mockImplementationOnce(() => { firstStarted.resolve(); return first.promise; })
    .mockResolvedValueOnce(rpsSnapshot(92, 7, 1));
  const { result } = renderHook(() => useSpectatorState());
  const firstRequest = result.current.subscribe(91);
  await firstStarted.promise;
  const replacement = result.current.subscribe(92);
  first.resolve(deathrollSnapshot(91, 7, 1));
  await act(() => Promise.all([firstRequest, replacement]));
  expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1);
  expect(api.subscribeSpectator.mock.invocationCallOrder[1]).toBeGreaterThan(api.unsubscribeSpectator.mock.invocationCallOrder[0]);
  expect(result.current.snapshot?.matchId).toBe(92);
});

it('close during pending subscribe performs compensating unsubscribe after success', async () => {
  const pending = deferred<SpectatorSnapshot>();
  const started = deferred<void>();
  api.subscribeSpectator.mockImplementation(() => { started.resolve(); return pending.promise; });
  const { result } = renderHook(() => useSpectatorState());
  const opening = result.current.subscribe(91);
  await started.promise;
  const closing = result.current.unsubscribe();
  pending.resolve(deathrollSnapshot(91, 7, 1));
  await act(() => Promise.all([opening, closing]));
  expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot).toBeNull();
});

it('surfaces structured bridge reasons as GameApiError', async () => {
  const { result } = renderHook(() => useSpectatorState());
  api.subscribeSpectator.mockRejectedValue(new GameApiError('Wrong channel', 'notSameChannel'));
  await act(() => result.current.subscribe(91));
  expect(result.current.error).toEqual(expect.objectContaining({ reason: 'notSameChannel' }));
});

it('reset during a pending subscribe compensates after the late success', async () => {
  const pending = deferred<SpectatorSnapshot>();
  const started = deferred<void>();
  api.subscribeSpectator.mockImplementation(() => { started.resolve(); return pending.promise; });
  const { result } = renderHook(() => useSpectatorState());
  const opening = result.current.subscribe(91);
  await started.promise;
  act(() => result.current.reset());
  pending.resolve(deathrollSnapshot(91, 7, 1));
  await act(() => opening);
  expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot).toBeNull();
});
```

- [ ] **Step 2: Run hook tests and verify contracts are missing**

Run: `npm test -- --run src/components/Games/useSpectatorState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because spectator API types and hook do not exist.

- [ ] **Step 3: Add exact discriminated TypeScript contracts**

```ts
export interface DeathrollSpectatorView {
  kind: 'deathroll'; players: number[]; currentPlayer: number | null;
  ceiling: number; lastRoll: number | null; finished: boolean; loserId: number | null;
  history: Array<{ sequence: number; sessionId: number; value: number; ceiling: number }>;
}
export interface RpsSpectatorView {
  kind: 'rps'; players: number[]; bestOf: number; targetWins: number;
  roundNumber: number; roundWins: number[]; committed: boolean[];
  finished: boolean; winnerId: number | null;
  lastRound: null | { roundNumber: number; sequence: number; pick0: string; pick1: string; winnerId: number | null; tie: boolean };
}
export type SpectatorView = DeathrollSpectatorView | RpsSpectatorView;
export interface SpectatorSnapshot {
  schemaVersion: 1; matchId: number; channelId: number; gameType: 'deathroll' | 'rps';
  format: string; rulesetVersion: number; players: DuelPlayerSnapshot[];
  sequence: number; generatedAt: string; view: SpectatorView;
}
```

- [ ] **Step 4: Add correlated subscribe/unsubscribe calls**

```ts
export function subscribeSpectator(matchId: number): Promise<SpectatorSnapshot> {
  if (isWebViewBridgeAvailable())
    return bridgeRequest<SpectatorSnapshot>({ action: 'spectator-subscribe', matchId });
  return fetch('/games/spectators/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId }),
  }).then(async response => response.ok ? response.json() : Promise.reject(await toGameApiError(response)));
}

export function unsubscribeSpectator(): Promise<{ unsubscribed: true }> {
  if (isWebViewBridgeAvailable())
    return bridgeRequest({ action: 'spectator-unsubscribe' });
  return fetch('/games/spectators/unsubscribe', { method: 'POST' })
    .then(async response => response.ok ? response.json() : Promise.reject(await toGameApiError(response)));
}
```

- [ ] **Step 5: Implement match-and-sequence gating with explicit teardown**

```ts
const expectedMatchIdRef = useRef<number | null>(null);
const operationGenerationRef = useRef(0);
const requestChainRef = useRef(Promise.resolve());
const apply = useCallback((next: SpectatorSnapshot) => setSnapshot(previous => {
  if (next.matchId !== expectedMatchIdRef.current) return previous;
  if (previous && next.sequence <= previous.sequence) return previous;
  snapshotRef.current = next;
  return next;
}), []);

const subscribe = useCallback(async (matchId: number) => {
  const generation = ++operationGenerationRef.current;
  expectedMatchIdRef.current = matchId;
  const operation = requestChainRef.current.then(async () => {
    if (generation !== operationGenerationRef.current) return;
    if (snapshotRef.current || serverSubscriptionRef.current) {
      await gamesApi.unsubscribeSpectator();
      serverSubscriptionRef.current = false;
    }
    if (generation !== operationGenerationRef.current) return;
    const next = await gamesApi.subscribeSpectator(matchId);
    serverSubscriptionRef.current = true;
    if (generation !== operationGenerationRef.current || expectedMatchIdRef.current !== matchId) {
      await gamesApi.unsubscribeSpectator(); // compensate for a superseded successful subscribe
      serverSubscriptionRef.current = false;
      return;
    }
    apply(next);
  });
  requestChainRef.current = operation.catch(() => {});
  await operation;
}, [apply]);
```

Register the `game.spectatorSnapshot` listener before any subscribe call and route both event frames and the correlated initial response through `apply`; this preserves a newer event that races ahead of the response. Every subscribe/replace/close increments `operationGenerationRef` and appends network work to `requestChainRef`, so server mutations are serialized. `unsubscribe()` clears expected/local state immediately, then queues an unsubscribe; if an older subscribe succeeds after being superseded, that subscribe operation sends a compensating unsubscribe before the next subscribe begins. `game.spectatorClosed` clears only when its `matchId` equals the expected match. `reset()` increments generation and clears expected/local state; a pending successful request detects that generation change and compensates, while a fully established voice-disconnect subscription relies on authoritative server cleanup and clears `serverSubscriptionRef` locally.

- [ ] **Step 6: Run hook tests and type-check**

Run: `npm test -- --run src/components/Games/useSpectatorState.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for fresh initial state, response/event race ordering, stale/equal sequence rejection, serialized replacement, pending close/reset compensation, structured reasons, and reset.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with no participant-view cast and no spectator payload widened to `any`.

- [ ] **Step 7: Commit web spectator state**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/components/Games/useSpectatorState.ts src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx
git commit -m "feat: store explicit spectator snapshots"
```

## Task 7: Add Stable Exactly-One Foreground Activity Arbitration

**Files:**
- Create: `src/Brmble.Web/src/hooks/useForegroundActivity.ts`
- Create: `src/Brmble.Web/src/hooks/useForegroundActivity.test.ts`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`

- [ ] **Step 1: Write failing arbitration and rendering tests**

```tsx
it('keeps exactly one descriptor and replacement does not stack activities', () => {
  const { result } = renderHook(() => useForegroundActivity());
  act(() => result.current.open({ kind: 'duel', channelId: 7, matchId: 91 }));
  act(() => result.current.open({ kind: 'game', channelId: 7, matchId: 92, gameType: 'arena-knockoff', role: 'participant' }));
  expect(result.current.activity).toEqual({ kind: 'game', channelId: 7, matchId: 92, gameType: 'arena-knockoff', role: 'participant' });
});

it('renders custom foreground instead of screen shares while preserving chat below', () => {
  render(<ChatPanel {...baseProps} foregroundActivity={<section aria-label="Duel activity">Board</section>} watchingShares={[share]} remoteVideoEls={videos} onCloseShare={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Duel activity' })).toBeInTheDocument();
  expect(screen.queryByTestId('screen-share-tile')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  const divider = screen.getByRole('separator');
  expect(divider).toHaveAttribute('aria-valuemin', '20');
  expect(divider).toHaveAttribute('aria-valuemax', '80');
});
```

- [ ] **Step 2: Run foreground and ChatPanel tests and verify APIs are absent**

Run: `npm test -- --run src/hooks/useForegroundActivity.test.ts src/components/ChatPanel/ChatPanel.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because the hook and `foregroundActivity` prop do not exist.

- [ ] **Step 3: Implement the project-3-stable foreground descriptor**

```ts
export type ForegroundActivity =
  | { kind: 'duel'; channelId: number; matchId: number | null }
  | { kind: 'game'; channelId: number; matchId: number; gameType: string; role: 'participant' | 'spectator' };

export function useForegroundActivity(): ForegroundActivityController {
  const [activity, setActivity] = useState<ForegroundActivity | null>(null);
  return {
    activity,
    open: useCallback((next: ForegroundActivity) => setActivity(next), []),
    close: useCallback(() => setActivity(null), []),
    reset: useCallback(() => setActivity(null), []),
  };
}
```

- [ ] **Step 4: Generalize the upper ChatPanel slot without moving chat**

```tsx
interface ChatPanelProps {
  // Existing props remain.
  foregroundActivity?: ReactNode;
  foregroundActivityLabel?: string;
}

const visibleForeground = foregroundActivity ?? (hasScreenShare ? (
  <ScreenShareGrid {...screenShareProps} />
) : null);

{visibleForeground && (
  <>
    <div className="chat-foreground-activity" style={{ flex: `0 0 ${splitPercent}%` }} aria-label={foregroundActivityLabel}>
      {visibleForeground}
    </div>
    <div className="chat-split-divider" role="separator" aria-orientation="horizontal" aria-valuenow={splitPercent} aria-valuemin={20} aria-valuemax={80} /* retain existing pointer/keyboard behavior */ />
  </>
)}
```

Rename `.chat-split-video` to `.chat-foreground-activity`; retain the saved `brmble-screenshare-split` value for compatible user sizing, 20-80 keyboard bounds, and token-only CSS. A custom foreground and screen-share grid are mutually exclusive in the DOM.

- [ ] **Step 5: Run foreground and ChatPanel tests**

Run: `npm test -- --run src/hooks/useForegroundActivity.test.ts src/components/ChatPanel/ChatPanel.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS with one descriptor, one upper activity, unchanged chat/composer, and accessible keyboard divider.

- [ ] **Step 6: Commit foreground arbitration**

```bash
git add src/Brmble.Web/src/hooks/useForegroundActivity.ts src/Brmble.Web/src/hooks/useForegroundActivity.test.ts src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.css src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx
git commit -m "feat: add generic chat foreground activity"
```

## Task 8: Pause And Restore Remote Screen Media Without Losing Viewer State

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Extend the LiveKit mock and write failing pause/restoration tests**

```tsx
it('pauses remote screen video and audio while preserving logical and local state', async () => {
  const { result } = await connectedViewerAndPublisher({ focusedUserId: 10, quality: 'medium' });
  await act(() => result.current.setRemotePlaybackPaused(true));
  expect(videoPublication.setSubscribed).toHaveBeenCalledWith(false);
  expect(audioPublication.setSubscribed).toHaveBeenCalledWith(false);
  expect(result.current.watchingShares.map(x => x.userId)).toEqual([10, 20]);
  expect(result.current.focusedShare?.userId).toBe(10);
  expect(result.current.viewerQualities.get(10)).toBe('medium');
  expect(mockRoom.disconnect).not.toHaveBeenCalled();
  expect(mockRoom.localParticipant.setScreenShareEnabled).not.toHaveBeenCalledWith(false);
  expect(result.current.isSharing).toBe(true);
});

it('restores surviving shares and removes one that ended while paused', async () => {
  const { result, emitShareStopped } = await connectedTwoShareViewer();
  await act(() => result.current.setRemotePlaybackPaused(true));
  act(() => emitShareStopped({ roomName: 'channel-1', userId: 20 }));
  await act(() => result.current.setRemotePlaybackPaused(false));
  expect(videoPublicationFor(10).setSubscribed).toHaveBeenLastCalledWith(true);
  expect(result.current.watchingShares.map(x => x.userId)).toEqual([10]);
  expect(result.current.focusedShare?.userId).toBe(10);
  expect(result.current.viewerQualities.get(10)).toBe('medium');
});

it('immediately unsubscribes a recaptured publication with a new SID while paused', async () => {
  const { result } = await connectedViewer();
  await act(() => result.current.setRemotePlaybackPaused(true));
  act(() => emitRoomEvent('trackPublished', newVideoPublication({ trackSid: 'new-sid' }), participantFor(10)));
  expect(publication('new-sid').setSubscribed).toHaveBeenCalledWith(false);
  expect(result.current.watchingShares).toHaveLength(1);
});

it('ignores delayed unsubscribe from an older pause generation after restore', async () => {
  const { result } = await connectedViewer();
  await act(() => result.current.setRemotePlaybackPaused(true));
  await act(() => result.current.setRemotePlaybackPaused(false));
  act(() => emitRoomEvent('trackUnsubscribed', videoTrack, oldPublication, participantFor(10)));
  expect(result.current.watchingShares).toHaveLength(1);
  expect(publication(oldPublication.trackSid).setSubscribed).toHaveBeenLastCalledWith(true);
});

it('rapid pause restore pause converges to the newest generation', async () => {
  const { result } = await connectedViewer();
  const first = result.current.setRemotePlaybackPaused(true);
  const second = result.current.setRemotePlaybackPaused(false);
  const third = result.current.setRemotePlaybackPaused(true);
  await act(() => Promise.all([first, second, third]));
  expect(result.current.remotePlaybackPaused).toBe(true);
  expect(videoPublication.setSubscribed).toHaveBeenLastCalledWith(false);
  expect(result.current.watchingShares).toHaveLength(1);
});
```

- [ ] **Step 2: Run screen-share tests and verify the pause API is missing**

Run: `npm test -- --run src/hooks/useScreenShare.test.ts`

Working directory: `src/Brmble.Web`

Expected: FAIL because `setRemotePlaybackPaused` and intentional-unsubscribe handling do not exist.

- [ ] **Step 3: Add explicit remote-publication helpers and pause state**

```ts
const remotePlaybackPausedRef = useRef(false);
const remotePlaybackGenerationRef = useRef(0);
const remotePlaybackChainRef = useRef(Promise.resolve());
const intentionalPublicationGenerationRef = useRef(new Map<string, number>());

const forEachWatchedScreenPublication = useCallback((visit: (
  pub: RemoteTrackPublication, share: ShareInfo,
) => void) => {
  const room = roomRef.current;
  if (!room) return;
  for (const share of watchingSharesRef.current) {
    const participant = room.remoteParticipants.get(share.matrixUserId ?? String(share.userId));
    participant?.trackPublications.forEach(pub => {
      if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio)
        visit(pub, share);
    });
  }
}, []);
```

- [ ] **Step 4: Implement idempotent pause and restoration**

```ts
const setRemotePlaybackPaused = useCallback(async (paused: boolean) => {
  const generation = ++remotePlaybackGenerationRef.current;
  remotePlaybackPausedRef.current = paused;
  const operation = remotePlaybackChainRef.current.then(async () => {
    if (generation !== remotePlaybackGenerationRef.current) return;
    if (paused) {
      forEachWatchedScreenPublication((pub, share) => {
        intentionalPublicationGenerationRef.current.set(pub.trackSid, generation);
        pub.setSubscribed(false);
        if (pub.source === Track.Source.ScreenShareAudio) detachRemoteAudio(share.userId);
      });
      setRemoteVideoEls(new Map());
      return;
    }
    const activeKeys = new Set(activeSharesRef.current.map(x => watchedShareKey(x.roomName, x.userId)));
    for (const share of [...watchingSharesRef.current])
      if (!activeKeys.has(watchedShareKey(share.roomName, share.userId))) endWatchedShare(share, 'ended');
    forEachWatchedScreenPublication(pub => {
      intentionalPublicationGenerationRef.current.set(pub.trackSid, generation);
      pub.setSubscribed(true);
    });
  });
  remotePlaybackChainRef.current = operation.catch(() => {});
  await operation;
}, [detachRemoteAudio, endWatchedShare, forEachWatchedScreenPublication]);
```

Add `RoomEvent.TrackPublished` to the mock and production handler. If a watched participant publishes/recaptures screen video or screen audio while `remotePlaybackPausedRef.current`, stamp the new SID with the current generation and immediately call `setSubscribed(false)` before attachment; this covers new SIDs. In `TrackUnsubscribed`, always detach physical media, but compare the SID's stamped generation with the current generation and current paused target. A delayed unsubscribe from an older pause/restore generation must not remove logical state or disconnect the room. In `TrackSubscribed`, if currently paused immediately unsubscribe/stamp instead of attach; otherwise attach and reapply viewer quality. Keep generation entries until the publication is removed or room lifecycle resets, rather than clearing them immediately on restore. `screenShare.stopped` remains authoritative and removes logical state immediately. `disconnectViewer`, service unavailable, room disconnect, and unmount increment generation and clear the map. No code calls `localParticipant.setScreenShareEnabled(false)` from this API.

- [ ] **Step 5: Run all screen-share lifecycle tests**

Run: `npm test -- --run src/hooks/useScreenShare.test.ts src/components/ScreenShareGrid/ScreenShareGrid.test.tsx src/components/ScreenShareGrid/ScreenShareTile.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS; pause/restoration preserves watched order, focus, quality, room, and local broadcast; new publication SIDs stay paused; delayed events and rapid toggles converge to the newest generation; ended shares reconcile once.

- [ ] **Step 6: Commit remote-media foreground control**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "feat: pause hidden remote screen media"
```

## Task 9: Build Dedicated Read-Only Deathroll And RPS Boards

**Files:**
- Create: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx`
- Create: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx`
- Create: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`
- Create: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx`
- Create: `src/Brmble.Web/src/components/Games/DuelActivity.module.css`

- [ ] **Step 1: Write failing read-only board and privacy rendering tests**

```tsx
it('renders Deathroll turn, ceiling, last roll, and full ordered history without actions', () => {
  render(<DeathrollSpectatorBoard view={deathrollViewWithHistory()} resolveName={nameOf} />);
  expect(screen.getByText('Alice is rolling')).toBeInTheDocument();
  expect(screen.getByText('Ceiling')).toBeInTheDocument();
  expect(screen.getByText('60')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /roll|forfeit/i })).not.toBeInTheDocument();
});

it('renders only RPS commitment state until resolved history is available', () => {
  render(<RpsSpectatorBoard view={unresolvedRpsView([true, false])} resolveName={nameOf} />);
  expect(screen.getByText('Alice locked in')).toBeInTheDocument();
  expect(screen.getByText('Waiting for Bob')).toBeInTheDocument();
  expect(screen.queryByText(/rock|paper|scissors/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run board tests and verify components are missing**

Run: `npm test -- --run src/components/Games/DeathrollSpectatorBoard.test.tsx src/components/Games/RpsSpectatorBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because both board components do not exist.

- [ ] **Step 3: Implement the Deathroll board as pure read-only presentation**

```tsx
export function DeathrollSpectatorBoard({ view, resolveName }: Props) {
  return <section aria-label="Deathroll spectator board">
    <header><h3 className="heading-section">Deathroll</h3><span>{view.currentPlayer ? `${resolveName(view.currentPlayer)} is rolling` : 'Match ended'}</span></header>
    <div className={styles.stats}>
      <div><span>Ceiling</span><strong>{view.ceiling}</strong></div>
      <div><span>Last roll</span><strong>{view.lastRoll ?? 'None'}</strong></div>
    </div>
    <ol aria-label="Roll history" className={styles.history}>
      {view.history.map(roll => <li key={roll.sequence}>
        <span>{resolveName(roll.sessionId)}</span><span>{roll.value}</span><span>1-{roll.ceiling}</span>
      </li>)}
    </ol>
  </section>;
}
```

- [ ] **Step 4: Implement the RPS board from spectator fields only**

```tsx
export function RpsSpectatorBoard({ view, resolveName }: Props) {
  return <section aria-label="Rock Paper Scissors spectator board">
    <header><h3 className="heading-section">Rock Paper Scissors</h3><span>Best of {view.bestOf}</span></header>
    <div className={styles.players}>{view.players.map((id, index) => <div key={id}>
      <span>{resolveName(id)}</span><strong>{view.roundWins[index] ?? 0}</strong>
      <span>{view.committed[index] ? `${resolveName(id)} locked in` : `Waiting for ${resolveName(id)}`}</span>
    </div>)}</div>
    {view.lastRound && <div aria-label={`Resolved round ${view.lastRound.roundNumber}`}>
      <span>{choiceLabel(view.lastRound.pick0)} vs {choiceLabel(view.lastRound.pick1)}</span>
      <span>{view.lastRound.tie ? 'Tie' : `${resolveName(view.lastRound.winnerId!)} won the round`}</span>
    </div>}
  </section>;
}
```

Create `DuelActivity.module.css` in this task with the exact classes used above: `stats`, `history`, and `players`, plus later activity classes `activity`, `header`, `board`, `waiting`, `queuePanel`, and `queue`. Use only existing UI-guide tokens. Both board files import this module now, so Task 9 compiles and passes independently before Task 10 adds the host component. Do not import participant modals, participant `GameView`, pick buttons, timers, `HeadToHead`, rematch, or forfeit controls.

- [ ] **Step 5: Run board tests and type-check**

Run: `npm test -- --run src/components/Games/DeathrollSpectatorBoard.test.tsx src/components/Games/RpsSpectatorBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for complete Deathroll state, unresolved RPS privacy, resolved reveal, and absence of actions.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS; each board accepts only its dedicated spectator DTO.

- [ ] **Step 6: Commit spectator boards**

```bash
git add src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx src/Brmble.Web/src/components/Games/DuelActivity.module.css
git commit -m "feat: add read-only duel spectator boards"
```

## Task 10: Replace The Queue Modal With Generic Embedded Duel Activity

**Files:**
- Modify: `docs/UI_GUIDE.md`
- Create: `src/Brmble.Web/src/components/Games/DuelActivity.tsx`
- Modify: `src/Brmble.Web/src/components/Games/DuelActivity.module.css`
- Create: `src/Brmble.Web/src/components/Games/DuelActivity.test.tsx`
- Delete: `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx`
- Delete: `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css`
- Delete: `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`

- [ ] **Step 1: Update the UI guide before implementing the permanent pattern**

Add `Generic Foreground Activity And Duel Spectator Pattern` under Component Patterns with these exact rules:

1. The upper `ChatPanel` area renders exactly one foreground activity; custom game/duel content replaces, never overlays or stacks with, the screen-share grid.
2. Deathroll and RPS participants retain their modal pattern; spectators use dedicated read-only boards and never receive participant view props.
3. The channel swords badge is a keyboard-focusable button whenever project 1's snapshot has `active`, `readyCheck`, or queue entries; activation opens the embedded activity without joining voice or opening a modal.
4. Duel activity always renders complete project-1 active/ready/queue metadata. With no live match it renders a compact waiting state; with a live match it renders the dedicated board above the same queue.
5. Closing the activity is an icon-only `x` button with `Tooltip`, `aria-label="Close duel activity"`, and no native `title`.
6. Foregrounding a game pauses only remote LiveKit screen-share video/audio subscriptions. Watched list, order, focus, quality, room membership, and local broadcast remain unchanged; restoration reconciles shares that ended while hidden.
7. Layout/CSS uses existing tokens, the saved split divider, responsive wrapping, and reduced-motion rules. Verify Classic and Retro Terminal.
8. Arena project 3 consumes the generic `game` foreground descriptor; Arena canvas, controls, realtime connection, and audio are not part of this pattern's project-2 implementation.

- [ ] **Step 2: Write failing complete queue, waiting, board, and close tests**

```tsx
it('renders live board plus complete active ready and ordered queue state', () => {
  render(<DuelActivity snapshot={fullQueueSnapshot()} spectator={deathrollSnapshot(91, 7, 4)} resolveName={nameOf} onClose={vi.fn()} />);
  expect(screen.getByRole('region', { name: 'Deathroll spectator board' })).toBeInTheDocument();
  expect(screen.getByText('Ready check')).toBeInTheDocument();
  expect(screen.getByText('1. Cara vs Dan')).toBeInTheDocument();
  expect(screen.getByText('About 24s')).toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
});

it('renders queue-only waiting state without a board', () => {
  render(<DuelActivity snapshot={queueOnlySnapshot()} spectator={null} resolveName={nameOf} onClose={vi.fn()} />);
  expect(screen.getByText('Waiting for the next duel')).toBeInTheDocument();
  expect(screen.queryByText(/spectator board/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run activity tests and verify the component is missing**

Run: `npm test -- --run src/components/Games/DuelActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because `DuelActivity` does not exist.

- [ ] **Step 4: Implement one generic activity with exhaustive board narrowing**

```tsx
export function DuelActivity({ snapshot, spectator, resolveName, onClose }: Props) {
  const board = spectator?.view.kind === 'deathroll'
    ? <DeathrollSpectatorBoard view={spectator.view} resolveName={resolveName} />
    : spectator?.view.kind === 'rps'
      ? <RpsSpectatorBoard view={spectator.view} resolveName={resolveName} />
      : <div className={styles.waiting}>Waiting for the next duel</div>;

  return <section className={styles.activity} aria-label="Duel activity">
    <header className={styles.header}>
      <div><h2 className="heading-title">Duel activity</h2><span>One match at a time. Accepted pairs play in order.</span></div>
      <Tooltip content="Close duel activity" align="end"><button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Close duel activity"><Icon name="x" /></button></Tooltip>
    </header>
    <div className={styles.board}>{board}</div>
    <section aria-label="Duel queue" className={styles.queuePanel}>
      {renderActive(snapshot.active, resolveName)}
      {renderReady(snapshot.readyCheck, resolveName)}
      <ol>{snapshot.queue.map(entry => <li key={entry.reservationId}>
        <span>{entry.position}. {pairName(entry.players, resolveName)}</span>
        <span>{gameDisplayName(entry.gameType)} · {entry.format}</span>
        <span>{entry.eta.status === 'known' ? `About ${formatDuration(entry.eta.milliseconds!)}` : 'Unknown'}</span>
      </li>)}</ol>
    </section>
  </section>;
}
```

- [ ] **Step 5: Add responsive token-only styling and remove the temporary modal**

Use `--space-*`, `--text-*`, `--bg-*`, `--accent-*`, `--radius-*`, `--font-*`, `--glass-*`, `--shadow-*`, and `--transition-*` only. The board and queue are two columns when space permits and one scrollable column on narrow widths; the activity itself has `min-height: 0` and does not cover chat. Delete all three `DuelQueueModal` files and remove their imports/usages; no compatibility wrapper remains because project 1 was an explicitly temporary stage.

- [ ] **Step 6: Run activity, queue-state, and type tests**

Run: `npm test -- --run src/components/Games/DuelActivity.test.tsx src/components/Games/useDuelQueueState.test.tsx src/components/Games/DeathrollSpectatorBoard.test.tsx src/components/Games/RpsSpectatorBoard.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for board selection, active metadata, ready state, ordered queue, server ETA/Unknown, waiting state, and accessible close.

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS with no `DuelQueueModal` imports.

- [ ] **Step 7: Commit the permanent duel activity pattern**

```bash
git add docs/UI_GUIDE.md src/Brmble.Web/src/components/Games/DuelActivity.tsx src/Brmble.Web/src/components/Games/DuelActivity.module.css src/Brmble.Web/src/components/Games/DuelActivity.test.tsx
git rm src/Brmble.Web/src/components/Games/DuelQueueModal.tsx src/Brmble.Web/src/components/Games/DuelQueueModal.module.css src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx
git commit -m "feat: embed complete duel activity above chat"
```

## Task 11: Wire Badge, Subscription, Foreground, And Media Lifecycles End To End

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`
- Create: `src/Brmble.Web/src/App.spectatorActivity.test.tsx`

- [ ] **Step 1: Write failing badge and App integration tests**

```tsx
it('opens the embedded activity from the accessible badge without joining voice', () => {
  const onOpenDuelActivity = vi.fn();
  const onJoinChannel = vi.fn();
  render(<ChannelTree {...props} duelChannelIds={new Set([7])} onOpenDuelActivity={onOpenDuelActivity} onJoinChannel={onJoinChannel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open duel activity for General' }));
  expect(onOpenDuelActivity).toHaveBeenCalledWith(7);
  expect(onJoinChannel).not.toHaveBeenCalled();
});

it('subscribes to the active match, pauses shares, and restores on close', async () => {
  renderConnectedApp({ queue: activeQueue(7, 91), watchedShares: [aliceShare] });
  await user.click(screen.getByRole('button', { name: 'Open duel activity for General' }));
  expect(api.subscribeSpectator).toHaveBeenCalledWith(91);
  expect(screenShare.setRemotePlaybackPaused).toHaveBeenCalledWith(true);
  expect(screen.getByRole('region', { name: 'Duel activity' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close duel activity' }));
  expect(api.unsubscribeSpectator).toHaveBeenCalled();
  expect(screenShare.setRemotePlaybackPaused).toHaveBeenLastCalledWith(false);
});
```

- [ ] **Step 2: Add failing active-match replacement and channel lifecycle tests**

```tsx
it('switches subscription when queue advancement changes the active match', async () => {
  const app = renderConnectedApp({ queue: activeQueue(7, 91) });
  await app.openDuelActivity();
  act(() => emit('game.queueSnapshot', activeQueue(7, 92, { revision: 12 })));
  await waitFor(() => expect(api.unsubscribeSpectator).toHaveBeenCalled());
  expect(api.subscribeSpectator).toHaveBeenLastCalledWith(92);
});

it('closes and clears restore state on channel leave or voice disconnect', async () => {
  const app = renderConnectedApp({ queue: activeQueue(7, 91), watchedShares: [aliceShare] });
  await app.openDuelActivity();
  act(() => emit('voice.disconnected', {}));
  expect(screen.queryByRole('region', { name: 'Duel activity' })).not.toBeInTheDocument();
  expect(screenShare.setRemotePlaybackPaused).toHaveBeenLastCalledWith(false);
  expect(app.spectator.reset).toHaveBeenCalled();
});
```

- [ ] **Step 3: Run integration tests and verify props/coordinator are absent**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx src/App.spectatorActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: FAIL because the badge callback and App foreground coordination do not exist.

- [ ] **Step 4: Keep the project-1 badge location and make its action permanent**

```tsx
interface ChannelTreeProps {
  // Existing props remain.
  onOpenDuelActivity?: (channelId: number) => void;
}

<Tooltip content="Open duel activity">
  <button
    type="button"
    className="channel-duel-icon"
    aria-label={`Open duel activity for ${channel.name}`}
    onClick={event => { event.stopPropagation(); onOpenDuelActivity?.(channel.id); }}
  >
    <Icon name="swords" size={12} />
  </button>
</Tooltip>
```

Retain its placement beside the access-lock icon and project 1's snapshot-derived `duelChannelIds`. Do not call `onJoinChannel`, create a second badge, or use a passive span.

- [ ] **Step 5: Coordinate queue and spectator state from one foreground descriptor**

```tsx
const spectator = useSpectatorState();
const foreground = useForegroundActivity();
const openDuelActivity = useCallback((channelId: number) => {
  const queue = duelQueue.byChannel.get(channelId);
  if (!queue || (!queue.active && !queue.readyCheck && queue.queue.length === 0)) return;
  handleSelectChannel(channelId);
  foreground.open({ kind: 'duel', channelId, matchId: queue.active?.matchId ?? null });
}, [duelQueue.byChannel, foreground.open, handleSelectChannel]);
```

- [ ] **Step 6: Synchronize active match subscription and remote media**

```tsx
useEffect(() => {
  const activity = foreground.activity;
  if (!activity) {
    void screenShare.setRemotePlaybackPaused(false);
    return;
  }
  void screenShare.setRemotePlaybackPaused(true);
  if (activity.kind !== 'duel') return;
  const active = duelQueue.byChannel.get(activity.channelId)?.active ?? null;
  if (active?.matchId === activity.matchId) {
    if (active.matchId != null) void spectator.subscribe(active.matchId);
    return;
  }
  foreground.open({ ...activity, matchId: active?.matchId ?? null });
  if (active) void spectator.subscribe(active.matchId);
  else void spectator.unsubscribe();
}, [foreground.activity, duelQueue.byChannel]);
```

Use stable callbacks/refs to avoid effect loops. Closing calls `await spectator.unsubscribe()`, then `foreground.close()`; the foreground effect restores remote media. If subscribe returns `matchNotLive`, keep queue-only activity open and request a fresh project-1 queue snapshot. `game.spectatorClosed` for match end is followed by the next queue revision; show waiting state until the next active match appears.

- [ ] **Step 7: Render the activity only in channel ChatPanel and clear it on lifecycle changes**

```tsx
const duelActivity = foreground.activity?.kind === 'duel'
  ? <DuelActivity
      snapshot={duelQueue.byChannel.get(foreground.activity.channelId) ?? idleQueueSnapshot(foreground.activity.channelId)}
      spectator={spectator.snapshot}
      resolveName={resolveGamePlayerName}
      onClose={closeForegroundActivity}
    />
  : undefined;

<ChatPanel
  {...channelProps}
  foregroundActivity={duelActivity}
  foregroundActivityLabel={duelActivity ? 'Duel activity' : undefined}
  {...screenShareViewerProps}
/>
```

DM `ChatPanel` receives no duel activity. Before `handleJoinChannel` changes voice channel, close/unsubscribe and restore. On `voice.disconnected`, call `foreground.reset()`, `spectator.reset()`, `duelQueue.reset()`, and `setRemotePlaybackPaused(false)`. A queue snapshot becoming fully idle automatically closes a matching duel foreground. Local Deathroll/RPS participant modals remain untouched and can coexist over the app exactly as project 1 specifies.

- [ ] **Step 8: Run all end-to-end web behavior tests**

Run: `npm test -- --run src/components/Sidebar/ChannelTree.test.tsx src/components/Games/useSpectatorState.test.tsx src/components/Games/DuelActivity.test.tsx src/components/ChatPanel/ChatPanel.test.tsx src/hooks/useScreenShare.test.ts src/App.spectatorActivity.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS for accessible opening, no channel join, queue-only/live switching, explicit subscribe/unsubscribe, stale sequences, exactly one foreground, pause/restore, active replacement, and disconnect/leave cleanup.

- [ ] **Step 9: Type-check and build the integrated frontend**

Run: `npm run type-check`

Working directory: `src/Brmble.Web`

Expected: PASS.

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with a Vite production bundle and no temporary queue-modal import.

- [ ] **Step 10: Commit end-to-end project 2 UI wiring**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.spectatorActivity.test.tsx
git commit -m "feat: coordinate duel foreground spectator activity"
```

## Task 12: Final Verification And Two-Spec Self-Review

**Files:**
- Modify only if verification exposes a project-2 defect: files already listed in Tasks 1-11

- [ ] **Step 1: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS with zero failed tests, including project-1 orchestration and project-2 privacy/lifecycle contracts.

- [ ] **Step 2: Run all native client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS with zero failed tests and unchanged generic `game.*` forwarding.

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

- [ ] **Step 5: Repeat privacy, stale-sequence, and lifecycle tests**

Run:

```powershell
1..50 | ForEach-Object {
    dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~SpectatorViewContractTests|FullyQualifiedName~SpectatorServiceTests"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

Expected: PASS on all 50 runs; unresolved RPS throws never serialize, stale/equal sequences never republish, and removed subscribers never receive later frames.

- [ ] **Step 6: Perform a three-client manual spectator and media check**

Run: `dotnet run --project src/Brmble.Server`

Run in a second terminal: `npm run dev`

Working directory: `src/Brmble.Web`

Run in three additional terminals: `dotnet run --project src/Brmble.Client`

Verify: two clients play Deathroll then RPS; the third same-channel client opens the swords badge and sees a fresh board plus complete queue; an out-of-channel client is rejected; closing stops updates; reopening gets current state; RPS shows commitment only before resolution and both throws afterward; queue-only/ready-only state remains useful; keyboard activation and close work; channel leave/disconnect closes activity.

Verify with two remote shares watched before opening: watched order, focused tile, per-share quality, and LiveKit room remain; hidden remote video and screen audio stop; local broadcast continues; closing restores surviving shares; a share ended while hidden is absent after restoration and focus is reconciled. Repeat in Classic and Retro Terminal at desktop and narrow window widths.

Expected: all automated contracts match observed behavior; chat remains available below exactly one upper activity and participant Deathroll/RPS modals remain unchanged.

- [ ] **Step 7: Confirm Arena remains outside project 2 while interfaces are usable**

Inspect: `ISpectatorCoordinator`, `SpectatorMatchDescriptor`, `SpectatorTransport`, `SpectatorAuthorizationResult`, `SpectatorSourceFrame`, `SpectatorSnapshot`, `ForegroundActivity`, `ForegroundActivityController`, and `setRemotePlaybackPaused`.

Expected: a project-3 realtime coordinator registers a `DedicatedRealtime` match, calls `AuthorizeAsync` for participant/spectator ticket roles, and opens `{ kind: 'game', gameType: 'arena-knockoff', role }` without changing authorization lifecycle, ChatPanel ownership, or LiveKit pause/restoration. Its 20 Hz frames bypass `SpectatorService` publication, `IGameEventPublisher`, Brmble `/ws`, and NativeBridge. No Arena physics, tickets, sockets, canvas, controls, prediction, interpolation, game audio, or telemetry exists in project-2 files.

- [ ] **Step 8: Confirm verification did not leave uncommitted project-2 changes**

Run: `git status --short`

Expected: no project-2 production or test files are modified. If verification exposes a defect, return to the owning task, add a failing regression test, run that task's fail/pass commands, use its explicit commit boundary, then repeat Task 12. Leave unrelated workspace files untouched.

## Specification Coverage Matrix And Self-Review

| Requirement | Plan coverage | Decision / evidence |
|---|---|---|
| Project 1 prerequisite and exact contracts | Header, File Structure, Tasks 2, 10-11 | Reuses `DuelConfiguration`, `DuelPlayerSnapshot`, `DuelQueueSnapshot`, active `matchId`, revisions, ETAs, and actionable badge; does not recreate orchestration. |
| Same-channel spectator authorization | Tasks 3-5 | Server resolves authenticated stable user/current session, performs optimistic validation, then serializes current-match/presence re-read with insertion. |
| Subscribe versus end/move linearizability | Tasks 3-4 | One transition semaphore protects current matches and subscriptions; tests block initial validation while completion/move wins, then verify insertion is rejected. |
| Explicit subscribe/unsubscribe | Tasks 3, 5-6, 11 | Correlated initial subscribe response, explicit close/replacement unsubscribe, no automatic channel-wide board stream. |
| Fresh complete snapshot on subscribe/reopen | Tasks 2-3, 5-6 | Source caches latest immutable frame; subscribe returns it directly; reconnect requires fresh explicit call. |
| Complete sequence-numbered replacements | Tasks 2-3, 6 | Per-match sequence is incremented under runtime lock; server and web reject stale/equal values. |
| Subscriber-only updates and unsubscribe ordering | Task 3 | Per-subscription generations and delivery gates recheck immediately before targeted send; completed removal prevents stale later publication. |
| Cleanup on close, move, disconnect, completion, channel removal | Task 4, Task 11 | One lifecycle interface removes before membership destruction; terminal event and final WebSocket close force explicit recovery. |
| Revalidate authorization after membership change | Tasks 3-4 | Callback runs before channel update/removal, writes service-owned session epoch/channel state, and removes old-channel subscriptions; insertion rechecks that state. |
| Spectators cannot act, ready, or affect timers | Tasks 3, 5, 9 | Service exposes state only; boards contain no controls; existing participant/action endpoints retain participant checks. |
| Dedicated views, no participant reuse | Tasks 1, 9 | Required engine `SpectatorView`; board props accept spectator DTOs only. |
| Deathroll complete board/current turn/ceiling/last roll/history | Tasks 1, 9 | Engine retains ordered roll records and dedicated board renders every required field. |
| RPS score/commitment privacy | Tasks 1, 6, 9, 12 | Dedicated `committed` booleans; unresolved contract serializes no throws; resolved throws only in `lastRound`. |
| Contract test for unresolved RPS privacy | Task 1, Task 12 | Serialized JSON assertions and 50-run final repetition. |
| Contract test for stale sequences | Tasks 3, 6, 12 | Server fan-out and React replacement both reject equal/older sequences. |
| Pending client subscribe close/replacement | Task 6 | Serialized request chain, operation generations, and compensating unsubscribe prevent leaked or resurrected server subscriptions. |
| Structured API reasons on fetch and WebView | Tasks 5-6 | Real endpoint tests assert codes; native `games.response.reason` and `GameApiError` preserve them end to end. |
| Badge actionable for active/ready/queue state | Tasks 10-11 | Project-1 snapshot-derived IDs and accessible button retained; no voice join side effect. |
| Board plus complete queue/ready state | Task 10 | One activity renders dedicated board, active metadata, ready state, full ordered queue, formats, positions, ETAs, and Unknown. |
| Queue-only/ready-only waiting state | Tasks 10-11 | Same embedded activity stays useful without active match or spectator subscription. |
| Upper ChatPanel, chat retained below, not modal | Tasks 7, 10-11 | Generic slot uses existing split/divider and deletes the temporary modal. |
| Exactly one foreground activity | Tasks 7, 11 | One descriptor replaces atomically; custom foreground excludes screen grid in DOM. |
| Deathroll/RPS participant modals remain | Tasks 9, 11 | Dedicated spectator boards do not modify participant modal behavior from project 1. |
| Hidden remote video and audio subscriptions paused | Task 8, Task 11 | Calls `setSubscribed(false)` for screen video/audio and suppresses intentional unsubscribe cleanup. |
| Preserve watched list/order, focus, quality | Task 8 | Pause never mutates logical maps; restoration reapplies quality and only removes ended shares. |
| Preserve LiveKit room membership | Task 8 | Watched state remains non-empty and pause never calls room disconnect. |
| Preserve local broadcast | Task 8 | Remote-publication iteration excludes local participant; test asserts local screen publication remains enabled. |
| Ended-share reconciliation while hidden | Task 8 | `screenShare.stopped` removes immediately; restore also compares watched keys with authoritative active shares. |
| LiveKit delayed events, recapture SIDs, rapid toggles | Task 8 | Serialized pause generations stamp each publication SID; new publications immediately unsubscribe and stale callbacks cannot undo the latest target. |
| Leaving channel clears activity/restore state | Tasks 4, 8, 11 | App closes before join/move; server removes subscription; pause state restores/clears. |
| UI guide updated with permanent pattern | Task 10 | Documents foreground arbitration, accessible badge/close, board privacy, queue, and media semantics before UI implementation. |
| Stable spectator interface for Arena | Stable Contracts, Tasks 2-3, 7, 12 | Project 3 registers lifecycle metadata and requests role authorization, then uses dedicated realtime transport and the shared `game` descriptor. |
| Stable participant/spectator foreground role | Stable Contracts, Task 7 | `role: 'participant' | 'spectator'` is explicit for Arena's future embedded board. |
| Arena spectator public fields | Explicitly outside project 2 | Positions, velocities, aim, charge, cooldown, projectiles, arena/phase/score timing are produced and transported by Arena project 3. |
| Arena 20 Hz transport isolation | Stable Contracts, Tasks 3, 12 | Continuous descriptors cannot enter `PublishDiscreteFrameAsync`; no Arena frame uses event bus, NativeBridge, or `game.spectatorSnapshot`. |
| Arena continuous simulation/runtime | Explicitly outside project 2 | No fixed-step scheduler, input sequencing, ticket issuance, dedicated WebSocket implementation, reconnect grace, or completion runner is added. |
| Arena rendering/input/audio/telemetry | Explicitly outside project 2 | No Canvas, prediction, interpolation, controls, Web Audio, settings, rules, balancing, or telemetry changes. |
| Existing ephemeral feed remains | All tasks | `game.feed` channel broadcasts are unchanged; structured spectator traffic is separate and subscriber-only. |

Self-review results:

- Both approved specs were checked section by section. Every framework project-2 requirement maps to a task above; the Arena spec contributes only stable source/foreground seams and remains project 3 for all game-specific behavior.
- Project 1 is explicitly required and its names retain one meaning: queue `revision` is channel orchestration ordering, spectator `sequence` is per-match complete-board ordering, and neither substitutes for the other.
- Privacy is enforced at the engine contract and serialized contract-test boundary, not by deleting fields in React. RPS current picks never enter a spectator object.
- Subscription insertion is linearized with current-match end and presence transitions. Optimistic validation is followed by a serialized current-match/service-owned authorization-epoch re-read, closing the callback-before-membership-write gap; delivery gates plus generations make unsubscribe versus fan-out ordering testable.
- Client operations are also serialized: pending subscribe responses cannot overwrite replacement/close intent, and a superseded successful subscribe is compensated before a later subscribe proceeds.
- Foreground activity and media pause are independent: descriptor state controls visibility, while LiveKit state preserves logical viewing and local publishing. This separation is the stable seam Arena uses.
- Arena uses `SpectatorService` only for current-match/role authorization and lifecycle. Continuous 20 Hz frames remain exclusively on project 3's dedicated realtime transport; only low-frequency discrete Deathroll/RPS frames use subscriber-targeted event-bus messages.
- Type consistency was checked for project-1 `IDuelMatchRunner`, `GameStartResult`, and `MatchCompletion`, plus project-2 `ISpectatorCoordinator`, `SpectatorMatchDescriptor`, `SpectatorTransport`, `SpectatorSourceFrame`, `SpectatorSnapshot`, `SpectatorCloseReason`, `matchId`, `channelId`, `sequence`, `ForegroundActivity`, and `setRemotePlaybackPaused`.
- Placeholder scan was checked: every implementation step includes exact paths, signatures, payloads, commands, expected outcomes, and commit boundaries; no unspecified error-handling or testing step remains.
- Main server risk: raising spectator callbacks while holding the match lock could deadlock or stall actions. Task 2 captures immutable frames under lock and invokes subscribers only after release.
- Main privacy risk: a future discrete engine could return a participant DTO. The mandatory `SpectatorView` contract makes the boundary explicit; each future game still requires its own serialized privacy contract, while continuous views never use this wire DTO.
- Main media risk: LiveKit emits delayed `TrackUnsubscribed` and recapture can replace publication SIDs. Task 8 serializes target generations, stamps old/new SIDs, and retains separate authoritative `screenShare.stopped` reconciliation.
- UI transition risk: deleting the temporary project-1 queue modal is intentional and requires project 1 to be complete first. `DuelActivity` provides all modal metadata plus the approved embedded board, so no compatibility wrapper is justified.
