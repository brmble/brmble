# Realtime Acknowledgement and Latency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a single refused input from dropping the player's connection mid-match, and
stop the client systematically under-replaying its own inputs.

**Spec:** `docs/superpowers/specs/2026-09-13-realtime-acknowledgement-and-latency-design.md`

**Branch:** `fix/arena-unconditional-acknowledgement`, already created from `origin/main`.
Do not commit to `main`. Do not push or open a PR without asking.

## Read this first

**There is an open design decision in the spec** (`StaleSequence` / `SequenceGap`, Option A
vs B). It is not made. Ask the user before implementing Phase 1; everything else in Phase 1
is agreed.

**Phase 2 is blocked.** Finding 4 needs `serverClock.ts`, which lives on
`fix/arena-server-clock-offset` (PR open, not merged at the time of writing). Confirm that
branch has merged before starting Phase 2. If it has not, stop after Phase 1.

## Global Constraints

- **This changes the wire contract's behaviour, not its shape.** No new fields are needed.
  If you find yourself adding one, stop — the arena snapshot validator is arity-strict
  (`arenaProtocol.ts`, `objectWithKeys`), so any added field is a breaking change requiring
  client and server to ship together.
- **Rate limiting must not weaken.** Acknowledging a rate-limited message must still discard
  its effect. Prove this with a test that counts what reaches the simulation, not just what
  the endpoint returns.
- **Do not touch `ContinuousRejectReason`'s enum members in this change.** Removing
  `Cooldown` / `DashSpent` belongs to the orchestrator extraction, not here.
- Every test must be able to fail for the reason it claims. Verify by mutation before
  reporting, and **confirm the mutation actually applied** — a find-and-replace that matches
  nothing produces a green run that looks like proof and is worthless. This bit us twice on
  the sibling branch.
- **Sequential guards shadow each other.** `SubmitInput` has ~8 guards in sequence; a test
  only pins the one that happens to reject it. Run one mutation per guard, each with an
  input constructed to clear every preceding guard.

## Phase 1 — Unconditional acknowledgement (Finding 3)

Server-only. `dotnet test` covers it fully; no frontend build or playtest needed.

| File | Change | Responsibility |
|---|---|---|
| `src/Brmble.Server/Games/Continuous/ContinuousGameCoordinator.cs` | Modify | `SubmitInput` guards (~`:289-378`), `Reject` (`:798`), `IsInRange` (`:808`) |
| `tests/Brmble.Server.Tests/Games/Continuous/ContinuousInputTests.cs` | Modify | 683 lines; pins most of the current rejection contract |
| `tests/Brmble.Server.Tests/Games/GameEndpointsTests.cs` | Modify | One `RateLimited` assertion |

- [ ] Confirm the open decision with the user.
- [ ] `InvalidRange`: clamp `PredictedTick` into `[serverTick - 120, serverTick + 30]` and
      normalise out-of-range axes instead of rejecting. Keep the rejection for a heartbeat
      bearing a fire or dash.
- [ ] `RateLimited`: acknowledge and discard the effect, mirroring the aim-rate clamp at `:362`.
- [ ] `StaleSequence` / `SequenceGap`: per the agreed option.
- [ ] Rewrite the affected tests to assert stripped-and-acknowledged rather than rejected.
      Counts before the change: 9 `InvalidRange`, 5 `RateLimited`, 3 `SequenceGap`,
      2 `StaleSequence` in `ContinuousInputTests`, 1 `RateLimited` in `GameEndpointsTests`.
- [ ] Add a test that a rate-limited input is acknowledged **and** does not reach the
      simulation.
- [ ] Add a test that a `PredictedTick` far outside the window is clamped and accepted,
      and that the clamped value is what the simulation sees.
- [ ] Mutation-verify each changed guard, one at a time.
- [ ] `dotnet test` green (1718 tests at the time of writing, before this plan's additions).

## Phase 2 — Latency term in `predictedTick` (Finding 4)

**Blocked on `fix/arena-server-clock-offset` merging.** Verify before starting.

| File | Change | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/components/Games/Arena/serverClock.ts` | Modify | Add RTT alongside the existing offset estimate |
| `src/Brmble.Web/src/components/Games/Arena/serverClock.test.ts` | Modify | RTT estimator tests |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.ts` | Modify | `currentPredictedTick` (`:94`) adds half RTT |
| `src/Brmble.Web/src/components/Games/Arena/useArenaConnection.test.tsx` | Modify | Sequencing tests assert predicted ticks |

- [ ] Extend `serverClock` with an RTT estimate from the samples it already takes. Same
      bounded-window discipline as the offset: prefer the low percentile, not the mean.
- [ ] `currentPredictedTick` adds `halfRtt` in ticks.
- [ ] Test that replay under simulated latency no longer discards the opening ticks of a
      pending interval (`arenaMath.ts:497` is the clamp that discards them).
- [ ] `npm test` green.

## Verification

From the repo root:

```powershell
dotnet test
```

From `src/Brmble.Web`:

```powershell
npm test
```

Note `uiGuideCompliance > component code does not use emoji or glyph icons in UI text` is
**already red on `main`** (`AdminChannelsSection.tsx:245` uses `▾`/`▸`). It is unrelated to
this work and must not be fixed here. Everything else should be green.

## Environment note

The sibling branch was implemented from a Linux sandbox that could not run either suite —
no .NET, and the web suite needs a rollup binary the blocked npm registry would not provide.
That cost five round-trips of "write, ask the user to run, read the output". If you are in
the same position, say so early and plan for it. Phase 1 is server-only, so a worker who
can run `dotnet test` can verify all of it without help.
