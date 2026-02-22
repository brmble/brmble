# Matrix Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provision per-user Matrix accounts and deliver `server.credentials` to the React frontend via the C# bridge, enabling PR 2 (matrix-js-sdk frontend integration).

**Architecture:** Brmble.Server gains two endpoints (`GET /server-info`, extended `POST /auth/token`) and Matrix user provisioning via the Continuwuity appservice API. Brmble.Client gains dual-mode connect: Flow A discovers the Brmble server URL from Mumble's welcome text; Flow B calls `/server-info` first. Both flows end with a `server.credentials` bridge message sent to the frontend.

**Tech Stack:** ASP.NET Core 10, Dapper + SQLite, MSTest + Moq, MumbleSharp, WebView2 bridge

---

## Task 1: Fix appservice namespace

The appservice is registered with `users: []`, which causes `m.login.application_service` to fail. Add a regex covering Brmble's numeric user IDs.

**Files:**
- Modify: `src/Brmble.Server/docker/register-appservice.sh`

**Step 1: Update the YAML block in the script**

Find this block (around line 91):
```sh
YAML="id: brmble
url: ~
as_token: \"${MATRIX_APPSERVICE_TOKEN}\"
hs_token: \"${MATRIX_APPSERVICE_TOKEN}\"
sender_localpart: brmble
namespaces:
  users: []
  rooms: []
  aliases: []
rate_limited: false"
```

Replace `users: []` with the user namespace:
```sh
YAML="id: brmble
url: ~
as_token: \"${MATRIX_APPSERVICE_TOKEN}\"
hs_token: \"${MATRIX_APPSERVICE_TOKEN}\"
sender_localpart: brmble
namespaces:
  users:
    - exclusive: true
      regex: '@[0-9]+:${MATRIX_SERVER_NAME}'
  rooms: []
  aliases: []
rate_limited: false"
```

**Step 2: Verify the change looks correct**

Run: `grep -A 4 "namespaces:" src/Brmble.Server/docker/register-appservice.sh`
Expected: shows `exclusive: true` and the regex line.

**Step 3: Commit**

```bash
git add src/Brmble.Server/docker/register-appservice.sh
git commit -m "fix: add user namespace to appservice registration"
```

> **Note for deployment:** The appservice re-registers only if `/data/.appservice-registered` sentinel is absent. On the production server, delete the sentinel file and restart the container to re-register with the updated namespace.

---

## Task 2: DB migration — add `matrix_access_token` column

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs`
- Test: `tests/Brmble.Server.Tests/Data/DatabaseTests.cs` (create if absent)

**Step 1: Write the failing test**

Create `tests/Brmble.Server.Tests/Data/DatabaseTests.cs`:
```csharp
using Brmble.Server.Data;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Data;

