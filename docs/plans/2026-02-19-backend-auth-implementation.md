# Backend Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the core certificate-based identity flow in Brmble.Server — UserRepository CRUD, AuthService authentication/session management, ICertificateHashExtractor abstraction, and POST /auth/token endpoint.

**Architecture:** TDD bottom-up: cert extraction abstraction → data layer → service layer → endpoint. Matrix provisioning is stubbed (`stub_token_{userId}`). `ICertificateHashExtractor` interface separates real mTLS from a test fake injected via DI. In-memory SQLite tests use the keep-alive pattern from `DatabaseTests` (named shared-cache connection held open for the test's lifetime).

**Tech Stack:** ASP.NET Core Minimal APIs, SQLite + Dapper, MSTest, `WebApplicationFactory<Program>`

---

### Task 0: Create git worktree

**Files:** N/A — shell only

**Step 1: Create worktree and branch from repo root**

```bash
cd /c/dev/brmble/brmble
git worktree add ../brmble-backend-auth -b feature/backend-auth
```

Expected: `Preparing worktree (new branch 'feature/backend-auth')`

**Step 2: Verify**

```bash
git worktree list
```

Expected: two entries — main repo and `../brmble-backend-auth` on `feature/backend-auth`

All subsequent work happens in `/c/dev/brmble/brmble-backend-auth`.

---

### Task 1: ICertificateHashExtractor interface + MtlsCertificateHashExtractor

**Files:**
- Create: `src/Brmble.Server/Auth/ICertificateHashExtractor.cs`
- Modify: `src/Brmble.Server/Auth/AuthExtensions.cs`

**Step 1: Create the file**

```csharp
// src/Brmble.Server/Auth/ICertificateHashExtractor.cs
using System.Security.Cryptography;

namespace Brmble.Server.Auth;

public interface ICertificateHashExtractor
{
    string? GetCertHash(HttpContext context);
}

public class MtlsCertificateHashExtractor : ICertificateHashExtractor
{
    public string? GetCertHash(HttpContext context)
    {
        var cert = context.Connection.ClientCertificate;
        return cert?.GetCertHashString(HashAlgorithmName.SHA1).ToLowerInvariant();
    }
}
```

**Step 2: Register in AuthExtensions.cs** — add one line to `AddAuth`:

```csharp
services.AddSingleton<ICertificateHashExtractor, MtlsCertificateHashExtractor>();
```

Full file after edit:

```csharp
namespace Brmble.Server.Auth;

public static class AuthExtensions
{
    public static IServiceCollection AddAuth(this IServiceCollection services)
    {
        services.AddSingleton<UserRepository>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<IActiveBrmbleSessions>(sp => sp.GetRequiredService<AuthService>());
        services.AddSingleton<ICertificateHashExtractor, MtlsCertificateHashExtractor>();
        return services;
    }
}
```

**Step 3: Build to verify**

```bash
dotnet build src/Brmble.Server/Brmble.Server.csproj
```

Expected: `Build succeeded`

**Step 4: Run existing tests — no regressions**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all tests pass

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/ICertificateHashExtractor.cs src/Brmble.Server/Auth/AuthExtensions.cs
git commit -m "feat: add ICertificateHashExtractor interface and mTLS implementation"
```

---

### Task 2: FakeCertificateHashExtractor in test project

**Files:**
- Create: `tests/Brmble.Server.Tests/Auth/FakeCertificateHashExtractor.cs`

**Step 1: Create the fake**

```csharp
// tests/Brmble.Server.Tests/Auth/FakeCertificateHashExtractor.cs
using Brmble.Server.Auth;

namespace Brmble.Server.Tests.Auth;

internal class FakeCertificateHashExtractor : ICertificateHashExtractor
{
    private readonly string? _hash;

    public FakeCertificateHashExtractor(string? hash)
    {
        _hash = hash;
    }

    public string? GetCertHash(HttpContext context) => _hash;
}
```

**Step 2: Build test project**

```bash
dotnet build tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: `Build succeeded`

**Step 3: Commit**

```bash
git add tests/Brmble.Server.Tests/Auth/FakeCertificateHashExtractor.cs
git commit -m "test: add FakeCertificateHashExtractor for endpoint testing"
```

---

### Task 3: UserRepository.GetByCertHash

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Replace UserRepositoryTests.cs with tests including keep-alive pattern**

The keep-alive connection (see `DatabaseTests`) prevents the named shared-cache in-memory DB from being dropped between operations.

```csharp
// tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class UserRepositoryTests
{
    private SqliteConnection? _keepAlive;
    private Database? _db;
    private UserRepository? _repo;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "userrepo_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        _db = new Database(cs);
        _db.Initialize();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Matrix:ServerDomain"] = "test.local"
            })
            .Build();
        _repo = new UserRepository(_db, config);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void Constructor_WithValidDatabase_DoesNotThrow()
    {
        Assert.IsNotNull(_repo);
    }

    [TestMethod]
    public async Task GetByCertHash_UnknownHash_ReturnsNull()
    {
        var result = await _repo!.GetByCertHash("nonexistent");
        Assert.IsNull(result);
    }

    [TestMethod]
    public async Task GetByCertHash_ExistingUser_ReturnsUser()
    {
        var inserted = await _repo!.Insert("abc123", "TestUser");
        var found = await _repo.GetByCertHash("abc123");
        Assert.IsNotNull(found);
        Assert.AreEqual(inserted.Id, found.Id);
        Assert.AreEqual("abc123", found.CertHash);
        Assert.AreEqual("TestUser", found.DisplayName);
    }
}
```

**Step 2: Run tests to verify they fail (Insert doesn't exist yet)**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests"
```

Expected: build errors — `UserRepository` constructor doesn't accept `IConfiguration`, `GetByCertHash` and `Insert` don't exist

**Step 3: Update UserRepository.cs — add IConfiguration, add GetByCertHash**

```csharp
// src/Brmble.Server/Auth/UserRepository.cs
using Dapper;
using Brmble.Server.Data;
using Microsoft.Extensions.Configuration;

namespace Brmble.Server.Auth;

public record User(int Id, string CertHash, string DisplayName, string MatrixUserId);

public class UserRepository
{
    private readonly Database _db;
    private readonly string _serverDomain;

    public UserRepository(Database db, IConfiguration configuration)
    {
        _db = db;
        _serverDomain = configuration["Matrix:ServerDomain"] ?? "localhost";
    }

    public async Task<User?> GetByCertHash(string certHash)
    {
        using var conn = _db.CreateConnection();
        return await conn.QuerySingleOrDefaultAsync<User>(
            """
            SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId
            FROM users
            WHERE cert_hash = @CertHash
            """,
            new { CertHash = certHash });
    }

    // TODO: Insert(string certHash, string displayName) → User
    // TODO: UpdateDisplayName(int id, string displayName)
}
```

**Step 4: Run GetByCertHash_UnknownHash_ReturnsNull**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GetByCertHash_UnknownHash_ReturnsNull"
```

Expected: PASS

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass except `GetByCertHash_ExistingUser_ReturnsUser` (Insert not yet implemented)

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: add UserRepository.GetByCertHash with IConfiguration injection"
```

---

### Task 4: UserRepository.Insert

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Add Insert test to UserRepositoryTests.cs**

Add after `GetByCertHash_ExistingUser_ReturnsUser`:

```csharp
[TestMethod]
public async Task Insert_NewUser_PersistsToDatabase()
{
    var user = await _repo!.Insert("deadbeef", "Alice");
    Assert.IsTrue(user.Id > 0);
    Assert.AreEqual("deadbeef", user.CertHash);
    Assert.AreEqual("Alice", user.DisplayName);
    Assert.AreEqual($"@{user.Id}:test.local", user.MatrixUserId);
}
```

**Step 2: Run to verify it fails**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "Insert_NewUser_PersistsToDatabase"
```

Expected: build error — `Insert` does not exist

**Step 3: Implement Insert in UserRepository.cs**

Add after `GetByCertHash`:

```csharp
public async Task<User> Insert(string certHash, string displayName)
{
    using var conn = _db.CreateConnection();
    conn.Open();
    using var tx = conn.BeginTransaction();

    await conn.ExecuteAsync(
        "INSERT INTO users (cert_hash, display_name, matrix_user_id) VALUES (@CertHash, @DisplayName, 'pending')",
        new { CertHash = certHash, DisplayName = displayName },
        tx);

    var id = await conn.QuerySingleAsync<int>("SELECT last_insert_rowid()", transaction: tx);
    var matrixUserId = $"@{id}:{_serverDomain}";

    await conn.ExecuteAsync(
        "UPDATE users SET matrix_user_id = @MatrixUserId WHERE id = @Id",
        new { MatrixUserId = matrixUserId, Id = id },
        tx);

    tx.Commit();
    return new User(id, certHash, displayName, matrixUserId);
}
```

**Step 4: Run all UserRepository tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests"
```

Expected: all 4 tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: implement UserRepository.Insert with two-step matrix_user_id generation"
```

---

### Task 5: UserRepository.UpdateDisplayName

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Add UpdateDisplayName test**

Add to `UserRepositoryTests.cs`:

```csharp
[TestMethod]
public async Task UpdateDisplayName_ExistingUser_UpdatesRecord()
{
    var user = await _repo!.Insert("cafebabe", "OldName");
    await _repo.UpdateDisplayName(user.Id, "NewName");
    var updated = await _repo.GetByCertHash("cafebabe");
    Assert.AreEqual("NewName", updated!.DisplayName);
}
```

**Step 2: Run to verify it fails**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UpdateDisplayName"
```

Expected: build error — `UpdateDisplayName` does not exist

**Step 3: Implement UpdateDisplayName in UserRepository.cs**

Add after `Insert`:

```csharp
public async Task UpdateDisplayName(int id, string displayName)
{
    using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
        "UPDATE users SET display_name = @DisplayName WHERE id = @Id",
        new { DisplayName = displayName, Id = id });
}
```

**Step 4: Run all UserRepository tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests"
```

Expected: all 5 tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: implement UserRepository.UpdateDisplayName"
```

---

### Task 6: AuthResult + AuthService.Authenticate + AuthService.Deactivate

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`

**Step 1: Replace AuthServiceTests.cs with updated helper + new tests**

The `CreateService()` helper needs keep-alive, `IConfiguration`, and `db.Initialize()`:

```csharp
// tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class AuthServiceTests
{
    private SqliteConnection? _keepAlive;
    private AuthService? _svc;

    [TestInitialize]
    public void Setup()
    {
        var dbName = "authsvc_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";
        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();
        var db = new Database(cs);
        db.Initialize();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Matrix:ServerDomain"] = "test.local"
            })
            .Build();
        var repo = new UserRepository(db, config);
        _svc = new AuthService(repo);
    }

    [TestCleanup]
    public void Cleanup() => _keepAlive?.Dispose();

    [TestMethod]
    public void IsBrmbleClient_UnknownHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient("unknown-cert-hash"));
    }

    [TestMethod]
    public void IsBrmbleClient_EmptyHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient(string.Empty));
    }

    [TestMethod]
    public void IsBrmbleClient_NullHash_ReturnsFalse()
    {
        Assert.IsFalse(_svc!.IsBrmbleClient(null!));
    }

    [TestMethod]
    public async Task Authenticate_NewUser_AddsToActiveSessions()
    {
        await _svc!.Authenticate("newhash", "Alice");
        Assert.IsTrue(_svc.IsBrmbleClient("newhash"));
    }

    [TestMethod]
    public async Task Authenticate_NewUser_ReturnsStubToken()
    {
        var result = await _svc!.Authenticate("somehash", "Bob");
        StringAssert.StartsWith(result.MatrixAccessToken, "stub_token_");
    }

    [TestMethod]
    public async Task Authenticate_ExistingUser_StillAddsToActiveSessions()
    {
        await _svc!.Authenticate("existinghash", "Charlie");
        _svc.Deactivate("existinghash");
        await _svc.Authenticate("existinghash", "Charlie");
        Assert.IsTrue(_svc.IsBrmbleClient("existinghash"));
    }

    [TestMethod]
    public async Task Deactivate_AfterAuthenticate_RemovesFromActiveSessions()
    {
        await _svc!.Authenticate("todeactivate", "Dave");
        _svc.Deactivate("todeactivate");
        Assert.IsFalse(_svc.IsBrmbleClient("todeactivate"));
    }
}
```

**Step 2: Run to verify they fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthServiceTests"
```

Expected: build errors — `AuthResult` doesn't exist, `Authenticate` and `Deactivate` don't exist

**Step 3: Replace AuthService.cs with full implementation**

```csharp
// src/Brmble.Server/Auth/AuthService.cs
namespace Brmble.Server.Auth;

public record AuthResult(string MatrixAccessToken);

public interface IActiveBrmbleSessions
{
    bool IsBrmbleClient(string certHash);
}

public class AuthService : IActiveBrmbleSessions
{
    private readonly UserRepository _userRepository;
    private readonly HashSet<string> _activeSessions = [];
    private readonly object _lock = new();

    public AuthService(UserRepository userRepository)
    {
        _userRepository = userRepository;
    }

    public bool IsBrmbleClient(string certHash) => _activeSessions.Contains(certHash);

    public async Task<AuthResult> Authenticate(string certHash, string displayName)
    {
        var user = await _userRepository.GetByCertHash(certHash);

        if (user is null)
        {
            user = await _userRepository.Insert(certHash, displayName);
        }
        else if (user.DisplayName != displayName)
        {
            await _userRepository.UpdateDisplayName(user.Id, displayName);
        }

        lock (_lock)
        {
            _activeSessions.Add(certHash);
        }

        return new AuthResult($"stub_token_{user.Id}");
    }

    public void Deactivate(string certHash)
    {
        lock (_lock)
        {
            _activeSessions.Remove(certHash);
        }
    }
}
```

**Step 4: Run AuthService tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthServiceTests"
```

Expected: all 7 tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthService.cs tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
git commit -m "feat: implement AuthService.Authenticate and Deactivate with stub Matrix token"
```

---

### Task 7: POST /auth/token endpoint + integration tests

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Create: `tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs`

**Step 1: Create AuthIntegrationTests.cs with keep-alive pattern**

The `WebApplicationFactory` gets a shared-cache SQLite name, and the test class holds a `_keepAlive` connection open for the full test lifetime so the DB survives across HTTP calls:

```csharp
// tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Tests.Auth;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthIntegrationTests : IDisposable
{
    private readonly SqliteConnection _keepAlive;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public AuthIntegrationTests()
    {
        var dbName = "auth_int_" + Guid.NewGuid().ToString("N");
        var cs = $"Data Source={dbName};Mode=Memory;Cache=Shared";

        _keepAlive = new SqliteConnection(cs);
        _keepAlive.Open();

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(config =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = cs,
                    ["Matrix:ServerDomain"] = "test.local",
                    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                });
            });
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ICertificateHashExtractor>(
                    new FakeCertificateHashExtractor("aabbccddeeff001122334455"));
            });
        });

        _client = _factory.CreateClient();
    }

    [TestMethod]
    public async Task PostToken_ValidRequest_ReturnsOk()
    {
        var response = await _client.PostAsJsonAsync("/auth/token", new { displayName = "Alice" });
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public async Task PostToken_ValidRequest_ReturnsStubToken()
    {
        var response = await _client.PostAsJsonAsync("/auth/token", new { displayName = "Alice" });
        var body = await response.Content.ReadAsStringAsync();
        StringAssert.Contains(body, "matrixAccessToken");
        StringAssert.Contains(body, "stub_token_");
    }

    [TestMethod]
    public async Task PostToken_NoCertificate_ReturnsBadRequest()
    {
        var dbName2 = "auth_nocert_" + Guid.NewGuid().ToString("N");
        using var keepAlive2 = new SqliteConnection($"Data Source={dbName2};Mode=Memory;Cache=Shared");
        keepAlive2.Open();

        using var noCertFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration(config =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Default"] = $"Data Source={dbName2};Mode=Memory;Cache=Shared",
                    ["Matrix:ServerDomain"] = "test.local",
                    ["ReverseProxy:Routes:placeholder:ClusterId"] = "placeholder",
                    ["ReverseProxy:Routes:placeholder:Match:Path"] = "/__placeholder/{**catch-all}",
                    ["ReverseProxy:Clusters:placeholder:Destinations:d1:Address"] = "http://localhost:1",
                });
            });
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ICertificateHashExtractor>(
                    new FakeCertificateHashExtractor(null));
            });
        });

        using var noCertClient = noCertFactory.CreateClient();
        var response = await noCertClient.PostAsJsonAsync("/auth/token", new { displayName = "Alice" });
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        _keepAlive.Dispose();
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthIntegrationTests"
```

Expected: `PostToken_ValidRequest_ReturnsOk` and `PostToken_ValidRequest_ReturnsStubToken` fail with `405 Method Not Allowed` or `404` (endpoint not mapped); `PostToken_NoCertificate_ReturnsBadRequest` fails similarly

**Step 3: Implement POST /auth/token in AuthEndpoints.cs**

```csharp
// src/Brmble.Server/Auth/AuthEndpoints.cs
namespace Brmble.Server.Auth;

