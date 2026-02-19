# Brmble.Server Test Project Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `tests/Brmble.Server.Tests` — an MSTest project covering all current Brmble.Server code with a coverage baseline enforced in CI, targeting 80% as stubs are implemented over time.

**Architecture:** Hybrid — unit tests for services/repositories using real in-memory SQLite or Moq where needed, plus WebApplicationFactory integration tests for HTTP endpoints and DI wiring. Coverlet enforces a line coverage threshold (currently set at 40%; raise to 80% as stubs are implemented).

**Tech Stack:** MSTest 3.7.3, Moq 4.20.72, Microsoft.AspNetCore.Mvc.Testing 10.x, coverlet.collector 6.0.4, Microsoft.Data.Sqlite (in-memory mode)

**Note on coverage:** Most server classes are currently stubs (TODOs only). The 80% target applies long-term. Today we scaffold the full test structure and test everything that currently has logic.

---

### Task 1: Create the test project

**Files:**
- Create: `tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

**Step 1: Create the csproj**

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="MSTest.TestAdapter" Version="3.7.3" />
    <PackageReference Include="MSTest.TestFramework" Version="3.7.3" />
    <PackageReference Include="Moq" Version="4.20.72" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.0" />
    <PackageReference Include="coverlet.collector" Version="6.0.4">
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Brmble.Server\Brmble.Server.csproj" />
  </ItemGroup>
</Project>
```

**Step 2: Restore and verify it builds**

```bash
dotnet restore tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
dotnet build tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: Build succeeded, 0 errors.

**Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
git commit -m "test: scaffold Brmble.Server.Tests project"
```

---

### Task 2: Expose Program and add coverlet settings

**Files:**
- Modify: `src/Brmble.Server/Program.cs`
- Create: `tests/Brmble.Server.Tests/coverlet.runsettings`

**Step 1: Add `public partial class Program {}` to Program.cs**

Append to the bottom of `src/Brmble.Server/Program.cs`:

```csharp
// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
```

This makes `Program` visible to the test assembly — necessary for `WebApplicationFactory<Program>`.

**Step 2: Create coverlet.runsettings**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat Code Coverage">
        <Configuration>
          <Format>cobertura</Format>
          <Include>[Brmble.Server]*</Include>
          <Exclude>[Brmble.Server.Tests]*</Exclude>
          <!-- TODO: Raise threshold to 80 as stubs in Brmble.Server are implemented -->
          <Threshold>40</Threshold>
          <ThresholdType>line</ThresholdType>
          <ThresholdStat>Total</ThresholdStat>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

**Step 3: Verify the server still builds**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

Expected: Build succeeded.

**Step 4: Commit**

```bash
git add src/Brmble.Server/Program.cs tests/Brmble.Server.Tests/coverlet.runsettings
git commit -m "test: expose Program for WebApplicationFactory, add coverlet settings"
```

---

### Task 3: Integration tests — health endpoint and DI wiring

**Files:**
- Create: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
- Create: `tests/Brmble.Server.Tests/Integration/ServerIntegrationTests.cs`

**Step 1: Create the test factory**

`tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`:

```csharp
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Brmble.Server.Tests.Integration;

internal class BrmbleServerFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(config =>
        {
            // Use in-memory SQLite so Database.Initialize() succeeds without a real file.
            // YARP ReverseProxy with no routes is valid — proxy just has nothing configured.
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = "Data Source=:memory:"
            });
        });
    }
}
```

**Step 2: Write the failing tests**

`tests/Brmble.Server.Tests/Integration/ServerIntegrationTests.cs`:

```csharp
using System.Net;
using Microsoft.Extensions.DependencyInjection;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ServerIntegrationTests : IDisposable
{
    private readonly BrmbleServerFactory _factory = new();
    private readonly HttpClient _client;

    public ServerIntegrationTests()
    {
        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task Health_ReturnsOk()
    {
        var response = await _client.GetAsync("/health");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task Health_ReturnsHealthyStatus()
    {
        var response = await _client.GetAsync("/health");
        var body = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(body, "healthy");
    }

    [TestMethod]
    public void DiWiring_AppBuildsWithoutException()
    {
        // Creating a scope verifies the DI container resolved without errors at startup
        using var scope = _factory.Services.CreateScope();
        Assert.IsNotNull(scope.ServiceProvider);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }
}
```

