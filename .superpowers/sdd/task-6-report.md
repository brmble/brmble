# Task 6 Report: Metadata-Only Gallery Sync, Lazy Media, and Bounded Atlas Cache

## Status

DONE

Commit: `c5efb37a feat: synchronize custom companion gallery`

## What Changed

- Added strict schema-1 custom companion capability, event, entry, gallery, parser, and reducer types.
- Parser accepts only trusted `im.brmble.sprite` events from the advertised gallery room and rejects malformed IDs, redacted/legacy content, unsupported MIME types, unsafe dimensions/pixel counts, invalid frame counts, and invalid byte sizes.
- Gallery reduction is idempotent, keeps redaction tombstones, and sorts newest-first with event ID as the deterministic tie-breaker.
- Added an origin-shared IndexedDB atlas store using database `brmble-custom-companions`, version `1`, object store `atlases`, and room-scoped cache keys.
- Atlas reads refresh LRU access time transactionally. Writes calculate replacement delta, deterministically evict unprotected records, preserve protected records, and enforce the hard 100 MiB encoded-byte budget in one read/write transaction.
- Cache initialization repairs stale over-budget data without clearing persistent data on disconnect or shutdown.
- Added authenticated, bounded media streaming. Full atlas requests are explicit, cache-aware, deduplicated, cancellable, MIME-normalized, and capped at 5 MiB. Thumbnail requests are explicit, deduplicated, session-only, cancellable, and capped at 1 MiB with no full-atlas fallback.
- Closed the redaction-during-write race by rechecking cancellation after persistence and deleting a record written after its event was tombstoned.
- Added `useCustomCompanionGallery` metadata-only current-state bootstrap and listeners for state, timeline, and sync events.
- Sync rereads complete current state only. It never preloads thumbnails or atlases.
- Redaction cancels in-flight work, revokes owned object URLs, removes the cached atlas, and prevents late additions or fetches from restoring the entry.
- The hook exposes explicit atlas/thumbnail request and release functions plus correlated native bridge create/delete APIs.
- Added optional custom companion capability data to `MatrixCredentials`; equality compares every capability scalar.

## Test Results

- Required focused command:
  - `npm.cmd run test -- src/customCompanions src/hooks/useCustomCompanionGallery.test.tsx src/utils/matrixCredentials.test.ts`
  - PASS: 5 files, 36 tests.
- Test TypeScript build:
  - `npm.cmd run type-check`
  - PASS.
- Targeted Task 6 lint:
  - `npx.cmd eslint` over all Task 6 source and test files.
  - PASS with zero errors or warnings.
- Production web build:
  - `npm.cmd run build`
  - PASS (`tsc -b && vite build`, 603 modules transformed).
- `git diff --cached --check`
  - PASS before commit.

## TDD Evidence

1. Added parser and gallery-hook tests first.
   - Initial required command failed because `customCompanionTypes` and `useCustomCompanionGallery` did not exist.
2. Implemented parser/reducer and credential equality.
   - Parser plus credential suites passed 12 tests.
3. Added atlas-store and media-loader tests before those modules existed.
   - Both suites failed at import resolution as expected.
4. Implemented the transactional store and bounded loader.
   - Cache/media suites reached green with 15 tests.
5. Added native create/delete API tests after temporarily removing those methods.
   - Both tests failed with the expected “is not a function” behavior, then passed after minimal restoration.
6. Added a redaction-during-pending-cache-write race test.
   - It initially failed because the atlas promise resolved and no cleanup occurred.
   - Added the post-write generation check and deletion; the regression then passed.
7. Final focused suite passed all 36 tests.

## Files Changed

