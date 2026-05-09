# LiveKit Share Follow-Up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix root-channel share discovery, make intentional disconnect while sharing silent, and improve messaging when Windows/WebView2 blocks sharing a selected app/window.

**Architecture:** Add a global discovery mode for the root channel while preserving existing room-scoped discovery for non-root channels. Carry explicit user intent through local share teardown so intentional disconnects are treated as manual stops, and refine the capture-start error classification so known platform-denied app/window captures get a clearer message instead of a vague technical error.

**Tech Stack:** ASP.NET Core minimal APIs, C#, React, TypeScript, MSTest, Vitest

---

## File Map

- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
  Purpose: add a global discovery path for root-channel share visibility while preserving room-scoped discovery behavior.
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
  Purpose: verify root/global discovery returns all active shares and that channel-scoped discovery still works.
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  Purpose: allow `livekit.checkActiveShare` to request global discovery when asked from root.
- Modify: `src/Brmble.Web/src/App.tsx`
  Purpose: issue root/global discovery requests, stop local share manually before intentional disconnects, and refine screen-share-ended/error notification text.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  Purpose: preserve explicit manual teardown intent across room disconnects and classify blocked-window capture failures more clearly.
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
  Purpose: verify root/global discovery requests and root visibility behavior.
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`
  Purpose: verify silent intentional disconnect behavior and clearer error notification mapping.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  Purpose: verify blocked-window capture classification and manual-teardown intent handling.

### Task 1: Add Global Discovery For Root Channel

**Files:**
- Modify: `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`
- Modify: `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`

- [ ] **Step 1: Write the failing tests for root/global discovery**

Add these server tests to `tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs`:

```csharp
[TestMethod]
public async Task ActiveShare_RootGlobalRequest_ReturnsAllActiveShares()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    await client.PostAsync("/auth/token", null);

    var tracker = factory.Services.GetRequiredService<ScreenShareTracker>();
    tracker.Start("channel-1", "alice", 10, "@alice:test");
    tracker.Start("channel-2", "bob", 20, "@bob:test");

    var response = await client.GetAsync("/livekit/active-share?scope=all");
    var payload = await response.Content.ReadAsStringAsync();

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    StringAssert.Contains(payload, "channel-1");
    StringAssert.Contains(payload, "channel-2");
}

