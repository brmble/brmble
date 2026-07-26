# Task 1: Bounded WebSocket Delivery Report

## What I implemented

- Added `RouteChannelFiveToUserOne()` with the exact channel/session mapping from the brief.
- Added a blocking WebSocket test helper using a `TaskCompletionSource` in the first mocked `SendAsync` call and JSON payload capture.
- Added a preview coalescing test for the same `sessionId` and `authorUserId`, asserting two payloads and preview sequence `2`.
- Added a preview-capacity test with one blocked permanent, 64 unique previews, and `SessionEnded`, asserting `SessionEnded` delivery and 64 total payloads.
- Added a permanent-capacity test with one blocked permanent, 64 permanent events, and `CanvasCleared`, asserting one socket abort and removal of the connected client.

## What I tested and exact result

Command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"
```

Result: FAIL, with 10 passed, 3 failed, 0 skipped, total 13 tests.

The project compiled successfully. The run also emitted the pre-existing warning `CS0108` in `AuthEndpointsCompanionTests.cs`.

## TDD RED evidence

The exact focused command above was run after adding the tests and before any production changes. It failed as expected:

- `BroadcastToChannelAsync_CoalescesQueuedPreviewsBySessionAndAuthor`: expected 2 payloads, actual 3.
- `BroadcastToChannelAsync_PreviewCapacityPreservesSessionEnded`: expected 64 payloads, actual 66.
- `BroadcastToChannelAsync_PermanentCapacityAbortsSocket`: expected `Abort()` once, actual 0 invocations; the client remained connected.

These failures are expected because the current production implementation uses an unbounded per-socket tail chain. It sends both queued previews, has no bounded preview capacity or eviction, and does not abort when permanent delivery exceeds capacity.

## Files changed

- `tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs`
- `.superpowers/sdd/task-1-bounded-websocket-report.md` (requested report; not included in the test-only commit)

## Self-review findings

- The implementation is test-only and confined to the requested test file.
- The helper uses the required exact route values and blocks the first mocked send so later broadcasts queue behind it.
- The tests assert behavior through captured WebSocket JSON and the public client state/abort behavior.
- `git diff --check` reported no whitespace errors.

## Any concerns

- The focused command remains intentionally red because this task defines the contract before the production bounded-delivery implementation.
- The existing unrelated `CS0108` warning remains present.
- The pre-existing unrelated worktree changes were left untouched.

## Review finding fix

- Updated `BroadcastToChannelAsync_PermanentCapacityAbortsSocket` to await the already queued permanent broadcasts after releasing the first send, then explicitly assert that the `cleared` broadcast task faults with `WebSocketException`. The test still verifies one `Abort()` call and that `HasConnectedClient(1L)` is false.

## Fix verification

Command:

```text
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"
```

Result: FAIL, with 10 passed, 3 failed, 0 skipped, total 13 tests. The permanent-capacity test now fails at the expected `WebSocketException` assertion because the production bounded-delivery behavior is not implemented yet. The other two expected bounded-delivery tests remain red. The project compiled successfully and emitted the pre-existing `CS0108` warning in `AuthEndpointsCompanionTests.cs`.

## Files changed for this fix

- `tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs`
- `.superpowers/sdd/task-1-bounded-websocket-report.md`
