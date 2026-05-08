# LiveKit Token & Security E2 Implementation Plan

> **Status note:** Implemented with narrowed scope. This plan is retained as the historical record for the landed E2 pass: 1-hour token expiry metadata, targeted LiveKit endpoint rate limiting, expiry-aware client token handling, duplicate share-start suppression, and an App-level connecting guard. Full token rotation and early revocation remain future work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the landed E2 token lifecycle hardening pass for LiveKit: short-lived token expiry metadata, rotation-ready client response handling, endpoint rate limiting, and duplicate-start guardrails.

**Architecture:** Build E2 on top of E1 instead of redefining authorization. Server work stays in the LiveKit service/endpoints and ASP.NET pipeline, while the client changes remain narrow: accept token expiry metadata, preserve explicit access modes, and suppress duplicate share-start attempts while a token/connect path is in flight. Full refresh before expiry and early revocation are intentionally deferred.

**Tech Stack:** ASP.NET Core, C#, Microsoft.AspNetCore.RateLimiting, React, TypeScript, MSTest, Vitest

---

## File Map

- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
  Purpose: shorten token TTL and expose token-lifecycle metadata needed by the client refresh path.
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
  Purpose: return token-expiry metadata and apply targeted rate limiting to LiveKit endpoint mappings.
- Modify: `src/Brmble.Server/Program.cs`
  Purpose: register and apply targeted rate limiting to LiveKit-related endpoints.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`
  Purpose: verify shorter TTL behavior and token metadata shape.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
  Purpose: verify rate limiting and endpoint response metadata.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: request tokens with access mode, track in-flight share start, and prepare refresh-aware token usage.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: add the tiny duplicate-start guardrail while LiveKit is connecting.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: verify duplicate-start suppression and refresh-ready token request shape.

### Task 1: Shorten Token TTL And Return Expiry Metadata

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitService.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`

- [ ] **Step 1: Write a failing service test for shorter token TTL metadata**

Add this test to `tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs`:

```csharp
[TestMethod]
public async Task GenerateTokenMetadata_UsesShortLivedExpiry()
{
    _mockUserRepo.Setup(r => r.GetByCertHash("cert123"))
        .ReturnsAsync(new User(1, "cert123", "TestUser", "@test:example.com", "tok"));

    var issuedAt = DateTimeOffset.UtcNow;
    var metadata = await _svc.GenerateTokenMetadata("cert123", "channel-1", LiveKitAccessMode.Subscribe, issuedAt);

    Assert.IsNotNull(metadata);
    Assert.IsTrue(metadata.ExpiresAt > issuedAt);
    Assert.IsTrue(metadata.ExpiresAt <= issuedAt.AddHours(1).AddMinutes(1));
}
```

- [ ] **Step 2: Run the metadata test and confirm it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GenerateTokenMetadata_UsesShortLivedExpiry" -v n`

Expected: FAIL because `GenerateTokenMetadata` does not exist yet.

- [ ] **Step 3: Add a token metadata record and implement short-lived metadata generation**

Add this record near the top of `src/Brmble.Server/LiveKit/LiveKitService.cs`:

```csharp
public sealed record LiveKitTokenMetadata(string Token, DateTimeOffset ExpiresAt);
```

Change the TTL constant to:

```csharp
private static readonly TimeSpan DefaultTokenTtl = TimeSpan.FromHours(1);
```

Add this method to `LiveKitService`:

```csharp
public async Task<LiveKitTokenMetadata?> GenerateTokenMetadata(
    string certHash,
    string roomName,
    LiveKitAccessMode accessMode,
    DateTimeOffset issuedAt)
{
    var token = await GenerateToken(certHash, roomName, accessMode);
    if (token is null)
        return null;

    return new LiveKitTokenMetadata(token, issuedAt.Add(DefaultTokenTtl));
}
```

- [ ] **Step 4: Return expiry metadata from the token endpoint**

In `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`, replace the final token response with:

```csharp
var issuedAt = DateTimeOffset.UtcNow;
var metadata = await liveKitService.GenerateTokenMetadata(certHash, roomName, accessMode, issuedAt);
if (metadata is null)
    return Results.Unauthorized();

return Results.Ok(new
{
    token = metadata.Token,
    url,
    expiresAt = metadata.ExpiresAt,
});
```

- [ ] **Step 5: Run the service tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "GenerateTokenMetadata_UsesShortLivedExpiry|GenerateToken_" -v n`

Expected: PASS.

- [ ] **Step 6: Commit the short-lived token metadata step**

```bash
git add src/Brmble.Server/LiveKit/LiveKitService.cs src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitServiceTests.cs
git commit -m "feat: shorten livekit token lifetime"
```

### Task 2: Add Targeted LiveKit Rate Limiting

**Files:**
- Modify: `src/Brmble.Server/Program.cs`
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`

- [ ] **Step 1: Write a failing endpoint test for repeated token requests being throttled**

Add this test to `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`:

```csharp
[TestMethod]
public async Task TokenRequest_RepeatedRapidCalls_EventuallyReturnsTooManyRequests()
{
    await using var factory = new WebApplicationFactory<Program>();
    using var client = factory.CreateClient();

    HttpResponseMessage? limited = null;
    for (var i = 0; i < 20; i++)
    {
        var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });
        if (response.StatusCode == HttpStatusCode.TooManyRequests)
        {
            limited = response;
            break;
        }
    }

    Assert.IsNotNull(limited);
}
```

