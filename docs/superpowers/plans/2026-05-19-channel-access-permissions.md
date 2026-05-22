# Channel Access Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Brmble surface Mumble channel entry restrictions, password-gated joins, and Matrix channel chat access based on Mumble permissions.

**Architecture:** Mumble remains the source of truth. Server-side chat access uses ICE `hasPermission(..., PermissionTextMessage)` through `IMumbleAclService`, while the native client forwards Mumble's channel enter state and structured denial events to React. React uses the forwarded state for lock icons and join UX, and uses server-reported chat access to gate channel chat navigation, unread badges, history display, and Matrix sends.

**Tech Stack:** C#/.NET minimal APIs, MSTest/Moq, MumbleSharp protocol models, raw Win32/WebView2 native bridge, React 19 + TypeScript + Vitest/Testing Library, existing Brmble UI guide tokens/components.

---

## File Structure

### Server ACL And Chat Access

- Modify: `src/Brmble.Server/Mumble/IMumbleAclService.cs`
  - Add `HasTextMessagePermissionAsync(int sessionId, int channelId)` to `IMumbleAclService`.
  - Keep `IMumbleAclIceClient.HasPermissionAsync(...)` unchanged.
- Modify: `src/Brmble.Server/Mumble/MumbleAclService.cs`
  - Implement `HasTextMessagePermissionAsync` by delegating to `MumbleServer.PermissionTextMessage.value`.
- Create: `src/Brmble.Server/Mumble/ChannelChatAccessEndpoints.cs`
  - Add authenticated endpoint `POST /chat/channel-access` that resolves the current Brmble user from the client certificate, resolves their live Mumble session through `ISessionMappingService`, and returns per-channel `canRead`/`canSend` values.
  - Filter invalid channel IDs out of the response rather than failing the whole request.
- Modify: `src/Brmble.Server/Program.cs`
  - Register `app.MapChannelChatAccessEndpoints();` near other Brmble API endpoint mappings.
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs`
  - Add delegation coverage for `PermissionTextMessage`.
- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
  - Add injectable mocks for `IMumbleAclService` and `ISessionMappingService` used by the new endpoint tests.
- Create: `tests/Brmble.Server.Tests/Integration/ChannelChatAccessEndpointTests.cs`
  - Cover unauthenticated, unknown user, unmapped session, successful response, and filtering of invalid channel IDs.

### Native Client Bridge

- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  - Include `canEnter` and `hasPasswordRestriction` in `voice.connected` and `voice.channelJoined` channel payloads.
  - Add a small helper that detects Brmble-managed password restrictions from channel ACL snapshots already fetched for ACL admin support without exposing the plaintext password to React.
  - Forward structured `PermissionDenied` fields: `denyType`, `permission`, `channelId`, `session`, `reason`, `name`, and `message`.
  - Join with password by sending `UserState.TemporaryAccessTokens` for the join attempt instead of persisting an access token through authenticate.
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`
  - Cover initial channel snapshot payloads with `canEnter` and password boolean.
  - Cover channel update payloads with `canEnter`.
  - Cover structured permission denied payloads.
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
  - Cover `voice.joinChannel` password payload sending a temporary access token and not storing it as a persistent access token.

### React Types And Chat Access State

- Modify: `src/Brmble.Web/src/types/index.ts`
  - Add `canEnter`, `hasPasswordRestriction`, `canOpenChat`, and `canSendChat` to exported `Channel`.
- Modify: `src/Brmble.Web/src/App.tsx`
  - Add the same fields to the local `Channel` interface.
  - Add pure helpers for channel chat access merging and checks so Vitest can cover behavior without rendering the whole app:
    - `mergeChannelChatAccess(channels, access)`
    - `canOpenChannelChat(channelId, channels)`
    - `canSendToChannelChat(channelId, channels)`
    - `isStructuredEnterDenied(data)`
    - `getChannelAccessDeniedMessage(channel)`
  - Request channel chat access when Brmble API credentials become available and channels change.
  - Merge access results into `channels` without replacing voice-side channel fields.
  - Gate Matrix active channel, channel selection, channel unread badges, message history display, and Matrix sends with `canOpenChat`/`canSendChat`.
  - Preserve Mumble temporary chat behavior during Brmble service outages.
- Modify: `src/Brmble.Web/src/App.chatMode.test.ts`
  - Extend pure helper coverage for chat access gating and structured denial behavior.

### React Channel Tree And Join UX

- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
  - Add `canEnter` and `hasPasswordRestriction` to local `Channel` interface.
  - Render no lock, open lock, or closed lock with existing `<Icon>`/`Tooltip` patterns.
  - Keep all visual styling in existing CSS tokens and existing channel-row structure.
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
  - Add `lock` and `unlock` icon definitions in the server/channel icon section.
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
  - Add token-based lock icon spacing/color classes for the new lock element.
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`
  - Add lock icon rendering coverage.
  - Add assertions that no plaintext password appears in lock UI.
- Modify: `src/Brmble.Web/src/App.tsx`
  - Prompt before the first join attempt when `canEnter === false && hasPasswordRestriction === true`.
  - Send password through `voice.joinChannel` payload only for that attempt.
  - Show a non-fatal access message for denied restricted joins.
  - Do not update `voice` service status to broken/disconnected for `PermissionDenied` enter denials.

### Chat Panel UX

- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
  - Use existing `disabled` and `topNotice` props to show channel chat access feedback.
  - Do not add a new notification/toast system.
- Modify: `src/Brmble.Web/src/App.chatMode.test.ts`
  - Prefer pure App helper tests for chat gating and notice decisions.

---

## Task 1: Server ACL TextMessage Permission

**Files:**
- Modify: `src/Brmble.Server/Mumble/IMumbleAclService.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleAclService.cs`
- Test: `tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs` after `HasWritePermissionAsync_DelegatesToMumblePermissionWrite`:

```csharp
[TestMethod]
public async Task HasTextMessagePermissionAsync_DelegatesToMumblePermissionTextMessage()
{
    var ice = new Mock<IMumbleAclIceClient>();
    ice.Setup(i => i.HasPermissionAsync(12, 5, MumbleServer.PermissionTextMessage.value)).ReturnsAsync(true);
    var service = new MumbleAclService(ice.Object, NullLogger<MumbleAclService>.Instance);

    Assert.IsTrue(await service.HasTextMessagePermissionAsync(sessionId: 12, channelId: 5));
    ice.Verify(i => i.HasPermissionAsync(12, 5, MumbleServer.PermissionTextMessage.value), Times.Once);
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter HasTextMessagePermissionAsync_DelegatesToMumblePermissionTextMessage`

Expected: FAIL with a compile error because `MumbleAclService` has no `HasTextMessagePermissionAsync` method.

- [ ] **Step 3: Add the interface method**

Update `src/Brmble.Server/Mumble/IMumbleAclService.cs`:

```csharp
public interface IMumbleAclService
{
    Task<AclChannelSnapshotDto> GetChannelAclAsync(int channelId);
    Task SetChannelAclAsync(int channelId, AclUpdateRequest request);
    Task AddUserToGroupAsync(int channelId, int sessionId, string group);
    Task RemoveUserFromGroupAsync(int channelId, int sessionId, string group);
    Task<bool> HasWritePermissionAsync(int sessionId, int channelId);
    Task<bool> HasTextMessagePermissionAsync(int sessionId, int channelId);
}
```

- [ ] **Step 4: Implement the service method**

Add this method to `src/Brmble.Server/Mumble/MumbleAclService.cs` after `HasWritePermissionAsync`:

```csharp
public async Task<bool> HasTextMessagePermissionAsync(int sessionId, int channelId)
{
    try
    {
        return await _iceClient.HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionTextMessage.value);
    }
    catch (Exception ex) when (ex is not MumbleAclUnavailableException and not MumbleAclException)
    {
        _logger.LogWarning(ex, "Failed to verify text message permission for session {SessionId} on channel {ChannelId}", sessionId, channelId);
        throw new MumbleAclException($"Failed to verify text message permission for session {sessionId} on channel {channelId}.", ex);
    }
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter HasTextMessagePermissionAsync_DelegatesToMumblePermissionTextMessage`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/Mumble/IMumbleAclService.cs src/Brmble.Server/Mumble/MumbleAclService.cs tests/Brmble.Server.Tests/Mumble/MumbleAclServiceTests.cs
git commit -m "feat: add Mumble text message permission check"
```

---

## Task 2: Server Channel Chat Access Endpoint

**Files:**
- Create: `src/Brmble.Server/Mumble/ChannelChatAccessEndpoints.cs`
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`
- Test: `tests/Brmble.Server.Tests/Integration/ChannelChatAccessEndpointTests.cs`

- [ ] **Step 1: Extend the integration factory with mocks**

Modify `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` to add the missing using and two mock properties:

```csharp
using Brmble.Server.Events;
```

Add properties next to the existing mocks:

```csharp
public Mock<IMumbleAclService> MumbleAclMock { get; } = new();
public Mock<ISessionMappingService> SessionMappingMock { get; } = new();
```

Add replacements in `ConfigureServices` after the ACL coordinator replacement:

```csharp
var aclService = services.FirstOrDefault(d => d.ServiceType == typeof(IMumbleAclService));
if (aclService != null) services.Remove(aclService);
services.AddSingleton(MumbleAclMock.Object);

var sessionMapping = services.FirstOrDefault(d => d.ServiceType == typeof(ISessionMappingService));
if (sessionMapping != null) services.Remove(sessionMapping);
services.AddSingleton(SessionMappingMock.Object);
```

- [ ] **Step 2: Write the failing endpoint tests**

Create `tests/Brmble.Server.Tests/Integration/ChannelChatAccessEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ChannelChatAccessEndpointTests
{
    [TestMethod]
    public async Task GetChannelChatAccess_Unauthenticated_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1]));

        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelChatAccess_AuthenticatedButNoLiveMumbleSession_ReturnsForbidden()
    {
        using var factory = new BrmbleServerFactory("cert_chat_no_session");
        var user = await SeedUser(factory, "cert_chat_no_session", "Alice");
        var ignoredSession = 0;
        factory.SessionMappingMock
            .Setup(s => s.TryGetSessionByUserId(user.Id, out ignoredSession))
            .Returns(false);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1]));

        Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [TestMethod]
    public async Task GetChannelChatAccess_ReturnsTextMessageAccessForEachValidChannel()
    {
        using var factory = new BrmbleServerFactory("cert_chat_access");
        var user = await SeedUser(factory, "cert_chat_access", "Alice");
        var sessionId = 42;
        factory.SessionMappingMock
            .Setup(s => s.TryGetSessionByUserId(user.Id, out sessionId))
            .Returns(true);
        factory.MumbleAclMock.Setup(a => a.HasTextMessagePermissionAsync(42, 1)).ReturnsAsync(true);
        factory.MumbleAclMock.Setup(a => a.HasTextMessagePermissionAsync(42, 2)).ReturnsAsync(false);
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/chat/channel-access", new ChannelChatAccessRequest([1, 2, 0, -5, 1]));

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<ChannelChatAccessResponse>();
        Assert.IsNotNull(result);
        Assert.AreEqual(2, result.Channels.Count);
        Assert.IsTrue(result.Channels["1"].CanRead);
        Assert.IsTrue(result.Channels["1"].CanSend);
        Assert.IsFalse(result.Channels["2"].CanRead);
        Assert.IsFalse(result.Channels["2"].CanSend);
        factory.MumbleAclMock.Verify(a => a.HasTextMessagePermissionAsync(42, 1), Times.Once);
    }

    private static async Task<User> SeedUser(BrmbleServerFactory factory, string certHash, string name)
    {
        using var scope = factory.Services.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<UserRepository>();
        return await repo.Insert(certHash, name);
    }
}
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter ChannelChatAccessEndpointTests`

Expected: FAIL with compile errors because `ChannelChatAccessRequest`, `ChannelChatAccessResponse`, and the endpoint do not exist.

- [ ] **Step 4: Create the endpoint file**

Create `src/Brmble.Server/Mumble/ChannelChatAccessEndpoints.cs`:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public sealed record ChannelChatAccessRequest(int[] ChannelIds);

public sealed record ChannelChatAccessState(bool CanRead, bool CanSend);

public sealed record ChannelChatAccessResponse(Dictionary<string, ChannelChatAccessState> Channels);

public static class ChannelChatAccessEndpoints
{
    public static IEndpointRouteBuilder MapChannelChatAccessEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/chat/channel-access", async (
            ChannelChatAccessRequest request,
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ISessionMappingService sessionMapping,
            IMumbleAclService aclService) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
            {
                return Results.Unauthorized();
            }

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
            {
                return Results.Unauthorized();
            }

            if (!sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId))
            {
                return Results.StatusCode(StatusCodes.Status403Forbidden);
            }

            var channels = new Dictionary<string, ChannelChatAccessState>();
            foreach (var channelId in request.ChannelIds.Where(id => id > 0).Distinct())
            {
                var allowed = await aclService.HasTextMessagePermissionAsync(sessionId, channelId);
                channels[channelId.ToString()] = new ChannelChatAccessState(allowed, allowed);
            }

            return Results.Ok(new ChannelChatAccessResponse(channels));
        });

        return app;
    }
}
```

