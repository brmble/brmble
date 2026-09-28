# Realtime Acknowledgement and Latency — Second-Opinion Review

**Reviewed:** `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`,
`docs/superpowers/plans/2026-09-13-realtime-acknowledgement-and-latency.md`, against `main` at
`2f89650e` (PR #650 merged). Line anchors below are against that commit.

**Short version.** Finding 3 is real and Option A is the right call, but the spec misdescribes
how the cascade happens, picks the wrong realistic trigger for `InvalidRange`, and rests one
argument on a premise the simulation contradicts. Finding 4 identifies a real symptom, but the
mechanism is under-analysed and the proposed fix (add half RTT to `predictedTick`) does not
address it and may make it worse. Phase 1 can go ahead with the corrections in §1; Phase 2
should be re-scoped rather than executed as written (§2). §3 is about the coordinator as a base
for the next realtime game, which is the larger question behind PR 646.

---

## 1. Finding 3 — rejected input cascades into a reconnect

### 1.1 The conclusion is right; the mechanism is stated wrong

The spec says a rejection leaves the client's next input at *n+1* against an unchanged
acknowledgement, so the server reads `SequenceGap`. That is not what the client does. On a
non-fatal `inputRejected` for the **newest** sequence, `useArenaConnection.ts:405-412` rewinds
`nextSequence` to the rejected sequence and drops it from `pendingInputs`, so the next frame
reuses the number and no gap forms. This is pinned by
`'rewinds a rejected newest sequence without creating a sequence gap'` (`useArenaConnection.test.tsx:448`).

The cascade only fires when the rejection arrives **after a later frame has already been
sent** (`:405` → `scheduleReconnect()`), pinned by
`'reconnects when a rejected sequence already has later frames'` (`:530`). So it is a race
between server round-trip and client send cadence. While the mouse moves the client sends aim
frames every 40 ms; any RTT above ~40 ms therefore loses the race almost every time. The
finding stands in practice, but the doc should say "in-flight race, lost on any real network"
rather than "always", because it changes what a fix must prove: a test where the rejection is
answered synchronously will pass today and proves nothing.

`inputRejected` is also `Coalescible: true` (`RealtimeGameEndpoint.cs:214`), so a burst of
rejections collapses to the latest — which, incidentally, is what makes the rewind path work
at all when two rejections are queued.

### 1.2 `InvalidRange` — the realistic trigger is server tick starvation, not a backgrounded tab

The spec's example (backgrounded tab, GC pause on the client) is speculative: the client's
`predictedTick` is `serverTick + wall-clock elapsed since the last snapshot`
(`useArenaConnection.ts:94`), and WebSocket messages keep arriving in a background tab, so the
stamp tracks the server to within one-way latency regardless of render throttling.

The path that *does* exist is on the server. `FixedStepScheduler.PlanCycle` catches up at most
`MaxCatchUpTicks = 5` per cycle and then **forgives the debt** (`FixedStepScheduler.cs:53-56`
sets `NextDeadline = now`). Under any stall — GC, lock contention of the kind PR 650 fixed, a
busy box — server tick time falls behind wall time. The client keeps stamping from wall time, so
after a stall longer than 30 ticks (500 ms) every input it sends until the next snapshot lands
is past `serverTick + 30` and is rejected. Then §1.1 applies and the player reconnects.

This matters for two reasons. It is the case where clamping actually buys something, so it
should be the example in the spec and the shape of the regression test. And it means
`InvalidRange` correlates with server load — exactly when you least want reconnect storms.

### 1.3 "Inputs are full state snapshots, so skipping one loses nothing" — not true for edges

`ArenaSimulation.SetInput` (`ArenaSimulation.cs:87-95`) latches `FireReleased` and `Dash` with
OR until `Step` consumes them; `ProcessDashEdges`/`ProcessFire` then clear them. Held state
(move, aim, charging) is a snapshot; fire and dash are one-shot edges. Skipping a sequence that
carried a fire loses the shot.

This does **not** change the recommendation — WebSocket is ordered, so a gap can only come from
a previous rejection (which Phase 1 removes) or a client bug — but the justification in the
spec should be corrected, and the Option A wording should be "a gap can only be self-inflicted,
and after this change it cannot be," not "nothing is lost."

### 1.4 The per-reason table — semantics to pin down before implementing

| Reason | Spec says | Recommendation |
|---|---|---|
| `InvalidRange` (tick) | clamp into `[-120, +30]` | The server never uses `PredictedTick` except for this check and the determinism hash (`ArenaSimulation.cs:167`). Clamping and passing through are behaviourally identical for the simulation; the only observable difference is the hash. Either is fine — but the plan's test "the clamped value is what the simulation sees" asserts something with no gameplay consequence. Say so in the test name, or drop the tick bound entirely and keep only the malformed checks. |
| `InvalidRange` (aim) | "normalise out-of-range axes" | An aim of `(0,0)` cannot be normalised (`IsInRange` requires `aimSquared > 0`, `:808`). Substitute the last accepted aim (`participant.AimX/AimY`), which is exactly what the aim-rate clamp already does at `:362`. Over-length move/aim vectors: scale down. |
| `InvalidRange` (heartbeat with fire/dash) | keep rejecting | Agree. That is a client bug, not drift. |
| `RateLimited` | acknowledge, discard | Prefer **acknowledge, apply held state, strip edges** — the same reasoning as the aim-rate comment at `:355-361`. Rate limiting is about message volume; applying the held state of an over-budget message costs nothing and stops the character freezing. Note the residual cost either way: an ack that says "applied" for an input whose fire was stripped makes the client's predicted projectile vanish. That is fine under abuse but should be stated. |
| `StaleSequence` | open | Option A: ignore silently. Keep the `LogInformation` so a confused client is still visible server-side — that recovers most of what Option A gives up. |
| `SequenceGap` | open | Option A: advance to the received sequence and apply it. |

Once A is in, the client's `staleSequence`/`sequenceGap` branch (`useArenaConnection.ts:400-403`)
can never be reached by this server. Leave it for now (client and server ship together anyway)
and remove it with the orchestrator extraction; don't let it linger as a "defensive" path with no
test that can reach it.

### 1.5 Plan nits

- Test counts: `ContinuousInputTests` has **2** `SequenceGap` references, not 3.
- The "confirm the mutation actually applied" guidance is good; add "and confirm the rejection
  arrives *after* a later frame was sent" to the client-side test, per §1.1.
- The `game.ended` event at `ContinuousGameCoordinator.cs:516` hardcodes
  `gameType = "arena-knockoff", format = "bo3", rulesetVersion = 1`. Out of scope for this
  change, but it is a landmine for game #2 (§3).

---

## 2. Finding 4 — `predictedTick` has no latency term

### 2.1 What the server actually does with `PredictedTick`

Nothing. `SetInput` latches the input at **arrival**; `Step` reads `player.Input` on the next
tick. `PredictedTick` is range-checked and hashed and otherwise ignored. So any change to how the
client stamps inputs changes **only the client's replay window**, never when the server applies
the input. The spec does not say this, and the proposed fix only makes sense if it were otherwise.

### 2.2 What the client's replay actually does today

Trace one held-movement press with symmetric one-way latency *L* ticks (RTT = 2*L*):

1. Client stamps the input `T = S_last + elapsed`, which lags the server's present by *L*.
2. The new pending interval is `fromTick = toTick = T` — **one tick wide** — and only widens to
   `nextStamp - 1` when the *next* frame is sent (`useArenaConnection.ts:150-155`). With a key
   held and the mouse still, the next frame is the heartbeat, 250 ms away.
3. Each snapshot that arrives before the ack has `serverTick ≥ T` almost always (stamps lag the
   server). `reconcile` then hits `if (interval.toTick <= serverTick) continue`
   (`arenaMath.ts:498`) or the clamp at `:497`, and replays **nothing**.
4. The local state after every reconcile is therefore `authority(S)` plus whatever
   `advanceLocalPresentation` adds from `presentedAt` — at most one snapshot interval, three
   ticks, 270 units at base speed.

So client-side prediction never gets more than ~3 ticks ahead of authority. At movement start
the server has not moved yet, so each snapshot pulls the local player back by up to 270 units,
blended over 100 ms, for the full RTT. The player sees ~RTT of "running in place" before the
character goes. That is the soft-controls feel the spec describes, and it is structural, not a
small systematic bias. The doc's *symptom* is right; "replays slightly less movement" undersells
it.

### 2.3 Why "add half RTT" is not the fix

Moving the stamp to `S_last + elapsed + RTT/2` puts `T` at roughly the server's present. Now
snapshots generated in `(P, P+L)` — after the press, before the server has applied it — **do**
replay up to *L* ticks of movement, so the local player runs ahead of authority. When the ack
lands, authority (which started moving at `P+L`) is *L* ticks behind the prediction, and the
correction is `L × 90` units. At 100 ms RTT that is 540 units, above the 300-unit snap threshold
(`arenaMath.ts:525`, `90_000n`). Expect a **snap on every movement start** at ordinary internet
latency, replacing today's mush with a visible hitch. It might be tuned around with the 1-tick
`toTick` quirk in §2.2 masking most of the replay, but that is luck, not design.

The underlying issue is that the client applies inputs immediately at local tick `T` while the
server applies them at `T + RTT`, and nothing in the protocol reconciles those two times. The two
coherent designs are:

- **(a) Client runs ahead; server applies at the stamped tick.** Client tick =
  estimated server tick + one-way uplink + margin. Server queues inputs by `PredictedTick` and
  applies each at that tick (late arrivals apply immediately). The range window becomes a
  dejitter window. This is the standard model and the only one in which `predictedTick` earns
  its name. It is a server behaviour change with no wire-shape change.
- **(b) Server applies at arrival (as now); client models that.** Intervals start at
  `stamp + RTT`; the client steps the previous input across the gap. Removes the pullback but
  reintroduces RTT of local input latency, which the 2026-08-27 revision design explicitly
  rejects ("a brawler that ships with visible input latency reads as broken").

(a) is the one to design for. Phase 2 as written is neither, and should be reframed as "design
(a)" rather than a two-line change to `currentPredictedTick`.

### 2.4 RTT does not "fall out of" `serverClock`

`serverClock.observe` samples `serverSentAt - clientReceivedAt`, which is `offset - oneWay` —
offset and latency confounded, one direction only. You cannot get RTT from it. What you can get
RTT from, today, with no wire change: `runtime.sentFrames` already records `aimSentAt` per
sequence, and every snapshot echoes `acknowledgedInput`. RTT ≈ receipt time of the first
snapshot with `ack ≥ sequence` minus that sequence's send time, minus up to one snapshot
interval (50 ms) of quantisation. Take a low percentile over a bounded window, as the offset
does.

### 2.5 There is no latency harness, and Phase 2 must not ship without one

`DevClockSkewTimeProvider` simulates clock skew, not latency; nothing in the repo delays the
socket. Both §2.2 and §2.3 are reasoning from the code, and the whole point of Finding 4 is
behaviour that only shows up under latency. Before any Phase 2 work: `tc netem` on the server
container in `docker-local` (delay 50 ms ±10 ms each way is enough), or a delaying fake socket
in the connection tests. Measure snap count and correction magnitude at movement start on
`main` first, so the fix has a number to beat.

---

## 3. The coordinator as a base for the next realtime game

The seam between the duel layer and the runners is good. `DuelOrchestrator` → 
`DuelMatchRunnerRouter` → runners keyed by `RunnerKey` (`"discrete"` → `GameSessionManager` +
`IGameEngine`; `"continuous"` → `ContinuousGameCoordinator` + `IContinuousGameDefinition`) is a
clean shape, and the discrete side is a model of how to do it — `IGameEngine.SpectatorView` with
no default implementation is exactly the right kind of forcing function.

The continuous side has the interfaces but the coordinator bypasses them. Concrete arena
dependencies in `ContinuousGameCoordinator.cs` on `main`:

| Where | What |
|---|---|
| `StartAsync` (`:90-96`) | `"arena-knockoff"` canonical-config check inline |
| `AttachParticipantAsync` (`:181`) | `ArenaRulesetV1.TickRate/SnapshotRate` and the literal welcome constants `100, 50, 250, 750, 5000` |
| `AcknowledgeAttach` (`:211-213`) | `is ArenaSimulation arena` → `MarkParticipantReady` |
| `SubmitInput` (`:312-320`, `:335-350`, `:377`) | `is ArenaSimulation` for player lookup and round generation; cooldown and dash-spent stripping; `ArenaRulesetV1.ShotCooldownTicks` |
| `CompleteAsync` (`:516`) | `game.ended` hardcodes `gameType`, `format`, `rulesetVersion` |
| `RunSchedulerAsync` (`:663`, `:678`) | `ArenaRulesetV1.TickRate/MaxCatchUpTicks/SnapshotEveryTicks` |
| `ParticipantView` (`:740`) | `is not ArenaSnapshotView` → session-id rewrite |
| `CreateParticipants` (`:877`) | `is ArenaSimulation` to seed aim |
| `ContinuousInput` | the wire shape *is* the arena's input (move/aim/charging/fire/dash) |
| `ContinuousRejectReason` | `Cooldown`, `DashSpent` are never returned since the strip path — dead members |

None of this is wrong for one game. All of it is what a second game trips over. The extraction
the spec alludes to should, at minimum:

1. Move per-game input admission behind the simulation: something like
   `ContinuousInput Admit(long sessionId, ContinuousInput input)` on `IContinuousSimulation`
   that returns the stripped input, so cooldown/dash/aim policy lives with the rules that define
   them. Phase 1 makes this easier — once the coordinator only refuses at connection level,
   everything game-specific *is* a strip.
2. Move tick rate, snapshot cadence, catch-up budget and the welcome tuning constants onto
   `IContinuousGameDefinition`.
3. Replace the `is ArenaSimulation` casts with interface calls (`MarkReady`, a
   `RemapSessionIds` hook or a coordinator-level rewrite that doesn't need the concrete view
   type).
4. Fix `game.ended` to read from the reservation, like `game.started` already does.
5. Decide whether `ContinuousInput` is generic ("N axes + M buttons + edges") or per-game
   opaque. Either works; the current shape is arena-specific with a generic name.

The client has the mirror-image problem: everything under `components/Games/Arena/` is
arena-named, but ticket/welcome/sequencing/heartbeat/clock in `useArenaConnection` and the
authority timeline in `useArenaState` are generic. Splitting a `useRealtimeConnection` out is
the client-side counterpart, and cheaper to do before there are two consumers.

---

## 4. Recommended order

1. **Phase 1 with Option A**, with the semantics in §1.4 (strip-not-discard for `RateLimited`;
   last-aim substitution for zero aim; tick clamp or drop, either). Add a regression test shaped
   like §1.2: stall the server clock past 30 ticks, send inputs, assert acknowledged + applied.
2. **Build the latency harness** (§2.5) and measure `main`.
3. **Re-scope Phase 2** as design (a) in §2.3, with RTT from `sentFrames`/`acknowledgedInput`
   (§2.4). This is a spec, not a checkbox.
4. **Coordinator extraction** (§3) before any second continuous game is started, not after.
