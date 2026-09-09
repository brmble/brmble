# Game Spectating As A Channel Activity — Design

Date: 2026-08-24
Status: Approved for planning
Branch: `feature/game-spectating`
Builds on: PR #642 (`d5fcb5df`), `docs/superpowers/specs/2026-08-19-main-panel-regions-and-conversation-tabs-design.md`

## Problem

You can play a minigame in Brmble. You cannot watch one.

The only thing a non-participant sees today is the ephemeral `game.feed` chat line — 🎲 and 💀 text the server composes and broadcasts to the channel (`GameSessionManager.cs:630-638`). Live match state is participant-only: `game.stateUpdated` is published to `RouteSet(match)`, which is exactly the two players (`GameSessionManager.cs:267-268`, `:332-336`).

PR #642 built the surface where watching belongs. The channel activity region stages exactly one activity with chips to switch, bound to the joined voice channel, and it currently offers two: screen share and paint. A third chip is the natural home for spectating, and `UI_GUIDE.md:245` already fixes the constraint:

> Game mode is entered by **participating** in a game, never by spectating one.

Spectating must therefore never set `MainPanelMode = 'game'`. It is a chip in the split layer.

## Goal

Let a channel member watch a live minigame they are not playing, as a third chip in the channel activity region, and land it as one PR.

---

## Prior work: what survives and what does not

`docs/superpowers/plans/2026-07-25-generic-spectator-and-foreground-activity.md` must not be executed as written.

**Its server half survives in shape**: a `SpectatorService` owning subscriptions, a privacy-safe `SpectatorView` on `IGameEngine`, subscribe/unsubscribe endpoints, same-channel authorization, lifecycle invalidation, and the Deathroll and RPS view content. This design changes one thing about it, described under *Subscription scope* below, and that change deletes a large amount of its complexity.

**Its client half is dead.** `useForegroundActivity`, the `ChatPanel` foreground slot, and the screen-share pause/restore work were all superseded by #642. That plan also predates collaborative paint entirely.

Two of its assumptions are also factually stale and are not carried forward:

- It assumed the queue needed a home in the panel. It does not; see *Discovery and entry point*.
- It added roll history to both engines. The `game.feed` shipped after it was written and already provides that history; see *Decision: no history in spectator views*.

## Two facts that shape the whole design

**The queue half needs no server work.** `game.queueSnapshot` is already broadcast channel-wide (`DuelOrchestrator.cs:1145` via `BrmbleEventBus.BroadcastToChannelAsync`, `Events/BrmbleEventBus.cs:255-275`) and carries `active`, `readyCheck`, `queue[]`, players, format and ETAs. Every channel member already has it. Only live board state requires a new transport.

**Neither engine has history.** `DeathrollEngine.State` keeps `LastRoll` and aggregate luck tallies only (`DeathrollEngine.cs:21-31`). `RpsEngine.State` keeps `Last`, a single resolved round (`RpsEngine.cs:45-60`). Adding history is new mutable engine state, not a new projection.

---

## Architecture

### 1. Spectating is a channel mode, not a match view

You opt in once and keep watching match after match until you explicitly stop, leave the channel, or disconnect. The region persists through the gap between matches.

This makes the subscription **channel-scoped**: `SubscribeAsync(sessionId, userId, channelId)`. The server holds "this user is spectating channel 7" and delivers frames for whatever match is live there.

The alternative — match-scoped subscription with client-side resubscribe on the next match — was rejected because it invents a retry loop with a real race: a short match can start and produce frames before the resubscribe lands, and the framework spec forbids replay.

Channel scoping removes complexity rather than adding it:

- **`MatchEnded` is no longer a close reason.** A match ending ends a match, not a subscription. Close reasons reduce to `Unsubscribed`, `AuthorizationLost`, `Disconnected`, `ChannelRemoved`.
- **`MatchNotLive` is no longer a rejection.** Subscribing to an idle channel is valid and returns a null match.
- Authorization was always same-*channel*, never same-*match* (`DuelOrchestrator.cs:121-125`). The subscription now matches the rule it is checked against.

It also makes the server half **game-agnostic**. Nothing in `SpectatorService` knows what a duel is; it is keyed on channel and match. A future many-player minigame fits without a contract change.