- [ ] **Step 5: Register the endpoint**

Modify `src/Brmble.Server/Program.cs` so the endpoint mappings include:

```csharp
app.MapAclAdminEndpoints();
app.MapChannelChatAccessEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
```

- [ ] **Step 6: Run the focused tests and verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter ChannelChatAccessEndpointTests`

Expected: PASS.

- [ ] **Step 7: Run ACL server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "MumbleAclServiceTests|ChannelChatAccessEndpointTests|AclAdminEndpointTests"`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Server/Program.cs src/Brmble.Server/Mumble/ChannelChatAccessEndpoints.cs tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs tests/Brmble.Server.Tests/Integration/ChannelChatAccessEndpointTests.cs
git commit -m "feat: expose channel chat access endpoint"
```

---

## Task 3: Native Channel State Payloads

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [ ] **Step 1: Write failing tests for `canEnter` in snapshots and updates**

In `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`, replace `SendVoiceConnected_IncludesChannelEnterRestrictionState` with:

```csharp
[TestMethod]
public void SendVoiceConnected_IncludesChannelEnterRestrictionState()
{
    var adapter = CreateAdapterWithBridge(out var bridge);
    var channels = GetChannelDictionary(adapter);
    channels[4] = new Channel(adapter, 4, "Secret", 0)
    {
        IsEnterRestricted = true,
        CanEnter = false,
    };

    InvokePrivate(adapter, "SendVoiceConnected");

    var sent = NativeBridgeTestHarness.DrainMessages(bridge);
    var connected = sent.Single(m => m.Type == "voice.connected");
    using var doc = JsonDocument.Parse(connected.DataJson);
    var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

    Assert.AreEqual(4u, channel.GetProperty("id").GetUInt32());
    Assert.IsTrue(channel.GetProperty("isEnterRestricted").GetBoolean());
    Assert.IsFalse(channel.GetProperty("canEnter").GetBoolean());
    Assert.IsFalse(channel.GetProperty("hasPasswordRestriction").GetBoolean());
}

