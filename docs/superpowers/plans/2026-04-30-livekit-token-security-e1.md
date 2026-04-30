# LiveKit Token & Security E1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Access Control Foundation for LiveKit so the server becomes the authority for share discovery and publish-vs-subscribe token issuance.

**Architecture:** Concentrate the E1 changes in the server LiveKit boundary: `LiveKitEndpoints.cs` validates identity and request shape, while `LiveKitService.cs` generates least-privilege tokens based on an explicit access mode instead of a single broad grant set. Keep the first pass minimal by tying authorization to authenticated channel membership and the user's current room/channel context before adding later lifecycle features in E2.

**Tech Stack:** ASP.NET Core minimal APIs, C#, Livekit.Server.Sdk.Dotnet, MSTest, Moq

---

## File Map

- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
  Purpose: require auth on `GET /livekit/active-share`, parse token request access mode, validate room/channel shape, and return the correct status codes.
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
  Purpose: replace broad token issuance with explicit publish/subscribe token generation and centralize E1 authorization checks.
- Create: `src/Brmble.Server/LiveKit/LiveKitAccessMode.cs`
  Purpose: define the explicit access mode contract for token issuance.
- Create: `src/Brmble.Server/LiveKit/LiveKitAuthorizationResult.cs`
  Purpose: keep endpoint/service authorization decisions explicit instead of overloading `null` and booleans.
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
  Purpose: lock down endpoint auth, request parsing, and HTTP status behavior for `active-share` and `token`.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`
  Purpose: verify token grants differ correctly between publish and subscribe modes and that unauthorized cases fail cleanly.

### Task 1: Introduce Explicit LiveKit Access Modes And Scoped Token Generation

**Files:**
- Create: `src/Brmble.Server/LiveKit/LiveKitAccessMode.cs`
- Create: `src/Brmble.Server/LiveKit/LiveKitAuthorizationResult.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

- [ ] **Step 1: Write the failing service tests for publish and subscribe token scopes**

Add these tests to `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`:

```csharp
[TestMethod]
public async Task GenerateToken_SubscribeMode_GrantsSubscribeButNotPublish()
{
    _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
        .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

    var token = await _svc.GenerateToken("cert123", "channel-1", LiveKitAccessMode.Subscribe);
    Assert.IsNotNull(token);

    var parts = token.Split('.');
    var payload = parts[1].Replace('-', '+').Replace('_', '/');
    switch (payload.Length % 4)
    {
        case 2: payload += "=="; break;
        case 3: payload += "="; break;
    }

    var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
    using var doc = System.Text.Json.JsonDocument.Parse(json);
    var video = doc.RootElement.GetProperty("video");

    Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
    Assert.IsFalse(video.GetProperty("canPublish").GetBoolean());
}

[TestMethod]
public async Task GenerateToken_PublishMode_GrantsPublishAndSubscribe()
{
    _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
        .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

    var token = await _svc.GenerateToken("cert123", "channel-1", LiveKitAccessMode.Publish);
    Assert.IsNotNull(token);

    var parts = token.Split('.');
    var payload = parts[1].Replace('-', '+').Replace('_', '/');
    switch (payload.Length % 4)
    {
        case 2: payload += "=="; break;
        case 3: payload += "="; break;
    }

    var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
    using var doc = System.Text.Json.JsonDocument.Parse(json);
    var video = doc.RootElement.GetProperty("video");

    Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
    Assert.IsTrue(video.GetProperty("canPublish").GetBoolean());
}
```

- [ ] **Step 2: Run the service tests and confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GenerateToken_" -v n`

Expected: FAIL because `LiveKitAccessMode` does not exist and `GenerateToken` still takes only `(certHash, roomName)`.

- [ ] **Step 3: Add the new access mode and authorization result types**

Create `src/Brmble.Server/LiveKit/LiveKitAccessMode.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public enum LiveKitAccessMode
{
    Subscribe,
    Publish,
}
```

Create `src/Brmble.Server/LiveKit/LiveKitAuthorizationResult.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public enum LiveKitAuthorizationFailure
{
    Unauthorized,
    Forbidden,
    InvalidRoom,
}

public sealed record LiveKitAuthorizationResult(
    bool Allowed,
    string? CertHash,
    string? RoomName,
    LiveKitAccessMode? AccessMode,
    LiveKitAuthorizationFailure? Failure)
{
    public static LiveKitAuthorizationResult Success(string certHash, string roomName, LiveKitAccessMode mode) =>
        new(true, certHash, roomName, mode, null);

    public static LiveKitAuthorizationResult Denied(LiveKitAuthorizationFailure failure) =>
        new(false, null, null, null, failure);
}
```

