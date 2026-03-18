# LiveKit Screen Share Viewer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to receive and view screen shares from other users in the same voice channel, with a split-panel video viewer above the chat area.

**Architecture:** Server tracks active shares in memory and broadcasts start/stop events via WebSocket. C# bridge forwards these events to the JS frontend. Viewers connect to the LiveKit room on-demand when a share starts, subscribe to the remote video track, and render it in a resizable split panel above the chat. A small screen-share icon appears next to the sharer's name in the channel tree.

**Tech Stack:** C# / ASP.NET Core (server endpoints, DI), C# bridge (MumbleAdapter WebSocket handler), React + TypeScript (hooks, components), livekit-client SDK, CSS custom properties

---

## Task 1: Token Grant — Enable Subscribe

Change the LiveKit token to allow both publishing and subscribing.

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs:43`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

**Step 1: Update the test to verify subscribe grants**

Add a test that decodes the JWT payload and asserts `CanSubscribe` is true.

```csharp
[TestMethod]
public async Task GenerateToken_GrantsIncludeSubscribe()
{
    _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
        .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

    var token = await _svc.GenerateToken("cert123", "room-1");
    Assert.IsNotNull(token);

    // Decode JWT payload (base64url)
    var parts = token.Split('.');
    var payload = parts[1];
    // Pad to multiple of 4
    payload = payload.Replace('-', '+').Replace('_', '/');
    switch (payload.Length % 4)
    {
        case 2: payload += "=="; break;
        case 3: payload += "="; break;
    }
    var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(payload));
    var doc = System.Text.Json.JsonDocument.Parse(json);
    var video = doc.RootElement.GetProperty("video");
    Assert.IsTrue(video.GetProperty("canSubscribe").GetBoolean());
    Assert.IsTrue(video.GetProperty("canPublish").GetBoolean());
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GenerateToken_GrantsIncludeSubscribe" -v n`
Expected: FAIL — `canSubscribe` is `false`

**Step 3: Change CanSubscribe to true**

In `src/Brmble.Server/LiveKit/LiveKitService.cs:43`, change:
```csharp
CanSubscribe = false
```
to:
```csharp
CanSubscribe = true
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "LiveKitServiceTests" -v n`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitService.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs
git commit -m "feat: enable CanSubscribe in LiveKit token grants"
```

---

## Task 2: ScreenShareTracker Service

Create a singleton in-memory service that tracks which rooms have active screen shares.

**Files:**
- Create: `src/Brmble.Server/LiveKit/ScreenShareTracker.cs`
- Create: `tests/Brmble.Server.Tests/LiveKit/ScreenShareTrackerTests.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs:9`

**Step 1: Write the tests**

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
    public void GetActive_NoShare_ReturnsNull()
    {
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void Start_ThenGetActive_ReturnsInfo()
    {
        _tracker.Start("channel-1", "maui", "@2:noscope.it");
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("maui", info.UserName);
        Assert.AreEqual("@2:noscope.it", info.MatrixUserId);
    }

    [TestMethod]
    public void Stop_RemovesShare()
    {
        _tracker.Start("channel-1", "maui", "@2:noscope.it");
        _tracker.Stop("channel-1");
        Assert.IsNull(_tracker.GetActive("channel-1"));
    }

    [TestMethod]
    public void Start_OverwritesPrevious()
    {
        _tracker.Start("channel-1", "alice", "@alice:x");
        _tracker.Start("channel-1", "bob", "@bob:x");
        var info = _tracker.GetActive("channel-1");
        Assert.IsNotNull(info);
        Assert.AreEqual("bob", info.UserName);
    }

    [TestMethod]
    public void Stop_NonExistent_DoesNotThrow()
    {
        _tracker.Stop("no-such-room");
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ScreenShareTrackerTests" -v n`
Expected: FAIL — class doesn't exist

**Step 3: Implement ScreenShareTracker**

