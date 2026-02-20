# Display Name Security Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove client-controlled display names from `POST /auth/token` and introduce a `HandleUserState` method as the sole path for setting real display names, with a pending name queue to handle the Mumble-arrives-first race condition.

**Architecture:** Bottom-up TDD: update `UserRepository.Insert` to accept a nullable display name (generating `user_{id}` as placeholder), add `HandleUserState` to `AuthService` with an in-memory pending name queue, strip `displayName` from `Authenticate`, then update the endpoint and integration tests. Display name updates from Mumble UserState are the only authoritative write path.

**Tech Stack:** ASP.NET Core Minimal APIs, SQLite + Dapper, MSTest, `WebApplicationFactory<Program>`

---

### Task 1: UserRepository.Insert accepts nullable display name

**Files:**
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

**Background:** `Insert` currently requires a `displayName` string. We need it to accept `null`, in which case it generates `user_{id}` as a placeholder inside the same transaction that already fetches `last_insert_rowid()`.

**Step 1: Add two new tests to `UserRepositoryTests.cs`**

Add after `UpdateDisplayName_ExistingUser_UpdatesRecord`:

```csharp
[TestMethod]
public async Task Insert_WithDisplayName_PersistsSuppliedName()
{
    var user = await _repo!.Insert("hash1", "Alice");
    Assert.AreEqual("Alice", user.DisplayName);
}

[TestMethod]
public async Task Insert_WithNullDisplayName_UsesPlaceholder()
{
    var user = await _repo!.Insert("hash2", null);
    Assert.AreEqual($"user_{user.Id}", user.DisplayName);
}
```

Also update `Insert_NewUser_PersistsToDatabase` — change the call to pass an explicit name so it still passes once the signature changes:

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

**Step 2: Run to verify the new tests fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "Insert_WithNullDisplayName_UsesPlaceholder|Insert_WithDisplayName_PersistsSuppliedName"
```

Expected: build error — `Insert` does not accept `null` (wrong overload)

**Step 3: Update `UserRepository.Insert` in `UserRepository.cs`**

Replace the existing `Insert` method:

```csharp
public async Task<User> Insert(string certHash, string? displayName)
{
    using var conn = _db.CreateConnection();
    conn.Open();
    using var tx = conn.BeginTransaction();

    await conn.ExecuteAsync(
        "INSERT INTO users (cert_hash, display_name, matrix_user_id) VALUES (@CertHash, 'pending', 'pending')",
        new { CertHash = certHash },
        tx);

    var id = await conn.QuerySingleAsync<long>("SELECT last_insert_rowid()", transaction: tx);
    var matrixUserId = $"@{id}:{_serverDomain}";
    var finalDisplayName = displayName ?? $"user_{id}";

    await conn.ExecuteAsync(
        "UPDATE users SET display_name = @DisplayName, matrix_user_id = @MatrixUserId WHERE id = @Id",
        new { DisplayName = finalDisplayName, MatrixUserId = matrixUserId, Id = id },
        tx);

    tx.Commit();
    return new User(id, certHash, finalDisplayName, matrixUserId);
}
```

**Step 4: Run all UserRepository tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "UserRepositoryTests"
```

Expected: all 6 tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/UserRepository.cs tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs
git commit -m "feat: UserRepository.Insert accepts nullable displayName, generates user_{id} placeholder"
```

---

### Task 2: HandleUserState in AuthService + pending name queue

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`

**Background:** `AuthService` needs a `ConcurrentDictionary<string, string> _pendingNames` to park display names from Mumble UserState events that arrive before the user's first backend auth call. `HandleUserState` is the entry point for all Mumble UserState sync.

**Step 1: Add new tests to `AuthServiceTests.cs`**

Add after `Deactivate_AfterAuthenticate_RemovesFromActiveSessions`:

