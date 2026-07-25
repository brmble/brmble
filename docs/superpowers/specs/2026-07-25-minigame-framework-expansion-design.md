# Minigame Framework Expansion Design

**Date:** 2026-07-25
**Status:** Approved
**Branch:** `feature/minigame-framework-expansion`
**Related design:** `docs/superpowers/specs/2026-07-25-arena-knockoff-design.md`

## Summary

Extend Brmble's server-authoritative 1v1 minigame framework with three shared
capabilities:

1. A fair per-channel duel queue with ready checks and rematches.
2. Explicit live spectator boards with privacy-safe public game state.
3. A continuous-simulation interaction model for realtime games, first used by
   Arena Knockoff.

The work follows a layered evolution rather than replacing the working
Deathroll and Rock Paper Scissors implementations. Queue orchestration is built
first, generic spectating second, and continuous simulation third. Each stage
is independently releasable and testable.

Arena Knockoff has its own design document so gameplay and balancing decisions
can change without rewriting the shared framework design.

## Goals

- Preserve one active duel per voice channel while allowing accepted pairs to
  wait fairly for their turn.
- Keep each user in at most one pending challenge, queued reservation, ready
  check, or active duel.
- Let channel members watch the current duel through a read-only live board.
- Show a complete ordered channel queue and approximate start estimates.
- Support consensual rematches without letting previous players jump the queue.
- Establish a reusable continuous-simulation foundation for latency-sensitive
  games without forcing discrete games onto a high-frequency transport.
- Keep the server authoritative for lifecycle, rules, outcomes, statistics, and
  spectator authorization.

## Non-Goals

- Multiple active duels in one channel.
- Solo matchmaking or automatic pairing of unrelated users.
- Persistent queue reservations across server restarts.
- Cross-channel spectating.
- Horizontal server scaling or distributed simulation ownership.
- Retrofitting Deathroll or RPS onto the realtime transport.
- Ranked ladders, wagers, or tournament brackets.

## Delivery Strategy

The initiative is divided into three implementation projects:

1. **Duel orchestration:** challenge invariants, accepted-pair queue, ready
   checks, rematches, presence cleanup, queue snapshots, and ETAs.
2. **Generic spectator mode:** public game views, explicit subscriptions,
   embedded spectator boards, and screen-share foreground switching.
3. **Continuous simulation:** reusable realtime runtime and transport, followed
   by Arena Knockoff as its reference game.

This order proves shared lifecycle behavior with the existing discrete games
before introducing realtime physics and networking.

## Architecture

The existing `IGameEngine` remains the rules contract for discrete games. Its
current interaction models remain:

- `AlternatingTurns`: Deathroll.
- `SimultaneousCommit`: Rock Paper Scissors.

Continuous simulation is a separate game-definition contract rather than a new
`IGameEngine.InteractionModel` value. Continuous games share orchestration and
persistence with discrete games but run through a dedicated simulation contract
and transport. They must not send
high-frequency input through `/games/action`, the NativeBridge, or the existing
Brmble notification WebSocket.

Responsibilities are separated into focused units:

- **Duel orchestrator:** challenges, user reservations, channel queues, ready
  checks, rematches, presence cleanup, and queue advancement.
- **Game session manager:** match creation and completion, discrete engine
  invocation, participant routing, and persistence.
- **Spectator service:** channel authorization, subscriptions, public snapshots,
  and spectator lifecycle.
- **Duration estimator:** historical duration samples and queue ETA calculation.
- **Realtime game coordinator:** continuous match ownership and fixed-step
  simulation lifecycle.
- **Realtime endpoint:** dedicated browser-owned WebSocket authenticated with a
  short-lived ticket issued through the existing mTLS native bridge.

Reliable, low-frequency events continue over the current event bus. These
include challenges, queue snapshots, ready checks, match lifecycle, score
changes, and channel duel metadata. Continuous inputs and replaceable snapshots
use only the dedicated realtime connection.

## Challenge Invariants

A user may participate in exactly one unresolved duel commitment at a time.
This includes being either side of:

- A pending challenge.
- A pending rematch offer.
- An accepted queued reservation.
- A ready check.
- An active match.

