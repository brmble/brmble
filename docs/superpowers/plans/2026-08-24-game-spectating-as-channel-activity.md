# Game Spectating As A Channel Activity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a channel member watch a live minigame they are not playing, as a third chip (`'spectate'`, labelled `Game`) in the channel activity region.

**Architecture:** The server gains a channel-scoped `SpectatorService`: you subscribe to a *channel*, not a match, and keep receiving frames match after match until you unsubscribe, move channel, or disconnect. `IGameEngine` gains a `SpectatorView(object state)` member with **no default implementation**, so a new engine cannot compile without deciding what a spectator may see. `GameSessionManager` captures a frame under `match.Lock` after every mutation and publishes it outside the lock through the existing `OutboundTail` chain. On the client, a `useSpectatorState` hook feeds a `SpectatorActivity` stage host with three states (Live / Ended / Idle) rendered inside the existing `ChannelActivityRegion`.

**Tech Stack:** ASP.NET Core minimal APIs, MSTest + Moq + `WebApplicationFactory<Program>` (server tests); React 19 + TypeScript + Vite, Vitest + @testing-library/react (client tests); WebView2 native bridge (`src/Brmble.Client`).

**Spec:** `docs/superpowers/specs/2026-08-24-game-spectating-as-channel-activity-design.md` — approved, complete, and final. Read it before Task 1. Its "Decisions recorded" table is not re-openable.

**Branch:** `feature/game-spectating` (already created, one commit `9334de30`). Do not commit to `main`. Do not push or open a PR without asking.

---

## Global Constraints

- **One PR, strictly ordered internally.** Server contracts + tests green first, then endpoints and lifecycle, then the `*Modal` → `*Board` renames, then the exhaustive-switch fix, then the chip, stage and boards.
- **Hard ordering constraint:** Task 12 (label map + `assertNever`) MUST land before Task 13 (`'spectate'` joins `ChannelActivityKind`). Merged together, the compiler catches nothing and the new chip silently renders as "Paint".
- **`docs/superpowers/plans/2026-07-25-generic-spectator-and-foreground-activity.md` must NOT be executed as written.** Its server half is a useful *reference* only. Its client half is dead: `useForegroundActivity` and `ForegroundActivity` do not exist and will not be created.
- **Spectating never sets `MainPanelMode = 'game'`.** `'game'` means *participating* (`docs/UI_GUIDE.md:245`). The activity kind is `'spectate'`; the user-facing chip label is `Game`.
- **Never infer a spectator view from a participant view.** `SpectatorView` has no default implementation for exactly this reason.
- **No history in spectator views.** `game.feed` already carries every roll. Do not add mutable history state to either engine.
- **Fan-out is opt-in only.** `PublishDiscreteFrameAsync` targets subscribers **minus `frame.ParticipantUserIds`** via `IGameEventPublisher.PublishToUsersAsync`. Never `PublishToChannelAsync`.
- **Invariant to test:** a participant of match M never receives a spectator frame for match M.
- **No collapse / minimise / maximise affordance**, for any activity kind. Out of scope.
- **No hardcoded visual values** in any CSS or UI code. Use existing tokens only. See `docs/UI_GUIDE.md` and `src/Brmble.Web/src/themes/_template.css`.
- **Do not create a toast system.** Not needed here; no new notifications are in scope.
- **Out of scope:** queue-in-panel, swords-badge redesign, region collapse, per-game history, cross-channel spectating, a launchable card on `game.feed` lines, Arena Knockoff, bounding `NativeBridge._pendingMessages`.
- Server tests are **MSTest** (`[TestClass]` / `[TestMethod]` / `Assert.AreEqual`) with **Moq**, not xUnit.
- Wire JSON is camelCased by `BrmbleEventBus.JsonOptions` (`src/Brmble.Server/Events/BrmbleEventBus.cs:17`). Wire records are declared PascalCase.

---

## Verified Reference Map

Every line number below was verified against the working tree at commit `9334de30`. **Several references quoted in the design doc and in older plans are stale — the list below supersedes them.** Verify again before editing if earlier tasks have shifted a file.

### Server

| Thing | Location |
|---|---|
| `IGameEngine` | `src/Brmble.Server/Games/IGameEngine.cs:21-91` |
| `GamePlayer(long UserId)` | `src/Brmble.Server/Games/IGameEngine.cs:7` |
| `GameOutcome` / `.Finished` | `src/Brmble.Server/Games/IGameEngine.cs:13-19` |
| `IGameEventPublisher` | **`src/Brmble.Server/Games/GameSessionManager.cs:8-12`** (not in `Events/`) |
| `IGamePresence.TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)` | `src/Brmble.Server/Games/GameSessionManager.cs:19` |
| `EventBusGameEventPublisher` | `src/Brmble.Server/Games/EventBusGameEventPublisher.cs:11-15` |
| `BrmbleEventBus.BroadcastToUsersAsync` | `src/Brmble.Server/Events/BrmbleEventBus.cs:316-327` (the publisher-side name is `PublishToUsersAsync`) |
| `BrmbleEventBus.BroadcastToChannelAsync` | `src/Brmble.Server/Events/BrmbleEventBus.cs:255-275` |
| `BrmbleEventBus.HasConnectedClient` / `RemoveClient` | `:216` / `:68-70` |
| `LiveMatch` (a **class**, not a record) | `src/Brmble.Server/Games/GameSessionManager.cs:98-121` |
| `match.OutboundTail` / `match.Lock` | `GameSessionManager.cs:119` / `:120` |
| `EnqueueOutbound` | `GameSessionManager.cs:243-248` |
| `RouteSet(match)` | `GameSessionManager.cs:265-268` |
| Match start (enqueue at `:186`, await at `:210`) | `GameSessionManager.cs:175-230` |
| `ActionAsync` | `GameSessionManager.cs:280-354` (enqueue `:328`, await `:353`) |
| `HandleTurnTimeoutAsync` | `GameSessionManager.cs:370-427` (enqueue `:401`, await `:426`) |
| `CompleteMatchAsync` | `GameSessionManager.cs:429-497` |
| `ForfeitPlayerAsync` / `PublishForfeitAsync` | `GameSessionManager.cs:520-537` / `:539-591` |
| `PublishFeedAsync` (`game.feed`) | `GameSessionManager.cs:630-638` |
| `NameOf(match, sessionId)` | `GameSessionManager.cs:594` |
| `FireTurnTimeoutForTestAsync` | `GameSessionManager.cs:273-278` |
| `DeathrollEngine.State` / `PublicView` | `src/Brmble.Server/Games/Engines/DeathrollEngine.cs:21-31` / `:136-148` |
| `RpsEngine.State` / `LastRound` / `PublicView` | `src/Brmble.Server/Games/Engines/RpsEngine.cs:45-60` / `:66` / `:252-281` |
| `DuelConfiguration` | `src/Brmble.Server/Games/Duels/DuelModels.cs:3-8` |
| `DuelPlayerSnapshot(long UserId, long SessionId, string DisplayName, bool Ready = false)` | `src/Brmble.Server/Games/Duels/DuelModels.cs:92` |
| `DuelPlayer(long SessionId, long UserId, string DisplayName)` | `DuelModels.cs:19` |
| `GameErrorWire(string Error, string Reason)` | **`src/Brmble.Server/Games/Duels/DuelWire.cs:203`** |
| `DuelWire.Reason(DuelRejectReason)` | `DuelWire.cs` (used at `GameEndpoints.cs:138`) |
| `GameQueueSnapshotEvent` construction (wire-event pattern to copy) | `DuelWire.cs:41-55` |
| `GameEndpoints.MapGameEndpoints` | `src/Brmble.Server/Games/GameEndpoints.cs:20-184` |
| `ResolveUserAsync` cert-hash pattern | `GameEndpoints.cs:222-235` |
| `POST /games/action` (no guard, no null check) | `GameEndpoints.cs:112-122` |
| `POST /games/forfeit` ownership guard (the pattern to copy) | `GameEndpoints.cs:124-140`, guard at `:132` |
| `AddGames()` DI | `src/Brmble.Server/Games/GamesExtensions.cs:8-40` |
| `MumbleServerCallback.DispatchUserDisconnected` | `src/Brmble.Server/Mumble/MumbleServerCallback.cs:167-219` (`_channelMembership.Remove` at `:205`) |
| `MumbleServerCallback.DispatchUserStateChanged` | `MumbleServerCallback.cs:221-256` (`_channelMembership.Update` at `:237`) |
| `MumbleServerCallback.DispatchChannelRemoved` | `MumbleServerCallback.cs:261-265` |
| `TryNotifyDuelsAsync` error wrapper | `MumbleServerCallback.cs:267-277` |
| `BrmbleWebSocketHandler` socket-close `finally` | `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs:127-132` |
| Test harness (`BrmbleServerFactory`) | `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` |
| Endpoint test factory pattern | `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs:304-327` |
| Manager test fakes (`ManagerPublisher` etc.) | `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs:10-71` |

### Client

| Thing | Location |
|---|---|
| `ChannelActivityKind` / `selectStage` | `src/Brmble.Web/src/workspace/channelActivity.ts:1` / `:3-12` |
| `ChannelActivityRegion` | `src/Brmble.Web/src/components/ChannelActivityRegion/ChannelActivityRegion.tsx` |
| `MainPanelMode` / `selectMainPanelMode` | `src/Brmble.Web/src/workspace/mainPanelMode.ts:1` / `:3-8` |
| `availableActivities` | `src/Brmble.Web/src/App.tsx:4986-4991` |
| `explicitActivity` / `stage` | `App.tsx:4993-5000` |
| Region gate | `App.tsx:5116-5118` |
| Chip label ternary (**to be replaced**) | `App.tsx:5125` |
| Stage-body ternary chain (**to be replaced**) | `App.tsx:5130-5151` |
| `handleWatchScreenShare` | `App.tsx:4729-4747` |
| `duelChannelIds` / `personalDuelChannelIds` | `App.tsx:1120-1133` |
| `duelQueue = useDuelQueueState()` | `App.tsx:1076` |
| `resolveGamePlayerName` | `App.tsx:1083` |
| `selectedDuelChannelId` / `selectedDuelSnapshot` | `App.tsx:1158` / `:1159` |
| `<DuelQueueModal>` render site | `App.tsx:5436-5442` |
| `useDuelQueueState` guard block (the pattern to copy) | `src/Brmble.Web/src/components/Games/useDuelQueueState.ts:101-124` |
| `voice.connected` / `voice.channelChanged` handlers | `useDuelQueueState.ts:187-202` / `:203-223` |
| Bridge singleton (`bridge.on` / `off` / `send`) | `src/Brmble.Web/src/bridge.ts` |
| `bridgeRequest` request/response tunnel | `src/Brmble.Web/src/api/games.ts:292-333` |
| `DuelQueueSnapshot` / `DuelPlayer` / `ActiveDuel` / `ReadyCheck` types | `api/games.ts:111-121` / `:47-52` / `:78-88` / `:90-98` |
| `GameApiError` / `toGameApiError` | `api/games.ts:132-139` / `:146-161` |
| `DuelQueueModal` | `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx` (active card `:95-108`) |
| `DeathrollModal` | `src/Brmble.Web/src/components/Games/DeathrollModal.tsx` |
| `RpsModal` | `src/Brmble.Web/src/components/Games/RpsModal.tsx` |
| `GameService.RegisterHandlers` / `HandleRequestAsync` | `src/Brmble.Client/Services/Games/GameService.cs:50-60` / `:69-164` |
| `MumbleAdapter` `game.*` verbatim forwarding | `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2748-2757` |
| Vitest config | `src/Brmble.Web/vite.config.ts:44-48` |
| Duel hook test harness (the pattern to copy) | `src/Brmble.Web/src/components/Games/duelTestHarness.ts` |

---

## Three Facts The Spec Does Not State

These were discovered while verifying the spec against the code. None of them change a recorded decision; they are implementation constraints the executor must know.

**1. Engine view player ids are Mumble *session* ids, not db user ids.**
`GameSessionManager.cs:141` seeds engines with `new GamePlayer(reservation.PlayerOne.SessionId)`. So `DeathrollEngine.State.Players`, `RpsEngine.State.Players`, `LoserId`, `WinnerId` and `LastRound.WinnerId` are all **session ids**. Meanwhile `SpectatorSnapshot.Players` is `IReadOnlyList<DuelPlayerSnapshot>`, which carries both `UserId` and `SessionId`.

**Decision: keep session ids. Do not add a translation step.** Two reasons:

- `SpectatorView(object state)` returns `object`, and `GameSessionManager` deliberately cannot inspect its shape — that opacity is what makes the spectator half game-agnostic. Translating ids would require either passing a translation function into `SpectatorView` or handing every engine the `SessionToUser` map, pushing per-match routing knowledge into engines that currently have none.
- The rest of the games client is already uniformly session-keyed: `game.ended` carries `winnerId` as a session id in both the completion path (`GameSessionManager.cs:471` comment) and the forfeit path (`:580`), `DeathrollBoard`'s `myUserId` prop is compared against `view.currentPlayer`, and `HeadToHead` takes `opponentSession`. Making spectator views the one user-id-keyed surface would be the actual inconsistency.

The client joins view ids against `players[].sessionId`, which is why `DuelPlayerSnapshot` must keep carrying both. Every spectator-view record field holding a player id must be commented `// Mumble session id`, and Task 5 has an invariant test (`Spectator_ViewPlayerIdsAreSessionIdsThatJoinToTheSnapshotPlayers`) that fails if a future engine leaks db user ids into a view.

The wire shapes in the spec are unchanged by this.

**2. `POST /games/spectators/subscribe` returns a body, so it cannot use the fire-and-forget bridge path.**
`GameService.RegisterHandlers` (`GameService.cs:52-58`) POSTs and discards the body. Anything that needs a response goes through the `games.request` → `games.response` correlation tunnel (`GameService.cs:69-164`, `api/games.ts:292-333`). Subscribe therefore needs new `spectate-subscribe` / `spectate-unsubscribe` cases in `HandleRequestAsync`. Inbound `game.spectator*` events need **no** client change — `MumbleAdapter.cs:2752` prefix-forwards any `game.*` verbatim.

**3. `.deathroll-modal` and `.rps-modal` are not defined in any stylesheet.**
Full-repo search finds them only as `className` strings (`DeathrollModal.tsx:83`, `RpsModal.tsx:182`). All real styling comes from the colocated `*.module.css` via `styles.modal`. The spec's "CSS classes `.deathroll-modal` → `.deathroll-board`" is therefore a className-string edit only — there is no stylesheet rule to rename.

---

## File Structure

### Created — server

| File | Responsibility |
|---|---|
| `src/Brmble.Server/Games/Spectators/SpectatorModels.cs` | Enums, `SpectatorSourceFrame`, `SpectatorSnapshot`, `SpectatorSubscribeResult`, `SpectatorMatchDescriptor`, `SpectatorAuthorizationResult`, `ISpectatorCoordinator`, `ISpectatorLifecycle` |
| `src/Brmble.Server/Games/Spectators/SpectatorWire.cs` | The three wire event records |
| `src/Brmble.Server/Games/Spectators/SpectatorService.cs` | The registry, fan-out, sequence gating, lifecycle teardown |
| `src/Brmble.Server/Games/Spectators/SpectatorViews.cs` | `DeathrollSpectatorView`, `RpsResolvedRoundSnapshot`, `RpsSpectatorView` |

### Created — client

| File | Responsibility |
|---|---|
| `src/Brmble.Web/src/utils/assertNever.ts` | Exhaustiveness helper |
| `src/Brmble.Web/src/components/Games/useSpectatorState.ts` | Subscription + frame gating + close reasons |
| `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx` + `.module.css` | Stage host: Live / Ended / Idle + Stop watching |
| `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx` + `.module.css` | Read-only Deathroll board |
| `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx` + `.module.css` | Read-only RPS board |
| `src/Brmble.Web/src/components/Games/spectatorTestHarness.ts` | Fake bridge + api mocks for spectator tests |

### Renamed — client

`DeathrollModal.tsx` → `DeathrollBoard.tsx`, `DeathrollModal.module.css` → `DeathrollBoard.module.css`, `RpsModal.tsx` → `RpsBoard.tsx`, `RpsModal.module.css` → `RpsBoard.module.css`.

### Modified

Server: `IGameEngine.cs`, `DeathrollEngine.cs`, `RpsEngine.cs`, `GameSessionManager.cs`, `GameEndpoints.cs`, `GamesExtensions.cs`, `MumbleServerCallback.cs`, `BrmbleWebSocketHandler.cs`.
Client: `channelActivity.ts`, `App.tsx`, `api/games.ts`, `DuelQueueModal.tsx`, `Brmble.Client/Services/Games/GameService.cs`.
Docs: `docs/UI_GUIDE.md`.

---

## Task Order

| # | Task | Gate |
|---|---|---|
| 1 | `SpectatorView` on `IGameEngine` + the two view records | Server contracts |
| 2 | Spectator contract types and wire records | Server contracts |
| 3 | `SpectatorService` registry, fan-out, sequence gating | Server contracts |
| 4 | `ISpectatorLifecycle` teardown + close events | Server contracts |
| 5 | `GameSessionManager` frame capture + `EndMatchAsync` | Lifecycle |
| 6 | Subscribe / unsubscribe endpoints + DI | Endpoints |
| 7 | Lifecycle call sites (`MumbleServerCallback`, `BrmbleWebSocketHandler`) | Endpoints |
| 8 | `/games/action` ownership guard | Endpoints |
| 9 | Client transport: `api/games.ts` + `GameService.cs` | Client |
| 10 | Rename `DeathrollModal` → `DeathrollBoard` | Renames |
| 11 | Rename `RpsModal` → `RpsBoard` | Renames |
| 12 | **`assertNever` + label map + stage switch** (must precede Task 13) | Switch fix |
| 13 | `'spectate'` joins `ChannelActivityKind` | Chip |
| 14 | `useSpectatorState` | Stage |
| 15 | `DeathrollSpectatorBoard` | Boards |
| 16 | `RpsSpectatorBoard` | Boards |
| 17 | `SpectatorActivity` | Stage |
| 18 | `DuelQueueModal` Watch button | Entry point |
| 19 | App wiring + integration tests | Chip |
| 20 | `docs/UI_GUIDE.md` | Docs |

---

### Task 1: `SpectatorView` on `IGameEngine`, and the two view records

