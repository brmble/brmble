# Realtime Acknowledgement and Latency — Design

**Status:** design agreed except for one open decision (see *Open Decision*). Not implemented.

**Origin:** findings 3 and 4 of the arena netcode review (2026-09-11). Findings 1 and 2
of that review are fixed on `fix/arena-server-clock-offset`; these two are not.

## Finding 3 — any rejected input cascades into a mid-match reconnect

### Mechanism

`ContinuousGameCoordinator.Reject` (`ContinuousGameCoordinator.cs:798`) returns without
advancing `AcknowledgedInput`:

```csharp
private static InputResult Reject(ContinuousRejectReason reason, ParticipantInputState participant) =>
    new(false, reason, participant.AcknowledgedInput);
```

The client's next input is therefore sequence *n+1* against an unchanged acknowledgement,
which the server reads as `SequenceGap`, which the client answers with `scheduleReconnect()`
(`useArenaConnection.ts:400`). Reconnecting drops input capture, which silently clears the
player's held movement keys. One refused message becomes a dropped connection mid-fight.

This was already discovered once and partly fixed: the strip-don't-reject treatment for
phase denial and cooldown (`ContinuousGameCoordinator.cs:331-347`) exists because
spam-clicking during cooldown fired the cascade constantly. The comment there records the
reasoning. `RateLimited` and `InvalidRange` still take the old path, so the cascade is
dormant rather than gone.

`InvalidRange` is the one to watch. `IsInRange` (`:808`) refuses a `PredictedTick` outside
`[serverTick - 120, serverTick + 30]`, which a backgrounded tab or a GC pause reaches with
the player touching nothing.

### Intended contract

Acknowledgement becomes unconditional: advance `AcknowledgedInput` for every well-formed
message and express refusal only as stripped or clamped fields — the treatment aim-rate
violations already get (`:362`). True rejection is reserved for `WrongMatch` and `WrongRole`,
where dropping the connection is the intent and the client already treats it as fatal.

Per reason:

| Reason | Today | Intended |
|---|---|---|
| `WrongMatch`, `WrongRole` | reject | **unchanged** — connection-level, client treats as fatal |
| `InvalidRange` | reject | clamp `PredictedTick` into range, normalise out-of-range axes, acknowledge. **Exception:** a heartbeat carrying a fire or dash stays rejected — malformed, not drifted |
| `RateLimited` | reject | acknowledge, discard the input's effect. The budget already refuses to feed the simulation; it should not also cost a reconnect |
| `StaleSequence` | reject | see *Open Decision* |
| `SequenceGap` | reject | see *Open Decision* |
| `PhaseDenied`, `Cooldown`, `DashSpent` | already stripped | unchanged |

Rate limiting is not weakened by this. The message is counted and its effect discarded
either way; only the punishment changes.

### Open Decision — `StaleSequence` and `SequenceGap`

WebSocket is ordered and reliable, so neither should occur in normal play. Today they are
caused almost entirely by a *previous* rejection skipping a sequence, so the three changes
above largely remove their cause.

**Option A (recommended).** Ignore a stale sequence silently — it is a retransmit — and
accept a gap by advancing to the received sequence. Inputs are full state snapshots rather
than deltas, so skipping one loses nothing. This makes the coordinator's contract
"acknowledge everything well-formed, refuse only at the connection level", which is the
shape a game-agnostic coordinator needs. Cost: a genuinely confused client is no longer
told.

**Option B.** Keep rejecting both, and change the client to resync rather than reconnect.
More faithful to "the server noticed something wrong", but moves the work into the client
and leaves an awkward contract in the layer that is supposed to become generic.

**This decision is not made. Ask the user before implementing.**

### Why this matters beyond the bug

A game-agnostic coordinator has no game-specific reason left to reject anything. Removing
`Cooldown` and `DashSpent` from `ContinuousRejectReason` is part of the orchestrator work
in the review; this change is a precondition for it.

## Finding 4 — `predictedTick` has no latency term

### Mechanism

`currentPredictedTick` (`useArenaConnection.ts:94`) is `lastSnapshotServerTick + elapsedTicks`,
with `clockStartedAt` reset on each snapshot (`:383`). It contains no estimate of how long
that snapshot took to arrive, so it names a tick the server has already passed — by the
downstream latency, plus up to 3 ticks of snapshot quantisation at 20 Hz.

`reconcile` clamps replay with `fromTick = Math.max(interval.fromTick, serverTick + 1)`
(`arenaMath.ts:497`), so inputs stamped behind the authority tick lose their opening ticks.
Every reconcile replays slightly less movement than the server actually ran, leaving the
local player perpetually a little behind its own authority, with a small correction applied
on essentially every snapshot. Imperceptible on a LAN; over real latency it reads as
"the controls feel soft".

### Intended fix

Add half the measured RTT. **This depends on `fix/arena-server-clock-offset` being merged** —
that branch added `serverClock.ts`, which already samples `(generatedAtUnixMs, receivedAt)`
pairs at the moment of receipt. RTT falls out of the same sampling. The two want to live in
one small module rather than two.

Do not start Finding 4 before that branch merges; there is nothing to build on until then.
