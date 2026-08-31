# Arena Knockoff Final Fix Report

## Status

Complete on `docs/arena-knockoff-revision`.

## Fixes

- Pointer aim now subtracts the current rendered/predicted local-player position from renderer-transformed world coordinates before Q15 normalization. `ArenaBoard` maintains the player in a live ref, so RAF prediction changes do not reinstall input listeners. Exact pointer/player coincidence sends nothing and therefore retains the last legal nonzero aim.
- Credential acquisition now returns a side-effect-free result. Application is serialized with the connection lifecycle lock and first validates both the captured generation and `MumbleConnection` reference. API URL discovery, health and WebSocket startup, projection, protected channel IDs, credential/status/error events, and fetched/health flags are all behind that gate. Stale success and failure completions after disconnect or replacement are inert; current success still applies credentials before `voice.connected`, preserving PR645 behavior.
- The Task 13 stale-ticket regression now starts and captures a deferred request for an old match before switching to the replacement runtime. The replacement socket delivers `matchClosed`, then resolving the old request cannot create a socket or mutate terminal state.

## RED Evidence

- Initial web regression run: 5 pointer-aim failures. Both spawn-side center aims produced no frame under origin normalization, and off-origin above/left cases produced diagonal values instead of cardinal Q15 axes.
- Initial native regression run failed to compile because no credential-result acquisition/application boundary existed. After adding the boundary, all four deterministic stale success/failure variants passed.
- The repaired Task 13 test was structured so the old ticket promise existed before replacement and terminal delivery; focused green verification covered 37 connection tests.

## Mutation Evidence

- Replacing relative aim with absolute `world.x/world.y` caused 5 of 24 input tests to fail, including both spawn sides, off-origin above/left, and moving-player coincidence.
- Disabling the native generation/reference apply guard caused all 4 stale credential tests to fail. Observed mutations included old `_apiUrl`, `server.credentials`, `voice.authError`, `brmble.serviceStatus`, and stale projection/credential application.
- Disabling the post-ticket current/runtime/attempt guard made the repaired stale-ticket test create a second socket after terminal delivery; expected 1 socket, observed 2.
- All three production mutations were restored. Post-restoration focused verification passed: 61 web input/connection tests and 4 native stale-credential tests. `git diff --check` passed.

## Focused Verification

- `npm test -- --run src/components/Games/Arena/useArenaInput.test.tsx src/components/Games/Arena/ArenaBoard.test.tsx src/components/Games/Arena/useArenaConnection.test.tsx`: PASS, 3 files and 82 tests.
- `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "FullyQualifiedName~MumbleAdapterBridgeTests|FullyQualifiedName~MumbleAdapterCredentialsTests|FullyQualifiedName~MumbleAdapterProjectionTests|FullyQualifiedName~InputRouterSuspendTests"`: PASS, 82 tests.
- Post-mutation restore: web input/connection PASS, 61 tests; native stale credential PASS, 4 tests.

## Final Gates

Run sequentially before mutation checks:

- `dotnet build -c Release`: PASS, 0 warnings, 0 errors.
- `dotnet test`: PASS, 1,620 tests total (`99 + 73 + 418 + 1030`), 0 failures.
- `npm test`: PASS, 172 files and 2,206 tests, 0 failures.
- `npm run type-check`: PASS.
- `npm run build`: PASS, 673 modules transformed.
- `1..20 | ForEach-Object { dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -c Release --filter "FullyQualifiedName~ArenaDeterminismTests|FullyQualifiedName~ContinuousGameCoordinatorTests|FullyQualifiedName~RealtimeTicketStoreTests"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`: PASS for all 20 runs, 40 tests per run, 800 passing executions total.

The full web suite retained the previously documented intentional error-path stderr, including jsdom's missing `scrollIntoView` in `App.spectator.test.tsx`; the command exited successfully with zero failed tests.

## Concerns

- Interactive two-client playtesting remains outside automated verification, as recorded in Task 17.
- The unrelated untracked `.opencode/plans` files were not read, modified, staged, or committed.