- `src/Brmble.Web/src/customCompanions/customCompanionTypes.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionTypes.test.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionAtlasStore.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionAtlasStore.test.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionMediaLoader.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionMediaLoader.test.ts`
- `src/Brmble.Web/src/hooks/useCustomCompanionGallery.ts`
- `src/Brmble.Web/src/hooks/useCustomCompanionGallery.test.tsx`
- `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- `src/Brmble.Web/src/utils/matrixCredentials.ts`
- `src/Brmble.Web/src/utils/matrixCredentials.test.ts`

## Self-Review

- Confirmed initial/current-state synchronization performs no media fetch or cache write.
- Confirmed only explicit requests enter thumbnail/full media loading.
- Confirmed cache keys isolate rooms and the persistent global budget cannot be exceeded by a write.
- Confirmed deterministic LRU ordering, replacement accounting, protected-key behavior, reopen persistence, and redaction deletion.
- Confirmed full and thumbnail requests are independently bounded, authenticated, deduplicated, cancellable, and retry only after another explicit request.
- Confirmed object URLs are revoked on release, redaction, loader replacement/server switch, and unmount.
- Confirmed redaction-before-addition and redaction-during-persistence converge without repopulating the cache.
- Confirmed unrelated untracked files were not staged or modified.
- No unresolved correctness findings remained after review.

## Concerns

- Viewport observation and row placeholder rendering belong to the later picker/moderation UI tasks. Task 6 supplies the explicit thumbnail request/release lifecycle those components will call; it intentionally does not modify UI files.

## Review Fix: Request Ownership and Gallery-Scoped Tombstones

### Summary

- Guarded atlas and thumbnail completion, object URL creation, and request-map cleanup with exact promise ownership.
- A stale completion now follows the active replacement request without creating or revoking an object URL, and cannot remove the replacement from the deduplication map.
- Scoped redaction tombstones to the current Matrix client and gallery room while retaining them across sync rereads within that scope.
- Added regressions for stale atlas and thumbnail completion after loader replacement, including deduplication and object URL behavior.
- Added a regression proving an event ID redacted in one gallery scope remains valid when the client and gallery room change.

### Tests Run

- `npm.cmd run test -- src/customCompanions src/hooks/useCustomCompanionGallery.test.tsx src/hooks/useMatrixClient.test.ts src/utils/matrixCredentials.test.ts`
  - PASS: 6 files, 87 tests.
  - The `useMatrixClient` failure-path test emitted its expected simulated `network` diagnostic.
- `npm.cmd run type-check`
  - PASS.
- `git diff --check`
  - PASS.

### Files Changed

- `src/Brmble.Web/src/hooks/useCustomCompanionGallery.ts`
- `src/Brmble.Web/src/hooks/useCustomCompanionGallery.test.tsx`
- `.superpowers/sdd/task-6-report.md`

### Concerns

- None.

## Review Fix: Persistent Atlas Cache Ownership

### Summary

- Added a shared write-owner marker to persisted atlas records so cancellation cleanup can verify that it still owns the record before deleting it.
- A successful cache read clears pending write ownership in the same transaction that refreshes LRU access time, preventing an older cancelled loader from deleting an atlas claimed by a newer loader or WebView.
- Preserved redaction cleanup: a cancelled write that remains unclaimed is still removed by the matching ownership-checked deletion.
- Added a two-loader regression where the old cancelled loader finishes after the newer loader reads the shared cache and cannot delete the current atlas.
- Preserved full-atlas request deduplication, explicit loading, bounded streaming, persistent cache reuse, deterministic LRU eviction, and protected-key behavior.

### Tests Run

- `npm.cmd run test -- src/customCompanions src/hooks/useCustomCompanionGallery.test.tsx src/hooks/useMatrixClient.test.ts src/utils/matrixCredentials.test.ts`
  - PASS: 6 files, 89 tests.
  - The `useMatrixClient` failure-path test emitted its expected simulated `network` diagnostic.
- `npm.cmd run type-check`
  - PASS.
- `git diff --check`
  - PASS.

### Files Changed

- `src/Brmble.Web/src/customCompanions/customCompanionAtlasStore.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionAtlasStore.test.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionMediaLoader.ts`
- `src/Brmble.Web/src/customCompanions/customCompanionMediaLoader.test.ts`
- `.superpowers/sdd/task-6-report.md`

### Concerns

- None.