Create `src/Brmble.Server/LiveKit/ScreenShareTracker.cs`:

```csharp
using System.Collections.Concurrent;

namespace Brmble.Server.LiveKit;

public class ScreenShareTracker
{
    private readonly ConcurrentDictionary<string, ScreenShareInfo> _shares = new();

    public void Start(string roomName, string userName, string matrixUserId)
        => _shares[roomName] = new ScreenShareInfo(userName, matrixUserId);

    public void Stop(string roomName)
        => _shares.TryRemove(roomName, out _);

    public ScreenShareInfo? GetActive(string roomName)
        => _shares.TryGetValue(roomName, out var info) ? info : null;
}

public record ScreenShareInfo(string UserName, string MatrixUserId);
```

**Step 4: Register in DI**

In `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`, add after line 9:

```csharp
services.AddSingleton<ScreenShareTracker>();
```

**Step 5: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ScreenShareTrackerTests" -v n`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/Brmble.Server/LiveKit/ScreenShareTracker.cs src/Brmble.Server/LiveKit/LiveKitExtensions.cs tests/Brmble.Server.Tests/LiveKit/ScreenShareTrackerTests.cs
git commit -m "feat: add ScreenShareTracker singleton service"
```

---

## Task 3: Screen Share Endpoints

Add three endpoints: `POST /livekit/share-started`, `POST /livekit/share-stopped`, `GET /livekit/active-share`.

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Create: `tests/Brmble.Server.Tests/Integration/ScreenShareEndpointTests.cs`

**Step 1: Write integration tests**

Use the existing `BrmbleServerFactory` pattern. Tests need a registered user in the DB first.

```csharp
using System.Net;
using System.Net.Http.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class ScreenShareEndpointTests
{
    [TestMethod]
    public async Task ShareStarted_ThenActiveShare_ReturnsShareInfo()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();

        // Register a user first
        await client.PostAsJsonAsync("/auth/register", new { username = "maui", password = "test" });

        // Start share
        var startResp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        Assert.AreEqual(HttpStatusCode.OK, startResp.StatusCode);

        // Check active share
        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.OK, activeResp.StatusCode);
        var body = await activeResp.Content.ReadFromJsonAsync<ActiveShareResponse>();
        Assert.AreEqual("maui", body?.UserName);
    }

    [TestMethod]
    public async Task ShareStopped_ThenActiveShare_Returns404()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/register", new { username = "maui", password = "test" });

        await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-4" });
        await client.PostAsJsonAsync("/livekit/share-stopped", new { roomName = "channel-4" });

        var activeResp = await client.GetAsync("/livekit/active-share?roomName=channel-4");
        Assert.AreEqual(HttpStatusCode.NotFound, activeResp.StatusCode);
    }

    [TestMethod]
    public async Task ActiveShare_NoShare_Returns404()
    {
        await using var factory = new BrmbleServerFactory();
        var client = factory.CreateClient();
        await client.PostAsJsonAsync("/auth/register", new { username = "maui", password = "test" });

        var resp = await client.GetAsync("/livekit/active-share?roomName=channel-99");
        Assert.AreEqual(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [TestMethod]
    public async Task ShareStarted_NoCert_Returns401()
    {
        await using var factory = new BrmbleServerFactory(certHash: null);
        var client = factory.CreateClient();

        var resp = await client.PostAsJsonAsync("/livekit/share-started", new { roomName = "channel-1" });
        Assert.AreEqual(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    private record ActiveShareResponse(string UserName, string MatrixUserId);
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ScreenShareEndpointTests" -v n`
Expected: FAIL — endpoints don't exist (404)

**Step 3: Implement the endpoints**

Add to `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` inside `MapLiveKitEndpoints`, after the existing `/livekit/token` endpoint (after line 44):

```csharp
app.MapPost("/livekit/share-started", async (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    UserRepository userRepo,
    ScreenShareTracker tracker,
    IBrmbleEventBus eventBus) =>
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
    catch { }

    if (string.IsNullOrWhiteSpace(roomName))
        return Results.BadRequest(new { error = "roomName is required" });

    tracker.Start(roomName, user.DisplayName, user.MatrixUserId);
    await eventBus.BroadcastAsync(new
    {
        type = "screenShare.started",
        roomName,
        userName = user.DisplayName,
        matrixUserId = user.MatrixUserId
    });
    return Results.Ok();
});

app.MapPost("/livekit/share-stopped", async (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    UserRepository userRepo,
    ScreenShareTracker tracker,
    IBrmbleEventBus eventBus) =>
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
    catch { }

    if (string.IsNullOrWhiteSpace(roomName))
        return Results.BadRequest(new { error = "roomName is required" });

    tracker.Stop(roomName);
    await eventBus.BroadcastAsync(new { type = "screenShare.stopped", roomName });
    return Results.Ok();
});

app.MapGet("/livekit/active-share", (
    HttpContext httpContext,
    ScreenShareTracker tracker) =>
{
    var roomName = httpContext.Request.Query["roomName"].ToString();
    if (string.IsNullOrWhiteSpace(roomName))
        return Results.BadRequest(new { error = "roomName query parameter is required" });

    var info = tracker.GetActive(roomName);
    return info is not null
        ? Results.Ok(new { info.UserName, info.MatrixUserId })
        : Results.NotFound();
});
```

Add required usings at top of `LiveKitEndpoints.cs`:
```csharp
using Brmble.Server.Auth;
using Brmble.Server.Events;
```

**Step 4: Run tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ScreenShareEndpointTests" -v n`
Expected: ALL PASS

**Step 5: Also run all existing tests to check for regressions**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj -v n`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/Integration/ScreenShareEndpointTests.cs
git commit -m "feat: add screen share started/stopped/active-share endpoints"
```

---

## Task 4: C# Bridge — Forward Screen Share Events + New Outgoing Messages

Extend `MumbleAdapter.HandleWebSocketMessage` to forward `screenShare.started` and `screenShare.stopped` events from the server's WebSocket to the JS bridge. Also add bridge handlers for `livekit.shareStarted`, `livekit.shareStopped`, and `livekit.checkActiveShare` (JS → C#).

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add screen share WebSocket message handling**

In `HandleWebSocketMessage` (line 1121), add two new cases to the `switch (type)` block after the `"userMappingRemoved"` case (line 1171):

```csharp
case "screenShare.started":
    var startRoom = root.TryGetProperty("roomName", out var startRoomProp) ? startRoomProp.GetString() : null;
    var startUser = root.TryGetProperty("userName", out var startUserProp) ? startUserProp.GetString() : null;
    if (startRoom is not null)
    {
        _bridge?.Send("livekit.screenShareStarted", new { roomName = startRoom, userName = startUser });
        _bridge?.NotifyUiThread();
    }
    break;

case "screenShare.stopped":
    var stopRoom = root.TryGetProperty("roomName", out var stopRoomProp) ? stopRoomProp.GetString() : null;
    if (stopRoom is not null)
    {
        _bridge?.Send("livekit.screenShareStopped", new { roomName = stopRoom });
        _bridge?.NotifyUiThread();
    }
    break;
```

**Step 2: Add bridge handlers for JS → C# messages**

In the `RegisterBridgeHandlers` method, after the existing `livekit.requestToken` handler (line 1448), add:

```csharp
bridge.RegisterHandler("livekit.shareStarted", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null) return;

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, "livekit/share-started");
        await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[LiveKit] Failed to notify share-started: {ex.Message}");
    }
});

bridge.RegisterHandler("livekit.shareStopped", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null) return;

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null) return;

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, "livekit/share-stopped");
        await PostViaBcTls(cert, uri, System.Text.Json.JsonSerializer.Serialize(new { roomName }));
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[LiveKit] Failed to notify share-stopped: {ex.Message}");
    }
});

bridge.RegisterHandler("livekit.checkActiveShare", async data =>
{
    var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
    if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
        return;
    }

    using var cert = _certService?.GetExportableCertificate();
    if (cert is null)
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
        return;
    }

    try
    {
        var baseUri = new Uri(_apiUrl, UriKind.Absolute);
        var uri = new Uri(baseUri, $"livekit/active-share?roomName={Uri.EscapeDataString(roomName)}");
        var result = await GetViaBcTls(cert, uri);
        if (result is not null)
        {
            using var doc = System.Text.Json.JsonDocument.Parse(result);
            var userName = doc.RootElement.TryGetProperty("userName", out var un) ? un.GetString() : null;
            _bridge?.Send("livekit.activeShareResult", new { roomName, active = true, userName });
        }
        else
        {
            _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        }
        _bridge?.NotifyUiThread();
    }
    catch
    {
        _bridge?.Send("livekit.activeShareResult", new { roomName, active = false });
        _bridge?.NotifyUiThread();
    }
});
```

**Note:** The `livekit.checkActiveShare` handler uses `GetViaBcTls`. If this method doesn't exist yet, you'll need to add a GET variant of `PostViaBcTls`. Check if one exists first — if not, create a minimal `GetViaBcTls(X509Certificate2 cert, Uri uri)` method following the same TLS/BouncyCastle pattern as `PostViaBcTls` but with a GET request.

**Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: bridge handlers for screen share events (WS + JS)"
```

---

## Task 5: Extend useScreenShare Hook — Viewer Logic

Add viewer state and logic to the existing `useScreenShare` hook: listen for screen share events, connect as viewer, capture remote track.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`

**Step 1: Rewrite the hook to support both publishing and viewing**

Replace the contents of `src/Brmble.Web/src/hooks/useScreenShare.ts`:

```typescript
import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from 'livekit-client';
import bridge from '../bridge';

export interface ActiveShare {
  roomName: string;
  userName: string;
}

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShare, setActiveShare] = useState<ActiveShare | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);
  const publishRoomRef = useRef<Room | null>(null);
  const viewerRoomRef = useRef<Room | null>(null);

  // --- Publisher logic (unchanged from Phase 1) ---

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);

    if (publishRoomRef.current) {
      try { await publishRoomRef.current.disconnect(); } catch { /* ignore */ }
      publishRoomRef.current = null;
    }

    try {
      const { token, url } = await new Promise<{ token: string; url: string }>((resolve, reject) => {
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
        }, 15000);
        bridge.on('livekit.token', onToken);
        bridge.on('livekit.tokenError', onError);
        bridge.send('livekit.requestToken', { roomName });
      });

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        publishRoomRef.current = null;
      });

      await room.connect(url, token);
      await room.localParticipant.setScreenShareEnabled(true);

      publishRoomRef.current = room;
      setIsSharing(true);

      // Notify server that sharing has started
      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, []);

  const stopSharing = useCallback(async () => {
    const room = publishRoomRef.current;
    if (room) {
      // Notify server before disconnecting
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

  const connectAsViewer = useCallback(async (roomName: string) => {
    // Disconnect any existing viewer room
    if (viewerRoomRef.current) {
      try { await viewerRoomRef.current.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }

    try {
      const { token, url } = await new Promise<{ token: string; url: string }>((resolve, reject) => {
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
        }, 15000);
        bridge.on('livekit.token', onToken);
        bridge.on('livekit.tokenError', onError);
        bridge.send('livekit.requestToken', { roomName });
      });

      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, (track, _pub, _participant) => {
        if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
          const el = track.attach();
          setRemoteVideoEl(el);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
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

      // Check if there's already a published screen share track
      room.remoteParticipants.forEach((participant: RemoteParticipant) => {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach();
            setRemoteVideoEl(el);
          }
        });
      });
    } catch (err) {
      console.error('Failed to connect as viewer:', err);
    }
  }, []);

  const disconnectViewer = useCallback(async () => {
    const room = viewerRoomRef.current;
    if (room) {
      try { await room.disconnect(); } catch { /* ignore */ }
      viewerRoomRef.current = null;
    }
    setRemoteVideoEl(null);
    setActiveShare(null);
  }, []);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string };
      setActiveShare({ roomName: d.roomName, userName: d.userName });
      // Don't connect if we are the sharer
      if (!publishRoomRef.current) {
        connectAsViewer(d.roomName);
      }
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string };
      setActiveShare(prev => {
        if (prev?.roomName === d.roomName) {
          // Disconnect viewer for this room
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
      const d = data as { roomName: string; active: boolean; userName?: string };
      if (d.active && d.userName) {
        setActiveShare({ roomName: d.roomName, userName: d.userName });
        if (!publishRoomRef.current) {
          connectAsViewer(d.roomName);
        }
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
  }, [connectAsViewer]);

  return {
    isSharing,
    startSharing,
    stopSharing,
    error,
    activeShare,
    remoteVideoEl,
    disconnectViewer,
  };
}
```

**Step 2: Build to verify compilation**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded (there will be unused-export warnings in App.tsx for `activeShare`/`remoteVideoEl` until Task 7 wires them)

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts
git commit -m "feat: extend useScreenShare hook with viewer logic"
```

---

## Task 6: ScreenShareViewer Component

Create the video viewer component that displays the remote screen share track.

**Files:**
- Create: `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx`
- Create: `src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.css`

**Step 1: Create the component**

`src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx`:

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import './ScreenShareViewer.css';

interface ScreenShareViewerProps {
  videoEl: HTMLVideoElement;
  sharerName: string;
  onClose: () => void;
}

export function ScreenShareViewer({ videoEl, sharerName, onClose }: ScreenShareViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    videoEl.className = 'screen-share-video';
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    container.appendChild(videoEl);

    return () => {
      if (container.contains(videoEl)) {
        container.removeChild(videoEl);
      }
    };
  }, [videoEl]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), 2000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowControls(false);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  return (
    <div
      className={`screen-share-viewer ${showControls ? 'show-controls' : ''}`}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className="screen-share-overlay screen-share-overlay--name">
        {sharerName}'s screen
      </div>
      <div className="screen-share-overlay screen-share-overlay--controls">
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>
        <button
          className="btn btn-ghost btn-icon screen-share-control-btn"
          onClick={onClose}
          title="Close viewer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Create the CSS**

`src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.css`:

```css
.screen-share-viewer {
  position: relative;
  background: var(--bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
}

.screen-share-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.screen-share-overlay {
  position: absolute;
  z-index: 2;
  opacity: 0;
  transition: opacity var(--transition-normal);
  pointer-events: none;
}

.screen-share-viewer.show-controls .screen-share-overlay {
  opacity: 1;
}

.screen-share-overlay--name {
  bottom: var(--space-sm);
  left: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  background: rgba(0, 0, 0, 0.6);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: #fff;
}

.screen-share-overlay--controls {
  top: var(--space-sm);
  right: var(--space-sm);
  display: flex;
  gap: var(--space-xs);
  pointer-events: auto;
}

.screen-share-control-btn {
  background: rgba(0, 0, 0, 0.6) !important;
  color: #fff !important;
  border-radius: var(--radius-sm) !important;
  width: 32px;
  height: 32px;
}

.screen-share-control-btn:hover {
  background: rgba(0, 0, 0, 0.8) !important;
}
```

**Step 3: Build to verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.tsx src/Brmble.Web/src/components/ScreenShareViewer/ScreenShareViewer.css
git commit -m "feat: add ScreenShareViewer component"
```

---

## Task 7: ChatPanel Split Layout

Add the resizable split layout to ChatPanel — video on top, messages on bottom, with a draggable divider.

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`

**Step 1: Update ChatPanel props and layout**

Add new props to `ChatPanelProps` (line 10):
```typescript
screenShareVideoEl?: HTMLVideoElement | null;
screenSharerName?: string;
onCloseScreenShare?: () => void;
```

Add the import at the top:
```typescript
import { ScreenShareViewer } from '../ScreenShareViewer/ScreenShareViewer';
```

Add split-panel state and drag logic inside the `ChatPanel` function, before the `handleScroll` callback (line 27). Add:

```typescript
const SPLIT_STORAGE_KEY = 'brmble-screenshare-split';
const DEFAULT_SPLIT = 50;

const [splitPercent, setSplitPercent] = useState(() => {
  const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
  return stored ? Number(stored) : DEFAULT_SPLIT;
});
const isDraggingRef = useRef(false);

const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  isDraggingRef.current = true;

  const onMouseMove = (moveEvent: MouseEvent) => {
    const panel = document.querySelector('.chat-panel') as HTMLElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const y = moveEvent.clientY - rect.top;
    const pct = Math.min(80, Math.max(20, (y / rect.height) * 100));
    setSplitPercent(pct);
  };

  const onMouseUp = () => {
    isDraggingRef.current = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    setSplitPercent(prev => {
      localStorage.setItem(SPLIT_STORAGE_KEY, String(prev));
      return prev;
    });
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}, []);

const hasScreenShare = !!screenShareVideoEl && !!screenSharerName && !!onCloseScreenShare;
```

Then modify the JSX `return` of the main (non-empty) path (starting at line 104). Replace the inner content between `<div className="chat-panel">` and the closing `</div>`:

```tsx
return (
  <div className="chat-panel">
    <div className="chat-header">
      {/* ... existing header content unchanged ... */}
    </div>

    {hasScreenShare && (
      <>
        <div className="chat-split-video" style={{ height: `${splitPercent}%` }}>
          <ScreenShareViewer
            videoEl={screenShareVideoEl}
            sharerName={screenSharerName}
            onClose={onCloseScreenShare}
          />
        </div>
        <div
          className="chat-split-divider"
          onMouseDown={handleDividerMouseDown}
        />
      </>
    )}

    <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}
      style={hasScreenShare ? { flex: 'none', height: `calc(${100 - splitPercent}% - 4px)` } : undefined}
    >
      {/* ... existing messages content unchanged ... */}
    </div>

    <div className="chat-input-area">
      {/* ... existing input area content unchanged ... */}
    </div>
  </div>
);
```

**Important:** Keep all existing JSX inside the header, messages, and input-area unchanged. Only add the screen share viewer + divider between the header and messages, and add the conditional inline style on `.chat-messages`.

**Step 2: Add CSS for the split layout**

Append to `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`:

```css
/* Screen share split layout */
.chat-split-video {
  flex: none;
  min-height: 100px;
  overflow: hidden;
}

.chat-split-divider {
  flex: none;
  height: 4px;
  background: var(--border-subtle);
  cursor: row-resize;
  transition: background var(--transition-fast);
}

.chat-split-divider:hover,
.chat-split-divider:active {
  background: var(--accent-primary);
}
```

**Step 3: Build to verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.css
git commit -m "feat: add resizable split layout for screen share viewer in ChatPanel"
```

---

## Task 8: App.tsx Wiring

Wire up the `useScreenShare` viewer exports to ChatPanel, and trigger `checkActiveShare` on channel changes.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Update the useScreenShare destructuring**

At line 1001, change:
```typescript
const { isSharing, startSharing, stopSharing, error: screenShareError } = useScreenShare();
```
to:
```typescript
const { isSharing, startSharing, stopSharing, error: screenShareError, activeShare, remoteVideoEl, disconnectViewer } = useScreenShare();
```

**Step 2: Add channel change effect for active share check**

After line 1005 (the screenShareError useEffect), add:

```typescript
// Check for active screen shares when switching channels
useEffect(() => {
  if (currentChannelId && currentChannelId !== 'server-root') {
    bridge.send('livekit.checkActiveShare', { roomName: `channel-${currentChannelId}` });
  }
}, [currentChannelId]);
```

**Step 3: Pass screen share props to ChatPanel**

In the channel ChatPanel JSX (around line 1067), add the new props:

```tsx
<ChatPanel
  channelId={currentChannelId || undefined}
  channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
  messages={isMatrixActive ? (matrixMessages ?? []) : messages}
  currentUsername={username}
  onSendMessage={handleSendMessage}
  matrixClient={matrixClient.client}
  screenShareVideoEl={remoteVideoEl}
  screenSharerName={activeShare?.userName}
  onCloseScreenShare={disconnectViewer}
/>
```

**Step 4: Update handleToggleScreenShare to also notify server**

The `stopSharing` callback now handles server notification internally (from Task 5), so `handleToggleScreenShare` stays unchanged. But verify the `startSharing` call passes the correct room name format — it should already be `channel-${currentChannelId}`.

**Step 5: Build to verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire screen share viewer into App.tsx"
```

---

## Task 9: Screen Share Icon in Channel Tree

Add a small monitor icon next to the sharer's name in the channel tree user list.

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`
- Modify: `src/Brmble.Web/src/App.tsx` (pass activeShare prop)
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` (pass through)

**Step 1: Add `screenSharerName` prop to ChannelTree**

In `ChannelTreeProps` (line 31), add:
```typescript
screenSharerName?: string;
```

Update the destructuring on line 42 to include `screenSharerName`.

**Step 2: Add the icon in user rows**

In the user row rendering (around line 221, after `<span className="user-name">{user.name}</span>`), add:

```tsx
{screenSharerName && user.name === screenSharerName && (
  <svg className="status-icon status-icon--screen-share" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
)}
```

**Step 3: Add CSS for the icon**

Append to `src/Brmble.Web/src/components/Sidebar/ChannelTree.css`:

```css
.status-icon--screen-share {
  color: var(--accent-secondary);
  margin-left: var(--space-xs);
  flex-shrink: 0;
}
```

**Step 4: Pass the prop through Sidebar**

Check `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` — add `screenSharerName?: string` to `SidebarProps` and pass it through to `<ChannelTree ... screenSharerName={screenSharerName} />`.

In `src/Brmble.Web/src/App.tsx`, update the `<Sidebar>` JSX (around line 1042) to pass:
```tsx
screenSharerName={activeShare?.userName}
```

**Step 5: Build to verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx src/Brmble.Web/src/components/Sidebar/ChannelTree.css src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: add screen share icon next to sharer's name in channel tree"
```

---

## Task 10: Full Build & Manual Test

**Step 1: Run all backend tests**

Run: `dotnet test -v n`
Expected: ALL PASS

**Step 2: Build the frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeded with no errors

**Step 3: Build the client**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Rebuild Docker**

Run: `wsl docker compose -f docker-local/docker-compose.yml up -d --build brmble`
Expected: Container starts cleanly

**Step 5: Manual testing checklist**

1. Start the client in production mode (`dotnet run --project src/Brmble.Client`)
2. Connect to server
3. Open a second client (or use a different machine/user)
4. User A starts screen sharing — verify:
   - Stream publishes
   - Monitor icon appears next to User A's name in channel tree
5. User B (viewer) — verify:
   - Video appears in split panel above chat
   - Sharer's name overlay visible on hover
   - Fullscreen toggle works
   - Draggable divider resizes the split
   - Closing the viewer disconnects
6. User A stops sharing — verify:
   - Viewer panel disappears for User B
   - Monitor icon disappears from channel tree
7. Late join: User A starts sharing, User C joins the channel — verify User C sees the share

**Step 6: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
