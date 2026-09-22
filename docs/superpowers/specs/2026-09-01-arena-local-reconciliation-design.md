# Arena Local Reconciliation and Collision Presentation Design

Date: 2026-09-01
Status: Revised after written review; supersedes the display-only approach
Branch: `fix/arena-local-movement-cadence`
Base: `eaed73f9`

Builds on:

- `docs/superpowers/specs/2026-08-27-arena-knockoff-revision-design.md`
- `96b5558a fix: unify arena render sampling`
- `eaed73f9 fix: preserve arena movement cadence`

## Purpose

Arena Knockoff now draws from one animation-frame sampler and reacts quickly to
local input. Remote movement is smooth because it is rendered from a buffered
authoritative timeline. Local movement can still appear to lose frames during
ordinary movement, and it visibly bumps during player-player contact.

The server remains authoritative for both players. The client will continue to
predict the local player immediately to avoid round-trip input latency and will
continue to interpolate the remote player from confirmed snapshots. This design
removes discontinuities where those timelines meet without delaying local
controls.

## Root Cause

Two mismatches remain in `useArenaState` and `arenaMath`, one of which has a
residual presentation component.

First, every authoritative snapshot rebuilds the deterministic local prediction
and resets the local presentation timestamp to the current animation frame.
This discards fractional progress toward the next 60 Hz simulation tick. At the
20 Hz snapshot cadence, a normal correction can therefore introduce a repeated
pause or uneven step even when prediction is otherwise accurate.

Second, the server calls `ArenaSimulation.ResolveBodyOverlap()` every simulation
tick as stage 9 of its fixed 15-stage tick, after movement, dash movement,
velocity integration, and damping. Client `stepLocal()` has no equivalent stage.
This is a genuine prediction divergence, not only a presentation artifact: during
contact, local prediction moves through the opponent every tick while the server
pushes it back out every tick. Reconciliation currently treats the resulting
overlap as an invalid position and hard-snaps the local player. The remote player
receives the same authoritative collision movement through a 100 ms interpolation
buffer, so only the local player visibly bumps.

The fix must close the divergence in prediction. Resolving it only in
presentation would leave predicted error growing monotonically through sustained
contact until it crosses the 300-unit correction threshold, reproducing the same
hard snap less often and larger.

A third, smaller mismatch remains after prediction is corrected. The local player
is displayed at approximately now; the remote player is displayed from a 100 ms
buffer. Two players in contact can therefore still overlap on screen even when
both source states are individually valid. That residual is a presentation
problem and is handled in presentation.

## Constraints

- The server remains authoritative for simulation, collision outcomes, scoring,
  knockouts, projectiles, cooldowns, and dash consumption.
- Local movement and firing must remain immediately responsive. The local player
  will not be moved onto the remote interpolation buffer.
- The client does not infer or simulate unknown remote input. Dead reckoning the
  opponent forward from an authoritative position and velocity is not input
  inference and is permitted; `sampleTimeline()` already relies on it.
- There remains one animation-frame loop, owned by `useArenaState`.
- Presentation correction must not mutate snapshots, pending inputs, predicted
  velocity, or deterministic replay state.
- Presentation-only constraints must never be observed by `reconcile()`.
- Mandatory gameplay discontinuities remain immediate and are not hidden by
  smoothing.

## Architecture

### Local deterministic state

> **Superseded detail (2026-09-13).** Pending input is no longer pruned by
> acknowledgement. The server applies an input at the tick the client stamped it
> with, the client stamps `serverTick + elapsed + lead` with the lead covering its
> measured round trip, and `reconcile()` replays every pending interval whose
> `toTick` is past the snapshot's `serverTick` — including acknowledged ones, since
> acknowledgement means received, not applied — through the client's current local
> tick. See `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`,
> *Finding 4*. The rest of this section stands.

