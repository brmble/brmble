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

## Fix Round 1

### Status

Implemented all review findings.

### Changes

- Removed `Games:RealtimePublicWebSocketUrl` from production `appsettings.json`. Development alone supplies `wss://localhost:8080/games/realtime`; test hosts supply explicit non-production values.
- Replaced the pre-handler certificate-hash ASP.NET policy with a singleton fixed-window limiter keyed by the resolved stable user ID and driven by the injected `TimeProvider`.
- Added deterministic `TimeProvider` coverage for the five-second periodic ticket scavenger and idempotent disposal/cancellation.
- Preserved ticket generation, hashing, expiry, scope, one-time consumption, participant authorization, stable reasons, and the absence of spectator authorization calls.

### RED And Mutation Evidence

- Initial focused RED failed with `CS0246` for the missing `RealtimeTicketRateLimiter`, proving the new tests did not exercise the old certificate policy.
- Endpoint mutation bypassed `TryAcquire`; `RealtimeTicket_EleventhRequestForStableUserIsRateLimited` failed because the 11th response was 400 instead of 429.
- Window mutation changed one minute to two; `WindowResetsAtExactlyOneMinute` failed at the exact-minute acceptance assertion.
- Scavenger mutation changed five seconds to twenty; `PeriodicScavenger_RemovesExpiredTicketsAtFiveSecondTick` failed because the expired ticket remained.
- All mutations were restored before final verification.

### Verification

- Focused server tests covering tickets, limiter, endpoints, options, and affected fixtures: 68 passed, 0 failed.
- Full server suite: 1002 passed, 0 failed.
- Full client suite: 383 passed, 0 failed.
- `dotnet build`: succeeded with 0 warnings and 0 errors.

### Concerns

- Production deployment must now explicitly provide an absolute `wss` value for `Games:RealtimePublicWebSocketUrl`; omission intentionally prevents startup.
- The in-memory stable-user limiter resets on server restart, matching the requested minimal singleton fixed-window scope.

## Fix Round 2

### Status

Implemented deterministic cleanup of expired stable-user rate-limit windows.

### Changes

- `RealtimeTicketRateLimiter.TryAcquire` now samples the current time once under its existing lock and removes every window where `now - StartedAt >= one minute` before evaluating the current stable user.
- The current user's expired window resets normally to count 1, active windows remain, and cleanup introduces no timer or additional abstraction.
- Added an internal locked `Count` solely for deterministic retention tests through the existing `InternalsVisibleTo` configuration.

### RED Evidence

- The focused limiter test run failed with `CS1061` because `RealtimeTicketRateLimiter.Count` did not exist, proving the new retention assertions could not pass against the prior implementation.

### Verification

- Limiter tests: 7 passed, 0 failed.
- Focused limiter, ticket store, and endpoint tests: 62 passed, 0 failed.
- Full server suite: 1004 passed, 0 failed.

### Concerns

- Cleanup is an O(number of tracked users) scan on each ticket request. This is the explicitly selected minimal approach and is bounded by the endpoint's expected request scale.
