# Companion Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each user's selected companion on the Brmble server and propagate it through the native voice bridge so overlays render real remote companions instead of proxying the local one.

**Architecture:** Extend the existing session-mapping pipeline instead of introducing a new voice-state channel. The server stores `companion_id` on `users`, enriches session mappings and channel-scoped WebSocket events with that value, the native client forwards companion updates over the existing bridge, and `App.tsx` continues to own remote-user companion state before the overlay model renders it.

**Tech Stack:** ASP.NET Core minimal APIs, Dapper/SQLite, C# native bridge (`MumbleAdapter`), React/TypeScript, Vitest, MSTest

---

## File Structure

### Server persistence and transport

- Modify: `src/Brmble.Server/Data/Database.cs`
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Modify: `src/Brmble.Server/Events/ISessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingHandler.cs`
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- Modify: `src/Brmble.Server/Events/BrmbleEventBus.cs`

### Native client bridge

- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

### Frontend state and overlay

- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`

### Tests

- Modify: `tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`
- Create: `tests/Brmble.Server.Tests/Auth/AuthEndpointsCompanionTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
- Create: `src/Brmble.Web/src/App.companionVisibility.test.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`

## Task 1: Add server-side companion persistence

**Files:**
- Modify: `src/Brmble.Server/Data/Database.cs`
- Modify: `src/Brmble.Server/Auth/UserRepository.cs`
- Modify: `tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs`

- [x] **Step 1: Write the failing repository tests**

```csharp
[TestMethod]
public async Task GetCompanionId_ReturnsBee_WhenColumnValueIsNullOrUnknown()
{
    var db = TestDatabaseFactory.Create();
    var repo = TestUserRepositoryFactory.Create(db);
    var user = await repo.Insert("cert-1", "alice");

    using var conn = db.CreateConnection();
    await conn.ExecuteAsync("UPDATE users SET companion_id = 'UNKNOWN' WHERE id = @Id", new { user.Id });

    var companionId = await repo.GetCompanionId(user.Id);

    Assert.AreEqual("bee", companionId);
}

[TestMethod]
public async Task SetCompanionId_PersistsLowercaseValue()
{
    var db = TestDatabaseFactory.Create();
    var repo = TestUserRepositoryFactory.Create(db);
    var user = await repo.Insert("cert-2", "bob");

    await repo.SetCompanionId(user.Id, "floppy");

    var companionId = await repo.GetCompanionId(user.Id);

    Assert.AreEqual("floppy", companionId);
}
```

- [x] **Step 2: Run the repository test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~UserRepositoryTests" -v n`
Expected: FAIL because `UserRepository` does not expose `GetCompanionId` or `SetCompanionId`, and `users.companion_id` does not exist yet.

- [x] **Step 3: Add the DB migration and repository API**

```csharp
// src/Brmble.Server/Data/Database.cs
var hasCompanionId = conn.ExecuteScalar<int>(
    "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='companion_id'");
if (hasCompanionId == 0)
    conn.Execute("ALTER TABLE users ADD COLUMN companion_id TEXT DEFAULT 'bee'");
```

```csharp
// src/Brmble.Server/Auth/UserRepository.cs
private static readonly HashSet<string> ValidCompanionIds =
[
    "bee", "engineer", "floppy", "patch", "pip", "retro"
];

public static bool TryNormalizeCompanionId(string? companionId, out string normalized)
{
    var candidate = companionId?.Trim().ToLowerInvariant();
    if (candidate is not null && ValidCompanionIds.Contains(candidate))
    {
        normalized = candidate;
        return true;
    }

    normalized = "bee";
    return false;
}

public async Task<string> GetCompanionId(long userId)
{
    using var conn = _db.CreateConnection();
    var companionId = await conn.QuerySingleOrDefaultAsync<string?>(
        "SELECT companion_id FROM users WHERE id = @Id",
        new { Id = userId });

    return NormalizeCompanionId(companionId);
}

public async Task SetCompanionId(long userId, string companionId)
{
    using var conn = _db.CreateConnection();
    var normalized = NormalizeCompanionId(companionId);
    await conn.ExecuteAsync(
        "UPDATE users SET companion_id = @CompanionId WHERE id = @Id",
        new { CompanionId = normalized, Id = userId });
}

private static string NormalizeCompanionId(string? companionId)
{
    TryNormalizeCompanionId(companionId, out var normalized);
    return normalized;
}
```

