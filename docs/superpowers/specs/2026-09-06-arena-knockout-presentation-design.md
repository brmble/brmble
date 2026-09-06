# Arena Knockout Presentation Design

Date: 2026-09-06
Status: Approved in chat; pending written review
Branch: `docs/arena-knockoff-revision`
Base: `6ad0384e`

Builds on:

- `docs/superpowers/specs/2026-08-27-arena-knockoff-revision-design.md`
- `docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md`

## Purpose

Knocking an opponent out of the ring is the payoff of Arena Knockoff's entire
game loop, and it currently has no presentation at all. The renderer has no
knockout branch. The score silently increments, both players teleport to spawn,
and the round restarts. A player who looked away for half a second cannot tell
what happened, or to whom.

This design gives a knockout a visible consequence: the loser slides out over
the lip of the arena, shrinks as they fall away, and vanishes in a puff of dust.
The same vanish covers forfeits and abandons, where a player currently just
freezes in place.

It also gives the arena a floor. Today the area inside the ring and the area
outside it are painted the same colour, so there is nothing for a player to fall
*into*.

## Constraints Discovered

Three facts from the existing implementation shape everything below. They were
established by reading the code, not assumed.

### The knocked-out position never reaches the client

`ArenaSimulation.Step()` runs `EvaluatePlayerBoundaries()` as stage 13 and
`ResolveRound()` as stage 14. `ResolveRound()` calls `ResetRound()`
(`ArenaSimulation.cs:574-598`), which snaps both players back to
`±SpawnOffset` and zeroes their velocity — in the same tick, before the
coordinator takes its snapshot.

The out-of-bounds position therefore exists for **zero observable ticks**. This
is not a 20 Hz sampling race that a faster snapshot rate would fix; no observer
reads simulation state mid-`Step()`, so even a 60 Hz stream would show a player
teleporting from a last-inside position to spawn with no frame between.

There is one exception. When `ResolveRound()` takes the `Complete("decided")`
or `Complete("draw")` branch, `ResetRound()` is **not** called, so the final
knockout of a match keeps its true out-of-bounds coordinates. Those ship in
`matchClosed.finalState` every time.

### Any snapshot field is a breaking protocol change

The client validator is arity-strict. `objectWithKeys`
(`arenaProtocol.ts:126-130`) tests `actual.length === keys.length`, so an added
key — required or optional — makes an existing client reject the whole message.
There is no unknown-key tolerance, and because `JsonSerializerDefaults.Web` does
not set `DefaultIgnoreCondition`, a nullable field is still a permanent key on
the wire. There is no way to add a field that is absent when irrelevant.

`protocolVersion` is hard-compared against literal `1` in five places, with no
negotiation path, so a bump makes old clients reject all traffic rather than
degrade.

### Arity-strictness is a property of one socket, not of the client

Recorded after the fact, because the original constraint above was stated too
coarsely — as "no server change" — and that framing very nearly cost the forfeit
vanish its only source of truth.

Arity-strictness belongs to the **arena WebSocket's validator**. It is not a
property of every channel this client listens on. The duel event bridge is a
separate path: `useGameState.handleEnded` reads the `game.ended` payload through
a loose cast, and `EndedMatch.winnerId` was already an optional field. Adding
`winnerId` there is additive and breaks nothing.

This mattered. The forfeit vanish shipped **inert**: it gated on `ended.winnerId`,
and `ContinuousGameCoordinator` never published one — `winnerId` appeared nowhere
in the entire `Continuous` namespace. The vanish could not fire, and an
already-merged commit carried the same latent defect. The fix was a server change,
correctly ruled in, and it was ruled in only because the constraint was re-read
against the actual channel rather than applied as a blanket ban.

The durable form of the rule: **before rejecting a wire change, name the socket.**
"The client validator is arity-strict" is true of the arena snapshot stream and
false of the duel event bridge.

### The client can already infer the victim

The score identifies the winner, so the other side is the victim. A double
knockout increments `consecutiveDoubleKos`. What the client lacks is only
*where* and *how fast* — and, as established below, it has enough of both.

## Approach

Three approaches were considered.

**A. Client-side inference from the last pre-reset snapshot.** Detect the
knockout from the phase and score transition, and animate from the victim's
last observed position and velocity. No server change, no protocol change.

**B. Server retains a last-knockout record** (session, position, cause, radius,
tick) surviving into the loading phase, emitted on the snapshot root. Exact and
cause-aware, at the cost of a breaking protocol change, new simulation state
that must join `DeterministicHash()`, and coupled client/server release.

**C. Hybrid** — retain position only, drop cause. A smaller break with the same
release coupling.

**A is chosen.** Its only cost is positional accuracy: the last snapshot precedes
the boundary crossing by 0-2 ticks, leaving the animation's start point up to
roughly 600 units short of the true exit against a 9000-unit radius — under 7%,
and well inside one body diameter. That is not perceptible in an animation whose
whole purpose is to be read at a glance.

