# Arena Knockoff — Revision Design

Date: 2026-08-27
Status: Approved for planning
Branch: `docs/arena-knockoff-revision`
Base: `main` at `dd505be4` (PR #644, `feature/game-spectating`, merged)

Revises:

- `docs/superpowers/plans/2026-07-25-continuous-simulation-and-arena-knockoff.md` (1567 lines, 19 tasks)
- `docs/superpowers/specs/2026-07-25-arena-knockoff-design.md`

Against what shipped since:

- `docs/superpowers/specs/2026-08-19-main-panel-regions-and-conversation-tabs-design.md` (PR #642)
- `docs/superpowers/specs/2026-08-24-game-spectating-as-channel-activity-design.md` (PR #644)

## Purpose

This is a revision, not a redesign. The July plan remains largely correct: its
simulation, its ruleset constants, its transport protocol and its determinism
strategy were untouched by anything that has shipped since. What changed is the
ground underneath its client half, and two of the server contracts it consumes
turned out not to behave the way it assumed.

This document states what survives, what is replaced, why, and how the work is
now sequenced. The implementation plan follows separately.

---

## 1. Verification of the July plan's assumptions

Every claim below was checked against `main` at `dd505be4`.

### 1.1 Project-1 contracts — all valid, verbatim

`src/Brmble.Server/Games/Duels/DuelModels.cs` carries every contract the plan
freezes, with the same members in the same order:

| Contract | Location |
|---|---|
| `DuelConfiguration(GameType, Format, RulesetVersion, Options, RunnerKey)` | `:3-8` |
| `IDuelGameDefinition` | `:10-17` |
| `DuelPlayer(SessionId, UserId, DisplayName)` | `:19` |
| `DuelReservation` | `:21-29` |
| `ActiveMatchReference(MatchId, ReservationId, ChannelId, RunnerKey)` | `:41` |
| `GameStartResult` | `:42` |
| `MatchCompletion` | `:44-51` |
| `IDuelMatchRunner` | `:55-62` |
| `IDuelMatchRunnerRouter` | `:64-70` |
| `DuelPlayerSnapshot` | `:92` |

`DuelMatchRunnerRouter` routes on `reservation.Configuration.RunnerKey`
(`DuelMatchRunnerRouter.cs:26`) and is registered at `GamesExtensions.cs:34-35`.
`GameDefinitionCatalog(IEnumerable<IDuelGameDefinition>)` propagates `RunnerKey`
into the canonical configuration (`GameDefinitionCatalog.cs:19`). Registering a
second runner with `RunnerKey = "continuous"` works exactly as the plan
describes, with no modification to either type.

`ActiveMatchReference` carries `RunnerKey`. This matters more than the plan
anticipated; see §2.2.

### 1.2 `IGameEngine` — Arena is unaffected

`IGameEngine : IDuelGameDefinition` gained `object SpectatorView(object state)`
with no default body (`IGameEngine.cs:68`), so a new engine cannot compile
without deciding what a spectator may see. Its interaction models remain
`AlternatingTurns` and `SimultaneousCommit`, satisfying plan line 20.

`ArenaGameDefinition` implements `IDuelGameDefinition` directly and never
`IGameEngine`, so the new member cannot reach it. Confirmed, not assumed.

### 1.3 Project-2 spectator types — names valid, two bodies are not

All five types the plan names exist with exact names:
`ISpectatorCoordinator` (`SpectatorModels.cs:80`), `SpectatorMatchDescriptor`
(`:67`), `SpectatorAuthorizationResult` (`:75`), `SpectatorRole` (`:9`),
`SpectatorTransport` (`:6`).

Their *behaviour* is another matter; see §2.

### 1.4 Client foreground model — dead

Zero occurrences in `src/` of `ForegroundActivity`, `useForegroundActivity`,
`setRemotePlaybackPaused` and `DuelActivity`. They were explicitly killed by
`2026-08-24-game-spectating-as-channel-activity-design.md:32` and `:358`. They
will not be created.

### 1.5 Path corrections

The plan names three paths that do not exist as written. The referents do exist:

| Plan says | Actually |
|---|---|
| `InputRouter.Suspend()/Resume()` in `Services/Input/` | `Services/Voice/Input/InputRouter.cs`, `Suspend()` `:157`, `Resume()` `:166` |
| `src/Brmble.Web/src/hooks/useForegroundActivity.ts` | dead; nearest live analogue is `components/Games/useSpectatorState.ts` |
| `AppSettings.Games` | does not exist; `AppSettings.cs` has no `Games` record |

`tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs` exists.
`game.inputCapture` has zero occurrences anywhere, as the plan expects.

### 1.6 One live match per channel — verified, and out of scope

`SpectatorService.cs:24-35` records an assumption of at most one live match per
channel and notes that `GameSessionManager` does not structurally guarantee it.
That note is accurate: `GameSessionManager.cs:59` keys `_matches` globally by
match id, with no channel index.

The guarantee is enforced upstream instead. `DuelOrchestrator.AdvanceChannelAsync`
returns early when `channel.Active`, `channel.Starting` or `channel.ReadyCheck`
is set (`:713-717`), and the immediate-start path is guarded the same way
(`:226`). Arena reservations are created by that same orchestrator and are
subject to the same serialisation.

**Arena therefore adds no new pressure here, and this project does not address
it.** Recorded as verified-and-deferred rather than left open. Concurrent
matches per channel would require keying `SpectatorService`'s per-channel state
by match, and would be driven by a non-orchestrator match source, which does not
exist.

---

## 2. What is replaced — server

Three corrections. None of them touch a frozen *name*; all of them touch what
the plan believed those names did.

### 2.1 `AuthorizeAsync` and `RegisterContinuousMatchAsync` are stubs

```csharp
// SpectatorService.cs:173
public Task RegisterContinuousMatchAsync(SpectatorMatchDescriptor match)
    => Task.CompletedTask;

// SpectatorService.cs:176-178
public Task<SpectatorAuthorizationResult> AuthorizeAsync(
    long sessionId, long userId, long matchId, SpectatorRole role)
    => Task.FromResult(new SpectatorAuthorizationResult(
        false, role, SpectatorSubscribeReason.NotPresent));
```

Registration stores nothing. Authorization always denies. The types exist so
Arena compiles; the behaviour does not exist at all.

This contradicts plan line 37 — "Do not modify project 2's `SpectatorService`
contracts: consume its existing … methods" — and plan Task 11, which assumes
`AuthorizeAsync` works. Affected plan lines: 19, 37, 900, 943, 976, 990.

**Resolution: the contracts stay frozen; this project implements the bodies.**
"Consume, do not modify" was written about *shape*, and the shape is
unchanged — no parameter, return type or name moves. What the July plan could
not have known is that project 2 would ship the signatures without the
behaviour, because its own discrete path never reads them
(`SpectatorService.cs:175`, "Frozen by the Arena plan. Not read by the discrete
path").

The bodies land in slice 3b, not 3a; see §4.2. When they do:

- `RegisterContinuousMatchAsync` stores the descriptor in the per-channel
  registry the service already maintains.
- `AuthorizeAsync` resolves the descriptor by match id and answers:
  - `SpectatorRole.Participant` — authorized iff `userId ∈ descriptor.ParticipantUserIds`.
  - `SpectatorRole.Spectator` — authorized iff `userId ∉ descriptor.ParticipantUserIds`
    **and** the caller's live channel equals `descriptor.ChannelId`.
  - Denials reuse the existing `SpectatorSubscribeReason.NotPresent` and
    `NotSameChannel`, and reuse the service's existing channel-membership check.

`SpectatorService` gains a descriptor registry and an answer. It gains no
frames. **No continuous snapshot enters `SpectatorService` or the event bus**;
that constraint from the July plan is preserved exactly.

### 2.2 The plan's `RunnerKey` check is unimplementable as written

Plan Task 9 Step 4 and Task 10 Step 3 both require validating "the returned
descriptor's `Configuration.RunnerKey == "continuous"`". Two things make that
impossible:

1. `AuthorizeAsync` returns `SpectatorAuthorizationResult(bool Authorized,
   SpectatorRole Role, SpectatorSubscribeReason Reason)` (`SpectatorModels.cs:75-78`).
   It returns no descriptor.
2. `SpectatorMatchDescriptor` is
   `(long MatchId, int ChannelId, string GameType, SpectatorTransport Transport,
   IReadOnlySet<long> ParticipantUserIds)` (`:67-72`). It has no `Configuration`
   member. The plan's Task 11 Step 4 constructs it as
   `(matchId, channelId, configuration, players, transport)` — wrong arity,
   wrong order, wrong members.

**Replacement:** the runner check moves to the coordinator side, where the value
genuinely lives. `ContinuousGameCoordinator.TryGetActiveMatch(stableUserId, out
var active)` yields an `ActiveMatchReference` carrying `RunnerKey`
(`DuelModels.cs:41`), already set to `"continuous"` by the catalog. Arena
validates `active.MatchId` and `active.RunnerKey` there, and passes
`GameType = "arena-knockoff"` and `Transport = SpectatorTransport.DedicatedRealtime`
when registering.

The shipped descriptor is in fact better suited to this project than the one the
plan invented: `ParticipantUserIds` is precisely what an authorization body
needs, and the plan's `players` and `configuration` were never used for anything
else.

### 2.3 `EndMatchAsync` gained two parameters

```csharp
// SpectatorModels.cs:86
Task EndMatchAsync(long matchId, int channelId, long finalSequence,
                   MatchEndReason reason, object outcome);
```

The divergence is deliberate and documented at `SpectatorModels.cs:88-93`:
forfeits fabricate no terminal frame, so a spectator needs the outcome from the
lifecycle call rather than inferred from a final frame. The first three
parameters keep their positions and meanings, so Arena's call sites gain two
arguments and change in no other way. Affected plan lines: 976, 990.

### 2.4 Everything else on the server survives untouched

July Tasks 1-8 are sound and are not redesigned:

shared continuous contracts; checked fixed-point math and integer square root;
`ArenaRulesetV1`'s exact constants and its seven golden vectors; the exact
15-stage tick ordering; collision separation and the coincident-body fallback;
the piecewise shrink formula and its `599/600/2399/2400/3599/3600` boundary
vectors; Loading / Positioning / Live gates; charge, forced fire, cooldown,
recoil, projectiles and dash; BO3 and the double-KO anti-loop; 60 Hz rational
deadline scheduling with bounded catch-up; capacity-one replaceable snapshots
with bounded coalesced controls; input sequencing, rate limits and the 750 ms
neutral timeout; the 15-second attach gate; the non-pausing 5-second reconnect
grace; completion, persistence and queue advancement.

The realtime protocol version 1 — ticket shape, message shapes, prediction
constants, terminal-state-before-close — also survives unchanged.

---

## 3. What is replaced — client

### 3.1 The foreground model is deleted, not amended

July Task 17 is removed wholesale. The plan builds on `ForegroundActivity`,
`useForegroundActivity`, `setRemotePlaybackPaused`, the shared upper `ChatPanel`
foreground slot and `DuelActivity`; none exist and none will. Affected plan
lines: 7, 65, 1151, 1330, 1339, 1347, 1349, 1351, 1359, 1374, 1516 — concentrated
in Task 17, referenced from Tasks 9 and 11.

The screen-share pause/restore behaviour Task 17 specifies is also gone. PR #642
replaced it with the activity region's 10-second grace period
(`UI_GUIDE.md:259-261`), which staging owns and which is not Arena's concern.

### 3.2 Participation — Arena owns the main panel

`game.started` on the normal event bus sets `participatingMatchId`;
`selectMainPanelMode` (`workspace/mainPanelMode.ts`) returns `'game'`;
`MainPanel` hides the split layer with `visibility` + `inert` and renders the
game layer out of flow; `GameSurface` hosts `ArenaBoard`.

This is a better home than the July foreground slot, not merely a different one:
a full-panel canvas with pointer capture is exactly what the game needs, and it
costs no new rules. The split layer is **hidden, never unmounted**, so
`ChatPanel` drafts, search state and scroll position and `PaintSessionView`'s
canvas contents survive a match. Do not return the game surface early in place
of the split layer (`UI_GUIDE.md:337-346`).

`ArenaBoard` wears the shared card shell — `.glass-panel.animate-slide-up`,
`.modal-close`, `.modal-header`, `h2.heading-title.modal-title` — but **fills**
the surface rather than hugging its content, so the letterboxed canvas is as
large as the panel allows. `GameSurface` today centers a content-sized child
with `padding: var(--space-lg)` (`GameSurface.css:1-10`), which is right for
Deathroll and RPS and wrong for a 20 000-unit world. This is one amendment to
the Minigame Panel Pattern, not a new pattern.

**HUD split.** Header holds, as real DOM: match title, round and score, phase
countdown, session mute, close/forfeit. The canvas draws what is spatial: bodies
with clipped avatars, names, side markers, the always-visible thin aim line, the
growing charge line with its attached forced-fire countdown, projectiles with
presentation-only trails, the arena circle, plus the shot-cooldown arc and dash
marker **on the player's own body** and a shrink-phase label at the canvas edge.

Combat state sits at the player because a knockback brawler is unplayable if you
must look away from your character to learn whether you can shoot. Everything
drawn is mirrored into an `.sr-only` live region, so the July invariant holds:
**no gameplay information exists only on the canvas, and none is conveyed by
colour or sound alone.**

The rest of July Task 14 stands: uniform scale and letterboxing, inverse pointer
transform, avatar fallback, non-colour identity markers, reduced motion removing
shake and flashes without changing state or timing, tokens only.

### 3.3 Spectating — a `'spectate'` chip like every other game

`UI_GUIDE.md:245` is load-bearing and is not amended: game mode is entered by
participating, never by spectating. Arena spectating is the third chip in the
channel activity region (`ChannelActivityKind = 'spectate'`, label `Game`), in
the split layer.

`SpectatorActivity` branches on `gameType === 'arena-knockoff'` and mounts a
read-only Arena canvas fed by the dedicated realtime WebSocket, alongside the
existing discrete boards. The canvas letterboxes into whatever height the stage
has; a viewer who wants more drags `brmble-main-split`. No new default, no new
token, no new rule.

**The stage needs no new discrete plumbing to know a match is live.**
`game.queueSnapshot` is already broadcast channel-wide and carries `active` with
game type and players — the same source the existing Idle "next up" card already
reads. So the Arena branch requires zero additional server fan-out, and the July
constraint that no continuous snapshot may enter `SpectatorService` or the event
bus holds without effort.

Entry points are unchanged: the channel row's watch toggle and `DuelQueueModal`'s
Watch button, both gated on the joined voice channel
(`UI_GUIDE.md:690-701`).

### 3.4 Three silent-fallback sites must be fixed first

A third game type is currently swallowed in three places, two of them silently:

| Site | Failure |
|---|---|
| `useGameState.ts:8-10` `SUPPORTED_GAMES = ['deathroll', 'rps']` | Invites for any other type are auto-declined at `:217-222` with no error, no notification and no log. The challenger sees only "declined". |
| `App.tsx:5289` `gameType === 'rps' ? <RpsBoard> : <DeathrollBoard>` | Bare else. A third type renders the Deathroll board. |
| `SpectatorActivity.tsx:57` `isRpsSpectatorView` binary branch | Same shape, same fall-through. |

This is the exhaustive-switch trap the spectating design caught for
`ChannelActivityKind` (`2026-08-24-…-design.md:242-248`), recurring in the board
picker and still unfixed there. As in that project, **the fix is an ordered
step, not a discovery**: it lands before `arena-knockoff` is introduced
anywhere, or the compiler protects nothing.

All three are fixed in slice 3a, including the spectator picker, even though
Arena has no spectator view until 3b. Making both pickers exhaustive at the same
time costs nothing, and leaving one bare else behind would reintroduce exactly
the failure this step exists to remove.

`GAME_META` (`utils/games.ts:19-22`) and the icon registry degrade visibly
rather than silently (`gameDisplayName` falls back to a capitalised type,
`gameAvatarIcon` to the Deathroll dice), but are updated in the same step.

### 3.5 Targeted improvement: the challenge callback chain

`challengeMenu.tsx:56-74` is a hardcoded per-game submenu driven by per-game
callback props — `onChallengeDeathroll` and `onChallengeRps` — threaded through
`Sidebar` (`:44-45`, `:465-466`, `:501`, `:508`) and `ChannelTree` (`:69-70`,
`:113`, `:700`, `:710`). A third game means a third prop through two components
and a third clause in two guards.

This collapses to a single `onChallenge(gameType, options)` while Arena is being
added. It is code this project is already editing, the compiler catches every
site, and the change carries no behaviour difference. It is not a licence for
unrelated refactoring elsewhere.

### 3.6 Arena volume storage

`AppSettings.cs` has no `Games` record, and the shipped `GamesSettingsTab.tsx`
is fed entirely by the server (`GET`/`POST /games/settings` →
`GameSettingsDto(bool ChallengesBlocked)`).

Arena volume is added as `GamesSettings(int ArenaVolume = 65)` on native
`AppSettings`, persisted through the existing `settings.set` bridge path, as
July Task 16 planned. Output volume is a property of this machine's speakers,
not of an account, and must not follow a user to another device — the same
reasoning that keeps audio device selection local.

The cost is that `GamesSettingsTab` renders two controls backed by two different
stores. That is recorded in a comment at the tab, so it is not later "tidied"
into one path. `GamesSettingsTab.test.tsx` does not exist today and is created
alongside the volume slider in slice 3c.

Session mute remains activity-scoped, resets each session and never writes
settings.

---

## 4. Decomposition

The July plan is one project of 19 tasks spanning a deterministic simulation, a
new realtime transport, client prediction and reconciliation, Canvas rendering,
input capture, audio and telemetry. That is far larger than anything shipped so
far, and only its final group produces user-visible value on its own.

It is split into three **vertical** slices, each ending in something
demonstrable. The natural horizontal seams — simulation / transport / client /
telemetry — were rejected because the first two would merge large amounts of
unreachable code to `main`.

### 4.1 Slice 3a — Arena playable

July Tasks 1-8 (simulation and continuous runtime), 9-10 (ticket store and
realtime WebSocket, participant role only), 12-15 (protocol and connection,
prediction and reconciliation, Canvas renderer, input capture and native PTT
isolation), plus a rewritten panel-integration task replacing Task 17.

Ends with two people playing Arena in game mode.

Prediction and reconciliation are deliberately **in** this slice. They could
have been deferred — the protocol carries `predictedTick` and acknowledgement
sequences regardless, so a later addition would need no protocol change — but a
brawler that ships with visible input latency reads as broken rather than as
incomplete. The cost is accepted: 3a is roughly 13 tasks and includes the
riskiest client code.

**Ordering constraint.** §3.4's three silent-fallback sites are fixed as the
first client step, before `arena-knockoff` exists anywhere.

3a **does not touch `SpectatorService` at all.** Participant attach is
authorized through `ContinuousGameCoordinator.TryGetActiveMatch` plus
`ActiveMatchReference.MatchId` and `.RunnerKey`, which is sufficient, simpler,
and keeps participant routing owned by project 1 where it belongs. The two stubs
stay stubs.

### 4.2 Slice 3b — Arena spectating

Implements `RegisterContinuousMatchAsync` and `AuthorizeAsync` for both roles
(§2.1), adds the spectator role to ticket issuance and the realtime endpoint,
July Task 11, and the Arena branch in `SpectatorActivity` (§3.3).

Ends with a third channel member watching a live Arena match from the activity
stage.

Both stub bodies land together here rather than half in 3a, so the spectator
branch is written against a real consumer and no half-implemented method sits on
`main` between slices.

**Carried forward from 3a.** The local reconciliation work changed the renderer
contract in a way the spectator path must satisfy:

- `ArenaRenderView` now requires a `prediction: ArenaPredictionConstants` field.
  `ArenaRenderer` no longer carries its own `playerRadius` / `projectileRadius` /
  `shotCooldownTicks` constants, so any spectator render path must supply it.
  `ArenaBoard` sources it as `connection.welcome?.prediction ?? PREDICTION_V1`,
  because `welcome` is legitimately null on the terminal final-state path. A
  spectator has no participant `welcome` at all, so 3b must decide deliberately
  where its constants come from rather than inheriting that fallback by accident.
- `constrainLocalDisplay` is a **local-player-only** display filter and must not
  be applied to a spectated match. It exists to reconcile a locally predicted
  player against a buffered remote one; a spectator interpolates *both* players
  from the same authoritative timeline, so there is no timeline mismatch to
  correct and applying it would displace an authoritative position.

### 4.3 Slice 3c — Polish and gates

July Task 16 (audio cues, saved volume, session mute), Task 18 (operational
telemetry and bounded client reconciliation summaries), Task 19 (full
verification, controlled load gate, manual playtest, balancing gate).

The balancing gate remains the release condition it is in the July plan: a
failed gate changes `ArenaRulesetV1`, increments its version, and repeats
verification.

**Carried forward from 3a.** The local reconciliation work
(`docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md`) landed
green and reviewed, but deferred the following deliberately. None of it blocks
3b. Each entry names why it was deferred rather than fixed, so 3c can re-decide
rather than re-derive.

*Correctness and robustness*

- **The health-monitor generation guard has no mutation-sensitive test.**
  `FetchAndSendCredentials` starts health monitoring before awaiting the credential
  request, guarded by `IsCurrentConnectionGeneration` so a superseded connection
  cannot start a monitor for a stale `apiUrl`. Both call sites dispatch through
  `Task.Run`, so the window between capturing the generation and running the body
  is real. Removing that guard leaves the suite green: hitting the window
  deterministically needs a test seam between the capture and the call, and adding
  one to this path purely for coverage was judged a worse trade than recording the
  gap. The `apiUrl` half of the same condition is unreachable from both call sites
  — neither can pass an empty URL — though the predicate itself is unit-tested
  directly. Cost if wrong: a future refactor could drop the generation check and a
  replaced connection would start a monitor against the URL it just abandoned.

- **Holding fire through the countdown does not start a charge when the round goes
  live.** *Fixed.* `ArenaBoard` passes `combatEnabled: state.phase === 'live' && …`, and
  `useArenaInput`'s pointerdown handler returns early on `!combatEnabledRef.current`.
  So a press during `positioning` is dropped outright — no `charging: true` is ever
  sent. When `live` begins the button is already down, `pointerdown` cannot fire
  again, and nothing charges until the player releases and presses a second time.
  That punishes exactly the instinct the "Hold to shoot" legend teaches during the
  countdown it is shown in. `useArenaInput` already tracks the held button in
  `heldRef` (`'MouseLeft'`), so the fix is to re-send `charging: true` when
  `combatEnabled` transitions false → true while it is still held — the mirror of
  the existing effect that clears charging when combat becomes disabled. Client-only;
  no protocol or simulation change. Note the same reasoning applies to a held
  movement key, which `combatEnabled` does not gate, and to dash, which does.

- **`fromAuthority` throws on a missing local player, permanently killing the
  frame loop.** `arenaMath.ts` throws `'Arena authority does not contain the
  current session'`; the throw escapes the animation-frame callback *before*
  `requestAnimationFrame` reschedules, so the board freezes with no error
  surface. §"Error and Edge Handling" of the reconciliation spec requires "skip
  both collision stages and render the remote player". Pre-existing, not
  introduced by that work, and low probability because the server's `Players`
  array always holds two participants — which is exactly why it was left alone
  rather than fixed inside an unrelated 19-commit change.
- **`snappedRef` latches, so `snapCount` counts snap *streaks*, not snap
  frames.** A client persistently in an invalid position reports `snapCount` 0
  across an unbounded run of distinct snaps. Defensible as a metric definition,
  but Task 18's operational telemetry and bounded client reconciliation
  summaries are the first consumer that would read it as a health signal. Decide
  the semantics there. Note the sharp edge documented in `useArenaState.ts`:
  below three quarters of a player diameter, `invalidPosition` fires on the
  first synchronous frame where `predictedRef` is still undefined, so the ref
  latches at mount and pins `snapCount` at 0 regardless of correctness.

*Parity hardening*

- **Six of the nine client body-overlap parity cases have no server
  counterpart.** Only the even split, the odd unit to side 1, and negative
  normal truncation are cross-checked by MSTests. Not cross-checked: the
  exactly-touching boundary (the strict `>=`), the coincident-centre positive-X
  normal, the deliberate un-renormalized under-push, reversed argument ordering,
  and non-position field preservation. The first two are the likeliest to drift
  silently under a server refactor. Purely additive test work, zero production
  risk.
- **No test pins that `localPlayerRef` and the Canvas frame use the same local
  position.** Structurally true — one field, two consumers in `ArenaBoard` — but
  unguarded, so a future reintroduction of an unconstrained path for pointer aim
  would fail silently. The reconciliation spec's testing section names this
  explicitly.

*Legibility*

- **The three-part correction origin collapses to a single expression.**
  `correctionOrigin` is currently the rendered local position, minus its own
  sub-tick interpolation offset, advanced by the whole ticks the phase clock
  consumed — assembled across two tasks and one mid-task correction. It is
  algebraically equal to `advance(presented).player − correction · remaining`,
  computed entirely at reconcile time, which needs no `renderedBaseRef` and does
  not read `interpolatedPlayer` at all. The single-expression form is also
  marginally *more* correct: the ref carries a one-frame-stale `remaining`,
  roughly 16% of the residual correction at 60 Hz. Deferred because it is
  behaviour-changing at unit level, moves pinned expectations in the subtlest
  code on the branch, and refactoring correct code immediately after it
  stabilised trades real risk for legibility.

*Test-suite debt*

- The sustained-contact fixtures use a 50 ms snapshot interval, which is exactly
  three ticks at 60 Hz, so the preserved sub-tick phase is zero in exact
  arithmetic. Their discrimination of a phase-clock regression rests on IEEE-754
  residue in the presentation clock's `1000/60` accumulation. A non-tick-aligned
  interval such as 51 ms would exercise it robustly. Documented in the test file.
- Both sustained-contact fixtures place the local player on `side: 0`, so
  `resolveBodyOverlap`'s `aIsLow === false` branch and the odd-penetration
  asymmetry are never reached through the hook. Unit-covered in
  `arenaMath.test.ts`, but not in composition with the phase clock and the
  display constraint. Task 19's manual playtest should cover contact driven from
  the side-1 client specifically.
- Smaller items, all cheap: the non-mutation parity test asserts only its first
  argument; the diagonal-clear constraint test asserts only the `>= diameter²`
  inequality, so a wrong-but-still-clearing push would pass; a worked-example
  comment in `arenaMath.test.ts` reads `-23173.6` where the true quotient is
  `-23173.267`; `dashEndsAtTick` outliving the dash input flag makes the
  presentation step size 90 or 330 units and is documented only inside one test;
  the correction-origin advance lacks the phase guard the display path has
  (neutralised by `stepLocal`'s own short-circuit, costs at most three wasted
  clones per reconcile frame in non-live phases).

*Manual playtest additions for Task 19*

The reconciliation suite is hook-level and unit-level: no network, no packet
loss or reordering, no real frame-time jitter, no canvas, no second client.
Task 19's playtest is the only gate on these:

- **Contact under a degraded connection, watching your own player.**
  `constrainLocalDisplay` ties the displayed local position to `sampleTimeline`'s
  output, and `sampleTimeline` is not continuous — it abandons extrapolation and
  returns the latest frame verbatim once elapsed time exceeds
  `maxExtrapolationMs`. Under a dropped snapshot during contact, that
  discontinuity transfers to the *local* player, up to a full body diameter in
  one frame. Before this work a remote sampling discontinuity moved only the
  remote. This is display-only and self-healing, but it is the artifact most
  likely to be reported as "contact got worse under lag". If visible, the
  constraint needs slew-limiting against the sampled remote.
- Contact driven from the **side-1** client specifically (lower session id is
  side 0), contact combined with dash and with point-blank fire, aim while the
  constraint is engaged, a knockout caused by an overlap push, and a round reset
  entering while in contact. None of these compositions are covered by tests.

*Accepted, not deferred — do not "fix" without a decision*

- Near the ring the arena clamp takes precedence over full separation, so
  displayed bodies may still overlap within roughly the last 200 units before
  the edge. Rendering outside the ring without an authoritative knockout is the
  worse artifact. Documented in `constrainLocalDisplay`'s JSDoc.
- The client leaves the dead-reckoned opponent's velocity undamped while the
  server damps both players, so a small error term grows with replay length.
  This is why the deep-overlap snap threshold must not be tightened toward one
  full diameter.

---

## 5. Testing

The simulation testing strategy is carried forward unchanged, because nothing
invalidated it: shared C#/TypeScript golden vectors, per-tick determinism
hashes, repeated runs, exact phase and shrink boundary ticks, bounded catch-up,
snapshot replacement, ticket scope and atomic single consumption, input ordering
and validation, reconnect grace, and terminal state delivered before socket
close.

Added by this revision:

- **Unknown game type is not silently declined.** A regression test that an
  invite for an unrecognised `gameType` produces a visible outcome rather than a
  silent auto-decline (`useGameState.ts:217-222`).
- **Unknown game type does not render the Deathroll board.** Exhaustiveness
  enforced at the type level for both the participant board picker
  (`App.tsx:5289`) and the spectator board picker (`SpectatorActivity.tsx:57`).
- **Panel integration.** Arena participation sets `MainPanelMode = 'game'`;
  Arena spectating never does; the split layer is hidden rather than unmounted
  across a whole match, asserted by surviving chat draft and scroll position.
- **Authorization (3b).** Participant accepted, non-participant same-channel
  accepted as spectator, cross-channel rejected with `NotSameChannel`, absent
  user rejected with `NotPresent`.
- **No Arena frame on the discrete path (3b).** Zero
  `game.spectatorSnapshot` events are published for an Arena match, and
  `PublishDiscreteFrameAsync` is never called for one.
- **`GamesSettingsTab`** gains the test file it never had, covering both
  persistence paths.

---

## 6. Risks and coordination

**Determinism.** Unchanged from July: accidental floating point or unstable
collection iteration. Mitigated by exact ordering, widened integer arithmetic,
shared golden vectors, declared field order, stable IDs and repeated hashes.

**Slow sockets stalling the simulation.** Unchanged from July: immutable capture
separated from send loops, bounded and coalesced controls, capacity-one snapshot
replacement, guaranteed terminal delivery.

**Silent fallbacks.** New, and the reason §3.4 is an ordering constraint rather
than a cleanup: two of the three sites fail with no error, no log and no test
failure. A partial Arena introduction would look like a working feature that
declines every invite.

**3a is large.** Roughly 13 tasks including prediction and reconciliation. This
is the accepted cost of keeping the first playable merge feeling correct. The
slice is internally ordered — server simulation green before transport,
transport green before client — so it can be reviewed in stages even though it
merges as one body of work.

**PR #645 (`fix/client-transport-defects`).** Open, and modifies
`src/Brmble.Client/Bridge/NativeBridge.cs` and
`src/Brmble.Client/Services/Voice/MumbleAdapter.cs`. Arena's input-capture task
also modifies `MumbleAdapter.cs`, adding reference-counted `game.inputCapture`
hotkey suspension. That task is the **last** in slice 3a, so #645 will almost
certainly have merged long before it starts. The plan is to branch from `main`
and rebase once #645 lands, rather than to coordinate the two edits in flight.

---

## 7. Decisions recorded

| Decision | Choice |
|---|---|
| Project shape | Three vertical slices, each ending in something demonstrable |
| Prediction and reconciliation | In slice 3a, not deferred |
| Arena participation surface | Game mode, full main panel, shared card shell **filled** rather than hugged |
| Arena spectator surface | `'spectate'` chip in the activity stage; user drags the divider; `UI_GUIDE:245` untouched |
| HUD split | Title/score/round/phase countdown/mute/close in DOM header; cooldown arc and dash marker drawn at the player; all drawn state mirrored to `.sr-only` |
| Spectator liveness signal | Existing channel-wide `game.queueSnapshot`; no new discrete plumbing |
| `AuthorizeAsync` contradiction | Contracts frozen, bodies implemented by this project, in 3b |
| Participant authorization in 3a | `ContinuousGameCoordinator` + `ActiveMatchReference`; `SpectatorService` untouched |
| Plan's descriptor `RunnerKey` check | Replaced by `ActiveMatchReference.RunnerKey`; the plan's version is unimplementable |
| `EndMatchAsync` | Five parameters; first three keep position and meaning |
| July Task 17 | Deleted wholesale, not amended |
| Silent-fallback fix | Ordered first step, before `arena-knockoff` exists anywhere |
| Challenge callback chain | Collapsed to one `onChallenge(gameType, options)` |
| Arena volume storage | Native `AppSettings.GamesSettings(ArenaVolume = 65)`, Games tab |
| One match per channel | Verified as enforced by `DuelOrchestrator`; out of scope |
| PR #645 | Branch from `main`, rebase after it merges |

## 8. Non-goals

Unchanged from the July design: no BO5 or configurable formats, no character
selection or upgrades, no health or damage or randomness, no
projectile-versus-projectile cancellation, no dash invulnerability, no
lag-compensated rewinding, no replay files or raw input retention, no mobile or
gamepad controls, no horizontal simulation scaling.

Added by this revision:

- Concurrent matches per channel, and re-keying `SpectatorService` by match.
- Any change to `UI_GUIDE:245` or to what `MainPanelMode = 'game'` means.
- A region collapse, minimise or maximise affordance, for any activity kind.
- A server endpoint enumerating available game types; the challenge menu stays
  client-side.
- Bounding `NativeBridge._pendingMessages`, which remains the pre-existing
  deferred defect recorded by the spectating design.
