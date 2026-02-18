# Brmble.Server Test Project Design

**Date:** 2026-02-18
**Goal:** 80% code coverage for `Brmble.Server`

## Approach

Hybrid: unit tests for services/repositories + integration tests for HTTP endpoints via `WebApplicationFactory`.

## Project Structure

```
tests/Brmble.Server.Tests/
├── Brmble.Server.Tests.csproj
├── Auth/
│   ├── AuthServiceTests.cs
│   └── UserRepositoryTests.cs
├── Data/
│   └── DatabaseTests.cs
├── Matrix/
│   ├── MatrixServiceTests.cs
│   └── ChannelRepositoryTests.cs
├── Mumble/
│   └── MumbleIceServiceTests.cs
└── Integration/
    └── ServerIntegrationTests.cs
```

## Packages

| Package | Purpose |
|---|---|
| `MSTest.TestFramework` + `MSTest.TestAdapter` + `Microsoft.NET.Test.Sdk` | Test framework (matches existing MumbleVoiceEngine.Tests) |
| `Moq` | Mock interfaces and dependencies |
| `Microsoft.AspNetCore.Mvc.Testing` | `WebApplicationFactory<Program>` for integration tests |
| `coverlet.collector` | Coverage collection |

## Test Coverage Plan

| Class | Test type | Approach |
|---|---|---|
| `Database` | Unit | In-memory SQLite (`:memory:`), verify schema creation is idempotent |
| `AuthService` | Unit | Direct instantiation; assert `IsBrmbleClient` returns false for unknown hash |
| `MumbleIceService` | Unit | Stub `MumbleServerCallback`; assert Start/Stop complete without throwing |
| `/health` endpoint | Integration | `WebApplicationFactory`; assert 200 + `{ status: "healthy" }` |
| DI wiring | Integration | `WebApplicationFactory`; assert app builds without exceptions |
| `UserRepository`, `MatrixService`, `ChannelRepository`, etc. | Unit (skeleton) | Placeholder test per class; coverage grows as stubs are implemented |

## Coverage Enforcement

- Add `coverlet.runsettings` with 80% line coverage threshold
- Run via: `dotnet test --collect:"XPlat Code Coverage" --settings coverlet.runsettings`
- Build fails if coverage drops below threshold

## Program Visibility

Add `public partial class Program {}` to the bottom of `Program.cs` so `WebApplicationFactory<Program>` can reference it from the test assembly.

## YARP Config in Tests

`WebApplicationFactory` overrides configuration to supply a minimal YARP `ReverseProxy` section, avoiding config-load exceptions in the test environment.