> **Superseded detail (2026-09-22).** Own projectiles are drawn in the prediction
> frame, the opponent's in the sampled frame. `stepLocal()` advances every projectile
> one velocity per live tick, including in its spawn tick, and drops one that leaves
> the arena, mirroring the server's stages 10 and 11 for positions only; hits stay
> authoritative. Before this the local player's shot was drawn from the sampled
> timeline, 12-15 ticks behind the player at 100 ms RTT: the predicted projectile
> showed at its spawn point, vanished when the snapshot carrying the real one
> arrived, and the real one then appeared where the player had been. In the
> prediction frame the predicted projectile and the authoritative one it becomes sit
> on the same tick, so the handover is invisible. Pinned by `arenaClientLatency.test.tsx`.
>
> The hit stays the server's call, and its verdict arrives a round trip plus the
> lead after the shot reached the opponent in the prediction frame - 20-odd ticks of
> travel at 100 ms RTT, during which the shot was drawn sailing through the body the
> player aimed at (confirmed in the 100/20 ms playtest, opponent standing still). So
> an own shot stops being drawn once it has reached the displayed opponent
> (`projectileReachedBody`: overlap now, or the body behind it within the hit radius
> of its line of flight and no further back than the shooter); the knockback follows
> when the sampled frame catches up. Accepted residual: the displayed and the
> authoritative opponent differ by the opponent's movement over the frame gap, so a
> shot at a moving opponent can vanish at a body the server says it missed, or
> overshoot one the server says it hit. Closing that means the server judging the
> hit in the shooter's frame (lag compensation), which is a design change with
> fairness consequences and has not been made.
>
> **Known residual (2026-09-22), found by observing that test per frame.** The
> stamp clock in `useRealtimeConnection` (`serverTick + max(1, elapsed) + lead`) and
> the presentation's tick-phase clock in `useArenaState` are two clocks, and they
> disagree by one or two ticks around a snapshot: the `max(1, …)` floor bumps the
> stamp clock on the frame a snapshot lands, and the phase clock keeps its own
> cadence in between. Every reconcile re-anchors the presentation to the stamp
> clock. For the local player the authority path blends the difference as a
> correction, but an input-only reconcile (any key press or release) replays
> through the stamp and steps the display back by the difference, once, at up to
> two ticks of movement; for an own projectile the re-anchor shows as up to three
> ticks of travel in one frame. Both are pinned at their current size by
> `arenaClientLatency.test.tsx`. The fix is a single local tick clock shared by the
> stamp and the presentation, which is a design change and has not been made.

`reconcile()` continues to rebuild local deterministic state from the newest
authoritative snapshot and all unacknowledged input intervals. This state is the
source for local movement, charge, fire, recoil, dash, and predicted local
projectiles.

The deterministic state remains integer and tick-based. No fractional or
presentation-only position enters `stepLocal()` or later input replay.

### Predicted body collision (primary fix)

`stepLocal()` gains a body-overlap stage that mirrors `ResolveBodyOverlap()` and
runs in the server's position: after velocity damping and before projectile
advance. This is the change that makes prediction converge during contact.

The opponent position used by that stage is dead-reckoned forward from the
reconcile snapshot at the fixed tick rate, using the authoritative opponent
position and velocity, the same integer dead-reckoning `sampleTimeline()` uses
for extrapolation. Replay spans only unacknowledged input, normally under six
ticks, which is well inside the horizon the client already trusts. No opponent
input is inferred; the opponent's own movement, dash, and fire stages are not
simulated.

Because this state feeds deterministic replay, it must match the server exactly:

- Order players by `side` (0 low, 1 high). `ArenaSimulation` assigns sides from
  sorted session IDs, so side ordering is equivalent to session ordering and is
  not exposed to JavaScript integer-precision limits on `long` session IDs.
- Use the configured player diameter of `playerRadius * 2`.
- Return unchanged when squared distance is at least diameter squared. The
  comparison is strict; exactly touching does not push.
- For coincident centers, use positive X as the stable normal.
- Otherwise derive a Q15 normal using a floor-exact integer square root and
  integer division truncated toward zero. Truncation is toward zero, not toward
  negative infinity, because normal components are signed; `Math.trunc`, never
  `Math.floor`.
- Split penetration in half; assign the odd unit to side 1.
- Move side 0 opposite the normal and side 1 along the normal.
- Do not renormalize the Q15 normal. The server does not, so a single call is
  not guaranteed to fully separate the bodies, and the client must reproduce
  that same slight under-push.
- Preserve velocity, aim, charge, cooldown, dash availability, acknowledgement,
  side, and every other field.

The client does not reproduce the server's boundary-transition recording from
this stage. Knockouts caused by an overlap push remain server-authoritative and
arrive as a discrete snap condition.

### Continuous local presentation

`useArenaState` keeps the current fixed-tick presentation state and its sub-tick
remainder across ordinary authority updates. Reconciliation produces a new
deterministic target, but it does not automatically restart the display clock at
zero fractional progress.

For an ordinary snapshot:

1. Sample the currently displayed local position before replacing the target.
2. Reconcile authority and pending inputs into a new deterministic local state.
3. Preserve the existing sub-tick phase against the new target.
4. Use the displayed position as the origin for any small authority correction.
5. Blend that correction over the existing 100 ms correction window while local
   held movement continues to advance.