- [ ] **Step 4: Update `LiveKitService.GenerateToken` to accept access mode and issue scoped grants**

Replace the method in `src/Brmble.Server/LiveKit/LiveKitService.cs` with:

```csharp
public async Task<string?> GenerateToken(string certHash, string roomName, LiveKitAccessMode accessMode)
{
    var user = await _userRepo.GetByCertHash(certHash);
    if (user is null)
    {
        _logger.LogWarning("Token request for unknown cert hash: {CertHash}", certHash);
        return null;
    }

    var grants = accessMode switch
    {
        LiveKitAccessMode.Subscribe => new VideoGrants
        {
            RoomJoin = true,
            Room = roomName,
            CanPublish = false,
            CanSubscribe = true,
        },
        LiveKitAccessMode.Publish => new VideoGrants
        {
            RoomJoin = true,
            Room = roomName,
            CanPublish = true,
            CanSubscribe = true,
        },
        _ => throw new ArgumentOutOfRangeException(nameof(accessMode), accessMode, null),
    };

    var token = new AccessToken(_settings.ApiKey, _settings.ApiSecret)
        .WithIdentity(user.MatrixUserId)
        .WithName(user.DisplayName)
        .WithGrants(grants)
        .WithTtl(DefaultTokenTtl);

    return token.ToJwt();
}
```

- [ ] **Step 5: Run the service tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GenerateToken_" -v n`

Expected: PASS for the known-user token tests with distinct publish/subscribe grants.

- [ ] **Step 6: Commit the access-mode foundation**

```bash
git add src/Brmble.Server/LiveKit/LiveKitAccessMode.cs src/Brmble.Server/LiveKit/LiveKitAuthorizationResult.cs src/Brmble.Server/LiveKit/LiveKitService.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs
git commit -m "feat: scope livekit tokens by access mode"
```

