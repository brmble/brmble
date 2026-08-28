# Task 11 Report: Bounded One-Time Realtime Tickets

## Status

Implemented and verified.

## Changes

- Added a singleton realtime ticket store with 256-bit base64url tokens, SHA-256-only storage, exact 15-second expiry, atomic one-time consumption, per-user/global bounds, synchronous scavenging, and a disposable 5-second periodic scavenger.
- Added trusted `Games` configuration binding and production validation requiring an absolute `wss` public URL. The options also carry Task 12's allowed origins configuration.
- Added `POST /games/realtime-ticket` with mTLS stable-user resolution, current-session binding, participant-only role enforcement, concrete `ContinuousGameCoordinator` ownership checks, stable error reasons, and a fixed-window 10-per-certificate-user/minute limiter.
- Added the native `games.request` `realtime-ticket` action using the existing mTLS POST helper, exact body projection, and existing correlated `games.response` path.
- Added focused store, endpoint, configuration, and native request tests.

## TDD Evidence

- Server RED: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RealtimeTicketStoreTests|FullyQualifiedName~GameEndpointsTests"`
  - Failed with `CS0246` because `RealtimeTicketStore` did not exist.
- Native RED: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~GameServiceTests`
  - Failed because the `realtime-ticket` action made zero POSTs and returned the existing unknown-action response.
- Focused server GREEN: 54 passed, 0 failed.
- Focused native GREEN: 17 passed, 0 failed.

## Final Verification

- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`: 992 passed, 0 failed.
- `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`: 383 passed, 0 failed.
- `dotnet build`: succeeded with 0 warnings and 0 errors.
- `git diff --check`: clean.

## Concerns

- `Games:RealtimePublicWebSocketUrl` in `appsettings.json` is an example production-safe `wss` value and must be overridden with the deployment's actual public endpoint.
- Task 12 remains responsible for consuming tickets and enforcing `Games:RealtimeAllowedOrigins`; this task only defines and binds that option as requested.

## Commit

This report is included in `feat: issue scoped one-time realtime game tickets`; the resulting SHA is returned with the task handoff.