One unresolved duel commitment is allowed per user in total. Multiple
speculative outgoing or incoming requests are rejected. Reservation checks and
state transitions must be atomic so simultaneous requests cannot reserve the
same user twice.

Challenges remain private and expire after 30 seconds. Acceptance time, not
challenge creation time, determines queue order.

## Per-Channel Duel Queue

Each channel has a single authoritative state containing:

- At most one active match.
- An ordered list of accepted `DuelReservation` pairs.
- At most one current ready check.
- A monotonically increasing revision.

A queue entry is an accepted pair reservation, not an unanswered challenge and
not an individual player. Acceptance reserves both users.

### Acceptance

- If the channel has no active match, ready check, or queued reservation, the
  accepted challenge starts immediately. Challenge acceptance already proves
  readiness, so no second confirmation is required.
- If the channel is occupied or already has a queue, the accepted pair is
  appended to the tail.
- Queue order is acceptance time with a server sequence as the deterministic
  tie-breaker.
- If either user became unavailable before acceptance, acceptance is rejected
  without changing the queue.

### Queue Advancement

When an active match ends:

1. Select the first reservation whose users are still connected and remain in
   the channel.
2. Make that pair the channel's current ready check.
3. Ask both users to confirm within the server-owned ready window.
4. Start the match only after both confirmations arrive.
5. If either user declines, times out, disconnects, or leaves, remove the pair
   and immediately advance to the next reservation.

The channel remains reserved while advancing or running a ready check. A newly
accepted challenge cannot jump ahead during this transition.

### Presence Changes

Disconnecting or leaving the channel immediately cancels a pending challenge,
queued reservation, or ready check involving that user. Both users receive the
reason and become available again. Active matches keep their game-specific
disconnect or forfeit behavior.

Removing a channel clears its complete ephemeral duel state.

### Persistence

Pending challenges, queue entries, and ready checks remain in memory, matching
active match state. A server restart cancels these commitments rather than
restoring reservations that users may no longer expect.

Completed match records remain persisted normally.

## Rematches

Either participant may request a rematch after a completed game. The other
participant must accept within a 30-second server-owned response window. A
pending rematch offer counts as each participant's single unresolved duel
commitment, preventing either user from racing it against another challenge.

A rematch preserves:

- Game type.
- Match format and game options.
- Ruleset version.
- The same two participants.

Acceptance creates a new reservation at the current queue tail. It never grants
priority over already accepted pairs. If the channel is completely idle at
acceptance time, the rematch starts immediately under the normal acceptance
rule.

A rematch offer is invalidated if either participant disconnects, changes
channel, enters another commitment, or becomes otherwise unavailable.

## Versioned Queue Snapshots

Every queue mutation publishes a complete channel-scoped snapshot rather than
an incremental patch. A snapshot contains:

- Schema version and channel revision.
- Generation timestamp.
- Active duel summary, if any.
- Current ready check and readiness state, if any.
- Full ordered queue.
- Player pairs, game types, formats, and ruleset versions.
- Queue positions and server-calculated estimates.

Clients replace local queue state only when a snapshot has a newer revision.
Complete snapshots make reconnect recovery and stale-event handling simpler than
replaying incremental events.

An empty snapshot is published when a channel becomes idle. A reconnecting
channel member can request or receive the latest complete snapshot.

## Duration Statistics And Queue ETA

Duration estimates use completed games server-wide, not per channel. Samples
are grouped by:

- Game type.
- Match format, such as `1v1`, `bo3`, `bo5`, or `bo7`.
- Ruleset version.

For each group, the estimator selects the latest 100 qualifying completed
matches and calculates the median `duration_ms`.

There is no calendar cutoff. If a game has not been played recently, older
matches remain valid until newer matches replace them in the last-100 sample.
At least 10 qualifying matches are required. With fewer than 10, the displayed
estimate is **Unknown**.

Invitations, ready checks, cancellations, and matches that did not meaningfully
start do not qualify. Abandoned games are excluded because their duration
measures interruption timing rather than normal game length.

### Ruleset Versions

