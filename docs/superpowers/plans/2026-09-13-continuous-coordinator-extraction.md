# Continuous Coordinator Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ContinuousGameCoordinator`, `RealtimeGameEndpoint` and the client's realtime
connection know nothing about Arena. Every game-specific decision lives behind
`IContinuousGameDefinition` / `IContinuousSimulation` on the server and behind the Arena hooks
on the client. Behaviour does not change; a test proves the namespace boundary.

**Spec:** `docs/superpowers/specs/2026-09-13-continuous-coordinator-extraction-design.md`.

**Branch:** `refactor/continuous-coordinator-extraction`, created from `origin/main` **after
both** `fix/arena-unconditional-acknowledgement` and `feature/arena-input-scheduling` have
merged. Verify both before starting; if either has not, stop. The install-time `Admit` in
Task 3 assumes the input queue from the scheduling plan exists.

**Do not** commit to `main`, push, or open a PR without asking.

## Status (2026-09-22)

Implemented on `refactor/continuous-coordinator-extraction`, stacked on
`feature/arena-input-scheduling`. Both suites green (`dotnet test` 1132 + 438, `npm test`
2591). Deviations from the tasks below, each deliberate:

- **Hash fixture:** `RecordedFinalHash = 0x6E117D823928FE4D`, recorded at `e5828bec` and
  reproduced at the branch head and after every commit since. The determinism stream does
  not go through `Admit`, so the fixture guards the simulation, not admission.
- **Defaults on the interfaces:** `IContinuousGameDefinition.Timing` and
  `ValidateConfiguration`, and `IContinuousSimulation.MarkParticipantReady`, `InitialInput`
  and the wire-id-mapped `ParticipantSnapshot` overload have default implementations so
  the eleven test fakes did not each need five one-liners. `Admit` has none, as the spec
  requires. The mapped `ParticipantSnapshot` default delegates to the unmapped one, which
  is right only for a snapshot that carries no session identity - the doc comment says so.
- **Task 3, commit 2 (prove or keep the duplication):** proven **not** redundant, kept.
  `ArenaAdmissionTests` runs the same stream through `Admit` and straight into `SetInput`
  and gets different outcomes in two ways: `Admit` is evaluated before the step decrements
  the timers, so it strips a shot on the last cooldown tick that the step itself would
  have fired; and `AdmissionCooldownUntilTick` starts on every admitted fire, including an
  under-charged release `ProcessFire` refuses without starting a cooldown, so the next
  release inside that window is stripped and the banked charge survives where the
  simulation would have cancelled it. Both were the coordinator's behaviour before the
  move; the doc comment on `Admit` states them. The plan's suggested case (a fire during
  a real cooldown while charging) does not distinguish the two: the step zeroes the charge
  during a cooldown regardless. The dash clause is equivalent to `DashAvailable` as far as
  the tests can tell and was left alone.
- **Task 5:** done. `Realtime/useRealtimeConnection.test.tsx` drives the generic hook
  through a made-up codec (one axis, a held button, one edge, a direction pair): 25 cases.
  `useArenaConnection.test.tsx` keeps the 11 the arena codec adds (wire shape, aim
  throttle, fire/dash carrying the true aim). `realtimeBoundary.test.ts` pins that
  `Realtime/` imports nothing from a game folder.
- `SpectatorSnapshot()` kept its signature: nothing calls it outside the arena and the
  test fakes.
- `arenaClientLatency.test.tsx` runs the real `useArenaConnection` + `useArenaState`
  against a simulated stamp-applying server at 0/50/100 ms one-way and asserts the local
  player never steps backwards while holding a direction. It belongs to the scheduling
  plan's Phase C but landed here because it needed the split hook.

## Read this first

- **This is a refactor.** Every task must leave `dotnet test` and `npm test` green with the
  same tests passing (renamed where code moved). If a test *has* to change its assertion, that
  is a behaviour change and needs to be called out in the commit and justified against the
  spec.
- **Determinism is the safety net.** `ArenaDeterminismTests` and the `DeterministicHash` must
  produce identical hashes for identical input streams before and after every task that
  touches `ArenaSimulation`. Capture a hash fixture in Task 0 and assert against it at the end.
- Line anchors are against `2f89650e` and will have drifted after the two prerequisite merges.
  Use them to find the site, then read the current code.
- `uiGuideCompliance > component code does not use emoji or glyph icons in UI text` is already
  red on `main`; do not fix it here.

## Files

