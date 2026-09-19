# Realtime Acknowledgement and Latency — Design

**Status:** design agreed, all decisions made. Implemented on `fix/arena-unconditional-acknowledgement` (Finding 3) and `feature/arena-input-scheduling` (Finding 4); server side awaiting a `dotnet test` run. Supersedes the earlier version
of this file; the second-opinion review that drove the changes is
`docs/superpowers/reviews/2026-09-13-realtime-acknowledgement-and-latency-review.md`.

**Origin:** findings 3 and 4 of the arena netcode review (2026-09-11). Findings 1 and 2 are
merged (PR #650). Line anchors are against `main` at `2f89650e`.

**Plans:**
- `docs/superpowers/plans/2026-09-13-realtime-acknowledgement-and-latency.md` — Finding 3
  (server-only, branch `fix/arena-unconditional-acknowledgement`).
- `docs/superpowers/plans/2026-09-13-arena-input-scheduling.md` — latency harness, baseline
  measurement, Finding 4 (branch `feature/arena-input-scheduling`, after the first merges).

**Related:** `docs/superpowers/specs/2026-09-13-continuous-coordinator-extraction-design.md`
is the follow-on that makes the coordinator game-agnostic. It is sequenced *after* both plans
above because Finding 3 turns every game-specific refusal into a strip, which is what makes
the extraction mechanical.

---

## Finding 3 — a rejected input cascades into a mid-match reconnect

### Mechanism (corrected)

`ContinuousGameCoordinator.Reject` (`ContinuousGameCoordinator.cs:798`) returns without
advancing `AcknowledgedInput`. The client's recovery from that is two-tiered:

1. If the rejected sequence is the **newest one the client has sent**, it rewinds
   `nextSequence` and drops the frame from `pendingInputs` (`useArenaConnection.ts:405-412`).
   No gap forms. Pinned by `'rewinds a rejected newest sequence without creating a sequence
   gap'` (`useArenaConnection.test.tsx:448`).
2. If a **later frame is already in flight**, it calls `scheduleReconnect()` (`:405-407`).
   Pinned by `'reconnects when a rejected sequence already has later frames'` (`:530`).

So the cascade is a race between the server round-trip and the client's send cadence. While
the mouse moves the client sends an aim frame every 40 ms (`AIM_INTERVAL_MS`), so any RTT above
roughly 40 ms loses the race nearly every time. On a LAN the rewind path wins and the bug is
invisible; over the internet the reconnect path wins. Reconnecting drops input capture, which
silently clears held movement keys. One refused message becomes a dropped connection mid-fight.

`inputRejected` is written `Coalescible: true` (`RealtimeGameEndpoint.cs:214`), so a burst of
rejections collapses to the latest one. That is what lets the rewind path work when two
rejections are queued; keep it.

The strip-don't-reject treatment for phase denial, cooldown and dash-spent
(`ContinuousGameCoordinator.cs:331-350`) was the first fix for this, prompted by
spam-clicking during cooldown. `RateLimited` and `InvalidRange` still reject, so the cascade is
dormant, not gone.

### The realistic `InvalidRange` trigger is server tick starvation

`IsInRange` (`:808`) refuses a `PredictedTick` outside `[serverTick - 120, serverTick + 30]`.
The client's stamp is `serverTick + wall-clock elapsed since the last snapshot`
(`useArenaConnection.ts:94`). A backgrounded tab does not reach the bound: WebSocket messages
still arrive and `performance.now()` still advances, so the stamp tracks the server to within
one-way latency.

What does reach it is the **server** falling behind wall time. `FixedStepScheduler.PlanCycle`
catches up at most `MaxCatchUpTicks = 5` ticks per cycle and then forgives the remaining debt
(`FixedStepScheduler.cs:53-56`, `NextDeadline = now`). After any stall — GC, lock contention of
the kind PR #650 removed, a busy host — server tick time is behind wall time by the stall
length. The client keeps stamping from wall time, so after a stall longer than 30 ticks (500 ms)
every input it sends until the next snapshot lands is past `serverTick + 30`, is rejected, and
§Mechanism applies. `InvalidRange` therefore correlates with server load, which is exactly when
a reconnect storm is least affordable. This is the case the regression test must reproduce.

### Inputs are not pure snapshots

Held state (move, aim, charging) is a snapshot. `FireReleased` and `Dash` are **edges**:
`ArenaSimulation.SetInput` (`ArenaSimulation.cs:87-95`) ORs them into the latched input and
`ProcessDashEdges`/`ProcessFire` consume them on the next step. Skipping a sequence that
carried a fire loses the shot. This does not change the decision below — WebSocket is ordered,
so a gap can only be self-inflicted by an earlier rejection, and after this change there are no
earlier rejections — but it is why the contract is stated as "gaps cannot occur" rather than
"gaps are harmless".

### Contract

The coordinator refuses at the **connection level only**. Every well-formed message from an
attached participant is acknowledged. Game-level refusal is expressed by stripping or
substituting fields, which the client already handles because it never learns about it.

| Reason | Today | New behaviour |
|---|---|---|
| `WrongMatch`, `WrongRole` | reject | **unchanged** — connection-level; client treats as fatal |
| `InvalidRange`: `PredictedTick` outside `[tick - 120, tick + 30]` | reject | clamp into the window, acknowledge. Before the input-scheduling design below the server did not use `PredictedTick` for anything except this check and the determinism hash (`ArenaSimulation.cs:167`), so the clamp had no gameplay consequence; scheduling narrows the window to `[tick + 1, tick + 30]` and gives it meaning. |
| `InvalidRange`: aim `(0,0)` or over-length aim | reject | substitute the last accepted aim (`participant.AimX/AimY`), exactly as the aim-rate clamp does at `:362`; acknowledge |
| `InvalidRange`: over-length move vector | reject | scale down to length ≤ 32 767, acknowledge |
| `InvalidRange`: heartbeat carrying fire or dash | reject | **unchanged** — that is a malformed client, not drift |
| `RateLimited` (input) | reject | acknowledge, **apply held state, strip edges**. Rate limiting is about message volume; applying the held state of an over-budget message costs nothing, and discarding it makes the character freeze — the same reasoning as the aim-rate comment at `:355-361`. The message is not counted against the window, exactly as a rejected one never was, so a flood cannot extend its own punishment. |
| `RateLimited` (heartbeat) | reject | acknowledge and **ignore**. The heartbeat budget (12/s against 4/s sent) is only ever reached by abuse, unlike the input budget which normal play reaches, so the beat neither lands nor refreshes the neutral deadline. |
| `StaleSequence` | reject | **ignore silently**: it is a retransmit or a client bug, and the connection-level reasons already cover a client that is truly lost. Keep the `LogInformation` so a confused client is still visible server-side. No `inputRejected` is sent. |
| `SequenceGap` | reject | **advance to the received sequence and apply it.** Log it — it should never happen once this ships. No `inputRejected` is sent. |
| `PhaseDenied`, `Cooldown`, `DashSpent` | already strip | unchanged |

`StaleSequence`/`SequenceGap` was the open decision in the previous version. It is decided:
Option A. The rationale is that a game-agnostic coordinator has no game-specific grounds to
refuse anything, and a client that has genuinely lost the thread will trip `WrongMatch` or the
reconnect grace regardless.

**Residual cost, stated once.** An acknowledgement now says "received", not "applied as sent".
A rate-limited input whose fire was stripped will have produced a predicted projectile on the
client that the next snapshot removes. That is only reachable under abuse, and it is the same
behaviour the cooldown strip already has.

**Client after this change.** The `staleSequence`/`sequenceGap` branch
(`useArenaConnection.ts:400-403`) becomes unreachable from this server. Leave it in place; it
is removed with the coordinator extraction, not here.

---

## Finding 4 — the client under-predicts its own inputs

### Mechanism (corrected)

The previous version said "add half the RTT to `predictedTick`". That fix assumed the server
applies an input at its stamped tick. It does not. `SetInput` latches the input on **arrival**
and `Step` reads `player.Input` on the next tick; `PredictedTick` is range-checked, hashed and
otherwise ignored. So changing the stamp changes only the client's replay window.

What the replay window does today, for one held-movement press with one-way latency *L* ticks:

1. The client stamps `T = S_last + elapsed`, which lags the server's present by *L*.
2. The new pending interval is `fromTick = toTick = T` — one tick wide — and only widens to
   `nextStamp - 1` when the *next* frame is sent (`useArenaConnection.ts:150-155`). With a key
   held and the mouse still, the next frame is a heartbeat, up to 250 ms away.
3. Every snapshot that arrives before the acknowledgement has `serverTick ≥ T` (the stamp lags
   the server). `reconcile` hits `if (interval.toTick <= serverTick) continue`
   (`arenaMath.ts:498`), or the clamp at `:497`, and replays **nothing**.
4. Local state after each reconcile is therefore `authority(S)` plus whatever
   `advanceLocalPresentation` adds from `presentedAt` — at most one snapshot interval: three
   ticks, 270 units at base speed.

Prediction never gets more than ~3 ticks ahead of authority. At movement start the server has
not moved yet, so each snapshot pulls the local player back by up to 270 units (under the
300-unit snap threshold, so it blends over 100 ms) for the whole RTT. The player sees ~RTT of
"running in place" before the character goes. That is the softness. It is structural, not a
small systematic bias.

### Why half-RTT on the stamp is not the fix

With `T ≈ S_last + elapsed + RTT/2` the stamp sits at roughly the server's present. Snapshots
generated after the press but before the server applied it now **do** replay up to *L* ticks,
so the local player runs ahead of authority. When the acknowledgement lands, authority started
moving *L* ticks later than the prediction did, and the correction is `L × 90` units — 540 at
100 ms RTT, above the snap threshold at `arenaMath.ts:525`. Today's mush becomes a visible hitch
on every movement start. The one-tick-wide newest interval in step 2 would mask some of that by
accident; that is not a design.

The underlying fault is that the client applies an input at local tick `T` while the server
applies it at `T + RTT`, and nothing reconciles those two times.

### Intended design: the client runs ahead; the server applies at the stamped tick

This is the standard model and the only one in which `predictedTick` earns its name. It changes
server behaviour but not the wire shape.

**Server.**

- `SubmitInput` validates and **queues** the input per participant, keyed by `PredictedTick`,
  instead of calling `SetInput` immediately. `PredictedTick` is clamped into
  `[tick + 1, tick + 30]` first: a late input (stamp ≤ current tick) applies on the next step;
  a far-future stamp is applied at most 500 ms out. Both clamps are logged at Debug with the
  distance; they are the health signal for the client's lead estimate.
- On each scheduler tick, **before** `Step()`, install every queued input with
  `PredictedTick ≤ tick + 1` in sequence order via `SetInput`. The OR-latch in
  `SetInput` already preserves an edge from an earlier install when a later held-state input
  for the same tick follows.
- The cooldown / dash-spent strip (`:335-350`) moves from receive time to **install time**, so
  it is evaluated against the simulation state the input will actually meet. (The coordinator
  extraction later relocates this into the simulation; here it only moves within the
  coordinator.)
- `AcknowledgedInput` keeps meaning **received** — it advances in `SubmitInput`, as today,
  after Finding 3's changes. It must not move to install time: the client measures RTT from it
  (below), and an install-time acknowledgement would fold the client's own lead into its RTT
  estimate and run away.
- Detach and the neutral timeout clear the queue as well as calling `SetNeutralInput`.
- The determinism hash already includes `PredictedTick`; the clamped value is what it hashes.

**Client.**

- **RTT estimate**, with no wire change: `runtime.sentFrames` gains a `sentAt`
  (`performance.now()` at send — the existing `aimSentAt` is *not* that for frames whose aim
  did not change). On each snapshot, take one sample from the newest frame with
  `sequence ≤ acknowledgedInput`: `receivedAt - sentAt`. The sample includes up to one snapshot
  interval (50 ms) of server-side quantisation, which acts as a free safety margin. Keep a
  bounded window of 40 samples and use the 20th percentile, same discipline as `serverClock`.
  `serverClock` itself cannot yield RTT — its samples are offset and one-way latency
  confounded, in one direction.
- **Lead**: `leadTicks = ceil(rttP20 × tickRate / 1000) + 2`, clamped to `[3, 20]`, starting
  at 3 before the first sample. Changes are slewed at most one tick per 500 ms so the local
  clock never jumps; the lead survives a reconnect the way `serverClock` does.
- **Local tick**: `currentPredictedTick = serverTick + max(1, elapsedTicks) + leadTicks`
  (`useArenaConnection.ts:94`). The stamp on every sent frame is this value.
- **Pending pruning is by tick, not by acknowledgement.** Because the server applies an input
  at exactly its stamp when it arrives in time, `authority(S)` contains exactly the inputs with
  stamp `≤ S`. The client rebuilds from `authority(S)` and replays every pending interval with
  `toTick > S`; the newest interval is open-ended and is never pruned. The
  `sequence > acknowledgedInput` filters at `useArenaConnection.ts:386-390` and
  `arenaMath.ts:483` go. `acknowledgedInput`'s only remaining client use is the RTT sample and
  `sentFrames` pruning.
- **`reconcile` replays through the current local tick.** It takes a `throughTick` argument and
  extends the newest interval to it, so the local state after a reconcile is at
  `S + elapsed + lead`, monotonic across snapshots. `advanceLocalPresentation` then supplies
  the sub-tick remainder exactly as it does now.

**What the player sees.** Movement start: the client predicts from `T`, the input reaches the
server `margin` ticks before `T`, the server applies at `T`, the next snapshot agrees, no
correction. A late input (jitter spike beyond the margin) is applied at arrival `A > T`; the
snapshot shows `(A - T) × speed` less movement than predicted and a small correction absorbs it.
A runaway lead is bounded by the client cap (20 ticks) and the server clamp (30 ticks); worst
case degrades to today's behaviour with 500 ms of input buffering, which the Debug clamp log
makes diagnosable.

**Known residual.** A late *and already superseded* interval whose edge (fire/dash) the server
applies after `S` is pruned by tick on the client before authority shows the shot, so the
predicted projectile disappears for a few ticks and reappears from authority. Requires a jitter
spike and a second input inside one snapshot interval; accepted.

### This cannot be shipped without a latency harness

Nothing in the repository delays the socket. `DevClockSkewTimeProvider` shifts the snapshot
timestamp label; it does not simulate latency. Both the mechanism above and the failure mode
of the half-RTT fix are reasoning from the code. The scheduling plan therefore builds two
harnesses **first** and records a baseline on `main` before touching prediction:

1. A deterministic TypeScript harness (`arenaLatencyHarness.test.ts`) that runs `stepLocal` as
   a stand-in server applying inputs *L* ticks after the client stamps them, and the real
   `reconcile` + `advanceLocalPresentation` as the client, and reports per-tick correction
   magnitude and snap count for a scripted movement start/stop. This is the regression test.
2. A Development-only transport delay in `RealtimeGameEndpoint` (`Games:DevRealtimeDelayMs`,
   inbound and outbound, jitter optional), wired the way `Games:DevClockSkewMs` is, for
   playtesting in `docker-local`. `snapCount` is already in `ArenaRenderState`; it is the
   number to watch.