Use `UserRepository.TryNormalizeCompanionId` as the single source of truth for companion validation across repository writes and auth endpoints. Native and web clients should treat `/auth/companion` responses as authoritative and should not ship separate hardcoded validation allow-lists.

- [x] **Step 4: Run the repository suite again**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~UserRepositoryTests" -v n`
Expected: PASS with the normalization and persistence cases green.

- [x] **Step 5: Commit**

```bash
git add tests/Brmble.Server.Tests/Auth/UserRepositoryTests.cs src/Brmble.Server/Data/Database.cs src/Brmble.Server/Auth/UserRepository.cs
git commit -m "feat(server): persist companion selection on users"
```

## Task 2: Extend session mappings and channel-scoped broadcasts with companion IDs

**Files:**
- Modify: `src/Brmble.Server/Events/ISessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingService.cs`
- Modify: `src/Brmble.Server/Events/SessionMappingHandler.cs`
- Modify: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- Test: `tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs`
- Test: `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`
- Test: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`
- Test: `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`
- Test: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
- Test: `tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs`

- [x] **Step 1: Add failing mapping tests for companion updates**

```csharp
[TestMethod]
public void TryUpdateCompanionId_UpdatesExistingMapping()
{
    var svc = new SessionMappingService();
    svc.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "bee");

    var updated = svc.TryUpdateCompanionId(42, "floppy");

    Assert.IsTrue(updated);
    Assert.AreEqual("floppy", svc.GetSnapshot()[42].CompanionId);
}

[TestMethod]
public async Task OnUserConnected_BroadcastsCompanionId()
{
    _repo.UsersByCert["cert-a"] = new User(100L, "cert-a", "Alice", "@alice:test", null);
    _repo.CompanionsByUserId[100L] = "engineer";

    await _handler.OnUserConnected(new UserConnectedEvent(42, "Alice", "cert-a"));

    _bus.Verify(b => b.BroadcastAsync(It.Is<object>(payload =>
        JsonSerializer.Serialize(payload).Contains("\"companionId\":\"engineer\""))));
}
```

- [x] **Step 2: Run the mapping tests and confirm the gap**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~SessionMapping" -v n`
Expected: FAIL because `SessionMapping` has no `CompanionId`, the service cannot update it, and handler broadcasts do not include it.

- [x] **Step 3: Extend the mapping model and snapshot payloads**

```csharp
// src/Brmble.Server/Events/ISessionMappingService.cs
public record SessionMapping(
    string MatrixUserId,
    string MumbleName,
    long UserId,
    string CompanionId,
    bool IsBrmbleClient = false);

bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId);
bool TryUpdateCompanionId(int sessionId, string companionId);
```

```csharp
// src/Brmble.Server/Events/SessionMappingService.cs
public bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName, long userId, string companionId)
{
    if (_sessionToMapping.TryAdd(sessionId, new SessionMapping(matrixUserId, mumbleName, userId, companionId)))
    {
        _userIdToSession[userId] = sessionId;
        return true;
    }
    return false;
}

public bool TryUpdateCompanionId(int sessionId, string companionId)
{
    if (_sessionToMapping.TryGetValue(sessionId, out var existing))
    {
        _sessionToMapping[sessionId] = existing with { CompanionId = companionId };
        return true;
    }
    return false;
}
```

```csharp
// src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs
var snapshot = sessionMapping.GetSnapshot()
    .ToDictionary(
        kvp => kvp.Key.ToString(),
        kvp => new
        {
            matrixUserId = kvp.Value.MatrixUserId,
            mumbleName = kvp.Value.MumbleName,
            companionId = kvp.Value.CompanionId,
            isBrmbleClient = kvp.Value.IsBrmbleClient
        });
```

- [x] **Step 4: Load companion IDs when mappings are created and broadcast them**

