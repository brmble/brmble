# Realtime Acknowledgement — Implementation Plan (Finding 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a refused input never costs the player their connection. The coordinator refuses at
the connection level only; everything else is acknowledged, with game-level refusal expressed
by stripping or substituting fields.

**Spec:** `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`,
section *Finding 3*. All decisions are made; there is nothing to ask before starting.

**Branch:** `fix/arena-unconditional-acknowledgement`, already created from `origin/main`
(it is empty). Do not commit to `main`. Do not push or open a PR without asking.

**Scope:** server only. `dotnet test` covers all of it. Finding 4 is a separate plan
(`2026-09-13-arena-input-scheduling.md`) and starts after this one merges.

## Read this first

- **Wire shape does not change.** No new fields on any message. The arena snapshot validator
  is arity-strict (`arenaProtocol.ts`, `objectWithKeys`); adding a field is a breaking change.
- **Rate limiting must not weaken.** A rate-limited message is still counted against the
  budget; only the punishment changes. Prove it with a test that counts what reaches the
  simulation.
- **Do not touch `ContinuousRejectReason`'s members.** Removing `Cooldown`/`DashSpent` (which
  are already never returned) belongs to the coordinator extraction.
- **Sequential guards shadow each other.** `SubmitInput` has ~8 guards in sequence
  (`ContinuousGameCoordinator.cs:289-378`); a test only pins the one that happens to fire.
  Mutation-verify one guard at a time, each with an input constructed to clear every preceding
  guard, and **confirm each mutation actually applied** — a find-and-replace that matched
  nothing yields a green run that proves nothing.
- The correct mental model of the bug is a **race** (spec, *Mechanism (corrected)*). A client
  test that answers a rejection synchronously exercises the rewind path and proves nothing
  about the cascade. No client tests are needed in this plan; if you add one, it must send a
  second frame before the rejection arrives.

## Files

| File | Change | Responsibility |
|---|---|---|
| `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs` | Modify | `SubmitInput` (`:274-386`), `Reject` (`:798`), `IsInRange` (`:808`) |
| `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs` | Modify | Pins the current rejection contract: 9 `InvalidRange`, 5 `RateLimited`, 2 `SequenceGap`, 2 `StaleSequence` references |
| `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs` | Modify | One `RateLimited` assertion |
| `tests/Brmble.Server.Tests/Games/Continuous/RealtimeGameEndpointTests.cs` | Verify | Asserts on `inputRejected` control frames — check which reasons it expects |

## Tasks

### 1. Split validation from refusal in `SubmitInput`

- [x] Introduce a private `Sanitize(ContinuousInput input, long serverTick, bool isHeartbeat,
      ParticipantInputState participant) → (ContinuousInput sanitized, bool malformed)` that
      replaces `IsInRange`. `malformed` is true only for a heartbeat carrying fire or dash.
      Otherwise it returns a corrected input:
      - `PredictedTick` clamped into `[serverTick - 120, serverTick + 30]`.
      - Aim `(0,0)` or `|aim| > 32_767` → `participant.AimX/AimY`.
      - `|move| > 32_767` → scaled down along its own direction (use `FixedVec`), preserving
        the `>= -32_767` component floor.
- [x] `malformed` → `Reject(InvalidRange)` (unchanged behaviour for that one case). Everything
      else proceeds with the sanitized input.
- [x] Sequence: `input.Sequence <= participant.AcknowledgedInput` → log at Information with
      both numbers and `return new InputResult(true, default, participant.AcknowledgedInput)`.
      No `inputRejected` is emitted because `Accepted` is true; verify
      `RealtimeGameEndpoint.HandlePayload` (`:203`) only writes the control on `!Accepted`.
      `input.Sequence > AcknowledgedInput + 1` → log at Information with the gap size and
      continue; the acknowledgement advances to `input.Sequence` on the normal path.
- [x] `messageRateExceeded` (`:353`): do **not** return. Strip `FireReleased` and `Dash`,
      keep held state, and fall through to `SetInput` and acknowledgement. Do **not** enqueue
      the timestamp for an over-budget message — today a rejected message is not counted
      either, and counting it would let a flood extend its own window. (If you conclude the
      current code *does* count it, keep whatever it does and say so in the commit.)