**Step 3: Run the tests to verify they pass**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Integration"
```

Expected: 3 passed.

If YARP throws a config error about missing routes, add a placeholder route to `BrmbleServerFactory`:
```csharp
["ReverseProxy:Routes:placeholder:RouteId"] = "placeholder",
["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
```

**Step 4: Commit**

```bash
git add tests/Brmble.Server.Tests/Integration/
git commit -m "test: add integration tests for health endpoint and DI wiring"
```

---

### Task 4: Database unit tests

**Files:**
- Create: `tests/Brmble.Server.Tests/Data/DatabaseTests.cs`

**Context:** `Database` uses `Microsoft.Data.Sqlite`. With `:memory:`, each connection gets a fresh isolated DB — tables created in one connection disappear when it closes. To test schema persistence across connections, use a shared-cache named in-memory database and keep one connection open as a "keep-alive".

**Step 1: Write the tests**

```csharp
using Brmble.Server.Data;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Brmble.Server.Tests.Data;

[TestClass]
public class DatabaseTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;

    [TestInitialize]
    public void Setup()
    {
        // Named shared-cache in-memory DB: persists as long as _keepAlive is open
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
    }

    [TestCleanup]
    public void Cleanup()
    {
        _keepAlive?.Dispose(); // releasing last connection drops the in-memory DB
    }

    [TestMethod]
    public void Initialize_CreatesUsersTable()
    {
        _db!.Initialize();

        using var conn = _db.CreateConnection();
        conn.Open();
        var count = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='users'");

        Assert.AreEqual(1, count);
    }

    [TestMethod]
    public void Initialize_CreatesChannelRoomMapTable()
    {
        _db!.Initialize();

        using var conn = _db.CreateConnection();
        conn.Open();
        var count = conn.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='channel_room_map'");

        Assert.AreEqual(1, count);
    }

    [TestMethod]
    public void Initialize_IsIdempotent()
    {
        _db!.Initialize();
        // CREATE TABLE IF NOT EXISTS — second call must not throw
        _db.Initialize();
    }

    [TestMethod]
    public void CreateConnection_ReturnsOpenableConnection()
    {
        using var conn = _db!.CreateConnection();
        conn.Open();
        Assert.AreEqual(System.Data.ConnectionState.Open, conn.State);
    }
}
```

**Step 2: Run the tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Data"
```

Expected: 4 passed.

**Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Data/
git commit -m "test: add Database unit tests with in-memory SQLite"
```

---

### Task 5: AuthService unit tests

**Files:**
- Create: `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`

**Context:** `AuthService.IsBrmbleClient` checks an internal `HashSet<string>`. Currently nothing adds to that set (Authenticate is a TODO), so any hash returns false. `UserRepository` is passed to the constructor but not used by `IsBrmbleClient` yet.

**Step 1: Write the tests**

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceTests
{
    private static AuthService CreateService()
    {
        var db = new Database("Data Source=:memory:");
        var repo = new UserRepository(db);
        return new AuthService(repo);
    }

    [TestMethod]
    public void IsBrmbleClient_UnknownHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient("unknown-cert-hash"));
    }

    [TestMethod]
    public void IsBrmbleClient_EmptyHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient(string.Empty));
    }

    [TestMethod]
    public void IsBrmbleClient_NullHash_ReturnsFalse()
    {
        var svc = CreateService();
        Assert.IsFalse(svc.IsBrmbleClient(null!));
    }

    // TODO: Add tests once Authenticate(certHash, displayName) is implemented:
    // - IsBrmbleClient_AfterAuthenticate_ReturnsTrue
    // - IsBrmbleClient_AfterDeactivate_ReturnsFalse
}
```

**Step 2: Run the tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Auth.AuthService"
```

Expected: 3 passed.

**Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
git commit -m "test: add AuthService unit tests"
```

---

### Task 6: MumbleIceService unit tests

**Files:**
- Create: `tests/Brmble.Server.Tests/Mumble/MumbleIceServiceTests.cs`

**Context:** Both `StartAsync` and `StopAsync` return `Task.CompletedTask` (stubs). `MumbleServerCallback` takes `IEnumerable<IMumbleEventHandler>` — pass an empty list.

**Step 1: Write the tests**

```csharp
using Brmble.Server.Mumble;

namespace Brmble.Server.Tests.Mumble;

[TestClass]
public class MumbleIceServiceTests
{
    private static MumbleIceService CreateService()
    {
        var callback = new MumbleServerCallback(Enumerable.Empty<IMumbleEventHandler>());
        return new MumbleIceService(callback);
    }

    [TestMethod]
    public async Task StartAsync_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StopAsync_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StopAsync(CancellationToken.None);
    }

    [TestMethod]
    public async Task StartThenStop_CompletesWithoutThrowing()
    {
        var svc = CreateService();
        await svc.StartAsync(CancellationToken.None);
        await svc.StopAsync(CancellationToken.None);
    }

    // TODO: Add tests as Ice integration is implemented:
    // - StartAsync_ConnectsToMumbleServer
    // - StopAsync_DisconnectsGracefully
}
```

**Step 2: Run the tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~Mumble"
```

Expected: 3 passed.

**Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Mumble/
git commit -m "test: add MumbleIceService unit tests"
```

---

### Task 7: Skeleton test classes for stub modules