The correction origin is the **unconstrained** presented local position: the
result of sub-tick interpolation plus any decaying prior correction, taken before
the presentation-space collision constraint described below. Feeding the
constrained position back as the correction origin would measure prediction
against a client-only display artifact and oscillate against the constraint.

Phase preservation requires an explicit anchor. A wall-clock timestamp alone
cannot express it, because today `presentedAt` is reset to the current frame time
on every reconcile and silently assumes the presented state equals the predicted
state. The presentation state must therefore carry both the tick it corresponds
to and the fractional remainder within that tick, with this invariant:

> The local tick-phase clock is monotonic. An ordinary snapshot never resets it.
> Only a mandatory snap resets it.

The implementation must not double-apply elapsed ticks. Preserving phase means
carrying only the fractional remainder within one simulation tick; the new
deterministic state remains the source of completed ticks. The presented tick is
what reconciles the two: reconcile supplies completed ticks, the phase clock
supplies the remainder, and neither is derived from the other.

Presentation advance and correction decay must read the same clock. Correction
decay currently uses `Date.now()` while presentation advances on the
animation-frame timestamp; this change couples them tightly enough that the drift
matters. Unify both on the animation-frame clock.

Mandatory discontinuities continue to snap immediately. Existing discrete snap
conditions remain authoritative: phase or score changes, knockout state,
confirmed shot cooldown transition, confirmed dash consumption, invalid arena
boundary state, final match state, and large corrections above the established
threshold.

### Presentation-space body collision (residual only)

With prediction corrected, the only remaining source of displayed overlap is the
timeline mismatch: the local player is displayed at approximately now, the remote
player from a 100 ms buffer. The error is entirely on the local side. The remote
displayed position is a replay of authority that already includes the server's
separation.

Therefore the presentation constraint moves **only the local player**, pushing it
fully clear of the remote circle. It does not split penetration and does not
displace the remote player. Mirroring the server's symmetric half/half split here
would let a local prediction artifact visibly shove the remote player off its
authoritative path, after which it would snap back as the buffer caught up.

The constraint operates on copies and returns constrained display snapshots. It
preserves velocity, aim, charge, cooldown, dash availability, acknowledgement,
side, and every other field. Exact server integer parity is not required here,
because both inputs are already non-authoritative and time-mismatched; parity is
required only in the predicted stage above.

The constrained local position is clamped to the arena radius. The server's
overlap push can knock a player out through `RecordBoundaryTransition`, but a
purely presentational push must never render the local player outside the ring
without an authoritative knockout.

This constraint is a display filter, not client authority. It does not write the
separated position back to `predictedRef`, `presentedRef`, snapshots, pending
inputs, or the correction origin. Each frame begins from current prediction and
interpolation, then applies the constraint once.

Both players are sent to Canvas, the local one constrained. `localPlayerRef` also
receives the constrained local snapshot so pointer aiming uses the same center the
player sees. This affects the aim vector only; it never affects reported position,
which remains server-derived.

### Overlap reconciliation

Any visible overlap is no longer by itself a hard-snap condition, because
different display timelines make small temporary overlap expected even when both
source states are valid.

The overlap snap condition is retuned rather than deleted. Deep overlap between
predicted local and authoritative remote positions still snaps, because with
prediction now mirroring the server it indicates real desynchronisation rather
than a timeline artifact. The threshold is expressed as a fraction of the player
diameter and must be chosen so that ordinary sustained contact never reaches it.

Arena-boundary invalidity and all other discrete snap conditions remain
unchanged. Large non-collision authority disagreements continue to snap at the
established distance threshold.

## Frame Data Flow

Each animation frame follows this order:

1. Consume any authority or discrete local-input invalidation.
2. Reconcile the deterministic local target when required, resolving predicted
   body overlap against the dead-reckoned opponent inside each replayed tick.
3. Advance completed local fixed ticks using the held current input, applying the
   same predicted overlap stage per tick.
4. Interpolate local sub-tick movement at the current animation-frame time.
5. Apply any active small authority correction. The result of this step is the
   unconstrained presented local position and is what the next reconcile uses as
   its correction origin.
6. Sample the remote player and authoritative projectiles from the buffered
   snapshot timeline.
7. Apply the display-space constraint, moving only the local player clear of the
   remote circle and clamping it to the arena radius.
8. Publish the frame to Canvas and `localPlayerRef` using the constrained local
   position.
9. Publish React state only for semantic authority/input changes as already
   established by the single-render-loop refactor.

### Supporting change

`ArenaRenderer` currently duplicates `playerRadius` and related constants locally
instead of sourcing them from `welcome.prediction`. This change makes
`playerRadius` load-bearing in two new places, so the duplication is removed as
part of it.

