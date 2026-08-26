# Spectator Entry And Per-Turn Detail — Design

Date: 2026-08-25
Status: Approved for planning
Branch: `feature/spectator-entry-and-detail` (stacked on `feature/game-spectating`)
Builds on: `docs/superpowers/specs/2026-08-24-game-spectating-as-channel-activity-design.md`

## Problem

Game spectating shipped and works technically. Manual multi-client testing surfaced three
functional gaps, all of them about the spectator's *experience* rather than the transport.

**1. Entering spectator mode is undiscoverable.** The only opt-in is a **Watch** button inside
`DuelQueueModal`'s active-duel card. The swords badge that opens that modal does appear for a
channel with a live match — `duelChannelIds` includes `snapshot.active` — but it is only
*highlighted* when you personally are queued (`personalDuelChannelIds` deliberately excludes
active matches), its tooltip reads "Open duel activity", and it opens a panel that presents
itself as a queue. When a match is live and nothing is queued, a watcher must click a dim icon
to open an empty queue panel to find the one button they want.

The same shape has a second consequence already recorded during implementation: because Watch
renders only inside `{active && …}`, the Idle "next up" state is a designed and built screen
with effectively no way in.

**2. The boards show the outcome but not the detail.** A spectator sees who won each turn but
not *what happened*. Deathroll shows `Last roll` as an unattributed stat tile; RPS reveals both
throws only in a "Last round" text line. The player cards on either side of the board — the
natural place to look — carry a name, a score and a commit state, and nothing about the action
just taken.

**3. RPS has no reveal beat for spectators.** Participants get a three-second suspense pause
between both players committing and the result landing. Spectators get the result instantly, so
they miss the tension the game is built around.

### What is *not* the problem

`game.feed` is broadcast channel-wide and does carry the full detail — `🎲 Qy rolled 73 (1–100)`
and `✊ Round 2: Qy's rock beats Broan's scissors (1–0)` — and it is visible to a spectator in
the conversation region below the stage. The original design's reasoning holds. This project
does **not** add history to spectator views; see *Decisions recorded*.

## Goal

Make spectating reachable in one click from the channel row, put each player's most recent
action on their own card, and give spectators the same reveal beat participants get.

---

## Architecture

### 1. Channel-row spectate toggle

`ChannelTree`'s channel row gains an `eye` icon button immediately after the existing swords
badge, modelled on the screen-share watch control (`ChannelTree.tsx:485-500`) — the one existing
affordance in the app that does exactly this job.

- **Render condition:** the same `duelChannelIds.has(channel.id)` that drives the swords badge.
  That set covers a live match, a ready-check *and* a non-empty queue, so a watcher can arm
  spectating before a match begins.
- **State:** `aria-pressed` reflects whether this channel is being watched, with a `--watching`
  modifier class. One icon with a state class, not two icons — matching `monitor`.
- **Enablement:** gated by `activityChannelMatchesPresence(joinedChannelId, String(channel.id))`,
  the canonical predicate already used by the modal's Watch button. Spectating is same-channel
  only, and the modal can peek at other channels' queues. Disabled state carries a `Tooltip`
  explaining why, per the guide's rule for disabled controls.
- **Action:** toggles. Already watching this channel → `stopSpectating()`. Otherwise →
  the existing `handleWatchDuel(channelId)`, which sets the explicit activity so the stage takes
  focus, subscribes, and surfaces `notPresent` / `notSameChannel` as a notification.

`DuelQueueModal` and its Watch button are **unchanged**. The swords badge keeps opening the
queue panel, so a watcher can still check who is next without leaving the stage.

**Participants.** The toggle stays enabled while you are playing. Subscribing then is harmless —
the server excludes a match's participants from that match's fan-out, and game mode owns the
main panel regardless — and when your match ends you are already watching the next one. No
special case.

### 2. Per-player latest action on the player cards

Each player card shows what that player just did. **Latest only, replaced each turn.** No
accumulating strip, no scrollback: the running history stays in `game.feed`.

**RPS.** The card shows the icon of that player's throw, index-mapped from `lastRound`
(`view.players[0]` → `pick0`, `[1]` → `pick1`), reusing the participant board's glyph mapping.
`"none"` — emitted by the engine for a player who never threw, on an idle timeout or forfeit —
renders the existing neutral `PICK_LABELS.none` ("No throw") treatment rather than a fabricated
icon. Nothing renders before the first round resolves.

This reads **only from `lastRound`**, never from `committed`. The privacy boundary is therefore
untouched by construction: `RpsSpectatorView` carries no field capable of expressing an
unresolved pick, and `lastRound` is populated only by `ResolveRound`.

**Deathroll.** The card shows the number that player last rolled. `lastRoll` currently carries no
attribution, so the view gains `lastRollBy` (a Mumble **session** id, nullable before the first
roll).

The alternative — inferring the roller as "whoever is not `currentPlayer`" — is rejected. It
relies on an alternating-turn assumption the record does not state, and it breaks at match end
when `currentPlayer` becomes null. The framework rule that a spectator view is never *inferred*
applies to its own fields too.

