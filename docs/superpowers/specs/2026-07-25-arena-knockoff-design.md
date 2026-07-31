# Arena Knockoff Game Design

**Date:** 2026-07-25
**Status:** Approved
**Branch:** `feature/minigame-framework-expansion`
**Framework dependency:** `docs/superpowers/specs/2026-07-25-minigame-framework-expansion-design.md`

## Game Vision

Arena Knockoff is a competitive 1v1 top-down arena game where players charge
knockback shots, read their opponent, and knock them out before being knocked
out themselves.

There are:

- No health bars.
- No damage system.
- No randomness.
- No upgrades.
- No character advantages.

Both players always have identical tools. Positioning, prediction, timing, and
decision-making determine the winner.

Arena Knockoff is the reference game for Brmble's third minigame interaction
model: server-authoritative continuous simulation with client prediction and
spectator interpolation.

## Design Principles

### Deterministic outcomes

Given the same ruleset, initial state, and ordered input stream, the server must
produce the same simulation and outcome. Players lose because of decisions, not
random rolls or hidden variance.

### Simple controls, deep decisions

The complete action set is movement, aim, charge, fire, and one dash per round.
Every action creates positional or timing risk.

### Prediction is the primary weapon

The attacker predicts where the opponent will be when the shot arrives. The
defender reads aim, charge, and commitment to choose a response.

### Every shot is a commitment

Charging slows movement and reveals intent. Strong shots create more knockback
but also more recoil. A powerful shot near the edge can eliminate either player.

## Match Structure

The initial release uses best-of-3 by default. The first player to win two
rounds wins the match. Other formats are future options and are not required for
the initial release.

Every round resets:

- Player positions and momentum.
- Projectiles.
- Charge and cooldown state.
- Arena radius and shrink timing.
- Each player's one-use dash.

A round ends when a player's center crosses the current arena boundary.

If both players cross the boundary on the same authoritative simulation tick,
the round is a draw and is replayed without changing the match score. The replay
runs the complete round-introduction sequence again. Up to three consecutive
double-KO replays are allowed. A fourth consecutive double KO ends the match as
a draw so a perfectly symmetric loop cannot hold the channel forever. Any
decisive round resets the consecutive double-KO counter.

## Round Phases

Each round has three server-owned phases.

### Loading

- Duration: 1 second.
- Players are placed at mirrored spawn positions.
- Movement, dash, charge, and fire are disabled.
- The board and avatar assets initialize.
- A fallback avatar is immediately available if custom assets are not ready.

The first round does not enter Loading until both participant realtime sockets
have attached and acknowledged the initial state. The match has a 15-second
participant attachment window; failure to attach counts as a connection
forfeit. Later rounds enter Loading immediately because both sockets are already
attached. Reconnection during a match follows the separate 5-second grace rule.

### Positioning

- Duration: a visible 3-second countdown.
- Normal movement and solid player collision are enabled.
- Dash, charge, and fire remain disabled.
- The arena does not shrink.

This lets players establish an opening position without allowing an attack or a
spent dash before the round officially begins.

### Live

- Movement, dash, charge, and fire are enabled.
- Shot cooldown and forced-fire rules apply.
- Arena shrink timing starts when the countdown reaches zero.
- Knockouts can occur through a projectile, recoil, movement, dash, or collapse.

## Arena

The arena is circular. Players spawn opposite one another at mirrored positions.

The radius follows three deterministic phases:

1. **Opening hold:** the initial radius remains fixed for a configured period.
2. **Normal shrink:** the radius decreases continuously toward a small combat
   radius.
3. **Accelerated collapse:** the arena continues shrinking to zero, guaranteeing
   that every round ends through the same positional win condition.

The arena never ends a round through a separate timer score or random sudden
death mechanic.

Exact radii and phase durations are versioned server ruleset values.

## Player Bodies And Identity

Players are equal-radius circular bodies with solid collision. They cannot pass
through or overlap one another. Deterministic separation resolves contact, but
body contact itself applies no damage or knockback.

Collision pairs are processed in stable player-ID order. If two centers occupy
the same fixed-point coordinate and no geometric normal exists, separation uses
a deterministic axis derived from that stable ordering rather than a random or
platform-dependent direction.

Each body displays the user's avatar clipped to the player circle. If the user
has no avatar or loading fails, use a Brmble fallback avatar with deterministic
spawn-side styling:

- One side uses blue presentation.
- The other side uses red presentation.

Side assignment remains stable throughout the match. Color is not the only
identifier: names, distinct outlines, and non-color side markers remain visible
for color-vision accessibility.