**Files:**
- Create: `src/Brmble.Server/Games/Spectators/SpectatorViews.cs`
- Modify: `src/Brmble.Server/Games/IGameEngine.cs` (add member after `PublicView` at `:59`)
- Modify: `src/Brmble.Server/Games/Engines/DeathrollEngine.cs` (add after `PublicView`, `:136-148`)
- Modify: `src/Brmble.Server/Games/Engines/RpsEngine.cs` (add after `PublicView`, `:252-281`)
- Test: `tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `object IGameEngine.SpectatorView(object state)` — **no default implementation**.
  - `sealed record DeathrollSpectatorView(string Kind, IReadOnlyList<long> Players, long? CurrentPlayer, int Ceiling, int? LastRoll, bool Finished, long? LoserId)`
  - `sealed record RpsResolvedRoundSnapshot(int RoundNumber, int Sequence, string Pick0, string Pick1, long? WinnerId, bool Tie)`
  - `sealed record RpsSpectatorView(string Kind, IReadOnlyList<long> Players, int BestOf, int TargetWins, int RoundNumber, IReadOnlyList<int> RoundWins, IReadOnlyList<bool> Committed, bool Finished, long? WinnerId, RpsResolvedRoundSnapshot? LastRound)`
  - All player-id fields carry Mumble **session** ids (see Fact 1).

- [ ] **Step 1: Write the failing contract test**

Create `tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs`:

```csharp
using System.Text.Json;
using Brmble.Server.Games;
using Brmble.Server.Games.Engines;
using Brmble.Server.Games.Spectators;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class SpectatorViewTests
{
    private static readonly JsonSerializerOptions Wire =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static object RpsStateWithOneCommit()
    {
        var engine = new RpsEngine();
        var state = engine.InitialState(
            [new GamePlayer(10), new GamePlayer(20)],
            new FixedRandom(1),
            new Dictionary<string, object?> { ["bestOf"] = 3 });
        engine.ApplyAction(state, 10, new Dictionary<string, object?> { ["pick"] = "rock" }, new FixedRandom(1));
        return state;
    }

    [TestMethod]
    public void RpsSpectatorView_UnresolvedRound_LeaksNoThrowValue()
    {
        var engine = new RpsEngine();
        var view = (RpsSpectatorView)engine.SpectatorView(RpsStateWithOneCommit());

        Assert.IsNull(view.LastRound, "No round has resolved yet.");
        CollectionAssert.AreEqual(new[] { true, false }, view.Committed.ToArray());

        var json = JsonSerializer.Serialize(view, Wire).ToLowerInvariant();
        foreach (var leak in new[] { "rock", "paper", "scissors", "mypick", "opponentpicked", "\"picks\"", "pick0", "pick1" })
            Assert.IsFalse(json.Contains(leak), $"Unresolved RPS spectator view leaked '{leak}': {json}");
    }

    [TestMethod]
    public void RpsSpectatorView_ResolvedRound_RevealsBothThrowsInLastRoundOnly()
    {
        var engine = new RpsEngine();
        var state = RpsStateWithOneCommit();
        engine.ApplyAction(state, 20, new Dictionary<string, object?> { ["pick"] = "scissors" }, new FixedRandom(1));

        var view = (RpsSpectatorView)engine.SpectatorView(state);
        Assert.IsNotNull(view.LastRound);
        Assert.AreEqual("rock", view.LastRound!.Pick0);
        Assert.AreEqual("scissors", view.LastRound.Pick1);
        Assert.AreEqual(10L, view.LastRound.WinnerId);
        Assert.IsFalse(view.LastRound.Tie);
        CollectionAssert.AreEqual(new[] { false, false }, view.Committed.ToArray(), "Picks reset after resolution.");
    }

    [TestMethod]
    public void DeathrollSpectatorView_MirrorsThePublicView()
    {
        var engine = new DeathrollEngine();
        var state = engine.InitialState([new GamePlayer(10), new GamePlayer(20)], new FixedRandom(50));
        engine.ApplyAction(state, 10, new Dictionary<string, object?>(), new FixedRandom(50));

        var view = (DeathrollSpectatorView)engine.SpectatorView(state);
        Assert.AreEqual("deathroll", view.Kind);
        CollectionAssert.AreEqual(new[] { 10L, 20L }, view.Players.ToArray());
        Assert.AreEqual(20L, view.CurrentPlayer);
        Assert.AreEqual(50, view.Ceiling);
        Assert.AreEqual(50, view.LastRoll);
        Assert.IsFalse(view.Finished);
        Assert.IsNull(view.LoserId);
    }

    private sealed class FixedRandom(int value) : IRandomSource
    {
        public int Roll(int maxInclusive) => Math.Min(value, maxInclusive);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorViewTests`
Expected: **compile error** — `SpectatorView` and the `Brmble.Server.Games.Spectators` namespace do not exist.

- [ ] **Step 3: Create the view records**

Create `src/Brmble.Server/Games/Spectators/SpectatorViews.cs`:

```csharp
namespace Brmble.Server.Games.Spectators;

/// <summary>
/// What a non-participant may see of a live Deathroll match. Deathroll has no
/// private state — <see cref="Engines.DeathrollEngine.PublicView"/> ignores its
/// <c>forUserId</c> argument — so this mirrors the participant view exactly.
/// Every player id is a Mumble SESSION id, matching the engine's state keys.
/// </summary>
public sealed record DeathrollSpectatorView(
    string Kind,
    IReadOnlyList<long> Players,
    long? CurrentPlayer,
    int Ceiling,
    int? LastRoll,
    bool Finished,
    long? LoserId);

/// <summary>A resolved RPS round. Throws are public only once the round is over.</summary>
public sealed record RpsResolvedRoundSnapshot(
    int RoundNumber,
    int Sequence,
    string Pick0,
    string Pick1,
    long? WinnerId,
    bool Tie);

/// <summary>
/// What a non-participant may see of a live RPS match. <see cref="Committed"/>
/// carries WHETHER each player has thrown, never WHAT. There is deliberately no
/// <c>Picks</c>, <c>MyPick</c> or <c>OpponentPicked</c> field: resolved throws
/// exist only inside <see cref="LastRound"/>.
/// Every player id is a Mumble SESSION id.
/// </summary>
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
```

- [ ] **Step 4: Add the engine member with no default implementation**

In `src/Brmble.Server/Games/IGameEngine.cs`, immediately after the `PublicView` declaration (`:59`):

```csharp
    /// <summary>
    /// What a non-participant may see. Deliberately has NO default implementation:
    /// a new engine must not compile until its author has decided what a spectator
    /// is allowed to know. Never infer this from <see cref="PublicView"/> — that
    /// view is filtered FOR a participant, and collapsing its per-player fields for
    /// a non-participant produces wrong answers, not merely redacted ones.
    /// </summary>
    object SpectatorView(object state);
```

- [ ] **Step 5: Implement `DeathrollEngine.SpectatorView`**

In `src/Brmble.Server/Games/Engines/DeathrollEngine.cs`, after `PublicView` (`:148`):

```csharp
    public object SpectatorView(object state)
    {
        var s = (State)state;
        return new DeathrollSpectatorView(
            Kind: "deathroll",
            Players: s.Players,
            CurrentPlayer: s.LoserId is null ? s.Players[s.CurrentIndex] : null,
            Ceiling: s.Ceiling,
            LastRoll: s.LastRoll,
            Finished: s.LoserId is not null,
            LoserId: s.LoserId);
    }
```

Add `using Brmble.Server.Games.Spectators;` to the file's usings if it does not already resolve.

- [ ] **Step 6: Implement `RpsEngine.SpectatorView`**

In `src/Brmble.Server/Games/Engines/RpsEngine.cs`, after `PublicView` (`:281`):

```csharp
    public object SpectatorView(object state)
    {
        var s = (State)state;
        return new RpsSpectatorView(
            Kind: "rps",
            Players: s.Players,
            BestOf: s.BestOf,
            TargetWins: s.TargetWins,
            RoundNumber: s.RoundNumber,
            RoundWins: s.RoundWins,
            // Whether, never what. Picks are cleared on resolution, so this reads
            // false/false between rounds and the reveal lives in LastRound.
            Committed: [s.Picks[0] is not null, s.Picks[1] is not null],
            Finished: s.WinnerId is not null || s.Drawn,
            WinnerId: s.WinnerId,
            LastRound: s.Last is null ? null : new RpsResolvedRoundSnapshot(
                RoundNumber: s.Last.RoundNumber,
                Sequence: s.Last.Seq,
                Pick0: s.Last.P0?.ToString().ToLowerInvariant() ?? "none",
                Pick1: s.Last.P1?.ToString().ToLowerInvariant() ?? "none",
                WinnerId: s.Last.WinnerId,
                Tie: s.Last.Tie));
    }
```

Add `using Brmble.Server.Games.Spectators;` if needed.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorViewTests`
Expected: 3 tests PASS. Then run the whole server suite to confirm nothing else broke:
Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS. (If a test double implements `IGameEngine`, it will now fail to compile until it adds `SpectatorView`. That is the compiler-enforcement working as designed — add a minimal implementation to the double.)

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Games/IGameEngine.cs src/Brmble.Server/Games/Spectators/SpectatorViews.cs src/Brmble.Server/Games/Engines/DeathrollEngine.cs src/Brmble.Server/Games/Engines/RpsEngine.cs tests/Brmble.Server.Tests/Games/SpectatorViewTests.cs
git commit -m "feat(games): add privacy-safe SpectatorView to IGameEngine"
```

---

### Task 2: Spectator contract types and wire records

**Files:**
- Create: `src/Brmble.Server/Games/Spectators/SpectatorModels.cs`
- Create: `src/Brmble.Server/Games/Spectators/SpectatorWire.cs`
- Test: `tests/Brmble.Server.Tests/Games/SpectatorWireTests.cs` (create)

**Interfaces:**
- Consumes: `DuelConfiguration` (`DuelModels.cs:3-8`), `DuelPlayerSnapshot` (`DuelModels.cs:92`), `RpsSpectatorView` (Task 1).
- Produces: every type quoted in Step 1 and Step 3 below. Tasks 3–8 depend on these exact names.

**Note on naming:** `DuelConfiguration` and `DuelPlayerSnapshot` are duel-named but structurally generic and carry no two-player assumption. Reusing them here does not make the spectator half duel-specific. Renaming them is out of scope.

- [ ] **Step 1: Write the failing wire test**

Create `tests/Brmble.Server.Tests/Games/SpectatorWireTests.cs`:

```csharp
using System.Text.Json;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

[TestClass]
public class SpectatorWireTests
{
    private static readonly JsonSerializerOptions Wire =
        new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [TestMethod]
    public void SnapshotEvent_SerialisesTheDocumentedShape()
    {
        var snapshot = new SpectatorSnapshot(
            SchemaVersion: 1, MatchId: 91, ChannelId: 7, GameType: "rps", Format: "bo3",
            RulesetVersion: 1,
            Players: [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
            Sequence: 4,
            GeneratedAt: DateTimeOffset.Parse("2026-08-24T14:30:04+00:00"),
            View: new RpsSpectatorView("rps", [10, 20], 3, 2, 2, [1, 0], [true, false], false, null, null));

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(SpectatorWire.ToSnapshotEvent(snapshot), Wire));
        var root = doc.RootElement;
        Assert.AreEqual("game.spectatorSnapshot", root.GetProperty("type").GetString());
        Assert.AreEqual(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.AreEqual(91, root.GetProperty("matchId").GetInt64());
        Assert.AreEqual(7, root.GetProperty("channelId").GetInt32());
        Assert.AreEqual("rps", root.GetProperty("gameType").GetString());
        Assert.AreEqual(4, root.GetProperty("sequence").GetInt64());
        Assert.AreEqual("rps", root.GetProperty("view").GetProperty("kind").GetString());
        Assert.AreEqual(10L, root.GetProperty("players")[0].GetProperty("sessionId").GetInt64());
    }

    [TestMethod]
    public void MatchEndedEvent_CarriesReasonAndOutcome()
    {
        var evt = SpectatorWire.ToMatchEndedEvent(
            91, 7, 9, MatchEndReason.Completed, new { winnerId = 100, loserId = 200 });

        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(evt, Wire));
        var root = doc.RootElement;
        Assert.AreEqual("game.spectatorMatchEnded", root.GetProperty("type").GetString());
        Assert.AreEqual("completed", root.GetProperty("reason").GetString());
        Assert.AreEqual(9, root.GetProperty("finalSequence").GetInt64());
        Assert.AreEqual(100, root.GetProperty("outcome").GetProperty("winnerId").GetInt32());
    }

    [TestMethod]
    public void ClosedEvent_UsesCamelCasedReason()
    {
        using var doc = JsonDocument.Parse(JsonSerializer.Serialize(
            SpectatorWire.ToClosedEvent(7, SpectatorCloseReason.AuthorizationLost), Wire));
        Assert.AreEqual("game.spectatorClosed", doc.RootElement.GetProperty("type").GetString());
        Assert.AreEqual("authorizationLost", doc.RootElement.GetProperty("reason").GetString());
    }

    [DataTestMethod]
    [DataRow(nameof(SpectatorSubscribeReason.NotPresent), "notPresent")]
    [DataRow(nameof(SpectatorSubscribeReason.NotSameChannel), "notSameChannel")]
    public void SubscribeReason_MapsToStructuredCode(string member, string expected)
    {
        var value = Enum.Parse<SpectatorSubscribeReason>(member);
        Assert.AreEqual(expected, SpectatorWire.Reason(value));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorWireTests`
Expected: **compile error** — `SpectatorSnapshot` / `SpectatorWire` do not exist.

- [ ] **Step 3: Create the contract types**

Create `src/Brmble.Server/Games/Spectators/SpectatorModels.cs`:

```csharp
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Spectators;

/// <summary>Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.</summary>
public enum SpectatorTransport { DiscreteEventBus, DedicatedRealtime }

/// <summary>Frozen by the Arena plan. Only the Arena path reads this.</summary>
public enum SpectatorRole { Spectator, Participant }

/// <summary>
/// Why a subscribe attempt failed. There is deliberately no <c>MatchNotLive</c>:
/// subscribing to an idle channel is valid and returns a null match, because
/// spectating is a CHANNEL mode that outlives any single match.
/// </summary>
public enum SpectatorSubscribeReason { None, NotPresent, NotSameChannel }

/// <summary>
/// Why a subscription was torn down. There is deliberately no <c>MatchEnded</c>:
/// a match ending ends a match, not a subscription.
/// </summary>
public enum SpectatorCloseReason { Unsubscribed, AuthorizationLost, Disconnected, ChannelRemoved }

public enum MatchEndReason { Completed, Forfeited }

/// <summary>
/// What a source (today only <see cref="GameSessionManager"/>) hands to the
/// coordinator. <see cref="ParticipantUserIds"/> are stable db user ids and are
/// EXCLUDED from fan-out: a spectator who accepted a challenge is now playing the
/// match they were watching and receives <c>game.stateUpdated</c> instead.
/// </summary>
public sealed record SpectatorSourceFrame(
    long MatchId,
    int ChannelId,
    DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    IReadOnlySet<long> ParticipantUserIds,
    long Sequence,
    DateTimeOffset GeneratedAt,
    object View);

/// <summary>The spectator-facing projection of a live match.</summary>
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

/// <summary>
/// Result of <see cref="ISpectatorCoordinator.SubscribeAsync"/>. <c>Match</c> is null
/// on success when the channel is idle — that is a valid subscription, not a failure.
/// </summary>
public sealed record SpectatorSubscribeResult(
    bool Success,
    SpectatorSnapshot? Match,
    SpectatorSubscribeReason Reason);

/// <summary>Carried unchanged from the July plan. Exists only for the Arena path; this project does not read it.</summary>
public sealed record SpectatorMatchDescriptor(
    long MatchId,
    int ChannelId,
    string GameType,
    SpectatorTransport Transport,
    IReadOnlySet<long> ParticipantUserIds);

/// <summary>Carried unchanged from the July plan. Exists only for the Arena path; this project does not read it.</summary>
public sealed record SpectatorAuthorizationResult(
    bool Authorized,
    SpectatorRole Role,
    SpectatorSubscribeReason Reason);

public interface ISpectatorCoordinator
{
    // Discrete, channel-scoped. New in this project.
    Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId);
    Task UnsubscribeAsync(long sessionId, long userId);
    Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame);
    Task EndMatchAsync(long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome);

    // Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.
    // NOTE: EndMatchAsync above diverges from that plan's three-parameter signature by
    // adding `reason` and `outcome`. Forfeits fabricate no terminal frame, so a spectator
    // needs the outcome delivered by the lifecycle call rather than inferred from a final
    // frame. Arena is unimplemented, so this costs nothing today; the three parameters
    // Arena passes keep their positions and meanings.
    Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match);
    Task<SpectatorAuthorizationResult> AuthorizeAsync(long sessionId, long userId, long matchId, SpectatorRole role);
}

public interface ISpectatorLifecycle
{
    Task HandleChannelChangedAsync(long sessionId, int newChannelId);
    Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason);
    Task HandleChannelRemovedAsync(int channelId);
    Task HandleTransportDisconnectedAsync(long userId);
}
```

- [ ] **Step 4: Create the wire records**

Create `src/Brmble.Server/Games/Spectators/SpectatorWire.cs`. This mirrors `DuelWire` (`src/Brmble.Server/Games/Duels/DuelWire.cs:41-55`): a `Type` string is the first field so the camelCase serializer emits `"type"` first, and enums are mapped to stable strings by hand rather than serialised by name.

```csharp
using Brmble.Server.Games.Duels;

namespace Brmble.Server.Games.Spectators;