Completed matches store a `ruleset_version`. Add a non-null
`game_matches.ruleset_version INTEGER NOT NULL DEFAULT 1` column and an index on
`(game_type, format, ruleset_version, ended_at)`. Existing rows migrate to
version `1`, matching the initial shipped Deathroll and RPS rules. Match models,
repository inserts, and duration queries carry the value explicitly.

A version changes whenever balance or timing changes could materially alter
match duration. Historical estimates never mix ruleset versions.

### Queue Calculation

For each queued pair, estimated start time is the sum of:

- Estimated remaining duration of the active match.
- Any remaining ready-check transition ahead of the pair, followed by the full
  estimated duration of the promoted pair's match.
- Full median durations of every earlier queued reservation.

The active match estimate uses comparable historical matches that were still
running after the current elapsed time, producing a median remaining duration.
This avoids showing zero simply because a live match exceeded its ordinary
median. If this conditional sample is insufficient, the implementation may fall
back to the group's full median minus elapsed time, clamped to zero, while still
labelling the value approximate.

If any required segment has fewer than 10 samples, the affected combined ETA is
`Unknown`. Known estimates for individual entries may still be displayed.
Snapshots include sample counts and calculation time. Clients do not derive
their own ETAs.

## Spectator Authorization And Subscription

Clicking a live duel badge opens the active game's read-only spectator board.
The user must be connected to the same voice channel as the match.

Opening the board creates an explicit spectator subscription. Closing it,
leaving the channel, disconnecting, or the match ending removes the
subscription. A fresh subscription always returns a complete current snapshot;
missed events are not replayed.

Explicit subscriptions prevent high-frequency state from being sent to every
channel member who only needs the duel badge, queue, or chat feed.

Spectators cannot:

- Submit game actions.
- Confirm readiness for queued players.
- Affect timers or simulation.
- Receive a participant's private state.

## Privacy-Safe Public Views

Every game supplies a dedicated spectator view. Participant views must not be
reused as a shortcut because they may contain private information.

- **Deathroll:** complete board, current turn, ceiling, last roll, and public
  history.
- **RPS:** score and whether each player has committed; unresolved choices stay
  hidden until the round resolves.
- **Arena Knockoff:** positions, velocities, aim, charge, cooldown and
  forced-fire timing, projectiles, arena radius and shrink phase, dash
  availability, round score, and phase timing.

Spectator snapshots are complete, sequence-numbered replacements. A reconnect or
reopen requests a fresh snapshot.

## Spectator And Queue UI

The channel's swords badge becomes an accessible action whenever the channel has
an active duel, ready check, or non-empty queue. Clicking it opens the channel
duel activity immediately. A live duel shows the spectator board and queue. A
ready-only or queue-only state opens the same activity with the full queue and a
compact waiting state instead of a board.

The spectator activity displays:

- The read-only game board.
- Player identities and current score/state.
- The complete ordered queue.
- Game type and format for every reservation.
- Position and approximate start estimate.
- `Unknown` when an estimate lacks sufficient samples.
- The current ready-check state.

The board is embedded in the upper `ChatPanel` activity area, not presented as a
modal over the rest of the application. Channel chat remains available below.

## Foreground Activity And Screen Shares

The upper `ChatPanel` media area has exactly one foreground activity:

- Watched screen shares.
- A minigame spectator board.
- A queue-only duel activity.

Existing Deathroll and RPS participant boards remain in their established modal
pattern. Arena Knockoff is the first participant game designed for the embedded
foreground activity because its realtime canvas needs the available workspace.

Opening a duel board replaces the visible screen-share grid. Watched screen
shares stay logically connected, but remote video and audio subscriptions are
paused so hidden media consumes no bandwidth and plays no sound.

While paused, Brmble preserves:

- The watched-share list.
- Focused share.
- Viewer quality selections.
- LiveKit room membership.

Closing the duel board restores subscriptions and the previous share layout when
those shares still exist. Shares that ended while hidden are reconciled during
restoration. Local screen broadcasting is unaffected.

Leaving the channel closes the duel activity and clears that channel's restore
state.

This foreground-activity pattern must be added to `docs/UI_GUIDE.md` before or
alongside its UI implementation.

## Continuous Simulation Boundary

Realtime games require a reusable contract separate from discrete action
engines. The continuous runtime owns:

