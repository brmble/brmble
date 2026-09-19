# Arena Input Scheduling — Implementation Plan (latency harness + Finding 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the local player's movement is predicted correctly under real latency. The client
runs its local clock ahead of the server by measured RTT plus a margin; the server applies each
input at the tick the client stamped it with. A latency harness exists before any of that is
touched, and a baseline is recorded on `main` so the change has a number to beat.

**Spec:** `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`,
section *Finding 4 — Intended design*.

**Branch:** `feature/arena-input-scheduling`, created from `origin/main` **after**
`fix/arena-unconditional-acknowledgement` has merged. Confirm that merge before starting:
`git log origin/main --oneline | grep -i "unconditional"` or check the PR. If it has not
merged, stop.

**Do not** commit to `main`, push, or open a PR without asking.

## Read this first

- **Wire shape does not change.** RTT is measured from `acknowledgedInput`, which snapshots
  already carry. No new fields on any message (`arenaProtocol.ts` validators are arity-strict).
- **`AcknowledgedInput` means received, not installed.** This is load-bearing: the client's RTT
  estimate is taken from it. If you find yourself advancing it at install time, stop — that
  feeds the client's own lead back into its RTT estimate and the lead runs away.
- **Phases are ordered by risk.** Phase A (harness) and Phase B (baseline) change no product
  behaviour. Do not begin Phase C until Phase B's numbers are in the PR description.
- Both suites are needed: `dotnet test` from the root, `npm test` from `src/Brmble.Web`. A
  sandbox without .NET or without the rollup binary cannot verify this plan; say so early.
- `uiGuideCompliance > component code does not use emoji or glyph icons in UI text` is already
  red on `main` (`AdminChannelsSection.tsx:245`); do not fix it here.

## Files

| File | Change | Phase |
|---|---|---|
| `src/Brmble.Web/src/components/Games/Arena/arenaLatencyHarness.ts` | New | A — deterministic two-clock simulation |
| `src/Brmble.Web/src/components/Games/Arena/arenaLatencyHarness.test.ts` | New | A/B/C — regression numbers |
| `src/Brmble.Server/Games/Continuous/DevRealtimeTransportDelay.cs` | New | A — Development-only socket delay |
| `src/Brmble.Server/Games/Continuous/RealtimeGameEndpoint.cs` | Modify | A — apply the delay to reads (`HandlePayload` call site, `:151`) and writes (`RunWriterAsync`, `:224`) |
| `src/Brmble.Server/Program.cs` | Modify | A — `Games:DevRealtimeDelayMs`, `Games:DevRealtimeJitterMs`, next to `Games:DevClockSkewMs` (`:48-57`, `:143`) |
| `docker-local/docker-compose.yml` | Modify | A — commented example next to the skew one (`:44-56`) |
| `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs` | Modify | C — per-participant input queue, install-before-step, install-time strip |
| `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs` | Modify | C |
| `tests/Brmble.Server.Tests/Games/Continuous/ContinuousGameCoordinatorTests.cs` | Modify | C — scheduler-driven install ordering |
| `src/Brmble.Web/src/components/Games/Arena/inputLead.ts` | New | C — RTT estimator + slewed lead |
| `src/Brmble.Web/src/components/Games/Arena/inputLead.test.ts` | New | C |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts` | Modify | C — `sentAt`, RTT sample, lead in `currentPredictedTick` (`:94`), tick-based pruning (`:386-390`) |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx` | Modify | C |
| `src/Brmble.Web/src/components/Games/Arena/arenaMath.ts` | Modify | C — `reconcile(…, throughTick)` (`:477-530`), remove the ack filter (`:483`) |
| `src/Brmble.Web/src/components/Games/Arena/arenaMath.test.ts` | Modify | C — `'discards acknowledged sequences before replaying'` (`:132`) is now wrong by design |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts` | Modify | C — pass `throughTick` to `reconcile` (`:294`) |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.test.tsx` | Modify | C |
| `docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md` | Modify | C — one paragraph noting pending is now pruned by tick, with a pointer to this plan's spec |

## Phase A — Latency harness (no behaviour change)

### A1. Deterministic two-clock harness (TypeScript)

The point of this harness is that it needs no socket, no timers and no React: it is a loop over
integer ticks, so it can run in CI and its numbers are exact.