```csharp
// src/Brmble.Server/Events/SessionMappingHandler.cs
var companionId = await _userRepository.GetCompanionId(dbUser.Id);
if (_sessionMapping.TryAddMatrixUser(user.SessionId, dbUser.MatrixUserId, user.Name, dbUser.Id, companionId))
{
    await _eventBus.BroadcastAsync(new
    {
        type = "userMappingAdded",
        sessionId = user.SessionId,
        matrixUserId = dbUser.MatrixUserId,
        mumbleName = user.Name,
        companionId,
        isBrmbleClient
    });
}
```

- [x] **Step 5: Run the mapping suites**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~SessionMappingServiceTests|FullyQualifiedName~SessionMappingHandlerTests|FullyQualifiedName~MumbleServerCallbackTests|FullyQualifiedName~AuthTokenTests|FullyQualifiedName~LiveKitEndpointsTests|FullyQualifiedName~BrmbleEventBusTests" -v n`
Expected: PASS with companion IDs present in snapshots and broadcasts, and all `TryAddMatrixUser` call sites updated.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Server/Events/ISessionMappingService.cs src/Brmble.Server/Events/SessionMappingService.cs src/Brmble.Server/Events/SessionMappingHandler.cs src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs
git commit -m "feat(server): carry companion ids in session mappings"
```

## Task 3: Add `/auth/companion` and auth-response enrichment

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Modify: `src/Brmble.Server/Events/BrmbleEventBus.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs`
- Create or modify: `tests/Brmble.Server.Tests/Auth/AuthEndpointsCompanionTests.cs`

- [x] **Step 1: Write failing endpoint and auth-token tests**

```csharp
[TestMethod]
public async Task PostAuthToken_SessionMappings_IncludeCompanionId()
{
    var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
    sessionMapping.TryAddMatrixUser(42, "@alice:test", "Alice", 100L, "retro");

    var response = await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "Alice" });
    var json = await response.Content.ReadFromJsonAsync<JsonElement>();

    Assert.AreEqual("retro", json.GetProperty("sessionMappings").GetProperty("42").GetProperty("companionId").GetString());
}

[TestMethod]
public async Task PostAuthCompanion_PersistsAndBroadcastsChannelScopedUpdate()
{
    var response = await client.PostAsJsonAsync("/auth/companion", new { companionId = "floppy" });

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    _mockSessionMapping.Verify(m => m.TryUpdateCompanionId(42, "floppy"));
    _mockEventBus.Verify(b => b.BroadcastToChannelAsync(7, It.Is<object>(payload =>
        JsonSerializer.Serialize(payload).Contains("\"type\":\"companionChanged\""))));
}
```

- [x] **Step 2: Run the targeted server tests**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~AuthTokenTests|FullyQualifiedName~AuthEndpointsCompanionTests" -v n`
Expected: FAIL because `/auth/companion` does not exist and auth snapshots omit `companionId`.

- [x] **Step 3: Enrich `/auth/token` and `userMappingAdded` with companion IDs**

```csharp
// src/Brmble.Server/Auth/AuthEndpoints.cs
var companionId = await userRepository.GetCompanionId(result.UserId);

if (sessionMapping.TryAddMatrixUser(sid, result.MatrixUserId, resolvedName, result.UserId, companionId))
{
    sessionMapping.TryUpdateBrmbleStatus(sid, true);
    await eventBus.BroadcastAsync(new
    {
        type = "userMappingAdded",
        sessionId = sid,
        matrixUserId = result.MatrixUserId,
        mumbleName = resolvedName,
        companionId,
        isBrmbleClient = true
    });
}

sessionMappings = sessionMapping.GetSnapshot()
    .ToDictionary(
        kvp => kvp.Key.ToString(),
        kvp => new
        {
            matrixUserId = kvp.Value.MatrixUserId,
            mumbleName = kvp.Value.MumbleName,
            companionId = kvp.Value.CompanionId,
            isBrmbleClient = kvp.Value.IsBrmbleClient
        });
```

- [x] **Step 4: Implement `POST /auth/companion`**