public sealed record SpectatorSnapshotEvent(
    string Type,
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

public sealed record SpectatorMatchEndedEvent(
    string Type,
    int SchemaVersion,
    long MatchId,
    int ChannelId,
    string Reason,
    long FinalSequence,
    object Outcome);

public sealed record SpectatorClosedEvent(
    string Type,
    int ChannelId,
    string Reason);

public static class SpectatorWire
{
    public static SpectatorSnapshotEvent ToSnapshotEvent(SpectatorSnapshot s) => new(
        "game.spectatorSnapshot", s.SchemaVersion, s.MatchId, s.ChannelId, s.GameType,
        s.Format, s.RulesetVersion, s.Players, s.Sequence, s.GeneratedAt, s.View);

    public static SpectatorMatchEndedEvent ToMatchEndedEvent(
        long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome) => new(
        "game.spectatorMatchEnded", 1, matchId, channelId, Reason(reason), finalSequence, outcome);

    public static SpectatorClosedEvent ToClosedEvent(int channelId, SpectatorCloseReason reason) => new(
        "game.spectatorClosed", channelId, Reason(reason));

    public static string Reason(MatchEndReason value) => value switch
    {
        MatchEndReason.Completed => "completed",
        MatchEndReason.Forfeited => "forfeited",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Reason(SpectatorCloseReason value) => value switch
    {
        SpectatorCloseReason.Unsubscribed => "unsubscribed",
        SpectatorCloseReason.AuthorizationLost => "authorizationLost",
        SpectatorCloseReason.Disconnected => "disconnected",
        SpectatorCloseReason.ChannelRemoved => "channelRemoved",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Reason(SpectatorSubscribeReason value) => value switch
    {
        SpectatorSubscribeReason.None => "none",
        SpectatorSubscribeReason.NotPresent => "notPresent",
        SpectatorSubscribeReason.NotSameChannel => "notSameChannel",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorWireTests`
Expected: 5 tests PASS (3 `[TestMethod]` + 2 `[DataRow]`).

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorModels.cs src/Brmble.Server/Games/Spectators/SpectatorWire.cs tests/Brmble.Server.Tests/Games/SpectatorWireTests.cs
git commit -m "feat(games): add spectator contract types and wire records"
```

---

### Task 3: `SpectatorService` — registry, fan-out, sequence gating

**Files:**
- Create: `src/Brmble.Server/Games/Spectators/SpectatorService.cs`
- Test: `tests/Brmble.Server.Tests/Games/SpectatorServiceTests.cs` (create)

**Interfaces:**
- Consumes: everything from Task 2; `IGameEventPublisher` (`GameSessionManager.cs:8-12`); `IGamePresence.TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)` (`GameSessionManager.cs:19`).
- Produces: `public sealed class SpectatorService : ISpectatorCoordinator, ISpectatorLifecycle`, constructor `SpectatorService(IGameEventPublisher publisher, IGamePresence presence, ILogger<SpectatorService> logger)`. Task 4 adds the `ISpectatorLifecycle` bodies; Task 5 calls `PublishDiscreteFrameAsync` / `EndMatchAsync`; Task 6 calls `SubscribeAsync` / `UnsubscribeAsync`.

**Design notes the executor must not deviate from:**
- One `SemaphoreSlim(1, 1)` serialises all registry mutation. **Never publish while holding it** — compute the target set inside, publish outside.
- The registry is keyed by channel, but lifecycle teardown arrives keyed by *session* (`HandleChannelChangedAsync`, `HandlePresenceLostAsync`) and by *user* (`HandleTransportDisconnectedAsync`). So a subscriber row must carry both ids, and a `sessionId → channelId` reverse index is required. The spec's one-line "`channelId → HashSet<long> subscriberUserIds`" sketch under-specifies this.
- Sequence gating is per **match**, not per channel: when `frame.MatchId` differs from the entry's current match, reset the high-water mark to 0 before applying the frame.
- Fan-out excludes `frame.ParticipantUserIds`. This is the tested invariant.

- [ ] **Step 1: Write the failing tests**

Create `tests/Brmble.Server.Tests/Games/SpectatorServiceTests.cs`:

```csharp
using Brmble.Server.Games;
using Brmble.Server.Games.Duels;
using Brmble.Server.Games.Spectators;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Games;

internal sealed class SpectatorPublisher : IGameEventPublisher
{
    public List<(IReadOnlySet<long> Users, object Message)> ToUsers { get; } = [];
    public List<(int ChannelId, object Message)> ToChannel { get; } = [];

    public Task PublishToUsersAsync(IReadOnlySet<long> userIds, object message)
    {
        ToUsers.Add((userIds, message));
        return Task.CompletedTask;
    }

    public Task PublishToChannelAsync(int channelId, object message)
    {
        ToChannel.Add((channelId, message));
        return Task.CompletedTask;
    }

    public IEnumerable<(IReadOnlySet<long> Users, T Message)> OfType<T>() =>
        ToUsers.Where(x => x.Message is T).Select(x => (x.Users, (T)x.Message));
}

internal sealed class SpectatorPresence : IGamePresence
{
    public Dictionary<long, int> Channels { get; } = [];
    public Dictionary<long, long> Users { get; } = [];

    public bool TryGetChannel(long sessionId, out int channelId, out bool isBrmble, out long userId)
    {
        isBrmble = true;
        userId = Users.TryGetValue(sessionId, out var u) ? u : 0;
        return Channels.TryGetValue(sessionId, out channelId);
    }
}

[TestClass]
public class SpectatorServiceTests
{
    private SpectatorPublisher _publisher = null!;
    private SpectatorPresence _presence = null!;
    private SpectatorService _service = null!;

    [TestInitialize]
    public void Setup()
    {
        _publisher = new SpectatorPublisher();
        _presence = new SpectatorPresence();
        // Watchers.
        Place(session: 30, user: 300, channel: 7);
        Place(session: 40, user: 400, channel: 7);
        // Players.
        Place(session: 10, user: 100, channel: 7);
        Place(session: 20, user: 200, channel: 7);
        // Someone in another channel.
        Place(session: 50, user: 500, channel: 8);
        _service = new SpectatorService(_publisher, _presence, NullLogger<SpectatorService>.Instance);
    }

    private void Place(long session, long user, int channel)
    {
        _presence.Channels[session] = channel;
        _presence.Users[session] = user;
    }

    private static SpectatorSourceFrame Frame(long matchId, long sequence, int channelId = 7) => new(
        MatchId: matchId,
        ChannelId: channelId,
        Configuration: new DuelConfiguration("deathroll", "1v1", 1, new Dictionary<string, object?>(), "discrete"),
        Players: [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
        ParticipantUserIds: new HashSet<long> { 100, 200 },
        Sequence: sequence,
        GeneratedAt: DateTimeOffset.UnixEpoch.AddSeconds(sequence),
        View: new DeathrollSpectatorView("deathroll", [10, 20], 10, 100, 50, false, null));

    private IReadOnlyList<(IReadOnlySet<long> Users, SpectatorSnapshotEvent Message)> Snapshots() =>
        _publisher.OfType<SpectatorSnapshotEvent>().ToList();

    [TestMethod]
    public async Task Subscribe_ToIdleChannel_SucceedsWithNullMatch()
    {
        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNull(result.Match);
        Assert.AreEqual(SpectatorSubscribeReason.None, result.Reason);
    }

    [TestMethod]
    public async Task Subscribe_ToLiveChannel_ReturnsTheCurrentFrame()
    {
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNotNull(result.Match);
        Assert.AreEqual(91, result.Match!.MatchId);
        Assert.AreEqual(1, result.Match.Sequence);
    }

    [TestMethod]
    public async Task Subscribe_ToAnotherChannel_RejectsWithNotSameChannel()
    {
        var result = await _service.SubscribeAsync(30, 300, 8);
        Assert.IsFalse(result.Success);
        Assert.AreEqual(SpectatorSubscribeReason.NotSameChannel, result.Reason);
    }

    [TestMethod]
    public async Task Subscribe_WithNoLiveSession_RejectsWithNotPresent()
    {
        var result = await _service.SubscribeAsync(999, 999, 7);
        Assert.IsFalse(result.Success);
        Assert.AreEqual(SpectatorSubscribeReason.NotPresent, result.Reason);
    }

    [TestMethod]
    public async Task Participant_NeverReceivesAFrameForTheirOwnMatch()
    {
        // A watcher who then accepts a challenge: still subscribed, now a participant.
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(10, 100, 7);

        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        var (users, _) = Snapshots().Single();
        CollectionAssert.AreEquivalent(new[] { 300L }, users.ToArray());
        Assert.IsFalse(users.Contains(100L), "A participant of match 91 must never receive a frame for match 91.");
    }

    [TestMethod]
    public async Task Frames_AtOrBelowTheHighWaterMark_AreDropped()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 2));
        await _service.PublishDiscreteFrameAsync(Frame(91, 2));
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.PublishDiscreteFrameAsync(Frame(91, 3));

        CollectionAssert.AreEqual(new long[] { 2, 3 }, Snapshots().Select(s => s.Message.Sequence).ToArray());
    }

    [TestMethod]
    public async Task ANewMatch_ResetsTheSequenceHighWaterMark()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 9));
        await _service.EndMatchAsync(91, 7, 9, MatchEndReason.Completed, new { winnerId = 100L });
        await _service.PublishDiscreteFrameAsync(Frame(92, 1));

        CollectionAssert.AreEqual(new long[] { 9, 1 }, Snapshots().Select(s => s.Message.Sequence).ToArray());
    }

    [TestMethod]
    public async Task MatchEnding_DoesNotRemoveTheSubscription()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        var ended = _publisher.OfType<SpectatorMatchEndedEvent>().Single();
        CollectionAssert.AreEquivalent(new[] { 300L }, ended.Users.ToArray());
        Assert.AreEqual("completed", ended.Message.Reason);
        Assert.AreEqual(0, _publisher.OfType<SpectatorClosedEvent>().Count(), "Ending a match must not close a subscription.");

        // The next match flows with no resubscribe.
        await _service.PublishDiscreteFrameAsync(Frame(92, 1));
        Assert.AreEqual(2, Snapshots().Count);
    }

    [TestMethod]
    public async Task EndMatch_IsIdempotentPerMatch()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        Assert.AreEqual(1, _publisher.OfType<SpectatorMatchEndedEvent>().Count());
    }

    [TestMethod]
    public async Task Subscribe_AfterAMatchEnded_ReturnsNullMatch()
    {
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.EndMatchAsync(91, 7, 1, MatchEndReason.Completed, new { winnerId = 100L });

        var result = await _service.SubscribeAsync(30, 300, 7);
        Assert.IsTrue(result.Success);
        Assert.IsNull(result.Match, "An ended match is not live; a fresh subscriber sees idle.");
    }

    [TestMethod]
    public async Task Unsubscribe_StopsDeliveryAndPublishesUnsubscribed()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.UnsubscribeAsync(30, 300);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(0, Snapshots().Count);
        var closed = _publisher.OfType<SpectatorClosedEvent>().Single();
        Assert.AreEqual("unsubscribed", closed.Message.Reason);
        Assert.AreEqual(7, closed.Message.ChannelId);
    }

    [TestMethod]
    public async Task Subscribing_Twice_DoesNotDuplicateDelivery()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(30, 300, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(1, Snapshots().Count);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorServiceTests`
Expected: **compile error** — `SpectatorService` does not exist.

- [ ] **Step 3: Implement `SpectatorService`**

Create `src/Brmble.Server/Games/Spectators/SpectatorService.cs`:

```csharp
using Brmble.Server.Games.Duels;
using Microsoft.Extensions.Logging;

namespace Brmble.Server.Games.Spectators;

/// <summary>
/// Channel-scoped spectator registry and fan-out.
///
/// Spectating is a CHANNEL mode, not a match view: you opt in once and keep watching
/// match after match until you explicitly stop, leave the channel, or disconnect.
/// That is why <see cref="SpectatorCloseReason"/> has no <c>MatchEnded</c> member and
/// <see cref="SpectatorSubscribeReason"/> has no <c>MatchNotLive</c> member.
///
/// Nothing here knows what a duel is. It is keyed on channel and match, so a future
/// many-player minigame fits without a contract change.
/// </summary>
public sealed class SpectatorService(
    IGameEventPublisher publisher,
    IGamePresence presence,
    ILogger<SpectatorService> logger) : ISpectatorCoordinator, ISpectatorLifecycle
{
    private const int SchemaVersion = 1;

    private sealed class ChannelEntry
    {
        /// <summary>Mumble session id → stable db user id. Both are needed: fan-out is by
        /// user id, but presence teardown arrives keyed by session id.</summary>
        public readonly Dictionary<long, long> Subscribers = [];
        public long? MatchId;
        public long LastSequence;
        public bool Ended;
        public SpectatorSnapshot? Latest;
        public IReadOnlySet<long> ParticipantUserIds = new HashSet<long>();
    }

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Dictionary<int, ChannelEntry> _channels = [];
    private readonly Dictionary<long, int> _sessionChannel = [];

    // ---------- ISpectatorCoordinator: discrete, channel-scoped ----------

    public async Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId)
    {
        // Validate the requested channel against live membership rather than deriving
        // it. A concurrent channel move then fails loudly with notSameChannel instead
        // of silently subscribing the caller to the wrong channel.
        if (!presence.TryGetChannel(sessionId, out var liveChannel, out var isBrmble, out _) || !isBrmble)
            return new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotPresent);
        if (liveChannel != channelId)
            return new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotSameChannel);

        await _gate.WaitAsync();
        try
        {
            DropSessionLocked(sessionId);
            var entry = EntryLocked(channelId);
            entry.Subscribers[sessionId] = userId;
            _sessionChannel[sessionId] = channelId;

            // A participant is playing the match they were watching; they get
            // game.stateUpdated instead, so hand them no spectator snapshot for it.
            var match = entry.Ended || entry.ParticipantUserIds.Contains(userId) ? null : entry.Latest;
            return new SpectatorSubscribeResult(true, match, SpectatorSubscribeReason.None);
        }
        finally { _gate.Release(); }
    }

    public Task UnsubscribeAsync(long sessionId, long userId)
        => CloseSessionAsync(sessionId, SpectatorCloseReason.Unsubscribed);

    public async Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame)
    {
        HashSet<long> targets;
        SpectatorSnapshot snapshot;

        await _gate.WaitAsync();
        try
        {
            var entry = EntryLocked(frame.ChannelId);
            if (entry.MatchId != frame.MatchId)
            {
                // Sequences are monotonic PER MATCH, so a new match resets the mark.
                entry.MatchId = frame.MatchId;
                entry.LastSequence = 0;
                entry.Ended = false;
            }
            else if (frame.Sequence <= entry.LastSequence)
            {
                logger.LogDebug(
                    "Dropping stale spectator frame {Sequence} for match {MatchId} (have {Last}).",
                    frame.Sequence, frame.MatchId, entry.LastSequence);
                return;
            }

            entry.LastSequence = frame.Sequence;
            entry.ParticipantUserIds = frame.ParticipantUserIds;
            snapshot = new SpectatorSnapshot(
                SchemaVersion, frame.MatchId, frame.ChannelId,
                frame.Configuration.GameType, frame.Configuration.Format,
                frame.Configuration.RulesetVersion, frame.Players,
                frame.Sequence, frame.GeneratedAt, frame.View);
            entry.Latest = snapshot;
            targets = TargetsLocked(entry, frame.ParticipantUserIds);
        }
        finally { _gate.Release(); }

        if (targets.Count == 0) return;
        await publisher.PublishToUsersAsync(targets, SpectatorWire.ToSnapshotEvent(snapshot));
    }

    public async Task EndMatchAsync(
        long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome)
    {
        HashSet<long> targets;
        IReadOnlySet<long> participants;

        await _gate.WaitAsync();
        try
        {
            var entry = EntryLocked(channelId);
            // Forfeits fabricate no frame, so a match can end without ever having had
            // one; adopt the match id in that case rather than ignoring the end.
            if (entry.MatchId != matchId)
            {
                if (entry.MatchId is not null && entry.Ended is false && entry.LastSequence > 0) return;
                entry.MatchId = matchId;
                entry.LastSequence = finalSequence;
            }
            if (entry.Ended) return;

            entry.Ended = true;
            // The subscription survives — a match ending ends a match, not a
            // subscription — but the match is no longer live, so a NEW subscriber
            // must see idle rather than a finished board.
            entry.Latest = null;
            participants = entry.ParticipantUserIds;
            targets = TargetsLocked(entry, participants);
        }
        finally { _gate.Release(); }

        if (targets.Count == 0) return;
        await publisher.PublishToUsersAsync(
            targets, SpectatorWire.ToMatchEndedEvent(matchId, channelId, finalSequence, reason, outcome));
    }

    // ---------- ISpectatorCoordinator: frozen Arena surface ----------

    /// <summary>
    /// Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.
    /// Arena's per-match realtime ticket sits alongside channel-scoped discrete
    /// subscriptions. No continuous simulation frame may enter this service or the
    /// event bus, so there is nothing for this project to do here.
    /// </summary>
    public Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match) => Task.CompletedTask;

    /// <summary>Frozen by the Arena plan. Not read by the discrete path.</summary>
    public Task<SpectatorAuthorizationResult> AuthorizeAsync(
        long sessionId, long userId, long matchId, SpectatorRole role)
        => Task.FromResult(new SpectatorAuthorizationResult(false, role, SpectatorSubscribeReason.NotPresent));

    // ---------- ISpectatorLifecycle (bodies land in Task 4) ----------

    public Task HandleChannelChangedAsync(long sessionId, int newChannelId) => throw new NotImplementedException();
    public Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason) => throw new NotImplementedException();
    public Task HandleChannelRemovedAsync(int channelId) => throw new NotImplementedException();
    public Task HandleTransportDisconnectedAsync(long userId) => throw new NotImplementedException();

    // ---------- helpers (all callers hold _gate) ----------

    private ChannelEntry EntryLocked(int channelId)
    {
        if (!_channels.TryGetValue(channelId, out var entry))
            _channels[channelId] = entry = new ChannelEntry();
        return entry;
    }

    private static HashSet<long> TargetsLocked(ChannelEntry entry, IReadOnlySet<long> excluded)
        => entry.Subscribers.Values.Where(u => !excluded.Contains(u)).ToHashSet();

    private (int ChannelId, long UserId)? DropSessionLocked(long sessionId)
    {
        if (!_sessionChannel.TryGetValue(sessionId, out var channelId)) return null;
        _sessionChannel.Remove(sessionId);
        if (!_channels.TryGetValue(channelId, out var entry)) return null;
        if (!entry.Subscribers.Remove(sessionId, out var userId)) return null;
        return (channelId, userId);
    }

    /// <summary>Removes one session's subscription and tells it why. Shared by every teardown path.</summary>
    private async Task CloseSessionAsync(long sessionId, SpectatorCloseReason reason)
    {
        (int ChannelId, long UserId)? dropped;
        await _gate.WaitAsync();
        try { dropped = DropSessionLocked(sessionId); }
        finally { _gate.Release(); }

        if (dropped is null) return;
        await publisher.PublishToUsersAsync(
            new HashSet<long> { dropped.Value.UserId },
            SpectatorWire.ToClosedEvent(dropped.Value.ChannelId, reason));
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorServiceTests`
Expected: 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorService.cs tests/Brmble.Server.Tests/Games/SpectatorServiceTests.cs
git commit -m "feat(games): add channel-scoped SpectatorService registry and fan-out"
```

---

### Task 4: `ISpectatorLifecycle` teardown

**Files:**
- Modify: `src/Brmble.Server/Games/Spectators/SpectatorService.cs` (replace the four `NotImplementedException` stubs)
- Test: `tests/Brmble.Server.Tests/Games/SpectatorServiceTests.cs` (append)

**Interfaces:**
- Consumes: `SpectatorService` internals from Task 3 (`_gate`, `_channels`, `_sessionChannel`, `DropSessionLocked`, `CloseSessionAsync`).
- Produces: working `HandleChannelChangedAsync`, `HandlePresenceLostAsync`, `HandleChannelRemovedAsync`, `HandleTransportDisconnectedAsync`. Task 7 wires these to real call sites.

**Rule:** reconnecting requires an explicit fresh subscribe. Nothing is restored implicitly.

- [ ] **Step 1: Write the failing tests**

Append to `SpectatorServiceTests`:

```csharp
    [TestMethod]
    public async Task ChannelChange_DropsTheSubscriptionAndReportsAuthorizationLost()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.HandleChannelChangedAsync(30, 8);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(0, Snapshots().Count);
        var closed = _publisher.OfType<SpectatorClosedEvent>().Single();
        Assert.AreEqual("authorizationLost", closed.Message.Reason);
        Assert.AreEqual(7, closed.Message.ChannelId, "The close names the channel that was left.");
        CollectionAssert.AreEquivalent(new[] { 300L }, closed.Users.ToArray());
    }

    [TestMethod]
    public async Task ChannelChange_BackToTheSameChannel_KeepsTheSubscription()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.HandleChannelChangedAsync(30, 7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(1, Snapshots().Count);
        Assert.AreEqual(0, _publisher.OfType<SpectatorClosedEvent>().Count());
    }

    [TestMethod]
    public async Task PresenceLost_DropsTheSubscriptionAndReportsDisconnected()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.HandlePresenceLostAsync(30, SpectatorCloseReason.Disconnected);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        Assert.AreEqual(0, Snapshots().Count);
        Assert.AreEqual("disconnected", _publisher.OfType<SpectatorClosedEvent>().Single().Message.Reason);
    }

    [TestMethod]
    public async Task ChannelRemoved_DropsEverySubscriberInThatChannelOnly()
    {
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(40, 400, 7);
        await _service.SubscribeAsync(50, 500, 8);

        await _service.HandleChannelRemovedAsync(7);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));
        await _service.PublishDiscreteFrameAsync(Frame(92, 1, channelId: 8));

        Assert.AreEqual(1, Snapshots().Count, "Only the channel-8 subscriber still receives frames.");
        CollectionAssert.AreEquivalent(new[] { 500L }, Snapshots().Single().Users.ToArray());

        var closed = _publisher.OfType<SpectatorClosedEvent>().ToList();
        Assert.AreEqual(2, closed.Count);
        Assert.IsTrue(closed.All(c => c.Message.Reason == "channelRemoved" && c.Message.ChannelId == 7));
    }

    [TestMethod]
    public async Task TransportDisconnected_DropsEverySessionOfThatUser()
    {
        Place(session: 31, user: 300, channel: 7); // same user, second Mumble session
        await _service.SubscribeAsync(30, 300, 7);
        await _service.SubscribeAsync(31, 300, 7);
        await _service.SubscribeAsync(40, 400, 7);

        await _service.HandleTransportDisconnectedAsync(300);
        await _service.PublishDiscreteFrameAsync(Frame(91, 1));

        CollectionAssert.AreEquivalent(new[] { 400L }, Snapshots().Single().Users.ToArray());
    }

    [TestMethod]
    public async Task Teardown_OfAnUnsubscribedSession_IsSilent()
    {
        await _service.HandleChannelChangedAsync(30, 8);
        await _service.HandlePresenceLostAsync(30, SpectatorCloseReason.Disconnected);
        await _service.HandleTransportDisconnectedAsync(300);
        await _service.HandleChannelRemovedAsync(7);

        Assert.AreEqual(0, _publisher.ToUsers.Count);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorServiceTests`
Expected: the six new tests FAIL with `NotImplementedException` (`Teardown_OfAnUnsubscribedSession_IsSilent` too — the stubs throw unconditionally).

- [ ] **Step 3: Implement the four teardowns**

Replace the stub block in `SpectatorService.cs`:

```csharp
    // ---------- ISpectatorLifecycle ----------

    /// <summary>
    /// Called BEFORE channel membership is updated, so the old channel is still
    /// readable. Authorization was always same-channel, so leaving the channel you
    /// are spectating ends the subscription. Moving back into the same channel is a
    /// no-op — a redundant user-state dispatch must not kill a live subscription.
    /// </summary>
    public async Task HandleChannelChangedAsync(long sessionId, int newChannelId)
    {
        await _gate.WaitAsync();
        int? subscribed;
        try { subscribed = _sessionChannel.TryGetValue(sessionId, out var c) ? c : null; }
        finally { _gate.Release(); }

        if (subscribed is null || subscribed == newChannelId) return;
        await CloseSessionAsync(sessionId, SpectatorCloseReason.AuthorizationLost);
    }

    public Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason)
        => CloseSessionAsync(sessionId, reason);

    public async Task HandleChannelRemovedAsync(int channelId)
    {
        List<(long SessionId, long UserId)> dropped = [];
        await _gate.WaitAsync();
        try
        {
            if (_channels.Remove(channelId, out var entry))
            {
                foreach (var (sessionId, userId) in entry.Subscribers)
                {
                    _sessionChannel.Remove(sessionId);
                    dropped.Add((sessionId, userId));
                }
            }
        }
        finally { _gate.Release(); }

        if (dropped.Count == 0) return;
        await publisher.PublishToUsersAsync(
            dropped.Select(d => d.UserId).ToHashSet(),
            SpectatorWire.ToClosedEvent(channelId, SpectatorCloseReason.ChannelRemoved));
    }

    /// <summary>
    /// Called when a user's FINAL application WebSocket closes. One of two sockets
    /// closing must not clear the subscription. Reconnecting requires an explicit
    /// fresh subscribe; nothing is restored implicitly.
    /// </summary>
    public async Task HandleTransportDisconnectedAsync(long userId)
    {
        List<long> sessions;
        await _gate.WaitAsync();
        try
        {
            sessions = _channels.Values
                .SelectMany(e => e.Subscribers)
                .Where(kvp => kvp.Value == userId)
                .Select(kvp => kvp.Key)
                .ToList();
        }
        finally { _gate.Release(); }

        foreach (var sessionId in sessions)
            await CloseSessionAsync(sessionId, SpectatorCloseReason.Disconnected);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter SpectatorServiceTests`
Expected: 18 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/Spectators/SpectatorService.cs tests/Brmble.Server.Tests/Games/SpectatorServiceTests.cs
git commit -m "feat(games): add spectator lifecycle invalidation"
```

---

### Task 5: `GameSessionManager` frame capture and match end

**Files:**
- Modify: `src/Brmble.Server/Games/GameSessionManager.cs`
- Test: `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs` (append)

**Interfaces:**
- Consumes: `ISpectatorCoordinator`, `SpectatorSourceFrame`, `MatchEndReason` (Task 2); `IGameEngine.SpectatorView` (Task 1).
- Produces: `GameSessionManager` now emits `SpectatorSourceFrame`s and calls `EndMatchAsync`. Nothing later depends on new public members.

**Design notes:**
- The frame is captured **inside `lock (match.Lock)`** — the sequence is assigned there, and so is the view, so a concurrent mutation cannot produce an inconsistent frame. It is *published* inside the existing `EnqueueOutbound` closure, i.e. outside the lock, on the `OutboundTail` chain that already guarantees per-match ordering (`GameSessionManager.cs:243-248`).
- Match end is signalled by a dedicated call, not by a terminal frame, because **forfeits fabricate no frame** — `finalSequence` is the last complete frame's sequence. This handles completion and forfeit uniformly.
- `EndMatchAsync` must fire **exactly once** per match across concurrent completion. `Interlocked.Exchange` on `SpectatorEnded` is the guard.
- Spectator publication is **advisory**: route it through the existing `PublishAdvisoryAsync` (`:232-239`) so a spectator failure never breaks a participant's match.
- `_spectators` is nullable so the ~7 existing `new GameSessionManager(...)` sites in tests keep compiling. Task 6 adds a DI test that asserts the real graph injects it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs`. Add the fake first (top-level, next to `ManagerPublisher` at `:10`):

```csharp
internal sealed class RecordingSpectators : ISpectatorCoordinator
{
    public List<SpectatorSourceFrame> Frames { get; } = [];
    public List<(long MatchId, int ChannelId, long FinalSequence, MatchEndReason Reason, object Outcome)> Ends { get; } = [];

    public Task<SpectatorSubscribeResult> SubscribeAsync(long sessionId, long userId, int channelId)
        => Task.FromResult(new SpectatorSubscribeResult(true, null, SpectatorSubscribeReason.None));
    public Task UnsubscribeAsync(long sessionId, long userId) => Task.CompletedTask;

    public Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame)
    {
        lock (Frames) Frames.Add(frame);
        return Task.CompletedTask;
    }

    public Task EndMatchAsync(long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome)
    {
        lock (Ends) Ends.Add((matchId, channelId, finalSequence, reason, outcome));
        return Task.CompletedTask;
    }

    public Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match) => Task.CompletedTask;
    public Task<SpectatorAuthorizationResult> AuthorizeAsync(long sessionId, long userId, long matchId, SpectatorRole role)
        => Task.FromResult(new SpectatorAuthorizationResult(false, role, SpectatorSubscribeReason.NotPresent));
}
```

Then the test methods (inside the existing `[TestClass]`):

```csharp
    [TestMethod]
    public async Task Spectator_SequencesAreMonotonicAndUniqueAcrossStartActionAndTimeout()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine(), new RpsEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        var started = await manager.StartAsync(Reservation(94));
        await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
        await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "paper" });
        await manager.FireTurnTimeoutForTestAsync(started.MatchId);

        var sequences = spectators.Frames.Select(f => f.Sequence).ToArray();
        CollectionAssert.AllItemsAreUnique(sequences);
        CollectionAssert.AreEqual(sequences.OrderBy(s => s).ToArray(), sequences, "Sequences must be monotonic.");
        Assert.AreEqual(1, sequences[0], "The first frame is the start state.");
        Assert.IsTrue(sequences.Length >= 4, "Start, two actions and one timeout each produce a frame.");
    }

    [TestMethod]
    public async Task Spectator_FrameExcludesParticipantsAndCarriesTheEngineView()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        await manager.StartAsync(Reservation(95, new DuelConfiguration(
            "deathroll", "1v1", 1, new Dictionary<string, object?>(), "discrete")));

        var frame = spectators.Frames.First();
        CollectionAssert.AreEquivalent(new[] { 100L, 200L }, frame.ParticipantUserIds.ToArray());
        CollectionAssert.AreEquivalent(new[] { 10L, 20L }, frame.Players.Select(p => p.SessionId).ToArray());
        Assert.IsInstanceOfType<DeathrollSpectatorView>(frame.View);
        Assert.AreEqual("deathroll", frame.Configuration.GameType);
    }

    [TestMethod]
    public async Task Spectator_MatchEnd_FiresExactlyOnceOnCompletion()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(96));
        for (var round = 0; round < 3; round++)
        {
            await manager.ActionAsync(started.MatchId, 10, new Dictionary<string, object?> { ["pick"] = "rock" });
            await manager.ActionAsync(started.MatchId, 20, new Dictionary<string, object?> { ["pick"] = "scissors" });
        }

        var end = spectators.Ends.Single();
        Assert.AreEqual(started.MatchId, end.MatchId);
        Assert.AreEqual(MatchEndReason.Completed, end.Reason);
        Assert.AreEqual(spectators.Frames.Last().Sequence, end.FinalSequence);
    }

    [TestMethod]
    public async Task Spectator_Forfeit_EndsWithNoFabricatedFrame()
    {
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), new ManagerPublisher(), new ManagerSink(),
            spectators: spectators);

        var started = await manager.StartAsync(Reservation(97));
        var beforeFrames = spectators.Frames.Count;
        var beforeSequence = spectators.Frames.Last().Sequence;

        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");

        Assert.AreEqual(beforeFrames, spectators.Frames.Count, "A forfeit fabricates no frame.");
        var end = spectators.Ends.Single();
        Assert.AreEqual(MatchEndReason.Forfeited, end.Reason);
        Assert.AreEqual(beforeSequence, end.FinalSequence, "finalSequence is the last COMPLETE frame.");
    }

    [TestMethod]
    public async Task Spectator_ViewPlayerIdsAreSessionIdsThatJoinToTheSnapshotPlayers()
    {
        // The engine's state is keyed by Mumble SESSION id, and SpectatorView returns
        // an opaque `object` that GameSessionManager deliberately cannot inspect — so
        // there is no translation step and none should ever be added. The client joins
        // view ids against players[].sessionId, which is why DuelPlayerSnapshot must
        // keep carrying BOTH ids. This test fails loudly if a future engine emits db
        // user ids into a view instead.
        var spectators = new RecordingSpectators();
        var manager = new GameSessionManager(
            [new DeathrollEngine()], new ManagerRandom(), new ManagerPublisher(),
            new ManagerSink(), spectators: spectators);

        await manager.StartAsync(Reservation(99));

        var frame = spectators.Frames.First();
        var view = (DeathrollSpectatorView)frame.View;
        var sessionIds = frame.Players.Select(p => p.SessionId).ToHashSet();
        var userIds = frame.Players.Select(p => p.UserId).ToHashSet();

        foreach (var id in view.Players)
            Assert.IsTrue(sessionIds.Contains(id), $"View player {id} is not a session id of this match.");
        Assert.IsFalse(view.Players.Any(userIds.Contains),
            "View player ids must be session ids, not db user ids.");
    }

    [TestMethod]
    public async Task Spectator_NullCoordinator_ChangesNothing()
    {
        var publisher = new ManagerPublisher();
        var manager = new GameSessionManager(
            [new RpsEngine()], new ManagerRandom(), publisher, new ManagerSink());

        var started = await manager.StartAsync(Reservation(98));
        await manager.ForfeitAsync(started.MatchId, 100, "disconnect");

        CollectionAssert.AreEqual(
            new[] { "game.started", "game.ended" },
            publisher.Messages.Select(MessageType).Where(t => t is "game.started" or "game.ended").ToArray());
    }
