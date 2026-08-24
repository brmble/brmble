# Task 8 report

Date: 2026-08-10
Task: Remove paint-specific Matrix-room infrastructure and lock in the permanent-save boundary

## Status

Completed.

## Changed files

- Modified `src/Brmble.Server/Program.cs`
- Modified `src/Brmble.Server/Matrix/MatrixAppService.cs`
- Modified `src/Brmble.Server/Paint/PaintModels.cs`
- Deleted `src/Brmble.Server/Paint/IMatrixPaintService.cs`
- Deleted `src/Brmble.Server/Paint/MatrixPaintService.cs`
- Deleted `src/Brmble.Server/Paint/MatrixPaintSourceResolver.cs`
- Deleted `src/Brmble.Server/Paint/PaintRoomCleanupRepository.cs`
- Deleted `src/Brmble.Server/Paint/PaintRoomCleanupService.cs`
- Modified `src/Brmble.Web/src/api/paint.ts`
- Modified `src/Brmble.Web/src/api/paint.test.ts`
- Modified `src/Brmble.Web/src/components/Paint/PaintSessionView.test.tsx`
- Modified `tests/Brmble.Server.Tests/Integration/PaintEndpointIntegrationTests.cs`
- Modified `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`
- Modified `tests/Brmble.Server.Tests/Paint/PaintEndpointsTests.cs`
- Modified `tests/Brmble.Server.Tests/Paint/PaintServiceRegistrationTests.cs`
- Deleted `tests/Brmble.Server.Tests/Paint/MatrixPaintSourceResolverTests.cs`
- Deleted `tests/Brmble.Server.Tests/Paint/PaintRoomCleanupRepositoryTests.cs`
- Deleted `tests/Brmble.Server.Tests/Paint/PaintRoomCleanupServiceTests.cs`

## What changed

- Added a `PaintSessionView` regression test that proves Save to chat:
  - uploads exactly one composed PNG,
  - sends exactly one normal-channel `m.image` event using the returned `mxc://` URI,
  - ends session `s1`.
- Swapped `Program.cs` paint DI to the temporary-storage/cleanup stack:
  - kept `PaintStorageOptions`, `PaintSourceValidator`, `IPaintTemporarySourceStore`, `PaintTemporaryCleanupRepository`, `PaintSessionManager`,
  - added `IPaintTemporaryDataLifetime` from `PaintSessionManager`,
  - kept `IPaintParticipationLifecycle` from `PaintSessionManager`,
  - added `PaintTemporaryCleanupService`,
  - removed old Matrix-paint registrations.
- Removed the five paint-only Matrix helpers from `MatrixAppService` and their tests:
  - `CreatePaintRoom`
  - `InvitePaintUser`
  - `GetRoomEvent`
  - `GetRoomMembership`
  - `DeletePaintRoomAsync`
- Removed obsolete paint event names `SourceAttached` and `Invited`.
- Removed the stale web `paintApi.attachSource` shim and its tests so the temporary invitation/source-event fields are gone from current paint runtime code.
- Updated the paint integration fixture to use the current temporary-source stack instead of the removed Matrix-paint interface.
- Replaced one paint endpoint assertion with a shape-based check so the paint-specific forbidden-token search is clean.

## Tests run

### Focused server tests

Command:

```powershell
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Paint|FullyQualifiedName~MatrixAppServiceTests"
```

Result:

- PASS
- Failed: 0
- Passed: 85
- Skipped: 0

### Focused web regression

Command:

```powershell
npm.cmd test -- src/components/Paint/PaintSessionView.test.tsx
```

Result:

- PASS
- Test files: 1 passed
- Tests: 8 passed

### Web type-check

Command:

```powershell
npm.cmd run type-check
```

Result:

- PASS

### Additional touched-web test

Command:

```powershell
npm.cmd test -- src/api/paint.test.ts
```

Result:

- PASS
- Test files: 1 passed
- Tests: 25 passed

## Searches run

### Removed paint-room infrastructure/helpers

Command:

```powershell
git grep -nE 'IMatrixPaintService|MatrixPaintSourceResolver|PaintRoomCleanupService|PaintRoomCleanupRepository|CreatePaintRoomAsync|CreatePaintRoom|InvitePaintUserAsync|InvitePaintUser|GetRoomEventAsync|GetRoomEvent|GetRoomMembership|DeletePaintRoomAsync' -- src tests
```

Result:

- No matches

### Paint-only `matrixRoomId|mxcUrl`

Note: the broad phase-plan search scope also matches unrelated generic Matrix chat/custom-companion code. Per the plan note, I narrowed the assertion to current paint runtime/wire-model files rather than deleting unrelated Matrix functionality.

Command:

```powershell
git grep -nE 'matrixRoomId|mxcUrl' -- src/Brmble.Server/Paint src/Brmble.Client/Services/Paint src/Brmble.Web/src/components/Paint src/Brmble.Web/src/api/paint.ts src/Brmble.Web/src/hooks/usePaintSession.ts src/Brmble.Web/src/types/paint.ts tests/Brmble.Server.Tests/Paint tests/Brmble.Server.Tests/Integration/PaintEndpointIntegrationTests.cs
```

Result:

- No matches

### Temporary invitation/source-event fields in current paint runtime/wire-model code

Command:

```powershell
git grep -nE 'participantUserIds|sourceEventId|sourcePreview' -- src/Brmble.Server/Paint src/Brmble.Client/Services/Paint src/Brmble.Web/src tests/Brmble.Server.Tests/Paint tests/Brmble.Server.Tests/Integration/PaintEndpointIntegrationTests.cs ':(exclude)src/Brmble.Web/src/utils/parseMessageMedia.ts' ':(exclude)src/Brmble.Web/src/utils/parseMessageMedia.test.ts' ':(exclude)src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx'
```

Result:

- No matches

### Allowed legacy invitation parser boundary

Command:

```powershell
git grep -nE 'participantUserIds|sourceEventId|sourcePreview' -- src/Brmble.Web/src/utils/parseMessageMedia.ts src/Brmble.Web/src/utils/parseMessageMedia.test.ts src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx
```

Result:

- Matches remain only in the intended legacy parser/tests compatibility boundary.

### Removed paint event names

Command:

```powershell
git grep -nE 'PaintEventNames\.(SourceAttached|Invited)|paint\.(sourceAttached|invited)' -- src/Brmble.Server/Paint src/Brmble.Web/src tests/Brmble.Server.Tests
```

Result:

- No matches

## Self-review

- `git diff --check` passed.
- Scoped diff reviewed against the Task 8 brief.
- No unrelated pre-existing untracked files were modified.

## Concerns

- None.