`lastRollBy` must be derived inside the engine at view-construction time from state that already
exists. If that proves impossible, adding a field to `DeathrollEngine.State` is permitted, but
the implementation plan must call it out explicitly and justify it — new mutable engine state is
precisely what the original design declined to add.

### 3. RPS reveal beat for spectators

`RpsSpectatorBoard` adopts the participant board's reveal gate: when `lastRound.sequence`
advances, the previously rendered view is held, a countdown of `REVEAL_SECONDS` runs, and the
new view is then swapped in. `RpsSpectatorView.lastRound` already carries `sequence`, so this is
entirely client-side with no wire change.

**The pick icons from §2 are gated by the same held value.** Rendering them from the incoming
view while the gate holds the rest would spoil the reveal a beat early. This coupling is the
substantive requirement of this section; the countdown itself is a port.

Duration stays at `REVEAL_SECONDS = 3`, the participant value, so the two surfaces stay in sync
and a watcher sitting beside a player sees the same beat.

`REVEAL_SECONDS` is currently a module-local constant in `RpsBoard.tsx`. It must be **extracted
to a shared module and imported by both boards**, not copied. A whole-branch review of the
original project already flagged verbatim duplication between the two spectator boards as an
emerging pattern; duplicating a timing constant that exists to keep two surfaces synchronised
would be the worst instance of it, because the two could drift silently and no test would
notice.

This is a **reveal** beat, not a **turn** countdown. Spectators still get no turn timer — they
have no turn. See *Documentation*.

---

## Documentation

`docs/UI_GUIDE.md`, Game Spectator Pattern:

- The rule stating spectator boards have "no countdown bar (a spectator has no turn)" conflates
  two different devices and must be split. A **turn countdown** measures *your* time running out
  and is correctly absent for a spectator. A **reveal beat** is a dramatic device that applies to
  anyone watching. Record both.
- Record the channel-row entry point and its same-channel enablement rule.
- Record that the Idle "next up" card is now reachable, since the toggle appears on any duel
  activity rather than only a live match. This supersedes the note that Idle is a continuation
  state with no entry.
- Record that the player cards carry each player's latest action, and that this is deliberately
  *not* history.

`docs/UI_GUIDE.md`, Project 1 Duel Queue Pattern: note that Watch in the modal is now one of two
entry points, not the only one.

## Testing

**Channel row.** The icon appears for a live match, a ready-check and a queue-only channel;
is absent with no duel activity; is disabled on a channel you have not joined and enabled on the
one you have; `aria-pressed` tracks the watched channel; clicking dispatches the toggle.

**App integration.** Clicking the eye starts spectating and lights the `Game` chip; clicking it
again stops and the chip leaves. Watching a queue-only channel shows the Idle next-up card —
the state this project makes reachable.

**RPS board.** Each card shows its own player's throw from `lastRound`; `"none"` renders the
neutral mark; nothing renders before the first resolution. The existing mixed-state privacy test
is **extended to the icons** — with a round in progress and a previous round resolved, no card
may show an icon for the live round. Mutation-verified, as the existing one was.

**Deathroll board.** The roll is attributed to the player who made it, across alternating turns
and at match end; nothing renders before the first roll.

**Reveal gate.** A newly resolved round is withheld for `REVEAL_SECONDS` and then rendered; the
pick icons are withheld with it and do not appear early.

**Server.** `lastRollBy` is correct across turns, after a timeout penalty, and at match end.

## Risks

The privacy boundary is the one property that must not regress. Both board changes move away
from leaking rather than toward it — §2 reads only resolved rounds, §3 delays them further — but
the extended privacy test is the gate on §2 and must fail under a mutation that renders from
`committed`.

The reveal gate introduces a window in which the spectator board is deliberately stale. A frame
arriving during that window must not be dropped, only deferred; the existing monotonic
`(matchId, sequence)` gate in `useSpectatorState` is upstream of the display gate and is
unaffected.

## Non-goals

- History, logs or accumulating strips on spectator boards. `game.feed` remains the record.
- Any change to `DuelQueueModal` or its Watch button.
- Any change to the spectator subscription transport, `SpectatorService`, or the wire events,
  beyond the single `lastRollBy` field.
- A turn countdown for spectators.
- Cross-channel spectating.

## Decisions recorded

| Decision | Choice |
|---|---|
| Entry point | `eye` toggle on the channel row beside the swords badge; modal Watch retained |
| When the toggle shows | Any duel activity — live match, ready-check or queue |
| Toggle enablement | Same-channel only, via `activityChannelMatchesPresence` |
| Toggle while participating | Enabled; no special case |
| Card content | Each player's **latest** action only |
| History in spectator views | **Still none** — unchanged from the original design |
| Deathroll attribution | New `lastRollBy` field on the view; inference from `currentPlayer` rejected |
| New engine state | Derive `lastRollBy` from existing state; a `State` field only with explicit justification in the plan |
| RPS reveal beat | Ported from the participant board, same `REVEAL_SECONDS = 3` |
| `REVEAL_SECONDS` | Extracted to a shared module and imported by both boards, never copied |
| Pick icons vs reveal | Icons gated by the same held view; must not render early |
| Turn countdown for spectators | Still none — the guide rule is split, not reversed |
| Idle card reachability | Now reachable; supersedes the continuation-state-only note |