**Files:**
- Create: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`
- Create: `tests/Brmble.Server.Tests/Matrix/MatrixServiceTests.cs`
- Create: `tests/Brmble.Server.Tests/Matrix/ChannelRepositoryTests.cs`
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

These are scaffolds only — one placeholder test each so the class is discovered. Expand each as the corresponding TODO methods are implemented.

**Step 1: Create UserRepositoryTests.cs**

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    // TODO: Add tests as methods are implemented in UserRepository:
    // - GetByCertHash_ExistingUser_ReturnsUser
    // - GetByCertHash_UnknownHash_ReturnsNull
    // - Insert_NewUser_PersistsToDatabase
    // - UpdateDisplayName_ExistingUser_UpdatesRecord

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        var db = new Database("Data Source=:memory:");
        var repo = new UserRepository(db);
        Assert.IsNotNull(repo);
    }
}
```

**Step 2: Create MatrixServiceTests.cs**

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Moq;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class MatrixServiceTests
{
    // TODO: Add tests as RelayMessage is implemented:
    // - RelayMessage_BrmbleClient_SkipsRelay (already dual-wrote)
    // - RelayMessage_UnmappedChannel_SkipsRelay
    // - RelayMessage_MappedChannel_PostsAsBot

    [TestMethod]
    public void Constructor_WithValidDependencies_DoesNotThrow()
    {
        var db = new Database("Data Source=:memory:");
        var channelRepo = new ChannelRepository(db);
        var appService = new MatrixAppService();
        var sessions = new Mock<IActiveBrmbleSessions>().Object;
        var svc = new MatrixService(channelRepo, appService, sessions);
        Assert.IsNotNull(svc);
    }
}
```

**Step 3: Create ChannelRepositoryTests.cs**

```csharp
using Brmble.Server.Data;
using Brmble.Server.Matrix;
using Microsoft.Data.Sqlite;

namespace Brmble.Server.Tests.Matrix;

[TestClass]
public class ChannelRepositoryTests
{
    // TODO: Add tests as methods are implemented in ChannelRepository:
    // - GetRoomId_ExistingMapping_ReturnsRoomId
    // - GetRoomId_UnknownChannel_ReturnsNull
    // - Insert_NewMapping_PersistsToDatabase
    // - Delete_ExistingMapping_RemovesRecord

    private SqliteConnection? _keepAlive;
    private Database? _db;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "testdb_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        var repo = new ChannelRepository(_db!);
        Assert.IsNotNull(repo);
    }
}
```

**Step 4: Create LiveKitServiceTests.cs**

```csharp
using Brmble.Server.LiveKit;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceTests
{
    // TODO: Add tests as GenerateToken is implemented:
    // - GenerateToken_ValidCertHash_ReturnsJwt
    // - GenerateToken_UnknownCertHash_ThrowsOrReturnsNull

    [TestMethod]
    public void Constructor_DoesNotThrow()
    {
        var svc = new LiveKitService();
        Assert.IsNotNull(svc);
    }
}
```

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs \
        tests/Brmble.Server.Tests/Matrix/ \
        tests/Brmble.Server.Tests/LiveKit/
git commit -m "test: add skeleton test classes for stub modules"
```

---

### Task 8: Run tests with coverage and verify report

**Step 1: Run with coverage**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj \
  --collect:"XPlat Code Coverage" \
  --settings tests/Brmble.Server.Tests/coverlet.runsettings
```

Expected: All tests pass. A `coverage.cobertura.xml` file is generated in a `TestResults/` directory.

**Step 2: Inspect the report (optional)**

Install the report generator tool if not already installed:
```bash
dotnet tool install -g dotnet-reportgenerator-globaltool
```

Generate an HTML report:
```bash
reportgenerator \
  -reports:"tests/Brmble.Server.Tests/TestResults/**/coverage.cobertura.xml" \
  -targetdir:"tests/Brmble.Server.Tests/CoverageReport" \
  -reporttypes:Html
```

Open `tests/Brmble.Server.Tests/CoverageReport/index.html` in a browser to review per-file coverage.

**Step 3: Adjust threshold if needed**

If coverage is above 40%, raise the `<Threshold>` in `coverlet.runsettings` to match actual coverage. Keep raising it as stubs are implemented, targeting 80%.

**Step 4: Final commit**

```bash
git add tests/Brmble.Server.Tests/coverlet.runsettings
git commit -m "test: verify coverage report, adjust threshold to match current baseline"
```

---

### Task 9: Add to CLAUDE.md build/test commands

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Verify the test command works end-to-end**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

This should already be covered by the existing `dotnet test` entry in CLAUDE.md. No change needed unless the project was excluded from the repo-wide test run.

**Step 2: Commit if CLAUDE.md was updated**

```bash
git add CLAUDE.md
git commit -m "docs: update test commands for Brmble.Server.Tests"
```
