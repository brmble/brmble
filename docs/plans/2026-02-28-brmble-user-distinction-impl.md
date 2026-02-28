# Brmble/Mumble User Distinction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragile display-name-keyed `userMappings` snapshot with session-keyed mappings pushed in real time via WebSocket, so the frontend can reliably badge Brmble users.

**Architecture:** New `SessionMappingService` (in-memory, concurrent) tracks sessionId → matrixUserId. `BrmbleEventBus` broadcasts deltas to connected WebSocket clients. `MumbleServerCallback` resolves certs at connect time; `AuthEndpoints` fills gaps for first-time users. The Brmble client opens a WS to `/ws` after auth and forwards mapping events to the frontend via bridge.

**Tech Stack:** C# / .NET 10 / ASP.NET Core / ZeroC Ice / TypeScript / React

**Design doc:** `docs/plans/2026-02-28-brmble-user-distinction-ws.md`

---

## Prerequisites

Before starting, ensure you're on a clean feature branch:

```bash
git checkout main && git pull
git checkout -b feature/brmble-user-distinction
```

Remove any leftover test instrumentation from `MumbleServerCallback.cs` and `MumbleIceService.cs` (the `[CERT-TEST]` logging from assumption testing). The real implementation replaces it.

---

## Task 1: CertificateHasher — Shared Hash Utility

**Files:**
- Create: `src/Brmble.Server/Auth/CertificateHasher.cs`
- Create: `tests/Brmble.Server.Tests/Auth/CertificateHasherTests.cs`
- Modify: `src/Brmble.Server/Auth/ICertificateHashExtractor.cs`

**Step 1: Write the failing test**

```csharp
// tests/Brmble.Server.Tests/Auth/CertificateHasherTests.cs
using System.Security.Cryptography;
using Brmble.Server.Auth;

namespace Brmble.Server.Tests.Auth;

[TestClass]
public class CertificateHasherTests
{
    [TestMethod]
    public void HashDer_ReturnsLowercaseHexSha1()
    {
        var der = new byte[] { 0x30, 0x82, 0x01, 0x22 };
        var result = CertificateHasher.HashDer(der);

        var expected = Convert.ToHexStringLower(SHA1.HashData(der));
        Assert.AreEqual(expected, result);
        Assert.AreEqual(result, result.ToLowerInvariant());
    }

    [TestMethod]
    public void HashDer_MatchesX509GetCertHashString()
    {
        // Generate a self-signed cert, verify both paths produce the same hash
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var req = new CertificateRequest("CN=test", ecdsa, HashAlgorithmName.SHA256);
        using var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow.AddYears(1));

        var fromHasher = CertificateHasher.HashDer(cert.RawData);
        var fromX509 = cert.GetCertHashString(HashAlgorithmName.SHA1).ToLowerInvariant();

        Assert.AreEqual(fromX509, fromHasher);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~CertificateHasherTests" -v n`
Expected: FAIL — `CertificateHasher` does not exist

**Step 3: Write minimal implementation**

```csharp
// src/Brmble.Server/Auth/CertificateHasher.cs
using System.Security.Cryptography;

namespace Brmble.Server.Auth;

public static class CertificateHasher
{
    public static string HashDer(byte[] der) =>
        Convert.ToHexStringLower(SHA1.HashData(der));
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~CertificateHasherTests" -v n`
Expected: PASS (2 tests)

**Step 5: Refactor MtlsCertificateHashExtractor to use CertificateHasher**

```csharp
// src/Brmble.Server/Auth/ICertificateHashExtractor.cs
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
        return cert is null ? null : CertificateHasher.HashDer(cert.RawData);
    }
}
```

**Step 6: Run all tests to verify nothing broke**