```

> `Reservation(...)` is the existing helper in this file. If its signature does not accept a `DuelConfiguration` second argument, use the existing overload and drop the explicit configuration from `Spectator_FrameExcludesParticipantsAndCarriesTheEngineView` — the assertion on `frame.Configuration.GameType` still holds for whatever the default reservation is; adjust the expected string to match.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameSessionManagerTests`
Expected: **compile error** — `GameSessionManager` has no `spectators:` parameter.

- [ ] **Step 3: Thread `ISpectatorCoordinator` through the constructors**

In `src/Brmble.Server/Games/GameSessionManager.cs`, add the field next to `_liveTransitioned` and a parameter to all three constructors (`:59`, `:69`, `:80`), placed **after** `liveTransitioned` and **before** `logger` so every existing positional call site keeps compiling:

```csharp
    // Optional so existing test constructions keep compiling. In the real DI graph
    // it is always injected — see GamesExtensionsTests.
    private readonly ISpectatorCoordinator? _spectators;
```

```csharp
    public GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGameEventPublisher publisher,
        ICompletedMatchSink completedMatches,
        ISpectatorCoordinator? spectators = null,
        ILogger<GameSessionManager>? logger = null)
        : this(engines, rng, publisher, completedMatches, new GameTimerFactory(), null, spectators, logger)
    {
    }

    internal GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGameEventPublisher publisher,
        ICompletedMatchSink completedMatches,
        IGameTimerFactory timerFactory,
        ILogger<GameSessionManager>? logger = null)
        : this(engines, rng, publisher, completedMatches, timerFactory, null, null, logger)
    {
    }

    internal GameSessionManager(
        IEnumerable<IGameEngine> engines,
        IRandomSource rng,
        IGameEventPublisher publisher,
        ICompletedMatchSink completedMatches,
        IGameTimerFactory timerFactory,
        Action<long>? liveTransitioned,
        ISpectatorCoordinator? spectators = null,
        ILogger<GameSessionManager>? logger = null)
    {
        // ... existing assignments ...
        _spectators = spectators;
    }
```

Add `using Brmble.Server.Games.Spectators;` at the top of the file.

- [ ] **Step 4: Add the two `LiveMatch` fields**

In `LiveMatch` (`:98-121`), after `OutboundTail` (`:119`):

```csharp
        // Monotonic per match, assigned under Lock. Frames at or below the last
        // delivered value are dropped by SpectatorService.
        public long SpectatorSequence;
        // 0 = live, 1 = ended. Interlocked so concurrent terminal paths (normal
        // completion racing a forfeit) call EndMatchAsync exactly once.
        public int SpectatorEnded;
```

- [ ] **Step 5: Add the capture and end helpers**

In `GameSessionManager.cs`, next to `PublishAdvisoryAsync` (`:232-239`):

```csharp
    /// <summary>
    /// Captures the spectator frame for the current state. MUST be called while
    /// holding <c>match.Lock</c>: the sequence and the view are taken together so a
    /// concurrent mutation cannot produce an inconsistent frame. Publish the result
    /// OUTSIDE the lock, inside the EnqueueOutbound closure.
    /// </summary>
    private SpectatorSourceFrame? CaptureSpectatorFrameLocked(LiveMatch match)
    {
        if (_spectators is null) return null;
        return new SpectatorSourceFrame(
            MatchId: match.MatchId,
            ChannelId: match.ChannelId,
            Configuration: match.Configuration,
            Players:
            [
                new DuelPlayerSnapshot(match.PlayerOne.UserId, match.PlayerOne.SessionId, match.PlayerOne.DisplayName),
                new DuelPlayerSnapshot(match.PlayerTwo.UserId, match.PlayerTwo.SessionId, match.PlayerTwo.DisplayName),
            ],
            // Stable db user ids. A participant of this match must never receive a
            // spectator frame for it; they get game.stateUpdated instead.
            ParticipantUserIds: match.SessionToUser.Values.ToHashSet(),
            Sequence: ++match.SpectatorSequence,
            GeneratedAt: DateTimeOffset.UtcNow,
            View: match.Engine.SpectatorView(match.State));
    }

    /// <summary>Advisory: a spectator failure must never break a participant's match.</summary>
    private Task PublishSpectatorFrameAsync(SpectatorSourceFrame? frame)
        => frame is null || _spectators is null
            ? Task.CompletedTask
            : PublishAdvisoryAsync(() => _spectators.PublishDiscreteFrameAsync(frame));

    /// <summary>
    /// Signals match end to spectators exactly once. A dedicated call rather than a
    /// terminal frame, because forfeits fabricate no frame — finalSequence is the
    /// last COMPLETE frame's sequence, and the outcome rides on this call.
    /// </summary>
    private Task EndSpectatorMatchAsync(LiveMatch match, MatchEndReason reason, object outcome)
    {
        if (_spectators is null) return Task.CompletedTask;
        if (Interlocked.Exchange(ref match.SpectatorEnded, 1) != 0) return Task.CompletedTask;
        long finalSequence;
        lock (match.Lock) finalSequence = match.SpectatorSequence;
        return PublishAdvisoryAsync(() => _spectators.EndMatchAsync(
            match.MatchId, match.ChannelId, finalSequence, reason, outcome));
    }
```

- [ ] **Step 6: Capture at the three mutation points**

**Start** — inside `lock (match.Lock)` at `:181`, after `match.Status = "live";` and before `EnqueueOutbound`:

```csharp
                var startFrame = CaptureSpectatorFrameLocked(match);
```

then inside that closure, after the `PublishDuelStateAsync` advisory (`:202`) and before the feed line:

```csharp
                    await PublishSpectatorFrameAsync(startFrame);
                    if (!IsMatchLiveReference(match)) return;
```

**Action** — in `ActionAsync`, inside `lock (match.Lock)`, immediately after `views = ...` (`:325-327`):

```csharp
            var spectatorFrame = CaptureSpectatorFrameLocked(match);
```

then inside the enqueued closure, after the `BroadcastRollFeedAsync` line (`:345`), still inside the `try`:

```csharp
                    await PublishSpectatorFrameAsync(spectatorFrame);
```

**Timeout** — in `HandleTurnTimeoutAsync`, the identical two edits after `views = ...` (`:398-400`) and after `:418`.

- [ ] **Step 7: End at both terminal paths**

**Normal completion** — in `CompleteMatchAsync`, inside the `try`, after the `PublishFeedAsync` advisory (`:490`):

```csharp
            var loser = isDraw ? null : outcome.Participants.FirstOrDefault(p => p.Placement != 1);
            // winnerId / loserId are Mumble SESSION ids, matching game.ended and the
            // spectator views (which are keyed by the engine's session-id state).
            await EndSpectatorMatchAsync(match, MatchEndReason.Completed, new
            {
                winnerId = winner?.UserId,
                loserId = loser?.UserId,
                draw = isDraw,
            });
```

**Forfeit** — in `PublishForfeitAsync`, inside the `try`, after the forfeit feed advisory (`:584`):

```csharp
            await EndSpectatorMatchAsync(match, MatchEndReason.Forfeited, new
            {
                winnerId = otherId,
                loserId = sessionId,
                draw = false,
            });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameSessionManagerTests`
