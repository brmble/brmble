# Config Options Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace direct `IConfiguration` key reads in `UserRepository` and `MatrixAppService` with typed `IOptions<AuthSettings>` and `IOptions<MatrixSettings>`, adding startup validation and eliminating the auth domain's dependency on `Matrix:*` config keys.

**Architecture:** Two new settings classes (`AuthSettings`, `MatrixSettings`) are registered via ASP.NET Core's options pattern with `ValidateDataAnnotations()` + `ValidateOnStart()`. Each service's constructor swaps `IConfiguration` for `IOptions<T>`. Tests swap their `IConfigurationBuilder` setup for `Options.Create<T>(...)`.

**Tech Stack:** ASP.NET Core options pattern (`Microsoft.Extensions.Options`), `System.ComponentModel.DataAnnotations`, MSTest

---

### Task 1: Create `AuthSettings` and wire up `UserRepository`

**Files:**
- Create: `src/Brmble.Server/Auth/AuthSettings.cs`
- Modify: `src/Brmble.Server/Auth/UserRepository.cs:4,15,18`
- Modify: `src/Brmble.Server/Auth/AuthExtensions.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs:5-6,26-32`

**Step 1: Update the test to use `IOptions<AuthSettings>` (will fail to compile)**

Replace the setup in `UserRepositoryTests.cs`. Change the `using` block and `Setup` method:

```csharp
// Remove:
using Microsoft.Extensions.Configuration;

// Add:
using Microsoft.Extensions.Options;
using Brmble.Server.Auth;
```

Change the Setup method body from:
```csharp
var config = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Matrix:ServerDomain"] = "test.local"
    })
    .Build();
_repo = new UserRepository(_db, config);
```

To:
```csharp
var settings = Options.Create(new AuthSettings { ServerDomain = "test.local" });
_repo = new UserRepository(_db, settings);
```

**Step 2: Run tests to confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`
Expected: compile error — `UserRepository` constructor does not accept `IOptions<AuthSettings>`

**Step 3: Create `AuthSettings.cs`**

```csharp
namespace Brmble.Server.Auth;

public class AuthSettings
{
    public string ServerDomain { get; init; } = "localhost";
}
```

**Step 4: Update `UserRepository.cs`**

Change the `using` block (remove `IConfiguration`, add `IOptions`):
```csharp
// Remove:
using Microsoft.Extensions.Configuration;

// Add:
using Microsoft.Extensions.Options;
```

Change the constructor:
```csharp
// Before:
public UserRepository(Database db, IConfiguration configuration)
{
    _db = db;
    _serverDomain = configuration["Matrix:ServerDomain"] ?? "localhost";
}

// After:
public UserRepository(Database db, IOptions<AuthSettings> settings)
{
    _db = db;
    _serverDomain = settings.Value.ServerDomain;
}
```

**Step 5: Register options in `AuthExtensions.cs`**

```csharp
public static IServiceCollection AddAuth(this IServiceCollection services)
{
    services.AddOptions<AuthSettings>()
        .BindConfiguration("Auth")
        .ValidateDataAnnotations()
        .ValidateOnStart();

    services.AddSingleton<UserRepository>();
    services.AddSingleton<AuthService>();
    services.AddSingleton<IActiveBrmbleSessions>(sp => sp.GetRequiredService<AuthService>());
    services.AddSingleton<ICertificateHashExtractor, MtlsCertificateHashExtractor>();
    return services;
}
```

**Step 6: Run auth unit tests — expect all to pass**

Run: `dotnet test tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`
Expected: 5/5 pass

**Step 7: Commit**

```bash
git add src/Brmble.Server/Auth/AuthSettings.cs \
        src/Brmble.Server/Auth/UserRepository.cs \
        src/Brmble.Server/Auth/AuthExtensions.cs \
        tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "refactor: introduce AuthSettings options, remove IConfiguration from UserRepository"
```

---

### Task 2: Create `MatrixSettings` and wire up `MatrixAppService`

**Files:**
- Create: `src/Brmble.Server/Matrix/MatrixSettings.cs`
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs:1-5,21-28`
- Modify: `src/Brmble.Server/Matrix/MatrixExtensions.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs:5-6,28-36`

**Step 1: Update the test to use `IOptions<MatrixSettings>` (will fail to compile)**

In `MatrixAppServiceTests.cs`, change the `using` block:
```csharp
// Remove:
using Microsoft.Extensions.Configuration;

// Add:
using Microsoft.Extensions.Options;
```

Change the Setup method body from:
```csharp
var config = new ConfigurationBuilder()
    .AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Matrix:HomeserverUrl"] = "http://localhost:8008",
        ["Matrix:AppServiceToken"] = "test-token"
    })
    .Build();

_svc = new MatrixAppService(factory.Object, config);
```