### 2. Privacy-safe views

`IGameEngine` gains:

```csharp
object SpectatorView(object state);
```

with **no default implementation**. A new engine cannot compile without deciding what a spectator may see, which turns the framework spec's "never infer a spectator view from a participant view" rule into a compiler error rather than a convention.

```csharp
public sealed record DeathrollSpectatorView(
    string Kind, IReadOnlyList<long> Players, long? CurrentPlayer,
    int Ceiling, int? LastRoll, bool Finished, long? LoserId);

public sealed record RpsResolvedRoundSnapshot(
    int RoundNumber, int Sequence, string Pick0, string Pick1, long? WinnerId, bool Tie);

public sealed record RpsSpectatorView(
    string Kind, IReadOnlyList<long> Players, int BestOf, int TargetWins,
    int RoundNumber, IReadOnlyList<int> RoundWins, IReadOnlyList<bool> Committed,
    bool Finished, long? WinnerId, RpsResolvedRoundSnapshot? LastRound);
```

Deathroll's spectator view mirrors its participant view exactly, because `DeathrollEngine.PublicView` is already fully public and ignores `forUserId` (`DeathrollEngine.cs:136-148`). RPS is the only engine with real filtering: `Committed` carries whether each player has thrown, never what. `Picks`, `myPick` and `opponentPicked` never appear. Resolved throws exist only inside `LastRound`.

#### Decision: no history in spectator views

Every roll already appears in chat. `game.feed` is broadcast channel-wide, and the conversation region sits directly below the stage showing the joined channel by default — which is the channel you must be in to spectate. A spectator already has the running history one region down.

Adding history would mean new mutable state in both engines, larger frames, and a second source of truth that can disagree with the feed. It is deliberately deferred. Because `SpectatorView` returns a game-specific record per engine, adding Deathroll roll history or an RPS round log later is additive and touches one engine at a time.

### 3. `SpectatorService`

Registry, serialized behind one `SemaphoreSlim`:

- `channelId → HashSet<long> subscriberUserIds`
- `channelId → current match descriptor and latest frame`

```csharp
public enum SpectatorTransport { DiscreteEventBus, DedicatedRealtime }
public enum SpectatorRole { Spectator, Participant }
public enum SpectatorSubscribeReason { None, NotPresent, NotSameChannel }
public enum SpectatorCloseReason { Unsubscribed, AuthorizationLost, Disconnected, ChannelRemoved }
public enum MatchEndReason { Completed, Forfeited }

public interface ISpectatorCoordinator
{
    // Discrete, channel-scoped. New in this project.
    Task PublishDiscreteFrameAsync(SpectatorSourceFrame frame);
    Task EndMatchAsync(long matchId, int channelId, long finalSequence, MatchEndReason reason, object outcome);

    // Frozen by docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md.
    Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match);
    Task<SpectatorAuthorizationResult> AuthorizeAsync(
        long sessionId, long userId, long matchId, SpectatorRole role);
}

public interface ISpectatorLifecycle
{
    Task HandleChannelChangedAsync(long sessionId, int newChannelId);
    Task HandlePresenceLostAsync(long sessionId, SpectatorCloseReason reason);
    Task HandleChannelRemovedAsync(int channelId);
    Task HandleTransportDisconnectedAsync(long userId);
}

public sealed record SpectatorSourceFrame(
    long MatchId, int ChannelId, DuelConfiguration Configuration,
    IReadOnlyList<DuelPlayerSnapshot> Players,
    IReadOnlySet<long> ParticipantUserIds,
    long Sequence, DateTimeOffset GeneratedAt, object View);

public sealed record SpectatorSnapshot(
    int SchemaVersion, long MatchId, int ChannelId, string GameType, string Format,
    int RulesetVersion, IReadOnlyList<DuelPlayerSnapshot> Players,
    long Sequence, DateTimeOffset GeneratedAt, object View);
```

`SpectatorMatchDescriptor` and `SpectatorAuthorizationResult` are carried unchanged from the July plan and exist only for the Arena path; this project does not read them.