- [x] `Reject` is now called for `WrongRole`, `WrongMatch` and the malformed-heartbeat case
      only. Leave its signature.

### 2. Rewrite the pinned contract

- [x] `Validation_UsesMatchRoleThenSequenceOrderWithoutAdvancingAcknowledgement` (`:26`):
      split into the connection-level part (unchanged) and a new
      `StaleAndGapSequences_AreAcknowledgedWithoutRejecting`.
- [x] `RangeValidation_UsesInclusiveTickAndNormalizedVectorBoundaries` (`:45`): becomes
      `RangeViolations_AreClampedAndAcknowledged`. Assert on what `SetInput` received (the
      test's fake simulation already records it — see `SetInput` at `:595`), not on
      `InputResult` alone.
- [x] `Heartbeat_AcceptsCompleteHeldStateButRejectsEdges` (`:63`): unchanged — this is the
      surviving rejection.
- [x] `MessageRate_…` (`:75`), `RateLimit_DoesNotMaskSequenceOrRangeReasons` (`:90`),
      `HeartbeatRate_…` (`:105`): rewrite to assert acknowledged + held state applied + edges
      stripped + budget still enforced. `RateLimit_DoesNotMaskSequenceOrRangeReasons` no
      longer has reasons to mask; replace it with an ordering test that a rate-limited
      *malformed heartbeat* is still rejected (malformed beats rate-limited).
- [x] `GameEndpointsTests` `RateLimited` assertion: update to the new behaviour.
- [x] `RealtimeGameEndpointTests`: if any test expects an `inputRejected` frame for a reason
      that no longer rejects, rewrite it to expect none.

### 3. New tests

- [x] `RateLimitedInput_IsAcknowledgedAppliesHeldStateAndStripsEdges`: send 120 messages in
      one second, then a 121st with `moveX = 32_767, fireReleased = true`. Assert
      `Accepted`, `AcknowledgedInput == 121`, the simulation's last input has `MoveX == 32_767`
      and `FireReleased == false`, and `SetInput` was called exactly 121 times.
- [x] `ServerStall_DoesNotRejectClientInputs` (the realistic trigger, spec §*server tick
      starvation*): drive the scheduler with the fake `TimeProvider`, advance the clock 700 ms
      in one step so `PlanCycle` forgives debt, then submit an input whose `PredictedTick`
      is 40 ticks past `Simulation.Tick`. Assert acknowledged and `SetInput` received
      `PredictedTick == Simulation.Tick + 30`.
- [x] `ZeroAim_IsReplacedByLastAcceptedAim`: two inputs, the second with aim `(0,0)`. Assert the
      simulation saw the first aim twice and both were acknowledged.
- [x] `SequenceGap_AdvancesToReceivedSequence`: sequences 1, 2, 5. Assert acknowledged 5 and
      three `SetInput` calls.
- [x] `StaleSequence_IsIgnoredAndAcknowledgementDoesNotRegress`: sequences 1, 2, 1. Assert
      acknowledged 2 and two `SetInput` calls.

### 4. Verify

- [ ] Mutation-verify each changed guard, one at a time. Suggested mutations: remove the tick
      clamp; remove the aim substitution; make the rate-limit path `return`; make the stale
      path advance acknowledgement. Each must turn exactly the tests that claim to pin it red.
      Record which test went red for which mutation in the PR description.
- [ ] `dotnet test` green (1718 tests before this plan's additions).
- [ ] Grep the client for `staleSequence`/`sequenceGap`/`invalidRange`/`rateLimited` and
      confirm nothing in it *depends* on receiving those reasons to stay correct. It should
      not; leave the branch at `useArenaConnection.ts:400` in place for the extraction to
      remove.

## Verification commands

From the repo root:

```powershell
dotnet test
```

The web suite is untouched by this plan. If you touch it anyway, note that
`uiGuideCompliance > component code does not use emoji or glyph icons in UI text` is already
red on `main` (`AdminChannelsSection.tsx:245`) and must not be fixed here.

## Environment note

Phase 1 is server-only. A worker that can run `dotnet test` can verify all of it without help.
If you are in a sandbox without .NET, say so before starting; the sibling branch lost five
round-trips to that.