[TestClass]
public class DatabaseTests
{
    [TestMethod]
    public void Initialize_CreatesUsersTableWithMatrixAccessTokenColumn()
    {
        var cs = $"Data Source=db_schema_{Guid.NewGuid():N};Mode=Memory;Cache=Shared";
        using var keepAlive = new SqliteConnection(cs);
        keepAlive.Open();

        var db = new Database(cs);
        db.Initialize();

        using var conn = new SqliteConnection(cs);
        var columns = conn.Query<string>(
            "SELECT name FROM pragma_table_info('users')").ToList();

        CollectionAssert.Contains(columns, "matrix_access_token");
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "DatabaseTests.Initialize_CreatesUsersTableWithMatrixAccessTokenColumn" -v minimal`
Expected: FAIL — `matrix_access_token` column not found.

**Step 3: Add the column to the schema**

In `src/Brmble.Server/Data/Database.cs`, update the `CREATE TABLE IF NOT EXISTS users` statement to add the new column after `matrix_user_id`:

```csharp
conn.Execute("""
    CREATE TABLE IF NOT EXISTS users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        cert_hash       TEXT NOT NULL UNIQUE,
        display_name    TEXT NOT NULL,
        matrix_user_id  TEXT NOT NULL UNIQUE,
        matrix_access_token TEXT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS channel_room_map (
        mumble_channel_id  INTEGER NOT NULL,
        matrix_room_id     TEXT NOT NULL UNIQUE,
        created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (mumble_channel_id)
    );
    """);
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "DatabaseTests" -v minimal`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Data/Database.cs tests/Brmble.Server.Tests/Data/DatabaseTests.cs
git commit -m "feat: add matrix_access_token column to users table"
```

---

## Task 3: Update `UserRepository` — add token field and update method

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Step 1: Write the failing test**

Add to `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs` (follow the existing test class setup pattern — in-memory SQLite, `_keepAlive` connection):

```csharp
[TestMethod]
public async Task UpdateMatrixToken_StoresToken()
{
    var user = await _repo!.Insert("hash_token_test", "Alice");
    await _repo.UpdateMatrixToken(user.Id, "syt_abc123");
    var updated = await _repo.GetByCertHash("hash_token_test");
    Assert.AreEqual("syt_abc123", updated!.MatrixAccessToken);
}

[TestMethod]
public async Task Insert_NewUser_MatrixAccessTokenIsNull()
{
    var user = await _repo!.Insert("hash_null_token", "Bob");
    Assert.IsNull(user.MatrixAccessToken);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests" -v minimal`
Expected: FAIL — `MatrixAccessToken` property does not exist.

**Step 3: Update `UserRepository`**

In `src/Brmble.Server/Auth/UserRepository.cs`:

1. Update the `User` record:
```csharp
public record User(long Id, string CertHash, string DisplayName, string MatrixUserId, string? MatrixAccessToken);
```

2. Update `GetByCertHash` SELECT to include the new column:
```csharp
"SELECT id AS Id, cert_hash AS CertHash, display_name AS DisplayName, matrix_user_id AS MatrixUserId, matrix_access_token AS MatrixAccessToken FROM users WHERE cert_hash = @CertHash"
```

3. Update `Insert` to include the new column in SELECT after tx.Commit():
```csharp
return new User(id, certHash, finalDisplayName, matrixUserId, null);
```

4. Add the new method:
```csharp
public async Task UpdateMatrixToken(long id, string token)
{
    using var conn = _db.CreateConnection();
    await conn.ExecuteAsync(
        "UPDATE users SET matrix_access_token = @Token WHERE id = @Id",
        new { Token = token, Id = id });
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests" -v minimal`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: add MatrixAccessToken to User record and UpdateMatrixToken method"
```

---

## Task 4: Add `ChannelRepository.GetAll()`

**Files:**
- Modify: `src/Brmble.Server/Matrix/ChannelRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/ChannelRepositoryTests.cs`

**Step 1: Write the failing test**

Add to the existing `ChannelRepositoryTests.cs` test class:

```csharp
[TestMethod]
public void GetAll_ReturnsAllMappings()
{
    _repo!.Insert(1, "!room1:server");
    _repo.Insert(2, "!room2:server");

    var all = _repo.GetAll();

    Assert.AreEqual(2, all.Count);
    Assert.IsTrue(all.Any(m => m.MumbleChannelId == 1 && m.MatrixRoomId == "!room1:server"));
    Assert.IsTrue(all.Any(m => m.MumbleChannelId == 2 && m.MatrixRoomId == "!room2:server"));
}

[TestMethod]
public void GetAll_Empty_ReturnsEmptyList()
{
    Assert.AreEqual(0, _repo!.GetAll().Count);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ChannelRepositoryTests" -v minimal`
Expected: FAIL — `GetAll` method not found.

**Step 3: Add `GetAll()` to `ChannelRepository`**

```csharp
public List<ChannelRoomMapping> GetAll()
{
    using var conn = _db.CreateConnection();
    return conn.Query<ChannelRoomMapping>(
        "SELECT mumble_channel_id AS MumbleChannelId, matrix_room_id AS MatrixRoomId FROM channel_room_map")
        .ToList();
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ChannelRepositoryTests" -v minimal`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Matrix/ChannelRepository.cs tests/Brmble.Server.Tests/Matrix/ChannelRepositoryTests.cs
git commit -m "feat: add GetAll to ChannelRepository"
```

---

## Task 5: Add `RegisterUser` and `LoginUser` to `MatrixAppService`

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs`
- Modify: `tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs`

**Step 1: Write the failing tests**

Add to `MatrixAppServiceTests.cs` (using the existing `SetupHttpResponse` helper):

```csharp
[TestMethod]
public async Task RegisterUser_PostsToRegisterEndpoint_ReturnsToken()
{
    SetupHttpResponse(HttpStatusCode.OK,
        """{"access_token":"syt_test","user_id":"@1:server","device_id":"DEV"}""");

    var token = await _svc.RegisterUser("1", "Alice");

    Assert.AreEqual("syt_test", token);
    var req = _capturedRequests.Single();
    Assert.AreEqual(HttpMethod.Post, req.Method);
    StringAssert.Contains(req.RequestUri!.AbsoluteUri, "register");
    StringAssert.Contains(req.RequestUri.Query, "kind=user");
}

[TestMethod]
public async Task LoginUser_PostsToLoginEndpoint_ReturnsToken()
{
    SetupHttpResponse(HttpStatusCode.OK,
        """{"access_token":"syt_refreshed","user_id":"@1:server","device_id":"DEV2"}""");

    var token = await _svc.LoginUser("1");

    Assert.AreEqual("syt_refreshed", token);
    var req = _capturedRequests.Single();
    Assert.AreEqual(HttpMethod.Post, req.Method);
    StringAssert.Contains(req.RequestUri!.AbsoluteUri, "login");
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MatrixAppServiceTests" -v minimal`
Expected: FAIL — methods not found.

**Step 3: Add the methods to `IMatrixAppService` and `MatrixAppService`**

Add to `IMatrixAppService`:
```csharp
Task<string> RegisterUser(string localpart, string displayName);
Task<string> LoginUser(string localpart);
```

Add to `MatrixAppService` (use the existing `SendRequest` helper):
```csharp
public async Task<string> RegisterUser(string localpart, string displayName)
{
    var url = $"{_homeserverUrl}/_matrix/client/v3/register?kind=user";
    var body = JsonSerializer.Serialize(new { username = localpart });
    var response = await SendRequest(HttpMethod.Post, url, body);
    var json = JsonSerializer.Deserialize<JsonElement>(response);
    return json.GetProperty("access_token").GetString()
        ?? throw new InvalidOperationException("Matrix did not return an access_token");
}

public async Task<string> LoginUser(string localpart)
{
    var url = $"{_homeserverUrl}/_matrix/client/v3/login";
    var body = JsonSerializer.Serialize(new
    {
        type = "m.login.application_service",
        identifier = new { type = "m.id.user", user = $"@{localpart}:{_serverDomain}" }
    });
    var response = await SendRequest(HttpMethod.Post, url, body);
    var json = JsonSerializer.Deserialize<JsonElement>(response);
    return json.GetProperty("access_token").GetString()
        ?? throw new InvalidOperationException("Matrix did not return an access_token");
}
```

`MatrixAppService` needs `_serverDomain`. Add it as a field:
```csharp
private readonly string _serverDomain;
```
And initialise in the constructor from `settings.Value.ServerDomain`.

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MatrixAppServiceTests" -v minimal`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/Matrix/MatrixAppService.cs tests/Brmble.Server.Tests/Matrix/MatrixAppServiceTests.cs
git commit -m "feat: add RegisterUser and LoginUser to MatrixAppService"
```

---

## Task 6: Update `AuthService` — replace stub with real Matrix provisioning

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs`
- Modify: `src/Brmble.Server/Auth/AuthExtensions.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`

**Step 1: Write the failing tests**

Add to `AuthServiceTests.cs`. The setup needs a mock `IMatrixAppService`. Update `Setup()` and add new tests:

Update the class to inject a mock `IMatrixAppService`:
```csharp
private Mock<IMatrixAppService>? _mockMatrix;
```

Update `Setup()` to wire it in:
```csharp
_mockMatrix = new Mock<IMatrixAppService>();
_mockMatrix.Setup(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()))
           .ReturnsAsync("syt_new_token");
_mockMatrix.Setup(m => m.LoginUser(It.IsAny<string>()))
           .ReturnsAsync("syt_refresh_token");
_svc = new AuthService(repo, _mockMatrix.Object);
```

Add the new tests:
```csharp
[TestMethod]
public async Task Authenticate_NewUser_CallsRegisterAndStoresToken()
{
    var result = await _svc!.Authenticate("newhash_matrix");
    Assert.AreEqual("syt_new_token", result.MatrixAccessToken);
    _mockMatrix!.Verify(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
}

[TestMethod]
public async Task Authenticate_ExistingUserWithToken_ReturnsStoredToken()
{
    // First call provisions and stores token
    await _svc!.Authenticate("existing_hash");

    // Second call should return stored token, not call RegisterUser again
    var result = await _svc.Authenticate("existing_hash");
    Assert.AreEqual("syt_new_token", result.MatrixAccessToken);
    _mockMatrix!.Verify(m => m.RegisterUser(It.IsAny<string>(), It.IsAny<string>()), Times.Once);
}

[TestMethod]
public async Task Authenticate_ExistingUserWithoutToken_CallsLoginUser()
{
    // Insert user directly without a token
    await _repo!.Insert("notokhash", "TestUser");

    var result = await _svc!.Authenticate("notokhash");
    Assert.AreEqual("syt_refresh_token", result.MatrixAccessToken);
    _mockMatrix!.Verify(m => m.LoginUser(It.IsAny<string>()), Times.Once);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthServiceTests" -v minimal`
Expected: FAIL — `AuthService` constructor doesn't accept `IMatrixAppService`.

**Step 3: Update `AuthService`**

Update `AuthResult`:
```csharp
public record AuthResult(string MatrixUserId, string MatrixAccessToken);
```

Update `AuthService` constructor to accept `IMatrixAppService`:
```csharp
public AuthService(UserRepository userRepository, IMatrixAppService matrixAppService)
{
    _userRepository = userRepository;
    _matrixAppService = matrixAppService;
}
private readonly IMatrixAppService _matrixAppService;
```

Update `Authenticate()`:
```csharp
public async Task<AuthResult> Authenticate(string certHash)
{
    var user = await _userRepository.GetByCertHash(certHash);

    if (user is null)
    {
        _pendingNames.TryRemove(certHash, out var pendingName);
        user = await _userRepository.Insert(certHash, pendingName);
        var token = await _matrixAppService.RegisterUser(user.Id.ToString(), user.DisplayName);
        await _userRepository.UpdateMatrixToken(user.Id, token);
        user = user with { MatrixAccessToken = token };
    }
    else if (user.MatrixAccessToken is null)
    {
        var token = await _matrixAppService.LoginUser(user.Id.ToString());
        await _userRepository.UpdateMatrixToken(user.Id, token);
        user = user with { MatrixAccessToken = token };
    }

    lock (_lock)
    {
        _activeSessions.Add(certHash);
    }

    return new AuthResult(user.MatrixUserId, user.MatrixAccessToken!);
}
```

**Step 4: Update `AuthExtensions` to register `IMatrixAppService` dependency order**

`AuthService` now depends on `IMatrixAppService`, which is registered by `AddMatrix()`. In `Program.cs`, `AddAuth()` is called before `AddMatrix()` — this is fine since both are singletons resolved lazily. No change needed.

**Step 5: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v minimal`
Expected: All PASS. Fix any compilation errors from the `AuthResult` record change first.

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthService.cs src/Brmble.Server/Auth/AuthExtensions.cs tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
git commit -m "feat: replace stub Matrix token with real provisioning in AuthService"
```

---

## Task 7: Add `GET /server-info` endpoint

**Files:**
- Create: `src/Brmble.Server/ServerInfo/ServerInfoEndpoints.cs`
- Create: `src/Brmble.Server/ServerInfo/ServerInfoSettings.cs`
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `src/Brmble.Server/appsettings.json`
- Test: `tests/Brmble.Server.Tests/Integration/ServerInfoTests.cs`

**Step 1: Write the failing integration test**

Look at `tests/Brmble.Server.Tests/Integration/` for existing patterns. Create `ServerInfoTests.cs`:

```csharp
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ServerInfoTests
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    [TestInitialize]
    public void Setup()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
    }

    [TestCleanup]
    public void Cleanup() => _factory?.Dispose();

    [TestMethod]
    public async Task GetServerInfo_ReturnsExpectedShape()
    {
        var response = await _client!.GetAsync("/server-info");
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("mumbleHost"));
        Assert.IsTrue(json.Contains("mumblePort"));
        Assert.IsTrue(json.Contains("matrixHomeserverUrl"));
    }
}
```

**Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ServerInfoTests" -v minimal`
Expected: FAIL — 404.

**Step 3: Create `ServerInfoSettings`**

Create `src/Brmble.Server/ServerInfo/ServerInfoSettings.cs`:
```csharp
namespace Brmble.Server.ServerInfo;

public class ServerInfoSettings
{
    public string MumbleHost { get; init; } = "localhost";
    public int MumblePort { get; init; } = 64738;
}
```

**Step 4: Create `ServerInfoEndpoints`**

Create `src/Brmble.Server/ServerInfo/ServerInfoEndpoints.cs`:
```csharp
using Microsoft.Extensions.Options;
using Brmble.Server.Matrix;

namespace Brmble.Server.ServerInfo;

public static class ServerInfoEndpoints
{
    public static IEndpointRouteBuilder MapServerInfoEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/server-info", (
            IOptions<ServerInfoSettings> serverInfo,
            IOptions<MatrixSettings> matrix) =>
        {
            return Results.Ok(new
            {
                mumbleHost = serverInfo.Value.MumbleHost,
                mumblePort = serverInfo.Value.MumblePort,
                matrixHomeserverUrl = matrix.Value.HomeserverUrl
            });
        });

        return app;
    }
}
```

**Step 5: Register in `Program.cs`**

Add service registration after `builder.Services.AddMatrix()`:
```csharp
builder.Services.AddOptions<ServerInfoSettings>()
    .BindConfiguration("ServerInfo");
```

Add endpoint mapping after `app.MapAuthEndpoints()`:
```csharp
app.MapServerInfoEndpoints();
```

Add the using at the top:
```csharp
using Brmble.Server.ServerInfo;
```

**Step 6: Add config to `appsettings.json`**

```json
"ServerInfo": {
  "MumbleHost": "mumble.example.com",
  "MumblePort": 64738
}
```

**Step 7: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ServerInfoTests" -v minimal`
Expected: PASS

**Step 8: Commit**

```bash
git add src/Brmble.Server/ServerInfo/ src/Brmble.Server/Program.cs src/Brmble.Server/appsettings.json tests/Brmble.Server.Tests/Integration/ServerInfoTests.cs
git commit -m "feat: add GET /server-info endpoint"
```

---

## Task 8: Extend `POST /auth/token` — full credentials response

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Test: `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`

**Step 1: Write the failing integration test**

Create `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`:
```csharp
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class AuthTokenTests
{
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    [TestInitialize]
    public void Setup()
    {
        _factory = new WebApplicationFactory<Program>();
        _client = _factory.CreateClient();
    }

    [TestCleanup]
    public void Cleanup() => _factory?.Dispose();

    [TestMethod]
    public async Task PostAuthToken_MissingCertHash_ReturnsBadRequest()
    {
        var response = await _client!.PostAsync("/auth/token",
            new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task PostAuthToken_ValidCertHash_ReturnsCredentialsShape()
    {
        var body = JsonSerializer.Serialize(new { certHash = "testcerthash123" });
        var response = await _client!.PostAsync("/auth/token",
            new StringContent(body, Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        Assert.IsTrue(json.Contains("matrix"));
        Assert.IsTrue(json.Contains("homeserverUrl"));
        Assert.IsTrue(json.Contains("accessToken"));
        Assert.IsTrue(json.Contains("userId"));
        Assert.IsTrue(json.Contains("roomMap"));
    }
}
```

**Step 2: Run to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthTokenTests" -v minimal`
Expected: FAIL (request body not read, old response shape).

**Step 3: Update `AuthEndpoints`**

Replace `AuthEndpoints.cs`:
```csharp
using Brmble.Server.Matrix;
using Microsoft.Extensions.Options;

namespace Brmble.Server.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            AuthTokenRequest request,
            AuthService authService,
            ChannelRepository channelRepository,
            IOptions<MatrixSettings> matrixSettings) =>
        {
            if (string.IsNullOrWhiteSpace(request.CertHash))
                return Results.BadRequest("certHash is required.");

            var result = await authService.Authenticate(request.CertHash);

            var roomMap = channelRepository.GetAll()
                .ToDictionary(m => m.MumbleChannelId.ToString(), m => m.MatrixRoomId);

            return Results.Ok(new
            {
                matrix = new
                {
                    homeserverUrl = matrixSettings.Value.HomeserverUrl,
                    accessToken = result.MatrixAccessToken,
                    userId = result.MatrixUserId,
                    roomMap
                },
                livekit = (object?)null
            });
        });

        return app;
    }

    private record AuthTokenRequest(string? CertHash);
}
```

**Step 4: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v minimal`
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs
git commit -m "feat: extend /auth/token to return full server.credentials shape"
```

---

## Task 9: Build and run all server tests

**Step 1: Full build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`
Expected: Build succeeded, 0 errors.

**Step 2: Full test run**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v minimal`
Expected: All tests pass.

**Step 3: Commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: address compilation errors from auth token refactor"
```

---

## Task 10: `ServerEntry` — add `ApiUrl` field

**Files:**
- Modify: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs`

**Step 1: Update `ServerEntry` record**

Find `ServerEntry` (currently defined inline in `ServerlistService.cs`). Add `ApiUrl`:
```csharp
public record ServerEntry(
    string Id,
    string Label,
    string? ApiUrl,
    string? Host,
    int? Port,
    string Username
);
```

**Step 2: Update `ParseServerEntry`**

In `ParseServerEntry`, extract `apiUrl` (optional):
```csharp
var apiUrl = data.TryGetProperty("apiUrl", out var apiEl) ? apiEl.GetString() : null;

return new ServerEntry(
    id!,
    label.GetString() ?? "",
    apiUrl,
    data.TryGetProperty("host", out var hostEl) ? hostEl.GetString() : null,
    data.TryGetProperty("port", out var portEl) ? portEl.GetInt32() : null,
    username.GetString() ?? ""
);
```

Remove the required `host` and `port` check — only `label` and `username` are required now.

**Step 3: Build client to verify no compilation errors**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Serverlist/ServerlistService.cs
git commit -m "feat: add ApiUrl to ServerEntry for Brmble-mode connect"
```

---

## Task 11: `CertificateService` — expose `GetCertHash()`

**Files:**
- Modify: `src/Brmble.Client/Services/Certificate/CertificateService.cs`

**Step 1: Add `GetCertHash()` method**

`CertificateService` already has `ActiveCertificate` (an `X509Certificate2`). Its `Thumbprint` property is the SHA-1 hex fingerprint — exactly what we need. Add:

```csharp
public string? GetCertHash() =>
    ActiveCertificate?.Thumbprint?.ToLowerInvariant();
```

**Step 2: Build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Certificate/CertificateService.cs
git commit -m "feat: expose GetCertHash on CertificateService"
```

---

## Task 12: `MumbleAdapter` — dual-mode connect and `server.credentials`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

This is the most complex task. Read all of `MumbleAdapter.cs` before starting.

**Step 1: Extract welcome text parsing to a testable static method**

Add a static method to `MumbleAdapter` (makes it unit-testable without a live Mumble connection):

```csharp
/// <summary>
/// Parses a Brmble API URL from a Mumble server welcome text.
/// Looks for an HTML comment of the form: <!--brmble:{"apiUrl":"..."}-->
/// </summary>
internal static string? ParseBrmbleApiUrl(string? welcomeText)
{
    if (string.IsNullOrEmpty(welcomeText))
        return null;

    var match = System.Text.RegularExpressions.Regex.Match(
        welcomeText,
        @"<!--brmble:(\{.*?\})-->",
        System.Text.RegularExpressions.RegexOptions.Singleline);

    if (!match.Success)
        return null;

    try
    {
        var json = System.Text.Json.JsonDocument.Parse(match.Groups[1].Value);
        return json.RootElement.TryGetProperty("apiUrl", out var apiUrl)
            ? apiUrl.GetString()
            : null;
    }
    catch
    {
        return null;
    }
}
```

**Step 2: Write tests for `ParseBrmbleApiUrl`**

Create `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`:
```csharp
using Brmble.Client.Services.Voice;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services;

[TestClass]
public class MumbleAdapterParseTests
{
    [TestMethod]
    public void ParseBrmbleApiUrl_ValidComment_ReturnsUrl()
    {
        var text = """Welcome!<!--brmble:{"apiUrl":"https://noscope.it:1912"}-->""";
        Assert.AreEqual("https://noscope.it:1912", MumbleAdapter.ParseBrmbleApiUrl(text));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NoComment_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("Welcome to the server!"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_NullInput_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl(null));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_MalformedJson_ReturnsNull()
    {
        Assert.IsNull(MumbleAdapter.ParseBrmbleApiUrl("<!--brmble:{bad json}-->"));
    }

    [TestMethod]
    public void ParseBrmbleApiUrl_CommentWithHtmlAround_ReturnsUrl()
    {
        var text = "<b>Welcome!</b>\n<!--brmble:{\"apiUrl\":\"https://example.com\"}-->\n<p>Enjoy</p>";
        Assert.AreEqual("https://example.com", MumbleAdapter.ParseBrmbleApiUrl(text));
    }
}
```

**Step 3: Run tests to verify they pass (method already added)**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "MumbleAdapterParseTests" -v minimal`
Expected: PASS

**Step 4: Add `_apiUrl` field and `_certService` usage**

`MumbleAdapter` already has `_certService` (a `CertificateService?`). Add a field to store the resolved API URL:
```csharp
private string? _apiUrl;
```

**Step 5: Add `FetchAndSendCredentials` helper method**

```csharp
private async Task FetchAndSendCredentials(string apiUrl)
{
    var certHash = _certService?.GetCertHash();
    if (certHash is null)
    {
        _bridge?.Send("voice.error", new { message = "No client certificate — cannot fetch Matrix credentials." });
        return;
    }

    try
    {
        using var http = new System.Net.Http.HttpClient();
        var body = System.Text.Json.JsonSerializer.Serialize(new { certHash });
        var response = await http.PostAsync(
            $"{apiUrl}/auth/token",
            new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        response.EnsureSuccessStatusCode();
        var json = await response.Content.ReadAsStringAsync();
        var credentials = System.Text.Json.JsonDocument.Parse(json).RootElement;

        _bridge?.Send("server.credentials", credentials);
        _bridge?.NotifyUiThread();

        // Cache the resolved API URL back to the server entry
        _apiUrl = apiUrl;
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[Brmble] Failed to fetch credentials from {apiUrl}: {ex.Message}");
    }
}
```

**Step 6: Handle `OnServerSync` to run Flow A**

Find the `ServerSync` handler in `MumbleAdapter` (look for `OnServerSynced` or similar override from `BasicMumbleProtocol`). Add the welcome text parse + credential fetch:

```csharp
public override void OnServerSynced(ServerSync sync)
{
    base.OnServerSynced(sync);

    // Flow A: discover Brmble API URL from welcome text
    if (_apiUrl is null && sync.WelcomeText is not null)
    {
        var discovered = ParseBrmbleApiUrl(sync.WelcomeText);
        if (discovered is not null)
        {
            _apiUrl = discovered;
            Task.Run(() => FetchAndSendCredentials(discovered));
        }
    }
    // Flow B: _apiUrl already set from /server-info call before connect
    else if (_apiUrl is not null)
    {
        Task.Run(() => FetchAndSendCredentials(_apiUrl));
    }
}
```

**Step 7: Update `Connect()` for Flow B (ApiUrl set)**

At the start of `Connect()`, before creating the `MumbleConnection`, check if an API URL was passed in. Update the method signature to accept an optional `apiUrl`:

```csharp
public void Connect(string host, int port, string username, string password = "", string? apiUrl = null)
```

At the start of the connect flow, before creating the `MumbleConnection`:
```csharp
// Flow B: fetch Mumble address from Brmble server if only apiUrl is known
if (!string.IsNullOrEmpty(apiUrl) && (string.IsNullOrEmpty(host) || port == 0))
{
    // Caller passes empty host when using Brmble-first mode — resolved via /server-info before calling Connect
    // apiUrl is stored so OnServerSynced can call /auth/token
    _apiUrl = apiUrl;
}
else if (!string.IsNullOrEmpty(apiUrl))
{
    _apiUrl = apiUrl;
}
```

**Step 8: Update bridge handler for `voice.connect`**

In `MumbleAdapter.RegisterHandlers()` (or wherever `voice.connect` is handled), pass through `apiUrl` if present in the data:

```csharp
bridge.RegisterHandler("voice.connect", data =>
{
    var host    = data.TryGetProperty("host",    out var h) ? h.GetString() ?? "" : "";
    var port    = data.TryGetProperty("port",    out var p) ? p.GetInt32()       : 0;
    var user    = data.TryGetProperty("username",out var u) ? u.GetString() ?? "" : "";
    var pass    = data.TryGetProperty("password",out var pw)? pw.GetString()??""  : "";
    var apiUrl  = data.TryGetProperty("apiUrl",  out var a) ? a.GetString()       : null;
    Connect(host, port, user, pass, apiUrl);
    return Task.CompletedTask;
});
```

**Step 9: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: 0 errors. Fix any signature mismatches with `BasicMumbleProtocol.OnServerSynced`.

**Step 10: Run all client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v minimal`
Expected: All PASS.

**Step 11: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: dual-mode connect with server.credentials bridge message"
```

---

## Task 13: Full build and test run

**Step 1: Build everything**

Run: `dotnet build`
Expected: Build succeeded across all projects, 0 errors.

**Step 2: Run all tests**

Run: `dotnet test`
Expected: All tests pass.

**Step 3: Fix any remaining issues, commit fixes**

---

## Task 14: Flow B — `/server-info` fetch before connect

The Flow B path (Brmble-first, `ApiUrl` set in `ServerEntry`) requires the client to call `GET {apiUrl}/server-info` before connecting to Mumble. This is triggered from the frontend when the user clicks Connect with a server entry that has `apiUrl` but no `host`/`port`.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add `ConnectViaBrmbleServer` method**

```csharp
public async Task ConnectViaBrmbleServer(string apiUrl, string username, string password = "")
{
    try
    {
        using var http = new System.Net.Http.HttpClient();
        var response = await http.GetAsync($"{apiUrl}/server-info");
        response.EnsureSuccessStatusCode();

        var json = System.Text.Json.JsonDocument.Parse(
            await response.Content.ReadAsStringAsync()).RootElement;

        var host = json.GetProperty("mumbleHost").GetString()
            ?? throw new InvalidOperationException("server-info missing mumbleHost");
        var port = json.GetProperty("mumblePort").GetInt32();

        Connect(host, port, username, password, apiUrl);
    }
    catch (Exception ex)
    {
        _bridge?.Send("voice.error", new { message = $"Failed to reach Brmble server: {ex.Message}" });
        _bridge?.NotifyUiThread();
    }
}
```

**Step 2: Update `voice.connect` handler to call `ConnectViaBrmbleServer` when only `apiUrl` is set**

Update the handler from Task 12, Step 8:

```csharp
bridge.RegisterHandler("voice.connect", async data =>
{
    var host   = data.TryGetProperty("host",    out var h)  ? h.GetString()  ?? "" : "";
    var port   = data.TryGetProperty("port",    out var p)  ? p.GetInt32()        : 0;
    var user   = data.TryGetProperty("username",out var u)  ? u.GetString()  ?? "" : "";
    var pass   = data.TryGetProperty("password",out var pw) ? pw.GetString() ?? "" : "";
    var apiUrl = data.TryGetProperty("apiUrl",  out var a)  ? a.GetString()       : null;

    if (!string.IsNullOrEmpty(apiUrl) && string.IsNullOrEmpty(host))
        await ConnectViaBrmbleServer(apiUrl, user, pass);
    else
        Connect(host, port, user, pass, apiUrl);
});
```

**Step 3: Build and run all tests**

Run: `dotnet build && dotnet test`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: Flow B — fetch mumble address from /server-info before connect"
```

---

## Task 15: Cache resolved addresses back to `ServerEntry`

After a successful connect, persist the discovered address back to the server entry so future connects skip discovery.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Client/Services/Serverlist/ServerlistService.cs`

**Step 1: Add `IServerlistService.UpdateServer` awareness to `MumbleAdapter`**

`MumbleAdapter` already has access to the bridge. Add an optional callback for when the API URL is discovered:

```csharp
public Action<string>? OnApiUrlDiscovered { get; set; }
```

In `OnServerSynced`, after discovering `apiUrl` from welcome text:
```csharp
OnApiUrlDiscovered?.Invoke(discovered);
```

In `ConnectViaBrmbleServer`, after successful connect, callback with resolved `{host}:{port}`:
```csharp
// (handled differently — the server-info response gives us mumbleHost/mumblePort to cache)
```

**Step 2: Wire up in `Program.cs`**

In `Program.cs` where `MumbleAdapter` is created, set the callback to call `serverlistService.UpdateServer()` with the resolved API URL. Pass the active `ServerEntry` ID into context.

> This task requires reading `Program.cs` in full before implementing — the exact wiring depends on how the active server entry ID is passed around. Implement the minimum needed: store the discovered values in the current session and update the entry on successful connect.

**Step 3: Build and test**

Run: `dotnet build && dotnet test`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/Brmble.Client/
git commit -m "feat: cache resolved Brmble/Mumble addresses after first connect"
```

---

## Completion Checklist

- [ ] Appservice namespace fixed in `register-appservice.sh`
- [ ] `matrix_access_token` column in DB
- [ ] `UserRepository` returns and updates token
- [ ] `ChannelRepository.GetAll()` works
- [ ] `MatrixAppService.RegisterUser()` and `LoginUser()` tested
- [ ] `AuthService` provisions real Matrix tokens
- [ ] `GET /server-info` returns Mumble + Matrix config
- [ ] `POST /auth/token` returns full `server.credentials` shape
- [ ] `ServerEntry` has `ApiUrl?`
- [ ] `CertificateService.GetCertHash()` exposed
- [ ] `MumbleAdapter` — welcome text parsing tested
- [ ] `MumbleAdapter` — Flow A (welcome text → credentials) wired
- [ ] `MumbleAdapter` — Flow B (server-info → connect → credentials) wired
- [ ] Resolved addresses cached back to `ServerEntry`
- [ ] All tests pass: `dotnet test`