Run: `dotnet test -v n`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/Brmble.Server/Auth/CertificateHasher.cs src/Brmble.Server/Auth/ICertificateHashExtractor.cs tests/Brmble.Server.Tests/Auth/CertificateHasherTests.cs
git commit -m "feat: add CertificateHasher and refactor MtlsCertificateHashExtractor"
```

---

## Task 2: SessionMappingService — Session-Keyed Mapping Store

**Files:**
- Create: `src/Brmble.Server/Events/ISessionMappingService.cs`
- Create: `src/Brmble.Server/Events/SessionMappingService.cs`
- Create: `tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs`

**Step 1: Write the failing tests**

```csharp
// tests/Brmble.Server.Tests/Events/SessionMappingServiceTests.cs
using Brmble.Server.Events;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class SessionMappingServiceTests
{
    private SessionMappingService _svc = null!;

    [TestInitialize]
    public void Setup() => _svc = new SessionMappingService();

    [TestMethod]
    public void SetNameForSession_AllowsLookupByName()
    {
        _svc.SetNameForSession("Alice", 1);
        Assert.IsTrue(_svc.TryGetSessionId("Alice", out var sid));
        Assert.AreEqual(1, sid);
    }

    [TestMethod]
    public void TryAddMatrixUser_ReturnsTrueFirstTime_FalseSecondTime()
    {
        _svc.SetNameForSession("Alice", 1);
        Assert.IsTrue(_svc.TryAddMatrixUser(1, "@1:server", "Alice"));
        Assert.IsFalse(_svc.TryAddMatrixUser(1, "@1:server", "Alice"));
    }

    [TestMethod]
    public void TryGetMatrixUserId_ReturnsMappingAfterAdd()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");

        Assert.IsTrue(_svc.TryGetMatrixUserId(1, out var matrixId));
        Assert.AreEqual("@1:server", matrixId);
    }

    [TestMethod]
    public void TryGetMatrixUserId_ReturnsFalseWhenNotMapped()
    {
        Assert.IsFalse(_svc.TryGetMatrixUserId(999, out var matrixId));
        Assert.IsNull(matrixId);
    }

    [TestMethod]
    public void RemoveSession_CleansUpBothMaps()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");

        _svc.RemoveSession(1);

        Assert.IsFalse(_svc.TryGetMatrixUserId(1, out _));
        Assert.IsFalse(_svc.TryGetSessionId("Alice", out _));
    }

    [TestMethod]
    public void RemoveSession_CleansUpNameEvenWithoutMatrixMapping()
    {
        _svc.SetNameForSession("Bob", 2);
        _svc.RemoveSession(2);
        Assert.IsFalse(_svc.TryGetSessionId("Bob", out _));
    }

    [TestMethod]
    public void GetSnapshot_ReturnsCurrentMappings()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");
        _svc.SetNameForSession("Bob", 2);
        _svc.TryAddMatrixUser(2, "@2:server", "Bob");

        var snapshot = _svc.GetSnapshot();

        Assert.AreEqual(2, snapshot.Count);
        Assert.AreEqual("@1:server", snapshot[1].MatrixUserId);
        Assert.AreEqual("Alice", snapshot[1].MumbleName);
        Assert.AreEqual("@2:server", snapshot[2].MatrixUserId);
    }

    [TestMethod]
    public void GetSnapshot_IsIsolatedFromMutations()
    {
        _svc.SetNameForSession("Alice", 1);
        _svc.TryAddMatrixUser(1, "@1:server", "Alice");

        var snapshot = _svc.GetSnapshot();
        _svc.RemoveSession(1);

        Assert.AreEqual(1, snapshot.Count); // snapshot unchanged
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~SessionMappingServiceTests" -v n`
Expected: FAIL — types do not exist

**Step 3: Write implementation**

```csharp
// src/Brmble.Server/Events/ISessionMappingService.cs
namespace Brmble.Server.Events;

public record SessionMapping(string MatrixUserId, string MumbleName);

public interface ISessionMappingService
{
    void SetNameForSession(string name, int sessionId);
    bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName);
    void RemoveSession(int sessionId);
    bool TryGetMatrixUserId(int sessionId, out string? matrixUserId);
    bool TryGetSessionId(string mumbleName, out int sessionId);
    IReadOnlyDictionary<int, SessionMapping> GetSnapshot();
}
```

```csharp
// src/Brmble.Server/Events/SessionMappingService.cs
using System.Collections.Concurrent;

namespace Brmble.Server.Events;

public class SessionMappingService : ISessionMappingService
{
    private readonly ConcurrentDictionary<int, SessionMapping> _sessionToMapping = new();
    private readonly ConcurrentDictionary<string, int> _nameToSession = new();
    private readonly ConcurrentDictionary<int, string> _sessionToName = new();

    public void SetNameForSession(string name, int sessionId)
    {
        _nameToSession[name] = sessionId;
        _sessionToName[sessionId] = name;
    }

    public bool TryAddMatrixUser(int sessionId, string matrixUserId, string mumbleName)
    {
        return _sessionToMapping.TryAdd(sessionId, new SessionMapping(matrixUserId, mumbleName));
    }

    public void RemoveSession(int sessionId)
    {
        _sessionToMapping.TryRemove(sessionId, out _);
        if (_sessionToName.TryRemove(sessionId, out var name))
            _nameToSession.TryRemove(name, out _);
    }

    public bool TryGetMatrixUserId(int sessionId, out string? matrixUserId)
    {
        if (_sessionToMapping.TryGetValue(sessionId, out var mapping))
        {
            matrixUserId = mapping.MatrixUserId;
            return true;
        }
        matrixUserId = null;
        return false;
    }

    public bool TryGetSessionId(string mumbleName, out int sessionId)
    {
        return _nameToSession.TryGetValue(mumbleName, out sessionId);
    }

    public IReadOnlyDictionary<int, SessionMapping> GetSnapshot()
    {
        return new Dictionary<int, SessionMapping>(_sessionToMapping);
    }
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~SessionMappingServiceTests" -v n`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/Brmble.Server/Events/ tests/Brmble.Server.Tests/Events/
git commit -m "feat: add SessionMappingService for session-keyed user mappings"
```

---

## Task 3: BrmbleEventBus — WebSocket Broadcast Service

**Files:**
- Create: `src/Brmble.Server/Events/IBrmbleEventBus.cs`
- Create: `src/Brmble.Server/Events/BrmbleEventBus.cs`
- Create: `tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs`

**Step 1: Write the failing tests**

```csharp
// tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs
using System.Net.WebSockets;
using System.Text;
using Brmble.Server.Events;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class BrmbleEventBusTests
{
    private BrmbleEventBus _bus = null!;

    [TestInitialize]
    public void Setup() => _bus = new BrmbleEventBus(NullLogger<BrmbleEventBus>.Instance);

    [TestMethod]
    public async Task BroadcastAsync_SendsToAllOpenClients()
    {
        var ws1 = CreateMockWebSocket(WebSocketState.Open);
        var ws2 = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(ws1.Object);
        _bus.AddClient(ws2.Object);

        await _bus.BroadcastAsync(new { type = "test" });

        ws1.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
        ws2.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            WebSocketMessageType.Text,
            true,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesDeadClients()
    {
        var dead = CreateMockWebSocket(WebSocketState.Closed);
        _bus.AddClient(dead.Object);

        await _bus.BroadcastAsync(new { type = "test" });

        // Should not throw and dead client should be removed
        dead.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [TestMethod]
    public async Task BroadcastAsync_RemovesClientOnSendError()
    {
        var failing = CreateMockWebSocket(WebSocketState.Open);
        failing.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .ThrowsAsync(new WebSocketException("connection reset"));
        _bus.AddClient(failing.Object);

        // Second call should see the client gone
        await _bus.BroadcastAsync(new { type = "first" });
        var healthy = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(healthy.Object);
        await _bus.BroadcastAsync(new { type = "second" });

        // failing was removed after first broadcast, healthy gets second
        healthy.Verify(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [TestMethod]
    public async Task BroadcastAsync_NoClientsDoesNotThrow()
    {
        await _bus.BroadcastAsync(new { type = "test" });
        // No exception = pass
    }

    [TestMethod]
    public void RemoveClient_IsIdempotent()
    {
        var ws = CreateMockWebSocket(WebSocketState.Open);
        _bus.AddClient(ws.Object);
        _bus.RemoveClient(ws.Object);
        _bus.RemoveClient(ws.Object); // should not throw
    }

    private static Mock<WebSocket> CreateMockWebSocket(WebSocketState state)
    {
        var mock = new Mock<WebSocket>();
        mock.Setup(w => w.State).Returns(state);
        mock.Setup(w => w.SendAsync(
            It.IsAny<ArraySegment<byte>>(),
            It.IsAny<WebSocketMessageType>(),
            It.IsAny<bool>(),
            It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        return mock;
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~BrmbleEventBusTests" -v n`
Expected: FAIL — types do not exist

**Step 3: Write implementation**

```csharp
// src/Brmble.Server/Events/IBrmbleEventBus.cs
using System.Net.WebSockets;

namespace Brmble.Server.Events;

public interface IBrmbleEventBus
{
    void AddClient(WebSocket ws);
    void RemoveClient(WebSocket ws);
    Task BroadcastAsync(object message);
}
```

```csharp
// src/Brmble.Server/Events/BrmbleEventBus.cs
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Brmble.Server.Events;

public class BrmbleEventBus : IBrmbleEventBus
{
    private readonly ConcurrentDictionary<WebSocket, byte> _clients = new();
    private readonly ILogger<BrmbleEventBus> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public BrmbleEventBus(ILogger<BrmbleEventBus> logger)
    {
        _logger = logger;
    }

    public void AddClient(WebSocket ws) => _clients.TryAdd(ws, 0);

    public void RemoveClient(WebSocket ws) => _clients.TryRemove(ws, out _);

    public async Task BroadcastAsync(object message)
    {
        var json = JsonSerializer.Serialize(message, JsonOptions);
        var bytes = new ArraySegment<byte>(Encoding.UTF8.GetBytes(json));

        var tasks = _clients.Keys.Select(async ws =>
        {
            try
            {
                if (ws.State == WebSocketState.Open)
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
                else
                    RemoveClient(ws);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to send to WebSocket client, removing");
                RemoveClient(ws);
            }
        });

        await Task.WhenAll(tasks);
    }
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~BrmbleEventBusTests" -v n`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/Brmble.Server/Events/IBrmbleEventBus.cs src/Brmble.Server/Events/BrmbleEventBus.cs tests/Brmble.Server.Tests/Events/BrmbleEventBusTests.cs
git commit -m "feat: add BrmbleEventBus for WebSocket broadcast"
```

---

## Task 4: MumbleServerCallback — Cert-Based User Resolution

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Modify: `tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs`

This task replaces the `[CERT-TEST]` instrumentation with the real cert-based user resolution.

**Step 1: Update the test to verify new behavior**

Add these tests to the existing `MumbleServerCallbackTests.cs`. Existing tests need their constructors updated to pass the new dependencies (as mocks).

```csharp
// Add to existing MumbleServerCallbackTests.cs

// Update all existing test setups: add mock dependencies
// Old: new MumbleServerCallback([h1.Object], NullLogger<MumbleServerCallback>.Instance);
// New: new MumbleServerCallback([h1.Object], sessionMapping.Object, eventBus.Object, userRepo, NullLogger<MumbleServerCallback>.Instance);

// New tests:

[TestMethod]
public async Task UserConnected_SetsNameForSession()
{
    var handler = new Mock<IMumbleEventHandler>();
    handler.Setup(h => h.OnUserConnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
    var mapping = new Mock<ISessionMappingService>();
    var bus = new Mock<IBrmbleEventBus>();

    var callback = new MumbleServerCallback(
        [handler.Object], mapping.Object, bus.Object,
        NullLogger<MumbleServerCallback>.Instance);

    await callback.DispatchUserConnected(new MumbleUser("Alice", "", 42));

    mapping.Verify(m => m.SetNameForSession("Alice", 42), Times.Once);
}

[TestMethod]
public async Task UserDisconnected_RemovesSessionAndBroadcasts()
{
    var handler = new Mock<IMumbleEventHandler>();
    handler.Setup(h => h.OnUserDisconnected(It.IsAny<MumbleUser>())).Returns(Task.CompletedTask);
    var mapping = new Mock<ISessionMappingService>();
    var bus = new Mock<IBrmbleEventBus>();
    bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);

    var callback = new MumbleServerCallback(
        [handler.Object], mapping.Object, bus.Object,
        NullLogger<MumbleServerCallback>.Instance);

    await callback.DispatchUserDisconnected(new MumbleUser("Alice", "", 42));

    mapping.Verify(m => m.RemoveSession(42), Times.Once);
    bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~MumbleServerCallbackTests" -v n`
Expected: FAIL — constructor signature mismatch

**Step 3: Update MumbleServerCallback implementation**

Replace the full `MumbleServerCallback.cs` with the production version. Key changes:
- Add `ISessionMappingService` and `IBrmbleEventBus` constructor params
- `DispatchUserConnected`: call `SetNameForSession`, then try cert-based resolution via `_serverProxy`
- `DispatchUserDisconnected`: call `RemoveSession` and broadcast removal
- Remove all `[CERT-TEST]` code

```csharp
// src/Brmble.Server/Mumble/MumbleServerCallback.cs
using System.Security.Cryptography;
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.Mumble;

public class MumbleServerCallback : MumbleServer.ServerCallbackDisp_
{
    private readonly IEnumerable<IMumbleEventHandler> _handlers;
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly ILogger<MumbleServerCallback> _logger;
    private MumbleServer.ServerPrx? _serverProxy;

    public MumbleServerCallback(
        IEnumerable<IMumbleEventHandler> handlers,
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        ILogger<MumbleServerCallback> logger)
    {
        _handlers = handlers;
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _logger = logger;
    }

    internal void SetServerProxy(MumbleServer.ServerPrx proxy) => _serverProxy = proxy;

    // Ice overrides — called by ZeroC Ice runtime on Mumble server events.
    // Dispatch via Task.Run to avoid blocking the Ice callback thread.

    public override void userTextMessage(
        MumbleServer.User state,
        MumbleServer.TextMessage message,
        Ice.Current current)
    {
        var user = ToMumbleUser(state);
        var channelId = message.channels.FirstOrDefault();
        _logger.LogDebug("ICE callback: text message from {User} in channel {ChannelId}", user.Name, channelId);
        Task.Run(() => SafeDispatch(
            () => DispatchTextMessage(user, message.text, channelId),
            nameof(userTextMessage)));
    }

    public override void userConnected(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        _logger.LogDebug("ICE callback: user connected {User} (session {Session})", user.Name, state.session);
        Task.Run(() => SafeDispatch(() => DispatchUserConnected(user), nameof(userConnected)));
    }

    public override void userDisconnected(MumbleServer.User state, Ice.Current current)
    {
        var user = ToMumbleUser(state);
        _logger.LogDebug("ICE callback: user disconnected {User} (session {Session})", user.Name, state.session);
        Task.Run(() => SafeDispatch(() => DispatchUserDisconnected(user), nameof(userDisconnected)));
    }

    public override void channelCreated(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel created {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelCreated(channel), nameof(channelCreated)));
    }

    public override void channelRemoved(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel removed {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelRemoved(channel), nameof(channelRemoved)));
    }

    public override void channelStateChanged(MumbleServer.Channel state, Ice.Current current)
    {
        var channel = ToMumbleChannel(state);
        _logger.LogDebug("ICE callback: channel renamed {Channel}", channel.Name);
        Task.Run(() => SafeDispatch(() => DispatchChannelRenamed(channel), nameof(channelStateChanged)));
    }

    private async Task SafeDispatch(Func<Task> dispatch, string callbackName)
    {
        try
        {
            await dispatch();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception dispatching {Callback}", callbackName);
        }
    }

    public override void userStateChanged(MumbleServer.User state, Ice.Current current) { }

    // Dispatch methods

    public Task DispatchTextMessage(MumbleUser sender, string text, int channelId)
        => Task.WhenAll(_handlers.Select(h => h.OnUserTextMessage(sender, text, channelId)));

    public async Task DispatchUserConnected(MumbleUser user)
    {
        _sessionMapping.SetNameForSession(user.Name, user.SessionId);

        // Try cert-based resolution for returning users (background, non-blocking)
        _ = TryResolveCertAsync(user);

        await Task.WhenAll(_handlers.Select(h => h.OnUserConnected(user)));
    }

    public async Task DispatchUserDisconnected(MumbleUser user)
    {
        _sessionMapping.RemoveSession(user.SessionId);
        await _eventBus.BroadcastAsync(new { type = "userMappingRemoved", sessionId = user.SessionId });
        await Task.WhenAll(_handlers.Select(h => h.OnUserDisconnected(user)));
    }

    public Task DispatchChannelCreated(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelCreated(channel)));

    public Task DispatchChannelRemoved(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRemoved(channel)));

    public Task DispatchChannelRenamed(MumbleChannel channel)
        => Task.WhenAll(_handlers.Select(h => h.OnChannelRenamed(channel)));

    private async Task TryResolveCertAsync(MumbleUser user)
    {
        if (_serverProxy is null) return;

        try
        {
            var certs = await _serverProxy.getCertificateListAsync(user.SessionId);
            if (certs is not { Length: > 0 }) return;

            var hash = CertificateHasher.HashDer(certs[0]);
            // UserRepository is not injected here — cert-based resolution uses
            // the mapping service directly. The actual DB lookup happens via
            // a dedicated IMumbleEventHandler (see Task 5 notes).
            // For now, the cert hash is logged for diagnostics.
            _logger.LogDebug("Cert resolved for {User} session {Session}: hash={Hash}",
                user.Name, user.SessionId, hash);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "getCertificateListAsync failed for session {Session}", user.SessionId);
        }
    }

    private static MumbleUser ToMumbleUser(MumbleServer.User state) =>
        new(state.name, string.Empty, state.session);

    private static MumbleChannel ToMumbleChannel(MumbleServer.Channel state) =>
        new(state.id, state.name);
}
```

> **Note:** The cert → DB lookup needs `UserRepository`. Rather than injecting it into the callback directly (which already has several deps), create a new `IMumbleEventHandler` implementation — `SessionMappingHandler` — that handles the cert lookup in `OnUserConnected`. This is covered in Task 5.

**Step 4: Update existing tests for new constructor signature**

All existing `MumbleServerCallbackTests` that instantiate the callback need the new params. Use `Mock<ISessionMappingService>()` and `Mock<IBrmbleEventBus>()` as defaults.

**Step 5: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~MumbleServerCallbackTests" -v n`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/Brmble.Server/Mumble/MumbleServerCallback.cs tests/Brmble.Server.Tests/Mumble/MumbleServerCallbackTests.cs
git commit -m "feat: add session mapping and event bus to MumbleServerCallback"
```

---

## Task 5: SessionMappingHandler — Cert-Based DB Lookup on Connect

**Files:**
- Create: `src/Brmble.Server/Events/SessionMappingHandler.cs`
- Create: `tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleExtensions.cs`

This handler implements `IMumbleEventHandler` and does the cert→DB→mapping lookup that the callback's `TryResolveCertAsync` prepares the hash for.

> **Design decision:** Rather than injecting `UserRepository` into the callback, this handler receives the cert hash from the `MumbleUser` record and does the DB lookup. Update the callback's `TryResolveCertAsync` to set the cert hash on the `MumbleUser` before dispatching.

**Step 1: Update MumbleUser flow**

First, update `TryResolveCertAsync` in `MumbleServerCallback` so it resolves the cert hash before dispatching `OnUserConnected`. This means `DispatchUserConnected` should await cert resolution, then dispatch with the resolved hash.

Update `DispatchUserConnected` in `MumbleServerCallback.cs`:

```csharp
public async Task DispatchUserConnected(MumbleUser user)
{
    _sessionMapping.SetNameForSession(user.Name, user.SessionId);

    // Try cert-based resolution — enrich user with cert hash before dispatching
    var enrichedUser = await TryResolveCertHashAsync(user);

    await Task.WhenAll(_handlers.Select(h => h.OnUserConnected(enrichedUser)));
}

private async Task<MumbleUser> TryResolveCertHashAsync(MumbleUser user)
{
    if (_serverProxy is null) return user;

    try
    {
        var certs = await _serverProxy.getCertificateListAsync(user.SessionId);
        if (certs is { Length: > 0 })
        {
            var hash = CertificateHasher.HashDer(certs[0]);
            return user with { CertHash = hash };
        }
    }
    catch (Exception ex)
    {
        _logger.LogDebug(ex, "getCertificateListAsync failed for session {Session}", user.SessionId);
    }
    return user;
}
```

**Step 2: Write SessionMappingHandler tests**

```csharp
// tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs
using Brmble.Server.Auth;
using Brmble.Server.Events;
using Brmble.Server.Mumble;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Brmble.Server.Tests.Events;

[TestClass]
public class SessionMappingHandlerTests
{
    [TestMethod]
    public async Task OnUserConnected_WithCertHash_AddsMappingAndBroadcasts()
    {
        var mapping = new Mock<ISessionMappingService>();
        mapping.Setup(m => m.TryAddMatrixUser(1, "@1:server", "Alice")).Returns(true);
        var bus = new Mock<IBrmbleEventBus>();
        bus.Setup(b => b.BroadcastAsync(It.IsAny<object>())).Returns(Task.CompletedTask);
        var repo = new Mock<UserRepository>() { CallBase = false };
        // Can't mock UserRepository directly (not interface). Use a wrapper or test differently.
        // For now, test the handler logic with a real in-memory DB.

        // Simpler approach: just verify the handler calls the right methods
        var handler = CreateHandler(mapping.Object, bus.Object, certHash: "abc123", matrixUserId: "@1:server");

        await handler.OnUserConnected(new MumbleUser("Alice", "abc123", 1));

        mapping.Verify(m => m.TryAddMatrixUser(1, "@1:server", "Alice"), Times.Once);
        bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Once);
    }

    [TestMethod]
    public async Task OnUserConnected_NoCertHash_DoesNothing()
    {
        var mapping = new Mock<ISessionMappingService>();
        var bus = new Mock<IBrmbleEventBus>();

        var handler = CreateHandler(mapping.Object, bus.Object, certHash: "", matrixUserId: null);

        await handler.OnUserConnected(new MumbleUser("Bob", "", 2));

        mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        bus.Verify(b => b.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }

    [TestMethod]
    public async Task OnUserConnected_CertNotInDb_DoesNothing()
    {
        var mapping = new Mock<ISessionMappingService>();
        var bus = new Mock<IBrmbleEventBus>();

        var handler = CreateHandler(mapping.Object, bus.Object, certHash: "unknown", matrixUserId: null);

        await handler.OnUserConnected(new MumbleUser("Charlie", "unknown", 3));

        mapping.Verify(m => m.TryAddMatrixUser(It.IsAny<int>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    // Helper: creates handler with a stub UserRepository lookup
    private static SessionMappingHandler CreateHandler(
        ISessionMappingService mapping, IBrmbleEventBus bus,
        string certHash, string? matrixUserId)
    {
        // Use the real handler with an in-memory DB setup
        // (Details depend on final implementation — see Step 3)
        throw new NotImplementedException("Implement after handler is designed");
    }
}
```

> **Implementation note:** `UserRepository` is a concrete class, not an interface. For testability, the handler should accept a `Func<string, Task<User?>>` or we should extract an interface. The simplest approach: use the in-memory SQLite pattern from existing tests.

**Step 3: Write SessionMappingHandler**

```csharp
// src/Brmble.Server/Events/SessionMappingHandler.cs
using Brmble.Server.Auth;
using Brmble.Server.Mumble;

namespace Brmble.Server.Events;

public class SessionMappingHandler : IMumbleEventHandler
{
    private readonly ISessionMappingService _sessionMapping;
    private readonly IBrmbleEventBus _eventBus;
    private readonly UserRepository _userRepository;
    private readonly ILogger<SessionMappingHandler> _logger;

    public SessionMappingHandler(
        ISessionMappingService sessionMapping,
        IBrmbleEventBus eventBus,
        UserRepository userRepository,
        ILogger<SessionMappingHandler> logger)
    {
        _sessionMapping = sessionMapping;
        _eventBus = eventBus;
        _userRepository = userRepository;
        _logger = logger;
    }

    public async Task OnUserConnected(MumbleUser user)
    {
        if (string.IsNullOrEmpty(user.CertHash)) return;

        var dbUser = await _userRepository.GetByCertHash(user.CertHash);
        if (dbUser is null) return;

        if (_sessionMapping.TryAddMatrixUser(user.SessionId, dbUser.MatrixUserId, user.Name))
        {
            _logger.LogInformation(
                "Mapped session {Session} ({Name}) to {MatrixUserId} via cert",
                user.SessionId, user.Name, dbUser.MatrixUserId);
            await _eventBus.BroadcastAsync(new
            {
                type = "userMappingAdded",
                sessionId = user.SessionId,
                matrixUserId = dbUser.MatrixUserId,
                mumbleName = user.Name
            });
        }
    }

    public Task OnUserDisconnected(MumbleUser user) => Task.CompletedTask;
    public Task OnUserTextMessage(MumbleUser sender, string text, int channelId) => Task.CompletedTask;
    public Task OnChannelCreated(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRemoved(MumbleChannel channel) => Task.CompletedTask;
    public Task OnChannelRenamed(MumbleChannel channel) => Task.CompletedTask;
}
```

**Step 4: Register in MumbleExtensions.cs**

```csharp
// Add to MumbleExtensions.AddMumble():
services.AddSingleton<ISessionMappingService, SessionMappingService>();
services.AddSingleton<IBrmbleEventBus, BrmbleEventBus>();
services.AddSingleton<IMumbleEventHandler, SessionMappingHandler>();
```

**Step 5: Write proper tests using in-memory SQLite (same pattern as AuthServiceTests)**

Use the shared-cache in-memory SQLite pattern from `AuthServiceTests.cs` to create a real `UserRepository` for the handler tests.

**Step 6: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~SessionMappingHandlerTests" -v n`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/Brmble.Server/Events/SessionMappingHandler.cs src/Brmble.Server/Mumble/MumbleExtensions.cs tests/Brmble.Server.Tests/Events/SessionMappingHandlerTests.cs
git commit -m "feat: add SessionMappingHandler for cert-based user resolution on connect"
```

---

## Task 6: AuthEndpoints — Session Mappings in Auth Response

**Files:**
- Modify: `src/Brmble.Server/Auth/AuthEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/AuthIntegrationTests.cs` (or `AuthTokenTests.cs`)

**Step 1: Write the failing integration test**

```csharp
// Add to AuthIntegrationTests or AuthTokenTests:

[TestMethod]
public async Task AuthToken_IncludesSessionMappingsInResponse()
{
    // Setup: pre-populate a session mapping
    var sessionMapping = _factory.Services.GetRequiredService<ISessionMappingService>();
    sessionMapping.SetNameForSession("OtherUser", 99);
    sessionMapping.TryAddMatrixUser(99, "@2:server", "OtherUser");

    var response = await _client.PostAsync("/auth/token", null);
    response.EnsureSuccessStatusCode();

    var json = await response.Content.ReadAsStringAsync();
    using var doc = JsonDocument.Parse(json);

    Assert.IsTrue(doc.RootElement.TryGetProperty("sessionMappings", out var mappings));
    Assert.IsTrue(mappings.TryGetProperty("99", out var entry));
    Assert.AreEqual("@2:server", entry.GetProperty("matrixUserId").GetString());
    Assert.AreEqual("OtherUser", entry.GetProperty("mumbleName").GetString());
}
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `sessionMappings` not in response

**Step 3: Update AuthEndpoints**

Add `ISessionMappingService` and `IBrmbleEventBus` params to the endpoint delegate. After auth succeeds, try to add the session mapping and broadcast. Include `sessionMappings` in the response.

```csharp
// In the MapPost("/auth/token", ...) lambda, add params:
ISessionMappingService sessionMapping,
IBrmbleEventBus eventBus,

// After authService.TrackMumbleName(mumbleUsername):
if (!string.IsNullOrEmpty(mumbleUsername) &&
    sessionMapping.TryGetSessionId(mumbleUsername, out var sid))
{
    if (sessionMapping.TryAddMatrixUser(sid, result.MatrixUserId, mumbleUsername))
    {
        await eventBus.BroadcastAsync(new
        {
            type = "userMappingAdded",
            sessionId = sid,
            matrixUserId = result.MatrixUserId,
            mumbleName = mumbleUsername
        });
    }
}

// In the response object, add:
sessionMappings = sessionMapping.GetSnapshot()
    .ToDictionary(
        kvp => kvp.Key.ToString(),
        kvp => new { matrixUserId = kvp.Value.MatrixUserId, mumbleName = kvp.Value.MumbleName }),
```

**Step 4: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests --filter "FullyQualifiedName~AuthIntegration|FullyQualifiedName~AuthToken" -v n`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/Brmble.Server/Auth/AuthEndpoints.cs tests/Brmble.Server.Tests/Integration/
git commit -m "feat: add sessionMappings to /auth/token response and broadcast on auth"
```

---

## Task 7: WebSocket Endpoint

**Files:**
- Create: `src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs`
- Modify: `src/Brmble.Server/Program.cs`

**Step 1: Write the WebSocket handler**

```csharp
// src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.WebSockets;

public static class BrmbleWebSocketHandler
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static async Task HandleAsync(HttpContext context)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = 400;
            return;
        }

        var cert = context.Connection.ClientCertificate;
        if (cert is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var userRepo = context.RequestServices.GetRequiredService<UserRepository>();
        var hash = CertificateHasher.HashDer(cert.RawData);
        var user = await userRepo.GetByCertHash(hash);
        if (user is null)
        {
            context.Response.StatusCode = 401;
            return;
        }

        var sessionMapping = context.RequestServices.GetRequiredService<ISessionMappingService>();
        var eventBus = context.RequestServices.GetRequiredService<IBrmbleEventBus>();
        var logger = context.RequestServices.GetRequiredService<ILogger<BrmbleEventBus>>();

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        eventBus.AddClient(ws);

        try
        {
            // Send initial snapshot
            var snapshot = sessionMapping.GetSnapshot()
                .ToDictionary(
                    kvp => kvp.Key.ToString(),
                    kvp => new { matrixUserId = kvp.Value.MatrixUserId, mumbleName = kvp.Value.MumbleName });
            var snapshotJson = JsonSerializer.Serialize(new { type = "snapshot", mappings = snapshot }, JsonOptions);
            var snapshotBytes = Encoding.UTF8.GetBytes(snapshotJson);
            await ws.SendAsync(snapshotBytes, WebSocketMessageType.Text, true, CancellationToken.None);

            // Read loop until close
            var buffer = new byte[1024];
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, context.RequestAborted);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
                    break;
                }
            }
        }
        catch (WebSocketException) { /* client disconnected */ }
        catch (OperationCanceledException) { /* server shutting down */ }
        finally
        {
            eventBus.RemoveClient(ws);
        }
    }
}
```

**Step 2: Wire up in Program.cs**

Add these lines to `Program.cs`:

```csharp
// After: var app = builder.Build();
// Before: app.UseMiddleware<ConnectionLoggingMiddleware>();
app.UseWebSockets();

// After: app.MapServerInfoEndpoints();
app.Map("/ws", BrmbleWebSocketHandler.HandleAsync);
```

Add the using:
```csharp
using Brmble.Server.WebSockets;
```

**Step 3: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests -v n`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/Brmble.Server/WebSockets/BrmbleWebSocketHandler.cs src/Brmble.Server/Program.cs
git commit -m "feat: add /ws WebSocket endpoint for session mapping push"
```

---

## Task 8: Docker Verification — Server Changes

**Step 1: Rebuild and restart**

```bash
wsl docker compose -f docker-local/docker-compose.yml up -d --build brmble
```

**Step 2: Connect Brmble client and check logs**

```bash
# Launch client
dotnet run --project src/Brmble.Client

# After connecting, check logs for mapping events:
wsl docker compose -f docker-local/docker-compose.yml logs --tail 50 brmble | grep -E 'Mapped session|userMappingAdded|sessionMappings'
```

**Step 3: Verify auth response includes sessionMappings**

Check the client receives `sessionMappings` in the auth response (visible in bridge events or client logs).

**Step 4: If issues found, fix and re-test before proceeding to client changes**

---

## Task 9: MumbleAdapter — WebSocket Client + Session Mappings

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add session mappings field**

```csharp
// Near line 46, alongside _userMappings:
private readonly ConcurrentDictionary<int, string> _sessionMappings = new();
```

Add `using System.Collections.Concurrent;` and `using System.Net.WebSockets;` if not present.

**Step 2: Parse sessionMappings from auth response**

In `FetchAndSendCredentials`, after parsing `userMappings` (around line 880), add:

```csharp
// Parse session mappings (sessionId -> { matrixUserId, mumbleName }) from auth response
if (credentials.Value.TryGetProperty("sessionMappings", out var sessionMappingsElement))
{
    _sessionMappings.Clear();
    foreach (var prop in sessionMappingsElement.EnumerateObject())
    {
        if (int.TryParse(prop.Name, out var sid) &&
            prop.Value.TryGetProperty("matrixUserId", out var midProp))
        {
            var mid = midProp.GetString();
            if (mid is not null)
                _sessionMappings[sid] = mid;
        }
    }
}
```

**Step 3: Start WebSocket connection after auth**

After credentials are parsed and `server.credentials` is emitted, start a background WS connection:

```csharp
// After emitting server.credentials, start WebSocket for live mapping updates
_ = Task.Run(() => RunMappingWebSocketAsync(apiUrl));
```

```csharp
// New method in MumbleAdapter:
private async Task RunMappingWebSocketAsync(string apiUrl)
{
    var wsUri = new Uri(apiUrl.Replace("https://", "wss://").Replace("http://", "ws://").TrimEnd('/') + "/ws");
    var backoff = TimeSpan.FromSeconds(1);
    var maxBackoff = TimeSpan.FromSeconds(30);

    while (true)
    {
        try
        {
            using var ws = new ClientWebSocket();
            var handler = new SocketsHttpHandler
            {
                SslOptions = new System.Net.Security.SslClientAuthenticationOptions
                {
                    RemoteCertificateValidationCallback = (_, _, _, _) => true,
                    LocalCertificateSelectionCallback = (_, _, _, _, _) => _clientCert
                }
            };
            await ws.ConnectAsync(wsUri, new HttpMessageInvoker(handler), CancellationToken.None);
            backoff = TimeSpan.FromSeconds(1); // reset on success

            var buffer = new byte[4096];
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, CancellationToken.None);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) continue;

                var json = System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count);
                HandleMappingMessage(json);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[WS] Mapping WebSocket error: {ex.Message}");
        }

        // Reconnect with backoff
        await Task.Delay(backoff);
        backoff = TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, maxBackoff.TotalSeconds));
    }
}

private void HandleMappingMessage(string json)
{
    try
    {
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var type = doc.RootElement.GetProperty("type").GetString();

        switch (type)
        {
            case "snapshot":
                _sessionMappings.Clear();
                var mappings = doc.RootElement.GetProperty("mappings");
                foreach (var prop in mappings.EnumerateObject())
                {
                    if (int.TryParse(prop.Name, out var sid))
                    {
                        var mid = prop.Value.GetProperty("matrixUserId").GetString();
                        if (mid is not null) _sessionMappings[sid] = mid;
                    }
                }
                // Emit snapshot to frontend
                _bridge?.Send("voice.sessionMappingSnapshot", new
                {
                    mappings = _sessionMappings.ToDictionary(
                        kvp => kvp.Key,
                        kvp => new { matrixUserId = kvp.Value })
                });
                break;

            case "userMappingAdded":
                var sessionId = doc.RootElement.GetProperty("sessionId").GetInt32();
                var matrixUserId = doc.RootElement.GetProperty("matrixUserId").GetString()!;
                var mumbleName = doc.RootElement.GetProperty("mumbleName").GetString()!;
                _sessionMappings[sessionId] = matrixUserId;
                _bridge?.Send("voice.userMappingUpdated", new { sessionId, matrixUserId, mumbleName });
                break;

            case "userMappingRemoved":
                var removedSid = doc.RootElement.GetProperty("sessionId").GetInt32();
                _sessionMappings.TryRemove(removedSid, out _);
                break;
        }
    }
    catch (Exception ex)
    {
        System.Diagnostics.Debug.WriteLine($"[WS] Failed to parse mapping message: {ex.Message}");
    }
}
```

> **Note on SChannel:** If `ClientWebSocket` with `LocalCertificateSelectionCallback` fails on Windows due to SChannel refusing self-signed certs, fall back to passing the cert hash as a query parameter (`/ws?certHash=<hash>`) and verify server-side. This is a known Windows SChannel limitation — test during Docker verification.

**Step 4: Update voice.connected and voice.userJoined lookups**

At `voice.connected` (around line 1165), change:
```csharp
// Old:
matrixUserId = _userMappings.GetValueOrDefault(u.Name)
// New:
matrixUserId = _sessionMappings.GetValueOrDefault(u.Id) ?? _userMappings.GetValueOrDefault(u.Name)
```

At `voice.userJoined` (around line 1277), change:
```csharp
// Old:
matrixUserId = _userMappings.GetValueOrDefault(joinedUserName)
// New:
matrixUserId = _sessionMappings.GetValueOrDefault(userState.Session) ?? _userMappings.GetValueOrDefault(joinedUserName)
```

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add WebSocket client for live session mapping updates"
```

---

## Task 10: Frontend — Mapping Updates + Badge

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx` (badge rendering)

**Step 1: Add bridge handlers in App.tsx**

In the `useEffect` that sets up bridge listeners (around line 570), add:

```typescript
const onUserMappingUpdated = (data: unknown) => {
  const d = data as { sessionId: number; matrixUserId: string; mumbleName: string };
  setUsers(prev => prev.map(u =>
    u.session === d.sessionId ? { ...u, matrixUserId: d.matrixUserId } : u
  ));
};

const onSessionMappingSnapshot = (data: unknown) => {
  const d = data as { mappings: Record<number, { matrixUserId: string }> };
  setUsers(prev => prev.map(u => {
    const mapping = d.mappings[u.session];
    return mapping ? { ...u, matrixUserId: mapping.matrixUserId } : u;
  }));
};

bridge.on('voice.userMappingUpdated', onUserMappingUpdated);
bridge.on('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
```

Don't forget to add cleanup in the return function:
```typescript
bridge.off('voice.userMappingUpdated', onUserMappingUpdated);
bridge.off('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
```

**Step 2: Add Brmble badge in ChannelTree.tsx**

In the user rendering section (around line 192-223), add a small indicator when `matrixUserId` is set. Pass `matrixUserId` through the User interface used by ChannelTree (add `matrixUserId?: string` if not already present).

```tsx
{/* Next to the username span */}
{user.matrixUserId && (
  <span title="Brmble user" style={{
    display: 'inline-block',
    width: 8, height: 8,
    borderRadius: '50%',
    backgroundColor: '#4CAF50',
    marginLeft: 4,
    verticalAlign: 'middle'
  }} />
)}
```

> **Note:** The exact badge styling should match the app's design system. A green dot is a minimal placeholder — can be refined later.

**Step 3: Build frontend**

```bash
(cd src/Brmble.Web && npm run build)
```
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx
git commit -m "feat: handle live session mapping updates and show Brmble badge"
```

---

## Task 11: End-to-End Docker Verification

**Step 1: Rebuild everything**

```bash
(cd src/Brmble.Web && npm run build)
wsl docker compose -f docker-local/docker-compose.yml up -d --build brmble
dotnet build src/Brmble.Client
```

**Step 2: Manual test checklist**

- [ ] Connect Brmble client → user shows Brmble badge
- [ ] Connect a second Brmble client → both show badges
- [ ] Disconnect one client → badge disappears for disconnected user
- [ ] Reconnect → new session, badge reappears
- [ ] Check server logs: `Mapped session`, `userMappingAdded`, `userMappingRemoved` events
- [ ] Check auth response includes `sessionMappings` field

**Step 3: Run all tests**

```bash
dotnet test -v n
```
Expected: All tests pass

---

## Summary

| Task | Component | New Files |
|------|-----------|-----------|
| 1 | CertificateHasher | `Auth/CertificateHasher.cs` + test |
| 2 | SessionMappingService | `Events/ISessionMappingService.cs`, `Events/SessionMappingService.cs` + test |
| 3 | BrmbleEventBus | `Events/IBrmbleEventBus.cs`, `Events/BrmbleEventBus.cs` + test |
| 4 | MumbleServerCallback | Modified (cert resolution) |
| 5 | SessionMappingHandler | `Events/SessionMappingHandler.cs` + test, `MumbleExtensions.cs` DI |
| 6 | AuthEndpoints | Modified (sessionMappings in response) |
| 7 | WebSocket endpoint | `WebSockets/BrmbleWebSocketHandler.cs`, `Program.cs` |
| 8 | Docker verification | Server-side smoke test |
| 9 | MumbleAdapter | Modified (WS client, session lookups) |
| 10 | Frontend | Modified (bridge handlers, badge) |
| 11 | E2E verification | Full smoke test |