### Task 2: Lock Down `/livekit/token` Request Shape And Authorization Responses

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`

- [ ] **Step 1: Write failing endpoint tests for missing access mode and unauthorized token requests**

Create `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs` with these first tests:

```csharp
using System.Net;
using System.Net.Http.Json;
using Brmble.Server.LiveKit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitEndpointsTests
{
    [TestMethod]
    public async Task TokenRequest_WithoutAccessMode_ReturnsBadRequest()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1" });

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [TestMethod]
    public async Task TokenRequest_WithoutClientIdentity_ReturnsUnauthorized()
    {
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
```

- [ ] **Step 2: Run the endpoint tests and confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "TokenRequest_" -v n`

Expected: FAIL because the endpoint currently accepts requests without `accessMode` and the test file does not yet compile cleanly against the current setup.

- [ ] **Step 3: Update the token endpoint to require `accessMode` and parse it explicitly**

Replace the request-body parsing block in `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` with:

```csharp
string? roomName = null;
string? accessModeRaw = null;
try
{
    using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
    roomName = doc.RootElement.TryGetProperty("roomName", out var roomProp)
        ? roomProp.GetString()
        : null;
    accessModeRaw = doc.RootElement.TryGetProperty("accessMode", out var modeProp)
        ? modeProp.GetString()
        : null;
}
catch (Exception ex)
{
    logger.LogWarning(ex, "Failed to parse LiveKit token request body");
}

if (string.IsNullOrWhiteSpace(roomName))
    return Results.BadRequest(new { error = "roomName is required" });

if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
    return Results.BadRequest(new { error = "invalid roomName format" });

if (!Enum.TryParse<LiveKitAccessMode>(accessModeRaw, true, out var accessMode))
    return Results.BadRequest(new { error = "accessMode must be 'publish' or 'subscribe'" });

var token = await liveKitService.GenerateToken(certHash, roomName, accessMode);
```

- [ ] **Step 4: Run the endpoint tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "TokenRequest_" -v n`

Expected: PASS for missing-access-mode and missing-identity behavior.

- [ ] **Step 5: Commit the token endpoint request-shape change**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs
git commit -m "feat: require livekit token access mode"
```

### Task 3: Require Auth On `/livekit/active-share`

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`

- [ ] **Step 1: Add a failing test for unauthenticated active-share requests**

Append this test to `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`:

```csharp
[TestMethod]
public async Task ActiveShare_WithoutClientIdentity_ReturnsUnauthorized()
{
    await using var factory = new WebApplicationFactory<Program>();
    using var client = factory.CreateClient();

    var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

    Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
}
```

- [ ] **Step 2: Run the active-share auth test and confirm it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_WithoutClientIdentity_ReturnsUnauthorized" -v n`

Expected: FAIL because `/livekit/active-share` currently returns `200 OK` without checking identity.

- [ ] **Step 3: Add the missing identity check to `/livekit/active-share`**

Change the endpoint signature and first lines in `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` to:

```csharp
app.MapGet("/livekit/active-share", (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    ScreenShareTracker tracker,
    ISessionMappingService sessionMapping) =>
{
    var certHash = certHashExtractor.GetCertHash(httpContext);
    if (string.IsNullOrWhiteSpace(certHash))
        return Results.Unauthorized();

    var roomName = httpContext.Request.Query["roomName"].ToString();
```

- [ ] **Step 4: Run the active-share auth test and confirm it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_WithoutClientIdentity_ReturnsUnauthorized" -v n`

Expected: PASS.

- [ ] **Step 5: Commit the missing active-share auth fix**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs
git commit -m "fix: require auth on livekit active-share"
```

### Task 4: Enforce Room/Channel Permission Decisions In One Server Path

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

- [ ] **Step 1: Add failing tests for forbidden publish vs allowed subscribe behavior**

Add these tests to `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`:

```csharp
[TestMethod]
public async Task AuthorizeTokenRequest_PublishDenied_ReturnsForbidden()
{
    var result = await _svc.AuthorizeTokenRequest("cert123", "channel-1", LiveKitAccessMode.Publish, canPublish: false, canSubscribe: true);

    Assert.IsFalse(result.Allowed);
    Assert.AreEqual(LiveKitAuthorizationFailure.Forbidden, result.Failure);
}

[TestMethod]
public async Task AuthorizeTokenRequest_SubscribeAllowed_ReturnsSuccess()
{
    var result = await _svc.AuthorizeTokenRequest("cert123", "channel-1", LiveKitAccessMode.Subscribe, canPublish: false, canSubscribe: true);

    Assert.IsTrue(result.Allowed);
    Assert.AreEqual(LiveKitAccessMode.Subscribe, result.AccessMode);
}
```

- [ ] **Step 2: Run the authorization tests and confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "AuthorizeTokenRequest_" -v n`

Expected: FAIL because `AuthorizeTokenRequest` does not exist yet.

- [ ] **Step 3: Add a narrow authorization helper to `LiveKitService`**

Add this method to `src/Brmble.Server/LiveKit/LiveKitService.cs`:

```csharp
public Task<LiveKitAuthorizationResult> AuthorizeTokenRequest(
    string certHash,
    string roomName,
    LiveKitAccessMode accessMode,
    bool canPublish,
    bool canSubscribe)
{
    if (string.IsNullOrWhiteSpace(certHash))
        return Task.FromResult(LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.Unauthorized));

    if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
        return Task.FromResult(LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.InvalidRoom));

    var allowed = accessMode switch
    {
        LiveKitAccessMode.Publish => canPublish,
        LiveKitAccessMode.Subscribe => canSubscribe,
        _ => false,
    };

    return Task.FromResult(
        allowed
            ? LiveKitAuthorizationResult.Success(certHash, roomName, accessMode)
            : LiveKitAuthorizationResult.Denied(LiveKitAuthorizationFailure.Forbidden));
}
```

- [ ] **Step 4: Thread the authorization result into the token endpoint with explicit `403` handling**

In `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`, after parsing `accessMode`, add:

```csharp
var authz = await liveKitService.AuthorizeTokenRequest(
    certHash,
    roomName,
    accessMode,
    canPublish: accessMode == LiveKitAccessMode.Publish,
    canSubscribe: true);

if (!authz.Allowed)
{
    return authz.Failure switch
    {
        LiveKitAuthorizationFailure.Unauthorized => Results.Unauthorized(),
        LiveKitAuthorizationFailure.Forbidden => Results.StatusCode(StatusCodes.Status403Forbidden),
        LiveKitAuthorizationFailure.InvalidRoom => Results.BadRequest(new { error = "invalid roomName format" }),
        _ => Results.StatusCode(StatusCodes.Status403Forbidden),
    };
}

var token = await liveKitService.GenerateToken(certHash, roomName, accessMode);
```

This first pass intentionally keeps permission input narrow and local. Later work can swap the boolean inputs for real channel-permission resolution without changing endpoint semantics.

- [ ] **Step 5: Run the server LiveKit tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "LiveKit" -v n`

Expected: PASS for the LiveKit service and endpoint tests.

- [ ] **Step 6: Commit the E1 authorization foundation**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs src/Brmble.Server/LiveKit/LiveKitService.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs
git commit -m "feat: add livekit access control foundation"
```
