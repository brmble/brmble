# Arena Local Reconciliation and Collision Presentation Design

Date: 2026-09-01
Status: Approved in chat; pending written review
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

Two related mismatches remain in `useArenaState` and `arenaMath`.

First, every authoritative snapshot rebuilds the deterministic local prediction
and resets the local presentation timestamp to the current animation frame.
This discards fractional progress toward the next 60 Hz simulation tick. At the
20 Hz snapshot cadence, a normal correction can therefore introduce a repeated
pause or uneven step even when prediction is otherwise accurate.

Second, the server calls `ArenaSimulation.ResolveBodyOverlap()` every simulation
tick after movement, dash movement, velocity integration, and damping. Client
`stepLocal()` does not resolve body overlap. During contact, local prediction
moves through the opponent until a snapshot arrives. Reconciliation then treats
the overlap as an invalid position and hard-snaps the local player. The remote
player receives the same authoritative collision movement through a 100 ms
interpolation buffer, so only the local player visibly bumps.

## Constraints

- The server remains authoritative for simulation, collision outcomes, scoring,
  knockouts, projectiles, cooldowns, and dash consumption.
- Local movement and firing must remain immediately responsive. The local player
  will not be moved onto the remote interpolation buffer.
- The client does not infer or simulate unknown remote input.
- There remains one animation-frame loop, owned by `useArenaState`.
- Presentation correction must not mutate snapshots, pending inputs, predicted
  velocity, or deterministic replay state.
- Mandatory gameplay discontinuities remain immediate and are not hidden by
  smoothing.

## Architecture

### Local deterministic state

`reconcile()` continues to rebuild local deterministic state from the newest
authoritative snapshot and all unacknowledged input intervals. This state is the
source for local movement, charge, fire, recoil, dash, and predicted local
projectiles.

The deterministic state remains integer and tick-based. No fractional or
presentation-only position enters `stepLocal()` or later input replay.

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

The implementation must not double-apply elapsed ticks. Preserving phase means
carrying only the fractional remainder within one simulation tick; the new
deterministic state remains the source of completed ticks.

Mandatory discontinuities continue to snap immediately. Existing discrete snap
conditions remain authoritative: phase or score changes, knockout state,
confirmed shot cooldown transition, confirmed dash consumption, invalid arena
boundary state, final match state, and large corrections above the established
threshold.

### Presentation-space body collision

After computing the current local presentation and buffered remote sample,
`useArenaState` passes both through a pure body-overlap resolver. The resolver
operates on copies and returns constrained display snapshots.

The resolver mirrors `ArenaSimulation.ResolveBodyOverlap()`:

- Order players by stable session ID before assigning low and high shares.
- Use the configured player diameter of `playerRadius * 2`.
- Return unchanged snapshots when squared distance is at least diameter squared.
- For coincident centers, use positive X as the stable normal.
- Otherwise derive a Q15 normal using integer square root and truncated integer
  division.
- Split penetration in half; assign the odd unit to the higher session ID.
- Move the lower session ID opposite the normal and the higher session ID along
  the normal.
- Preserve velocity, aim, charge, cooldown, dash availability, acknowledgement,
  side, and every other snapshot field.

This resolver is a display constraint, not client authority. It does not write
the separated positions back to `predictedRef`, `presentedRef`, snapshots, or
pending inputs. Each frame begins from current prediction and interpolation,
then applies the constraint once.

Both constrained players are sent to Canvas. `localPlayerRef` also receives the
constrained local snapshot so pointer aiming uses the same center the player
sees.

### Overlap reconciliation

Visible overlap between predicted local and buffered remote positions is no
longer itself a hard-snap condition. Different display timelines make temporary
overlap expected even when both source states are valid. The presentation-space
resolver enforces non-overlap continuously.

Arena-boundary invalidity and all discrete snap conditions remain unchanged.
Large non-collision authority disagreements continue to snap at the established
distance threshold.

## Frame Data Flow

Each animation frame follows this order:

1. Consume any authority or discrete local-input invalidation.
2. Reconcile the deterministic local target when required.
3. Advance completed local fixed ticks using the held current input.
4. Interpolate local sub-tick movement at the current animation-frame time.
5. Apply any active small authority correction.
6. Sample the remote player and authoritative projectiles from the buffered
   snapshot timeline.
7. Resolve display-space body overlap between local and remote snapshots.
8. Publish the constrained frame directly to Canvas and `localPlayerRef`.
9. Publish React state only for semantic authority/input changes as already
   established by the single-render-loop refactor.

## Error and Edge Handling

- Missing remote player: skip body collision and render the local player.
- Missing local player: skip body collision and render the remote player.
- Coincident players: separate deterministically on the X axis.
- Round reset, final state, or session replacement: clear presentation caches and
  install authoritative state immediately.
- Long animation-frame stalls: preserve the existing cap of three completed
  local ticks per frame.
- Reduced motion: does not change positional reconciliation or collision rules.
- Reconnect: the replacement welcome resets prediction and presentation caches;
  no old-session collision state survives.

## Testing

### Pure collision parity

Add client unit tests with literal expected coordinates for:

- no overlap;
- even penetration;
- odd penetration with the extra unit assigned to the higher session ID;
- reversed input array/session ordering;
- coincident centers and stable positive-X separation;
- diagonal overlap using the same integer normal math as the server;
- preservation of velocity and all non-position fields.

### Reconciliation cadence

Add hook-level animation-frame tests that:

- move continuously through repeated 20 Hz authority snapshots while sampling at
  high-refresh intervals;
- preserve the sub-tick remainder across an ordinary snapshot;
- bound the snapshot-frame displacement relative to adjacent display frames;
- do not move backward for a small correction while held input continues;
- still snap immediately for every mandatory discrete condition.

### Sustained contact

Add hook-level tests for both perspectives:

- the local player pushes the buffered opponent over multiple snapshots;
- the buffered opponent pushes the local player over multiple snapshots;
- displayed bodies never overlap;
- neither local trajectory contains a periodic hard-snap spike;
- constrained `localPlayerRef` and the Canvas frame use the same local position.

### Regression verification

Retain and run existing prediction, fire, dash, correction, session replacement,
terminal-state, renderer, input, and connection tests. Run the full frontend test
suite, TypeScript type-check, and production build. Rebuild all three manual-test
clients for two-client collision validation.

## Acceptance Criteria

- Holding movement with no collision produces continuous local display cadence
  across repeated server snapshots.
- Sustained player-player contact does not visibly bump or hard-snap the local
  player from either participant's perspective.
- Displayed player bodies do not overlap.
- Local movement, aim, firing, and dash remain immediately responsive.
- Remote movement retains its buffered smoothness.
- Server snapshots remain the final authority and converge local prediction.
- No second animation-frame loop or per-frame React state publication is added.

## Out of Scope

- Predicting remote input or running full dual-player client simulation.
- Changing server tick rate, snapshot rate, collision rules, or protocol shape.
- Replacing Canvas rendering or changing Arena visuals.
- Network latency compensation for projectile hits.
- General transport diagnostics or unrelated client health monitoring.