The cause data that B and C would buy turns out not to be wanted: a knockout
looks the same whether it came from a shot, a dash, a collapse or recoil. B's
remaining advantage is therefore precision alone, which does not justify a
protocol break, a determinism-hash change and a coupled release. If the animation
reads as inaccurate in play, B remains available — and the decision would then be
evidence-led rather than speculative.

## Architecture

### Detection

A knockout is inferred from a snapshot transition out of the `live` phase:
`live → loading` for an ordinary round, `live → ended` for the deciding one.
These are exactly the transitions `ResetRound()` and `Complete()` produce.

The victim is the side whose score did not increase. When both sides are
victims — a double knockout — `consecutiveDoubleKos` increments and both
animate.

The animation's origin is the victim's position and velocity from the **last
snapshot before the transition**, which the client's existing timeline buffer
already retains. The deciding knockout uses that same inferred origin — there is
no special case for it.

An earlier draft of this design had the deciding knockout read its origin from
`matchClosed.finalState` instead, and that was **struck rather than implemented**.
`finalState` genuinely does carry the true out-of-bounds coordinates (see
*Constraints Discovered* above), so the option exists and a future reader should
know it does. It was declined because the accuracy it buys is under one body
diameter; taking it would change `detectKnockout`'s signature to accept a source
it otherwise has no use for; and a larger error term was found in the same region
and left unfixed — detection reads the newest snapshot while the renderer draws
from the timeline interpolated ~100-150 ms behind, so the falling body pops
outward by up to that much travel on its first frame. Chasing sub-diameter
precision while a larger, unmeasured offset sits next to it is the wrong order of
work. If the interpolation offset is ever addressed and the origin still reads
wrong, `finalState` is where to go.

Forfeits and abandons are detected from the terminal reason rather than a phase
transition, and use the vanish path with no slide.

### Slide distance

Movement and dash are applied positionally — `player.X += displacement.X`
(`ArenaSimulation.cs:342`, `:363`) — and never touch velocity. Velocity is
written only by firing recoil (`:320`) and projectile impulse (`:460`), then
damped each tick.

A knockout's snapshot velocity therefore already encodes how the player left:

- struck by a charged projectile — large velocity
- knocked out by their own recoil — moderate velocity
- walked or dashed over the edge — **zero velocity**

The slide is consequently a floor plus a velocity term, along the outward radial
normal from the arena centre:

    slide = minimumClearance + velocityDistance

The floor exists because of that third case. The server rules a knockout when the
player's **centre** crosses the radius (`IsInsideArena` tests the centre), so a
walk-off ends with the body half inside the ring. Without a minimum clearance
such a knockout would animate a fall from a pose that still looks in-bounds. The
floor carries the body clear of the lip; the velocity term then differentiates a
gentle slip from being hammered across the map.

`minimumClearance` is expressed in body diameters rather than as a bare distance,
so it stays correct if `playerRadius` ever changes, and so the intent — "far
enough out that the body is unambiguously past the lip" — survives in the code.
One diameter is the starting value.

This is presentation only. The knockout ruling, its timing and its threshold are
unchanged and remain server-authoritative.

### Animation

Three stages, driven from the animation-frame clock the hook already owns:

1. **Slide** — outward along the radial normal by the distance above.
2. **Fall** — scale the body toward a vanishing point while continuing to drift
   outward, reading as a drop away from the camera.
3. **Puff** — a brief expanding, fading dust ring at the vanishing point.

Forfeit and abandon use stage 3 alone, in place: the player vanishes where they
stand.

### Timing

The victim is respawned server-side the moment the knockout resolves, so during
the animation the authoritative snapshot already shows them at spawn. The
renderer suppresses the victim's normal draw and renders the falling body in its
place — the same display-filter principle as `constrainLocalDisplay`, and equally
forbidden from writing back into prediction or presentation state.

Because the client controls when the victim reappears, the animation is not
boxed into the one-second `loading` phase. It may spill into `positioning`,
giving a four-second budget. The winner is already respawned and visible
throughout, so the round proceeds normally around the animation.

Server round timings (`LoadingTicks`, `PositioningTicks`) are deliberately left
alone. Lengthening them to fit an animation would be a ruleset edit with
determinism tests pinned to the exact values, which presentation can avoid
entirely.

### Arena floor and void

`ArenaRenderer.render()` currently fills the whole square with `--bg-surface`
(`:92-93`) and strokes the ring on top, so the area inside the ring and the area
outside are the same colour. There is no floor, and therefore nothing to fall
into.

The paint order inverts:

1. fill the square with `--bg-deep`, the darkest base token — the void
2. fill the arena **disc** with `--bg-primary` — the floor
3. stroke the ring as the lip between them

The floor is `--bg-primary`, not `--bg-surface`. `--bg-surface` is a 5–16% alpha
`rgba` on every theme except windows-2000, so filled over an opaque `--bg-deep` it
composites back to within ~1.1:1 of the void and there is still nothing to fall
into. `--bg-primary` is opaque on all nine themes and is the layer the token
template stacks directly on `--bg-deep`, so void = base layer and floor = app
layer reads truly through the token system.

