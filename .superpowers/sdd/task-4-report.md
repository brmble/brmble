# Task 4 Report: Capability, Custom Selection Validation, and Moderator Deletion

## What Changed

- Added root-server moderation authorization using only Mumble Kick or Ban permission.
- Added active-gallery validation for `custom:<matrix-event-id>` selections. Stale custom selections now repair to `floppy`; invalid custom selection requests leave the prior selection unchanged.
- Added the `matrix.customCompanions` capability after a successful gallery-room join, including gallery metadata, trusted sender, limits, selected companion, and moderation capability. Gallery failures omit the additive capability without failing authentication.
- Added `CompanionWireSelection` so legacy `companionId` remains `floppy` for custom selections while `customCompanionId` carries the real value in auth, session mapping, and WebSocket payloads.
- Added authorized, idempotent `DELETE /companions/{eventId}`. It redacts the Matrix event before marking the record deleted, resets affected user selections, updates live mappings, and broadcasts `companionChanged` to the affected users' channels. Redaction failures return 503 and retain the active record.

## Test Results

Command:

```powershell
dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --filter "FullyQualifiedName~AuthEndpointsCompanionTests|FullyQualifiedName~CustomCompanionDeletionTests|FullyQualifiedName~UserRepositoryTests|FullyQualifiedName~SessionMappingHandlerTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"
```

Result: passed, 40 tests passed, 0 failed.

Committed implementation: `0386add5 feat: authorize custom companion selection and removal`.

## TDD Evidence

1. Added the custom-selection, capability, compatibility, and deletion tests before production changes.
2. Ran the Task 4 focused red command. It failed because `CompanionWireSelection`, `CanModerateServerAsync`, and `NormalizeCompanionIdAsync` did not yet exist.
3. Corrected test setup errors while preserving the expected missing-feature failures.
4. Implemented the minimum production behavior, then reran the focused suite. The first green run exposed an actual 403 implementation issue (`Results.Forbid()` required an unconfigured authentication service); replaced it with an explicit 403 result.
5. Reran the full Task 4 focused test command successfully.

## Files Changed