public record AuthTokenRequest(string DisplayName);

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            HttpContext httpContext,
            AuthTokenRequest request,
            ICertificateHashExtractor certHashExtractor,
            AuthService authService) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (certHash is null)
                return Results.BadRequest("No client certificate presented.");

            var result = await authService.Authenticate(certHash, request.DisplayName);
            return Results.Ok(new { matrixAccessToken = result.MatrixAccessToken });
        });

        return app;
    }
}
```

**Step 4: Run auth integration tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthIntegrationTests"
```

Expected: all 3 tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
git commit -m "feat: implement POST /auth/token endpoint"
```

---

### Task 8: Final verification

**Step 1: Build full solution**

```bash
dotnet build
```

Expected: `Build succeeded, 0 Warning(s), 0 Error(s)`

**Step 2: Run all tests**

```bash
dotnet test
```

Expected: all tests pass

**Step 3: Verify branch commits**

```bash
git log --oneline main..feature/backend-auth
```

Expected: 7 commits from this feature branch only

---

## Notes for Reviewer

- `Matrix:ServerDomain` must be present in `appsettings.json` (or environment config) for production deployments; the code defaults to `"localhost"` if absent
- The stub token `stub_token_{userId}` is intentionally obvious — grep for it when wiring real Continuwuity provisioning
- Display name sync on reconnect is intentional per spec (`docs/server/backend-auth-architecture.md` §3.3) but may need a policy review later
- LiveKit token generation is a follow-up branch (scope intentionally excluded)
