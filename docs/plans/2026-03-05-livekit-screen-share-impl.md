# LiveKit Screen Share (Publish-Only) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to publish their screen to a LiveKit room from the voice controls bar.

**Architecture:** Backend generates LiveKit access tokens via the official .NET SDK, served from `POST /livekit/token`. LiveKit signaling is proxied through YARP (already configured). Frontend uses `livekit-client` SDK to connect and publish screen share tracks from WebView2.

**Tech Stack:** Livekit.Server.Sdk.Dotnet (NuGet), livekit-client (npm), MSTest + Moq (tests), Vitest (frontend tests)

**Design doc:** `docs/plans/2026-03-05-livekit-screen-share-design.md`

---

### Task 1: Add LiveKit NuGet Package

**Files:**
- Modify: `src/Brmble.Server/Brmble.Server.csproj`

**Step 1: Add the package**

Run: `dotnet add src/Brmble.Server/Brmble.Server.csproj package Livekit.Server.Sdk.Dotnet`

Expected: Package added to .csproj

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`

Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Server/Brmble.Server.csproj
git commit -m "feat: add Livekit.Server.Sdk.Dotnet NuGet package"
```

---

### Task 2: Add LiveKitSettings Configuration

**Files:**
- Create: `src/Brmble.Server/LiveKit/LiveKitSettings.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`

**Step 1: Create the settings class**

Create `src/Brmble.Server/LiveKit/LiveKitSettings.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public class LiveKitSettings
{
    public string ApiKey { get; set; } = "";
    public string ApiSecret { get; set; } = "";
}
```

**Step 2: Wire up settings in LiveKitExtensions**

Replace the contents of `src/Brmble.Server/LiveKit/LiveKitExtensions.cs`:

```csharp
namespace Brmble.Server.LiveKit;

public static class LiveKitExtensions
{
    public static IServiceCollection AddLiveKit(this IServiceCollection services)
    {
        services.AddOptions<LiveKitSettings>()
            .BindConfiguration("LiveKit");
        services.AddSingleton<LiveKitService>();
        return services;
    }
}
```

**Step 3: Verify build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`

Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitSettings.cs src/Brmble.Server/LiveKit/LiveKitExtensions.cs
git commit -m "feat: add LiveKitSettings configuration class"
```

---

### Task 3: Implement LiveKitService Token Generation (TDD)

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

**Step 1: Write the failing tests**

Replace `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`:

```csharp
using Brmble.Server.Auth;
using Brmble.Server.Data;
using Brmble.Server.LiveKit;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using Moq;

namespace Brmble.Server.Tests.LiveKit;

[TestClass]
public class LiveKitServiceTests
{
    private LiveKitService _svc = null!;
    private Mock<UserRepository> _mockUserRepo = null!;

    [TestInitialize]
    public void Setup()
    {
        var settings = Options.Create(new LiveKitSettings
        {
            ApiKey = "test-api-key",
            ApiSecret = "testsecret0123456789abcdef01234567890abcdef01234567890abcdef0123"
        });
        _mockUserRepo = new Mock<UserRepository>(
            new Mock<Database>("Data Source=:memory:").Object);
        _svc = new LiveKitService(settings, _mockUserRepo.Object,
            NullLogger<LiveKitService>.Instance);
    }

    [TestMethod]
    public async Task GenerateToken_KnownUser_ReturnsNonEmptyJwt()
    {
        _mockUserRepo.Setup(r => r.GetByCertHashAsync("cert123"))
            .ReturnsAsync(new User
            {
                Id = 1,
                CertHash = "cert123",
                DisplayName = "TestUser",
                MatrixUserId = "@test:example.com",
                MatrixAccessToken = "tok"
            });

        var token = await _svc.GenerateToken("cert123", "room-1");

        Assert.IsNotNull(token);
        Assert.IsTrue(token.Length > 0);
        // JWT has 3 dot-separated parts
        Assert.AreEqual(3, token.Split('.').Length);
    }

    [TestMethod]
    public async Task GenerateToken_UnknownUser_ReturnsNull()
    {
        _mockUserRepo.Setup(r => r.GetByCertHashAsync("unknown"))
            .ReturnsAsync((User?)null);

        var token = await _svc.GenerateToken("unknown", "room-1");

        Assert.IsNull(token);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~LiveKitServiceTests"`

