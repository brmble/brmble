# Server Test Performance Design

## Goal

Make `Brmble.Server.Tests` fast enough for routine local development and repeated GitHub test runs. The default server test command should not wait on unavailable Mumble, Ice, LiveKit, or other external services unless a test is explicitly marked as an external smoke test.

Current evidence from `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-build --no-restore`:

- 292 tests pass in about 5 minutes 45 seconds.
- Most slow tests align with `WebApplicationFactory` startup and take about 4 seconds each.
- Tests that construct a second factory take about 9 seconds.
- `MumbleIceService.StartAsync` tests add about 16 seconds total.
- `LiveKitService.RemoveParticipant_ReturnsFalseAndDoesNotThrow_WhenRoomDoesNotExist` adds about 4 seconds by calling a real LiveKit SDK client against localhost.

## Root Cause

The server test suite includes tests that should be in-process endpoint or unit tests, but they still trigger real external-service connection attempts:

- `BrmbleServerFactory` boots the full application host and leaves `MumbleIceService` registered as an `IHostedService`.
- `MumbleIceService.StartAsync` attempts Ice TCP connection work when no Mumble Ice endpoint is available.
- `LiveKitService.RemoveParticipant` constructs a real `RoomServiceClient` and waits for connection failure when no LiveKit server is running.
- Many endpoint tests create fresh factories, so each accidental startup wait is multiplied across the suite.

The test slowness is not caused by normal assertion logic, database setup, or JSON handling. It is dominated by repeated network timeout paths.

## Scope

In scope:

- Make the default local and GitHub server test runs avoid accidental external network waits.
- Keep integration endpoint coverage for auth, LiveKit token, screen-share, ACL, avatar, health, and server-info behavior.
- Preserve one or more deterministic tests that verify unavailable external services are handled without crashing.
- Add explicit categorization only for tests that intentionally exercise real external services.

Out of scope:

- Replacing MSTest.
- Rewriting the server hosting model.
- Adding Docker-backed Mumble or LiveKit integration tests to the default test workflow.
- Broad endpoint test refactors unrelated to performance.

## Recommended Design

Default server tests should be hermetic. They may construct the ASP.NET Core host and use in-memory SQLite, but they should not connect to external Mumble, Ice, Matrix, or LiveKit services.

`BrmbleServerFactory` should remove or replace hosted/background services that perform external startup work. The immediate target is the `MumbleIceService` hosted-service descriptor registered by `AddMumble`. Endpoint tests do not need the Ice callback bridge; they already replace the authorization, ACL, registration, session mapping, and Matrix dependencies they assert against.

Tests that validate `MumbleIceService` unavailable behavior should avoid real timeout durations. The preferred design is to introduce a minimal test seam around the Ice connection/startup operation so the test can force failure immediately. If that seam would be too invasive, those tests should be marked as external/slow and excluded from default runs, but the first choice is deterministic in-process failure.

`LiveKitService.RemoveParticipant` should not be tested by waiting for a real local LiveKit connection to fail. The removal client boundary should be injectable or wrapped so tests can simulate the SDK throwing immediately. The service test can then assert the same behavior: exceptions are caught, `false` is returned, and no test depends on a running LiveKit server.

## Components

`BrmbleServerFactory` remains the central integration-test host factory. It should own test-only service replacement for external dependencies so individual endpoint tests do not each need to remember which hosted services are unsafe.

`MumbleIceService` remains production-owned by `AddMumble`, but its tests should not depend on OS-level TCP timeout behavior. A small connection abstraction or factory is acceptable if it keeps production behavior unchanged while allowing immediate test failure.

`LiveKitService` remains the business service for token generation and participant removal. Its network SDK call should sit behind a small boundary that can be mocked in tests. Endpoint tests should continue to use the existing in-process application host and service replacements.

Optional external smoke tests may exist later, but they must be visibly named and categorized, for example with `[TestCategory("External")]`, and excluded from default commands.

## Data Flow

Default endpoint tests should follow this path:

1. Test creates `BrmbleServerFactory`.
2. Factory builds the ASP.NET Core test host with in-memory database and mocked external collaborators.
3. Hosted services that connect externally are removed or replaced before the host starts.
4. Test sends HTTP requests through `CreateClient()`.
5. Assertions verify HTTP status, response payload, database state, or mock interactions.

External-service behavior tests should follow this path:

1. Test constructs the target service directly.
2. Test injects a fake collaborator that succeeds or throws immediately.
3. Test asserts service behavior without depending on TCP, DNS, gRPC, or real process availability.

## Error Handling

The production behavior should remain tolerant of unavailable external services where that is already expected:

- `MumbleIceService.StartAsync` should still log and continue when Ice startup fails.
- `LiveKitService.RemoveParticipant` should still return `false` when removal cannot be completed.

The tests should verify those outcomes deterministically. They should not use real timeout duration as proof that error handling works.

## Testing Strategy

After implementation, verify with:

- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-restore`
- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --no-build --no-restore`

Success criteria:

- All current server tests still pass.
- Default server test runtime is no longer dominated by repeated 4-second waits.
- No normal server test attempts to connect to unavailable Mumble Ice or LiveKit services.
- Any intentionally real external-service test is categorized and not part of the default local or GitHub test path.

## Risks

Removing `MumbleIceService` from endpoint test hosts means those tests will not detect breakage in production Ice callback registration. That is acceptable because the endpoint tests do not assert callback behavior, and dedicated `MumbleIceService` tests should cover startup failure behavior directly.

Introducing injectable seams around Ice or LiveKit SDK calls adds small production-code surface area. Keep those boundaries narrow and avoid broad abstractions unless needed for deterministic testing.

Factory sharing could further reduce runtime, but it should not be the first fix. Sharing mutable factories can introduce cross-test state leaks. Remove accidental network waits first, then consider factory reuse only if runtime remains high.