Expected: all PASS, including the five new tests.
Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Server/Games/GameSessionManager.cs tests/Brmble.Server.Tests/Games/GameSessionManagerTests.cs
git commit -m "feat(games): publish spectator frames and match end from GameSessionManager"
```

---

### Task 6: Subscribe / unsubscribe endpoints and DI registration

**Files:**
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs` (DTO near `:11-18`; routes after `POST /games/forfeit` at `:140`)
- Modify: `src/Brmble.Server/Games/GamesExtensions.cs` (register before `AddSingleton<GameSessionManager>()` at `:27`)
- Test: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs` (append)
- Test: `tests/Brmble.Server.Tests/Games/GamesExtensionsTests.cs` (append)

**Interfaces:**
- Consumes: `ISpectatorCoordinator.SubscribeAsync` / `UnsubscribeAsync`, `SpectatorWire.Reason(SpectatorSubscribeReason)`.
- Produces: `POST /games/spectators/subscribe` → `200 { channelId, match: SpectatorSnapshot | null }` or `400 { error, reason }` with `reason` ∈ `notPresent | notSameChannel`; `POST /games/spectators/unsubscribe` → `200 { unsubscribed: true }`. Task 9 calls both from the client.

**Design note:** `channelId` is **validated against** the caller's live channel membership (inside `SubscribeAsync`), never derived from it. A concurrent channel move then fails loudly with `notSameChannel` instead of silently subscribing the user to the wrong channel.

- [ ] **Step 1: Write the failing endpoint tests**

Append to `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs`:

```csharp
    private static WebApplicationFactory<Program> CreateSpectatorFactory(
        Mock<ISpectatorCoordinator> spectators,
        bool hasSession = true,
        string? certHash = "testcerthash123")
    {
        var factory = new BrmbleServerFactory(certHash);
        factory.SessionMappingMock
            .Setup(x => x.TryGetSessionByUserId(It.IsAny<long>(), out It.Ref<int>.IsAny))
            .Returns((long _, out int session) => { session = 55; return hasSession; });
        return factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<ISpectatorCoordinator>();
            services.AddSingleton(spectators.Object);
        }));
    }

    [TestMethod]
    public async Task SpectatorSubscribe_IdleChannel_ReturnsNullMatch()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 7))
            .ReturnsAsync(new SpectatorSubscribeResult(true, null, SpectatorSubscribeReason.None));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual(7, doc.RootElement.GetProperty("channelId").GetInt32());
        Assert.AreEqual(JsonValueKind.Null, doc.RootElement.GetProperty("match").ValueKind);
    }

    [TestMethod]
    public async Task SpectatorSubscribe_LiveChannel_ReturnsTheSnapshot()
    {
        var snapshot = new SpectatorSnapshot(
            1, 91, 7, "deathroll", "1v1", 1,
            [new DuelPlayerSnapshot(100, 10, "Qy"), new DuelPlayerSnapshot(200, 20, "Broan")],
            4, DateTimeOffset.UnixEpoch,
            new DeathrollSpectatorView("deathroll", [10, 20], 10, 50, 73, false, null));
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 7))
            .ReturnsAsync(new SpectatorSubscribeResult(true, snapshot, SpectatorSubscribeReason.None));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var match = doc.RootElement.GetProperty("match");
        Assert.AreEqual(91, match.GetProperty("matchId").GetInt64());
        Assert.AreEqual("deathroll", match.GetProperty("view").GetProperty("kind").GetString());
    }

    [TestMethod]
    public async Task SpectatorSubscribe_CrossChannel_RejectsWithStructuredReason()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        spectators.Setup(x => x.SubscribeAsync(55, It.IsAny<long>(), 8))
            .ReturnsAsync(new SpectatorSubscribeResult(false, null, SpectatorSubscribeReason.NotSameChannel));
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 8 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notSameChannel", doc.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task SpectatorSubscribe_WithNoLiveSession_RejectsWithNotPresent()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, hasSession: false);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notPresent", doc.RootElement.GetProperty("reason").GetString());
        spectators.Verify(x => x.SubscribeAsync(It.IsAny<long>(), It.IsAny<long>(), It.IsAny<int>()), Times.Never);
    }

    [TestMethod]
    public async Task SpectatorSubscribe_Unauthenticated_Returns401()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/games/spectators/subscribe", new { channelId = 7 });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task SpectatorUnsubscribe_Succeeds()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/spectators/unsubscribe", new { });

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.IsTrue(doc.RootElement.GetProperty("unsubscribed").GetBoolean());
        spectators.Verify(x => x.UnsubscribeAsync(55, It.IsAny<long>()), Times.Once);
    }

    [TestMethod]
    public async Task SpectatorUnsubscribe_Unauthenticated_Returns401()
    {
        var spectators = new Mock<ISpectatorCoordinator>();
        await using var factory = CreateSpectatorFactory(spectators, certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/games/spectators/unsubscribe", new { });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }
```

And append to `tests/Brmble.Server.Tests/Games/GamesExtensionsTests.cs`:

```csharp
    [TestMethod]
    public void AddGames_RegistersTheSpectatorServiceAsBothInterfaces()
    {
        using var provider = BuildProvider(); // existing helper in this file

        var coordinator = provider.GetRequiredService<ISpectatorCoordinator>();
        var lifecycle = provider.GetRequiredService<ISpectatorLifecycle>();
        Assert.AreSame(coordinator, lifecycle, "One SpectatorService instance owns both roles.");
    }
```

> If `GamesExtensionsTests` has no `BuildProvider` helper, copy whatever construction the existing tests in that file use.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GameEndpointsTests|GamesExtensionsTests"`
Expected: FAIL — routes return 404 and `ISpectatorCoordinator` is not registered.

- [ ] **Step 3: Register the service**

In `src/Brmble.Server/Games/GamesExtensions.cs`, immediately before `services.AddSingleton<GameSessionManager>();` (`:27`):

```csharp
        // One instance owns both roles: the coordinator (sources publish into it) and
        // the lifecycle (presence teardown calls into it). They share the registry.
        services.AddSingleton<Spectators.SpectatorService>();
        services.AddSingleton<Spectators.ISpectatorCoordinator>(sp => sp.GetRequiredService<Spectators.SpectatorService>());
        services.AddSingleton<Spectators.ISpectatorLifecycle>(sp => sp.GetRequiredService<Spectators.SpectatorService>());
```

- [ ] **Step 4: Add the DTO and the two routes**

In `src/Brmble.Server/Games/GameEndpoints.cs`, add to the DTO block (`:11-18`):

```csharp
internal record SpectateDto(int ChannelId);
```

Add after the `/games/forfeit` route (`:140`):

```csharp
        // Spectating is a CHANNEL mode, not a match view: you subscribe to a channel
        // and keep receiving frames match after match until you stop, move, or
        // disconnect. channelId is VALIDATED against live membership rather than
        // derived from it, so a concurrent channel move fails loudly with
        // notSameChannel instead of silently subscribing you to the wrong channel.
        app.MapPost("/games/spectators/subscribe", async (SpectateDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, ISpectatorCoordinator spectators,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new GameErrorWire(
                    "You must be connected to Brmble.",
                    SpectatorWire.Reason(SpectatorSubscribeReason.NotPresent)));

            var result = await spectators.SubscribeAsync(session, user.UserId, dto.ChannelId);
            if (!result.Success)
                return Results.BadRequest(new GameErrorWire(
                    result.Reason == SpectatorSubscribeReason.NotSameChannel
                        ? "You must be in the channel to watch it."
                        : "You must be connected to Brmble.",
                    SpectatorWire.Reason(result.Reason)));

            // A null match is a SUCCESS: the channel is idle and the subscription is live.
            return Results.Ok(new { channelId = dto.ChannelId, match = result.Match });
        });

        app.MapPost("/games/spectators/unsubscribe", async (HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, ISpectatorCoordinator spectators,
            ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.Ok(new { unsubscribed = true });

            await spectators.UnsubscribeAsync(session, user.UserId);
            return Results.Ok(new { unsubscribed = true });
        });
```

Add `using Brmble.Server.Games.Spectators;` to the file's usings.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GameEndpointsTests|GamesExtensionsTests"`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/GamesExtensions.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs tests/Brmble.Server.Tests/Games/GamesExtensionsTests.cs
git commit -m "feat(games): add spectator subscribe and unsubscribe endpoints"
```

---

### Task 7: Wire lifecycle invalidation to real call sites

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs` (`:167-219`, `:221-256`, `:261-265`, helper near `:267-277`)
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs` (`:127-132`)
- Test: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs` (append)
- Test: `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs` (append)

**Interfaces:**
- Consumes: `ISpectatorLifecycle` (Task 2/4).
- Produces: no new API. Behaviour only.

**Ordering rules that must not be violated:**
- `DispatchUserStateChanged` — call `HandleChannelChangedAsync(sessionId, newChannelId)` **before** `_channelMembership.Update` (`:237`), so the drop happens while the old membership is still readable.
- `DispatchUserDisconnected` — call `HandlePresenceLostAsync(sessionId, SpectatorCloseReason.Disconnected)` **before** session-mapping removal (`:193`) and membership removal (`:205`).
- `DispatchChannelRemoved` — call `HandleChannelRemovedAsync(channel.Id)`.
- `BrmbleWebSocketHandler` — call `HandleTransportDisconnectedAsync(user.Id)` only when the user's **final** application WebSocket closes. The existing idiom is `RemoveClient(ws)` then `!HasConnectedClient(user.Id)` (`:129-131`); reuse it. There is no per-user refcount in this codebase — do not assume one.

- [ ] **Step 1: Write the failing tests**

Append to `MumbleServerCallbackTests`:

```csharp
    [TestMethod]
    public async Task UserStateChanged_DropsSpectatorSubscriptionBeforeMembershipUpdates()
    {
        var order = new List<string>();
        var spectators = new Mock<ISpectatorLifecycle>();
        spectators.Setup(x => x.HandleChannelChangedAsync(It.IsAny<long>(), It.IsAny<int>()))
            .Callback(() => order.Add("spectators")).Returns(Task.CompletedTask);
        var membership = new Mock<IChannelMembershipService>();
        membership.Setup(x => x.Update(It.IsAny<int>(), It.IsAny<int>()))
            .Callback(() => order.Add("membership"));

        var callback = CreateCallback(spectators: spectators.Object, membership: membership.Object);
        await callback.DispatchUserStateChanged(new MumbleUser { SessionId = 30, Name = "Qy" }, channelId: 8);

        spectators.Verify(x => x.HandleChannelChangedAsync(30, 8), Times.Once);
        CollectionAssert.AreEqual(new[] { "spectators", "membership" }, order.ToArray());
    }

    [TestMethod]
    public async Task UserDisconnected_DropsSpectatorSubscription()
    {
        var spectators = new Mock<ISpectatorLifecycle>();
        var callback = CreateCallback(spectators: spectators.Object);

        await callback.DispatchUserDisconnected(new MumbleUser { SessionId = 30, Name = "Qy" });

        spectators.Verify(x => x.HandlePresenceLostAsync(30, SpectatorCloseReason.Disconnected), Times.Once);
    }

    [TestMethod]
    public async Task ChannelRemoved_DropsEverySpectatorInThatChannel()
    {
        var spectators = new Mock<ISpectatorLifecycle>();
        var callback = CreateCallback(spectators: spectators.Object);

        await callback.DispatchChannelRemoved(new MumbleChannel { Id = 7 });

        spectators.Verify(x => x.HandleChannelRemovedAsync(7), Times.Once);
    }

    [TestMethod]
    public async Task SpectatorLifecycleFailure_DoesNotBreakDispatch()
    {
        var spectators = new Mock<ISpectatorLifecycle>();
        spectators.Setup(x => x.HandleChannelRemovedAsync(It.IsAny<int>()))
            .ThrowsAsync(new InvalidOperationException("boom"));
        var callback = CreateCallback(spectators: spectators.Object);

        await callback.DispatchChannelRemoved(new MumbleChannel { Id = 7 });
        // No exception escapes.
    }
```

> `CreateCallback` is this file's existing construction helper. Extend it with an optional `ISpectatorLifecycle? spectators = null` parameter defaulting to `Mock.Of<ISpectatorLifecycle>()`, and an optional `IChannelMembershipService? membership = null`, mirroring how it already handles the other collaborators. Adjust `MumbleUser` / `MumbleChannel` construction to whatever the existing tests in this file use.

Append to `BrmbleWebSocketHandlerTests`:

```csharp
    [TestMethod]
    public async Task FinalSocketClose_DropsTheSpectatorSubscription()
    {
        var spectators = new Mock<ISpectatorLifecycle>();
        // Arrange a single socket for the user, then close it.
        await RunHandlerUntilCloseAsync(spectators.Object, remainingSocketsAfterClose: 0);

        spectators.Verify(x => x.HandleTransportDisconnectedAsync(It.IsAny<long>()), Times.Once);
    }

    [TestMethod]
    public async Task NonFinalSocketClose_KeepsTheSpectatorSubscription()
    {
        var spectators = new Mock<ISpectatorLifecycle>();
        await RunHandlerUntilCloseAsync(spectators.Object, remainingSocketsAfterClose: 1);

        spectators.Verify(x => x.HandleTransportDisconnectedAsync(It.IsAny<long>()), Times.Never);
    }
```

> Build `RunHandlerUntilCloseAsync` on top of whatever socket-driving helper this test file already has. `remainingSocketsAfterClose` is expressed by controlling what `IBrmbleEventBus.HasConnectedClient(userId)` returns after `RemoveClient` — the same signal the production code reads.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MumbleServerCallbackTests|BrmbleWebSocketHandlerTests"`
Expected: compile error / FAIL — no `ISpectatorLifecycle` collaborator exists.

- [ ] **Step 3: Inject and call from `MumbleServerCallback`**

Add `ISpectatorLifecycle _spectators` to the constructor and fields. Add an error wrapper next to `TryNotifyDuelsAsync` (`:267-277`):

```csharp
    // Mirrors TryNotifyDuelsAsync: spectator teardown is best-effort and must never
    // break a Mumble dispatch. A failed drop leaves a subscription that the next
    // teardown or an explicit unsubscribe will clear.
    private async Task TryNotifySpectatorsAsync(Func<Task> notify, string context, object subject)
    {
        try { await notify(); }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Spectator teardown failed during {Context} for {Subject}.", context, subject);
        }
    }
```

In `DispatchUserStateChanged`, immediately **before** `_channelMembership.Update(user.SessionId, channelId);` (`:237`):

```csharp
        // Before the membership update: authorization is same-channel, and the drop
        // must be decided while the OLD channel is still readable.
        await TryNotifySpectatorsAsync(
            () => _spectators.HandleChannelChangedAsync(user.SessionId, channelId),
            "channel change", user.SessionId);
```

In `DispatchUserDisconnected`, immediately **before** the session-mapping removal block (`:191`):

```csharp
        await TryNotifySpectatorsAsync(
            () => _spectators.HandlePresenceLostAsync(user.SessionId, SpectatorCloseReason.Disconnected),
            "user disconnect", user.SessionId);
```

In `DispatchChannelRemoved` (`:261-265`), before the duel notification:

```csharp
        await TryNotifySpectatorsAsync(
            () => _spectators.HandleChannelRemovedAsync(channel.Id), "channel removal", channel.Id);
```

Add `using Brmble.Server.Games.Spectators;`.

- [ ] **Step 4: Call from `BrmbleWebSocketHandler`**

Resolve `ISpectatorLifecycle` alongside the handler's other services and extend the `finally` (`:127-132`):

```csharp
            finally
            {
                eventBus.RemoveClient(ws);
                if (!eventBus.HasConnectedClient(user.Id))
                {
                    activeSessions.Deactivate(hash);
                    // Only the user's FINAL application socket clears the subscription.
                    // Reconnecting requires an explicit fresh subscribe; nothing is
                    // restored implicitly.
                    try { await spectators.HandleTransportDisconnectedAsync(user.Id); }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "Spectator teardown failed for user {UserId} on socket close.", user.Id);
                    }
                }
            }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Mumble/MumbleServerCallback.cs src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs
git commit -m "feat(games): invalidate spectator subscriptions on presence and transport loss"
```

---

### Task 8: `/games/action` ownership guard

**Files:**
- Modify: `src/Brmble.Server/Games/GameEndpoints.cs:112-122`
- Test: `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs` (append)

**Interfaces:**
- Consumes: `IDuelMatchRunnerRouter.TryGetActiveMatch(long userId, out ActiveMatchReference)` — the same guard `/games/forfeit` already uses (`GameEndpoints.cs:132`); `GameErrorWire` (`DuelWire.cs:203`); `DuelWire.Reason(DuelRejectReason.NotParticipant)`.
- Produces: no new API.

**Why now:** `POST /games/action` performs no ownership check and never null-checks `dto.Action`; it relies entirely on the engine rejecting a foreign session (deferred defect #2 of `docs/superpowers/reviews/2026-07-28-duel-orchestration-queue-review.md`). Today that is theoretical. The moment non-participants can see a live match it becomes a real privilege boundary — "spectators cannot submit game actions" is a stated requirement that nothing currently enforces at the endpoint.

- [ ] **Step 1: Write the failing tests**

Append to `GameEndpointsTests`:

```csharp
    [TestMethod]
    public async Task Action_FromANonParticipant_IsRejected()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        router.Setup(x => x.TryGetActiveMatch(It.IsAny<long>(), out It.Ref<ActiveMatchReference>.IsAny))
            .Returns(false);
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/action", new
        {
            matchId = 91,
            action = new Dictionary<string, object?> { ["pick"] = "rock" },
        });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("notParticipant", doc.RootElement.GetProperty("reason").GetString());
    }

    [TestMethod]
    public async Task Action_ForADifferentMatch_IsRejected()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        router.Setup(x => x.TryGetActiveMatch(It.IsAny<long>(), out It.Ref<ActiveMatchReference>.IsAny))
            .Returns((long _, out ActiveMatchReference m) =>
            {
                m = new ActiveMatchReference(42, 1, 7, "discrete");
                return true;
            });
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/action", new
        {
            matchId = 91,
            action = new Dictionary<string, object?> { ["pick"] = "rock" },
        });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task Action_WithANullAction_IsRejected()
    {
        var orchestrator = new Mock<IDuelOrchestrator>();
        var router = new Mock<IDuelMatchRunnerRouter>();
        router.Setup(x => x.TryGetActiveMatch(It.IsAny<long>(), out It.Ref<ActiveMatchReference>.IsAny))
            .Returns((long _, out ActiveMatchReference m) =>
            {
                m = new ActiveMatchReference(91, 1, 7, "discrete");
                return true;
            });
        await using var factory = CreateFactory(orchestrator, router);
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var response = await client.PostAsJsonAsync("/games/action", new { matchId = 91, action = (object?)null });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.AreEqual("invalidAction", doc.RootElement.GetProperty("reason").GetString());
    }
```

> If `DuelRejectReason` has no `InvalidAction` member, add one and map it in `DuelWire.Reason` to `"invalidAction"`. If it already has an equivalent, use that name and update the assertion to match.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter GameEndpointsTests`
Expected: FAIL — the endpoint currently returns 200 for all three.

- [ ] **Step 3: Add the guard**

Replace `GameEndpoints.cs:112-122` with:

```csharp
        app.MapPost("/games/action", async (ActionDto dto, HttpContext ctx,
            ICertificateHashExtractor certs, UserRepository users, GameSessionManager mgr,
            IDuelMatchRunnerRouter runner, ISessionMappingService sessions) =>
        {
            var user = await ResolveUserAsync(ctx, certs, users);
            if (user is null) return Results.Unauthorized();
            if (!sessions.TryGetSessionByUserId(user.UserId, out var session))
                return Results.BadRequest(new { error = "You must be connected to Brmble." });
            if (dto.Action is null)
                return Results.BadRequest(new GameErrorWire(
                    "An action is required.", DuelWire.Reason(DuelRejectReason.InvalidAction)));
            // Spectators can now SEE a live match, so this is a real privilege
            // boundary rather than a theoretical one. Same guard as /games/forfeit.
            if (!runner.TryGetActiveMatch(user.UserId, out var active) || active.MatchId != dto.MatchId)
                return Results.BadRequest(new GameErrorWire(
                    "The requested match is not the authenticated user's active match.",
                    DuelWire.Reason(DuelRejectReason.NotParticipant)));

            await mgr.ActionAsync(dto.MatchId, session, dto.Action);
            return Results.Ok();
        });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: all PASS. If a pre-existing action test now fails because its `CreateFactory` call did not stub `IDuelMatchRunnerRouter.TryGetActiveMatch`, stub it to return the match under test — the endpoint genuinely requires it now.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Server/Games/GameEndpoints.cs src/Brmble.Server/Games/Duels/DuelWire.cs src/Brmble.Server/Games/Duels/DuelModels.cs tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs
git commit -m "fix(games): enforce match ownership and non-null action on /games/action"
```

**Server half is now complete. Run the full suite before starting Task 9:**
Run: `dotnet build` then `dotnet test`
Expected: green.

---

### Task 9: Client transport — `api/games.ts` and `GameService.cs`

**Files:**
- Modify: `src/Brmble.Web/src/api/games.ts` (types near `:47-121`; functions at end of file)
- Modify: `src/Brmble.Client/Services/Games/GameService.cs` (new cases in `HandleRequestAsync`'s switch, `:95-155`)
- Test: `src/Brmble.Web/src/api/games.spectator.test.ts` (create)

**Interfaces:**
- Consumes: `bridgeRequest` (`api/games.ts:292-333`), `toGameApiError` (`:146-161`), `DuelPlayer` (`:47-52`).
- Produces:
  - `type SpectatorView = DeathrollSpectatorView | RpsSpectatorView`
  - `interface SpectatorSnapshot { schemaVersion: 1; matchId: number; channelId: number; gameType: string; format: string; rulesetVersion: number; players: DuelPlayer[]; sequence: number; generatedAt: string; view: SpectatorView }`
  - `interface SpectatorSubscribeResponse { channelId: number; match: SpectatorSnapshot | null }`
  - `function subscribeSpectator(channelId: number): Promise<SpectatorSubscribeResponse>`
  - `function unsubscribeSpectator(): Promise<void>`
  - `function isRpsSpectatorView(view: SpectatorView): view is RpsSpectatorView`
  Tasks 14–17 consume all of these.

**Why the tunnel:** `subscribe` returns a body. The fire-and-forget `bridge.send('game.x')` path (`GameService.cs:52-58`) discards bodies. Anything needing a response goes through `games.request` → `games.response` correlation. Inbound `game.spectator*` events need **no** client change — `MumbleAdapter.cs:2752` prefix-forwards any `game.*` verbatim.

- [ ] **Step 1: Write the failing test**

Create `src/Brmble.Web/src/api/games.spectator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeSpectator, unsubscribeSpectator, isRpsSpectatorView } from './games';
import bridge from '../bridge';

describe('spectator api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('over the WebView bridge', () => {
    beforeEach(() => {
      vi.stubGlobal('chrome', { webview: {} });
    });

    it('tunnels subscribe through games.request and resolves the parsed body', async () => {
      const send = vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId, success: true, body: JSON.stringify({ channelId: 7, match: null }),
        })));
      });

      await expect(subscribeSpectator(7)).resolves.toEqual({ channelId: 7, match: null });
      expect(send).toHaveBeenCalledWith('games.request', expect.objectContaining({
        action: 'spectate-subscribe', channelId: 7,
      }));
    });

    it('tunnels unsubscribe through games.request', async () => {
      const send = vi.spyOn(bridge, 'send').mockImplementation((type, data) => {
        if (type !== 'games.request') return;
        const { requestId } = data as { requestId: number };
        queueMicrotask(() => bridge._handlers.get('games.response')?.forEach(h => h({
          requestId, success: true, body: JSON.stringify({ unsubscribed: true }),
        })));
      });

      await expect(unsubscribeSpectator()).resolves.toBeUndefined();
      expect(send).toHaveBeenCalledWith('games.request', expect.objectContaining({
        action: 'spectate-unsubscribe',
      }));
    });
  });

  describe('over fetch', () => {
    it('posts the channel id and returns the body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ channelId: 7, match: null }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(subscribeSpectator(7)).resolves.toEqual({ channelId: 7, match: null });
      expect(fetchMock).toHaveBeenCalledWith('/games/spectators/subscribe', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channelId: 7 }),
      }));
    });

    it('surfaces the structured reason on rejection', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
        JSON.stringify({ error: 'You must be in the channel to watch it.', reason: 'notSameChannel' }),
        { status: 400 },
      )));

      await expect(subscribeSpectator(8)).rejects.toMatchObject({ reason: 'notSameChannel' });
    });
  });

  it('narrows an rps view by kind', () => {
    expect(isRpsSpectatorView({
      kind: 'rps', players: [10, 20], bestOf: 3, targetWins: 2, roundNumber: 1,
      roundWins: [0, 0], committed: [false, false], finished: false, winnerId: null, lastRound: null,
    })).toBe(true);
    expect(isRpsSpectatorView({
      kind: 'deathroll', players: [10, 20], currentPlayer: 10, ceiling: 100,
      lastRoll: null, finished: false, loserId: null,
    })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/Brmble.Web; npm run test -- games.spectator`
Expected: FAIL — `subscribeSpectator` is not exported.

- [ ] **Step 3: Add the types**

In `src/Brmble.Web/src/api/games.ts`, after `DuelQueueSnapshot` (`:121`):

```ts
/**
 * What a non-participant may see of a live Deathroll match. Player ids here are
 * Mumble SESSION ids (the engine's own state keys), NOT db user ids — resolve
 * them against `SpectatorSnapshot.players[].sessionId`.
 */
export interface DeathrollSpectatorView {
  kind: 'deathroll';
  players: number[];
  currentPlayer: number | null;
  ceiling: number;
  lastRoll: number | null;
  finished: boolean;
  loserId: number | null;
}

/** A resolved RPS round. Throws are public only once the round is over. */
export interface RpsResolvedRound {
  roundNumber: number;
  sequence: number;
  pick0: string;
  pick1: string;
  winnerId: number | null;
  tie: boolean;
}

/**
 * What a non-participant may see of a live RPS match. `committed` carries WHETHER
 * each player has thrown, never WHAT. There is deliberately no `picks`, `myPick`
 * or `opponentPicked`: resolved throws exist only inside `lastRound`.
 * Player ids are Mumble SESSION ids.
 */
export interface RpsSpectatorView {
  kind: 'rps';
  players: number[];
  bestOf: number;
  targetWins: number;
  roundNumber: number;
  roundWins: number[];
  committed: boolean[];
  finished: boolean;
  winnerId: number | null;
  lastRound: RpsResolvedRound | null;
}

export type SpectatorView = DeathrollSpectatorView | RpsSpectatorView;

export function isRpsSpectatorView(view: SpectatorView): view is RpsSpectatorView {
  return view.kind === 'rps';
}

export interface SpectatorSnapshot {
  schemaVersion: 1;
  matchId: number;
  channelId: number;
  gameType: string;
  format: string;
  rulesetVersion: number;
  players: DuelPlayer[];
  sequence: number;
  generatedAt: string;
  view: SpectatorView;
}

/** `match` is null when the channel is idle. That is a SUCCESSFUL subscription. */
export interface SpectatorSubscribeResponse {
  channelId: number;
  match: SpectatorSnapshot | null;
}

export interface SpectatorMatchEndedEvent {
  schemaVersion: 1;
  matchId: number;
  channelId: number;
  reason: 'completed' | 'forfeited';
  finalSequence: number;
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean };
}

export type SpectatorCloseReason =
  | 'unsubscribed' | 'authorizationLost' | 'disconnected' | 'channelRemoved';

export interface SpectatorClosedEvent {
  channelId: number;
  reason: SpectatorCloseReason;
}
```

- [ ] **Step 4: Add the two functions**

Append to `src/Brmble.Web/src/api/games.ts`:

```ts
/**
 * Subscribes to a CHANNEL, not a match: frames keep arriving match after match
 * until you unsubscribe, move channel, or disconnect. Uses the games.request
 * tunnel rather than the fire-and-forget POST path because it returns a body.
 */
export async function subscribeSpectator(channelId: number): Promise<SpectatorSubscribeResponse> {
  if (isWebViewBridgeAvailable()) {
    return bridgeRequest<SpectatorSubscribeResponse>({ action: 'spectate-subscribe', channelId });
  }

  const response = await fetch('/games/spectators/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId }),
  });
  if (!response.ok) {
    throw await toGameApiError(response);
  }
  return response.json() as Promise<SpectatorSubscribeResponse>;
}

export async function unsubscribeSpectator(): Promise<void> {
  if (isWebViewBridgeAvailable()) {
    await bridgeRequest<{ unsubscribed: boolean }>({ action: 'spectate-unsubscribe' });
    return;
  }

  const response = await fetch('/games/spectators/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return unwrap(response);
}
```

- [ ] **Step 5: Add the two bridge cases**

In `src/Brmble.Client/Services/Games/GameService.cs`, inside `HandleRequestAsync`'s `switch (action)` (before `default:` at `:152`):

```csharp
                case "spectate-subscribe":
                {
                    var channelId = data.TryGetProperty("channelId", out var chEl)
                        && chEl.ValueKind == JsonValueKind.Number
                        && chEl.TryGetInt32(out var parsedChannel)
                        ? parsedChannel
                        : (int?)null;
                    if (channelId is null)
                    {
                        SendResponse(requestId, false, null, 0, "Missing channelId for spectate-subscribe request");
                        return;
                    }
                    var body = JsonSerializer.Serialize(new { channelId });
                    var result = await _postJsonAsync(cert, new Uri(baseUri, "games/spectators/subscribe"), body);
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
                case "spectate-unsubscribe":
                {
                    var result = await _postJsonAsync(cert, new Uri(baseUri, "games/spectators/unsubscribe"), "{}");
                    SendResponse(requestId, result.Success, result.Body, result.StatusCode, result.Error);
                    break;
                }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- games.spectator`
Expected: 5 tests PASS.
Run: `cd src/Brmble.Web; npm run type-check`
Expected: clean.
Run: `dotnet build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/api/games.ts src/Brmble.Web/src/api/games.spectator.test.ts src/Brmble.Client/Services/Games/GameService.cs
git commit -m "feat(games): add spectator subscribe/unsubscribe client transport"
```

---

### Task 10: Rename `DeathrollModal` → `DeathrollBoard`

**Files:**
- Rename: `src/Brmble.Web/src/components/Games/DeathrollModal.tsx` → `DeathrollBoard.tsx`
- Rename: `src/Brmble.Web/src/components/Games/DeathrollModal.module.css` → `DeathrollBoard.module.css`
- Modify: `src/Brmble.Web/src/App.tsx:45` (import) and its render site (~`:5177`)
- Modify: `src/Brmble.Web/src/App.duelOrchestration.test.tsx:5` and usages at `:139-146`, `:156`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function DeathrollBoard(props: DeathrollBoardProps)`. Props are **unchanged** in shape — only the interface name changes: `view`, `ended`, `myUserId`, `turnDeadline`, `turnWindowMs`, `penalty`, `resolveName`, `onRoll`, `onForfeit`, `onClose`, `onRematch?`, `rematchPending?`.

**Why:** these are no longer modals — no `role="dialog"`, no `aria-modal`, no overlay, no focus trap (see the comment at `DeathrollModal.tsx:80-81`). Only the names still say so, and this project adds `*SpectatorBoard` siblings that make the inconsistency visible in a directory listing. Rename now, while the sibling files are being added and the compiler catches every site. **This carries no behaviour change.**

**Note:** the global `deathroll-modal` className at `DeathrollModal.tsx:83` is a **dead hook** — no stylesheet in the repo defines `.deathroll-modal`. Renaming it to `deathroll-board` is a string edit with no visual effect. The shared `.modal-close`, `.modal-header` and `.modal-title` classes **stay**: they are a documented cross-app convention (`docs/UI_GUIDE.md:327-330`), not a claim about being a dialog.

- [ ] **Step 1: Rename the files with git**

```bash
cd src/Brmble.Web/src/components/Games
git mv DeathrollModal.tsx DeathrollBoard.tsx
git mv DeathrollModal.module.css DeathrollBoard.module.css
```

- [ ] **Step 2: Rename the symbols inside `DeathrollBoard.tsx`**

Four edits, no logic change:

```tsx
import styles from './DeathrollBoard.module.css';

interface DeathrollBoardProps {
```

```tsx
export function DeathrollBoard({
```

```tsx
}: DeathrollBoardProps) {
```

and the root className (`:83`):

```tsx
    <div className={`deathroll-board glass-panel animate-slide-up ${styles.modal}`}>
```

- [ ] **Step 3: Run type-check to find every remaining site**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: errors in `App.tsx` and `App.duelOrchestration.test.tsx` only. That list is the complete set of call sites.

- [ ] **Step 4: Update the call sites**

`App.tsx:45`:

```tsx
import { DeathrollBoard } from './components/Games/DeathrollBoard';
```

and its JSX element (`<DeathrollModal` → `<DeathrollBoard`, closing tag too). Same two edits in `App.duelOrchestration.test.tsx` (import at `:5`, references at `:139-146` and `:156`).

- [ ] **Step 5: Verify**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: clean.
Run: `cd src/Brmble.Web; npm run test`
Expected: all PASS, unchanged count.

```bash
git grep -n "DeathrollModal"
```
Expected: **no matches outside `docs/`**.

- [ ] **Step 6: Commit**

```bash
git add -A src/Brmble.Web/src
git commit -m "refactor(games): rename DeathrollModal to DeathrollBoard"
```

---

### Task 11: Rename `RpsModal` → `RpsBoard`

**Files:**
- Rename: `src/Brmble.Web/src/components/Games/RpsModal.tsx` → `RpsBoard.tsx`
- Rename: `src/Brmble.Web/src/components/Games/RpsModal.module.css` → `RpsBoard.module.css`
- Modify: `src/Brmble.Web/src/App.tsx:46` (import) and its render site (~`:5161`)
- Modify: `src/Brmble.Web/src/App.duelOrchestration.test.tsx:6` and usages at `:139-146`, `:156`

**Interfaces:**
- Produces: `export function RpsBoard(props: RpsBoardProps)`. Props unchanged in shape: identical to `DeathrollBoardProps` except `onPick: (pick: string) => void` replaces `onRoll`.

- [ ] **Step 1: Rename the files with git**

```bash
cd src/Brmble.Web/src/components/Games
git mv RpsModal.tsx RpsBoard.tsx
git mv RpsModal.module.css RpsBoard.module.css
```

- [ ] **Step 2: Rename the symbols inside `RpsBoard.tsx`**

```tsx
import styles from './RpsBoard.module.css';

interface RpsBoardProps {
```

```tsx
export function RpsBoard({
```

```tsx
}: RpsBoardProps) {
```

and the root className (`:182`):

```tsx
    <div className={`rps-board glass-panel animate-slide-up ${styles.modal}`}>
```

Leave `PICKS`, `REVEAL_SECONDS`, `pickLabel` and the reveal-suspense logic untouched — this rename carries no behaviour change.

- [ ] **Step 3: Run type-check to find every remaining site**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: errors in `App.tsx` and `App.duelOrchestration.test.tsx` only.

- [ ] **Step 4: Update the call sites**

`App.tsx:46`:

```tsx
import { RpsBoard } from './components/Games/RpsBoard';
```

and its JSX element. Same in `App.duelOrchestration.test.tsx`.

- [ ] **Step 5: Verify**

Run: `cd src/Brmble.Web; npm run type-check` → clean.
Run: `cd src/Brmble.Web; npm run test` → all PASS.

```bash
git grep -n "RpsModal"
```
Expected: **no matches outside `docs/`**. (`DuelQueueModal` keeps its name — it genuinely is a dialog.)

- [ ] **Step 6: Commit**

```bash
git add -A src/Brmble.Web/src
git commit -m "refactor(games): rename RpsModal to RpsBoard"
```

---

### Task 12: The exhaustive-switch fix — `assertNever`, label map, stage switch

> **This task MUST land before Task 13.** Two sites in `App.tsx` are exhaustive over exactly two `ChannelActivityKind` members and use a bare else, so adding a third kind produces **no type error** and silently mislabels it as "Paint". Merged with Task 13, the compiler catches nothing. This is an ordered step, not a discovery.

**Files:**
- Create: `src/Brmble.Web/src/utils/assertNever.ts`
- Create: `src/Brmble.Web/src/utils/assertNever.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx:5123-5151`

**Interfaces:**
- Consumes: `ChannelActivityKind` (`workspace/channelActivity.ts:1`).
- Produces: `export function assertNever(value: never): never`, and in `App.tsx` a module-scope `const ACTIVITY_LABELS: Record<ChannelActivityKind, string>`. Task 13 adds one entry to that record and the compiler requires it.

- [ ] **Step 1: Write the failing test**

Create `src/Brmble.Web/src/utils/assertNever.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertNever } from './assertNever';

describe('assertNever', () => {
  it('throws with the unhandled value, so a missed union member fails loudly at runtime too', () => {
    expect(() => assertNever('spectate' as never)).toThrow(/spectate/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/Brmble.Web; npm run test -- assertNever`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `src/Brmble.Web/src/utils/assertNever.ts`:

```ts
/**
 * Exhaustiveness guard. Put this in a `default:` (or final `else`) branch over a
 * union: TypeScript only accepts the call when every member has been handled, so
 * adding a union member turns a silent fallthrough into a compile error.
 *
 * It also throws at runtime, because narrowing can be defeated by data arriving
 * from outside the type system (a server event, `JSON.parse`), and a loud failure
 * beats a silently wrong render.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
}
```

- [ ] **Step 4: Replace the chip label ternary with a total record**

In `App.tsx`, at module scope (next to the other module-level constants, above the `App` component):

```tsx
// A total Record, not a ternary. Adding a ChannelActivityKind without a label is
// now a compile error rather than a chip silently rendering as "Paint".
const ACTIVITY_LABELS: Record<ChannelActivityKind, string> = {
  'screen-share': 'Screen share',
  paint: 'Paint',
};
```

Then replace `App.tsx:5123-5126`:

```tsx
          activities={availableActivities.map(kind => ({
            kind,
            label: ACTIVITY_LABELS[kind],
          }))}
```

- [ ] **Step 5: Replace the stage-body ternary chain with an exhaustive switch**

Replace `App.tsx:5130-5151` with a call to a `renderStage` helper defined just above `activityRegion` (inside the component, so it closes over the same values the ternary did):

```tsx
  const renderStage = (staged: ChannelActivityKind | null) => {
    // A switch with assertNever, not a ternary chain: a new activity kind must not
    // be able to fall through to `null` and render an empty stage.
    switch (staged) {
      case null:
        return null;
      case 'screen-share':
        return (
          <ScreenShareGrid
            watchingShares={watchingShares}
            focusedShare={focusedShare}
            videoElements={remoteVideoEls}
            roomQuality={roomQuality}
            shareQualities={shareQualities}
            viewerQualities={viewerQualities}
            onFocus={setFocusedShare}
            onClose={handleCloseWatchedShare}
            onViewerQualityChange={setViewerQuality}
          />
        );
      case 'paint':
        return activePaintSessionId ? (
          <PaintSessionView
            key={activePaintSessionId}
            sessionId={activePaintSessionId}
            matrixClient={matrixClient.client}
            channelRoomMap={matrixCredentials?.roomMap}
            currentVoiceChannelId={paintVoiceChannelId}
            onClose={handleClosePaint}
          />
        ) : null;
      default:
        return assertNever(staged);
    }
  };
```

and the region body becomes:

```tsx
        >
          {renderStage(stage)}
        </ChannelActivityRegion>
```

Add the import:

```tsx
import { assertNever } from './utils/assertNever';
```

- [ ] **Step 6: Prove the guard actually guards**

Temporarily add `| 'spectate'` to `ChannelActivityKind` in `workspace/channelActivity.ts` and run:

Run: `cd src/Brmble.Web; npm run type-check`
Expected: **two** errors — a missing `spectate` property on `ACTIVITY_LABELS`, and `assertNever` receiving `'spectate'` instead of `never`. **Then revert the temporary union change.** If you saw fewer than two errors, the fix is incomplete — do not proceed to Task 13.

- [ ] **Step 7: Run the tests**

Run: `cd src/Brmble.Web; npm run type-check` → clean.
Run: `cd src/Brmble.Web; npm run test` → all PASS (`App.activityRegion.test.tsx` in particular must be unchanged and green).

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/utils/assertNever.ts src/Brmble.Web/src/utils/assertNever.test.ts src/Brmble.Web/src/App.tsx
git commit -m "refactor(ui): make channel activity kind handling exhaustive"
```

---

### Task 13: `'spectate'` joins `ChannelActivityKind`

**Files:**
- Modify: `src/Brmble.Web/src/workspace/channelActivity.ts:1`
- Modify: `src/Brmble.Web/src/App.tsx` (`ACTIVITY_LABELS` from Task 12)
- Test: `src/Brmble.Web/src/workspace/channelActivity.test.ts` (append)

**Interfaces:**
- Produces: `export type ChannelActivityKind = 'screen-share' | 'paint' | 'spectate';` Tasks 17 and 19 depend on it.

**Why `'spectate'` and not `'game'`:** `MainPanelMode` is already `'game' | 'split'`, where `'game'` means **participating** — the exact distinction `docs/UI_GUIDE.md:245` depends on. Two `'game'` values meaning opposite things would be a trap in the one place the guide most needs to be unambiguous. The user-facing chip label is `Game`, which is game-neutral and does not presume two players.

`selectStage` needs **no change** — it has no per-kind branching.

- [ ] **Step 1: Write the failing tests**

Append to `src/Brmble.Web/src/workspace/channelActivity.test.ts`:

```ts
  it('stages spectate when it is the only activity', () => {
    expect(selectStage({ available: ['spectate'], explicit: null, previous: null })).toBe('spectate');
  });

  it('does not let spectate steal the stage from a live activity', () => {
    expect(selectStage({ available: ['paint', 'spectate'], explicit: null, previous: 'paint' })).toBe('paint');
  });

  it('honours an explicit click on spectate', () => {
    expect(selectStage({ available: ['screen-share', 'paint', 'spectate'], explicit: 'spectate', previous: 'paint' }))
      .toBe('spectate');
  });

  it('hands the stage over when spectating stops', () => {
    expect(selectStage({ available: ['paint'], explicit: 'spectate', previous: 'spectate' })).toBe('paint');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: FAIL — `'spectate'` is not assignable to `ChannelActivityKind`.

- [ ] **Step 3: Extend the union**

`src/Brmble.Web/src/workspace/channelActivity.ts:1`:

```ts
/**
 * The kind is 'spectate', NOT 'game': MainPanelMode is already 'game' | 'split'
 * where 'game' means PARTICIPATING. Game mode is entered by participating in a
 * game, never by spectating one (docs/UI_GUIDE.md), so two 'game' values meaning
 * opposite things would be a trap. The user-facing chip label is 'Game'.
 */
export type ChannelActivityKind = 'screen-share' | 'paint' | 'spectate';
```

- [ ] **Step 4: Add the label (the compiler now demands it)**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: an error on `ACTIVITY_LABELS` — *this is Task 12 doing its job*. Fix it:

```tsx
const ACTIVITY_LABELS: Record<ChannelActivityKind, string> = {
  'screen-share': 'Screen share',
  paint: 'Paint',
  // Game-neutral: does not presume two players.
  spectate: 'Game',
};
```

- [ ] **Step 5: Add the stage case (the compiler now demands it too)**

Run: `cd src/Brmble.Web; npm run type-check`
Expected: an error on `assertNever(staged)`. Add a placeholder case that Task 17 fills in:

```tsx
      case 'spectate':
        // Filled in by Task 17 (SpectatorActivity). Rendering null here keeps the
        // switch exhaustive without pretending the stage works yet.
        return null;
```

- [ ] **Step 6: Add the label-map test**

Append to `src/Brmble.Web/src/workspace/channelActivity.test.ts`:

```ts
describe('ChannelActivityKind', () => {
  it('has exactly three members', () => {
    const all: ChannelActivityKind[] = ['screen-share', 'paint', 'spectate'];
    expect(new Set(all).size).toBe(3);
  });
});
```

and import the type at the top of that file:

```ts
import { selectStage, type ChannelActivityKind } from './channelActivity';
```

- [ ] **Step 7: Verify**

Run: `cd src/Brmble.Web; npm run type-check` → clean.
Run: `cd src/Brmble.Web; npm run test` → all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/workspace/channelActivity.ts src/Brmble.Web/src/workspace/channelActivity.test.ts src/Brmble.Web/src/App.tsx
git commit -m "feat(ui): add spectate to ChannelActivityKind"
```

---

### Task 14: `useSpectatorState`

**Files:**
- Create: `src/Brmble.Web/src/components/Games/useSpectatorState.ts`
- Create: `src/Brmble.Web/src/components/Games/spectatorTestHarness.ts`
- Create: `src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx`

**Interfaces:**
- Consumes: `bridge` (`src/Brmble.Web/src/bridge.ts`), `subscribeSpectator` / `unsubscribeSpectator` / `SpectatorSnapshot` / `SpectatorMatchEndedEvent` / `SpectatorClosedEvent` / `SpectatorCloseReason` (Task 9).
- Produces:

```ts
export interface SpectatorState {
  /** The channel being watched, or null. Spectating is a CHANNEL mode. */
  spectatingChannelId: number | null;
  /** The latest frame, or null when the channel is idle. */
  match: SpectatorSnapshot | null;
  /** Set when the staged match ended; cleared when the next match's first frame arrives. */
  ended: SpectatorMatchEndedEvent | null;
  /** Why the server closed the subscription, if it did. */
  closeReason: SpectatorCloseReason | null;
  startSpectating: (channelId: number) => Promise<void>;
  stopSpectating: () => void;
  reset: () => void;
}
export function useSpectatorState(): SpectatorState;
```

Task 17 consumes `match`, `ended`, `stopSpectating`. Task 19 consumes `spectatingChannelId`, `startSpectating`, `closeReason`.

**Design notes:**
- Guard structure is modelled on `useDuelQueueState.ts:101-124` so the two hooks read alike: schema-version check, channel identity, then a monotonic `(matchId, sequence)` gate.
- A **new `matchId` resets the sequence gate** and clears `ended`. This is how "spectating outlives a match" works with no resubscribe.
- `ended` does **not** clear `match`: the Ended stage shows the same board with its result until the next match starts (spec §12).
- Reset on `voice.connected` and `voice.channelChanged`. Reconnecting requires an explicit fresh subscribe — nothing is restored implicitly.

- [ ] **Step 1: Create the test harness**

Create `src/Brmble.Web/src/components/Games/spectatorTestHarness.ts`, modelled on `duelTestHarness.ts`:

```ts
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { SpectatorSnapshot, SpectatorSubscribeResponse } from '../../api/games';

export const handlers = new Map<string, ((data: unknown) => void)[]>();

export const bridge = {
  _handlers: handlers,
  on: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, [...(handlers.get(type) ?? []), handler]);
  },
  off: (type: string, handler: (data: unknown) => void) => {
    handlers.set(type, (handlers.get(type) ?? []).filter(h => h !== handler));
  },
  send: vi.fn(),
  once: vi.fn(),
  init: vi.fn(),
};

export const api = {
  subscribeSpectator: vi.fn<(channelId: number) => Promise<SpectatorSubscribeResponse>>(),
  unsubscribeSpectator: vi.fn<() => Promise<void>>(),
};

export function emit(type: string, data: unknown) {
  act(() => { handlers.get(type)?.forEach(handler => handler(data)); });
}

export function resetHarness() {
  handlers.clear();
  bridge.send.mockReset();
  api.subscribeSpectator.mockReset().mockResolvedValue({ channelId: 7, match: null });
  api.unsubscribeSpectator.mockReset().mockResolvedValue(undefined);
}

export function snapshot(overrides: Partial<SpectatorSnapshot> = {}): SpectatorSnapshot {
  return {
    schemaVersion: 1,
    matchId: 91,
    channelId: 7,
    gameType: 'deathroll',
    format: '1v1',
    rulesetVersion: 1,
    players: [
      { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
      { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
    ],
    sequence: 1,
    generatedAt: '2026-08-24T14:30:04.000Z',
    view: {
      kind: 'deathroll', players: [10, 20], currentPlayer: 20,
      ceiling: 50, lastRoll: 73, finished: false, loserId: null,
    },
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpectatorState } from './useSpectatorState';
import { api, emit, resetHarness, snapshot } from './spectatorTestHarness';

vi.mock('../../bridge', async () => ({ default: (await import('./spectatorTestHarness')).bridge }));
vi.mock('../../api/games', async () => (await import('./spectatorTestHarness')).api);

describe('useSpectatorState', () => {
  beforeEach(resetHarness);

  it('starts idle', () => {
    const { result } = renderHook(() => useSpectatorState());
    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
    expect(result.current.ended).toBeNull();
  });

  it('subscribes to a channel and stages the returned live match', async () => {
    api.subscribeSpectator.mockResolvedValue({ channelId: 7, match: snapshot({ sequence: 4 }) });
    const { result } = renderHook(() => useSpectatorState());

    await act(async () => { await result.current.startSpectating(7); });

    expect(api.subscribeSpectator).toHaveBeenCalledWith(7);
    expect(result.current.spectatingChannelId).toBe(7);
    expect(result.current.match?.sequence).toBe(4);
  });

  it('subscribing to an idle channel is a success with no match', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    expect(result.current.spectatingChannelId).toBe(7);
    expect(result.current.match).toBeNull();
  });

  it('ignores frames at or below the sequence high-water mark', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', { type: 'game.spectatorSnapshot', ...snapshot({ sequence: 3 }) });
    emit('game.spectatorSnapshot', { type: 'game.spectatorSnapshot', ...snapshot({ sequence: 2 }) });
    emit('game.spectatorSnapshot', { type: 'game.spectatorSnapshot', ...snapshot({ sequence: 3 }) });

    expect(result.current.match?.sequence).toBe(3);
  });

  it('ignores frames for another channel and a wrong schema version', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', { ...snapshot({ channelId: 8, sequence: 5 }) });
    emit('game.spectatorSnapshot', { ...snapshot({ sequence: 5, schemaVersion: 2 as 1 }) });

    expect(result.current.match).toBeNull();
  });

  it('transitions to the next match with no resubscribe, resetting the sequence gate', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorSnapshot', { ...snapshot({ matchId: 91, sequence: 9 }) });
    emit('game.spectatorMatchEnded', {
      schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 9,
      outcome: { winnerId: 10, loserId: 20, draw: false },
    });
    expect(result.current.ended?.matchId).toBe(91);
    expect(result.current.match?.matchId).toBe(91);

    emit('game.spectatorSnapshot', { ...snapshot({ matchId: 92, sequence: 1 }) });

    expect(api.subscribeSpectator).toHaveBeenCalledTimes(1);
    expect(result.current.ended).toBeNull();
    expect(result.current.match?.matchId).toBe(92);
    expect(result.current.match?.sequence).toBe(1);
  });

  it('a match ending does not stop spectating', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorMatchEnded', {
      schemaVersion: 1, matchId: 91, channelId: 7, reason: 'forfeited', finalSequence: 3,
      outcome: { winnerId: 10, loserId: 20, draw: false },
    });

    expect(result.current.spectatingChannelId).toBe(7);
  });

  it.each([
    ['unsubscribed'], ['authorizationLost'], ['disconnected'], ['channelRemoved'],
  ])('clears everything on a %s close', async (reason) => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    emit('game.spectatorSnapshot', { ...snapshot({ sequence: 1 }) });

    emit('game.spectatorClosed', { channelId: 7, reason });

    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
    expect(result.current.ended).toBeNull();
    expect(result.current.closeReason).toBe(reason);
  });

  it('ignores a close for a channel it is not watching', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit('game.spectatorClosed', { channelId: 8, reason: 'channelRemoved' });

    expect(result.current.spectatingChannelId).toBe(7);
  });

  it('stopSpectating unsubscribes and clears immediately', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    act(() => { result.current.stopSpectating(); });

    expect(result.current.spectatingChannelId).toBeNull();
    await waitFor(() => expect(api.unsubscribeSpectator).toHaveBeenCalledTimes(1));
  });

  it.each([['voice.connected'], ['voice.channelChanged']])('resets on %s', async (event) => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });

    emit(event, { channelId: 8 });

    expect(result.current.spectatingChannelId).toBeNull();
    expect(result.current.match).toBeNull();
  });

  it('drops a frame that arrives after stopping', async () => {
    const { result } = renderHook(() => useSpectatorState());
    await act(async () => { await result.current.startSpectating(7); });
    act(() => { result.current.stopSpectating(); });

    emit('game.spectatorSnapshot', { ...snapshot({ sequence: 5 }) });

    expect(result.current.match).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- useSpectatorState`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the hook**

Create `src/Brmble.Web/src/components/Games/useSpectatorState.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import bridge from '../../bridge';
import * as gamesApi from '../../api/games';
import type {
  SpectatorCloseReason,
  SpectatorClosedEvent,
  SpectatorMatchEndedEvent,
  SpectatorSnapshot,
} from '../../api/games';

export interface SpectatorState {
  spectatingChannelId: number | null;
  match: SpectatorSnapshot | null;
  ended: SpectatorMatchEndedEvent | null;
  closeReason: SpectatorCloseReason | null;
  startSpectating: (channelId: number) => Promise<void>;
  stopSpectating: () => void;
  reset: () => void;
}

/**
 * Spectating is a CHANNEL mode, not a match view: you opt in once and keep
 * watching match after match until you stop, move channel, or disconnect. The
 * server holds the subscription; this hook holds the projection of it.
 *
 * Guard structure deliberately mirrors useDuelQueueState (schema version, channel
 * identity, monotonic revision) so the two hooks read alike.
 */
export function useSpectatorState(): SpectatorState {
  const [spectatingChannelId, setSpectatingChannelId] = useState<number | null>(null);
  const [match, setMatch] = useState<SpectatorSnapshot | null>(null);
  const [ended, setEnded] = useState<SpectatorMatchEndedEvent | null>(null);
  const [closeReason, setCloseReason] = useState<SpectatorCloseReason | null>(null);

  const channelRef = useRef<number | null>(null);
  channelRef.current = spectatingChannelId;
  // Monotonic gate. Sequences are per MATCH, so a new match id resets the mark —
  // that is how the next match flows in with no resubscribe.
  const positionRef = useRef<{ matchId: number; sequence: number } | null>(null);

  const clear = useCallback(() => {
    channelRef.current = null;
    positionRef.current = null;
    setSpectatingChannelId(null);
    setMatch(null);
    setEnded(null);
  }, []);

  const reset = useCallback(() => {
    clear();
    setCloseReason(null);
  }, [clear]);

  const startSpectating = useCallback(async (channelId: number) => {
    const response = await gamesApi.subscribeSpectator(channelId);
    channelRef.current = response.channelId;
    positionRef.current = response.match
      ? { matchId: response.match.matchId, sequence: response.match.sequence }
      : null;
    setCloseReason(null);
    setEnded(null);
    setSpectatingChannelId(response.channelId);
    // A null match is a SUCCESSFUL subscription to an idle channel.
    setMatch(response.match);
  }, []);

  const stopSpectating = useCallback(() => {
    // Clear locally first: the chip must disappear on click, not on a round trip.
    clear();
    setCloseReason(null);
    void gamesApi.unsubscribeSpectator().catch(() => {
      // Best effort. Presence teardown will clear a stranded subscription, and a
      // fresh subscribe replaces it outright.
    });
  }, [clear]);

  useEffect(() => {
    const handleSnapshot = (data: unknown) => {
      const frame = data as Partial<SpectatorSnapshot>;
      if (channelRef.current == null
        || frame.schemaVersion !== 1
        || frame.channelId !== channelRef.current
        || typeof frame.matchId !== 'number'
        || typeof frame.sequence !== 'number'
        || frame.view == null) return;

      const position = positionRef.current;
      const isNewMatch = position == null || position.matchId !== frame.matchId;
      if (!isNewMatch && frame.sequence <= position.sequence) return;

      positionRef.current = { matchId: frame.matchId, sequence: frame.sequence };
      if (isNewMatch) setEnded(null);
      setMatch(frame as SpectatorSnapshot);
    };

    const handleMatchEnded = (data: unknown) => {
      const event = data as Partial<SpectatorMatchEndedEvent>;
      if (channelRef.current == null
        || event.schemaVersion !== 1
        || event.channelId !== channelRef.current
        || typeof event.matchId !== 'number') return;
      // Deliberately does NOT clear `match`: the Ended stage shows the same board
      // with its result until the next match starts. And it does NOT stop
      // spectating — a match ending ends a match, not a subscription.
      setEnded(event as SpectatorMatchEndedEvent);
    };

    const handleClosed = (data: unknown) => {
      const event = data as Partial<SpectatorClosedEvent>;
      if (channelRef.current == null || event.channelId !== channelRef.current) return;
      clear();
      setCloseReason(event.reason ?? 'disconnected');
    };

    // Reconnecting or moving channel requires an explicit fresh subscribe.
    const handleVoiceReset = () => { reset(); };

    bridge.on('game.spectatorSnapshot', handleSnapshot);
    bridge.on('game.spectatorMatchEnded', handleMatchEnded);
    bridge.on('game.spectatorClosed', handleClosed);
    bridge.on('voice.connected', handleVoiceReset);
    bridge.on('voice.channelChanged', handleVoiceReset);
    return () => {
      bridge.off('game.spectatorSnapshot', handleSnapshot);
      bridge.off('game.spectatorMatchEnded', handleMatchEnded);
      bridge.off('game.spectatorClosed', handleClosed);
      bridge.off('voice.connected', handleVoiceReset);
      bridge.off('voice.channelChanged', handleVoiceReset);
    };
  }, [clear, reset]);

  return { spectatingChannelId, match, ended, closeReason, startSpectating, stopSpectating, reset };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- useSpectatorState`
Expected: all PASS.
Run: `cd src/Brmble.Web; npm run type-check` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/useSpectatorState.ts src/Brmble.Web/src/components/Games/useSpectatorState.test.tsx src/Brmble.Web/src/components/Games/spectatorTestHarness.ts
git commit -m "feat(games): add useSpectatorState channel-scoped spectator hook"
```

---

### Task 15: `DeathrollSpectatorBoard`

**Files:**
- Create: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx`
- Create: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css`
- Create: `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx`

**Interfaces:**
- Consumes: `DeathrollSpectatorView`, `DuelPlayer` (Task 9).
- Produces:

```ts
interface DeathrollSpectatorBoardProps {
  view: DeathrollSpectatorView;
  players: DuelPlayer[];
  /** Present once the match has ended. */
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean } | null;
}
export function DeathrollSpectatorBoard(props: DeathrollSpectatorBoardProps): JSX.Element;
```

**UI rules (from `docs/UI_GUIDE.md` Minigame Panel Pattern, `:302-371`):**
- Reuse the participant board's visual language and tokens. Copy the structure of `DeathrollBoard.tsx` (players row, stat tiles, result banner) and its module CSS as the starting point for `DeathrollSpectatorBoard.module.css`.
- **Read-only:** no buttons, no `.btn`, no countdown bar (a spectator has no turn to run out), no Head-to-head panel.
- All CSS values are tokens (`--bg-surface`, `--glass-border`, `--accent-primary`, `--accent-danger`, `--radius-*`, `--space-*`, `--text-*`, `--font-*`). **No hardcoded colours, sizes, radii, shadows or transitions.**
- No `role="dialog"`, no `aria-modal`, no overlay. This lives inside the channel activity region's stage.
- Player ids in `view` are **session** ids. Resolve names via `players.find(p => p.sessionId === id)?.displayName`.

- [ ] **Step 1: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeathrollSpectatorBoard } from './DeathrollSpectatorBoard';
import type { DeathrollSpectatorView, DuelPlayer } from '../../api/games';

const players: DuelPlayer[] = [
  { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
  { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
];

const live: DeathrollSpectatorView = {
  kind: 'deathroll', players: [10, 20], currentPlayer: 20,
  ceiling: 50, lastRoll: 73, finished: false, loserId: null,
};

describe('DeathrollSpectatorBoard', () => {
  it('names both players by resolving session ids', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('Broan')).toBeInTheDocument();
  });

  it('shows the ceiling and the last roll', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
  });

  it('marks whose turn it is', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.getByTestId('spectator-player-20')).toHaveAttribute('data-current', 'true');
    expect(screen.getByTestId('spectator-player-10')).toHaveAttribute('data-current', 'false');
  });

  it('renders no interactive control at all', () => {
    render(<DeathrollSpectatorBoard view={live} players={players} outcome={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('falls back to the session id when a name cannot be resolved', () => {
    render(<DeathrollSpectatorBoard view={live} players={[]} outcome={null} />);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('announces the winner once the match has ended', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, currentPlayer: null, finished: true, loserId: 20, lastRoll: 1 }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
  });

  it('announces a draw', () => {
    render(
      <DeathrollSpectatorBoard
        view={{ ...live, currentPlayer: null, finished: true }}
        players={players}
        outcome={{ winnerId: null, loserId: null, draw: true }}
      />,
    );
    expect(screen.getByText(/draw/i)).toBeInTheDocument();
  });

  it('shows a placeholder before the first roll', () => {
    render(
      <DeathrollSpectatorBoard view={{ ...live, lastRoll: null }} players={players} outcome={null} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- DeathrollSpectatorBoard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the board**

Create `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx`:

```tsx
import type { DeathrollSpectatorView, DuelPlayer } from '../../api/games';
import styles from './DeathrollSpectatorBoard.module.css';

interface DeathrollSpectatorBoardProps {
  view: DeathrollSpectatorView;
  players: DuelPlayer[];
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean } | null;
}

/**
 * Read-only Deathroll board for a non-participant. Reuses the participant board's
 * visual language, minus every control: a spectator has no turn, so there is no
 * roll button, no forfeit and no countdown.
 *
 * `view.players`, `view.currentPlayer` and `view.loserId` are Mumble SESSION ids.
 */
export function DeathrollSpectatorBoard({ view, players, outcome }: DeathrollSpectatorBoardProps) {
  const nameOf = (sessionId: number) =>
    players.find(player => player.sessionId === sessionId)?.displayName ?? String(sessionId);

  const result = !outcome
    ? null
    : outcome.draw
      ? 'The match ended in a draw.'
      : outcome.winnerId != null
        ? `${nameOf(outcome.winnerId)} wins!`
        : 'The match has ended.';

  return (
    <div className={styles.board}>
      <div className={styles.players}>
        {view.players.map(sessionId => (
          <div
            key={sessionId}
            data-testid={`spectator-player-${sessionId}`}
            data-current={String(view.currentPlayer === sessionId)}
            className={`${styles.player} ${view.currentPlayer === sessionId ? styles.playerActive : ''}`}
          >
            <span className={styles.playerName}>{nameOf(sessionId)}</span>
            {view.currentPlayer === sessionId && <span className={styles.playerTurn}>Rolling…</span>}
          </div>
        ))}
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Ceiling</span>
          <span className={styles.statValue}>{view.ceiling}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Last roll</span>
          <span className={styles.statValue}>{view.lastRoll ?? '—'}</span>
        </div>
      </div>

      {result && (
        <div className={styles.result} role="status">
          <p className={styles.resultText}>{result}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the module CSS**

Create `src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css` by copying the layout rules for `.players`, `.player`, `.playerActive`, `.playerName`, `.playerTurn`, `.stat`, `.statLabel`, `.statValue`, `.result` and `.resultText` from `DeathrollBoard.module.css`, dropping every countdown, footer and head-to-head rule, and adding a `.board` container and a `.stats` row. **Copy the token references verbatim — do not substitute literal values.** Verify afterwards:

```bash
git diff --cached -- src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css
```
There must be no hex colour, no `px` font size, no literal `rgba(...)`, and no hardcoded radius, shadow or transition duration.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- DeathrollSpectatorBoard`
Expected: 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.tsx src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.module.css src/Brmble.Web/src/components/Games/DeathrollSpectatorBoard.test.tsx
git commit -m "feat(games): add read-only DeathrollSpectatorBoard"
```

---

### Task 16: `RpsSpectatorBoard`

**Files:**
- Create: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`
- Create: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.module.css`
- Create: `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx`

**Interfaces:**
- Consumes: `RpsSpectatorView`, `RpsResolvedRound`, `DuelPlayer` (Task 9).
- Produces:

```ts
interface RpsSpectatorBoardProps {
  view: RpsSpectatorView;
  players: DuelPlayer[];
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean } | null;
}
export function RpsSpectatorBoard(props: RpsSpectatorBoardProps): JSX.Element;
```

**The rule this board exists to enforce:** RPS renders commitment as a **per-player state**, never a throw. `committed[i]` becomes "Thrown" / "Choosing…" — never `rock`, `paper` or `scissors`. Throws are revealed **only** from `lastRound`. There is no reveal-suspense countdown: that is a participant affordance driven by a resolved round arriving instantly for the person who threw. A spectator has no such moment.

Same UI rules as Task 15: tokens only, no buttons, no dialog semantics.

- [ ] **Step 1: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RpsSpectatorBoard } from './RpsSpectatorBoard';
import type { DuelPlayer, RpsSpectatorView } from '../../api/games';

const players: DuelPlayer[] = [
  { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
  { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
];

const unresolved: RpsSpectatorView = {
  kind: 'rps', players: [10, 20], bestOf: 3, targetWins: 2, roundNumber: 2,
  roundWins: [1, 0], committed: [true, false], finished: false, winnerId: null, lastRound: null,
};

describe('RpsSpectatorBoard', () => {
  it('renders commitment as a state, never as a throw', () => {
    const { container } = render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);

    expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
    expect(screen.getByTestId('spectator-commit-20')).toHaveTextContent(/choosing/i);

    const text = (container.textContent ?? '').toLowerCase();
    for (const throwName of ['rock', 'paper', 'scissors']) {
      expect(text).not.toContain(throwName);
    }
  });

  it('shows the running score against bestOf and targetWins', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.getByTestId('spectator-score-10')).toHaveTextContent('1');
    expect(screen.getByTestId('spectator-score-20')).toHaveTextContent('0');
    expect(screen.getByText(/best of 3/i)).toBeInTheDocument();
  });

  it('reveals both throws only from lastRound', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'scissors', winnerId: 10, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    const lastRound = screen.getByTestId('spectator-last-round');
    expect(lastRound).toHaveTextContent(/rock/i);
    expect(lastRound).toHaveTextContent(/scissors/i);
    expect(lastRound).toHaveTextContent(/Qy/);
  });

  it('labels a tied round', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'rock', pick1: 'rock', winnerId: null, tie: true },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/tie/i);
  });

  it('renders "no throw" for an idle timeout without inventing a pick', () => {
    render(
      <RpsSpectatorBoard
        view={{
          ...unresolved,
          lastRound: { roundNumber: 1, sequence: 1, pick0: 'none', pick1: 'scissors', winnerId: 20, tie: false },
        }}
        players={players}
        outcome={null}
      />,
    );
    expect(screen.getByTestId('spectator-last-round')).toHaveTextContent(/no throw/i);
  });

  it('renders no interactive control at all', () => {
    render(<RpsSpectatorBoard view={unresolved} players={players} outcome={null} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('announces the winner once the match has ended', () => {
    render(
      <RpsSpectatorBoard
        view={{ ...unresolved, finished: true, winnerId: 10, roundWins: [2, 0], committed: [false, false] }}
        players={players}
        outcome={{ winnerId: 10, loserId: 20, draw: false }}
      />,
    );
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the board**

Create `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx`:

```tsx
import type { DuelPlayer, RpsSpectatorView } from '../../api/games';
import styles from './RpsSpectatorBoard.module.css';

interface RpsSpectatorBoardProps {
  view: RpsSpectatorView;
  players: DuelPlayer[];
  outcome: { winnerId: number | null; loserId: number | null; draw: boolean } | null;
}

const PICK_LABELS: Record<string, string> = {
  rock: 'Rock',
  paper: 'Paper',
  scissors: 'Scissors',
  none: 'No throw',
};

/**
 * Read-only RPS board for a non-participant.
 *
 * Commitment is rendered as a per-player STATE, never as a throw: the server's
 * `committed` array carries WHETHER each player has thrown, never WHAT. Throws are
 * revealed only from `lastRound`, which the server populates only once a round has
 * resolved. There is no reveal-suspense countdown here — that is a participant
 * affordance for the moment your own resolved round lands.
 *
 * `view.players` and `view.winnerId` are Mumble SESSION ids.
 */
export function RpsSpectatorBoard({ view, players, outcome }: RpsSpectatorBoardProps) {
  const nameOf = (sessionId: number) =>
    players.find(player => player.sessionId === sessionId)?.displayName ?? String(sessionId);
  const pickLabel = (pick: string) => PICK_LABELS[pick] ?? PICK_LABELS.none;

  const result = !outcome
    ? null
    : outcome.draw
      ? 'The match ended in a draw.'
      : outcome.winnerId != null
        ? `${nameOf(outcome.winnerId)} wins!`
        : 'The match has ended.';

  const lastRoundText = !view.lastRound
    ? null
    : view.lastRound.tie
      ? `Round ${view.lastRound.roundNumber}: tie — ${pickLabel(view.lastRound.pick0)} vs ${pickLabel(view.lastRound.pick1)}`
      : `Round ${view.lastRound.roundNumber}: ${pickLabel(view.lastRound.pick0)} vs ${pickLabel(view.lastRound.pick1)}`
        + (view.lastRound.winnerId != null ? ` — ${nameOf(view.lastRound.winnerId)} takes it` : '');

  return (
    <div className={styles.board}>
      <div className={styles.players}>
        {view.players.map((sessionId, index) => (
          <div key={sessionId} className={styles.player}>
            <span className={styles.playerName}>{nameOf(sessionId)}</span>
            <span className={styles.playerScore} data-testid={`spectator-score-${sessionId}`}>
              {view.roundWins[index] ?? 0}
            </span>
            <span className={styles.commit} data-testid={`spectator-commit-${sessionId}`}>
              {view.finished ? '' : view.committed[index] ? 'Thrown' : 'Choosing…'}
            </span>
          </div>
        ))}
      </div>

      <p className={styles.format}>
        Best of {view.bestOf} · first to {view.targetWins} · round {view.roundNumber}
      </p>

      {lastRoundText && (
        <div className={styles.lastRound} data-testid="spectator-last-round">
          <span className={styles.lastRoundLabel}>Last round</span>
          <span className={styles.lastRoundText}>{lastRoundText}</span>
        </div>
      )}

      {result && (
        <div className={styles.result} role="status">
          <p className={styles.resultText}>{result}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the module CSS**

Create `src/Brmble.Web/src/components/Games/RpsSpectatorBoard.module.css` by copying the layout rules for `.players`, `.player`, `.playerName`, `.playerScore`, `.lastRound`, `.lastRoundLabel`, `.result` and `.resultText` from `RpsBoard.module.css`, dropping every pick-button, countdown, reveal, footer and head-to-head rule, and adding `.board`, `.commit`, `.format` and `.lastRoundText`. Tokens only — same verification as Task 15 Step 4.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- RpsSpectatorBoard`
Expected: 7 tests PASS. The "never contains rock/paper/scissors" assertion is the one that matters most — if it fails, the board is leaking a live throw.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/RpsSpectatorBoard.tsx src/Brmble.Web/src/components/Games/RpsSpectatorBoard.module.css src/Brmble.Web/src/components/Games/RpsSpectatorBoard.test.tsx
git commit -m "feat(games): add read-only RpsSpectatorBoard"
```

---

### Task 17: `SpectatorActivity` — the stage host

**Files:**
- Create: `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx`
- Create: `src/Brmble.Web/src/components/Games/SpectatorActivity.module.css`
- Create: `src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx`

**Interfaces:**
- Consumes: `DeathrollSpectatorBoard` (Task 15), `RpsSpectatorBoard` (Task 16), `isRpsSpectatorView` / `SpectatorSnapshot` / `SpectatorMatchEndedEvent` (Task 9), `DuelQueueSnapshot` (`api/games.ts:111-121`), `gameDisplayName` (`src/Brmble.Web/src/utils/games.ts`), `pairLabel` (`components/Games/duelFormatting.ts`).
- Produces:

```ts
interface SpectatorActivityProps {
  match: SpectatorSnapshot | null;
  ended: SpectatorMatchEndedEvent | null;
  /** The already-broadcast queue snapshot for the watched channel. Idle state only. */
  queueSnapshot: DuelQueueSnapshot | null;
  /** Resolves a voice SESSION id to a display name (App's resolveGamePlayerName). */
  resolveName: (sessionId: number) => string;
  onStopWatching: () => void;
}
export function SpectatorActivity(props: SpectatorActivityProps): JSX.Element;
```

Task 19 renders this in the `'spectate'` stage case.

**The three states, and the rules they encode:**
- **Live** — `match` set, `ended` null. Renders the matching spectator board.
- **Ended** — `match` set, `ended` set. The **same board** showing its result, held until the next match starts. Because spectating is a mode, an ending match does not stop it.
- **Idle** — `match` null. The next-up card: the upcoming pair, game and format, or the ready-check waiting line, read from the already-broadcast `game.queueSnapshot`. **No queue list, no ETAs, no server cost.**
- **Stop watching** is present in **all three** states.
- There is deliberately **no collapse or minimise affordance**. The region is not dismissible; every activity ends by terminating itself.
- **Known boundary:** the Idle state is duel-specific, because "next up" reads a pair-based duel queue. A future many-player minigame has no such queue and Idle degrades to a plain waiting state for it. The Live and Ended states carry no such assumption. Say so in a comment.

- [ ] **Step 1: Write the failing tests**

Create `src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpectatorActivity } from './SpectatorActivity';
import type { DuelQueueSnapshot, SpectatorSnapshot } from '../../api/games';

const resolveName = (sessionId: number) => ({ 10: 'Qy', 20: 'Broan', 30: 'Mo' }[sessionId] ?? String(sessionId));

const deathrollMatch: SpectatorSnapshot = {
  schemaVersion: 1, matchId: 91, channelId: 7, gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
  players: [
    { userId: 100, sessionId: 10, displayName: 'Qy', ready: false },
    { userId: 200, sessionId: 20, displayName: 'Broan', ready: false },
  ],
  sequence: 3, generatedAt: '2026-08-24T14:30:04.000Z',
  view: { kind: 'deathroll', players: [10, 20], currentPlayer: 20, ceiling: 50, lastRoll: 73, finished: false, loserId: null },
};

const rpsMatch: SpectatorSnapshot = {
  ...deathrollMatch, gameType: 'rps', format: 'bo3',
  view: {
    kind: 'rps', players: [10, 20], bestOf: 3, targetWins: 2, roundNumber: 2,
    roundWins: [1, 0], committed: [true, false], finished: false, winnerId: null, lastRound: null,
  },
};

const queue = (over: Partial<DuelQueueSnapshot> = {}): DuelQueueSnapshot => ({
  schemaVersion: 1, generation: 1, revision: 1, channelId: 7,
  generatedAt: '2026-08-24T14:30:04.000Z', calculationTimeMs: 0,
  active: null, readyCheck: null, queue: [], ...over,
});

describe('SpectatorActivity', () => {
  it('Live: renders the deathroll board', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByText('Qy')).toBeInTheDocument();
    expect(screen.getByText('73')).toBeInTheDocument();
  });

  it('Live: renders the rps board for an rps view', () => {
    render(<SpectatorActivity match={rpsMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByTestId('spectator-commit-10')).toHaveTextContent(/thrown/i);
  });

  it('Ended: keeps the same board and shows the result', () => {
    render(
      <SpectatorActivity
        match={deathrollMatch}
        ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'completed', finalSequence: 3, outcome: { winnerId: 10, loserId: 20, draw: false } }}
        queueSnapshot={null}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText(/Qy wins/)).toBeInTheDocument();
  });

  it('Idle: shows the next-up pair, game and format from the queue snapshot', () => {
    render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          queue: [{
            reservationId: 5, position: 1,
            players: [
              { userId: 100, sessionId: 10, displayName: 'Qy', ready: true },
              { userId: 300, sessionId: 30, displayName: 'Mo', ready: true },
            ],
            gameType: 'rps', format: 'bo3', rulesetVersion: 1,
            eta: { status: 'unknown', estimatedStartAt: null, milliseconds: null, approximate: true, segments: [] },
            estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
          }],
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    const card = screen.getByTestId('spectator-next-up');
    expect(card).toHaveTextContent('Qy');
    expect(card).toHaveTextContent('Mo');
    expect(card).toHaveTextContent(/bo3/);
  });

  it('Idle: shows the ready-check waiting line when one is running', () => {
    render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          readyCheck: {
            reservationId: 5, expiresAt: '2026-08-24T14:31:04.000Z',
            players: [
              { userId: 100, sessionId: 10, displayName: 'Qy', ready: true },
              { userId: 300, sessionId: 30, displayName: 'Mo', ready: false },
            ],
            gameType: 'deathroll', format: '1v1', rulesetVersion: 1,
            estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true },
          },
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    expect(screen.getByTestId('spectator-next-up')).toHaveTextContent(/ready check/i);
  });

  it('Idle: says the channel is quiet when nothing is queued', () => {
    render(<SpectatorActivity match={null} ended={null} queueSnapshot={queue()} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getByTestId('spectator-next-up')).toHaveTextContent(/waiting/i);
  });

  it('Idle: never lists the whole queue or an ETA', () => {
    render(
      <SpectatorActivity
        match={null} ended={null}
        queueSnapshot={queue({
          queue: [
            { reservationId: 5, position: 1, players: [{ userId: 100, sessionId: 10, displayName: 'Qy', ready: true }, { userId: 300, sessionId: 30, displayName: 'Mo', ready: true }], gameType: 'rps', format: 'bo3', rulesetVersion: 1, eta: { status: 'known', estimatedStartAt: null, milliseconds: 60_000, approximate: false, segments: [] }, estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true } },
            { reservationId: 6, position: 2, players: [{ userId: 200, sessionId: 20, displayName: 'Broan', ready: true }, { userId: 300, sessionId: 30, displayName: 'Mo', ready: true }], gameType: 'rps', format: 'bo3', rulesetVersion: 1, eta: { status: 'known', estimatedStartAt: null, milliseconds: 120_000, approximate: false, segments: [] }, estimatedDuration: { status: 'unknown', milliseconds: null, sampleCount: 0, method: 'insufficient', approximate: true } },
          ],
        })}
        resolveName={resolveName}
        onStopWatching={vi.fn()}
      />
    );
    const card = screen.getByTestId('spectator-next-up');
    expect(card).not.toHaveTextContent('Broan');
    expect(card).not.toHaveTextContent(/starts in/i);
  });

  it.each([
    ['Live', deathrollMatch, null],
    ['Idle', null, null],
  ])('%s: offers Stop watching', (_label, match, ended) => {
    const onStopWatching = vi.fn();
    render(<SpectatorActivity match={match} ended={ended} queueSnapshot={null} resolveName={resolveName} onStopWatching={onStopWatching} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
  });

  it('Ended: still offers Stop watching', () => {
    const onStopWatching = vi.fn();
    render(
      <SpectatorActivity
        match={deathrollMatch}
        ended={{ schemaVersion: 1, matchId: 91, channelId: 7, reason: 'forfeited', finalSequence: 3, outcome: { winnerId: 10, loserId: 20, draw: false } }}
        queueSnapshot={null} resolveName={resolveName} onStopWatching={onStopWatching}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(onStopWatching).toHaveBeenCalledTimes(1);
  });

  it('offers no collapse or minimise affordance', () => {
    render(<SpectatorActivity match={deathrollMatch} ended={null} queueSnapshot={null} resolveName={resolveName} onStopWatching={vi.fn()} />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Stop watching']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- SpectatorActivity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the stage host**

Create `src/Brmble.Web/src/components/Games/SpectatorActivity.tsx`:

```tsx
import { gameDisplayName } from '../../utils/games';
import { pairLabel } from './duelFormatting';
import { DeathrollSpectatorBoard } from './DeathrollSpectatorBoard';
import { RpsSpectatorBoard } from './RpsSpectatorBoard';
import { isRpsSpectatorView } from '../../api/games';
import type { DuelQueueSnapshot, SpectatorMatchEndedEvent, SpectatorSnapshot } from '../../api/games';
import styles from './SpectatorActivity.module.css';

interface SpectatorActivityProps {
  match: SpectatorSnapshot | null;
  ended: SpectatorMatchEndedEvent | null;
  queueSnapshot: DuelQueueSnapshot | null;
  resolveName: (sessionId: number) => string;
  onStopWatching: () => void;
}

/**
 * The 'spectate' stage. Three states, and Stop watching in all of them.
 *
 * There is deliberately NO collapse or minimise affordance, for any activity kind.
 * The region is not dismissible; every activity ends by terminating itself. A
 * collapse toggle would create a subscribed-but-invisible state, which is already
 * the most expensive ambiguity in the shipped region.
 *
 * Because spectating is a CHANNEL mode, an ending match does not stop it: the
 * stage falls back to Idle and the next match flows in with no resubscribe.
 */
export function SpectatorActivity({
  match, ended, queueSnapshot, resolveName, onStopWatching,
}: SpectatorActivityProps) {
  const outcome = ended?.outcome ?? null;

  const body = match
    ? isRpsSpectatorView(match.view)
      ? <RpsSpectatorBoard view={match.view} players={match.players} outcome={outcome} />
      : <DeathrollSpectatorBoard view={match.view} players={match.players} outcome={outcome} />
    : <NextUp queueSnapshot={queueSnapshot} resolveName={resolveName} />;

  return (
    <section className={styles.activity} aria-label="Spectating">
      <div className={styles.stage}>{body}</div>
      <div className={styles.controls}>
        <button type="button" className="btn btn-secondary" onClick={onStopWatching}>
          Stop watching
        </button>
      </div>
    </section>
  );
}

/**
 * The Idle card. Reads the already-broadcast game.queueSnapshot, which every
 * channel member receives regardless of spectating, so this costs the server
 * nothing. No queue list and no ETAs: the queue lives in the sidebar badge and
 * DuelQueueModal, not here.
 *
 * KNOWN BOUNDARY: this is duel-specific, because "next up" reads a pair-based
 * duel queue. A future many-player minigame has no such queue and this degrades
 * to a plain waiting state for it. The Live and Ended states carry no such
 * assumption, and neither does the server half.
 */
function NextUp({
  queueSnapshot, resolveName,
}: { queueSnapshot: DuelQueueSnapshot | null; resolveName: (sessionId: number) => string }) {
  const readyCheck = queueSnapshot?.readyCheck ?? null;
  const next = queueSnapshot?.queue[0] ?? null;

  if (readyCheck) {
    return (
      <div className={styles.nextUp} data-testid="spectator-next-up">
        <span className={styles.nextUpLabel}>Ready check</span>
        <strong className={styles.nextUpPair}>{pairLabel(readyCheck.players, resolveName)}</strong>
        <span className={styles.nextUpMeta}>
          {gameDisplayName(readyCheck.gameType)} · {readyCheck.format}
        </span>
      </div>
    );
  }

  if (next) {
    return (
      <div className={styles.nextUp} data-testid="spectator-next-up">
        <span className={styles.nextUpLabel}>Next up</span>
        <strong className={styles.nextUpPair}>{pairLabel(next.players, resolveName)}</strong>
        <span className={styles.nextUpMeta}>
          {gameDisplayName(next.gameType)} · {next.format}
        </span>
      </div>
    );
  }

  return (
    <div className={styles.nextUp} data-testid="spectator-next-up">
      <span className={styles.nextUpLabel}>Waiting for the next match</span>
    </div>
  );
}
```

- [ ] **Step 4: Write the module CSS**

Create `src/Brmble.Web/src/components/Games/SpectatorActivity.module.css`:

- `.activity` — a column filling the stage: `display: flex; flex-direction: column; gap: var(--space-*); height: 100%;`
- `.stage` — `flex: 1; min-height: 0;` centring its child.
- `.controls` — a right-aligned row with `padding: var(--space-*)`.
- `.nextUp` — a centred column reusing the same surface treatment as `DuelQueueModal.module.css`'s `.section` (background `var(--bg-surface)`, border `var(--glass-border)`, radius `var(--radius-*)`).
- `.nextUpLabel` / `.nextUpPair` / `.nextUpMeta` — copy the type treatment from `DuelQueueModal.module.css`'s `.label` / `.pair` / `.meta`.

**Tokens only.** No hex, no literal `px` font size, no hardcoded radius, shadow or transition. The Stop watching control uses the shared global `.btn.btn-secondary` classes, not a bespoke button.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- SpectatorActivity`
Expected: all PASS.

> If `pairLabel`'s signature does not match `(players, resolveName)`, check `components/Games/duelFormatting.ts` and adapt the call — it is already used exactly this way at `DuelQueueModal.tsx:98`.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/SpectatorActivity.tsx src/Brmble.Web/src/components/Games/SpectatorActivity.module.css src/Brmble.Web/src/components/Games/SpectatorActivity.test.tsx
git commit -m "feat(games): add SpectatorActivity stage host"
```

---

### Task 18: `DuelQueueModal` Watch button

**Files:**
- Modify: `src/Brmble.Web/src/components/Games/DuelQueueModal.tsx` (props `:8-13`, active card `:95-108`)
- Modify: `src/Brmble.Web/src/components/Games/DuelQueueModal.module.css` (one new rule)
- Test: `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx` (append)

**Interfaces:**
- Produces: two new props on `DuelQueueModalProps`:

```ts
  /** The joined voice channel. Watch is enabled only for this channel — spectating is same-channel only. */
  joinedChannelId: number | null;
  onWatch: () => void;
```

Task 19 supplies both.

**Why here:** opting in is a click, exactly as watching a share is (`App.tsx:4729`) and joining paint is (`PaintSessionCard.tsx:57-69`). Neither activity can appear without a local click today, and spectating must not either. This reuses discovery that already exists — the swords badge already tells you a duel is running and already opens this modal — and needs no new surface. **The modal is otherwise unchanged and remains read-only; Watch is its only action.** `DuelQueueModal` keeps its name: it genuinely is a dialog.

- [ ] **Step 1: Write the failing tests**

Append to `src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx`:

```tsx
  it('offers Watch on the active duel when it is in the joined channel', () => {
    const onWatch = vi.fn();
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId={7}
        onWatch={onWatch}
        onClose={vi.fn()}
      />,
    );

    const watch = screen.getByRole('button', { name: 'Watch' });
    expect(watch).toBeEnabled();
    fireEvent.click(watch);
    expect(onWatch).toHaveBeenCalledTimes(1);
  });

  it('disables Watch for a duel in another channel', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(8)}
        resolveName={resolveName}
        joinedChannelId={7}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
  });

  it('disables Watch when no channel is joined', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId={null}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Watch' })).toBeDisabled();
  });

  it('offers no Watch button when no duel is active', () => {
    render(
      <DuelQueueModal
        snapshot={emptySnapshot(7)}
        resolveName={resolveName}
        joinedChannelId={7}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument();
  });

  it('remains read-only apart from Watch and Close', () => {
    render(
      <DuelQueueModal
        snapshot={snapshotWithActive(7)}
        resolveName={resolveName}
        joinedChannelId={7}
        onWatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(new Set(names)).toEqual(new Set(['Close duel activity', 'Watch']));
  });
```

> `snapshotWithActive(channelId)` / `emptySnapshot(channelId)` / `resolveName` are this file's existing fixtures — reuse whatever it already defines, adding a `channelId` parameter if the fixture hardcodes one. Every pre-existing `render(<DuelQueueModal ...>)` in this file must gain `joinedChannelId` and `onWatch` props; the compiler will list them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- DuelQueueModal`
Expected: FAIL — unknown props, no Watch button.

- [ ] **Step 3: Add the props**

`DuelQueueModal.tsx:8-13`:

```tsx
interface DuelQueueModalProps {
  snapshot: DuelQueueSnapshot;
  /** Resolves a voice **session** id to a display name (see App's resolveGamePlayerName). */
  resolveName: (sessionId: number) => string;
  /**
   * The joined voice channel. Watch is enabled only when the snapshot's channel
   * matches it: spectating is same-channel only, and this modal can peek at other
   * channels' queues.
   */
  joinedChannelId: number | null;
  onWatch: () => void;
  onClose: () => void;
}
```

```tsx
export function DuelQueueModal({ snapshot, resolveName, joinedChannelId, onWatch, onClose }: DuelQueueModalProps) {
```

- [ ] **Step 4: Add the button to the active-duel card**

Inside the `{active && (...)}` section, after the elapsed/estimate lines and before `</section>` (`:106`):

```tsx
              <button
                type="button"
                className={`btn btn-sm btn-primary ${styles.watch}`}
                onClick={onWatch}
                disabled={joinedChannelId == null || snapshot.channelId !== joinedChannelId}
              >
                Watch
              </button>
```

Add a `.watch` rule to `DuelQueueModal.module.css` for its alignment inside the card (e.g. `align-self: flex-start; margin-top: var(--space-*)`). Tokens only.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/Brmble.Web; npm run test -- DuelQueueModal`
Expected: all PASS.
Run: `cd src/Brmble.Web; npm run type-check`
Expected: one error at `App.tsx:5436-5442` — the render site is missing the two new props. Task 19 fixes it; leave it failing only if you are committing Tasks 18 and 19 together, otherwise add the minimal props now:

```tsx
      {selectedDuelSnapshot && (
        <DuelQueueModal
          snapshot={selectedDuelSnapshot}
          resolveName={resolveGamePlayerName}
          joinedChannelId={joinedChannelId == null ? null : Number(joinedChannelId)}
          onWatch={() => {}}
          onClose={() => setSelectedDuelChannelId(null)}
        />
      )}
```

Task 19 replaces the `onWatch` no-op with the real handler.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Games/DuelQueueModal.tsx src/Brmble.Web/src/components/Games/DuelQueueModal.module.css src/Brmble.Web/src/components/Games/DuelQueueModal.test.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat(games): add same-channel Watch action to DuelQueueModal"
```

---

### Task 19: App wiring and integration tests

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` — hook call near `:1076`, `availableActivities` `:4986-4991`, the `'spectate'` stage case (Task 13 Step 5), `DuelQueueModal` render site `:5436-5442`
- Create: `src/Brmble.Web/src/App.spectator.test.tsx`

**Interfaces:**
- Consumes: `useSpectatorState` (Task 14), `SpectatorActivity` (Task 17), the `DuelQueueModal` props (Task 18), `ACTIVITY_LABELS` and `renderStage` (Task 12), `duelQueue.byChannel` (`App.tsx:1076`), `resolveGamePlayerName` (`App.tsx:1083`), `setExplicitActivity` (`App.tsx:4993`).
- Produces: no exports. The chip is now live.

**Rules:**
- `availableActivities` appends `'spectate'` **last**, leaving existing chip order untouched.
- The region gate (`App.tsx:5116-5118`) is **unchanged**: still `joinedChannelId` set, not server root, at least one activity.
- Clicking Watch starts spectating **and** sets the explicit activity to `'spectate'`, so the stage takes focus under the region's "explicit click always wins" rule (`docs/UI_GUIDE.md:250-252`), **and** closes the modal.
- Stop watching unsubscribes; `'spectate'` leaves `availableActivities` and the region collapses on its own if nothing else is live — identical in shape to unwatching every share or closing paint.
- Switching the stage to paint or screen share leaves you subscribed with the chip lit. Spectator frames are low-frequency, so there is **no grace period and no pause machinery** — do not add any.
- **Never set `MainPanelMode = 'game'` from spectating.** Do not touch `selectMainPanelMode` or its inputs.

- [ ] **Step 1: Write the failing integration tests**

Create `src/Brmble.Web/src/App.spectator.test.tsx`, modelled on `App.activityRegion.test.tsx` and reusing `src/testing/appHarness.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
// ...reuse the exact mock scaffolding App.activityRegion.test.tsx uses, adding:
// vi.mock('./components/Games/useSpectatorState', () => ({ useSpectatorState: () => mocks.spectator }));

describe('App — spectating as a channel activity', () => {
  beforeEach(() => { /* reset harness; joinedChannelId = '7' */ });

  it('shows no Game chip before opting in', () => {
    renderApp();
    expect(screen.queryByRole('tab', { name: 'Game' })).not.toBeInTheDocument();
  });

  it('Watch starts spectating, stages it, and closes the modal', async () => {
    mocks.duelQueue.byChannel = new Map([[7, activeDuelSnapshot(7)]]);
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: /duel activity/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));

    await waitFor(() => expect(mocks.spectator.startSpectating).toHaveBeenCalledWith(7));
    expect(screen.queryByRole('dialog', { name: /duel activity/i })).not.toBeInTheDocument();
  });

  it('renders the Game chip and stages it once spectating', () => {
    mocks.spectator.spectatingChannelId = 7;
    renderApp();

    const chip = screen.getByRole('tab', { name: 'Game' });
    expect(chip).toHaveAttribute('aria-selected', 'true');
  });

  it('labels the chip Game, not Spectate or Paint', () => {
    mocks.spectator.spectatingChannelId = 7;
    renderApp();
    expect(screen.getByRole('tab', { name: 'Game' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Spectate' })).not.toBeInTheDocument();
  });

  it('appends the Game chip last, leaving existing chip order untouched', () => {
    mocks.screenShare.watchingShares = [aShare()];
    mocks.activePaintSessionId = 'paint-1';
    mocks.spectator.spectatingChannelId = 7;
    renderApp();

    expect(screen.getAllByRole('tab').map(t => t.textContent))
      .toEqual(['Screen share', 'Paint', 'Game']);
  });

  it('the chip survives a match ending', () => {
    mocks.spectator.spectatingChannelId = 7;
    mocks.spectator.match = deathrollSnapshot();
    mocks.spectator.ended = matchEnded();
    renderApp();

    expect(screen.getByRole('tab', { name: 'Game' })).toBeInTheDocument();
    expect(screen.getByText(/wins/)).toBeInTheDocument();
  });

  it('Stop watching removes the chip and collapses the region when nothing else is live', () => {
    mocks.spectator.spectatingChannelId = 7;
    const { rerender } = renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(mocks.spectator.stopSpectating).toHaveBeenCalledTimes(1);

    mocks.spectator.spectatingChannelId = null;
    rerenderApp(rerender);

    expect(screen.queryByRole('tab', { name: 'Game' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /activity/ })).not.toBeInTheDocument();
  });

  it('spectating never puts the main panel into game mode', () => {
    mocks.spectator.spectatingChannelId = 7;
    mocks.spectator.match = deathrollSnapshot();
    renderApp();

    // The split layer stays visible: spectating is a chip, not a game surface.
    expect(screen.getByTestId('main-panel-split')).not.toHaveAttribute('inert');
  });

  it('a spectator who becomes a participant sees game mode take the panel, then returns to a still-live region', () => {
    mocks.spectator.spectatingChannelId = 7;
    const { rerender } = renderApp();
    expect(screen.getByRole('tab', { name: 'Game' })).toBeInTheDocument();

    // Become a participant.
    mocks.gameState.participatingMatchId = '91';
    rerenderApp(rerender);
    const split = screen.getByTestId('main-panel-split');
    expect(split).toHaveAttribute('inert');
    // Hidden, NOT unmounted — the chip is still in the tree.
    expect(screen.getByRole('tab', { name: 'Game', hidden: true })).toBeInTheDocument();

    // Match over; back to split.
    mocks.gameState.participatingMatchId = null;
    rerenderApp(rerender);
    expect(screen.getByTestId('main-panel-split')).not.toHaveAttribute('inert');
    expect(screen.getByRole('tab', { name: 'Game' })).toHaveAttribute('aria-selected', 'true');
    expect(mocks.spectator.startSpectating).not.toHaveBeenCalled();
  });

  it('switching the stage to paint leaves the subscription alive with the chip lit', () => {
    mocks.activePaintSessionId = 'paint-1';
    mocks.spectator.spectatingChannelId = 7;
    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: 'Paint' }));

    expect(screen.getByRole('tab', { name: 'Game' })).toBeInTheDocument();
    expect(mocks.spectator.stopSpectating).not.toHaveBeenCalled();
  });
});
```

> Adapt `renderApp` / `rerenderApp` / the mock object names to whatever `src/testing/appHarness.tsx` and `App.activityRegion.test.tsx` already provide. The `main-panel-split` test id may not exist — if `MainPanel.tsx` has no such hook, assert on the `inert` attribute of whatever element it puts it on (`MainPanel.tsx:28`) and add a `data-testid` there if needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/Brmble.Web; npm run test -- App.spectator`
Expected: FAIL — no Game chip.

- [ ] **Step 3: Call the hook**

In `App.tsx`, next to `const duelQueue = useDuelQueueState();` (`:1076`):

```tsx
  const spectator = useSpectatorState();
```

and the import next to the other Games imports (near `:45-56`):

```tsx
import { useSpectatorState } from './components/Games/useSpectatorState';
import { SpectatorActivity } from './components/Games/SpectatorActivity';
```

- [ ] **Step 4: Add the kind to `availableActivities`**

Replace `App.tsx:4986-4991`:

```tsx
  const availableActivities = useMemo<ChannelActivityKind[]>(() => {
    const kinds: ChannelActivityKind[] = [];
    if (hasWatchableShare) kinds.push('screen-share');
    if (activePaintSessionId) kinds.push('paint');
    // Appended LAST so existing chip order is untouched. Present only while
    // spectating: the queue itself stays in the sidebar badge and DuelQueueModal.
    if (spectator.spectatingChannelId !== null) kinds.push('spectate');
    return kinds;
  }, [hasWatchableShare, activePaintSessionId, spectator.spectatingChannelId]);
```

- [ ] **Step 5: Fill in the `'spectate'` stage case**

Replace the placeholder added in Task 13 Step 5:

```tsx
      case 'spectate':
        return (
          <SpectatorActivity
            match={spectator.match}
            ended={spectator.ended}
            queueSnapshot={spectator.spectatingChannelId == null
              ? null
              : duelQueue.byChannel.get(spectator.spectatingChannelId) ?? null}
            resolveName={resolveGamePlayerName}
            onStopWatching={spectator.stopSpectating}
          />
        );
```

- [ ] **Step 6: Wire the Watch handler**

Add near `handleWatchScreenShare` (`App.tsx:4729`):

```tsx
  /**
   * Opting in is a click, exactly as watching a share is. Setting the explicit
   * activity makes the stage take focus under the region's "explicit click always
   * wins" rule. Spectating is same-channel only, which DuelQueueModal enforces on
   * the button and the server re-validates on subscribe.
   */
  const handleWatchDuel = useCallback((channelId: number) => {
    setSelectedDuelChannelId(null);
    setExplicitActivity('spectate');
    void spectator.startSpectating(channelId).catch(() => {
      // The server rejected the subscription (channel moved under us). The chip
      // never appears, so there is nothing to unwind.
      setExplicitActivity(null);
    });
  }, [spectator.startSpectating]);
```

and replace the `onWatch` no-op at the `DuelQueueModal` render site (`:5436-5442`):

```tsx
      {selectedDuelSnapshot && (
        <DuelQueueModal
          snapshot={selectedDuelSnapshot}
          resolveName={resolveGamePlayerName}
          joinedChannelId={joinedChannelId == null ? null : Number(joinedChannelId)}
          onWatch={() => handleWatchDuel(selectedDuelSnapshot.channelId)}
          onClose={() => setSelectedDuelChannelId(null)}
        />
      )}
```

> `setSelectedDuelChannelId` and `setExplicitActivity` are declared at `App.tsx:1158` and `:4993` respectively, i.e. **after** `:4729`. If `handleWatchDuel` cannot be placed there because of declaration order, define it immediately after `setExplicitActivity` (`:4993`) instead — placement is cosmetic, ordering is not.

- [ ] **Step 7: Run everything**

Run: `cd src/Brmble.Web; npm run type-check` → clean.
Run: `cd src/Brmble.Web; npm run test` → all PASS.
Run: `dotnet build` → clean.
Run: `dotnet test` → all PASS.

- [ ] **Step 8: Manual smoke test (two clients)**

Debug builds allow multiple instances (`Program.cs`), so:

```bash
cd src/Brmble.Web && npm run dev
# terminal 2 and 3:
dotnet run --project src/Brmble.Client
dotnet run --project src/Brmble.Client
```

With a third account, or by having the two clients duel and watching from a third: join the same channel, start a duel, open the swords badge on the non-participant, click **Watch**. Confirm the `Game` chip appears, the board updates live, the result holds when the match ends, the Idle card appears before the next match, and **Stop watching** removes the chip.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.spectator.test.tsx
git commit -m "feat(games): wire the spectate chip into the channel activity region"
```

---

### Task 20: `docs/UI_GUIDE.md`

**Files:**
- Modify: `docs/UI_GUIDE.md` — Main Panel Region Pattern (`:234-256`), Minigame Panel Pattern (`:302-371`), Project 1 Duel Queue Pattern (`:418-473`), and a new Game Spectator Pattern section
- Verify: line numbers have shifted; re-locate each section by heading before editing.

**Interfaces:** documentation only.

- [ ] **Step 1: Extend the Main Panel Region Pattern**

Rule 2 (`:245-246`) currently states the prohibition one-way. Make it two-way:

```markdown
2. Game mode is entered by **participating** in a game, never by spectating one. Opening
   the solo idle game is participation. Spectating is the opposite direction of the same
   rule: it is a chip in the split layer (`ChannelActivityKind = 'spectate'`, label
   `Game`) and must never set `MainPanelMode = 'game'`. The kind is `'spectate'` rather
   than `'game'` precisely so the two cannot be confused.
```

Add a new rule 7:

```markdown
7. The region has no collapse, minimise or maximise affordance, for any activity kind.
   It is not dismissible: the gate is purely derived, and clicking the active chip
   re-selects the same value. Every activity ends by terminating itself. A collapse
   toggle would create a subscribed-but-invisible state — the ambiguity that already
   costs the most in this region.
```

And extend rule 4's reference list to name all three chips.

- [ ] **Step 2: Add the Game Spectator Pattern section**

Insert after the Minigame Invite Pattern (`:372-378`):

```markdown
### Game Spectator Pattern

Reference: `components/Games/SpectatorActivity.tsx`, `SpectatorActivity.module.css`,
`components/Games/DeathrollSpectatorBoard.tsx`, `components/Games/RpsSpectatorBoard.tsx`,
`components/Games/useSpectatorState.ts`, `workspace/channelActivity.ts`

Watching a minigame you are not playing is the third chip in the channel activity
region (`'spectate'`, label `Game`). It is never game mode: game mode is
participation.

Rules:
1. **Opt-in is always a local click.** The entry point is the **Watch** button in
   `DuelQueueModal`'s active-duel card, enabled only when the snapshot's channel is
   the joined voice channel — spectating is same-channel only. Watch starts
   spectating, sets the explicit activity so the stage takes focus, and closes the
   modal. No activity may appear without a click.
2. **Spectating is a channel mode that outlives any single match.** You keep watching
   match after match until you stop, leave the channel, or disconnect. A match ending
   does not stop it and never requires a resubscribe.
3. The stage has exactly three states, and **Stop watching** is present in all of
   them: **Live** (the spectator board), **Ended** (the same board showing its
   result, held until the next match starts) and **Idle** (the next-up card).
4. The Idle card shows only the upcoming pair, game and format, or the ready-check
   waiting line, read from the already-broadcast queue snapshot. **No queue list and
   no ETAs** — the queue lives in the sidebar badge and `DuelQueueModal`.
5. **There is no collapse affordance.** Stop watching is the only exit, and the
   region collapses on its own when nothing else is live. Switching the stage to
   another chip leaves you subscribed with the chip lit; there is no grace period and
   no pause machinery, because spectator frames are low-frequency.
6. Spectator boards are **read-only**: no action buttons, no forfeit, no countdown
   bar (a spectator has no turn), no Head-to-head panel. They reuse the participant
   boards' visual language and tokens.
7. **A spectator board must never render hidden state.** RPS renders commitment as a
   per-player state ("Thrown" / "Choosing…"), never a throw, and reveals throws only
   from `lastRound`. The server enforces this by giving `IGameEngine` a
   `SpectatorView` with no default implementation: a new engine cannot compile until
   its author decides what a spectator may see. Never infer a spectator view from a
   participant view.
8. Spectator views carry **no history**. Every roll already appears in `game.feed`,
   which is broadcast channel-wide and renders in the conversation region directly
   below the stage.
```

- [ ] **Step 3: Update the Minigame Panel Pattern file references**

In the Reference line (`:304-305`) and anywhere in that section that names the files, replace `DeathrollModal.tsx` → `DeathrollBoard.tsx`, `DeathrollModal.module.css` → `DeathrollBoard.module.css`, `RpsModal.tsx` → `RpsBoard.tsx`, `RpsModal.module.css` → `RpsBoard.module.css`. Add a note:

```markdown
These are boards, not modals, and are named accordingly. They keep the shared
`.modal-close` / `.modal-header` / `.modal-title` classes because those are a
cross-app card convention, not a claim about being a dialog.
```

- [ ] **Step 4: Update the Project 1 Duel Queue Pattern**

Add to that section's rules:

```markdown
- The active-duel card carries a single action, **Watch**, which starts spectating.
  It is enabled only when `snapshot.channelId === joinedChannelId`: the modal can peek
  at other channels' queues, but spectating is same-channel only. The modal is
  otherwise read-only. See the Game Spectator Pattern.
```

- [ ] **Step 5: Verify**

```bash
git grep -n "DeathrollModal\|RpsModal" docs/UI_GUIDE.md
```
Expected: no matches.

Re-read the edited sections and confirm every file path resolves:

```bash
git grep -n "components/Games/" docs/UI_GUIDE.md
```
Every referenced path must exist on disk.

- [ ] **Step 6: Commit**

```bash
git add docs/UI_GUIDE.md
git commit -m "docs: document the game spectator pattern and the board renames"
```

---

## Final Verification

- [ ] `dotnet build` — clean
- [ ] `dotnet test` — all PASS
- [ ] `cd src/Brmble.Web; npm run type-check` — clean
- [ ] `cd src/Brmble.Web; npm run test` — all PASS
- [ ] `cd src/Brmble.Web; npm run build` — clean
- [ ] `git grep -n "DeathrollModal\|RpsModal"` — no matches anywhere
- [ ] `git log --oneline` on `feature/game-spectating` shows the tasks in order, all on the branch, **none on `main`**
- [ ] Ask before pushing or opening a PR.

## Spec Coverage

| Spec section | Task |
|---|---|
| §1 Channel-scoped subscription | 3 |
| §2 Privacy-safe views, no default impl | 1 |
| §2 No history in spectator views | 1 (record shapes), 20 (rule 8) |
| §3 `SpectatorService`, fan-out, participant exclusion, sequencing | 2, 3 |
| §4 `GameSessionManager` integration, exactly-once end | 5 |
| §5 Wire contracts | 2 |
| §6 Endpoints | 6 |
| §7 Lifecycle invalidation | 4, 7 |
| §8 `/games/action` guard | 8 |
| §9 Activity kind + exhaustive-switch trap | 12, 13 |
| §10 `useSpectatorState` | 14 |
| §11 Discovery and entry point | 18, 19 |
| §12 `SpectatorActivity`, three states | 17 |
| §13 How spectating ends, no collapse | 17, 19 |
| §14 Boards and renames | 10, 11, 15, 16 |
| §15 Unchanged surfaces | verified by existing tests staying green in 10, 11, 19 |
| Documentation | 20 |
| Testing (server) | 1, 3, 4, 5, 6, 8 |
| Testing (client) | 9, 12, 13, 14, 15, 16, 17, 18, 19 |
| Arena compatibility (frozen surface + recorded divergence) | 2, 3 |