- [ ] `arenaLatencyHarness.ts` exports `runLatencyScenario(options)`:
      - `options`: `{ upTicks, downTicks, snapshotEveryTicks = 3, script, constants, leadTicks? }`
        where `script` is a list of `{ atClientTick, input }` changes to the held input.
      - **Server model:** the local player's authoritative state advanced with `stepLocal` (it is
        the client's mirror of the server's local-player stages and is what `reconcile` uses,
        so it is the right stand-in; no opponent, no projectiles). Inputs sent by the client at
        client tick `c` with stamp `T` **arrive** at server tick `c + upTicks` (client tick `c`
        is server tick `c` by construction in the harness; the lead is what separates the
        stamp `T` from `c`). Application policy is a parameter: `'onArrival'` (today) or
        `'atStamp'` (Phase C: install at `max(T, arrival)`, clamped to `arrival + 30`).
        Snapshots are generated every `snapshotEveryTicks` with the server's
        `acknowledgedInput` (= received) and arrive at the client `downTicks` later.
      - **Client model:** on each snapshot arrival, call the real `reconcile` with the pending
        list maintained exactly as `useArenaConnection` maintains it (newest interval one tick
        wide, extended on the next send; pruning policy a parameter: `'byAck'` today,
        `'byTick'` Phase C). Between snapshots, step the presented state one tick per client
        tick with the held input, as `advanceLocalPresentation` does. Send a frame on every
        held-state change and a heartbeat every 15 ticks. Stamp = `S_last + elapsed + leadTicks`.
      - **Output:** per client tick `{ tick, predictedX, authorityX, correctionMagnitude,
        snapped }`, plus totals `{ snapCount, maxCorrection, ticksUntilFirstMovement }` where
        the last is how many client ticks after the press the *displayed* position first
        advances and keeps advancing (no pullback for 6 consecutive ticks).
- [ ] `arenaLatencyHarness.test.ts`: a fixture scenario `press right at tick 30, release at
      tick 120` at `(up, down) ∈ {(0,0), (3,3), (6,6), (12,12)}` — 0, 100, 200, 400 ms RTT.
      Assert only the invariants that hold *today*: the run completes; totals are finite; at
      `(0,0)` `snapCount == 0` and `maxCorrection <= 90` (one tick of `Math.max(1, …)`
      quantisation is allowed; anything larger at zero latency is a harness bug). The numeric
      assertions come in Phase B.

### A2. Development-only transport delay (server)

Same pattern and same caveats as `DevClockSkewTimeProvider`: opt-in, Development only, pinned
to zero in Production by `Program.cs`, changes nothing when unset.

- [ ] `DevRealtimeTransportDelay` with `DelayMs` and `JitterMs`. Inbound: `await
      Task.Delay(delay)` after the read loop receives a frame and before `HandlePayload`.
      Outbound: **not** a delay inside the writer loop's dequeue — that serialises sends and
      collapses throughput to one message per delay. Instead, after the writer dequeues a
      message it stamps `dueAt = now + delay` and hands it to a bounded ordered channel; a
      second loop awaits `dueAt` then sends. Enforce monotonic `dueAt` so jitter cannot
      reorder. Coalescing in `RealtimeSnapshotMailbox` is unaffected because dequeue timing
      does not change.
- [ ] `Program.cs`: read `Games:DevRealtimeDelayMs` / `Games:DevRealtimeJitterMs` under
      `IsDevelopment()`, log the same style of warning as `:143`, register a null-object when
      zero.
- [ ] `docker-local/docker-compose.yml`: a commented block next to `Games__DevClockSkewMs`
      with the same "uncomment BOTH lines" instruction. Suggested default `50` delay, `10`
      jitter, i.e. ~100 ms RTT.
- [ ] `RealtimeGameEndpointTests`: one test that with the null-object nothing changes (same
      frames, same order), one that with a delay of 20 ms three snapshots written 5 ms apart
      arrive in order and ~20 ms late each rather than 20, 40, 60.

## Phase B — Baseline on current behaviour