- `src/Brmble.Server/Auth/AuthEndpoints.cs`
- `src/Brmble.Server/Auth/UserRepository.cs`
- `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs`
- `src/Brmble.Server/Companions/CustomCompanionModels.cs`
- `src/Brmble.Server/Events/SessionMappingHandler.cs`
- `src/Brmble.Server/Mumble/AclAuthorizationService.cs`
- `src/Brmble.Server/Mumble/IMumbleAclService.cs`
- `src/Brmble.Server/Mumble/MumbleAclService.cs`
- `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- `tests/Brmble.Server.Tests/Auth/AuthEndpointsCompanionTests.cs`
- `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`
- `tests/Brmble.Server.Tests/Companions/CustomCompanionDeletionTests.cs`
- `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`
- `tests/Brmble.Server.Tests/WebSockets/BrmbleWebSocketHandlerTests.cs`

## Self-Review

- Confirmed custom identifiers are kept exactly as `custom:<matrix-event-id>` internally and are never exposed through a legacy wire `companionId`.
- Confirmed the deletion path checks moderation before looking up or redacting the record, performs Matrix redaction before database deletion, and is idempotent for inactive records.
- Confirmed custom-gallery capability calculation is isolated from ordinary Matrix room joining and display-name synchronization.
- Ran `git diff --check`; no whitespace errors were reported.
- Reviewed the committed diff with `git show --check --stat HEAD`; no post-commit whitespace or scope issues were found.

## Concerns

- The focused test build reports the existing `CS0108` warning in `AuthEndpointsCompanionTests.CompanionAuthFactory` for hiding the base factory's `SessionMappingMock`. This Task 4 work did not introduce that factory member and leaves it unchanged.

## Review Fix: Concurrent Custom Companion Deletion

### Summary

- Serialized active custom-companion deletion per Matrix event after authorization, preventing concurrent requests from issuing duplicate Matrix redactions.
- Preserved rollback behavior: a redaction failure releases the lock, leaves the record active, and returns 503; once deletion succeeds, subsequent requests return 204 without redaction.
- Added coverage for the required `companionChanged` payload sent to an affected user's current channel during active deletion.

### Tests

```powershell
dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --no-restore --filter "FullyQualifiedName~AuthEndpointsCompanionTests|FullyQualifiedName~CustomCompanionDeletionTests|FullyQualifiedName~UserRepositoryTests|FullyQualifiedName~SessionMappingHandlerTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"
```

Result: passed, 42 tests passed, 0 failed.

### Files Changed

- `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs`
- `tests/Brmble.Server.Tests/Companions/CustomCompanionDeletionTests.cs`
- `.superpowers/sdd/task-4-report.md`

## Re-Review Fix: Preserve Newer Live Companion Selections

### Summary

- Added an atomic compare-and-swap live-mapping update for custom companion deletion.
- Deletion now changes a connected user's live companion to `floppy` only when it is still `custom:<deleted-event-id>`.
- `companionChanged` is broadcast only after that conditional update succeeds, so a newer built-in or custom selection is not overwritten or announced as `floppy`.
- Added a regression test that changes both the database and live selection to `bee` after deletion resets the database record; deletion preserves `bee` and sends no fallback broadcast.

### Tests

```powershell
dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --no-restore --filter "FullyQualifiedName~AuthEndpointsCompanionTests|FullyQualifiedName~CustomCompanionDeletionTests|FullyQualifiedName~UserRepositoryTests|FullyQualifiedName~SessionMappingHandlerTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"
```

Result: passed, 43 tests passed, 0 failed.

```powershell
dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --no-restore --filter "FullyQualifiedName~SessionMappingServiceTests.TryUpdateCompanionIdIfCurrent_PreservesNewerSelection"
```

Result: passed, 1 test passed, 0 failed.

### Files Changed

- `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs`
- `src/Brmble.Server/Events/ISessionMappingService.cs`
- `src/Brmble.Server/Events/SessionMappingService.cs`
- `tests/Brmble.Server.Tests/Companions/CustomCompanionDeletionTests.cs`
- `tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs`
- `tests/Brmble.Server.Tests/Games/SessionMappingGamePresenceTests.cs`
- `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
- `.superpowers/sdd/task-4-report.md`

## Review Fix: Synchronize Custom Selection and Deletion

### Summary

- Added a singleton per-event coordinator shared by custom companion selection and deletion.
- Custom selection now acquires the event lock, revalidates that the event is active, and holds coordination through database persistence, live mapping publication, channel broadcast, and response construction.
- When deletion owns the event operation first, a racing selection waits, observes the deleted event, returns 400, and does not publish or return the deleted custom ID.
- Built-in selection and the existing deletion redaction, rollback, idempotency, reset, and compare-and-swap behavior remain unchanged.
- Added a regression test that pauses deletion during Matrix redaction, starts a selection for the same event, and verifies deletion wins without a stale live update, broadcast, or successful response.

### Tests

```powershell
dotnet test tests\Brmble.Server.Tests\Brmble.Server.Tests.csproj --no-restore --filter "FullyQualifiedName~AuthEndpointsCompanionTests|FullyQualifiedName~CustomCompanionDeletionTests|FullyQualifiedName~UserRepositoryTests|FullyQualifiedName~SessionMappingHandlerTests|FullyQualifiedName~BrmbleWebSocketHandlerTests"
```

Result: passed, 44 tests passed, 0 failed.

### Files Changed

- `src/Brmble.Server/Auth/AuthEndpoints.cs`
- `src/Brmble.Server/Companions/CustomCompanionEndpoints.cs`
- `src/Brmble.Server/Companions/CustomCompanionEventCoordinator.cs`
- `src/Brmble.Server/Companions/CustomCompanionExtensions.cs`
- `tests/Brmble.Server.Tests/Companions/CustomCompanionDeletionTests.cs`
- `.superpowers/sdd/task-4-report.md`
