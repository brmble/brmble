# Task 2: Bounded WebSocket Delivery Report

## Implementation Summary

- Replaced each socket's unbounded continuation tail with a lock-protected FIFO queue, preview index, and single drain task.
- Set queue capacity to 64. Matching `paint.previewUpdated` messages coalesce by `sessionId` and `authorUserId`; queued previews are evicted first when room is needed.
- A full queue containing no preview aborts and removes the socket, then faults the triggering broadcast with `WebSocketException`.
- Preserved the five-second `SendAsync` timeout and one in-flight send per socket.
- Kept permanent Paint broadcasts serialized by channel through ordered queue admission, while each socket FIFO preserves send order.
- Corrected the preview-capacity expectation to 65 delivered messages: one already in-flight permanent message plus the 64-message bounded pending queue.

## Verification

1. `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"`
   - Passed: 13, Failed: 0, Skipped: 0.
2. `dotnet test Brmble.slnx`
   - Failed: 1, Passed: 451, Skipped: 0.
   - Unrelated failure: `PaintAccess_RequiresExplicitJoinAgainAfterReconnect` in `PaintEndpointIntegrationTests`, caused by deserializing `PaintSessionSummary.status`.

## Files Changed

- `src/Brmble.Server/Events/BrmbleEventBus.cs`
- `tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs`
- `.superpowers/sdd/task-2-bounded-websocket-report.md`

## Self-Review

- Queue mutation and preview-index mutation are protected by the per-socket gate.
- The drain removes an item before awaiting its send, so at most one send is in flight per socket.
- Only preview messages are coalesced or evicted; permanent events retain FIFO socket order.
- Queue-full abort is idempotent, avoiding a second abort when the fault reaches the broadcast caller.

## Concerns

- The full solution test suite has one unrelated existing integration-test failure noted above. The required focused event-bus suite passes.

## Follow-up Fix: Queued Send Failure Completion

- `DrainSocketAsync` now marks a failed socket delivery terminal under its delivery gate, faults every remaining queued completion, clears the queue and preview index, and clears the draining flag before removing and aborting the socket.
- `QueueSend` rejects sends for removed clients or terminal delivery state, preventing a race from recreating work after cleanup.
- Added `BroadcastAsync_SendFailureCompletesQueuedBroadcasts`, which queues two broadcasts behind a blocked first send, fails that send, and verifies every caller completes within one second while the socket aborts only once.

### Test Evidence

1. Regression red: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"`
   - Failed as expected before the fix: `BroadcastAsync_SendFailureCompletesQueuedBroadcasts` timed out after one second because queued broadcasts remained unresolved.
2. Regression green: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"`
   - Passed: 14, Failed: 0, Skipped: 0.
3. Full suite: `dotnet test Brmble.slnx`
   - Failed: 1, Passed: 452, Skipped: 0.
   - Unrelated failure: `PaintAccess_RequiresExplicitJoinAgainAfterReconnect` in `PaintEndpointIntegrationTests`, where `PaintSessionSummary.status` fails JSON enum deserialization.

## Follow-up Fix: Full-Queue Abort Terminal Cleanup

- Added a shared gate-held terminal-delivery helper that records the failure, faults and clears every queued completion, clears the preview index, and prevents the drain from dequeuing further work.
- The no-preview full-queue path now uses that cleanup before removing and aborting the socket. Its triggering broadcast still receives a separate `WebSocketException` marked with `SocketQueueFull`.
- Added `BroadcastAsync_FullPermanentQueueStopsDrainAndCompletesQueuedBroadcasts`, which fills a blocked socket's permanent queue, triggers a full-queue abort, then releases the in-flight send and verifies that no queued send starts and all queued broadcasts settle.

### Test Evidence

1. Regression red: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"`
   - Failed as expected before the fix: `BroadcastAsync_FullPermanentQueueStopsDrainAndCompletesQueuedBroadcasts` observed 65 sends after the queue-full abort instead of one.
2. Regression green: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~BrmbleEventBusTests"`
   - Passed: 15, Failed: 0, Skipped: 0.
3. Full suite: `dotnet test Brmble.slnx`
   - Failed: 1, Passed: 453, Skipped: 0.
   - Unrelated failure: `PaintAccess_RequiresExplicitJoinAgainAfterReconnect` in `PaintEndpointIntegrationTests`, where `PaintSessionSummary.status` fails JSON enum deserialization.
