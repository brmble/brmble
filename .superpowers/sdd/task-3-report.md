# Task 3 Report: Paint Session Manager and Event Ordering

## Delivered

- Added stable-user paint presence and event-publisher contracts, with production adapters backed by session mapping, channel membership, and the Brmble event bus.
- Implemented in-memory paint sessions with one lock per session, Matrix room creation/source validation, participant join and leave state, ordered idempotent commits, undo, clear generations, snapshots, end cleanup, and inactivity expiry.
- Added per-user preview throttling at 20 events per second. Preview publication does not advance the session revision; commits continue after previews are throttled.
- Added `paint_room_cleanup` SQLite persistence with pending, failed, succeeded, and pending-query operations.
- Added a minute-based `PaintSessionExpirationService` and the authorized DI registrations in `Program.cs`.

## TDD Evidence

- RED: `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests"` failed to compile because the new paint manager, contracts, limiter, repository, and result records did not exist.
- RED: after specifying that snapshots exclude undone strokes, the focused suite failed at `Undo_RemovesOnlyCallerMostRecentActiveStroke`, proving the snapshot filter was required.
- GREEN: the same focused command passed with 9/9 paint tests after filtering snapshots to active strokes in the current generation.
- Regression investigation: the full server suite initially failed at startup because the newly registered hosted service had no registered `PaintSessionManager`. The root cause was the incomplete DI graph. Adding the narrow paint adapters and registrations resolved the startup failure.

## Verification

- `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests"`: passed, 9/9.
- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`: passed, 397/397.
- `git diff --check`: passed.

## Scope

Only the requested paint files, `Database.cs`, paint tests, the authorized `Program.cs` DI/hosted-service wiring, and this report are included. Existing unrelated workspace changes were left untouched.

## Review Fixes (2026-07-24)

- Permanent paint events are now appended to a per-session publication tail while the same session lock updates ordered state. Each caller awaits its queued publication outside the lock, preventing concurrent mutations from delivering a later revision before an earlier one. Preview events remain outside this permanent-event flow.
- Preview rate limiting now keys the 20-per-second window by `(sessionId, userId)`, so an author has an independent allowance in each paint session.
- `MatrixPaintSourceResolver` now accepts the host Matrix user ID and rejects a source event unless the Matrix event `sender` exactly matches it. `AttachSourceAsync` supplies the authenticated host participant's Matrix ID.
- Added regressions for concurrent permanent commit ordering, per-session per-author preview allowance, and rejection of a valid image uploaded by a non-host Matrix user.

## Review Fix Verification

- RED: `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|MatrixPaintSourceResolverTests"` failed before the fixes because the new limiter and resolver APIs did not exist; the initial ordering assertion also exposed that setup events must be excluded from the assertion.
- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests|MatrixPaintSourceResolverTests"`: passed, 18/18. The project continues to emit the pre-existing `CS0108` warning in `AuthEndpointsCompanionTests`.
- `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests|MatrixPaintSourceResolverTests"`: passed, 18/18 selected server tests. Unrelated solution test assemblies report no filter matches.
- `git diff --check`: passed.

## Final Review Fix (2026-07-24)

- Made `CreateAsync`'s participant initialization explicit: the host is active at creation, while selected non-host participants remain inactive until `JoinAsync` completes its Matrix membership check.
- Added `NonHost_CannotActBeforeJoiningAndActivatesAfterSuccessfulJoin`, covering inactive creation state, commit/preview authorization before joining, and activation plus commit after a successful Matrix join.

## Final Review Fix Verification

- `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests|MatrixPaintSourceResolverTests"`: passed, 19/19 selected server tests. Unrelated solution test assemblies report no filter matches; the pre-existing `CS0108` warning remains.
- `git diff --check`: passed.

## Final Remaining Review Fix (2026-07-24)

- End and expiry now persist the pending Matrix cleanup record immediately after marking the session ended/expired and bumping its revision, before queuing the permanent publication. Matrix cleanup remains after publication for end; expiry retains its existing hosted-service cleanup-record behavior.
- Added `EndAndExpire_PersistCleanupBeforePublishingStateChange`, which verifies the cleanup row exists from inside the publisher before either state-change event is published.

## Final Remaining Review Fix Verification

- `dotnet test Brmble.slnx --filter "PaintSessionManagerTests|PaintRateLimiterTests|PaintRoomCleanupRepositoryTests|MatrixPaintSourceResolverTests"`: passed, 20/20 selected server tests. Unrelated solution test assemblies report no filter matches; the pre-existing `CS0108` warning remains.
- `git diff --check`: passed.
