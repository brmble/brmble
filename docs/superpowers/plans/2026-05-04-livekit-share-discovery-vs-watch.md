# LiveKit Share Discovery Vs Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate share discovery visibility from watch authorization so users can always see who is sharing, even across channels, while actual watch access remains channel-restricted.

**Architecture:** Keep `POST /livekit/token` as the strict watch/publish authorization boundary, but loosen `GET /livekit/active-share` into authenticated discovery metadata. Preserve the existing realtime `screenShare.started` path, improve the late-join discovery path to stop flattening all failures into empty results, and make the UI retry/recheck discovery after connect and channel changes so already-active shares appear reliably.

**Tech Stack:** ASP.NET Core minimal APIs, C#, React, TypeScript, MSTest, Vitest

---

## File Map

- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
  Purpose: make `GET /livekit/active-share` authenticated discovery-only and keep `POST /livekit/token` as the strict watch/publish gate.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
  Purpose: cover cross-channel discovery visibility while keeping watch authorization strict.
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  Purpose: stop flattening all discovery failures into `shares: []` and emit distinguishable result/error events to the web UI.
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
  Purpose: cover the new active-share result/error bridge behavior.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: request discovery on connect and after channel changes for the currently selected real channel, with a reliable second-chance recheck after connect stabilization.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: preserve active share state on discovery errors, apply successful discovery results authoritatively, and consume the new bridge error event.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: cover late-join discovery, cross-channel visibility, and discovery-error handling.
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
  Purpose: cover the App-level recheck behavior after connect/channel changes if existing tests live there.

### Task 1: Make `active-share` Discovery Visible Across Channels

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`

- [ ] **Step 1: Write the failing server tests for cross-channel discovery visibility**

Add these tests to `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`:

```csharp
[TestMethod]
public async Task ActiveShare_WithoutCurrentChannelAccess_ReturnsOk()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    await client.PostAsync("/auth/token", null);

    var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
}

[TestMethod]
public async Task ActiveShare_WithCurrentChannelAccess_StillReturnsOk()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    var sessionMapping = factory.Services.GetRequiredService<ISessionMappingService>();
    var channelMembership = factory.Services.GetRequiredService<IChannelMembershipService>();

    sessionMapping.SetNameForSession("TestUser", 7);

    await client.PostAsJsonAsync("/auth/token", new { mumbleUsername = "TestUser" });

    channelMembership.Update(7, 1);

    var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
}
```

- [ ] **Step 2: Run the targeted server test slice and confirm it fails**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_WithoutCurrentChannelAccess_ReturnsOk|ActiveShare_WithCurrentChannelAccess_StillReturnsOk" -v n`

Expected: FAIL because `GET /livekit/active-share` still returns `403` when the authenticated user is outside the requested channel.

- [ ] **Step 3: Remove watch-style room membership gating from `GET /livekit/active-share`**

In `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`, replace the authorization block inside `app.MapGet("/livekit/active-share", ...)` with authenticated discovery-only behavior:

```csharp
app.MapGet("/livekit/active-share", async (
    HttpContext httpContext,
    ICertificateHashExtractor certHashExtractor,
    UserRepository userRepo,
    ScreenShareTracker tracker,
    ISessionMappingService sessionMapping) =>
{
    var certHash = certHashExtractor.GetCertHash(httpContext);
    if (string.IsNullOrWhiteSpace(certHash))
        return Results.Unauthorized();

    var user = await userRepo.GetByCertHash(certHash);
    if (user is null)
        return Results.Unauthorized();

    var roomName = httpContext.Request.Query["roomName"].ToString();
    if (string.IsNullOrWhiteSpace(roomName))
        return Results.BadRequest(new { error = "roomName query parameter is required" });

    if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
        return Results.BadRequest(new { error = "invalid roomName format" });

    var shares = tracker.GetActiveShares(roomName);
    var result = shares.Select(s =>
    {
        var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
        return new { s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
    }).ToArray();

    return Results.Ok(new { shares = result });
});
```

- [ ] **Step 4: Run the targeted server tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_" -v n`

Expected: PASS for unauthenticated/unknown-cert rejection and for both cross-channel and in-channel discovery visibility.

- [ ] **Step 5: Commit the discovery visibility policy fix**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs
git commit -m "fix: allow livekit share discovery across channels"
```

### Task 2: Keep Watch Authorization Strict On `/livekit/token`

**Files:**
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`

- [ ] **Step 1: Write or tighten a regression test proving watch access is still channel-restricted**

Ensure this test exists in `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs` and matches the stricter expectation:

```csharp
[TestMethod]
public async Task TokenRequest_SubscribeWithoutCurrentChannelAccess_ReturnsForbidden()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    await client.PostAsync("/auth/token", null);

    var response = await client.PostAsJsonAsync("/livekit/token", new { roomName = "channel-1", accessMode = "subscribe" });

    Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode);
}
```

