# Config Options Consolidation Design

**Date:** 2026-02-20
**Branch:** refactor/config-options-consolidation

## Problem

Two issues with the current configuration setup:

1. **Domain crossing:** `UserRepository` (auth domain) reads `Matrix:ServerDomain` — an auth service should not depend on Matrix config keys.
2. **No typed options:** All services read `IConfiguration` keys directly in their constructors using magic strings. Required values throw exceptions at runtime (not at startup), making misconfiguration hard to catch.

## Solution

Introduce two typed options classes — `AuthSettings` and `MatrixSettings` — registered via the ASP.NET Core options pattern with `ValidateOnStart()`. Each service gets injected with `IOptions<T>` instead of `IConfiguration`.

## New Classes

### `src/Brmble.Server/Auth/AuthSettings.cs`

```csharp
namespace Brmble.Server.Auth;

public class AuthSettings
{
    public string ServerDomain { get; init; } = "localhost";
}
```

### `src/Brmble.Server/Matrix/MatrixSettings.cs`

```csharp
using System.ComponentModel.DataAnnotations;

namespace Brmble.Server.Matrix;

public class MatrixSettings
{
    [Required] public string HomeserverUrl { get; init; } = null!;
    [Required] public string AppServiceToken { get; init; } = null!;
    public string ServerDomain { get; init; } = "localhost";
}
```

## appsettings.json Shape

```json
{
  "Auth": {
    "ServerDomain": "mijnserver.nl"
  },
  "Matrix": {
    "HomeserverUrl": "http://continuwuity:8448",
    "AppServiceToken": "secret",
    "ServerDomain": "mijnserver.nl"
  }
}
```

`Matrix:ServerDomain` remains for the Matrix bridge's own Matrix user ID construction (if needed). `Auth:ServerDomain` is used solely by `UserRepository`.

## Service Changes

| Service | Before | After |
|---|---|---|
| `UserRepository` | `IConfiguration["Matrix:ServerDomain"]` | `IOptions<AuthSettings>.Value.ServerDomain` |
| `MatrixAppService` | `IConfiguration["Matrix:HomeserverUrl"]`, `IConfiguration["Matrix:AppServiceToken"]` | `IOptions<MatrixSettings>.Value` |
| `AuthExtensions` | — | Register `AuthSettings` with `ValidateOnStart()` |
| `MatrixExtensions` | — | Register `MatrixSettings` with `ValidateOnStart()` |

## Registration Pattern

```csharp
// AuthExtensions.cs
services.AddOptions<AuthSettings>()
    .BindConfiguration("Auth")
    .ValidateDataAnnotations()
    .ValidateOnStart();

// MatrixExtensions.cs
services.AddOptions<MatrixSettings>()
    .BindConfiguration("Matrix")
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

## No Breaking Changes

Existing `appsettings.json` keys continue to work. A new `Auth:ServerDomain` key is introduced; if absent, it defaults to `"localhost"` (same as current behaviour). `Matrix:HomeserverUrl` and `Matrix:AppServiceToken` remain under the `Matrix` section.

## Testing

- Existing `UserRepositoryTests` and `AuthServiceTests` updated to pass `AuthSettings` instead of `IConfiguration`
- Existing `MatrixAppServiceTests` updated to pass `MatrixSettings`
- New test: app fails to start when `Matrix:HomeserverUrl` is missing (validates `ValidateOnStart` works)