| File | Change |
|---|---|
| `src/Brmble.Server/Games/Continuous/ContinuousContracts.cs` | `ContinuousTiming`, new interface members, dead enum members removed |
| `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs` | All sites in the spec's leak table |
| `src/Brmble.Server/Games/Arena/ArenaGameDefinition.cs` | `Timing`, `ValidateConfiguration` |
| `src/Brmble.Server/Games/Arena/ArenaSimulation.cs` | `MarkParticipantReady` already exists; add `Admit`, session-id-mapped snapshots, per-player dash reservation |
| `src/Brmble.Server/Games/Arena/ArenaModels.cs` | Player state for the moved bookkeeping |
| `tests/Brmble.Server.Tests/Games/Continuous/*.cs` | Fakes implement the new members; tests move with the code |
| `tests/Brmble.Server.Tests/Games/Arena/*.cs` | `Admit` tests; hash fixture |
| `tests/Brmble.Server.Tests/Games/Continuous/ContinuousBoundaryTests.cs` | New — the namespace-boundary test |
| `src/Brmble.Web/src/components/Games/Realtime/useRealtimeConnection.ts` | New — split from `useArenaConnection.ts` |
| `src/Brmble.Web/src/components/Games/Realtime/serverClock.ts`, `inputLead.ts` | Moved |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts` | Becomes a thin Arena-typed wrapper, or is deleted if the wrapper is one line |
| `src/Brmble.Web/src/components/Games/Arena/useArenaState.ts` | Consumes the generic hook |
| `src/Brmble.Web/src/components/Games/Arena/*.test.*` | Move with the code |

## Tasks

### 0. Fixtures

- [x] Add `ArenaDeterminismTests.HashFixture_MatchesRecordedValue`: a scripted 600-tick input
      stream for both players (movement, charge, fire, dash, one knockout) and the resulting
      `DeterministicHash`, recorded once. This is the guard for every later task.
- [x] Add `ContinuousBoundaryTests`: fails if any `.cs` under `Games/Continuous/` contains
      `Arena` outside a `using` that is itself flagged, i.e. the test greps the source tree
      (the test project already has the repo path for similar checks — reuse whatever
      `uiGuideCompliance` does on the web side, or `Directory.GetFiles` from the solution
      root). Mark it `[Fact(Skip = "Task 6")]` for now and un-skip it in Task 6.

### 1. Timing and configuration move to the definition

- [x] `ContinuousTiming` record in `ContinuousContracts.cs`; `IContinuousGameDefinition.Timing`
      and `ValidateConfiguration`. `ArenaGameDefinition` returns
      `(60, 3, 5, 100, 50, 250, 750, 5000)` and the canonical check moved verbatim from
      `StartAsync` `:90-96`.
- [x] Coordinator: `StartAsync` calls `definition.ValidateConfiguration`;
      `AttachParticipantAsync` `:181` and `RunSchedulerAsync` `:663`, `:678` read
      `state.Definition.Timing`. `NeutralTimeout` and `ReconnectGrace` statics become
      per-match from `Timing` (`:41-43`).
- [x] `CompleteAsync` `:516`: `game.ended` reads `state.Reservation.Configuration` exactly as
      `game.started` does at `:117-125`. Add a test that the two events carry the same
      `gameType`/`format`/`rulesetVersion`/`options` for the same match.
- [x] Tests green; hash fixture unchanged (nothing in the simulation moved).

### 2. Casts become interface calls

- [x] `IContinuousSimulation.MarkParticipantReady(long)`. `AcknowledgeAttach` `:211-213` calls
      it unconditionally on every simulation. `ArenaSimulation` already has the method.
- [x] `ParticipantSnapshot` / `SpectatorSnapshot` take `wireSessionIds`. `ArenaSimulation`
      applies the map to `Players[].SessionId` and `Projectiles[].OwnerSessionId` — the exact
      rewrite from `ParticipantView` `:740-757`, moved. Coordinator's `ParticipantView` becomes
      a pass-through. Add the same map to the spectator path and confirm `SpectatorService`
      was not relying on unmapped ids (it should not be; check its tests).
- [x] `CreateParticipants` `:877`: the aim seed exists so the aim-rate budget's "changed?"
      comparison starts from the true initial aim. Replace with a
      `ContinuousInput InitialInput(long sessionId)` on the simulation, and have the
      coordinator initialise its direction-tracking from that. (Alternative: track "changed"
      against the *last submitted* input only, and accept that the first frame always counts
      as a change — simpler, one budget unit, and probably what should have been done. Pick
      one, say which, and pin it.)
- [x] Tests green; hash fixture unchanged.

### 3. Admission moves into the simulation

This is the only task that touches gameplay-adjacent code. Do it in two commits.

- [x] **Commit 1 — move, do not change.** `IContinuousSimulation.Admit(long, ContinuousInput)`
      with no default. `ArenaSimulation.Admit` contains the strip block from the coordinator's
      install step (post-scheduling-plan location; originally `:335-350`) *verbatim*, reading
      cooldown from `player.CooldownTicks` plus a per-player `CooldownUntilTick` and the
      per-round `DashSpent`/`RoundGeneration` moved onto `ArenaPlayerState`. The coordinator's
      install step calls `Admit` then `SetInput`. Delete `CooldownUntilTick`, `DashSpent`,
      `RoundGeneration` from `ParticipantInputState`. Hash fixture unchanged; the
      `ContinuousInputTests` that pin stripping (`RefusedAction_…`, `RefusedDash_…`,
      `ActionValidation_…`, `Arena_DashReservationRemainsSpentUntilAuthoritativeRoundReset`)
      move to `ArenaCombatTests` or a new `ArenaAdmissionTests` and pass unchanged against
      `Admit` directly.
- [x] **Commit 2 — prove or keep the duplication.** `ProcessFire` already refuses a fire during
      cooldown and `ProcessDashEdges` already refuses a dash when `!DashAvailable`. Write the
      test that would distinguish "strip in `Admit`" from "let the simulation refuse": a fire
      arriving during cooldown while charging — does the charge get cancelled (`refused`
      branch, `ProcessFire`) or preserved (strip)? Whichever the current behaviour is, keep it,
      and either delete the now-provably-redundant part of `Admit` or leave a comment stating
      precisely which case makes it non-redundant. Do not guess.
- [x] Remove `PhaseDenied`, `Cooldown`, `DashSpent` from `ContinuousRejectReason`. Grep the
      client for the camelCase strings; they should only appear in the type union in
      `arenaProtocol.ts`, which is updated too.

### 4. Input shape and the direction budget

- [x] In `ContinuousContracts.cs`, document `ContinuousInput` as the continuous wire input and
      add two static helpers the coordinator uses instead of naming fields: `HeldOnly(input)`
      (edges cleared) and `DirectionChanged(a, b)` (the aim pair). Replace every
      `FireReleased`/`Dash`/`AimX`/`AimY` mention in the coordinator with them. Rename
      `AimChangeTimestamps` → `DirectionChangeTimestamps` and the constant accordingly. The
      client test `'stays under the server aim-change budget'` keeps its name — it is about
      Arena's client.
- [x] `RealtimeGameEndpoint.HandlePayload` `:186-199` still parses the fixed field set; that is
      fine (it is the wire), but it must not reference anything under `Games.Arena`. Check.

### 5. Client split

- [x] Create `components/Games/Realtime/`; move `serverClock.ts`, `inputLead.ts` and their
      tests. Extract `useRealtimeConnection<TWelcome, TSnapshot, TClosed>({ matchId, enabled,
      parse })` from `useArenaConnection.ts` with everything that is not Arena: ticket,
      socket lifecycle, welcome/attachAck, sequencing, heartbeat, pending intervals, RTT
      sample, lead, clock, reconnect, `inputRejected` for the two connection-level reasons
      only. Delete the `staleSequence`/`sequenceGap` branch and its two tests
      (`'rewinds a rejected newest sequence…'` stays — that is the rewind path for the
      surviving malformed-heartbeat rejection; `'reconnects when a rejected sequence already
      has later frames'` stays for the same reason).
- [x] `useArenaConnection` becomes `useRealtimeConnection` specialised with
      `parseServerMessage` and the Arena types. If that is one line, delete the file and update
      the imports; otherwise keep it as the one-line wrapper.
- [x] Move `useArenaConnection.test.tsx` cases that test generic behaviour to
      `useRealtimeConnection.test.tsx`; the Arena-specific ones (aim throttle, fire/dash
      carry the true aim) stay.
- [x] `npm test` green with the same number of tests minus the two deleted (plus one: the arena wire-shape case).

### 6. Boundary

- [x] Un-skip `ContinuousBoundaryTests`. It must pass. If it does not, the failing file is the
      remaining leak — fix it, do not exempt it.
- [x] Add the web-side equivalent to `uiGuideCompliance`'s neighbourhood: no import from
      `components/Games/Arena/` inside `components/Games/Realtime/`.
- [x] `dotnet test` and `npm test` green. Hash fixture unchanged.

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

No Docker, no playtest. Both suites are required; say early if you cannot run one.