This is a prerequisite for the animation to read at all, and it independently
improves the core loop: a shrinking ring now reads as the floor receding rather
than as a circle changing size.

### Placement

The logic lives in a new pure module, `arenaKnockout.ts`, exporting a detector
and a sampler that maps elapsed time to slide offset, scale and opacity.

`useArenaState` holds one ref for the active knockout, calls the detector when
authority changes, and adds one field to the render frame. `ArenaRenderView`
gains a `knockout` field; `ArenaRenderer` draws the falling body and the puff and
suppresses the victim's normal draw while it is active.

Keeping the logic out of the hook is deliberate. `useArenaState` has just been
through a difficult reconciliation refactor whose correction-origin arithmetic is
subtle and hard-won; knockout bookkeeping must not be entangled with it. The
hook's footprint is one ref, one call and one field.

## Reduced Motion

The renderer already honours `prefers-reduced-motion`, and its existing test
states the rule: it removes moving trails *without changing body positions or
state cues*. Decorative motion goes; information stays.

A knockout animation is information. It identifies who lost the round and where
they went off. Removing it under reduced motion would restore exactly the defect
this design exists to fix, for the users least able to follow a sudden
unexplained state change.

So reduced motion keeps the information and drops the movement: no slide, no
fall, no scaling. A static mark appears at the exit point and fades. Opacity is
not what the setting guards against — movement, scaling and parallax are.

This is one rule across all triggers rather than a special case per trigger.

## Error and Edge Handling

- **Double knockout** — both players animate; the round still resets normally.
- **Forfeit or abandon** — vanish in place, no slide, no fall.
- **Deciding knockout** — animates from the same inferred origin as any other
  knockout; the result panel appears while it plays.
- **Round reset arriving mid-animation** — cancel and re-arm from the new
  knockout rather than queueing.
- **Match end, session replacement or reconnect** — clear the knockout ref, as
  every other presentation cache already does.
- **Missing victim in the last snapshot** — skip the animation rather than
  guessing a position.
- **Long frame stalls** — the sampler is a pure function of elapsed time, so a
  stall skips frames rather than extending the animation.

## Testing

- **Sampler** — a pure function of elapsed time, tested directly with exact
  expected slide, scale and opacity at fixed offsets, including its endpoints.
- **Detector** — snapshot-pair cases: ordinary knockout, double knockout,
  deciding knockout, forfeit, abandon, and a phase change with no score change
  (which must not trigger).
- **Slide distance** — zero-velocity knockout still clears the ring by the
  minimum; high-velocity knockout travels proportionally further.
- **Renderer** — the victim's normal draw is suppressed while the animation is
  active and restored afterwards; the puff is drawn; the winner is unaffected.
- **Reduced motion** — no slide or scale; the static mark is drawn.
- **Hook** — the knockout ref clears on reset, match end and session
  replacement, and never reaches `predictedRef`, `presentedRef`, snapshots,
  pending inputs or the correction origin.
- **Background** — the arena disc and the void outside it use different fills.

## Acceptance Criteria

- A knockout is visible: the loser leaves the ring, falls away and puffs out.
- The distance travelled reflects how the player was knocked out — a charged hit
  throws them far, a walk-off drops them just over the lip.
- A walk-off knockout never animates from a pose that still looks in-bounds.
- Forfeit and abandon vanish the player rather than freezing them.
- The area outside the ring reads as a void, distinct from the arena floor.
- Reduced motion still communicates who was knocked out and where.
- The winner's round proceeds normally while the animation plays.
- No arena protocol change, no simulation change, no determinism-hash change.
- One additive server change: `ContinuousGameCoordinator` publishes `winnerId` on
  `game.ended`. This does **not** travel the arity-strict arena socket — it travels
  the duel event bridge, where `useGameState.handleEnded` reads with a loose cast and
  `EndedMatch.winnerId` was already optional. Required because the forfeit vanish has
  no other source for the loser's identity.
- Presentation never writes into prediction, presentation or authority state.

## Out of Scope

- A victory emote or celebration for the winner. There is no emote concept in the
  codebase, and adding one belongs in its own piece of work.
- Cause-specific animations. Deliberately rejected: a knockout looks the same
  regardless of what caused it, and carrying the cause would force a protocol
  break.
- Changing the knockout rule, its centre-crossing threshold, or round timings.
- The shrink-phase colour gradient and the removal of the `HOLD` / `NORMAL` /
  `COLLAPSE` label. Adjacent to the background work and worth doing next, but
  tracked separately.
- Putting `ArenaKnockoutCause` on the wire. Approach B remains available if the
  inferred position proves inaccurate in play.

## Note for a Later Change

The client's `ArenaPhase` union (`arenaProtocol.ts:46`) includes `'roundReset'`,
but the server's `ContinuousMatchPhase` has no such member and can never emit it.
It is dead client surface. Removing it is unrelated to this design and should not
be bundled into it, but it is worth recording.