- Fixed-step simulation scheduling.
- Ordered, sequence-numbered player input.
- Replaceable authoritative snapshots.
- Participant and spectator socket attachment.
- Reconnect grace and neutral input.
- Completion callbacks into shared match persistence and queue advancement.

The initial deployment remains single-process. Simulation and queue ownership
are process-local. Horizontal scaling requires explicit match ownership and a
distributed backplane and is outside this design.

## Realtime Transport

The existing Brmble `/ws` connection is retained for low-frequency application
events. It is not suitable for continuous gameplay because it is server-to-client
oriented, shares traffic with unrelated events, and routes through native
WebView IPC.

Continuous games use a dedicated browser-owned WebSocket:

1. The Web app requests a realtime ticket through `GameService`.
2. `GameService` obtains the ticket using the existing mTLS-authenticated server
   request path.
3. The server issues a short-lived, one-time capability bound to user, session,
   match, and role.
4. The browser connects directly to the dedicated realtime endpoint.
5. The ticket is atomically consumed during attachment.

Tickets must not be durable credentials. Reconnection obtains a fresh ticket.
Reliable lifecycle events still use the ordinary event bus.

The initial ticket lifetime is 15 seconds. A ticket is consumed atomically and
cannot attach after expiration.

## Error Handling And Recovery

- Duplicate or stale commands are idempotently ignored or rejected with stable
  reasons.
- Stale queue revisions never overwrite newer state.
- Ready-check failure removes the pair and advances the queue immediately.
- Failure to start a promoted match must release that reservation and continue
  advancing rather than blocking the channel.
- Spectator authorization is checked at subscription and revalidated after
  channel membership changes.
- A server restart clears ephemeral matches and queues; clients recover to an
  empty channel state.
- Persistence failure after match completion must not leave the channel busy
  indefinitely. Completion persistence needs retry or recoverable failure
  handling independent of queue release.

## Testing Strategy

### Duel orchestration

- Pure state-machine tests for challenge invariants and atomic user reservation.
- FIFO ordering across games and formats.
- Immediate start when idle and ready checks only after waiting.
- Decline, timeout, disconnect, channel movement, and channel removal.
- Rematches preserving configuration and joining the queue tail.
- Race tests for simultaneous challenges, acceptance, and rematch requests.

### Duration estimator

- Fewer than 10 samples returns Unknown.
- Exactly 10 samples enables an estimate.
- Only the newest 100 matches are used.
- Median behavior with even, odd, and outlier-heavy samples.
- Group isolation by game type, format, and ruleset version.
- No calendar cutoff.
- Conditional remaining-duration and fallback behavior.

### Spectating

- Same-channel authorization and cross-channel rejection.
- Explicit subscriber-only updates.
- Fresh complete snapshot on subscribe and reconnect.
- Subscription cleanup on close, channel change, disconnect, and completion.
- Contract tests proving unresolved RPS choices never enter spectator payloads.
- Stale sequence rejection.

### Frontend

- Full snapshot replacement by revision.
- Ordered queue and Unknown ETA rendering.
- Accessible duel-badge activation.
- Read-only spectator controls.
- Foreground activity mutual exclusion.
- Remote media pause and restoration without affecting local broadcast.
- Focus, quality, and watched-share reconciliation.

### Continuous runtime

- Fixed-step scheduling and bounded catch-up.
- Input sequencing, validation, and stale-input clearing.
- Replaceable snapshot backpressure.
- Ticket scope, expiry, and one-time consumption.
- Reconnect and role authorization.
- Load tests across multiple channel matches and spectator counts.

## Success Criteria

- Accepted pairs play in FIFO order without stale reservations blocking a
  channel.
- A missed ready check advances to the next pair automatically.
- Rematches never bypass existing reservations.
- Queue state recovers from reconnect using one complete snapshot.
- ETAs are server-wide, format/ruleset-specific medians and show `Unknown` below
  10 samples.
- Spectators can join an in-progress duel without receiving private player data.
- Opening a duel board pauses hidden remote media and restores it afterward.
- Continuous games use isolated realtime traffic while sharing existing duel
  lifecycle and persistence behavior.