Side presentation has no gameplay effect.

## Controls And Input Capture

- `WASD`: free 360-degree movement.
- Mouse: aim direction follows the cursor.
- Hold left mouse: charge.
- Release left mouse: fire.
- `Space`: dash in the current movement direction.

Diagonal movement and dash direction are normalized and grant no speed or
distance advantage.

If `Space` is pressed while stationary, dash uses the current aim direction.

The board captures gameplay input only after the player clicks it. `Escape`,
window focus loss, document visibility loss, socket loss, or board teardown
releases capture and clears all held input immediately. Chat and normal app
shortcuts remain available while capture is released.

Gameplay capture must prevent conflicting global Brmble shortcuts, including
push-to-talk bindings, from firing. Bindings should integrate with Brmble input
settings rather than remain permanently hardcoded.

## Movement

Both players have the same base speed and immediate directional control. There
are no acceleration differences or random movement effects.

Movement speed decreases continuously as shot charge rises. The slowdown is
fully determined by the current normalized charge and ruleset curve.

Crossing the arena boundary loses the round, whether caused by ordinary
movement, recoil, dash, projectile knockback, or shrinking arena geometry.

## Aim And Charge Presentation

A thin neutral aim line is visible at all times from each player body toward
that player's cursor. Both players and spectators see it, making aim direction
public information even before charging begins.

While charging, a second, more prominent line grows outward from the player body
along the current aim direction:

- Its maximum length is a fixed world-space distance.
- Length represents normalized charge.
- It is independent of cursor distance and screen size.
- Aim remains adjustable throughout charging.
- Thickness, texture, or another non-color cue supplements intensity so charge
  is not communicated by color alone.

There is no aim cone, spread preview, charge ring around the player, or recoil
direction indicator.

At maximum charge, a short forced-fire countdown is attached to the charge line.
If the player does not release, the server fires automatically when it expires.

## Projectile System

Firing creates a small visible orb with a short visual trail.

- The orb defines the true collision shape.
- The trail is presentation only and must not imply a larger hitbox.
- Projectile speed is constant at every charge level.
- Projectile radius is constant at every charge level.
- There is no spread, deviation, critical hit, or random force.
- Projectiles pass through other projectiles.
- A projectile affects only the opposing player.
- It disappears after hitting the opponent or leaving the active arena bounds.
- Multiple projectiles may coexist if permitted by cooldown timing.

Charge affects knockback force, shooter recoil, and movement commitment, but not
projectile speed or size.

## Knockback And Recoil

Projectile impact applies a deterministic impulse along the projectile's travel
direction. Knockback increases with normalized charge according to a versioned
ruleset curve.

Firing applies deterministic recoil to the shooter in the opposite aim
direction. Recoil also increases with charge.

There is no health or accumulated damage. The only purpose of impact and recoil
is changing position and momentum.

## Shot Cadence

Releasing the fire input can produce an immediate low-charge shot. Raw clicking
speed does not determine cadence because every shot starts a fixed post-shot
recovery period.

During recovery:

- A new charge cannot begin.
- The remaining cooldown is visible to both players and spectators.
- Inputs attempting to bypass the cooldown are rejected or ignored by the
  server.

This preserves responsive firing without adding a heat, ammunition, or resource
system.

## Dash

Each player receives one dash per round. Dash is restored on every normal round
and double-KO replay.

- Dash is a deterministic movement burst.
- It uses movement direction, or aim direction when stationary.
- It has no invulnerability.
- It cannot pass through the opposing player.
- Solid collision still applies.
- It cannot be recovered during the round.
- A badly directed dash can carry its user outside the arena and lose the
  round.

Dash is disabled during Loading and Positioning.

## Server-Authoritative Simulation

The initial targets are:

- Fixed simulation rate: 60 ticks per second.
- Authoritative snapshots: 20 per second.
- Browser rendering: display refresh rate.

The simulation uses fixed units and integer or fixed-point values where practical.
No game rule depends on browser frame rate, wall-clock frame deltas, or client
physics.

Simulation state includes:

- Match and round phase.
- Round score.
- Arena radius.
- Player position, velocity, aim, charge, cooldown, and dash availability.
- Active projectiles.
- Input acknowledgement sequence.
- Ruleset and protocol versions.

All terminal decisions are server-owned, including hits, knockouts, double KOs,
score, phase changes, and match completion.

## Input Protocol

Player input is represented as sequence-numbered state and edge commands:

- Held movement vector.
- Quantized aim vector.
- Held charging state.
- Fire-release edge.
- Dash edge.