```csharp
app.MapPost("/auth/companion", async (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    UserRepository userRepository,
    ISessionMappingService sessionMapping,
    IChannelMembershipService channelMembership,
    IBrmbleEventBus eventBus,
    ILogger<AuthService> logger) =>
{
    var certHash = certHashExtractor.GetCertHash(httpContext);
    if (string.IsNullOrWhiteSpace(certHash))
        return Results.Unauthorized();

    var user = await userRepository.GetByCertHash(certHash);
    if (user is null)
        return Results.Unauthorized();

    using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
    var companionId = doc.RootElement.TryGetProperty("companionId", out var prop)
        ? prop.GetString()
        : null;

    if (!UserRepository.TryNormalizeCompanionId(companionId, out var normalized))
        return Results.BadRequest(new { error = "Invalid companion ID" });

    await userRepository.SetCompanionId(user.Id, normalized);

    if (sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId))
    {
        sessionMapping.TryUpdateCompanionId(sessionId, normalized);
        if (channelMembership.TryGetChannel(sessionId, out var channelId))
        {
            await eventBus.BroadcastToChannelAsync(channelId, new
            {
                type = "companionChanged",
                sessionId,
                matrixUserId = user.MatrixUserId,
                companionId = normalized
            });
        }
    }

return Results.Ok(new { companionId = normalized });
});
```

Also fold companion loading into `GetByCertHash` (or add `GetByCertHashWithCompanion`) so this endpoint does not perform a second repository read for the same user during `/auth/token`/`/auth/companion` flows.

- [x] **Step 5: Run the server auth suites**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~AuthTokenTests|FullyQualifiedName~AuthEndpointsCompanionTests" -v n`
Expected: PASS with snapshot enrichment, companion persistence, and channel-scoped broadcast coverage.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs src/Brmble.Server/Events/BrmbleEventBus.cs tests/Brmble.Server.Tests/Integration/AuthTokenTests.cs tests/Brmble.Server.Tests/Auth/AuthEndpointsCompanionTests.cs
git commit -m "feat(server): add authenticated companion sync endpoint"
```

## Task 4: Extend `MumbleAdapter` for companion sync and live bridge updates

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
- Create: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [x] **Step 1: Write the failing native-client tests**

```csharp
[TestMethod]
public void ParseSessionMappings_WithCompanionId_RoundTrips()
{
    using var json = JsonDocument.Parse("""
    {
      "42": {
        "matrixUserId": "@alice:test",
        "mumbleName": "Alice",
        "companionId": "pip",
        "isBrmbleClient": true
      }
    }
    """);

    var result = MumbleAdapter.ParseSessionMappings(json.RootElement);

    Assert.AreEqual("pip", result[42].CompanionId);
}

[TestMethod]
public void HandleWebSocketMessage_CompanionChanged_EmitsBridgeEvent()
{
    var adapter = CreateAdapterWithBridge(out var bridge);

    InvokePrivate(adapter, "HandleWebSocketMessage", """
    {"type":"companionChanged","sessionId":42,"matrixUserId":"@alice:test","companionId":"retro"}
    """);

    AssertBridgeSent(bridge, "voice.companionChanged");
}
```

- [x] **Step 2: Run the native-client tests and confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests --filter "FullyQualifiedName~MumbleAdapter" -v n`
Expected: FAIL because the session mapping record, payload parsers, and bridge events do not carry companion IDs yet.

- [x] **Step 3: Extend the session mapping cache and parsers**

```csharp
internal record SessionMappingEntry(
    string MatrixUserId,
    string MumbleName,
    string CompanionId,
    bool IsBrmbleClient = false);

var companionId = prop.Value.TryGetProperty("companionId", out var c)
    ? c.GetString()
    : "bee";

if (matrixId is not null && name is not null && companionId is not null)
{
    var isBrmble = prop.Value.TryGetProperty("isBrmbleClient", out var b) && b.GetBoolean();
    result[sid] = new SessionMappingEntry(matrixId, name, companionId, isBrmble);
}
```

- [x] **Step 4: Implement `voice.setCompanion`, live WebSocket handling, and enriched bridge payloads**

```csharp
// inside RegisterHandlers
_bridge.RegisterHandler("voice.setCompanion", async payload =>
{
    var companionId = payload.TryGetProperty("companionId", out var prop) ? prop.GetString() : null;
    if (string.IsNullOrWhiteSpace(companionId))
    {
        _bridge?.Send("voice.setCompanionResponse", new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Missing companion ID" });
        _bridge?.NotifyUiThread();
        return;
    }

    var result = await SyncCompanionAsync(companionId);
    _bridge?.Send("voice.setCompanionResponse", result);
    _bridge?.NotifyUiThread();
});
```