Naming note: `DuelConfiguration` and `DuelPlayerSnapshot` are duel-named but structurally generic — `DuelConfiguration` is `(GameType, Format, RulesetVersion, Options, RunnerKey)` (`Games/Duels/DuelModels.cs:3-8`). They carry no two-player assumption, so reusing them here does not make the spectator half duel-specific. Renaming them is out of scope.

**Fan-out.** `PublishDiscreteFrameAsync` targets the frame channel's subscribers **minus `frame.ParticipantUserIds`**, over the existing `IGameEventPublisher.PublishToUsersAsync`. Never channel broadcast: opt-in is the point, and per-action frames are far more frequent than `game.queueSnapshot`.

**Participant exclusion.** There is one active match per channel, so a spectator who accepts a challenge is now playing the match they were watching. They keep receiving `game.stateUpdated` as a participant and receive no spectator frame for that match. The subscription itself stays alive — it is channel-scoped and they are still in the channel — so when the match ends, the next match's frames flow with no resubscribe.

Invariant to test: **a participant of match M never receives a spectator frame for match M.**

**Sequencing.** Monotonic per match, assigned under `match.Lock`. Frames with a sequence at or below the last delivered value are dropped.

### 4. `GameSessionManager` integration

`LiveMatch` gains `SpectatorSequence` and `SpectatorEnded`.

A frame is captured under `match.Lock` after the start state exists and after every action and timeout mutation, then published outside the lock through the existing `OutboundTail` ordering chain (`GameSessionManager.cs:243-255`), preserving per-match ordering without holding the lock across I/O.

Every terminal path — normal completion (`:429`) and forfeit (`:520`, `:539`) — calls `EndMatchAsync` exactly once, under `SpectatorEnded` guarding. Forfeits fabricate no frame, so `finalSequence` is the last complete frame's sequence. This is why match end is signalled by a dedicated event rather than by a terminal frame: it handles both paths uniformly.

### 5. Wire contracts

Three events on the existing `game.` prefix, so `MumbleAdapter` forwards them unchanged.

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
    { "userId": 100, "sessionId": 10, "displayName": "Qy", "ready": false },
    { "userId": 200, "sessionId": 20, "displayName": "Broan", "ready": false }
  ],
  "sequence": 4,
  "generatedAt": "2026-08-24T14:30:04.0000000+00:00",
  "view": {
    "kind": "rps",
    "bestOf": 3, "targetWins": 2, "roundNumber": 2,
    "roundWins": [1, 0],
    "committed": [true, false],
    "finished": false, "winnerId": null,
    "lastRound": {
      "roundNumber": 1, "sequence": 1,
      "pick0": "rock", "pick1": "scissors",
      "winnerId": 100, "tie": false
    }
  }
}
```

An unresolved RPS payload contains `committed` booleans only. It never contains `myPick`, `opponentPicked`, `picks`, or a `pick0`/`pick1` for the current unresolved round.

```json
{ "type": "game.spectatorMatchEnded", "schemaVersion": 1, "matchId": 91, "channelId": 7,
  "reason": "completed", "finalSequence": 9,
  "outcome": { "winnerId": 100, "loserId": 200 } }

