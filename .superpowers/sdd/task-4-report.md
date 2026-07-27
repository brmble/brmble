# Task 4 Report: Paint API, WebSocket Events, and Desktop Bridge

## Status

Completed and committed as `feat: expose paint api and bridge`.

## Delivered

- Added `MapPaintEndpoints()` with all ten `/paint/sessions` routes, certificate identity resolution, request DTO conversion, status codes, and stable `{ code, error }` failures.
- Wired paint endpoints into the server startup pipeline; Task 3 paint DI registrations were already present and retained.
- Added ordered per-channel delivery for permanent canonical `paint.*` events. Preview events remain on the normal channel path, while normal send timeout/removal prevents permanent events from being silently skipped for slow sockets.
- Added `PaintService` to relay all mutation commands over the existing mTLS request helpers and correlate `paint.request` snapshot reads through `paint.response`.
- Wired desktop startup registration and forwarded server `paint.*` WebSocket messages through `MumbleAdapter`.
- Added coverage for canonical names, endpoint route registration, paint WebSocket forwarding, and snapshot request correlation.

## TDD Evidence

### RED

`dotnet test Brmble.slnx --filter "PaintEndpointsTests|PaintServiceTests|MumbleAdapterParseTests"`

Observed expected compile failures before runtime implementation:

- `Brmble.Client.Services.Paint` namespace / `PaintService` did not exist.
- `MapPaintEndpoints` did not exist.

### GREEN

`dotnet test Brmble.slnx --filter "PaintEndpointsTests|PaintServiceTests|MumbleAdapterParseTests"`

Passed: 2 server tests and 48 client tests.

## Final Verification

- `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`: 407 passed.
- `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`: 268 passed.
- `git diff --check`: passed.

## Scope

Only Task 4 source and test files plus this report were staged. Existing unrelated changes under `.opencode`, `Brmble-Run.bat`, and `docs/` were not modified or staged.

## Fix Loop: Active-Source Endpoint Fixture

### Fix

- Updated `PaintEndpointsTests.EndpointFixture.TestMatrix` to return a valid 1x1 PNG payload from `DownloadMediaAsync`.
- Kept the mocked Matrix image metadata size aligned with the payload so `MatrixPaintSourceResolver` and `ImageMetadataReader` can validate the active source before the stroke request.
- Retained the canonical `paint.response` failure assertion and endpoint status/revision coverage.

### Verification

`dotnet test Brmble.slnx --filter "PaintEndpointsTests|PaintServiceTests|MumbleAdapterParseTests"`

Passed: 4 server tests and 49 client tests. Other solution test projects matched zero tests for this filter. The build emitted one pre-existing CS0108 warning in `AuthEndpointsCompanionTests.cs`; no test failures occurred.

## Fix Loop: Remaining Review Findings

### Fixes

- Permanent paint WebSocket send failures now remove and actively abort the affected socket instead of leaving it connected but unsubscribed.
- Paint body endpoints now deserialize request bodies explicitly, so missing or malformed JSON returns the stable `400 { code, error }` shape with `code: INVALID_REQUEST` rather than default minimal-API binding output.
- Added regression coverage for permanent paint send failure abort behavior and malformed/missing stroke request bodies.

### Verification

`dotnet test Brmble.slnx --filter "PaintEndpointsTests|PaintServiceTests|MumbleAdapterParseTests|BrmbleEventBusTests"`

Passed: 15 server tests and 49 client tests. Other solution test projects matched zero tests for this filter. The build emitted one pre-existing CS0108 warning in `AuthEndpointsCompanionTests.cs`; no test failures occurred.

## Fix Loop: Final Review Findings

### Fixes

- Restricted `paint.response` emission to correlated `paint.request` snapshot handling; failed fire-and-forget mutations now remain silent.
- Returned the stable `401 { code, error }` envelope for unauthenticated paint requests with `code: UNAUTHENTICATED`.
- Preserved specific participant authorization codes and mapped unmatched paint authorization failures to `PAINT_FORBIDDEN`.
- Added regression coverage for unauthenticated error envelopes, generic authorization fallback, and mutation-failure silence.

### Verification

`dotnet test Brmble.slnx --filter "PaintEndpointsTests|PaintServiceTests|MumbleAdapterParseTests|BrmbleEventBusTests"`

Passed: 17 server tests and 49 client tests. Other solution test projects matched zero tests for this filter. The build emitted one pre-existing CS0108 warning in `AuthEndpointsCompanionTests.cs`; no test failures occurred.