```csharp
private async Task<object> SyncCompanionAsync(string companionId)
{
    if (string.IsNullOrWhiteSpace(_apiUrl))
        return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Brmble API unavailable" };
    if (_certificateService.GetCurrentCertificate() is null)
        return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Client certificate unavailable" };

    try
    {
        using var client = CreateAuthenticatedApiClient();
        using var response = await client.PostAsJsonAsync("/auth/companion", new { companionId });
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync();
            return new
            {
                success = false,
                companionId = GetSelfCompanionOrDefault(),
                error = string.IsNullOrWhiteSpace(errorBody) ? "Failed to sync companion" : errorBody
            };
        }

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var synced = body.GetProperty("companionId").GetString() ?? companionId;
        UpdateSelfCompanionMapping(synced);
        return new { success = true, companionId = synced };
    }
    catch (Exception ex)
    {
        _logger.LogWarning(ex, "Companion sync failed");
        return new { success = false, companionId = GetSelfCompanionOrDefault(), error = "Failed to sync companion" };
    }
}
```

`MumbleAdapter` intentionally does not maintain its own companion allow-list; it forwards candidate IDs to `/auth/companion` and relies on the server response for canonical validation.

```csharp
case "companionChanged":
    var changedSid = root.GetProperty("sessionId").GetUInt32();
    var changedCompanionId = root.GetProperty("companionId").GetString() ?? "bee";
    if (_sessionMappings.TryGetValue(changedSid, out var changed))
        _sessionMappings[changedSid] = changed with { CompanionId = changedCompanionId };
    _bridge?.Send("voice.companionChanged", new
    {
        session = changedSid,
        matrixUserId = root.TryGetProperty("matrixUserId", out var matrixProp) ? matrixProp.GetString() : null,
        companionId = changedCompanionId
    });
    _bridge?.NotifyUiThread();
    break;
```

```csharp
// inside SendVoiceConnected / voice.userJoined payload builders
companionId = hasMap ? sm!.CompanionId : null,
isBrmbleClient = hasMap && sm!.IsBrmbleClient
```

- [x] **Step 5: Run the client tests**

Run: `dotnet test tests/Brmble.Client.Tests --filter "FullyQualifiedName~MumbleAdapter" -v n`
Expected: PASS with companion IDs flowing through parse helpers, `voice.connected`, and `voice.companionChanged`.

- [x] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat(client): sync companion ids through native voice bridge"
```

## Task 5: Update frontend voice state and reconciliation

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- Modify: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- Create: `src/Brmble.Web/src/App.companionVisibility.test.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`

- [x] **Step 1: Write the failing web-state tests**

```tsx
it('uses remote companion ids from voice state instead of proxying the local selection', async () => {
  render(<App />);

  bridge.emit('voice.connected', {
    username: 'me',
    channelId: 7,
    users: [
      { session: 1, name: 'me', self: true, companionId: 'bee' },
      { session: 2, name: 'alice', self: false, companionId: 'retro' },
    ],
  });
  bridge.emit('voice.userSpeaking', { session: 2 });

  expect(await screen.findByTestId('companion-sprite')).toHaveAttribute('data-companion-id', 'retro');
});

it('reconciles local myCompanion after connect when server state differs', async () => {
  localStorage.setItem('brmble-settings', JSON.stringify({
    overlay: { ...DEFAULT_OVERLAY, myCompanion: 'floppy' }
  }));

  render(<App />);
  bridge.emit('voice.connected', {
    users: [{ session: 1, name: 'me', self: true, companionId: 'bee' }],
  });

  expect(bridge.send).toHaveBeenCalledWith('voice.setCompanion', { companionId: 'floppy' });
});
```

- [x] **Step 2: Run the frontend tests to verify they fail**

Run: `npm run test -- src/Brmble.Web/src/App.companionVisibility.test.tsx src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
Expected: FAIL because `User` does not track `companionId`, mapping events ignore it, and `companionsByUser` still assigns remote users `undefined`.

- [x] **Step 3: Add `companionId` to frontend voice state and mapping handlers**

```ts
// src/Brmble.Web/src/App.tsx
interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  comment?: string;
  matrixUserId?: string;
  avatarUrl?: string;
  certHash?: string;
  companionId?: CompanionId;
  isBrmbleClient?: boolean;
}
```

