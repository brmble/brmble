# Multi-Share Foundation Implementation Plan

> **Status: COMPLETED** — All 9 tasks implemented and merged.
>
> **Post-implementation update:** The `useScreenShare` hook was refactored from a dual-room model (`publishRoomRef` + `viewerRoomRef`) to a single-connection model (one `roomRef` per channel). This eliminates reconnect hiccups when transitioning between sharing and watching, since LiveKit enforces one connection per identity per room. The inline code samples in Tasks 5-6 below reflect the original implementation, not the current single-connection architecture. See the design spec for the current model.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple users to share screens simultaneously within a channel, with viewers able to switch between active shares.

**Architecture:** Refactor `ScreenShareTracker` from single-share-per-room to multi-share-per-room. Update all server endpoints, bridge messages, and frontend hook to handle arrays of shares. Add `RoomServiceClient` for server-side participant removal on channel leave/kick. Add periodic reconciliation to clean ghost shares.

**Tech Stack:** C# / ASP.NET Core, TypeScript / React, LiveKit Server SDK (`Livekit.Server.Sdk.Dotnet`), `livekit-client` npm package, Vitest, MSTest

---

### Task 1: Refactor ScreenShareTracker to support multiple shares per room

**Files:**
- Modify: `src/Brmble.Server/LiveKit/ScreenShareTracker.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/ScreenShareTrackerTests.cs`

- [ ] **Step 1: Write failing tests for multi-share tracker**

Replace the entire test file:

```csharp
using Brmble.Server.LiveKit;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class ScreenShareTrackerTests
{
    private ScreenShareTracker _tracker = null!;

    [TestInitialize]
    public void Setup() => _tracker = new ScreenShareTracker();

    [TestMethod]
    public void GetActiveShares_NoShares_ReturnsEmptyList()
    {
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.IsNotNull(shares);
        Assert.AreEqual(0, shares.Count);
    }

    [TestMethod]
    public void Start_ThenGetActiveShares_ReturnsSingleShare()
    {
        _tracker.Start("channel-1", "alice", 10L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("alice", shares[0].UserName);
        Assert.AreEqual(10L, shares[0].UserId);
    }

    [TestMethod]
    public void Start_MultipleUsers_ReturnsAllShares()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(2, shares.Count);
        Assert.IsTrue(shares.Any(s => s.UserName == "alice" && s.UserId == 10L));
        Assert.IsTrue(shares.Any(s => s.UserName == "bob" && s.UserId == 20L));
    }

    [TestMethod]
    public void Start_SameUserTwice_ReturnsFalse()
    {
        Assert.IsTrue(_tracker.Start("channel-1", "alice", 10L));
        Assert.IsFalse(_tracker.Start("channel-1", "alice", 10L));
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
    }

    [TestMethod]
    public void StopByUserId_RemovesCorrectShare()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        _tracker.StopByUserId("channel-1", 10L);
        var shares = _tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("bob", shares[0].UserName);
    }

    [TestMethod]
    public void StopByUserId_NonExistent_DoesNotThrow()
    {
        _tracker.StopByUserId("channel-1", 99L);
    }

    [TestMethod]
    public void GetSharesByUserId_ReturnsAllRooms()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-2", "alice", 10L);
        var rooms = _tracker.GetSharesByUserId(10L);
        Assert.AreEqual(2, rooms.Count);
        CollectionAssert.Contains(rooms, "channel-1");
        CollectionAssert.Contains(rooms, "channel-2");
    }

    [TestMethod]
    public void GetSharesByUserId_NoShares_ReturnsEmptyList()
    {
        var rooms = _tracker.GetSharesByUserId(99L);
        Assert.AreEqual(0, rooms.Count);
    }

    [TestMethod]
    public void StopAllByUserId_RemovesFromAllRooms()
    {
        _tracker.Start("channel-1", "alice", 10L);
        _tracker.Start("channel-2", "alice", 10L);
        _tracker.Start("channel-1", "bob", 20L);
        _tracker.StopAllByUserId(10L);
        Assert.AreEqual(0, _tracker.GetSharesByUserId(10L).Count);
        Assert.AreEqual(1, _tracker.GetActiveShares("channel-1").Count);
    }

    // Backward compat: GetActive returns first share (used by endpoints migrating)
    [TestMethod]
    public void GetActive_ReturnsNullWhenEmpty()
    {
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void GetActive_ReturnsShareWhenPresent()
    {
        _tracker.Start("channel-1", "alice", 10L);
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("alice", info.UserName);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ScreenShareTrackerTests" -v n`

Expected: Multiple failures (methods like `GetActiveShares`, `StopByUserId`, `GetSharesByUserId`, `StopAllByUserId` don't exist yet, `Start` doesn't return bool)

- [ ] **Step 3: Implement the new ScreenShareTracker**

Replace `src/Brmble.Server/LiveKit/ScreenShareTracker.cs`:

```csharp
using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public class ScreenShareTracker
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<long, ScreenShareInfo>> _rooms = new();

    /// <summary>
    /// Add a share to a room. Returns false if the user is already sharing in this room.
    /// </summary>
    public bool Start(string roomName, string userName, long userId)
    {
        var room = _rooms.GetOrAdd(roomName, _ => new ConcurrentDictionary<long, ScreenShareInfo>());
        return room.TryAdd(userId, new ScreenShareInfo(userName, userId));
    }

    /// <summary>
    /// Remove a specific user's share from a room.
    /// </summary>
    public void StopByUserId(string roomName, long userId)
    {
        if (_rooms.TryGetValue(roomName, out var room))
        {
            room.TryRemove(userId, out _);
            if (room.IsEmpty)
                _rooms.TryRemove(roomName, out _);
        }
    }

    /// <summary>
    /// Get all active shares in a room.
    /// </summary>
    public IReadOnlyList<ScreenShareInfo> GetActiveShares(string roomName)
    {
        if (_rooms.TryGetValue(roomName, out var room))
            return room.Values.ToList();
        return Array.Empty<ScreenShareInfo>();
    }

    /// <summary>
    /// Get all room names where a specific user is sharing.
    /// </summary>
    public IReadOnlyList<string> GetSharesByUserId(long userId)
    {
        return _rooms
            .Where(kvp => kvp.Value.ContainsKey(userId))
            .Select(kvp => kvp.Key)
            .ToList();
    }

    /// <summary>
    /// Remove all shares by a specific user across all rooms.
    /// Returns the room names where shares were removed.
    /// </summary>
    public IReadOnlyList<string> StopAllByUserId(long userId)
    {
        var rooms = new List<string>();
        foreach (var (roomName, room) in _rooms)
        {
            if (room.TryRemove(userId, out _))
            {
                rooms.Add(roomName);
                if (room.IsEmpty)
                    _rooms.TryRemove(roomName, out _);
            }
        }
        return rooms;
    }

    // --- Backward compatibility ---

    /// <summary>
    /// Get the first active share in a room (backward compat).
    /// Prefer GetActiveShares for new code.
    /// </summary>
    public ScreenShareInfo? GetActive(string roomName)
    {
        if (_rooms.TryGetValue(roomName, out var room))
            return room.Values.FirstOrDefault();
        return null;
    }

    /// <summary>
    /// Get the first room where a user is sharing (backward compat).
    /// Prefer GetSharesByUserId for new code.
    /// </summary>
    public string? GetActiveByUserId(long userId)
    {
        return GetSharesByUserId(userId).FirstOrDefault();
    }

    /// <summary>
    /// Remove the single share from a room (backward compat for old Stop(roomName) calls).
    /// Prefer StopByUserId for new code.
    /// </summary>
    public void Stop(string roomName)
    {
        _rooms.TryRemove(roomName, out _);
    }
}

public record ScreenShareInfo(string UserName, long UserId);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ScreenShareTrackerTests" -v n`

Expected: All 10 tests pass

- [ ] **Step 5: Run all server tests to check nothing is broken**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass. The backward-compat methods (`GetActive`, `GetActiveByUserId`, `Stop`) keep existing callers working.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/LiveKit/ScreenShareTracker.cs tests/Brmble.Server.Tests/LiveKit/ScreenShareTrackerTests.cs
git commit -m "feat: refactor ScreenShareTracker to support multiple shares per room"
```

---

### Task 2: Update server endpoints for multi-share

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/Integration/ScreenShareEndpointTests.cs`

- [ ] **Step 1: Write failing integration tests for multi-share endpoints**