Expected: FAIL — `LiveKitService` constructor signature doesn't match

**Step 3: Implement LiveKitService**

Replace `src/Brmble.Server/LiveKit/LiveKitService.cs`:

```csharp
using Brmble.Server.Auth;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Brmble.Server.LiveKit;

public class LiveKitService
{
    private readonly LiveKitSettings _settings;
    private readonly UserRepository _userRepo;
    private readonly ILogger<LiveKitService> _logger;

    public LiveKitService(
        IOptions<LiveKitSettings> settings,
        UserRepository userRepo,
        ILogger<LiveKitService> logger)
    {
        _settings = settings.Value;
        _userRepo = userRepo;
        _logger = logger;
    }

    public async Task<string?> GenerateToken(string certHash, string roomName)
    {
        var user = await _userRepo.GetByCertHashAsync(certHash);
        if (user is null)
        {
            _logger.LogWarning("Token request for unknown cert hash: {CertHash}", certHash);
            return null;
        }

        var token = new AccessToken(_settings.ApiKey, _settings.ApiSecret)
            .WithIdentity(user.MatrixUserId)
            .WithName(user.DisplayName)
            .WithGrants(new VideoGrants
            {
                RoomJoin = true,
                Room = roomName,
                CanPublish = true,
                CanSubscribe = false
            })
            .WithTtl(TimeSpan.FromHours(6));

        return token.ToJwt();
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~LiveKitServiceTests"`

Expected: 2 tests passed

**Note:** The `UserRepository` must have a virtual `GetByCertHashAsync` method for Moq to work. If it doesn't, check the existing `UserRepository` class. If needed, extract an interface or make the method virtual.

**Step 5: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitService.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs
git commit -m "feat: implement LiveKitService token generation with tests"
```

---

### Task 4: Implement LiveKit Token Endpoint (TDD)

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Create: `tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs`

**Step 1: Write the failing integration tests**

Create `tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs`:

```csharp
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Server.Tests.Integration;

[TestClass]
public class LiveKitTokenTests : IDisposable
{
    private readonly BrmbleServerFactory _factory;
    private readonly HttpClient _client;