- [ ] **Step 2: Run the rate-limit test and confirm it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "TokenRequest_RepeatedRapidCalls_EventuallyReturnsTooManyRequests" -v n`

Expected: FAIL because no rate limiter is configured.

- [ ] **Step 3: Register and apply a narrow rate limiter for LiveKit endpoints**

In `src/Brmble.Server/Program.cs`, add:

```csharp
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;
```

Then register the limiter before `var app = builder.Build();`:

```csharp
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("livekit-token", limiterOptions =>
    {
        limiterOptions.PermitLimit = 10;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueLimit = 0;
    });

    options.AddFixedWindowLimiter("livekit-active-share", limiterOptions =>
    {
        limiterOptions.PermitLimit = 30;
        limiterOptions.Window = TimeSpan.FromMinutes(1);
        limiterOptions.QueueLimit = 0;
    });
});
```

And apply it in `LiveKitEndpoints.cs`:

```csharp
app.MapPost("/livekit/token", ...).RequireRateLimiting("livekit-token");
app.MapGet("/livekit/active-share", ...).RequireRateLimiting("livekit-active-share");
```

- [ ] **Step 4: Run the rate-limit test and confirm it passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "RepeatedRapidCalls|TooManyRequests" -v n`

Expected: PASS with `429` eventually returned.

- [ ] **Step 5: Commit the endpoint rate limiting**

```bash
git add src/Brmble.Server/Program.cs src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs
git commit -m "feat: rate limit livekit endpoints"
```

### Task 3: Make The Client Token Request Rotation-Ready

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write a failing hook test that requests a token with explicit access mode**

Add this test to `src/Brmble.Web/src/hooks/useScreenShare.test.ts`:

```ts
it('requests a subscribe token with explicit access mode when joining as viewer', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  await act(async () => {
    const promise = result.current.connectAsViewer({ roomName: 'channel-1', userName: 'Alice', userId: 1 });
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await promise;
  });

  expect(bridge.send).toHaveBeenCalledWith('livekit.requestToken', {
    roomName: 'channel-1',
    accessMode: 'subscribe',
  });
});
```

- [ ] **Step 2: Run the hook test and confirm it fails**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "requests a subscribe token with explicit access mode"`

Expected: FAIL because the hook still sends only `{ roomName }`.

- [ ] **Step 3: Change the token request helper to require access mode and accept expiry metadata**

Update the helper in `src/Brmble.Web/src/hooks/useScreenShare.ts` to:

```ts
const requestToken = useCallback((roomName: string, accessMode: 'publish' | 'subscribe') => {
  return new Promise<{ token: string; url: string; expiresAt?: string }>((resolve, reject) => {
    const cleanup = () => {
      bridge.off('livekit.token', onToken);
      bridge.off('livekit.tokenError', onError);
      clearTimeout(timer);
    };

    const onToken = (data: unknown) => {
      cleanup();
      resolve(data as { token: string; url: string; expiresAt?: string });
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
    bridge.send('livekit.requestToken', { roomName, accessMode });
  });
}, []);
```

Then call it as `requestToken(roomName, 'publish')` from share-start paths and `requestToken(roomName, 'subscribe')` from viewer-join paths.

- [ ] **Step 4: Run the hook tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "access mode"`

Expected: PASS for the new token request shape test.

- [ ] **Step 5: Commit the token-request shape change**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "feat: request livekit tokens with access mode"
```

### Task 4: Add The Tiny Duplicate-Start Guardrail

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write a failing hook test for suppressing a second in-flight share start**

Add this test to `src/Brmble.Web/src/hooks/useScreenShare.test.ts`:

```ts
it('suppresses a second startSharing call while one is already connecting', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  const firstPromise = result.current.startSharing('channel-1');
  const secondPromise = result.current.startSharing('channel-1');

  await act(async () => {
    tokenHandler?.({ token: 'test-jwt', url: 'ws://localhost/livekit', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    await Promise.all([firstPromise, secondPromise]);
  });

  expect((bridge.send as ReturnType<typeof vi.fn>).mock.calls.filter(([type]) => type === 'livekit.requestToken')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the guardrail test and confirm it fails**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "suppresses a second startSharing call"`

Expected: FAIL because multiple `startSharing` calls can still trigger duplicate token requests.

- [ ] **Step 3: Add an in-flight start guard in `useScreenShare.ts` and an App-level connecting guard**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, add:

```ts
const isStartingShareRef = useRef(false);
```

At the top of `startSharing`:

```ts
if (isStartingShareRef.current) {
  return;
}

isStartingShareRef.current = true;
```

And ensure every exit path resets it:

```ts
try {
  // existing startSharing body
} finally {
  isStartingShareRef.current = false;
}
```

In `src/Brmble.Web/src/App.tsx`, add an early return in the share toggle path:

```ts
if (statuses.livekit.state === 'connecting') {
  return;
}
```

- [ ] **Step 4: Run the guardrail tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "startSharing"`

Expected: PASS, including the duplicate-start suppression case.

- [ ] **Step 5: Commit the duplicate-start guardrail**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "fix: suppress duplicate livekit share starts"
```