[TestMethod]
public void ChannelState_IncludesCanEnterInBridgePayload()
{
    var adapter = CreateAdapterWithBridge(out var bridge);

    adapter.ChannelState(new MumbleProto.ChannelState
    {
        ChannelId = 4,
        Name = "Secret",
        Parent = 0,
        IsEnterRestricted = true,
        CanEnter = true,
    });

    var sent = NativeBridgeTestHarness.DrainMessages(bridge);
    var channelJoined = sent.Single(m => m.Type == "voice.channelJoined");
    using var doc = JsonDocument.Parse(channelJoined.DataJson);

    Assert.AreEqual(4u, doc.RootElement.GetProperty("id").GetUInt32());
    Assert.IsTrue(doc.RootElement.GetProperty("isEnterRestricted").GetBoolean());
    Assert.IsTrue(doc.RootElement.GetProperty("canEnter").GetBoolean());
    Assert.IsFalse(doc.RootElement.GetProperty("hasPasswordRestriction").GetBoolean());
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SendVoiceConnected_IncludesChannelEnterRestrictionState|ChannelState_IncludesCanEnterInBridgePayload"`

Expected: FAIL because `canEnter` and `hasPasswordRestriction` are missing from payloads.

- [ ] **Step 3: Add a channel payload helper**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, add this private helper near `SendVoiceConnected`:

```csharp
private object CreateChannelPayload(Channel channel) => new
{
    id = channel.Id,
    name = channel.Name,
    parent = channel.Parent,
    isEnterRestricted = channel.IsEnterRestricted,
    canEnter = channel.CanEnter,
    hasPasswordRestriction = false,
};
```

- [ ] **Step 4: Use the helper in the initial snapshot**

Replace the `channels` projection in `SendVoiceConnected` with:

```csharp
var channels = Channels.Select(CreateChannelPayload).ToList();
```

- [ ] **Step 5: Use the helper in channel updates**

Replace the `voice.channelJoined` anonymous object in `ChannelState(ChannelState channelState)` with:

```csharp
_bridge?.Send("voice.channelJoined", CreateChannelPayload(channel));
```

- [ ] **Step 6: Run the focused tests and verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "SendVoiceConnected_IncludesChannelEnterRestrictionState|ChannelState_IncludesCanEnterInBridgePayload"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat: forward channel enter state to UI"
```

---

## Task 4: Native Password Restriction Boolean

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`

- [ ] **Step 1: Write the failing password boolean test**

Add this test to `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`:

```csharp
[TestMethod]
public void SendVoiceConnected_DoesNotExposeManagedPasswordPlaintext()
{
    var adapter = CreateAdapterWithBridge(out var bridge);
    var channels = GetChannelDictionary(adapter);
    channels[4] = new Channel(adapter, 4, "Secret", 0)
    {
        IsEnterRestricted = true,
        CanEnter = false,
    };
    SetPrivateField(adapter, "_channelPasswordRestrictions", new System.Collections.Concurrent.ConcurrentDictionary<uint, bool>(
        new[] { new KeyValuePair<uint, bool>(4, true) }));

    InvokePrivate(adapter, "SendVoiceConnected");

    var sent = NativeBridgeTestHarness.DrainMessages(bridge);
    var connected = sent.Single(m => m.Type == "voice.connected");
    using var doc = JsonDocument.Parse(connected.DataJson);
    var channel = doc.RootElement.GetProperty("channels").EnumerateArray().Single();

    Assert.IsTrue(channel.GetProperty("hasPasswordRestriction").GetBoolean());
    Assert.IsFalse(connected.DataJson.Contains("secret", StringComparison.OrdinalIgnoreCase));
}
```

Add this helper near the other private helpers in the test file:

```csharp
private static void SetPrivateField(object instance, string name, object? value)
    => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(instance, value);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter SendVoiceConnected_DoesNotExposeManagedPasswordPlaintext`

Expected: FAIL because `_channelPasswordRestrictions` does not exist.

- [ ] **Step 3: Add password restriction state**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, add this field near other channel/session state fields:

```csharp
private readonly System.Collections.Concurrent.ConcurrentDictionary<uint, bool> _channelPasswordRestrictions = new();
```

- [ ] **Step 4: Use the password boolean in payloads**

Update `CreateChannelPayload`:

```csharp
private object CreateChannelPayload(Channel channel) => new
{
    id = channel.Id,
    name = channel.Name,
    parent = channel.Parent,
    isEnterRestricted = channel.IsEnterRestricted,
    canEnter = channel.CanEnter,
    hasPasswordRestriction = _channelPasswordRestrictions.TryGetValue(channel.Id, out var hasPasswordRestriction) && hasPasswordRestriction,
};
```

- [ ] **Step 5: Update the map from ACL payloads without exposing passwords**

Find the existing `HandleWebSocketMessage` code path that forwards `acl.changed` to `acl.changed`. In that code path, after extracting `channelId`, call:

```csharp
UpdateChannelPasswordRestriction(channelId, json);
```

Add these helpers near ACL helper methods:

```csharp
private void UpdateChannelPasswordRestriction(uint channelId, string aclJson)
{
    _channelPasswordRestrictions[channelId] = ContainsManagedPasswordMarker(aclJson);
    if (ChannelDictionary.TryGetValue(channelId, out var channel))
    {
        _bridge?.Send("voice.channelJoined", CreateChannelPayload(channel));
        _bridge?.NotifyUiThread();
    }
}

private static bool ContainsManagedPasswordMarker(string aclJson)
    => aclJson.Contains("__brmble_password_marker__:#", StringComparison.Ordinal);
```

This deliberately stores only a boolean and does not parse or forward the token value.

- [ ] **Step 6: Run focused native tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter MumbleAdapterBridgeTests`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs
git commit -m "feat: expose channel password restriction state"
```

---

## Task 5: Native Password Join And PermissionDenied Payloads

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing structured denial test**

Add this test to `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`:

```csharp
[TestMethod]
public void PermissionDenied_ForwardsStructuredFields()
{
    var adapter = CreateAdapterWithBridge(out var bridge);

    adapter.PermissionDenied(new MumbleProto.PermissionDenied
    {
        Type = MumbleProto.PermissionDenied.Types.DenyType.Permission,
        Permission = MumbleProto.PermissionDenied.Types.Permission.Enter,
        ChannelId = 4,
        Session = 12,
        Reason = "Denied",
        Name = "Secret",
    });

    var sent = NativeBridgeTestHarness.DrainMessages(bridge);
    var error = sent.Single(m => m.Type == "voice.error");
    using var doc = JsonDocument.Parse(error.DataJson);

    Assert.AreEqual("permissionDenied", doc.RootElement.GetProperty("type").GetString());
    Assert.AreEqual("Permission", doc.RootElement.GetProperty("denyType").GetString());
    Assert.AreEqual((int)MumbleProto.PermissionDenied.Types.Permission.Enter, doc.RootElement.GetProperty("permission").GetInt32());
    Assert.AreEqual(4u, doc.RootElement.GetProperty("channelId").GetUInt32());
    Assert.AreEqual(12u, doc.RootElement.GetProperty("session").GetUInt32());
    Assert.AreEqual("Denied", doc.RootElement.GetProperty("reason").GetString());
    Assert.AreEqual("Secret", doc.RootElement.GetProperty("name").GetString());
}
```

- [ ] **Step 2: Write failing temporary token join test**

Add this reflection-based test to `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`. This matches the existing test harness style and avoids adding `InternalsVisibleTo` just for one helper.

```csharp
[TestMethod]
public void CreateJoinUserState_IncludesTemporaryAccessTokenOnlyForThisJoin()
{
    var method = typeof(MumbleAdapter).GetMethod("CreateJoinUserState", BindingFlags.Static | BindingFlags.NonPublic);
    Assert.IsNotNull(method);

    var state = (UserState)method.Invoke(null, [4u, "secret-token"])!;

    Assert.AreEqual(4u, state.ChannelId);
    Assert.AreEqual(1, state.TemporaryAccessTokens.Count);
    Assert.AreEqual("secret-token", state.TemporaryAccessTokens[0]);

    var normalState = (UserState)method.Invoke(null, [5u, null])!;
    Assert.AreEqual(5u, normalState.ChannelId);
    Assert.AreEqual(0, normalState.TemporaryAccessTokens.Count);
}
```

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "PermissionDenied_ForwardsStructuredFields|CreateJoinUserState"`

Expected: FAIL because structured fields and temporary token user-state construction are missing.

- [ ] **Step 4: Add a join state helper and use temporary tokens**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, add this private helper:

```csharp
private static UserState CreateJoinUserState(uint channelId, string? password)
{
    var userState = new UserState { ChannelId = channelId };
    if (!string.IsNullOrWhiteSpace(password))
    {
        userState.TemporaryAccessTokens.Add(password);
    }
    return userState;
}
```

Update `JoinChannel(uint channelId, string? password)` to remove `_pendingJoinPassword`, `ApplyPendingJoinPasswordToken();`, and the old `new UserState { ChannelId = channelId }` send. Use:

```csharp
Connection.SendControl(PacketType.UserState, CreateJoinUserState(channelId, password));
```

Keep `SendPermissionQuery(new PermissionQuery { ChannelId = channelId });`.

- [ ] **Step 5: Stop clearing a persisted join token on permission denied**

In `PermissionDenied(PermissionDenied permissionDenied)`, remove:

```csharp
_pendingJoinPassword = null;
ClearTemporaryJoinToken();
```

Remove the now-unused `_pendingJoinPassword`, `_hasActiveJoinToken`, `ApplyPendingJoinPasswordToken`, and `ClearTemporaryJoinToken` members from `MumbleAdapter.cs`.

- [ ] **Step 6: Forward structured denial payloads**

Replace the bridge send in `PermissionDenied` with:

```csharp
_bridge?.Send("voice.error", new
{
    type = "permissionDenied",
    denyType = permissionDenied.Type.ToString(),
    permission = permissionDenied.ShouldSerializePermission() ? (int?)permissionDenied.Permission : null,
    channelId = permissionDenied.ShouldSerializeChannelId() ? (uint?)permissionDenied.ChannelId : null,
    session = permissionDenied.ShouldSerializeSession() ? (uint?)permissionDenied.Session : null,
    reason = permissionDenied.Reason,
    name = permissionDenied.Name,
    message = reason,
});
```

- [ ] **Step 7: Run focused native tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "MumbleAdapterBridgeTests|MumbleAdapterParseTests"`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: use temporary tokens for channel password joins"
```

---

## Task 6: React Channel Chat Access Helpers

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.chatMode.test.ts`

- [ ] **Step 1: Write failing pure helper tests**

Add imports in `src/Brmble.Web/src/App.chatMode.test.ts`:

```ts
import {
  canOpenChannelChat,
  canSendToChannelChat,
  getChannelAccessDeniedMessage,
  isStructuredEnterDenied,
  mergeChannelChatAccess,
} from './App';
```

Add tests:

```ts
describe('channel chat access helpers', () => {
  it('merges canRead and canSend without dropping voice channel state', () => {
    const result = mergeChannelChatAccess([
      { id: 1, name: 'General', isEnterRestricted: true, canEnter: false, hasPasswordRestriction: true },
      { id: 2, name: 'Quiet' },
    ], {
      '1': { canRead: false, canSend: false },
      '2': { canRead: true, canSend: true },
    });

    expect(result[0]).toMatchObject({
      id: 1,
      isEnterRestricted: true,
      canEnter: false,
      hasPasswordRestriction: true,
      canOpenChat: false,
      canSendChat: false,
    });
    expect(result[1]).toMatchObject({ canOpenChat: true, canSendChat: true });
  });

  it('allows server root chat and gates restricted Matrix channels', () => {
    const channels = [
      { id: 1, name: 'Allowed', canOpenChat: true, canSendChat: true },
      { id: 2, name: 'Denied', canOpenChat: false, canSendChat: false },
    ];

    expect(canOpenChannelChat('server-root', channels)).toBe(true);
    expect(canOpenChannelChat('1', channels)).toBe(true);
    expect(canOpenChannelChat('2', channels)).toBe(false);
    expect(canSendToChannelChat('1', channels)).toBe(true);
    expect(canSendToChannelChat('2', channels)).toBe(false);
  });
});

describe('structured channel access denial helpers', () => {
  it('classifies Enter permission denials by structured permission field', () => {
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 2, message: 'anything' })).toBe(true);
    expect(isStructuredEnterDenied({ type: 'permissionDenied', permission: 4, message: 'Enter appears in text only' })).toBe(false);
  });

  it('uses password-specific copy only when the channel is known password restricted', () => {
    expect(getChannelAccessDeniedMessage({ id: 1, name: 'Secret', hasPasswordRestriction: true })).toBe('Incorrect password or no access.');
    expect(getChannelAccessDeniedMessage({ id: 2, name: 'Private' })).toBe('You do not have access to that channel.');
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: FAIL because the helpers and fields do not exist.

- [ ] **Step 3: Extend exported Channel type**

Modify `src/Brmble.Web/src/types/index.ts`:

```ts
export interface Channel {
  id: number;
  name: string;
  parent?: number;
  type?: 'voice' | 'text';
  description?: string;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
  canOpenChat?: boolean;
  canSendChat?: boolean;
}
```

- [ ] **Step 4: Extend App local Channel type**

Modify the local `Channel` interface in `src/Brmble.Web/src/App.tsx`:

```ts
interface Channel {
  id: number;
  name: string;
  parent?: number;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
  canOpenChat?: boolean;
  canSendChat?: boolean;
}
```

- [ ] **Step 5: Add helper types and functions**

Add near `isMatrixChannelChatActive` in `src/Brmble.Web/src/App.tsx`:

```ts
interface ChannelChatAccessState {
  canRead: boolean;
  canSend: boolean;
}

type ChannelChatAccessMap = Record<string, ChannelChatAccessState>;

const MUMBLE_PERMISSION_ENTER = 2;

export function mergeChannelChatAccess(channels: Channel[], access: ChannelChatAccessMap): Channel[] {
  return channels.map(channel => {
    const state = access[String(channel.id)];
    if (!state) return channel;
    return {
      ...channel,
      canOpenChat: state.canRead,
      canSendChat: state.canSend,
    };
  });
}

export function canOpenChannelChat(channelId: string | undefined, channels: Channel[]): boolean {
  if (!channelId) return false;
  if (channelId === 'server-root') return true;
  const channel = channels.find(c => String(c.id) === channelId);
  return channel?.canOpenChat !== false;
}

export function canSendToChannelChat(channelId: string | undefined, channels: Channel[]): boolean {
  if (!channelId) return false;
  if (channelId === 'server-root') return true;
  const channel = channels.find(c => String(c.id) === channelId);
  return channel?.canSendChat !== false;
}

export function isStructuredEnterDenied(data: unknown): boolean {
  const d = data as { type?: string; permission?: number } | undefined;
  return d?.type === 'permissionDenied' && d.permission === MUMBLE_PERMISSION_ENTER;
}

export function getChannelAccessDeniedMessage(channel: Pick<Channel, 'hasPasswordRestriction'> | undefined): string {
  return channel?.hasPasswordRestriction
    ? 'Incorrect password or no access.'
    : 'You do not have access to that channel.';
}
```

- [ ] **Step 6: Run focused tests and verify they pass**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts
git commit -m "feat: add channel chat access helpers"
```

---

## Task 7: React Fetch And Apply Channel Chat Access

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.chatMode.test.ts`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Test: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Add a pure request planning helper test**

Add this test to `src/Brmble.Web/src/App.chatMode.test.ts`:

```ts
import { getChannelChatAccessRequestIds } from './App';

describe('getChannelChatAccessRequestIds', () => {
  it('requests only positive non-root channel IDs once', () => {
    expect(getChannelChatAccessRequestIds([
      { id: 0, name: 'Root' },
      { id: 1, name: 'General' },
      { id: 1, name: 'General duplicate' },
      { id: -2, name: 'Invalid' },
    ])).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: FAIL because `getChannelChatAccessRequestIds` is missing.

- [ ] **Step 3: Add request ID helper**

Add near the chat access helpers in `src/Brmble.Web/src/App.tsx`:

```ts
export function getChannelChatAccessRequestIds(channels: Channel[]): number[] {
  return [...new Set(channels.map(channel => channel.id).filter(id => id > 0))];
}
```

- [ ] **Step 4: Add bridge/API plumbing through native**

Because React does not own client certificates directly, use native bridge request/response events instead of `fetch` in React.

First add this native bridge test to `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`:

```csharp
[TestMethod]
public async Task ChatGetChannelAccess_WithoutApiUrl_ReturnsEmptyAccessMap()
{
    var bridge = NativeBridgeTestHarness.Create();
    var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: null);
    adapter.RegisterHandlers(bridge);

    using var doc = JsonDocument.Parse("""
    { "channelIds": [1, 2] }
    """);

    await NativeBridgeTestHarness.InvokeAsync(bridge, "chat.getChannelAccess", doc.RootElement.Clone());

    var sent = NativeBridgeTestHarness.DrainMessages(bridge);
    var access = sent.Single(m => m.Type == "chat.channelAccess");
    using var payload = JsonDocument.Parse(access.DataJson);
    Assert.AreEqual(0, payload.RootElement.GetProperty("channels").EnumerateObject().Count());
}
```

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter ChatGetChannelAccess_WithoutApiUrl_ReturnsEmptyAccessMap`

Expected: FAIL because `chat.getChannelAccess` is not registered.

Add this handler to `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` in `RegisterHandlers` near ACL handlers:

```csharp
bridge.RegisterHandler("chat.getChannelAccess", async data =>
{
    var channelIds = data.TryGetProperty("channelIds", out var ids) && ids.ValueKind == System.Text.Json.JsonValueKind.Array
        ? ids.EnumerateArray().Where(e => e.ValueKind == System.Text.Json.JsonValueKind.Number).Select(e => e.GetInt32()).Where(id => id > 0).Distinct().ToArray()
        : [];

    if (channelIds.Length == 0 || _apiUrl is null)
    {
        _bridge?.Send("chat.channelAccess", new { channels = new Dictionary<string, object>() });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("chat.channelAccessError", new { error = "No client certificate" });
        _bridge?.NotifyUiThread();
        return;
    }

    var uri = new Uri(new Uri(_apiUrl, UriKind.Absolute), "chat/channel-access");
    var requestJson = System.Text.Json.JsonSerializer.Serialize(new { channelIds });
    var result = await PostViaBcTls(cert, uri, requestJson);
    _bridge?.Send(result.Success ? "chat.channelAccess" : "chat.channelAccessError", new { body = result.Body, statusCode = result.StatusCode, error = result.Error });
    _bridge?.NotifyUiThread();
});
```

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter ChatGetChannelAccess_WithoutApiUrl_ReturnsEmptyAccessMap`

Expected: PASS.

- [ ] **Step 5: Listen for access responses in React**

In `src/Brmble.Web/src/App.tsx`, add a bridge listener in the main bridge handler effect:

```ts
const onChatChannelAccess = (data: unknown) => {
  const payload = data as { body?: string; channels?: ChannelChatAccessMap } | undefined;
  let channelsAccess = payload?.channels;
  if (!channelsAccess && payload?.body) {
    try {
      channelsAccess = (JSON.parse(payload.body) as { channels?: ChannelChatAccessMap }).channels;
    } catch {
      channelsAccess = undefined;
    }
  }
  if (!channelsAccess) return;
  setChannels(prev => mergeChannelChatAccess(prev, channelsAccess));
};

bridge.on('chat.channelAccess', onChatChannelAccess);
```

Add cleanup:

```ts
bridge.off('chat.channelAccess', onChatChannelAccess);
```

- [ ] **Step 6: Request access when channels are available**

Add an effect in `App` after refs are initialized:

```ts
useEffect(() => {
  if (statuses.server.state !== 'connected' || !matrixCredentials?.roomMap) return;
  const channelIds = getChannelChatAccessRequestIds(channels);
  if (channelIds.length === 0) return;
  bridge.send('chat.getChannelAccess', { channelIds });
}, [channels, matrixCredentials?.roomMap, statuses.server.state]);
```

- [ ] **Step 7: Run frontend and native focused tests**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter MumbleAdapterParseTests`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: fetch channel chat access in client"
```

---

## Task 8: React Chat Gating

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.chatMode.test.ts`

- [ ] **Step 1: Add pure helper tests for Matrix activation with chat access**

Modify the existing `isMatrixChannelChatActive` tests to pass a channel list argument. The first test should become:

```ts
expect(isMatrixChannelChatActive(
  '1',
  credentials,
  connectedStatuses,
  { session: 1, name: 'Me', self: true, isBrmbleClient: true },
  [{ id: 1, name: 'General', canOpenChat: true }],
)).toBe(true);
```

Add a denied-channel test:

```ts
it('does not use Matrix when channel chat access is denied', () => {
  expect(isMatrixChannelChatActive(
    '1',
    credentials,
    connectedStatuses,
    { session: 1, name: 'Me', self: true, isBrmbleClient: true },
    [{ id: 1, name: 'General', canOpenChat: false }],
  )).toBe(false);
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: FAIL because `isMatrixChannelChatActive` does not accept channels or check `canOpenChat`.

- [ ] **Step 3: Gate Matrix activation by `canOpenChat`**

Update `isMatrixChannelChatActive` signature in `src/Brmble.Web/src/App.tsx`:

```ts
export function isMatrixChannelChatActive(
  channelId: string | undefined,
  credentials: MatrixCredentials | null,
  statuses: ServiceStatusMap,
  selfUser: User | undefined,
  channels: Channel[] = [],
): boolean {
  if (!channelId || channelId === 'server-root') return false;
  if (!canOpenChannelChat(channelId, channels)) return false;
  if (statuses.server.state !== 'connected' || statuses.chat.state !== 'connected') return false;
  if (!selfUser?.isBrmbleClient) return false;
  return credentials?.roomMap[channelId] !== undefined;
}
```

Update all call sites to pass `channelsRef.current` or `channels`:

```ts
isMatrixChannelChatActive(channelId, matrixCredentialsRef.current, statusesRef.current, selfUser, channelsRef.current)
```

and:

```ts
isMatrixChannelChatActive(activeChannelId, matrixCredentials, statuses, selfUserForChat, channels)
```

- [ ] **Step 4: Gate channel selection and unread badges**

Update `handleSelectChannel` after locating `channel`:

```ts
if (!canOpenChannelChat(String(channelId), channels)) {
  setCurrentChannelId(String(channelId));
  setCurrentChannelName(channel.name);
  setUnreadCount(0);
  setShowGame(false);
  return;
}
```

Update `channelUnreads` calculation:

```ts
for (const [channelId, roomId] of Object.entries(matrixCredentials.roomMap)) {
  if (!canOpenChannelChat(channelId, channels)) continue;
  const unread = unreadTracker.getRoomUnread(roomId);
  ...
}
```

- [ ] **Step 5: Gate message display and input**

Add derived booleans near `isMatrixActive`:

```ts
const canOpenActiveChannelChat = canOpenChannelChat(activeChannelId, channels);
const canSendActiveChannelChat = canSendToChannelChat(activeChannelId, channels);
const channelChatAccessNotice = activeChannelId && activeChannelId !== 'server-root' && !canOpenActiveChannelChat
  ? 'You do not have access to this channel chat.'
  : activeChannelId && activeChannelId !== 'server-root' && !canSendActiveChannelChat
    ? 'You can read this channel chat, but cannot send messages.'
    : undefined;
```

Update `channelChatMessages`:

```ts
const channelChatMessages = useMemo(
  () => canOpenActiveChannelChat
    ? [
        ...(isMatrixActive ? (matrixMessages ?? []) : messages),
        ...optimisticImages.filter(m => m.channelId === currentChannelId),
      ]
    : [],
  [canOpenActiveChannelChat, isMatrixActive, matrixMessages, messages, optimisticImages, currentChannelId],
);
```

Update channel `ChatPanel` props:

```tsx
disabled={!canSendActiveChannelChat}
topNotice={channelChatAccessNotice ?? (brmbleTemporaryChatActive ? BRMBLE_SERVICE_TEMPORARY_CHAT_NOTICE : undefined)}
```

- [ ] **Step 6: Gate Matrix sends and Mumble channel sends**

At the start of `handleSendMessage`, after resolving `channelId`, add:

```ts
if (!canSendToChannelChat(channelId, channelsRef.current)) {
  return;
}
```

This applies to Matrix channel sends and Mumble channel messages from Brmble UI. Server-root and DMs remain unaffected.

- [ ] **Step 7: Run frontend tests**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts
git commit -m "feat: gate channel chat by Mumble text permission"
```

---

## Task 9: Channel Lock Icons

**Files:**
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Test: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Write failing lock icon tests**

Add tests to `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`:

```tsx
describe('ChannelTree channel access locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders no lock for unrestricted channels', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Open' }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Open').closest('.channel-row');
    expect(row?.querySelector('[data-icon="lock"]')).toBeNull();
    expect(row?.querySelector('[data-icon="unlock"]')).toBeNull();
  });

  it('renders an open lock for restricted channels the user can enter', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Allowed', isEnterRestricted: true, canEnter: true }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Allowed').closest('.channel-row');
    expect(row?.querySelector('[data-icon="unlock"]')).not.toBeNull();
    expect(row?.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('renders a closed lock for restricted channels the user cannot enter without exposing a password', () => {
    render(<ChannelTree channels={[{ id: 1, name: 'Secret', isEnterRestricted: true, canEnter: false, hasPasswordRestriction: true }]} users={[]} currentChannelId={1} onJoinChannel={vi.fn()} />);

    const row = screen.getByText('Secret').closest('.channel-row');
    expect(row?.querySelector('[data-icon="lock"]')).not.toBeNull();
    expect(row?.textContent).not.toContain('password');
  });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run from `src/Brmble.Web`: `npm test -- ChannelTree.test.tsx`

Expected: FAIL because lock icons are not rendered.

- [ ] **Step 3: Add icons**

In `src/Brmble.Web/src/components/Icon/Icon.tsx`, add in the server/channel icon section after `folder`:

```tsx
'lock': {
  paths: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
},
'unlock': {
  paths: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </>
  ),
},
```

- [ ] **Step 4: Extend local Channel type in ChannelTree**

Modify `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`:

```ts
interface Channel {
  id: number;
  name: string;
  parent?: number;
  description?: string;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
}
```

- [ ] **Step 5: Render lock icons with existing patterns**

In `renderChannel`, add before the return:

```ts
const lockIconName = channel.isEnterRestricted
  ? channel.canEnter === false ? 'lock' : 'unlock'
  : null;
const lockTooltip = channel.canEnter === false
  ? 'Restricted channel'
  : 'Restricted channel, access allowed';
```

After `<span className="channel-name">{channel.name}</span>`, add:

```tsx
{lockIconName && (
  <Tooltip content={lockTooltip}>
    <span className="channel-access-icon" aria-label={lockTooltip}>
      <Icon name={lockIconName} size={11} />
    </span>
  </Tooltip>
)}
```

- [ ] **Step 6: Add token-based spacing styles**

If the icon needs spacing, add to `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`:

```css
.channel-access-icon {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  margin-left: var(--space-2xs);
}
```

- [ ] **Step 7: Run focused tests and verify they pass**

Run from `src/Brmble.Web`: `npm test -- ChannelTree.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/Icon/Icon.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx
git commit -m "feat: show restricted channel lock icons"
```

---

## Task 10: Password Prompt And Non-Fatal Join Denials

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Test: `src/Brmble.Web/src/App.chatMode.test.ts`

- [ ] **Step 1: Add pure join decision helper tests**

Add imports and tests to `src/Brmble.Web/src/App.chatMode.test.ts`:

```ts
import { getJoinAccessAction } from './App';

describe('getJoinAccessAction', () => {
  it('joins normally when channel is enterable or canEnter is unknown', () => {
    expect(getJoinAccessAction({ id: 1, name: 'General', canEnter: true })).toBe('join');
    expect(getJoinAccessAction({ id: 2, name: 'Unknown' })).toBe('join');
  });

  it('prompts only for known password restricted denied channels', () => {
    expect(getJoinAccessAction({ id: 1, name: 'Secret', canEnter: false, hasPasswordRestriction: true })).toBe('promptPassword');
    expect(getJoinAccessAction({ id: 2, name: 'Private', canEnter: false })).toBe('deny');
  });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: FAIL because `getJoinAccessAction` is missing.

- [ ] **Step 3: Add join decision helper**

Add in `src/Brmble.Web/src/App.tsx` near other channel helpers:

```ts
export type JoinAccessAction = 'join' | 'promptPassword' | 'deny';

export function getJoinAccessAction(channel: Pick<Channel, 'canEnter' | 'hasPasswordRestriction'>): JoinAccessAction {
  if (channel.canEnter !== false) return 'join';
  return channel.hasPasswordRestriction ? 'promptPassword' : 'deny';
}
```

- [ ] **Step 4: Update password join flow**

Modify `handleJoinChannel` after the screen share check and before `startPendingAction(channelId)`:

```ts
const joinAction = getJoinAccessAction(channel);
if (joinAction === 'deny') {
  addMessageToStore('server-root', 'Server', getChannelAccessDeniedMessage(channel), 'system');
  return;
}

if (joinAction === 'promptPassword') {
  const password = await prompt({
    title: 'Channel Password',
    message: `Enter the password for ${channel.name}.`,
    placeholder: 'Password',
    confirmLabel: 'Join',
    cancelLabel: 'Cancel',
    isPassword: true,
  });

  if (!password) {
    return;
  }

  startPendingAction(channelId);
  pendingJoinAttemptRef.current = {
    channelId,
    channelName: channel.name,
    passwordRetrySent: true,
  };
  sendJoinChannel(channelId, password);
  return;
}
```

Then keep the existing normal `startPendingAction`, `pendingJoinAttemptRef.current`, and `sendJoinChannel(channelId)` for the `'join'` case.

- [ ] **Step 5: Stop message-string password detection from driving routing**

Replace `isPasswordProtectedJoinError` with structured logic:

```ts
function isPasswordProtectedJoinError(data: unknown, channel?: Channel): boolean {
  return isStructuredEnterDenied(data) && channel?.hasPasswordRestriction === true;
}
```

Update the call site in `onVoiceError`:

```ts
const pendingChannel = pendingJoinAttempt
  ? channelsRef.current.find(channel => channel.id === pendingJoinAttempt.channelId)
  : undefined;
if (pendingJoinAttempt && isPasswordProtectedJoinError(data, pendingChannel)) {
```

- [ ] **Step 6: Make enter permission denial non-fatal**

In `onVoiceError`, before generic `updateStatus('voice', { error: errorMsg })`, add:

```ts
if (isStructuredEnterDenied(data)) {
  const d = data as { channelId?: number };
  const deniedChannel = d.channelId != null
    ? channelsRef.current.find(channel => channel.id === d.channelId)
    : pendingJoinAttempt
      ? channelsRef.current.find(channel => channel.id === pendingJoinAttempt.channelId)
      : undefined;
  addMessageToStore('server-root', 'Server', getChannelAccessDeniedMessage(deniedChannel), 'system');
  clearPendingJoinAttempt();
  return;
}
```

Do not call `updateStatus('voice', { error: errorMsg })` for this branch.

- [ ] **Step 7: Run focused tests**

Run from `src/Brmble.Web`: `npm test -- App.chatMode.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.chatMode.test.ts
git commit -m "feat: prompt for restricted channel passwords"
```

---

## Task 11: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: PASS.

- [ ] **Step 2: Run client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`

Expected: PASS.

- [ ] **Step 3: Run frontend tests**

Run from `src/Brmble.Web`: `npm test`

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run from `src/Brmble.Web`: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run full .NET build**

Run: `dotnet build`

Expected: PASS.

- [ ] **Step 6: Inspect final diff**

Run: `git diff --stat HEAD`

Expected: Diff contains only channel access permission implementation files from this plan.

- [ ] **Step 7: Final commit if verification required fixes**

If verification required fixes after Task 10, commit them:

```bash
git add <fixed-files>
git commit -m "fix: stabilize channel access permission implementation"
```

---

## Self-Review Notes

- Spec coverage: server text permission delegation and endpoint are covered in Tasks 1-2; native channel state, password boolean, structured denial, and temporary token joins are covered in Tasks 3-5; React channel fields, lock icons, join UX, chat gating, unread gating, message history, and send gating are covered in Tasks 6-10; verification is covered in Task 11.
- Non-goals: no Mumble ACL evaluator is implemented; no Matrix room membership source-of-truth change is made; submitted channel passwords are sent only in the join payload and are not stored; plaintext managed passwords are not exposed in channel payloads.
- UI guide: the plan uses existing `Icon`, `Tooltip`, prompt, notification avoidance, `ChatPanel disabled`, and `topNotice` patterns. No new UI pattern is expected.