- [ ] Run the harness with `application: 'onArrival'`, `pruning: 'byAck'`, `leadTicks: 0`
      (today's client) and record in the PR description, per RTT: `snapCount`,
      `maxCorrection`, `ticksUntilFirstMovement`. The spec predicts `ticksUntilFirstMovement
      ≈ up + down` and a pullback on every snapshot during that window. If the harness does
      **not** show that, stop and report — the spec's mechanism is wrong and Phase C's design
      rests on it.
- [ ] Run it with `leadTicks = (up + down) / 2` and everything else unchanged (the previous
      plan's half-RTT proposal). Record the same numbers. The spec predicts a snap at movement
      start from `(6,6)` upward. Whatever it shows, record it; this is the comparison that
      justifies Phase C's shape.
- [ ] Playtest once in `docker-local` with the transport delay at 50/10 on `main`, two
      clients, and note `snapCount` from `ArenaRenderState` after 60 s of ordinary movement.
      (If there is no visible readout for it, add a `console.debug` behind the existing
      dev-only guard rather than UI.)

## Phase C — Input scheduling

### C1. Server: queue, install before step, install-time strip

- [ ] `ParticipantInputState` gains `Queue<ContinuousInput> Scheduled` kept ordered by
      `(PredictedTick, Sequence)`. Inputs arrive in sequence order over an ordered socket and
      stamps are monotonic on a sane client, so a plain queue with an ordered insert fallback
      is enough; do not reach for a priority queue unless a test proves you need one.
- [ ] `SubmitInput`: after Finding 3's sanitisation, clamp `PredictedTick` into
      `[Simulation.Tick + 1, Simulation.Tick + 30]` (this **replaces** the `[-120, +30]`
      clamp for the tick component; the aim/move sanitisation is unchanged). Log at Debug when
      the clamp moved it, with the distance and direction. Enqueue instead of calling
      `SetInput`. Everything else in `SubmitInput` — budgets, aim-rate clamp, acknowledgement,
      neutral timer, `AcceptedGeneration` — stays at receive time.
- [ ] `RunSchedulerAsync` (`:661-690`): inside the per-tick lock, before `Step()`, call a new
      `InstallScheduled(state)` that for each participant dequeues every input with
      `PredictedTick <= Simulation.Tick + 1`, applies the **install-time strip** (the block at
      `:335-350`, moved here verbatim and evaluated against the simulation state now), and
      calls `SetInput`. Then `Step()`.
- [ ] `DetachAsync`, `NeutralizeIfStale`, `CompleteAsync`: clear `Scheduled` alongside
      `SetNeutralInput`.
- [ ] The `Cooldown`/`DashSpent` bookkeeping (`CooldownUntilTick`, `DashSpent`,
      `RoundGeneration`) moves with the strip to install time. `AimX/AimY` tracking for the
      aim-rate budget stays at receive time (it is a message-rate concern, not a simulation
      one).
- [ ] Tests:
      - `ScheduledInput_IsInstalledAtItsStampNotOnArrival`: stamp `tick + 5`, step 4 ticks,
        assert the fake simulation has not seen it; step 1 more, assert it has.
      - `LateInput_IsInstalledOnTheNextStep`: stamp `tick - 3`, assert installed at `tick + 1`.
      - `FarFutureInput_IsClampedToThirtyTicks`.
      - `EdgeSurvivesAHeldStateInputForTheSameTick`: fire at stamp `t`, held-state at stamp
        `t` with a later sequence; after install the simulation's input has `FireReleased`.
      - `CooldownStrip_IsEvaluatedAtInstallTime`: a fire stamped 30 ticks ahead, received
        while cooldown has 5 ticks left, must **not** be stripped (cooldown will have ended by
        then). This is the test that fails if the strip is left at receive time.
      - `Acknowledgement_AdvancesOnReceiptNotInstall`.
      - `Detach_ClearsScheduledInputs`.
      - Determinism: `ArenaDeterminismTests` must still pass unchanged — the hash includes
        `PredictedTick`, and the clamp is deterministic.

### C2. Client: RTT, lead, local tick

- [ ] `inputLead.ts`: `createInputLead({ tickRate, windowSize = 40, marginTicks = 2, min = 3,
      max = 20, slewMs = 500 })` with `sample(rttMs, nowMs)`, `leadTicks(nowMs)` (slewed),
      `rttP20Ms`. Same bounded-window shape as `serverClock.ts`.
- [ ] `inputLead.test.ts`: percentile selection; slew never moves more than one tick per
      `slewMs`; clamps; starts at `min` before any sample; a single outlier sample does not
      move the lead.
- [ ] `useArenaConnection.ts`:
      - `sentFrames` entries gain `sentAt: performance.now()` at send (`:149`).
      - On snapshot: sample RTT once from the newest frame with `sequence <= acknowledgedInput`
        (`receivedAt` is `Date.now()` at `:372`; use `performance.now()` captured at the same
        point for the subtraction — do not mix clocks).
      - `currentPredictedTick` adds `lead.leadTicks(now)`.
      - Pending pruning on snapshot becomes `toTick > serverTick || isNewest` (`:386-390`).
        `sentFrames` pruning stays by acknowledgement.
      - The lead instance lives in a ref beside `serverClockRef` with the same "never
        reassigned inside the effect" discipline (see the comment at `:107-116`).
- [ ] `arenaMath.ts` `reconcile`: add `throughTick: number`; drop the
      `sequence > acknowledgedInput` filter; treat the newest interval as covering
      `[fromTick, throughTick]`. Keep `fromTick > toTick` empty-interval semantics for
      edge-only frames.
- [ ] `useArenaState.ts` (`:294`): pass `throughTick = authority.serverTick + elapsedTicks +
      leadTicks`. The hook does not know the lead today; expose it from `useArenaConnection`
      alongside `serverClock` rather than recomputing it.
- [ ] Rewrite `arenaMath.test.ts` `'discards acknowledged sequences before replaying'`
      (`:132`) as `'prunes replay by tick, not by acknowledgement'`: an interval with
      `sequence <= acknowledgedInput` but `toTick > serverTick` **is** replayed.
- [ ] `useArenaConnection.test.tsx`: stamps include the lead; a snapshot with
      `acknowledgedInput = n` yields one RTT sample equal to the fake clock distance; pruning
      keeps an acknowledged-but-future interval.
- [ ] `useArenaState.test.tsx`: the sequencing tests that assert exact predicted ticks are
      updated for the lead; add one that a reconcile leaves the presented tick at
      `S + elapsed + lead` rather than `S`.

### C3. Harness numbers after the change

- [ ] Run the harness with `application: 'atStamp'`, `pruning: 'byTick'`, `leadTicks = up +
      down + 2`. Assert, and record in the PR description next to the Phase B baseline:
      - `(0,0)`, `(3,3)`, `(6,6)`, `(12,12)`: `snapCount == 0`, `maxCorrection <= 90` (one
        tick of base movement — the tick quantisation in `currentPredictedTick` plus the 50 ms
        acknowledgement quantisation in the RTT estimate), `ticksUntilFirstMovement == 0`.
        These are targets derived from the spec, not measurements: if one does not hold, find
        out why before loosening it, and record the reason next to the number.
      - A jitter scenario: one input arrives `margin + 3` ticks late. `snapCount == 0`,
        `maxCorrection == 3 × 90`, and the correction is fully absorbed within two snapshots.
      - A runaway-lead scenario: `leadTicks = 40` against `(3,3)`. Inputs are applied at
        `arrival + 30`; the run completes, `snapCount` is bounded (record it), and it is
        strictly worse than the correct lead — this is the test that the server clamp
        degrades gracefully rather than the test that it is good.
- [ ] Playtest in `docker-local` with the transport delay at 50/10, same 60 s protocol as
      Phase B. Record `snapCount` and the subjective note. Then once at 150/30 (≈300 ms RTT,
      lead at the 20-tick cap) and confirm it is playable, not that it is good.

### C4. Docs

- [ ] `docs/superpowers/specs/2026-09-01-arena-local-reconciliation-design.md`: add a short
      "Superseded detail" note under *Local deterministic state* — pending is pruned by tick
      and the client runs ahead by a measured lead; link to this plan's spec.

## Verification commands

From the repo root:

```powershell
dotnet test
```

From `src/Brmble.Web`:

```powershell
npm test
```

## Environment note

Phase A2, B's playtest and C3's playtest need Docker on a developer machine. Phases A1, B's
harness runs and C2 need only `npm test`; C1 needs only `dotnet test`. Plan the hand-offs
accordingly and say early if you cannot run one of the suites.