- [ ] **Step 2: Run the subscribe-authorization test and confirm it still passes**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "TokenRequest_SubscribeWithoutCurrentChannelAccess_ReturnsForbidden|TokenRequest_SubscribeWithCurrentChannelAccess_ReturnsOk" -v n`

Expected: PASS without production changes, proving discovery visibility did not weaken watch authorization.

- [ ] **Step 3: Commit only if the test required correction**

```bash
git add tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs
git commit -m "test: pin livekit watch authorization"
```

If no file changed, skip this commit.

### Task 3: Stop Flattening Discovery Failures Into Empty Share Results

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write a failing client test for active-share failure signaling**

Add this test to `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`:

```csharp
[TestMethod]
public void ActiveShareFailure_IsNotCollapsedIntoEmptyShares()
{
    var sent = new List<(string Type, object Payload)>();
    var adapter = MumbleAdapterTestFactory.CreateWithBridge((type, payload) => sent.Add((type, payload)));

    adapter.EmitLiveKitActiveShareErrorForTest("channel-1", "forbidden");

    Assert.IsTrue(sent.Any(x => x.Type == "livekit.activeShareError"));
    Assert.IsFalse(sent.Any(x => x.Type == "livekit.activeShareResult" && x.Payload.ToString()!.Contains("shares")));
}
```

- [ ] **Step 2: Run the client parse test and confirm it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ActiveShareFailure_IsNotCollapsedIntoEmptyShares" -v n`

Expected: FAIL because there is no distinct `livekit.activeShareError` path yet.

- [ ] **Step 3: Emit a distinct discovery error event from `MumbleAdapter`**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, change the failure branches in `livekit.checkActiveShare` from sending empty `shares` to sending a dedicated error event:

```csharp
if (string.IsNullOrWhiteSpace(roomName) || _apiUrl is null)
{
    _bridge?.Send("livekit.activeShareError", new { roomName, reason = "client-not-ready" });
    _bridge?.NotifyUiThread();
    return;
}

using var cert = _certService?.GetExportableCertificate();
if (cert is null)
{
    _bridge?.Send("livekit.activeShareError", new { roomName, reason = "missing-certificate" });
    _bridge?.NotifyUiThread();
    return;
}
```

And replace the request result handling with:

```csharp
if (result.Success && result.Body is not null)
{
    using var doc = System.Text.Json.JsonDocument.Parse(result.Body);
    var shares = new System.Collections.Generic.List<object>();
    if (doc.RootElement.TryGetProperty("shares", out var sharesArr) && sharesArr.ValueKind == System.Text.Json.JsonValueKind.Array)
    {
        foreach (var s in sharesArr.EnumerateArray())
        {
            var sUserName = s.TryGetProperty("userName", out var un) ? un.GetString() : null;
            var sUserId = s.TryGetProperty("userId", out var uid) && uid.ValueKind == System.Text.Json.JsonValueKind.Number
                ? uid.GetInt64() : (long?)null;
            var sMatrixUserId = s.TryGetProperty("matrixUserId", out var muid) ? muid.GetString() : null;
            var sSessionId = s.TryGetProperty("sessionId", out var sid) && sid.ValueKind == System.Text.Json.JsonValueKind.Number
                ? sid.GetInt32() : (int?)null;
            shares.Add(new { userName = sUserName, userId = sUserId, matrixUserId = sMatrixUserId, sessionId = sSessionId });
        }
    }

    _bridge?.Send("livekit.activeShareResult", new { roomName, shares });
}
else
{
    _bridge?.Send("livekit.activeShareError", new { roomName, reason = "request-failed", statusCode = result.StatusCode });
}
```

And in the catch block:

```csharp
catch (Exception ex)
{
    _bridge?.Send("livekit.activeShareError", new { roomName, reason = "exception", message = ex.Message });
    _bridge?.NotifyUiThread();
}
```

- [ ] **Step 4: Run the client tests and confirm they pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ActiveShare|TryGetLiveKitAccessMode" -v n`

Expected: PASS, including the new active-share error signaling test.

- [ ] **Step 5: Commit the bridge error-path change**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "fix: report livekit discovery errors distinctly"
```

### Task 4: Preserve Badges On Discovery Errors And Apply Authoritative Results On Success

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write failing hook tests for successful discovery and discovery-error preservation**

Add these tests to `src/Brmble.Web/src/hooks/useScreenShare.test.ts`:

```ts
it('replaces activeShares when activeShareResult succeeds', () => {
  let activeShareHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.activeShareResult') activeShareHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    activeShareHandler?.({
      roomName: 'channel-1',
      shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
    });
  });

  expect(result.current.activeShares).toHaveLength(1);
  expect(result.current.activeShares[0].userId).toBe(10);
});