Replace the test file:

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ScreenShareEndpointTests
{
    [TestMethod]
    public async Task ShareStarted_ThenActiveShare_ReturnsShareInArray()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var startResp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        Assert.AreEqual(HttpStatusCode.OK, startResp.StatusCode);

        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.OK, activeResp.StatusCode);
        var body = await activeResp.Content.ReadFromJsonAsync<ActiveSharesResponse>();
        Assert.IsNotNull(body?.Shares);
        Assert.AreEqual(1, body.Shares.Length);
        Assert.AreEqual("maui", body.Shares[0].UserName);
    }

    [TestMethod]
    public async Task ShareStarted_SameUserTwice_Returns409()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var first = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        Assert.AreEqual(HttpStatusCode.OK, first.StatusCode);

        var second = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        Assert.AreEqual(HttpStatusCode.Conflict, second.StatusCode);
    }

    [TestMethod]
    public async Task ShareStopped_ThenActiveShare_ReturnsEmptyArray()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        await client.PostAsJsonAsync("/livekit/share-stopped", new { roomName = "channel-4" });

        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.OK, activeResp.StatusCode);
        var body = await activeResp.Content.ReadFromJsonAsync<ActiveSharesResponse>();
        Assert.IsNotNull(body?.Shares);
        Assert.AreEqual(0, body.Shares.Length);
    }

    [TestMethod]
    public async Task ActiveShare_NoShare_ReturnsEmptyArray()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "maui" });

        var resp = await client.GetAsync("/livekit/active-share?roomName=channel-99");
        Assert.AreEqual(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<ActiveSharesResponse>();
        Assert.IsNotNull(body?.Shares);
        Assert.AreEqual(0, body.Shares.Length);
    }

    [TestMethod]
    public async Task ShareStarted_NoCert_Returns401()
    {
        await using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var resp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-1" });
        Assert.AreEqual(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private record ShareInfo(string UserName, long UserId, int? SessionId);
    private record ActiveSharesResponse(ShareInfo[] Shares);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ScreenShareEndpointTests" -v n`

Expected: Failures due to changed response format (array vs single object, 200 vs 404)

- [ ] **Step 3: Update the endpoints**

Replace the contents of `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`:

```csharp
using System.Text.Json;
using Brmble.Server.Auth;
using Brmble.Server.Events;

namespace Brmble.Server.LiveKit;

public static class LiveKitEndpoints
{
    public static IEndpointRouteBuilder MapLiveKitEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/livekit/token", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            LiveKitService liveKitService,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop)
                    ? prop.GetString() : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse LiveKit token request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            var token = await liveKitService.GenerateToken(certHash, roomName);
            if (token is null)
                return Results.Unauthorized();

            var request = httpContext.Request;
            var wsScheme = request.Scheme == "https" ? "wss" : "ws";
            var url = $"{wsScheme}://{request.Host}/livekit";

            return Results.Ok(new { token, url });
        });

        app.MapPost("/livekit/share-started", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ScreenShareTracker tracker,
            IBrmbleEventBus eventBus,
            ISessionMappingService sessionMapping,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop) ? prop.GetString() : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-started request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            if (!tracker.Start(roomName, user.DisplayName, user.Id))
                return Results.Conflict(new { error = "user is already sharing in this room" });

            var hasSession = sessionMapping.TryGetSessionByUserId(user.Id, out var sessionId);
            await eventBus.BroadcastAsync(new
            {
                type = "screenShare.started",
                roomName,
                userName = user.DisplayName,
                userId = user.Id,
                sessionId = hasSession ? sessionId : (int?)null
            });
            return Results.Ok();
        });

        app.MapPost("/livekit/share-stopped", async (
            HttpContext httpContext,
            ICertificateHashExtractor certHashExtractor,
            UserRepository userRepo,
            ScreenShareTracker tracker,
            IBrmbleEventBus eventBus,
            ILogger<LiveKitService> logger) =>
        {
            var certHash = certHashExtractor.GetCertHash(httpContext);
            if (string.IsNullOrWhiteSpace(certHash))
                return Results.Unauthorized();

            var user = await userRepo.GetByCertHash(certHash);
            if (user is null)
                return Results.Unauthorized();

            string? roomName = null;
            try
            {
                using var doc = await JsonDocument.ParseAsync(httpContext.Request.Body);
                roomName = doc.RootElement.TryGetProperty("roomName", out var prop) ? prop.GetString() : null;
            }
            catch (Exception ex) { logger.LogWarning(ex, "Failed to parse share-stopped request body"); }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            // Idempotent: just remove the user's share, no error if not found
            tracker.StopByUserId(roomName, user.Id);
            await eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = user.Id });
            return Results.Ok();
        });

        app.MapGet("/livekit/active-share", (
            HttpContext httpContext,
            ScreenShareTracker tracker,
            ISessionMappingService sessionMapping) =>
        {
            var roomName = httpContext.Request.Query["roomName"].ToString();
            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName query parameter is required" });

            if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
                return Results.BadRequest(new { error = "invalid roomName format" });

            var shares = tracker.GetActiveShares(roomName);
            var result = shares.Select(s =>
            {
                var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
                return new { s.UserName, s.UserId, sessionId = hasSession ? sessionId : (int?)null };
            }).ToArray();

            return Results.Ok(new { shares = result });
        });

        return app;
    }
}
```

Key changes:
- `share-started`: uses `tracker.Start()` return value, returns 409 on duplicate
- `share-stopped`: uses `StopByUserId` instead of ownership check + `Stop`. Now idempotent. Includes `userId` in broadcast.
- `active-share`: returns `{ shares: [...] }` array, never 404 (empty array instead)

- [ ] **Step 4: Run integration tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ScreenShareEndpointTests" -v n`

Expected: All 5 tests pass

- [ ] **Step 5: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/Integration/ScreenShareEndpointTests.cs
git commit -m "feat: update LiveKit endpoints for multi-share (array response, 409 on duplicate)"
```

---

### Task 3: Update MumbleServerCallback for multi-share cleanup

**Files:**
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs:146-179`

- [ ] **Step 1: Update DispatchUserDisconnected to use StopAllByUserId**

In `MumbleServerCallback.cs`, replace lines 148-157 (the screen share cleanup in `DispatchUserDisconnected`):

Old code:
```csharp
        // Check if user was sharing and stop it before removing session
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            var shareRoom = _screenShareTracker.GetActiveByUserId(mapping.UserId);
            if (shareRoom is not null)
            {
                _screenShareTracker.Stop(shareRoom);
                await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName = shareRoom });
            }
        }
```

New code:
```csharp
        // Check if user was sharing and stop all their shares before removing session
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            var stoppedRooms = _screenShareTracker.StopAllByUserId(mapping.UserId);
            foreach (var roomName in stoppedRooms)
            {
                await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = mapping.UserId });
            }
        }
```

- [ ] **Step 2: Update DispatchUserStateChanged to use StopByUserId**

In `MumbleServerCallback.cs`, replace lines 170-178 (the screen share cleanup in `DispatchUserStateChanged`):

Old code:
```csharp
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            var shareRoom = _screenShareTracker.GetActiveByUserId(mapping.UserId);
            if (shareRoom is not null && shareRoom != $"channel-{channelId}")
            {
                _screenShareTracker.Stop(shareRoom);
                await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName = shareRoom });
            }
        }
```

New code:
```csharp
        var snapshot = _sessionMapping.GetSnapshot();
        if (snapshot.TryGetValue(user.SessionId, out var mapping))
        {
            var currentRoom = $"channel-{channelId}";
            var shareRooms = _screenShareTracker.GetSharesByUserId(mapping.UserId);
            foreach (var roomName in shareRooms)
            {
                if (roomName != currentRoom)
                {
                    _screenShareTracker.StopByUserId(roomName, mapping.UserId);
                    await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = mapping.UserId });
                }
            }
        }
```

- [ ] **Step 3: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Server/Mumble/MumbleServerCallback.cs
git commit -m "feat: update MumbleServerCallback cleanup for multi-share"
```

---

### Task 4: Update bridge message handling in MumbleAdapter (C# client)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Update SSE event forwarding for screenShare.stopped to include userId**

In `MumbleAdapter.cs` around line 1705-1724, find the `screenShare.stopped` case in the SSE event dispatch. Update it to forward the `userId` field:

Find the `screenShare.stopped` case (approximately line 1715-1720). The current code sends:
```csharp
_bridge?.Send("livekit.screenShareStopped", new { roomName = ... });
```

Update to also include `userId`:
```csharp
_bridge?.Send("livekit.screenShareStopped", new { roomName = ..., userId = ... });
```

Extract `userId` from the SSE event data the same way `roomName` is extracted. The server now includes `userId` in the `screenShare.stopped` broadcast.

- [ ] **Step 2: Update livekit.checkActiveShare handler to return shares array**

In `MumbleAdapter.cs` around lines 2295-2337, find the `livekit.checkActiveShare` handler. Currently it expects a single share response and sends `livekit.activeShareResult` with `{ roomName, active, userName, sessionId }`.

Update it to parse the new array response format `{ shares: [...] }` and send:
```csharp
_bridge?.Send("livekit.activeShareResult", new { roomName, shares = parsedShares });
```

Where `parsedShares` is an array of `{ userId, userName, sessionId }` objects parsed from the server's JSON response.

- [ ] **Step 3: Build the client to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`

Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: update bridge messages for multi-share (userId in stopped, shares array in active)"
```

---

### Task 5: Refactor useScreenShare hook for multi-share

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write failing tests for multi-share hook behavior**

Replace `src/Brmble.Web/src/hooks/useScreenShare.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from './useScreenShare';
import bridge from '../bridge';

// Mock livekit-client
const mockRoom = {
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  name: 'channel-1',
  localParticipant: {
    setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
  },
  remoteParticipants: new Map(),
  on: vi.fn().mockReturnThis(),
};

vi.mock('livekit-client', () => ({
  Room: class MockRoom {
    connect = mockRoom.connect;
    disconnect = mockRoom.disconnect;
    name = mockRoom.name;
    localParticipant = mockRoom.localParticipant;
    remoteParticipants = mockRoom.remoteParticipants;
    on = mockRoom.on;
  },
  RoomEvent: {
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
  },
  Track: {
    Kind: { Video: 'video' },
    Source: { ScreenShare: 'screen_share' },
  },
}));

vi.mock('../bridge', () => ({
  default: {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in idle state with empty activeShares', () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.activeShares).toEqual([]);
    expect(result.current.watchingShare).toBeNull();
  });

  it('requests token via bridge and connects on startSharing', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', { roomName: 'channel-1' });
    expect(result.current.isSharing).toBe(true);
  });

  it('accumulates multiple screenShareStarted events into activeShares', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, sessionId: 1 });
    });
    expect(result.current.activeShares).toHaveLength(1);
    expect(result.current.activeShares[0].userName).toBe('alice');

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20, sessionId: 2 });
    });
    expect(result.current.activeShares).toHaveLength(2);
  });

  it('removes specific user from activeShares on screenShareStopped', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'bob', userId: 20 });
    });
    expect(result.current.activeShares).toHaveLength(2);

    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });
    expect(result.current.activeShares).toHaveLength(1);
    expect(result.current.activeShares[0].userName).toBe('bob');
  });

  it('clears watchingShare when watched user stops sharing', () => {
    let shareStartedHandler: ((data: unknown) => void) | null = null;
    let shareStoppedHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
      if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10 });
    });

    // Simulate watching alice (set watchingShare manually via the hook's internal state)
    // In practice this happens via connectAsViewer, but for unit test we trigger the event
    act(() => {
      shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
    });
    expect(result.current.activeShares).toHaveLength(0);
    expect(result.current.watchingShare).toBeNull();
  });

  it('populates activeShares from activeShareResult with shares array', () => {
    let activeShareHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    act(() => {
      activeShareHandler?.({
        roomName: 'channel-1',
        shares: [
          { userId: 10, userName: 'alice', sessionId: 1 },
          { userId: 20, userName: 'bob', sessionId: 2 },
        ],
      });
    });
    expect(result.current.activeShares).toHaveLength(2);
  });

  it('disconnects on stopSharing', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const { result } = renderHook(() => useScreenShare());

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });
    await act(async () => {
      await result.current.stopSharing();
    });

    expect(result.current.isSharing).toBe(false);
  });

  it('passes correct capture options to setScreenShareEnabled', async () => {
    let tokenHandler: ((data: unknown) => void) | null = null;
    (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
      if (type === 'livekit.token') tokenHandler = handler;
    });

    const settings = {
      captureAudio: true,
      systemAudio: true,
      resolution: '1080p' as const,
      fps: 30 as const,
    };

    const { result } = renderHook(() => useScreenShare(undefined, settings));

    await act(async () => {
      const promise = result.current.startSharing('channel-1');
      tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit' });
      await promise;
    });

    expect(mockRoom.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true, expect.objectContaining({
      audio: true,
      systemAudio: 'include',
      resolution: { width: 1920, height: 1080, frameRate: 30 },
      videoEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 },
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `src/Brmble.Web`: `npx vitest run src/hooks/useScreenShare.test.ts`

Expected: Failures — `activeShares` and `watchingShare` don't exist on the hook's return value yet

- [ ] **Step 3: Rewrite the useScreenShare hook**

Replace `src/Brmble.Web/src/hooks/useScreenShare.ts`:

```typescript
import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import bridge from '../bridge';

export interface ShareInfo {
  roomName: string;
  userName: string;
  userId: number;
  sessionId?: number;
}

/** @deprecated Use ShareInfo instead */
export interface ActiveShare {
  roomName: string;
  userName: string;
  sessionId?: number;
}

export interface ScreenShareSettings {
  captureAudio: boolean;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 15 | 30 | 60;
  systemAudio: boolean;
}

export function useScreenShare(onDisconnected?: () => void, screenShareSettings?: ScreenShareSettings) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShares, setActiveShares] = useState<ShareInfo[]>([]);
  const [watchingShare, setWatchingShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);
  const publishRoomRef = useRef<Room | null>(null);
  const viewerRoomRef = useRef<Room | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  // Helper: request a LiveKit token via bridge
  const requestToken = useCallback((roomName: string) => {
    return new Promise<{ token: string; url: string }>((resolve, reject) => {
      const cleanup = () => {
        bridge.off('livekit.token', onToken);
        bridge.off('livekit.tokenError', onError);
        clearTimeout(timer);
      };
      const onToken = (data: unknown) => {
        cleanup();
        resolve(data as { token: string; url: string });
      };
      const onError = (data: unknown) => {
        cleanup();
        reject(new Error((data as { error: string }).error));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Token request timed out'));
      }, 20000);
      bridge.on('livekit.token', onToken);
      bridge.on('livekit.tokenError', onError);
      bridge.send('livekit.requestToken', { roomName });
    });
  }, []);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    if (publishRoomRef.current) {
      try { await publishRoomRef.current.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
    }

    try {
      const { token, url } = await requestToken(roomName);

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        publishRoomRef.current = null;
        onDisconnectedRef.current?.();
      });

      await room.connect(url, token);

      let captureOptions: Record<string, unknown> | undefined;
      if (screenShareSettings) {
        const resolutionMap: Record<string, { width: number; height: number }> = {
          '720p': { width: 1280, height: 720 },
          '1080p': { width: 1920, height: 1080 },
          '1440p': { width: 2560, height: 1440 },
          '4k': { width: 3840, height: 2160 },
        };

        const bitrateMap: Record<string, number> = {
          '720p': 2_000_000,
          '1080p': 4_000_000,
          '1440p': 8_000_000,
          '4k': 15_000_000,
        };

        captureOptions = {};

        if (screenShareSettings.captureAudio) {
          captureOptions.audio = true;
        }

        if (screenShareSettings.captureAudio && screenShareSettings.systemAudio) {
          captureOptions.systemAudio = 'include';
        }

        if (screenShareSettings.resolution || screenShareSettings.fps) {
          const res = resolutionMap[screenShareSettings.resolution];
          captureOptions.resolution = {
            ...res,
            frameRate: screenShareSettings.fps,
          };
          captureOptions.videoEncoding = {
            maxBitrate: bitrateMap[screenShareSettings.resolution],
            maxFramerate: screenShareSettings.fps,
          };
        }

        if (Object.keys(captureOptions).length === 0) {
          captureOptions = undefined;
        }
      }

      await room.localParticipant.setScreenShareEnabled(true, captureOptions);

      publishRoomRef.current = room;
      setIsSharing(true);

      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, [screenShareSettings, requestToken]);

  const stopSharing = useCallback(async () => {
    const room = publishRoomRef.current;
    if (room) {
      const roomName = room.name;
      try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* already stopped */ }
      try { await room.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
      if (roomName) {
        bridge.send('livekit.shareStopped', { roomName });
      }
    }
    setIsSharing(false);
  }, []);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number) => {
    // Find the share info for this user
    const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);

    // If already connected to this room (sharing or viewing), just subscribe to the track
    const existingRoom = viewerRoomRef.current ?? publishRoomRef.current;
    if (existingRoom?.name === roomName && existingRoom?.state === 'connected') {
      // Already in the room, just find and subscribe to the target's track
      const participant = existingRoom.remoteParticipants.get(String(targetUserId));
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEl(el);
          }
        });
      }
      setWatchingShare(shareInfo ?? { roomName, userName: '', userId: targetUserId });
      return;
    }

    // Disconnect existing viewer connection if switching rooms
    if (viewerRoomRef.current) {
      try { await viewerRoomRef.current.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }

    try {
      const { token, url } = await requestToken(roomName);

      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare &&
          participant.identity === String(targetUserId)
        ) {
          const el = track.attach() as HTMLVideoElement;
          setRemoteVideoEl(el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare &&
          participant.identity === String(targetUserId)
        ) {
          track.detach();
          setRemoteVideoEl(null);
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        viewerRoomRef.current = null;
        setRemoteVideoEl(null);
      });

      await room.connect(url, token);
      viewerRoomRef.current = room;

      // Check for already-published screen share tracks from target user
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        if (participant.identity === String(targetUserId)) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              const el = pub.track.attach() as HTMLVideoElement;
              setRemoteVideoEl(el);
            }
          });
        }
      });

      setWatchingShare(shareInfo ?? { roomName, userName: '', userId: targetUserId });
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
    }
  }, [activeShares, requestToken]);

  const disconnectViewer = useCallback(async () => {
    const room = viewerRoomRef.current;
    if (room) {
      // Only disconnect if we're not also sharing in this room
      if (publishRoomRef.current?.name !== room.name) {
        try { await room.disconnect(); } catch { /* ignore */ }
      }
      viewerRoomRef.current = null;
    }
    setRemoteVideoEl(null);
    setWatchingShare(null);
  }, []);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; sessionId?: number };
      setActiveShares(prev => {
        // Don't add duplicates
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      setActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));
      setWatchingShare(prev => {
        if (prev && prev.roomName === d.roomName && prev.userId === d.userId) {
          // The share we were watching stopped
          if (viewerRoomRef.current) {
            viewerRoomRef.current.disconnect().catch(() => {});
            viewerRoomRef.current = null;
          }
          setRemoteVideoEl(null);
          return null;
        }
        return prev;
      });
    };

    const onActiveShareResult = (data: unknown) => {
      const d = data as { roomName: string; shares: Array<{ userId: number; userName: string; sessionId?: number }> };
      if (d.shares && d.shares.length > 0) {
        setActiveShares(d.shares.map(s => ({
          roomName: d.roomName,
          userName: s.userName,
          userId: s.userId,
          sessionId: s.sessionId,
        })));
      } else {
        setActiveShares([]);
      }
    };

    bridge.on('livekit.screenShareStarted', onShareStarted);
    bridge.on('livekit.screenShareStopped', onShareStopped);
    bridge.on('livekit.activeShareResult', onActiveShareResult);

    return () => {
      bridge.off('livekit.screenShareStarted', onShareStarted);
      bridge.off('livekit.screenShareStopped', onShareStopped);
      bridge.off('livekit.activeShareResult', onActiveShareResult);
    };
  }, []);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  return {
    isSharing,
    startSharing,
    stopSharing,
    error,
    activeShare,       // backward compat
    activeShares,      // new: all active shares
    watchingShare,     // new: which share you're viewing
    remoteVideoEl,
    disconnectViewer,
    connectAsViewer,
  };
}
```

Key changes:
- `activeShare` (single) → `activeShares` (array) + `watchingShare` (what you're viewing)
- `connectAsViewer` now takes `(roomName, targetUserId)` to subscribe to a specific user's track
- `onShareStarted` appends to array, `onShareStopped` removes by `userId`
- `onActiveShareResult` parses the new `{ shares: [...] }` format
- `requestToken` extracted as shared helper
- Backward compat: `activeShare` still exposed as first item for existing consumers
- `disconnectViewer` only disconnects the room if not also sharing in it

- [ ] **Step 4: Run tests to verify they pass**

Run from `src/Brmble.Web`: `npx vitest run src/hooks/useScreenShare.test.ts`

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "feat: refactor useScreenShare hook for multi-share support"
```

---

### Task 6: Update App.tsx and consuming components for multi-share

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (update useScreenShare usage, pass activeShares)
- Modify: `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx` (show whose share)
- Modify: Channel tree component (make monitor icons clickable, show for all sharers)

This task updates consumers of `useScreenShare` to use the new `activeShares` array and `watchingShare` state. The exact changes depend on how `App.tsx` passes props to child components.

- [ ] **Step 1: Update App.tsx useScreenShare usage**

In `App.tsx`, where `useScreenShare` is called, update to destructure the new properties:

Old:
```typescript
const { isSharing, startSharing, stopSharing, error, activeShare, remoteVideoEl, disconnectViewer, connectAsViewer } = useScreenShare(...);
```

New:
```typescript
const { isSharing, startSharing, stopSharing, error, activeShare, activeShares, watchingShare, remoteVideoEl, disconnectViewer, connectAsViewer } = useScreenShare(...);
```

Update any toast notification logic that reacts to `activeShare` changing — it should now react to `activeShares` additions. When a new share appears in `activeShares` that wasn't there before, show a toast for that specific user.

Update the props passed to `ChatPanel` (or wherever the viewer is rendered) to include `watchingShare` so the viewer knows whose share it's displaying.

- [ ] **Step 2: Update ScreenShareViewer to use watchingShare**

In `ScreenShareViewer.tsx`, verify the `sharerName` prop is being passed correctly. No structural changes needed — the parent just needs to pass `watchingShare.userName` instead of `activeShare.userName`.

- [ ] **Step 3: Update channel tree to show monitor icons for all sharers**

In the channel tree / user list component, find where the monitor icon is rendered for the active sharer. Update it to:
- Show a monitor icon for every user in `activeShares` (not just one)
- Make each icon clickable, calling `connectAsViewer(roomName, userId)` for that user
- Add visual distinction (e.g., highlighted color) for the user whose share you're currently watching (`watchingShare?.userId`)
- Add tooltip: "Watch [userName]'s screen"

- [ ] **Step 4: Build frontend to verify**

Run from `src/Brmble.Web`: `npx vite build`

Expected: Build succeeds with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/
git commit -m "feat: update App.tsx and components for multi-share activeShares array"
```

---

### Task 7: Add LiveKit RoomServiceClient for participant removal

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
- Modify: `src/Brmble.Server/Mumble/MumbleServerCallback.cs`
- Create: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs`

- [ ] **Step 1: Write failing test for RemoveParticipant**

Create `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceRemoveParticipantTests.cs`:

```csharp
using Brmble.Server.LiveKit;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceRemoveParticipantTests
{
    [TestMethod]
    public async Task RemoveParticipant_DoesNotThrow_WhenRoomDoesNotExist()
    {
        // RemoveParticipant should be idempotent - no error if room/participant doesn't exist
        var settings = Options.Create(new LiveKitSettings { ApiKey = "test", ApiSecret = "secret-must-be-long-enough-for-hmac" });
        var userRepo = new Mock<UserRepository>(null!);
        var logger = new Mock<ILogger<LiveKitService>>();

        var service = new LiveKitService(settings, userRepo.Object, logger.Object);

        // Should not throw even if LiveKit server isn't running (we catch the exception)
        await service.RemoveParticipant("nonexistent-room", "nonexistent-user");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RemoveParticipantTests" -v n`

Expected: Compilation error — `RemoveParticipant` method doesn't exist

- [ ] **Step 3: Add RemoveParticipant to LiveKitService**

Add to `src/Brmble.Server/LiveKit/LiveKitService.cs`, after the `GenerateToken` method:

```csharp
    public async Task RemoveParticipant(string roomName, string participantIdentity)
    {
        try
        {
            var roomService = new RoomServiceClient(
                $"http://localhost:7880",  // LiveKit server address - should come from config
                _settings.ApiKey,
                _settings.ApiSecret);

            await roomService.RemoveParticipant(new Livekit.Server.Sdk.Dotnet.RemoveParticipantRequest
            {
                Room = roomName,
                Identity = participantIdentity
            });

            _logger.LogInformation("Removed participant {Identity} from room {Room}", participantIdentity, roomName);
        }
        catch (Exception ex)
        {
            // Idempotent: if room/participant doesn't exist, that's fine
            _logger.LogDebug(ex, "Could not remove participant {Identity} from room {Room} (may not exist)", participantIdentity, roomName);
        }
    }
```

Note: The `RoomServiceClient` URL should ideally come from `LiveKitSettings`. Add a `ServerUrl` property to `LiveKitSettings.cs`:

In `src/Brmble.Server/LiveKit/LiveKitSettings.cs`, add:
```csharp
public string ServerUrl { get; set; } = "http://localhost:7880";
```

Then use `_settings.ServerUrl` in `RemoveParticipant`.

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~RemoveParticipantTests" -v n`

Expected: Pass (the catch block handles the connection failure gracefully)

- [ ] **Step 5: Wire RemoveParticipant into MumbleServerCallback**

In `MumbleServerCallback.cs`, the cleanup code (from Task 3) already calls `StopAllByUserId` and `StopByUserId`. Now add `LiveKitService.RemoveParticipant` calls alongside them.

The callback needs `LiveKitService` injected. Add it to the constructor if not already present.

In `DispatchUserDisconnected`, after `StopAllByUserId`:
```csharp
// Also remove from LiveKit room
await _liveKitService.RemoveParticipant(roomName, mapping.MatrixUserId);
```

In `DispatchUserStateChanged`, after `StopByUserId`:
```csharp
await _liveKitService.RemoveParticipant(roomName, mapping.MatrixUserId);
```

- [ ] **Step 6: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/LiveKit/ tests/Brmble.Server.Tests/LiveKit/ src/Brmble.Server/Mumble/MumbleServerCallback.cs
git commit -m "feat: add RoomServiceClient for participant removal on channel leave/kick"
```

---

### Task 8: Add periodic ghost share reconciliation

**Files:**
- Create: `src/Brmble.Server/LiveKit/ScreenShareReconciliationService.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`
- Create: `tests/Brmble.Server.Tests/LiveKit/ScreenShareReconciliationTests.cs`

- [ ] **Step 1: Write failing test for reconciliation**

Create `tests/Brmble.Server.Tests/LiveKit/ScreenShareReconciliationTests.cs`:

```csharp
using Brmble.Server.Events;
using Brmble.Server.LiveKit;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class ScreenShareReconciliationTests
{
    [TestMethod]
    public async Task Reconcile_RemovesStaleShares()
    {
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-1", "alice", 10L);
        tracker.Start("channel-1", "bob", 20L);

        // Mock LiveKitService to return only bob as a participant
        var liveKitService = new Mock<ILiveKitRoomQuery>();
        liveKitService.Setup(s => s.ListParticipantIdentities("channel-1"))
            .ReturnsAsync(new List<string> { "@bob:matrix.org" });

        // Mock user ID to matrix ID mapping
        var userIdMapper = new Mock<IUserIdMapper>();
        userIdMapper.Setup(m => m.GetMatrixUserId(10L)).Returns("@alice:matrix.org");
        userIdMapper.Setup(m => m.GetMatrixUserId(20L)).Returns("@bob:matrix.org");

        var eventBus = new Mock<IBrmbleEventBus>();
        var logger = new Mock<ILogger<ScreenShareReconciliationService>>();

        var service = new ScreenShareReconciliationService(tracker, liveKitService.Object, userIdMapper.Object, eventBus.Object, logger.Object);

        await service.ReconcileAsync();

        var shares = tracker.GetActiveShares("channel-1");
        Assert.AreEqual(1, shares.Count);
        Assert.AreEqual("bob", shares[0].UserName);

        eventBus.Verify(e => e.BroadcastAsync(It.Is<object>(o =>
            o.ToString()!.Contains("screenShare.stopped"))), Times.Once);
    }

    [TestMethod]
    public async Task Reconcile_NoStaleShares_NoChanges()
    {
        var tracker = new ScreenShareTracker();
        tracker.Start("channel-1", "alice", 10L);

        var liveKitService = new Mock<ILiveKitRoomQuery>();
        liveKitService.Setup(s => s.ListParticipantIdentities("channel-1"))
            .ReturnsAsync(new List<string> { "@alice:matrix.org" });

        var userIdMapper = new Mock<IUserIdMapper>();
        userIdMapper.Setup(m => m.GetMatrixUserId(10L)).Returns("@alice:matrix.org");

        var eventBus = new Mock<IBrmbleEventBus>();
        var logger = new Mock<ILogger<ScreenShareReconciliationService>>();

        var service = new ScreenShareReconciliationService(tracker, liveKitService.Object, userIdMapper.Object, eventBus.Object, logger.Object);

        await service.ReconcileAsync();

        Assert.AreEqual(1, tracker.GetActiveShares("channel-1").Count);
        eventBus.Verify(e => e.BroadcastAsync(It.IsAny<object>()), Times.Never);
    }
}
```

Note: The exact interface names (`ILiveKitRoomQuery`, `IUserIdMapper`) and broadcast verification syntax may need adjustment based on what exists in the codebase. The key logic to test is: if the tracker has a share for a user who isn't actually in the LiveKit room, remove it and broadcast stopped.

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~ReconciliationTests" -v n`

Expected: Compilation error — types don't exist yet

- [ ] **Step 3: Implement the reconciliation service**

Create `src/Brmble.Server/LiveKit/ScreenShareReconciliationService.cs`:

```csharp
using Brmble.Server.Events;

namespace Brmble.Server.LiveKit;

public interface ILiveKitRoomQuery
{
    Task<IReadOnlyList<string>> ListParticipantIdentities(string roomName);
}

public interface IUserIdMapper
{
    string? GetMatrixUserId(long userId);
}

public class ScreenShareReconciliationService : BackgroundService
{
    private static readonly TimeSpan ReconciliationInterval = TimeSpan.FromSeconds(30);

    private readonly ScreenShareTracker _tracker;
    private readonly ILiveKitRoomQuery _roomQuery;
    private readonly IUserIdMapper _userIdMapper;
    private readonly IBrmbleEventBus _eventBus;
    private readonly ILogger<ScreenShareReconciliationService> _logger;

    public ScreenShareReconciliationService(
        ScreenShareTracker tracker,
        ILiveKitRoomQuery roomQuery,
        IUserIdMapper userIdMapper,
        IBrmbleEventBus eventBus,
        ILogger<ScreenShareReconciliationService> logger)
    {
        _tracker = tracker;
        _roomQuery = roomQuery;
        _userIdMapper = userIdMapper;
        _eventBus = eventBus;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(ReconciliationInterval, stoppingToken);
                await ReconcileAsync();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Screen share reconciliation failed");
            }
        }
    }

    public async Task ReconcileAsync()
    {
        // Get all rooms with active shares from the tracker
        // We need to get the room names - add a method or iterate
        var allShares = _tracker.GetAllRoomNames();

        foreach (var roomName in allShares)
        {
            try
            {
                var shares = _tracker.GetActiveShares(roomName);
                if (shares.Count == 0) continue;

                var participants = await _roomQuery.ListParticipantIdentities(roomName);
                var participantSet = new HashSet<string>(participants);

                foreach (var share in shares)
                {
                    var matrixId = _userIdMapper.GetMatrixUserId(share.UserId);
                    if (matrixId is null || !participantSet.Contains(matrixId))
                    {
                        _logger.LogInformation("Removing stale share for user {UserId} in room {Room}", share.UserId, roomName);
                        _tracker.StopByUserId(roomName, share.UserId);
                        await _eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName, userId = share.UserId });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not reconcile room {Room} (LiveKit may be unavailable)", roomName);
            }
        }
    }
}
```

Also add to `ScreenShareTracker`:
```csharp
public IReadOnlyList<string> GetAllRoomNames() => _rooms.Keys.ToList();
```

- [ ] **Step 4: Implement ILiveKitRoomQuery on LiveKitService**

Add the interface to `LiveKitService` and implement `ListParticipantIdentities` using `RoomServiceClient.ListParticipants`.

- [ ] **Step 5: Register the reconciliation service in LiveKitExtensions**

In `LiveKitExtensions.cs`, add:
```csharp
services.AddHostedService<ScreenShareReconciliationService>();
```

- [ ] **Step 6: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Server/LiveKit/ tests/Brmble.Server.Tests/LiveKit/
git commit -m "feat: add periodic ghost share reconciliation service"
```

---

### Task 9: Final integration verification

- [ ] **Step 1: Run all server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`

Expected: All tests pass

- [ ] **Step 2: Run all frontend tests**

Run from `src/Brmble.Web`: `npx vitest run`

Expected: All tests pass

- [ ] **Step 3: Build the full solution**

Run: `dotnet build`

Expected: Build succeeds

- [ ] **Step 4: Build frontend**

Run from `src/Brmble.Web`: `npx vite build`

Expected: Build succeeds

- [ ] **Step 5: Commit any remaining changes and tag**

```bash
git add -A
git status
# If there are remaining changes:
git commit -m "chore: final integration fixes for multi-share foundation"
```