```csharp
[TestMethod]
public async Task HandleUserState_UnknownCert_DoesNotThrow()
{
    // No user in DB, no auth call — should just queue silently
    await _svc!.HandleUserState("unknownhash", "Ghost");
    // No assert needed — just verifying no exception
}

[TestMethod]
public async Task HandleUserState_BeforeAuth_QueuesName()
{
    await _svc!.HandleUserState("queuedhash", "Queued");
    // Name is in the queue — verify by authenticating and checking the stored name
    await _svc.Authenticate("queuedhash");
    var user = await _repo!.GetByCertHash("queuedhash");
    Assert.AreEqual("Queued", user!.DisplayName);
}

[TestMethod]
public async Task HandleUserState_AfterAuth_UpdatesDisplayName()
{
    await _svc!.Authenticate("updatehash");
    // User exists with placeholder — now UserState arrives
    await _svc.HandleUserState("updatehash", "RealName");
    var user = await _repo!.GetByCertHash("updatehash");
    Assert.AreEqual("RealName", user!.DisplayName);
}

[TestMethod]
public async Task HandleUserState_QueueConsumedAfterAuthenticate()
{
    await _svc!.HandleUserState("consumedhash", "ConsumedName");
    await _svc.Authenticate("consumedhash");
    // Authenticate a second time — queue entry should be gone, no double-update
    await _svc.Authenticate("consumedhash");
    var user = await _repo!.GetByCertHash("consumedhash");
    Assert.AreEqual("ConsumedName", user!.DisplayName);
}
```

Note: these tests reference `_repo` directly. Update `AuthServiceTests` class to also expose `_repo`:

```csharp
private SqliteConnection? _keepAlive;
private AuthService? _svc;
private UserRepository? _repo;
```

And in `Setup()`, assign `_repo` after creating it:

```csharp
var repo = new UserRepository(db, config);
_repo = repo;
_svc = new AuthService(repo);
```

**Step 2: Run to verify new tests fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "HandleUserState"
```

Expected: build errors — `HandleUserState` does not exist, `Authenticate` takes 2 args

**Step 3: Add `_pendingNames` and `HandleUserState` to `AuthService.cs`**

Add the field after `_lock`:

```csharp
private readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _pendingNames = new();
```

Add the method after `Deactivate`:

```csharp
public async Task HandleUserState(string certHash, string displayName)
{
    var user = await _userRepository.GetByCertHash(certHash);
    if (user is not null)
    {
        if (user.DisplayName != displayName)
            await _userRepository.UpdateDisplayName(user.Id, displayName);
    }
    else
    {
        _pendingNames[certHash] = displayName;
    }
}
```

**Step 4: Run HandleUserState tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "HandleUserState"
```

Expected: some fail (Authenticate still takes 2 args), some may pass — confirm no crash

**Step 5: Commit the HandleUserState addition before changing Authenticate**

```bash
git add src/Brmble.Server/Auth/AuthService.cs tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
git commit -m "feat: add AuthService.HandleUserState with pending name queue"
```

---

### Task 3: Remove displayName from AuthService.Authenticate

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthService.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs`

**Background:** `Authenticate` drops the `displayName` parameter. For new users it checks `_pendingNames` first; falls back to null (which `Insert` converts to `user_{id}`). The `else if (DisplayName != displayName)` branch is deleted entirely.

**Step 1: Update existing `AuthServiceTests` to drop displayName args**

Replace all existing `Authenticate` calls that pass a display name. Full updated test methods:

```csharp
[TestMethod]
public async Task Authenticate_NewUser_AddsToActiveSessions()
{
    await _svc!.Authenticate("newhash");
    Assert.IsTrue(_svc.IsBrmbleClient("newhash"));
}

[TestMethod]
public async Task Authenticate_NewUser_ReturnsStubToken()
{
    var result = await _svc!.Authenticate("somehash");
    StringAssert.StartsWith(result.MatrixAccessToken, "stub_token_");
}

