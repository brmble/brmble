# Paint Backend Stabilization Report

Date: 2026-07-24

## Scope

Stabilized the existing server and desktop paint contract only. No Task 5, 6, or 7 web UI files were modified.

## Changes

- Matrix media downloads now preserve both the MXC server name and media ID in the homeserver download route.
- Desktop paint mutations return a correlated `paint.response` when the caller supplies `requestId`, including successful session creation results and stable failure results. Legacy uncorrelated mutations remain fire-and-forget.
- Canonical paint event payloads now include the full invitation context, preview author identity, terminal status, cleanup failure details, and camel-case string enum values on the WebSocket wire.
- Source attachment is allowed only while a session is `PendingSource`; an active source cannot be replaced.
- All event-bus traffic is serialized per WebSocket, so preview and permanent paint messages cannot concurrently call `SendAsync` on the same socket.
- Matrix source events with absent or malformed required JSON properties now produce `PaintValidationException` domain errors rather than unchecked JSON access failures.

## TDD Evidence

Added focused regression tests before implementation for MXC routing, correlated bridge results, malformed Matrix events, source immutability, invitation and preview payloads, terminal cleanup payloads, and same-socket send serialization.

Initial red run failed at the expected behavior gaps:

- MXC download URL omitted the Matrix server name.
- Mutation bridge handlers emitted no correlated response.
- Malformed Matrix events threw `KeyNotFoundException`.
- A second source attachment replaced the active source.
- Invitation, preview, terminal, and cleanup payload fields were absent.
- Preview traffic could overlap a permanent send on the same WebSocket.

## Verification

Focused regression suite:

`dotnet test Brmble.slnx --filter "FullyQualifiedName~MatrixAppServiceTests|FullyQualifiedName~PaintServiceTests|FullyQualifiedName~MatrixPaintSourceResolverTests|FullyQualifiedName~PaintSessionManagerTests|FullyQualifiedName~BrmbleEventBusTests"`

Result: passed, 51 server tests and 3 desktop tests.

Required broader filter:

`dotnet test Brmble.slnx --filter "Paint|BrmbleEventBusTests|MatrixAppServiceTests|PaintServiceTests"`

Result: passed, 65 server tests and 4 desktop tests. The command also reported no matching tests for unrelated Audio and MumbleVoiceEngine test assemblies, plus an existing `CS0108` warning in `AuthEndpointsCompanionTests`.