## Error and Edge Handling

- Missing remote player: skip both collision stages and render the local player.
- Missing local player: skip both collision stages and render the remote player.
- Coincident players: separate deterministically on the X axis.
- Opponent absent from the reconcile snapshot: skip the predicted overlap stage
  for that replay rather than guessing a position.
- Constraint would push the local player outside the arena: clamp to the arena
  radius. Presentation never renders a knockout the server has not confirmed.
- Round reset, final state, or session replacement: clear presentation caches,
  reset the tick-phase clock, and install authoritative state immediately.
- Long animation-frame stalls: preserve the existing cap of three completed
  local ticks per frame.
- Reduced motion: does not change positional reconciliation or collision rules.
- Reconnect: the replacement welcome resets prediction and presentation caches;
  no old-session collision state survives.

### Accepted tradeoff

The remote player is displayed from a 100 ms buffer, so the display constraint
blocks the local player against where the opponent was, not where authority
currently places them. Contact therefore reads as slightly soft near the edges of
an encounter. This is preferred to either delaying local input onto the remote
buffer or allowing displayed bodies to interpenetrate, and prediction — which is
what the server actually validates — is unaffected because it uses dead-reckoned
current opponent positions rather than the buffer.

## Testing

### Predicted collision parity

The predicted overlap stage feeds deterministic replay, so it is tested for exact
server parity with literal expected coordinates:

- no overlap, including the exactly-touching boundary case, which must not push;
- even penetration;
- odd penetration with the extra unit assigned to side 1;
- reversed input array ordering, confirming ordering comes from `side`;
- coincident centers and stable positive-X separation;
- diagonal overlap using the same integer normal math as the server, including
  negative normal components, which must truncate toward zero;
- a case where one call does not fully separate the bodies, matching the
  server's un-renormalized Q15 under-push;
- preservation of velocity and all non-position fields.

These cases are cross-checked against the equivalent server tests so the two
implementations cannot drift independently.

### Display constraint

- the local player is pushed fully clear of the remote circle;
- the remote displayed position is never modified;
- the constrained local position never exceeds the arena radius;
- the constraint never appears in `predictedRef`, `presentedRef`, pending inputs,
  or the correction origin.

### Reconciliation cadence

Add hook-level animation-frame tests that:

- move continuously through repeated 20 Hz authority snapshots while sampling at
  high-refresh intervals;
- preserve the sub-tick remainder across an ordinary snapshot;
- bound the snapshot-frame displacement relative to adjacent display frames;
- do not move backward for a small correction while held input continues;
- generate no correction from a constraint-only offset;
- still snap immediately for every mandatory discrete condition.

### Sustained contact

Add hook-level tests for both perspectives:

- the local player pushes the buffered opponent over multiple snapshots;
- the buffered opponent pushes the local player over multiple snapshots;
- displayed bodies never overlap;
- neither local trajectory contains a periodic hard-snap spike;
- constrained `localPlayerRef` and the Canvas frame use the same local position.

Contact is sustained long enough to expose accumulating prediction error, not
only a few snapshots. The error between predicted local and authoritative local
must stay bounded well below the 300-unit snap threshold for the full duration,
and the retuned deep-overlap snap must not fire.

### Regression verification

Retain and run existing prediction, fire, dash, correction, session replacement,
terminal-state, renderer, input, and connection tests. Run the full frontend test
suite, TypeScript type-check, and production build. Rebuild all three manual-test
clients for two-client collision validation.

## Acceptance Criteria

- Holding movement with no collision produces continuous local display cadence
  across repeated server snapshots.
- Local prediction reproduces the server's body-overlap outcome, so error during
  sustained contact stays bounded rather than accumulating toward the snap
  threshold. This is measured, not judged visually.
- Sustained player-player contact does not visibly bump or hard-snap the local
  player from either participant's perspective, for contact of arbitrary
  duration.
- Displayed player bodies do not overlap, and the displayed remote player never
  deviates from its authoritative interpolated path.
- Local movement, aim, firing, and dash remain immediately responsive.
- Remote movement retains its buffered smoothness.
- Server snapshots remain the final authority and converge local prediction.
- No second animation-frame loop or per-frame React state publication is added.

## Out of Scope

- Predicting remote input or running full dual-player client simulation. The
  predicted overlap stage dead-reckons the opponent's position from authoritative
  velocity only; it does not simulate the opponent's movement, dash, or fire.
- Changing server tick rate, snapshot rate, collision rules, or protocol shape.
- Replacing Canvas rendering or changing Arena visuals.
- Network latency compensation for projectile hits.
- General transport diagnostics or unrelated client health monitoring.