```ts
const onUserMappingUpdated = (data: unknown) => {
  const d = data as { sessionId: number; matrixUserId?: string; companionId?: CompanionId; isBrmbleClient?: boolean; action: string } | undefined;
  if (d?.sessionId !== undefined) {
    setUsers(prev => prev.map(u =>
      u.session === d.sessionId
        ? {
            ...u,
            matrixUserId: d.action === 'added' ? d.matrixUserId : undefined,
            companionId: d.action === 'added' ? d.companionId : u.companionId,
            isBrmbleClient: d.action === 'added' ? d.isBrmbleClient : undefined,
          }
        : u
    ));
  }
};
```

```ts
const onVoiceCompanionChanged = (data: unknown) => {
  const d = data as { session?: number; companionId?: CompanionId } | undefined;
  if (d?.session === undefined || !d.companionId) return;
  setUsers(prev => prev.map(u => u.session === d.session ? { ...u, companionId: d.companionId } : u));
};
```

- [x] **Step 4: Rebuild `companionsByUser` from actual user companion state and reconcile on connect**

```ts
const selfUser = d?.users?.find(u => u.self);
if (selfUser?.companionId && selfUser.companionId !== overlaySettingsRef.current.myCompanion) {
  bridge.send('voice.setCompanion', { companionId: overlaySettingsRef.current.myCompanion });
}
```

```ts
const companionsByUser = users.reduce<CompanionOverlaySnapshot['fullCompanion']['companionsByUser']>((acc, user) => {
  acc[user.session] = {
    session: user.session,
    name: user.name || 'Unknown user',
    companionId: user.self ? overlaySettings.myCompanion : user.companionId,
    isProxy: false,
  };
  return acc;
}, {});
```

- [x] **Step 5: Register the new bridge event and tighten overlay expectations**

```ts
bridge.on('voice.companionChanged', onVoiceCompanionChanged);
// cleanup
bridge.off('voice.companionChanged', onVoiceCompanionChanged);
```

```ts
// src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts
expect(snapshot.fullCompanion.activeDisplay).toEqual(expect.objectContaining({
  representedSession: 7,
  companionId: 'retro',
  isProxy: false,
}));
```

- [x] **Step 6: Run the frontend companion suites**

Run: `npm run test -- src/Brmble.Web/src/App.companionVisibility.test.tsx src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx`
Expected: PASS with remote companions rendered as real companions and offline-to-online reconciliation covered.

- [x] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts src/Brmble.Web/src/App.companionVisibility.test.tsx src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts src/Brmble.Web/src/components/CompanionOverlay/FullCompanionOverlay.test.tsx
git commit -m "feat(web): render remote companion visibility from voice state"
```

## Task 6: Add settings live-sync, revert-on-failure, and UI coverage

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/InterfaceSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/components/CompanionOverlay/InterfaceSettingsTab.test.tsx`
- Test: `src/Brmble.Web/src/App.companionVisibility.test.tsx`

- [x] **Step 1: Write failing tests for live sync and revert**
- [x] **Step 2: Run the settings-focused web tests**
- [x] **Step 3: Thread a dedicated overlay-companion callback from `App` into `SettingsModal`**
- [x] **Step 4: Implement live-sync and revert handling in `App.tsx`**
- [x] **Step 5: Wire the prop into the rendered modal and register bridge cleanup**
- [x] **Step 6: Run the full companion-visibility frontend tests**
- [x] **Step 7: Commit**

## Final Verification

- [x] **Step 1: Run the server regression slice**
- [x] **Step 2: Run the native client regression slice**
- [x] **Step 3: Run the frontend regression slice**
- [x] **Step 4: Manual same-channel verification**

## Spec Coverage Check

- Database persistence: covered by Task 1.
- Session mapping model and snapshots: covered by Task 2.
- `/auth/companion` endpoint and channel-scoped broadcast: covered by Task 3.
- Native bridge request/response and WebSocket parsing: covered by Task 4.
- Frontend `users` source-of-truth, overlay derivation, and reconciliation: covered by Task 5.
- Settings live sync, revert-on-failure, and disconnected local edits: covered by Task 6.

No uncovered spec sections remain.