To:
```csharp
var settings = Options.Create(new MatrixSettings
{
    HomeserverUrl = "http://localhost:8008",
    AppServiceToken = "test-token"
});

_svc = new MatrixAppService(factory.Object, settings);
```

**Step 2: Run tests to confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`
Expected: compile error — `MatrixAppService` constructor does not accept `IOptions<MatrixSettings>`

**Step 3: Create `MatrixSettings.cs`**

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

**Step 4: Update `MatrixAppService.cs`**

Change the `using` block:
```csharp
// Remove:
using Microsoft.Extensions.Configuration;

// Add:
using Microsoft.Extensions.Options;
```

Change the constructor:
```csharp
// Before:
public MatrixAppService(IHttpClientFactory httpClientFactory, IConfiguration configuration)
{
    _httpClientFactory = httpClientFactory;
    _homeserverUrl = configuration["Matrix:HomeserverUrl"]
        ?? throw new InvalidOperationException("Matrix:HomeserverUrl not configured");
    _appServiceToken = configuration["Matrix:AppServiceToken"]
        ?? throw new InvalidOperationException("Matrix:AppServiceToken not configured");
}

// After:
public MatrixAppService(IHttpClientFactory httpClientFactory, IOptions<MatrixSettings> settings)
{
    _httpClientFactory = httpClientFactory;
    _homeserverUrl = settings.Value.HomeserverUrl;
    _appServiceToken = settings.Value.AppServiceToken;
}
```

**Step 5: Register options in `MatrixExtensions.cs`**

```csharp
public static IServiceCollection AddMatrix(this IServiceCollection services)
{
    services.AddOptions<MatrixSettings>()
        .BindConfiguration("Matrix")
        .ValidateDataAnnotations()
        .ValidateOnStart();

    services.AddHttpClient();
    services.AddSingleton<ChannelRepository>();
    services.AddSingleton<IMatrixAppService, MatrixAppService>();
    services.AddSingleton<MatrixService>();
    services.AddSingleton<IMumbleEventHandler, MatrixEventHandler>();
    return services;
}
```

**Step 6: Run matrix unit tests — expect all to pass**

Run: `dotnet test tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`
Expected: 5/5 pass

**Step 7: Commit**

```bash
git add src/Brmble.Server/Matrix/MatrixSettings.cs \
        src/Brmble.Server/Matrix/MatrixAppService.cs \
        src/Brmble.Server/Matrix/MatrixExtensions.cs \
        tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs
git commit -m "refactor: introduce MatrixSettings options, remove IConfiguration from MatrixAppService"
```

---

### Task 3: Fix failing integration tests

The `AuthIntegrationTests` fail because the test's in-memory config doesn't include `Matrix:HomeserverUrl` and `Matrix:AppServiceToken` — the full ASP.NET Core app now validates these at startup via `ValidateOnStart()`.

**Files:**
- Modify: `tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs:33-41,80-88`

**Step 1: Run full test suite to see current baseline**

Run: `dotnet test tests/Brmble.Server.Tests`
Expected: 3 tests fail with `OptionsValidationException` (was `InvalidOperationException`) on startup

**Step 2: Add required Matrix config + Auth config to both factories in `AuthIntegrationTests.cs`**

In the main `_factory` setup (constructor, lines 33–41), add the missing keys:
```csharp
config.AddInMemoryCollection(new Dictionary<string, string?>
{
    ["ConnectionStrings:Default"] = cs,
    ["Auth:ServerDomain"] = "test.local",          // NEW — replaces Matrix:ServerDomain for auth
    ["Matrix:ServerDomain"] = "test.local",         // keep for Matrix bridge
    ["Matrix:HomeserverUrl"] = "http://localhost:1", // NEW — satisfies ValidateOnStart
    ["Matrix:AppServiceToken"] = "test-token",      // NEW — satisfies ValidateOnStart
    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
});
```

In `noCertFactory` setup (lines 80–88), make the same additions.

**Step 3: Run full test suite — expect 0 failures**

Run: `dotnet test tests/Brmble.Server.Tests`
Expected: 66/66 pass (was 3 failures)

**Step 4: Commit**

```bash
git add tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
git commit -m "fix: provide required Matrix config in integration tests after ValidateOnStart"
```

---

### Task 4: Full verification

**Step 1: Run all tests**

Run: `dotnet test`
Expected: 57 + 66 = 123 tests pass, 0 failures

**Step 2: Build**

Run: `dotnet build`
Expected: Build succeeded, 0 errors, 0 warnings about IConfiguration in auth/matrix services
