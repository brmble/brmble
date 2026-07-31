# Duel Orchestration Queue — Release-Stage Review (Task 12)

Branch: `feature/minigame-framework-expansion`
Plan: `docs/superpowers/plans/2026-07-25-duel-orchestration-queue-ready-rematches-etas.md`
Reviewed range: merge-base `cf917f60` .. `6916327f`

This is the self-review deliverable for Task 12. Everything actionable and in
scope for Project 1 was fixed in this branch under TDD. This document records
(a) findings that belong to other work, and (b) findings from the review that
turned out to be wrong, so nobody re-litigates them later.

## Merge resolution

The merge of main's bounded WebSocket delivery queue was resolved correctly.
`AddClientAsync`'s single-payload → payload-batch generalization preserves the
original invariants: the socket is published to `_clients` before the factory
runs, the batch is inserted back-to-front at the head so ordering survives,
`Draining` is pre-claimed, and `delivery.Failure` is re-checked after the now
longer async build window. No ordering or backpressure regression was found in
`BrmbleEventBus`.

## Deferred — not Project 1 work

### 1. `NativeBridge._pendingMessages` is unbounded, `PostMessage` result ignored

`src/Brmble.Client/Bridge/NativeBridge.cs` (~lines 36, 69, 128).

Every `game.*` event forwarded from `MumbleAdapter` enqueues a payload and
issues one `PostMessage(WM_USER)` with no coalescing. `ProcessUiMessage` only
drains when the Win32 pump services WM_USER, so a stalled UI thread (modal loop,
WebView2 init, drag-resize) grows the queue without bound. The per-thread
Windows message queue caps at 10,000 posted messages by default; past that
`PostMessage` returns FALSE and is silently ignored, so the flush trigger can be
lost while the payload queue keeps growing.

Why deferred: `NativeBridge.cs` is not in this plan's File Structure and was not
modified by this branch. The duel snapshot traffic raises the fill rate, but the
missing bound is pre-existing client transport behaviour.

Suggested fix when picked up: check `PostMessage`'s return value, and coalesce
notifications behind a single dirty flag plus one post.

### 2. `/games/action` has no match-ownership check

`src/Brmble.Server/Games/GameEndpoints.cs` (~lines 112-122).

Unlike `/games/forfeit`, which gained an explicit
`TryGetActiveMatch(user.UserId) && active.MatchId == dto.MatchId` gate, the
action endpoint performs no ownership check and relies entirely on the engine
rejecting a foreign session. `dto.Action` is also never null-checked.

Why deferred: the plan deliberately retains discrete actions on
`GameSessionManager` ("retain discrete actions on `GameSessionManager`", plan
line 31), so this endpoint was intentionally left alone. The authorization gap
predates this branch.

Suggested fix when picked up: apply the same `TryGetActiveMatch` guard used by
forfeit and reject `dto.Action is null` with the standard `GameErrorWire`.

### 3. `DecodeChunkedBody` treats byte chunk sizes as character counts

`src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (~lines 1364-1387).

The socket buffer is UTF-8-decoded to a `string` before chunk parsing, but HTTP
chunk sizes are byte counts and `body.AsSpan(offset, size)` indexes UTF-16
chars. Any non-ASCII byte in a chunked response desynchronises the decoder: the
chunk absorbs the following `\r\n` + size line, the `\r\n` check fails, the loop
breaks, and the body is silently truncated. `JsonDocument.Parse` then throws and
the whole request fails. This is reachable — duel error messages carry usernames.

Why deferred: the bug predates the branch. This branch extracted it into a
shared helper and added `GameServiceTests.Command_ChunkedServerErrorThroughAdapter_PreservesStructuredReason`,
which only exercises pure-ASCII chunks and therefore cements the bug as
"verified correct". That test should not be trusted as coverage of this path.

Suggested fix when picked up: decode chunks over the raw `byte[]` from
`ms.ToArray()` rather than the decoded string, and add a multibyte test case.

## Findings that were wrong

Recorded so they are not re-raised.

### Shutdown does not lose already-buffered completed matches

The review claimed `ReadAllAsync(stoppingToken)` drops everything buffered at
shutdown, losing match results on every deploy. A test written to prove this
passed against the unmodified code: `ReadAllAsync`'s inner `TryRead` loop drains
all currently-buffered items before re-checking the token, so a clean stop keeps
them.

The narrower real loss path — an item stuck in a retry delay taking the rest of
the queue down with it — was genuine and is fixed
(`Shutdown_DuringRetryDelay_StillDrainsRemainingQueuedMatches`).

### `DateTimeOffset.Parse` culture sensitivity in `GameRepository`

The review claimed ambient culture and default `DateTimeStyles` corrupt
`ended_at` round-trips, feeding bad data to the ETA estimator. Not reproducible:

- Default `DateTimeStyles` normalizes to local time for `DateTime.Parse`, but
  **not** for `DateTimeOffset.Parse` — when the string carries an offset, the
  offset is preserved. `RoundtripKind` is effectively a no-op here.
- .NET has a culture-independent ISO-8601 fast path. Verified identical results
  under `de-DE`, `ar-SA` (UmAlQuraCalendar), `th-TH`, `fa-IR`, `he-IL`, `ja-JP`
  with ICU active and local TZ `W. Europe Standard Time`.

`InvariantCulture` + `RoundtripKind` were added anyway to document intent and
guard against a future non-ISO writer, but this was a no-op change. The
accompanying test was never red and is a regression guard only.

### Ready-check timer leak severity

Originally filed as Critical. It is Minor: the timer has already fired by the
time `ExpireReadyAsync` runs, so this was an undisposed handle awaiting
finalization, not an accumulation of live timers. Fixed regardless — disposal
now lives in `RemoveReadyCheck`.

Note the test harness previously marked a timer disposed when it *fired*, which
hid this class of bug entirely. `TestTimer` now models a real one-shot
`System.Threading.Timer` (firing does not dispose), which is what made both this
and the challenge-offer timer leak observable.

## Remaining known-minor items

Not fixed, not blocking: dead fields (`SnapshotLane.LastPublished`,
`Offer.TerminalReason`, `RematchTerminalOutcome.ChannelId`,
`DuelReservation.AcceptanceSequence`), the reservation/offer ID collision
band-aid, `goto` labels inside lock bodies, magic literal `1000` alongside the
named `CompletedSourceLimit`, `DuelCancelReason` values silently mapping to
`"disconnected"`, `EstimateRemainingAsync` missing the `Math.Max(0, ...)` clamp
its fallback branch has, and `DuelDurationEstimator.Combine` misreporting method
and sample count.