[TestMethod]
public async Task ActiveShare_ChannelRequest_StillReturnsOnlyRequestedRoom()
{
    using var factory = new BrmbleServerFactory();
    using var client = factory.CreateClient();

    await client.PostAsync("/auth/token", null);

    var tracker = factory.Services.GetRequiredService<ScreenShareTracker>();
    tracker.Start("channel-1", "alice", 10, "@alice:test");
    tracker.Start("channel-2", "bob", 20, "@bob:test");

    var response = await client.GetAsync("/livekit/active-share?roomName=channel-1");
    var payload = await response.Content.ReadAsStringAsync();

    Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    StringAssert.Contains(payload, "channel-1");
    Assert.IsFalse(payload.Contains("channel-2"));
}
```

Add this App test to `src/Brmble.Web/src/App.screenShareStart.test.ts`:

```ts
it('requests global active share discovery while in root channel', async () => {
  render(<App />);

  act(() => {
    bridge.emit('voice.connected', {
      username: 'TestUser',
      channelId: 0,
      channels: [{ id: 1, name: 'General' }],
      users: [{ session: 7, name: 'TestUser', self: true, channelId: 0 }],
    });
  });

  await waitFor(() => {
    expect(bridge.send).toHaveBeenCalledWith('livekit.checkActiveShare', { scope: 'all' });
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_RootGlobalRequest|ActiveShare_ChannelRequest_StillReturnsOnlyRequestedRoom" -v n`

Expected: FAIL because the endpoint currently requires `roomName` and has no global scope.

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "global active share discovery while in root channel"`

Expected: FAIL because `App.tsx` currently skips discovery in `server-root`.

- [ ] **Step 3: Add global discovery support to the server and bridge**

In `src/Brmble.Server/LiveKit/LiveKitEndpoints.cs`, update `GET /livekit/active-share` so it accepts either:

- `scope=all` for global discovery
- `roomName=channel-N` for room-scoped discovery

Use this shape:

```csharp
var scope = httpContext.Request.Query["scope"].ToString();
var roomName = httpContext.Request.Query["roomName"].ToString();

IEnumerable<object> result;

if (string.Equals(scope, "all", StringComparison.Ordinal))
{
    result = tracker.GetAllActiveShares().Select(s =>
    {
        var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
        return new { roomName = s.RoomName, s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
    }).ToArray();
}
else
{
    if (string.IsNullOrWhiteSpace(roomName))
        return Results.BadRequest(new { error = "roomName query parameter is required" });

    if (!roomName.StartsWith("channel-") || !int.TryParse(roomName.AsSpan("channel-".Length), out _))
        return Results.BadRequest(new { error = "invalid roomName format" });

    result = tracker.GetActiveShares(roomName).Select(s =>
    {
        var hasSession = sessionMapping.TryGetSessionByUserId(s.UserId, out var sessionId);
        return new { roomName, s.UserName, s.UserId, s.MatrixUserId, sessionId = hasSession ? sessionId : (int?)null };
    }).ToArray();
}

return Results.Ok(new { shares = result });
```

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, update `livekit.checkActiveShare` to accept either `roomName` or `scope` and build the request URL accordingly:

```csharp
var roomName = data.TryGetProperty("roomName", out var rn) ? rn.GetString() : null;
var scope = data.TryGetProperty("scope", out var scopeProp) ? scopeProp.GetString() : null;

if ((string.IsNullOrWhiteSpace(roomName) && !string.Equals(scope, "all", StringComparison.Ordinal)) || _apiUrl is null)
{
    _bridge?.Send("livekit.activeShareError", new { roomName, scope, reason = "client-not-ready" });
    _bridge?.NotifyUiThread();
    return;
}

var query = string.Equals(scope, "all", StringComparison.Ordinal)
    ? "livekit/active-share?scope=all"
    : $"livekit/active-share?roomName={Uri.EscapeDataString(roomName!)}";
```

- [ ] **Step 4: Make `App.tsx` request global discovery from root**

Replace the helper in `src/Brmble.Web/src/App.tsx` with:

```ts
const requestActiveShareDiscovery = useCallback((channelId: string | undefined) => {
  if (!channelId) return;

  if (channelId === 'server-root') {
    bridge.send('livekit.checkActiveShare', { scope: 'all' });
    return;
  }

  bridge.send('livekit.checkActiveShare', { roomName: `channel-${channelId}` });
}, []);
```

- [ ] **Step 5: Run the focused tests and confirm they pass**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_RootGlobalRequest|ActiveShare_ChannelRequest_StillReturnsOnlyRequestedRoom" -v n`

Expected: PASS.

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts -t "global active share discovery while in root channel"`

Expected: PASS.

- [ ] **Step 6: Commit the root/global discovery support**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareStart.test.ts
git commit -m "feat: add root livekit share discovery"
```

### Task 2: Make Intentional Disconnect While Sharing Silent

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`

- [ ] **Step 1: Write the failing tests for intentional disconnect silence**

Add these tests to `src/Brmble.Web/src/App.screenShareEnded.test.ts`:

```ts
it('returns null notification for manual share stop', () => {
  expect(getScreenShareEndedNotification('manual')).toBeNull();
});

it('does not create a queued notification for manual share stop', () => {
  expect(createQueuedScreenShareEndedNotification('manual', 1)).toBeNull();
});
```

Add an App-level interaction test that verifies disconnect while sharing does not enqueue a warning notification.

- [ ] **Step 2: Run the focused test slice and confirm it fails for the intentional disconnect path**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareEnded.test.ts -t "manual share stop|manual share stop"`

Expected: the pure notification mapping tests already pass; the failing piece should be the new App disconnect interaction test because disconnect currently bypasses `stopSharing()`.

- [ ] **Step 3: Carry explicit manual intent through disconnect/back-to-server teardown**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, add a teardown-intent ref and setter:

```ts
const localShareTeardownIntentRef = useRef<LocalShareStopReason | null>(null);

const markLocalShareTeardownIntent = useCallback((reason: LocalShareStopReason) => {
  localShareTeardownIntentRef.current = reason;
}, []);
```

Update `RoomEvent.Disconnected`:

```ts
const teardownIntent = localShareTeardownIntentRef.current;
localShareTeardownIntentRef.current = null;

if (isSharingRef.current) {
  void stopLocalShare(teardownIntent ?? 'interrupted', room);
}
```

In `App.tsx`, make intentional disconnects stop sharing first:

```ts
const handleDisconnect = async () => {
  if (isSharing) {
    markLocalShareTeardownIntent('manual');
    await stopSharing();
  }
  bridge.send('voice.disconnect');
};

const handleBackToServerList = async () => {
  if (isSharing) {
    markLocalShareTeardownIntent('manual');
    await stopSharing();
  }
  bridge.send('voice.disconnect');
  // existing reset logic continues here
};
```

Expose `markLocalShareTeardownIntent` from `useScreenShare` alongside `stopSharing`.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareEnded.test.ts`

Expected: PASS, including the new intentional-disconnect silence coverage.

- [ ] **Step 5: Commit the intentional disconnect fix**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/App.screenShareEnded.test.ts
git commit -m "fix: silence manual share stop notifications"
```

### Task 3: Improve Blocked Window/App Share Error Messaging

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`

- [ ] **Step 1: Write failing tests for blocked-window capture classification**

Add a hook test to `src/Brmble.Web/src/hooks/useScreenShare.test.ts` covering a post-selection capture denial like:

```ts
it('classifies blocked window capture as a clearer platform error', async () => {
  const { result } = renderHook(() => useScreenShare());

  const blockedError = new DOMException(
    'Permission denied by user while starting capture pipeline',
    'AbortError',
  );

  await act(async () => {
    await result.current.__testOnlyHandleStartShareFailure?.(blockedError);
  });

  expect(result.current.error).toContain('could not share that app or window');
});
```

If no current test seam exists, create the smallest internal helper export used only by tests or drive the failure through the existing `startSharing` test harness.

- [ ] **Step 2: Run the focused hook test and confirm it fails**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "blocked window capture"`

Expected: FAIL because blocked capture errors still map to the generic technical issue message.

- [ ] **Step 3: Add a narrow blocked-capture classifier and clearer message**

In `src/Brmble.Web/src/hooks/useScreenShare.ts`, add:

```ts
function isBlockedWindowCaptureError(error: unknown): boolean {
  const details = getErrorLikeDetails(error);
  const message = details?.message?.toLowerCase() ?? '';
  const name = details?.name?.toLowerCase() ?? '';

  return name === 'aborterror' && message.includes('starting capture pipeline');
}
```

Then in the `startSharing` catch block, replace the generic error assignment with:

```ts
if (isBlockedWindowCaptureError(err)) {
  setError('Windows could not share that app or window. Try sharing your full screen or a different window.');
} else {
  setError(getErrorLikeDetails(err)?.message || 'Screen share failed');
}
```

In `src/Brmble.Web/src/App.tsx`, refine the `'error'` notification mapping text:

```ts
case 'error':
  return {
    status: 'error',
    title: 'Screen share failed',
    detail: 'Brmble could not start or keep your screen share running. Windows may have blocked sharing that app or window.',
  };
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run: `cd src/Brmble.Web; npm run test -- src/hooks/useScreenShare.test.ts -t "blocked window capture"`

Expected: PASS.

- [ ] **Step 5: Commit the clearer blocked-window messaging**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "fix: clarify blocked window share errors"
```

### Task 4: Verify The Follow-Up Fixes End To End

**Files:**
- Modify: all files changed in Tasks 1-3

- [ ] **Step 1: Run the focused server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj --filter "ActiveShare_" -v n`

Expected: PASS, including root/global discovery and room-scoped discovery behavior.

- [ ] **Step 2: Run the focused web tests**

Run: `cd src/Brmble.Web; npm run test -- src/App.screenShareStart.test.ts src/App.screenShareEnded.test.ts src/hooks/useScreenShare.test.ts`

Expected: PASS, including root discovery, silent intentional disconnect, and blocked-window messaging coverage.

- [ ] **Step 3: Build the frontend and client for manual testing**

Run: `cd src/Brmble.Web; npm run build`

Expected: PASS.

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`

Expected: PASS.

- [ ] **Step 4: Commit verification-only changes if needed**

```bash
git add src/Brmble.Server/LiveKit/LiveKitEndpoints.cs tests/Brmble.Server.Tests/LiveKit/LiveKitEndpointsTests.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/App.screenShareStart.test.ts src/Brmble.Web/src/App.screenShareEnded.test.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts
git commit -m "fix: follow up livekit share behavior"
```

If everything was already committed in earlier tasks, skip this final commit.