Every input includes the client's predicted simulation tick as well as its
monotonic sequence. The client records the tick interval over which each held
state was predicted. Server acknowledgements include both the processed input
sequence and authoritative server tick, allowing reconciliation to replay each
unacknowledged state for the correct number of fixed steps.

Movement and charge transitions are sent immediately. Aim is sampled at a
bounded rate, with a heartbeat ensuring stale input is detected. Edge actions
are deduplicated by sequence.

The server validates:

- Sequence ordering.
- Value ranges and vector normalization.
- Input rate.
- Current match and role.
- Actions permitted by the current phase.
- Dash availability, cooldown, and charge state.

Focus loss, input-capture release, stale heartbeat, or socket loss installs
neutral input immediately.

Input-state changes and edges are sent immediately, aim samples are capped at 30
per second, and a neutral/held-state heartbeat is sent every 250 ms. The server
installs neutral input after 750 ms without an input or heartbeat while the
socket remains attached. The scheduler processes at most five catch-up ticks in
one cycle before recording overload and resynchronizing its deadline.

## Prediction And Reconciliation

The local client predicts its own:

- Movement and charge slowdown.
- Dash.
- Recoil.
- Immediate firing presentation.

Snapshots acknowledge the last processed input sequence. On receipt, the client
resets predicted state to authority and replays unacknowledged local inputs.
Small visual corrections are smoothed. Corrections that would leave the player
outside the arena, preserve an invalid overlap, or materially change an outcome
snap to server state.

Remote players, projectiles, arena radius, and spectator entities render from a
100 ms snapshot interpolation buffer. Spectators never predict. Extrapolation is
capped at one 50 ms snapshot interval before holding the latest authoritative
state.

No server rewind or lag compensation is used initially. Shots and movement
exist in one live authoritative timeline. Any future lag compensation would
change gameplay and requires a new reviewed ruleset.

## Realtime Connection

Arena uses the framework's dedicated browser-owned realtime WebSocket. The
native mTLS bridge only issues short-lived connection tickets; it does not proxy
Arena inputs or snapshots.

A ticket is:

- One-time use.
- Short-lived.
- Bound to stable user identity, live session, match, and participant or
  spectator role.
- Atomically consumed when the socket attaches.

Reliable match lifecycle and queue events continue over the normal Brmble event
bus.

## Disconnect Behavior

If a player's realtime socket disconnects during a live round:

1. Held input becomes neutral immediately.
2. The player remains in the simulation and is vulnerable.
3. A 5-second reconnect grace begins.
4. Reconnection obtains a fresh ticket and complete authoritative snapshot.
5. Stale inputs are not replayed.
6. Failure to reconnect forfeits the match, not merely the round.

The simulation does not pause because pausing could be exploited tactically.
Leaving the voice channel retains the shared framework's immediate active-match
forfeit behavior.

## Participant And Spectator Activity

Arena renders in the shared upper `ChatPanel` foreground-activity area. It
replaces the visible screen-share grid while preserving channel chat below.

For participants, the board captures controls and runs local prediction. For
spectators, the same authoritative presentation is read-only and interpolation
only.

Watched screen shares remain connected but their remote media subscriptions are
paused while Arena is foregrounded. Closing Arena restores the prior share
layout. Local screen broadcasting remains active.

## Rendering

Arena uses a responsive Canvas 2D renderer:

- Simulation coordinates remain fixed regardless of app dimensions.
- Rendering scales uniformly and letterboxes when needed.
- Resizing never changes gameplay geometry or input interpretation.
- Avatar images are clipped to circular player bodies.
- Permanent names and side markers identify players without relying on color.
- Aim, charge, forced-fire timing, cooldown, dash availability, shrink phase,
  score, and countdown are readable.

Reduced-motion mode removes nonessential flashes, shake, and decorative motion
without changing simulation timing or required gameplay information.

No gameplay or physics library is required. Native Canvas 2D, WebSocket, Web
Audio, and deterministic C# simulation are sufficient.

## Audio

The initial release includes restrained gameplay cues for:

- Charge buildup.
- Maximum-charge warning.
- Firing.
- Projectile impact.
- Dash.
- Countdown.
- Knockout.
- Accelerated arena collapse.

Audio supplements visual cues and never carries exclusive gameplay information.
Spatial stereo should remain subtle so voice communication stays intelligible.

Arena has a dedicated saved game-volume setting. The board also provides an
icon-only session mute toggle for players and spectators. Quick mute does not
overwrite the saved volume.

## Ruleset Versioning

Every tunable value belongs to one versioned server ruleset, including:

- World and arena dimensions.
- Player radius and movement speed.
- Charge duration and slowdown curve.
- Maximum-charge forced-fire delay.
- Projectile radius and speed.
- Knockback and recoil curves.
- Shot cooldown.
- Dash distance and timing.
- Loading and positioning durations.
- Arena hold, shrink, and collapse timings.

The protocol communicates the active ruleset version and prediction-relevant
constants. A material balance or timing change increments the version so
statistics and queue duration estimates are not mixed across incompatible
rules.

Initial numeric values are chosen through deterministic simulation scenarios and
human playtesting. They live in `ArenaRulesetV1`, not in the transport protocol;
the server sends prediction-relevant effective values in the realtime welcome
message.

## Statistics And Telemetry

Existing match statistics record Arena as `arena-knockoff`, format `bo3`, and
the current ruleset version.

Match telemetry includes:

- Duration, result, and disconnect or forfeit reason.
- Final round score.
- Rounds played and double-KO replays.
- Round durations.
- Knockout cause: opponent projectile, recoil, dash/movement, or collapse.
- Shot and hit counts.
- Charge levels for fired and landed shots.
- Dash use.
- Arena radius at knockout.

Operational telemetry includes:

- Active realtime matches, sockets, and spectators.
- Tick lateness and catch-up counts.
- Snapshot size and dropped obsolete snapshots.
- Input rejection and sequence-gap counts.
- Reconnect grace starts, recoveries, and forfeits.
- Client-reported reconciliation magnitude summaries.

Raw input streams are not retained as routine analytics. Telemetry uses built-in
platform metrics and structured logs rather than requiring a new vendor SDK.

## Testing Strategy

### Deterministic simulation

- Identical initial state and ordered inputs produce identical state hashes and
  outcomes.
- Loading, Positioning, and Live allow exactly their specified actions.
- Solid player collision prevents overlap deterministically.
- Charge slowdown and force curves clamp correctly.
- Maximum charge force-fires at the configured tick.
- Cooldown prevents rapid low-charge spam.
- Projectile speed and radius remain constant across charge levels.
- Projectiles pass through one another.
- Knockback and recoil scale correctly.
- Dash is one-use, collision-respecting, and can self-KO.
- Arena hold, shrink, and collapse follow exact ticks.
- Same-tick double KO replays without changing score.
- A fourth consecutive double KO ends the match as a draw.
- Best-of-3 completes when a player earns two round wins.

### Runtime and transport

- Simulation and snapshot cadence remain 60/20 under normal load.
- Catch-up is bounded after scheduler delay.
- Input ordering, acknowledgement, deduplication, and validation.
- Obsolete snapshots are dropped rather than queued indefinitely.
- Ticket scope, expiration, and atomic one-time consumption.
- Participant and spectator role separation.
- Neutral input and 5-second reconnect grace.
- Reconnection supplies a complete state snapshot.

### Client

- Local replay after authoritative acknowledgement.
- Correction smoothing and mandatory snap cases.
- Remote and spectator interpolation under latency, jitter, and loss.
- Canvas world-to-screen and pointer-to-world transforms.
- Avatar fallback and non-color identity markers.
- Aim and charge-line drawing behavior.
- Input capture, Escape release, focus loss, and shortcut isolation.
- Audio unlock, game volume, and quick mute.
- Reduced-motion presentation.

### Load and playtesting

- Multiple active Arena matches in different channels.
- Participant and spectator snapshot fan-out.
- Slow-client backpressure.
- Side symmetry and absence of red/blue spawn advantage.
- Round duration distribution and collapse completion.

## Balancing Success Criteria

- No charge band is consistently dominant.
- Fixed recovery prevents click-rate advantages.
- Maximum charge is powerful but sufficiently telegraphed and risky.
- Dash is valuable but not mandatory for every successful defense.
- Recoil produces meaningful self-KO risk near the edge.
- Rounds reliably conclude through arena collapse.
- Spawn sides show no statistically significant advantage.
- Voice chat remains intelligible over game audio.
- Players can identify aim, charge, cooldown, and dash state without relying on
  sound or color alone.

## Non-Goals For Initial Release

- Best-of-5 or configurable Arena formats.
- Character selection, classes, skins with gameplay effects, or upgrades.
- Health, damage accumulation, critical hits, random spread, or random arenas.
- Projectile-versus-projectile cancellation.
- Dash invulnerability or passing through players.
- Lag-compensated hit rewinding.
- Replay files or raw input-stream persistence.
- Mobile or gamepad controls.
- Horizontal simulation scaling.