it('does not clear existing activeShares on activeShareError', () => {
  let activeShareHandler: ((data: unknown) => void) | null = null;
  let activeShareErrorHandler: ((data: unknown) => void) | null = null;

  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.activeShareResult') activeShareHandler = handler;
    if (type === 'livekit.activeShareError') activeShareErrorHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    activeShareHandler?.({
      roomName: 'channel-1',
      shares: [{ userId: 10, userName: 'alice', sessionId: 1 }],
    });
  });

  act(() => {
    activeShareErrorHandler?.({ roomName: 'channel-1', reason: 'request-failed' });
  });

  expect(result.current.activeShares).toHaveLength(1);
  expect(result.current.activeShares[0].userId).toBe(10);
});
```

- [ ] **Step 2: Run the hook test slice and confirm it fails**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "activeShare"`

Expected: FAIL because the hook does not yet listen for `livekit.activeShareError`.

- [ ] **Step 3: Add a distinct `activeShareError` handler without clearing prior shares**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, add:

```ts
const onActiveShareError = (data: unknown) => {
  const d = data as { roomName?: string; reason?: string; statusCode?: number; message?: string };
  console.warn('[LiveKit] activeShare discovery failed', d);
};
```

Register and unregister it:

```ts
bridge.on('livekit.activeShareError', onActiveShareError);
...
bridge.off('livekit.activeShareError', onActiveShareError);
```

Keep `onActiveShareResult` authoritative on success:

```ts
if (d.shares && d.shares.length > 0) {
  setActiveShares(d.shares.map(s => ({
    roomName: d.roomName,
    userName: s.userName,
    userId: s.userId,
    matrixUserId: s.matrixUserId,
    sessionId: s.sessionId,
  })));
} else {
  setActiveShares([]);
}
```

The important rule is: only a successful discovery response may clear share badges.

- [ ] **Step 4: Run the hook tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "activeShare"`

Expected: PASS for successful discovery replacement and error-preservation behavior.

- [ ] **Step 5: Commit the UI discovery-error handling**

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "fix: preserve active shares on discovery errors"
```

### Task 5: Recheck Discovery On Connect And Channel Changes

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write a failing App-level test for late-join discovery recheck**

Add a test to `src/Brmble.Web/src/App.screenShareStart.test.ts` that verifies `livekit.checkActiveShare` is sent when the app becomes connected in a real channel, not only when a channel change happens later:

```ts
it('requests active share discovery after connect for the current channel', async () => {
  render(<App />);

  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 1,
      channels: [{ id: 1, name: 'General' }],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 1 }],
    });
  });

  await waitFor(() => {
    expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', { roomName: 'channel-1' });
  });
});
```

- [ ] **Step 2: Run the App-level test and confirm it fails**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "requests active share discovery after connect"`

Expected: FAIL if the current effect ordering misses the late-join case or does not recheck after connect stabilization.

- [ ] **Step 3: Add a connect-aware recheck effect in `App.tsx`**

Replace the current one-shot effect with a small helper and a connect-aware effect:

```ts
const requestActiveShareDiscovery = useCallback((channelId: string | undefined) => {
  if (!channelId || channelId === 'server-root') return;
  bridge.send('livekit.checkActiveShare', { roomName: `channel-${channelId}` });
}, []);

useEffect(() => {
  disconnectViewer();
  setScreenShareToast(null);
  requestActiveShareDiscovery(currentChannelId);
}, [currentChannelId, disconnectViewer, requestActiveShareDiscovery]);

useEffect(() => {
  if (connectionStatus !== 'connected') return;
  requestActiveShareDiscovery(currentChannelId);
}, [connectionStatus, currentChannelId, requestActiveShareDiscovery]);
```

This keeps the existing channel-switch behavior and adds a second chance after connect stabilization. Do not add broad polling.

- [ ] **Step 4: Run the App-level tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "active share discovery"`

Expected: PASS, including the late-join recheck case.

- [ ] **Step 5: Commit the discovery recheck behavior**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: recheck active shares after connect"
```

### Task 6: Verify The Full Discovery-vs-Watch Split

**Files:**
- Modify: all files changed in Tasks 1-5

- [ ] **Step 1: Run the focused server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "LiveKit" -v n`

Expected: PASS. Discovery is visible across channels; token subscribe/publish behavior remains strict.

- [ ] **Step 2: Run the focused client tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ActiveShare|TryGetLiveKitAccessMode" -v n`

Expected: PASS. Discovery failures emit `livekit.activeShareError` rather than fake empty share results.

- [ ] **Step 3: Run the focused web tests**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts src/App.screenShareStart.test.ts`

Expected: PASS. Existing share badges survive discovery failures and late-join discovery is retried after connect.

- [ ] **Step 4: Build the frontend and server for manual testing**

Run: `cd src/Brmble.Web; npm run build`

Expected: PASS.

Run: `dotnet build src/Brmble.Server/Brmble.Server.csproj`

Expected: PASS.

- [ ] **Step 5: Commit the final verification-only updates if needed**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "fix: separate livekit share discovery from watch access"
```

If everything was already committed in earlier tasks, skip this final commit.