{ "type": "game.spectatorClosed", "channelId": 7, "reason": "authorizationLost" }
```

### 6. Endpoints

Both use the same `ResolveUserAsync` certificate-hash pattern as every other games route (`GameEndpoints.cs:222-235`).

`POST /games/spectators/subscribe`, body `{ channelId }`. Returns `200 { channelId, match: SpectatorSnapshot | null }`, or `400 { error, reason }` with `reason` in `notPresent | notSameChannel`.

`channelId` is **validated against** the caller's live channel membership rather than derived from it. A concurrent channel move then fails loudly with `notSameChannel` instead of silently subscribing the user to the wrong channel.

`POST /games/spectators/unsubscribe`. Returns `200 { unsubscribed: true }`.

### 7. Lifecycle invalidation

- `MumbleServerCallback.DispatchUserStateChanged` — `HandleChannelChangedAsync(sessionId, newChannelId)` **before** `_channelMembership.Update`, so the drop happens while the old membership is still readable.
- `MumbleServerCallback.DispatchUserDisconnected` — `HandlePresenceLostAsync` before session mapping and membership removal.
- `MumbleServerCallback.DispatchChannelRemoved` — `HandleChannelRemovedAsync`.
- `BrmbleWebSocketHandler` — `HandleTransportDisconnectedAsync(userId)` when a user's **final** application WebSocket closes. One of two sockets closing does not clear the subscription.

Reconnecting requires an explicit fresh subscribe. Nothing is restored implicitly.

### 8. `/games/action` ownership guard

`POST /games/action` (`GameEndpoints.cs:112-122`) performs no ownership check and relies entirely on the engine rejecting a foreign session; `dto.Action` is never null-checked. This was deferred defect #2 of `docs/superpowers/reviews/2026-07-28-duel-orchestration-queue-review.md`.

Today it is theoretical. The moment non-participants can see a live match it becomes a real privilege boundary — "spectators cannot submit game actions" is a stated requirement that nothing currently enforces at the endpoint. It gains forfeit's existing guard, `TryGetActiveMatch(user.UserId) && active.MatchId == dto.MatchId`, plus a null check on `dto.Action` returning the standard `GameErrorWire`.

### 9. Client: the activity kind

```ts
export type ChannelActivityKind = 'screen-share' | 'paint' | 'spectate';
```

The kind is `'spectate'`, not `'game'`. `MainPanelMode` is already `'game' | 'split'` where `'game'` means **participating** — the exact distinction `UI_GUIDE.md:245` depends on. Two `'game'` values meaning opposite things would be a trap in the one place the guide most needs to be unambiguous. The user-facing chip label is `Game`, which is game-neutral and does not presume two players.

`selectStage` needs no change; it has no per-kind branching.

#### The exhaustive-switch trap

Two sites in `App.tsx` are exhaustive over exactly two members and use a bare else, so adding a third kind produces **no type error** and silently mislabels it. Both must be fixed **before** `'spectate'` joins the union, or the compiler protects nothing. This is an ordered step, not a discovery.

- `App.tsx:5125` — `label: kind === 'screen-share' ? 'Screen share' : 'Paint'` becomes a `Record<ChannelActivityKind, string>` label map, which removes the failure mode permanently rather than relocating it.
- `App.tsx:5130-5151` — the stage-body ternary chain becomes a `switch` with `default: assertNever(stage)`.

`availableActivities` (`App.tsx:4986-4991`) appends `'spectate'` last, leaving existing chip order untouched. The region gate (`App.tsx:5116-5118`) is unchanged: still `joinedChannelId` set, not server root, at least one activity.

### 10. Client: `useSpectatorState`

Owns `spectatingChannelId`, the current match descriptor and view, finished/outcome state, and the last close reason. Exposes `startSpectating(channelId)` and `stopSpectating()`.

Subscribes to `game.spectatorSnapshot`, `game.spectatorMatchEnded` and `game.spectatorClosed`. Gates frames on monotonic `(matchId, sequence)`. Resets on `voice.connected` and `voice.channelChanged`.

Modelled on `useDuelQueueState`'s existing guard structure — schema version check, channel match, monotonic revision (`useDuelQueueState.ts:112-118`) — so the two hooks read alike.

### 11. Client: discovery and entry point

Opting in is a click, exactly as watching a share is (`handleWatchScreenShare`, `App.tsx:4744`) and joining paint is (`PaintSessionCard.tsx:92`). Neither activity can appear without a local click today, and spectating must not either.

`DuelQueueModal` gains an `onWatch` prop and a **Watch** button in its active-duel card (`DuelQueueModal.tsx:95-108`), enabled only when `snapshot.channelId === joinedChannelId`, since spectating is same-channel only. Clicking it starts spectating, sets the explicit activity to `'spectate'` so the stage takes focus under the region's "explicit click always wins" rule, and closes the modal.

This reuses discovery that already exists — the swords badge already tells you a duel is running and already opens this modal — and needs no new surface. The modal is otherwise unchanged and remains read-only; Watch is its only action.

The `game.feed` start line becoming a launchable card is the obvious follow-up, but `game.feed` messages are ephemeral system text (`systemType: 'game'`), not cards, so that requires a card renderer and is out of scope.

### 12. Client: `SpectatorActivity`

The stage host, with three states and a persistent **Stop watching** control in all of them.

- **Live** — `DeathrollSpectatorBoard` or `RpsSpectatorBoard`.
- **Ended** — the same board showing its result, held until the next match starts.
- **Idle** — the next-up card: the upcoming pair, game and format, or the ready-check waiting line, read from the already-broadcast `game.queueSnapshot`. No queue list, no ETAs, no server cost.

Because spectating is a mode, an ending match does not stop it. The stage falls back to Idle and the next match flows in with no resubscribe.

**Known boundary:** the Idle state is duel-specific, because "next up" reads a pair-based duel queue. A future many-player minigame has no such queue and Idle degrades to a plain waiting state for it. The server half and the Live and Ended states carry no such assumption.

### 13. Client: how spectating ends

Stop watching unsubscribes, removes `'spectate'` from `availableActivities`, and the region collapses on its own if nothing else is live — identical in shape to unwatching every share or closing paint.

There is deliberately **no collapse or minimise affordance**, for any kind. The region is not dismissible today: `ChannelActivityRegion.tsx` has no close control, `App.tsx:5116` is a pure derived gate, and clicking the active chip re-selects the same value. Every activity ends by terminating itself.

A collapse toggle would create a subscribed-but-invisible state. That ambiguity is already the most expensive thing in the shipped region — it is the entire reason for `setRemoteScreenSharesHidden` and the 10-second grace period — and generalising it is a main-panel feature deserving its own design across all three kinds, not something smuggled in behind spectating.

Switching the stage to paint or screen share leaves you subscribed with the chip lit. Spectator frames are low-frequency, so there is no grace period and no pause machinery.

### 14. Client: boards and renames

`DeathrollSpectatorBoard` and `RpsSpectatorBoard` are read-only and reuse the participant boards' visual language and tokens. RPS renders commitment as a per-player state, never a throw, and reveals throws only from `lastRound`.

`DeathrollModal` and `RpsModal` are no longer modals — no `role="dialog"`, no `aria-modal`, no overlay, no focus trap. Only their names still say so, and this project adds `*SpectatorBoard` siblings that make the inconsistency visible in a directory listing. They are renamed now, while the sibling files are being added and the compiler catches every site:

- `DeathrollModal.tsx` → `DeathrollBoard.tsx`, export `DeathrollBoard`, props `DeathrollBoardProps`
- `RpsModal.tsx` → `RpsBoard.tsx`, export `RpsBoard`, props `RpsBoardProps`
- CSS classes `.deathroll-modal` → `.deathroll-board`, `.rps-modal` → `.rps-board`
- Test files follow

The shared `.modal-close`, `.modal-header` and `.modal-title` classes stay. They are a documented cross-app convention (`UI_GUIDE.md:327-330`), not a claim about being a dialog.

`DuelQueueModal` keeps its name. It genuinely is one.

### 15. Unchanged

The swords badge, the `duelChannelIds` and `personalDuelChannelIds` derivation (`App.tsx:1120-1133`), cross-channel queue peeking, `game.feed` chat lines, `useDuelQueueState`, and the participant game surface all survive exactly as they are.

---

## Documentation

`docs/UI_GUIDE.md`:

- **Main Panel Region Pattern** (`:234-256`) gains the third chip, and states from the other direction that spectating never enters game mode, so the rule at line 245 reads as two-way rather than a one-way prohibition.
- New **Game Spectator Pattern** section: opt-in entry point, the three stage states, Stop watching, the absence of a collapse affordance, and the invariant that spectating is a channel mode outliving any single match.
- **Minigame Panel Pattern** (`:302-371`) file references updated for the `*Board` renames.
- **Project 1 Duel Queue Pattern** (`:418-473`) gains the Watch button and its same-channel enablement rule.

## Testing

**Server.**

- Contract test serialising an unresolved `RpsSpectatorView` and asserting no throw value appears anywhere in the JSON.
- `SpectatorServiceTests`: subscribe to an idle channel succeeds with a null match; subscribe to a live channel returns the current frame; cross-channel subscribe rejects with `notSameChannel`; a participant of match M receives no spectator frame for M; stale sequences are dropped; each of the four lifecycle teardowns removes the subscription, publishes the right close reason, and stops delivery; a match ending does **not** remove the subscription.
- `GameSessionManagerTests`: monotonic unique sequences across start, action and timeout; exactly-once `EndMatchAsync` under concurrent completion, including the forfeit path with no fabricated frame.
- `GameEndpointsTests`: both new routes including unauthenticated and structured-reason paths; `/games/action` rejecting a non-participant and a null action.

**Client.**

- `channelActivity` with three kinds; the label map covering every kind.
- `useSpectatorState`: sequence gating, match transition without resubscribe, each close reason, reset on channel change.
- `SpectatorActivity`: all three states, and Stop watching removing the chip.
- Both boards, including an RPS test asserting no unresolved throw is rendered.
- `DuelQueueModal`: Watch enablement bound to `joinedChannelId`, disabled for other channels.
- App integration: the chip appears on Watch, survives a match ending, and disappears on Stop watching.
- App integration: a spectator who becomes a participant sees game mode take the panel, and returns afterwards to a still-live spectator region — asserting the split layer was hidden, not unmounted.

## Risks

The exhaustive-switch fix must land before `'spectate'` joins the union, or the compiler protects nothing. Ordered as its own step.

The rename touches many files, but is mechanically compiler-checked and carries no behaviour change.

Spectator frames raise the fill rate of the unbounded `NativeBridge._pendingMessages` queue (`NativeBridge.cs:36`, deferred defect #1). Accepted: frames are small by the no-history decision, and Deathroll and RPS are low-frequency. The defect remains recorded as pre-existing and out of scope.

The design assumes one active match per channel, which `DuelOrchestrator` enforces today and Arena is specified to preserve.

## Arena compatibility

`ISpectatorCoordinator` keeps `RegisterContinuousMatchAsync` and `AuthorizeAsync(sessionId, userId, matchId, role)`, along with `SpectatorMatchDescriptor`, `SpectatorAuthorizationResult`, `SpectatorRole` and `SpectatorTransport`, with the names and meanings frozen by `docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md`.

**One frozen signature does change.** That plan specified `EndMatchAsync(matchId, channelId, finalSequence)`. This design adds `MatchEndReason reason` and `object outcome`, because forfeits fabricate no terminal frame and spectators therefore need the outcome delivered by the lifecycle call rather than inferred from a final frame. Arena is unimplemented, so this costs nothing today; it is recorded here so the divergence is not discovered later as a surprise. The three parameters Arena passes keep their positions and meanings.

Arena's per-match realtime ticket is genuinely per-match and is unaffected by channel-scoped discrete subscriptions, which sit alongside it. No continuous simulation frame may enter `SpectatorService` or the event bus.

`ForegroundActivity` and `useForegroundActivity` from the July plan do **not** exist and will not be created; Arena's spectator surface will be a `'spectate'` stage in the channel activity region, like every other spectated game.

## Non-goals

- Queue-in-panel, and any swords-badge redesign
- Region collapse, minimise or maximise, for any activity kind
- Per-game history in spectator views
- Cross-channel spectating
- A launchable card on `game.feed` lines
- Arena Knockoff
- Bounding `NativeBridge._pendingMessages`, and the `DecodeChunkedBody` multibyte defect

## Decisions recorded

| Decision | Choice |
|---|---|
| Chip presence | Only while spectating; queue stays in the sidebar badge and `DuelQueueModal` |
| Opt-in click | Watch button in `DuelQueueModal`'s active-duel card, same-channel only |
| Ending spectating | Stop watching in the stage; no collapse affordance for any kind |
| Persistence | Spectating is a channel mode that outlives any single match |
| Subscription scope | Channel-scoped; `MatchEnded` and `MatchNotLive` cease to exist |
| Idle stage content | Next-up pair and ready check, from the already-broadcast queue snapshot |
| History in views | None; `game.feed` already provides it. Extensible per engine later |
| Spectator becomes participant | Server excludes a match's participants from that match's fan-out |
| Activity kind name | `'spectate'`, label `Game`; avoids collision with `MainPanelMode = 'game'` |
| `/games/action` guard | In scope; spectators make it a real privilege boundary |
| `NativeBridge` queue bound | Out of scope; unchanged risk profile |
| `*Modal.tsx` renames | Now, in this PR |
| PR shape | One PR, strictly ordered internally |