    public LiveKitTokenTests()
    {
        _factory = new BrmbleServerFactory(certHash: "testcerthash123");
        _client = _factory.CreateClient();
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [TestMethod]
    public async Task PostLiveKitToken_NoCert_ReturnsUnauthorized()
    {
        using var factory = new BrmbleServerFactory(certHash: null);
        using var client = factory.CreateClient();

        var body = new StringContent(
            JsonSerializer.Serialize(new { roomName = "room-1" }),
            Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/livekit/token", body);
        Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [TestMethod]
    public async Task PostLiveKitToken_ValidCert_ReturnsTokenAndUrl()
    {
        // First authenticate to create the user record
        await _client.PostAsync("/auth/token", null);

        var body = new StringContent(
            JsonSerializer.Serialize(new { roomName = "room-1" }),
            Encoding.UTF8, "application/json");

        var response = await _client.PostAsync("/livekit/token", body);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.IsTrue(doc.RootElement.TryGetProperty("token", out var tokenProp));
        Assert.IsTrue(tokenProp.GetString()!.Split('.').Length == 3, "Should be a JWT");
        Assert.IsTrue(doc.RootElement.TryGetProperty("url", out _));
    }

    [TestMethod]
    public async Task PostLiveKitToken_NoRoomName_ReturnsBadRequest()
    {
        var body = new StringContent("{}", Encoding.UTF8, "application/json");
        var response = await _client.PostAsync("/livekit/token", body);
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
```

**Step 2: Update BrmbleServerFactory to include LiveKit config**

Add LiveKit test config to the `AddInMemoryCollection` call in `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs`. Add these entries alongside the existing ones:

```csharp
["LiveKit:ApiKey"] = "test-api-key",
["LiveKit:ApiSecret"] = "testsecret0123456789abcdef01234567890abcdef01234567890abcdef0123",
```

**Step 3: Run tests to verify they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~LiveKitTokenTests"`

Expected: FAIL — endpoint returns 404 (not implemented yet)

**Step 4: Implement the endpoint**

Replace `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`:

```csharp
using System.Text.Json;
using Brmble.Server.Auth;

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
            catch { /* invalid JSON */ }

            if (string.IsNullOrWhiteSpace(roomName))
                return Results.BadRequest(new { error = "roomName is required" });

            var token = await liveKitService.GenerateToken(certHash, roomName);
            if (token is null)
                return Results.Unauthorized();

            // Build the LiveKit WebSocket URL relative to the request origin.
            // LiveKit is proxied through YARP at /livekit/, so the client connects
            // to the same host using the /livekit path prefix.
            var request = httpContext.Request;
            var wsScheme = request.Scheme == "https" ? "wss" : "ws";
            var url = $"{wsScheme}://{request.Host}/livekit";

            return Results.Ok(new { token, url });
        });

        return app;
    }
}
```

**Step 5: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "FullyQualifiedName~LiveKitTokenTests"`

Expected: 3 tests passed

**Step 6: Run all backend tests to check for regressions**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: All tests pass

**Step 7: Commit**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs
git commit -m "feat: implement POST /livekit/token endpoint with integration tests"
```

---

### Task 5: Add YARP Path Transform for LiveKit

**Files:**
- Modify: `src/Brmble.Server/appsettings.json`

The existing YARP config routes `/livekit/{**catch-all}` → `http://localhost:7880`. But YARP preserves the full path by default, meaning `/livekit/rtc` would forward as `http://localhost:7880/livekit/rtc`. LiveKit expects just `/rtc`. We need a `PathRemovePrefix` transform.

**Step 1: Add the transform**

In `src/Brmble.Server/appsettings.json`, update the `livekit` route to include a transform. Change:

```json
"livekit": {
    "ClusterId": "livekit",
    "Match": {
        "Path": "/livekit/{**catch-all}"
    }
}
```

To:

```json
"livekit": {
    "ClusterId": "livekit",
    "Match": {
        "Path": "/livekit/{**catch-all}"
    },
    "Transforms": [
        { "PathRemovePrefix": "/livekit" }
    ]
}
```

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`

Expected: Build succeeded

**Step 3: Run all tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: All tests pass

**Step 4: Commit**

```bash
git add src/Brmble.Server/appsettings.json
git commit -m "fix: add YARP PathRemovePrefix transform for LiveKit route"
```

---

### Task 6: Export LiveKit Config in Docker Entrypoint

**Files:**
- Modify: `src/Brmble.Server/docker/entrypoint.sh`

**Step 1: Add env var exports for ASP.NET config binding**

In `src/Brmble.Server/docker/entrypoint.sh`, add these lines after the existing `export LIVEKIT_KEYS=...` line (around line 61):

```bash
# Expose LiveKit credentials to ASP.NET Core via config binding
export LiveKit__ApiKey="$LIVEKIT_API_KEY"
export LiveKit__ApiSecret="$LIVEKIT_API_SECRET"
```

**Step 2: Commit**

```bash
git add src/Brmble.Server/docker/entrypoint.sh
git commit -m "feat: export LiveKit API credentials for ASP.NET config binding"
```

---

### Task 7: Install livekit-client npm Package

**Files:**
- Modify: `src/Brmble.Web/package.json`

**Step 1: Install the package**

Run: `(cd src/Brmble.Web && npm install livekit-client)`

Expected: Package added to dependencies

**Step 2: Verify build**

Run: `(cd src/Brmble.Web && npm run build)`

Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Web/package.json src/Brmble.Web/package-lock.json
git commit -m "feat: add livekit-client npm package"
```

---

### Task 8: Create useScreenShare Hook (TDD)

**Files:**
- Create: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Create: `src/Brmble.Web/src/hooks/__tests__/useScreenShare.test.ts`

**Step 1: Write the failing test**

Create `src/Brmble.Web/src/hooks/__tests__/useScreenShare.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenShare } from '../useScreenShare';

// Mock livekit-client
vi.mock('livekit-client', () => {
  const mockRoom = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    localParticipant: {
      setScreenShareEnabled: vi.fn().mockResolvedValue(undefined),
    },
    on: vi.fn().mockReturnThis(),
  };
  return {
    Room: vi.fn(() => mockRoom),
    RoomEvent: { Disconnected: 'disconnected' },
    __mockRoom: mockRoom,
  };
});

// Mock fetch for token requests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useScreenShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in idle state', () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fetches token and connects on startSharing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'test-jwt', url: 'ws://localhost/livekit' }),
    });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });

    expect(mockFetch).toHaveBeenCalledWith('/livekit/token', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ roomName: 'room-1' }),
    }));
    expect(result.current.isSharing).toBe(true);
  });

  it('sets error on token fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });

    expect(result.current.isSharing).toBe(false);
    expect(result.current.error).toBeTruthy();
  });

  it('disconnects on stopSharing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'test-jwt', url: 'ws://localhost/livekit' }),
    });

    const { result } = renderHook(() => useScreenShare());
    await act(async () => {
      await result.current.startSharing('room-1');
    });
    await act(async () => {
      await result.current.stopSharing();
    });

    expect(result.current.isSharing).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/__tests__/useScreenShare.test.ts)`

Expected: FAIL — module not found

**Step 3: Implement the hook**

Create `src/Brmble.Web/src/hooks/useScreenShare.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';

export function useScreenShare() {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);
    try {
      const res = await fetch('/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName }),
      });

      if (!res.ok) {
        setError(`Token request failed: ${res.status}`);
        return;
      }

      const { token, url } = await res.json();

      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        setIsSharing(false);
        roomRef.current = null;
      });

      await room.connect(url, token);
      await room.localParticipant.setScreenShareEnabled(true);

      roomRef.current = room;
      setIsSharing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Screen share failed');
      setIsSharing(false);
    }
  }, []);

  const stopSharing = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch { /* already stopped */ }
      await room.disconnect();
      roomRef.current = null;
    }
    setIsSharing(false);
  }, []);

  return { isSharing, startSharing, stopSharing, error };
}
```

**Step 4: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/__tests__/useScreenShare.test.ts)`

Expected: 4 tests passed

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/__tests__/useScreenShare.test.ts
git commit -m "feat: add useScreenShare hook with token fetch and room connection"
```

---

### Task 9: Add Screen Share Button to UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Add props and button to UserPanel.tsx**

Add new props to `UserPanelProps`:

```typescript
screenSharing?: boolean;
onToggleScreenShare?: () => void;
```

Add a new button between the mute button and the DM button (after the mute button's closing `)}`, before the DM button). Use the same press/release pattern as other buttons:

```tsx
{onToggleScreenShare && (
  <button
    className={`btn btn-ghost btn-icon user-panel-btn screen-share-btn ${screenSharing ? 'active' : ''} ${activeBtn === 'screen' ? 'pressed' : ''} ${leftVoice ? 'disabled' : ''}`}
    onMouseDown={handleMouseDown('screen')}
    onMouseUp={handleMouseUp('screen', onToggleScreenShare)}
    onMouseLeave={handleMouseLeave}
    onKeyDown={handleKeyDown('screen')}
    onKeyUp={handleKeyUp('screen', onToggleScreenShare)}
    disabled={leftVoice}
    title={screenSharing ? 'Stop Sharing' : 'Share Screen'}
  >
    {screenSharing ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"></line>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    )}
  </button>
)}
```

**Step 2: Add CSS for screen share button**

Add to `src/Brmble.Web/src/components/UserPanel/UserPanel.css` (following the existing button patterns):

```css
.user-panel-btn.screen-share-btn:hover:not(:disabled) {
  color: var(--accent-primary);
}

.user-panel-btn.screen-share-btn.active {
  color: var(--accent-secondary);
  background: var(--accent-secondary-subtle);
}

.user-panel-btn.screen-share-btn.pressed {
  color: var(--accent-secondary);
  background: var(--accent-secondary-subtle);
  transform: scale(0.95);
}
```

**Step 3: Verify build**

Run: `(cd src/Brmble.Web && npm run build)`

Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/UserPanel/UserPanel.tsx src/Brmble.Web/src/components/UserPanel/UserPanel.css
git commit -m "feat: add screen share button to UserPanel voice controls"
```

---

### Task 10: Wire useScreenShare into App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Import and use the hook**

At the top of `App.tsx`, add the import:

```typescript
import { useScreenShare } from './hooks/useScreenShare';
```

Inside the App component, add the hook call near the other hook calls:

```typescript
const { isSharing, startSharing, stopSharing, error: screenShareError } = useScreenShare();
```

**Step 2: Create the toggle handler**

Add a handler that derives the room name from the current channel. The room name should match the pattern used for channel-to-room mapping (e.g., `channel-{channelId}`). Look at how the current channel ID is tracked in App.tsx state and use it:

```typescript
const handleToggleScreenShare = useCallback(() => {
  if (isSharing) {
    stopSharing();
  } else if (currentChannelId != null) {
    startSharing(`channel-${currentChannelId}`);
  }
}, [isSharing, currentChannelId, startSharing, stopSharing]);
```

**Step 3: Pass props to UserPanel**

Add the new props to the `<UserPanel>` component where it's rendered:

```tsx
screenSharing={isSharing}
onToggleScreenShare={connected && !leftVoice ? handleToggleScreenShare : undefined}
```

Only pass `onToggleScreenShare` when connected to voice and not in left-voice state (same condition as mute/deafen).

**Step 4: Verify build**

Run: `(cd src/Brmble.Web && npm run build)`

Expected: Build succeeded

**Step 5: Run all frontend tests**

Run: `(cd src/Brmble.Web && npx vitest run)`

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire useScreenShare hook into App component"
```

---

### Task 11: Final Verification

**Step 1: Run all backend tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`

Expected: All tests pass

**Step 2: Run all frontend tests**

Run: `(cd src/Brmble.Web && npx vitest run)`

Expected: All tests pass

**Step 3: Build everything**

Run: `dotnet build`

Expected: Build succeeded

**Step 4: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`

Expected: Build succeeded

---

## File Change Summary

| Action | File |
|--------|------|
| Modify | `src/Brmble.Server/Brmble.Server.csproj` (add NuGet package) |
| Create | `src/Brmble.Server/LiveKit/LiveKitSettings.cs` |
| Modify | `src/Brmble.Server/LiveKit/LiveKitExtensions.cs` |
| Modify | `src/Brmble.Server/LiveKit/LiveKitService.cs` |
| Modify | `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs` |
| Modify | `src/Brmble.Server/appsettings.json` (YARP transform) |
| Modify | `src/Brmble.Server/docker/entrypoint.sh` (env vars) |
| Modify | `src/Brmble.Web/package.json` (add livekit-client) |
| Create | `src/Brmble.Web/src/hooks/useScreenShare.ts` |
| Create | `src/Brmble.Web/src/hooks/__tests__/useScreenShare.test.ts` |
| Modify | `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx` |
| Modify | `src/Brmble.Web/src/components/UserPanel/UserPanel.css` |
| Modify | `src/Brmble.Web/src/App.tsx` |
| Modify | `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs` |
| Create | `tests/Brmble.Server.Tests/Integration/LiveKitTokenTests.cs` |
| Modify | `tests/Brmble.Server.Tests/Integration/BrmbleServerFactory.cs` |