[TestMethod]
public async Task Authenticate_ExistingUser_StillAddsToActiveSessions()
{
    await _svc!.Authenticate("existinghash");
    _svc.Deactivate("existinghash");
    await _svc.Authenticate("existinghash");
    Assert.IsTrue(_svc.IsBrmbleClient("existinghash"));
}

[TestMethod]
public async Task Deactivate_AfterAuthenticate_RemovesFromActiveSessions()
{
    await _svc!.Authenticate("todeactivate");
    _svc.Deactivate("todeactivate");
    Assert.IsFalse(_svc.IsBrmbleClient("todeactivate"));
}
```

**Step 2: Run to verify tests fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthServiceTests"
```

Expected: build errors — `Authenticate` called with wrong number of arguments (still takes 2)

**Step 3: Update `Authenticate` in `AuthService.cs`**

Replace the existing `Authenticate` method:

```csharp
public async Task<AuthResult> Authenticate(string certHash)
{
    var user = await _userRepository.GetByCertHash(certHash);

    if (user is null)
    {
        _pendingNames.TryRemove(certHash, out var pendingName);
        user = await _userRepository.Insert(certHash, pendingName);
    }

    lock (_lock)
    {
        _activeSessions.Add(certHash);
    }

    return new AuthResult($"stub_token_{user.Id}");
}
```

**Step 4: Run all AuthService tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthServiceTests"
```

Expected: all tests pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthService.cs tests/Brmble.Server.Tests/Auth/AuthServiceTests.cs
git commit -m "feat: remove displayName from Authenticate, use pending queue or placeholder"
```

---

### Task 4: Update AuthEndpoints and integration tests

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs`

**Background:** `AuthTokenRequest` is deleted. The endpoint handler no longer binds a request body. Integration tests post an empty body.

**Step 1: Update integration tests to send no body**

In `AuthIntegrationTests.cs`, replace all three `PostAsJsonAsync` calls that send `new { displayName = "Alice" }`:

```csharp
[TestMethod]
public async Task PostToken_ValidRequest_ReturnsOk()
{
    var response = await _client.PostAsync("/auth/token", null);
    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
}

[TestMethod]
public async Task PostToken_ValidRequest_ReturnsStubToken()
{
    var response = await _client.PostAsync("/auth/token", null);
    var body = await response.Content.ReadAsStringAsync();
    StringAssert.Contains(body, "matrixAccessToken");
    StringAssert.Contains(body, "stub_token_");
}
```

In `PostToken_NoCertificate_ReturnsBadRequest`, also replace:

```csharp
var response = await noCertClient.PostAsync("/auth/token", null);
Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
```

**Step 2: Run integration tests to verify they fail**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthIntegrationTests"
```

Expected: build errors — `Authenticate` now takes 1 arg but endpoint still calls it with 2

**Step 3: Update `AuthEndpoints.cs`**

Replace the entire file:

```csharp
// src/Brmble.Server/Auth/AuthEndpoints.cs
namespace Brmble.Server.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/auth/token", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            AuthService authService) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (certHash is null)
                return Results.BadRequest("No client certificate presented.");

            var result = await authService.Authenticate(certHash);
            return Results.Ok(new { matrixAccessToken = result.MatrixAccessToken });
        });

        return app;
    }
}
```

**Step 4: Run integration tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthIntegrationTests"
```

Expected: all 3 pass

**Step 5: Run all tests**

```bash
dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj
```

Expected: all pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs
git commit -m "feat: remove displayName from POST /auth/token, names owned by Mumble UserState only"
```

---

### Task 5: Final verification

**Step 1: Build full solution**

```bash
dotnet build
```

Expected: `Build succeeded, 0 Error(s)`

**Step 2: Run all tests**

```bash
dotnet test
```

Expected: all tests pass

**Step 3: Verify branch commits**

```bash
git log --oneline main..HEAD
```

Expected: commits from this feature only
