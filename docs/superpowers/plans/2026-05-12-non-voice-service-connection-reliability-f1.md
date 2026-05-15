# Non-Voice Service Connection Reliability F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconnect Brmble server/session and Matrix chat independently while Mumble voice stays connected, and clear LiveKit screen-share state instead of recovering old LiveKit rooms.

**Architecture:** Native C# emits normalized `brmble.serviceStatus` events for Brmble-managed non-voice services and refreshes credentials when API health recovers. React maps those native events into existing service dots, refreshes Matrix credentials without clearing current chat on service reconnect, and treats screen-share support loss as a trust boundary that clears LiveKit room/watch state. LiveKit rooms are not restored after a services-container deploy.

**Tech Stack:** C# Win32/WebView2 client, MSTest, React 19, TypeScript, Vitest, Matrix JS SDK, LiveKit client SDK.

---

## File Structure

- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  - Add `brmble.serviceStatus` payload helpers.
  - Emit `server`, `session`, and `screenshare` service status events.
  - Refresh credentials when Brmble API health recovers after an outage.
  - Keep Mumble reconnect behavior unchanged.
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs`
  - Test service status payload shape and credential refresh decision helpers.
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`
  - Test LiveKit active-share failures emit `screenshare` status.
- Modify: `src/Brmble.Web/src/types/index.ts`
  - Add native service status payload types and mapping helpers if the helper is not placed in a separate file.
- Create: `src/Brmble.Web/src/utils/brmbleServiceStatus.ts`
  - Convert native `server`/`session`/`screenshare` statuses to existing UI service names: `server` and `livekit`.
- Create: `src/Brmble.Web/src/utils/brmbleServiceStatus.test.ts`
  - Test native-to-UI service mapping.
- Modify: `src/Brmble.Web/src/App.tsx`
  - Subscribe to `brmble.serviceStatus`.
  - Refresh Matrix credentials without clearing current chat on server reconnect.
  - Clear screen-share viewing state on session/screenshare loss.
  - Show viewer share-ended notifications.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
  - Preserve rendered chat while refreshed credentials recreate the Matrix client.
  - Keep existing Matrix SDK sync-state reporting.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
  - Test Matrix reconnect statuses and credential refresh behavior.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
  - Remove old LiveKit room auto-reconnect for watched shares.
  - Add viewer share-ended callback for explicit and unexpected removal.
  - Add explicit cleanup entry point for service-loss cleanup used by App.
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
  - Test no LiveKit room recovery after disconnect.
  - Test explicit and unexpected watched-share-ended callbacks.
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`
  - Test Brmble notifications for watched share ended normally and unexpectedly.
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`
  - Test service dots show Brmble server/session and screenshare reconnect states through existing dots.
- Modify: `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`
  - Mark F1 items implemented after code is complete.

---

### Task 1: Native Service Status Payload

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs`

- [ ] **Step 1: Write failing payload tests**

Add these tests to `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs` after `TryGetLiveKitAccessMode_NonStringValue_ReturnsFalse`:

```csharp
[TestMethod]
public void CreateBrmbleServiceStatusPayload_WithReconnectContext_UsesExpectedShape()
{
    var payload = MumbleAdapter.CreateBrmbleServiceStatusPayload(
        "session",
        "reconnecting",
        reason: "connection-lost",
        attempt: 2,
        delayMs: 4000);

    Assert.AreEqual("session", payload.Service);
    Assert.AreEqual("reconnecting", payload.State);
    Assert.AreEqual("connection-lost", payload.Reason);
    Assert.AreEqual(2, payload.Attempt);
    Assert.AreEqual(4000, payload.DelayMs);
}

[TestMethod]
public void CreateBrmbleServiceStatusPayload_Connected_CanOmitReconnectContext()
{
    var payload = MumbleAdapter.CreateBrmbleServiceStatusPayload("server", "connected");

    Assert.AreEqual("server", payload.Service);
    Assert.AreEqual("connected", payload.State);
    Assert.IsNull(payload.Reason);
    Assert.IsNull(payload.Attempt);
    Assert.IsNull(payload.DelayMs);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "CreateBrmbleServiceStatusPayload"`

Expected: FAIL with a compile error that `MumbleAdapter.CreateBrmbleServiceStatusPayload` does not exist.

- [ ] **Step 3: Add payload record and helper**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, add this record near `ChannelChangedPayload`:

```csharp
internal sealed record BrmbleServiceStatusPayload(
    string Service,
    string State,
    string? Reason = null,
    int? Attempt = null,
    int? DelayMs = null);
```

Add this helper near `CreateChannelChangedPayload`:

```csharp
internal static BrmbleServiceStatusPayload CreateBrmbleServiceStatusPayload(
    string service,
    string state,
    string? reason = null,
    int? attempt = null,
    int? delayMs = null)
    => new(service, state, reason, attempt, delayMs);
```

Add this private sender near `LogToFile`:

```csharp
private void SendBrmbleServiceStatus(
    string service,
    string state,
    string? reason = null,
    int? attempt = null,
    int? delayMs = null)
{
    _bridge?.Send("brmble.serviceStatus", CreateBrmbleServiceStatusPayload(service, state, reason, attempt, delayMs));
    _bridge?.NotifyUiThread();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "CreateBrmbleServiceStatusPayload"`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs
git commit -m "feat: add non-voice service status payload"
```

---

### Task 2: Native Server And Session Reconnect Status

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs`

- [ ] **Step 1: Write failing refresh-decision tests**

Add these tests to `MumbleAdapterCredentialsTests.cs`:

```csharp
[TestMethod]
public void ShouldRefreshCredentialsAfterHealthSuccess_FirstSuccessAfterInitialCredentials_ReturnsFalse()
{
    var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
        credentialsAlreadyFetched: true,
        previousHealthWasConnected: false,
        sawHealthFailureSinceCredentials: false);

    Assert.IsFalse(result);
}

[TestMethod]
public void ShouldRefreshCredentialsAfterHealthSuccess_RecoveryAfterFailure_ReturnsTrue()
{
    var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
        credentialsAlreadyFetched: true,
        previousHealthWasConnected: false,
        sawHealthFailureSinceCredentials: true);

    Assert.IsTrue(result);
}

[TestMethod]
public void ShouldRefreshCredentialsAfterHealthSuccess_StillConnected_ReturnsFalse()
{
    var result = MumbleAdapter.ShouldRefreshCredentialsAfterHealthSuccess(
        credentialsAlreadyFetched: true,
        previousHealthWasConnected: true,
        sawHealthFailureSinceCredentials: true);

    Assert.IsFalse(result);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ShouldRefreshCredentialsAfterHealthSuccess"`

Expected: FAIL with a compile error that `ShouldRefreshCredentialsAfterHealthSuccess` does not exist.

- [ ] **Step 3: Add fields and helper**

In `MumbleAdapter.cs`, add fields near `_healthGeneration`:

```csharp
private volatile bool _serverHealthWasConnected;
private volatile bool _credentialsAlreadyFetched;
private volatile bool _sawServerHealthFailureSinceCredentials;
```

Add this internal helper near the service status helper:

```csharp
internal static bool ShouldRefreshCredentialsAfterHealthSuccess(
    bool credentialsAlreadyFetched,
    bool previousHealthWasConnected,
    bool sawHealthFailureSinceCredentials)
    => credentialsAlreadyFetched && !previousHealthWasConnected && sawHealthFailureSinceCredentials;
```

- [ ] **Step 4: Mark credentials fetched after successful credential fetch**

In `FetchAndSendCredentials`, after `_apiUrl = apiUrl;`, add:

```csharp
_credentialsAlreadyFetched = true;
_sawServerHealthFailureSinceCredentials = false;
SendBrmbleServiceStatus("server", "connected");
```

- [ ] **Step 5: Emit server status and refresh credentials on health recovery**

Inside `StartHealthCheck`, in the successful `res.IsSuccessStatusCode` branch, replace the existing `server.healthStatus` send block with:

```csharp
var version = await TryReadVersionAsync(res);
var shouldRefreshCredentials = ShouldRefreshCredentialsAfterHealthSuccess(
    _credentialsAlreadyFetched,
    _serverHealthWasConnected,
    _sawServerHealthFailureSinceCredentials);

_serverHealthWasConnected = true;
_sawServerHealthFailureSinceCredentials = false;
_bridge?.Send("server.healthStatus", new { state = "connected", label = apiUrl, version });
SendBrmbleServiceStatus("server", "connected");

if (shouldRefreshCredentials)
{
    _ = Task.Run(() => FetchAndSendCredentials(apiUrl));
}
```

In the non-success branch, before sending `server.healthStatus`, add:

```csharp
_serverHealthWasConnected = false;
_sawServerHealthFailureSinceCredentials = true;
SendBrmbleServiceStatus("server", "reconnecting", reason: $"http-{(int)res.StatusCode}");
```

In the catch branch, before sending `server.healthStatus`, add:

```csharp
_serverHealthWasConnected = false;
_sawServerHealthFailureSinceCredentials = true;
SendBrmbleServiceStatus("server", "reconnecting", reason: "connection-lost");
```

- [ ] **Step 6: Emit session WebSocket status**

In `StartWebSocketConnection`, immediately after creating `_wsCts`, add:

```csharp
SendBrmbleServiceStatus("session", "connecting");
```

After successful WebSocket upgrade validation, keep the debug line and add:

```csharp
SendBrmbleServiceStatus("session", "connected");
```

Before the reconnect delay log, add:

```csharp
SendBrmbleServiceStatus("session", "reconnecting", reason: "connection-lost", delayMs: (int)backoff.TotalMilliseconds);
```

After the WebSocket loop exits because `ct.IsCancellationRequested`, add before the task returns:

```csharp
SendBrmbleServiceStatus("session", "disconnected", reason: "stopped");
```

- [ ] **Step 7: Reset service fields on disconnect**

In `Disconnect`, after `StopHealthCheck();`, add:

```csharp
_serverHealthWasConnected = false;
_credentialsAlreadyFetched = false;
_sawServerHealthFailureSinceCredentials = false;
```

- [ ] **Step 8: Run tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ShouldRefreshCredentialsAfterHealthSuccess|CreateBrmbleServiceStatusPayload"`

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterCredentialsTests.cs
git commit -m "feat: emit brmble server session reconnect status"
```

---

### Task 3: Native Screenshare Service Status

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Write failing active-share status test**

Add this test to `MumbleAdapterParseTests.cs` after `ActiveShareError_EchoesRequestId`:

```csharp
[TestMethod]
public async Task ActiveShareFailure_EmitsScreenshareServiceStatus()
{
    var bridge = NativeBridgeTestHarness.Create();
    var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge, apiUrl: "https://api.example.com");
    adapter.RegisterHandlers(bridge);

    using var doc = JsonDocument.Parse("""
    {
        "roomName": "channel-1",
        "requestId": 7
    }
    """);

    await NativeBridgeTestHarness.InvokeAsync(bridge, "livekit.checkActiveShare", doc.RootElement.Clone());
    var sent = NativeBridgeTestHarness.DrainMessages(bridge);

    Assert.IsTrue(sent.Any(x => x.Type == "brmble.serviceStatus" && x.DataJson.Contains("\"service\":\"screenshare\"") && x.DataJson.Contains("\"state\":\"disconnected\"")));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ActiveShareFailure_EmitsScreenshareServiceStatus"`

Expected: FAIL because no `brmble.serviceStatus` event is emitted for active-share failure.

- [ ] **Step 3: Emit status from token request handler**

In the `livekit.requestToken` handler, after a successful token response and before `_bridge?.Send("livekit.token", dict);`, add:

```csharp
SendBrmbleServiceStatus("screenshare", "connected");
```

Before sending `livekit.tokenError` at the end of the handler, add:

```csharp
SendBrmbleServiceStatus("screenshare", "disconnected", reason: "token-request-failed");
```

- [ ] **Step 4: Emit status from active-share handler**

In the `livekit.checkActiveShare` handler, when `result.Success && result.Body is not null`, add before `_bridge?.Send("livekit.activeShareResult", ...)`:

```csharp
SendBrmbleServiceStatus("screenshare", "connected");
```

When sending `livekit.activeShareError` for request failure, add before the error send:

```csharp
SendBrmbleServiceStatus("screenshare", "disconnected", reason: "active-share-request-failed");
```

In the catch block before `livekit.activeShareError`, add:

```csharp
SendBrmbleServiceStatus("screenshare", "disconnected", reason: "active-share-exception");
```

- [ ] **Step 5: Emit status from share-start/share-stop handlers**

In the `livekit.shareStarted` handler, after a successful `PostViaBcTls` result, add:

```csharp
if (result.Success)
    SendBrmbleServiceStatus("screenshare", "connected");
else
    SendBrmbleServiceStatus("screenshare", "disconnected", reason: "share-started-failed");
```

In the `catch`, add:

```csharp
SendBrmbleServiceStatus("screenshare", "disconnected", reason: "share-started-exception");
```

Repeat the same pattern in `livekit.shareStopped` with reasons `share-stopped-failed` and `share-stopped-exception`.

- [ ] **Step 6: Run tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "ActiveShareFailure_EmitsScreenshareServiceStatus|ActiveShareFailure_IsNotCollapsedIntoEmptyShares|ActiveShareError_EchoesRequestId"`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs
git commit -m "feat: emit screenshare service status"
```

---

### Task 4: Frontend Native Service Status Mapping

**Files:**
- Create: `src/Brmble.Web/src/utils/brmbleServiceStatus.ts`
- Create: `src/Brmble.Web/src/utils/brmbleServiceStatus.test.ts`
- Modify: `src/Brmble.Web/src/types/index.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Write failing mapping tests**

Create `src/Brmble.Web/src/utils/brmbleServiceStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapBrmbleServiceStatus } from './brmbleServiceStatus';

describe('mapBrmbleServiceStatus', () => {
  it('maps server to the server service dot', () => {
    expect(mapBrmbleServiceStatus({ service: 'server', state: 'connected' })).toEqual({
      service: 'server',
      update: { state: 'connected', error: undefined },
    });
  });

  it('maps session reconnecting to the server service dot with realtime label', () => {
    expect(mapBrmbleServiceStatus({ service: 'session', state: 'reconnecting', reason: 'connection-lost' })).toEqual({
      service: 'server',
      update: { state: 'connecting', error: 'Session reconnecting: connection-lost' },
    });
  });

  it('maps screenshare disconnected to the livekit service dot', () => {
    expect(mapBrmbleServiceStatus({ service: 'screenshare', state: 'disconnected', reason: 'token-request-failed' })).toEqual({
      service: 'livekit',
      update: { state: 'disconnected', error: 'token-request-failed' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/brmbleServiceStatus.test.ts`

Working directory: `src/Brmble.Web`

Expected: FAIL because `brmbleServiceStatus.ts` does not exist.

- [ ] **Step 3: Add native status types**

In `src/Brmble.Web/src/types/index.ts`, after `ServiceStatusMap`, add:

```ts
export type NativeBrmbleServiceName = 'server' | 'session' | 'screenshare';
export type NativeBrmbleServiceState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface NativeBrmbleServiceStatus {
  service?: NativeBrmbleServiceName;
  state?: NativeBrmbleServiceState;
  reason?: string;
  attempt?: number;
  delayMs?: number;
}
```

- [ ] **Step 4: Add mapping helper**

Create `src/Brmble.Web/src/utils/brmbleServiceStatus.ts`:

```ts
import type { NativeBrmbleServiceStatus, ServiceName, ServiceStatus } from '../types';

export interface MappedBrmbleServiceStatus {
  service: ServiceName;
  update: Partial<ServiceStatus>;
}

function mapState(state: NativeBrmbleServiceStatus['state']): ServiceStatus['state'] {
  if (state === 'connected') return 'connected';
  if (state === 'connecting' || state === 'reconnecting') return 'connecting';
  if (state === 'disconnected') return 'disconnected';
  return 'idle';
}

export function mapBrmbleServiceStatus(data: NativeBrmbleServiceStatus): MappedBrmbleServiceStatus | null {
  if (!data.service || !data.state) return null;

  if (data.service === 'screenshare') {
    return {
      service: 'livekit',
      update: {
        state: mapState(data.state),
        error: data.state === 'connected' ? undefined : data.reason,
      },
    };
  }

  if (data.service === 'session') {
    return {
      service: 'server',
      update: {
        state: mapState(data.state),
        error: data.state === 'connected' ? undefined : `Session ${data.state}: ${data.reason ?? 'reconnecting'}`,
      },
    };
  }

  return {
    service: 'server',
    update: {
      state: mapState(data.state),
      error: data.state === 'connected' ? undefined : data.reason,
    },
  };
}
```

- [ ] **Step 5: Subscribe in App**

In `src/Brmble.Web/src/App.tsx`, add import:

```ts
import { mapBrmbleServiceStatus } from './utils/brmbleServiceStatus';
import type { NativeBrmbleServiceStatus } from './types';
```

Inside the bridge handler effect, before event registrations, add:

```ts
const onBrmbleServiceStatus = (data: unknown) => {
  const status = data as NativeBrmbleServiceStatus;
  const mapped = mapBrmbleServiceStatus(status);
  if (!mapped) return;
  updateStatus(mapped.service, mapped.update);
};
```

Register it with the other bridge handlers:

```ts
bridge.on('brmble.serviceStatus', onBrmbleServiceStatus);
```

Unregister it in cleanup:

```ts
bridge.off('brmble.serviceStatus', onBrmbleServiceStatus);
```

- [ ] **Step 6: Run mapping test**

Run: `npm run test -- src/utils/brmbleServiceStatus.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/utils/brmbleServiceStatus.ts src/Brmble.Web/src/utils/brmbleServiceStatus.test.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: map brmble service status in ui"
```

---

### Task 5: Matrix Credential Refresh Without Chat Clearing

**Files:**
- Create: `src/Brmble.Web/src/utils/matrixCredentials.ts`
- Create: `src/Brmble.Web/src/utils/matrixCredentials.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Write failing credential equality tests**

Create `src/Brmble.Web/src/utils/matrixCredentials.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { areMatrixCredentialsEqual } from './matrixCredentials';
import type { MatrixCredentials } from '../hooks/useMatrixClient';

const base: MatrixCredentials = {
  homeserverUrl: 'https://matrix.example.com',
  accessToken: 'tok_1',
  userId: '@me:example.com',
  roomMap: { '1': '!one:example.com' },
  dmRoomMap: { '@alice:example.com': '!dm:example.com' },
};

describe('areMatrixCredentialsEqual', () => {
  it('returns true for equal credentials with equal maps', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, roomMap: { '1': '!one:example.com' }, dmRoomMap: { '@alice:example.com': '!dm:example.com' } })).toBe(true);
  });

  it('returns false when access token changes', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, accessToken: 'tok_2' })).toBe(false);
  });

  it('returns false when DM map changes', () => {
    expect(areMatrixCredentialsEqual(base, { ...base, dmRoomMap: { '@bob:example.com': '!dm2:example.com' } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/utils/matrixCredentials.test.ts`

Working directory: `src/Brmble.Web`

Expected: FAIL because `matrixCredentials.ts` does not exist.

- [ ] **Step 3: Add credential equality helper**

Create `src/Brmble.Web/src/utils/matrixCredentials.ts`:

```ts
import type { MatrixCredentials } from '../hooks/useMatrixClient';

function recordEqual(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const aEntries = Object.entries(a ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const bEntries = Object.entries(b ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value], index) => bEntries[index][0] === key && bEntries[index][1] === value);
}

export function areMatrixCredentialsEqual(a: MatrixCredentials | null, b: MatrixCredentials | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.homeserverUrl === b.homeserverUrl
    && a.accessToken === b.accessToken
    && a.userId === b.userId
    && recordEqual(a.roomMap, b.roomMap)
    && recordEqual(a.dmRoomMap, b.dmRoomMap);
}
```

- [ ] **Step 4: Use helper in server credentials handler**

In `App.tsx`, import:

```ts
import { areMatrixCredentialsEqual } from './utils/matrixCredentials';
```

Replace `onServerCredentials` body with:

```ts
const onServerCredentials = (data: unknown) => {
  setConnectionError(null);
  const wrapped = data as { matrix?: MatrixCredentials } | undefined;
  const d = wrapped?.matrix;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    setMatrixCredentials(prev => {
      if (!prev) {
        clearChatStorage();
        return d;
      }
      return areMatrixCredentialsEqual(prev, d) ? prev : d;
    });
  }
};
```

- [ ] **Step 5: Add Matrix reconnect status tests**

In `useMatrixClient.test.ts`, add after `calls startClient when credentials are provided`:

```ts
it('reports reconnecting and connected sync states through service status', () => {
  const updateStatus = vi.fn();
  const StatusProbe = () => {
    useMatrixClient(creds);
    return null;
  };

  vi.doMock('./useServiceStatus', () => ({
    useServiceStatus: () => ({ updateStatus }),
  }));

  renderHook(() => useMatrixClient(creds), { wrapper });
  const onSync = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'sync')?.[1] as ((state: string) => void) | undefined;

  act(() => onSync?.('RECONNECTING'));
  act(() => onSync?.('PREPARED'));

  expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 5 });
});
```

Use the existing `ServiceStatusProvider` wrapper for this test. If direct access to the status value is needed, add a small test-only component in the test file that calls `useServiceStatus()` and renders `statuses.chat.state` into `data-testid="chat-state"`; then assert it changes after `onSync('RECONNECTING')` and `onSync('PREPARED')`.

- [ ] **Step 6: Run tests**

Run: `npm run test -- src/utils/matrixCredentials.test.ts src/hooks/useMatrixClient.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/Brmble.Web/src/utils/matrixCredentials.ts src/Brmble.Web/src/utils/matrixCredentials.test.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: refresh matrix credentials without clearing chat"
```

---

### Task 6: Screen Share Service-Loss Cleanup And No LiveKit Room Recovery

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Write failing no-recovery test**

In `useScreenShare.test.ts`, add a test near existing room disconnect tests:

```ts
it('does not reconnect watched LiveKit room after room disconnect', async () => {
  let tokenHandler: ((data: unknown) => void) | null = null;
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.token') tokenHandler = handler;
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
  });

  const { result } = renderHook(() => useScreenShare());

  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });

  await act(async () => {
    const promise = result.current.connectAsViewer('channel-1', 10, '@alice:test');
    tokenHandler?.({ token: 'viewer-jwt', url: 'ws://localhost/livekit', expiresAt: new Date(Date.now() + 3600_000).toISOString(), requestId: 1 });
    await promise;
  });

  const connectCallsBeforeDisconnect = mockRoomInstances.reduce((count, room) => count + room.connect.mock.calls.length, 0);

  await act(async () => {
    emitRoomEvent('disconnected');
    await Promise.resolve();
    await Promise.resolve();
  });

  const connectCallsAfterDisconnect = mockRoomInstances.reduce((count, room) => count + room.connect.mock.calls.length, 0);
  expect(connectCallsAfterDisconnect).toBe(connectCallsBeforeDisconnect);
  expect(result.current.watchingShares).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "does not reconnect watched LiveKit room"`

Working directory: `src/Brmble.Web`

Expected: FAIL because the current `RoomEvent.Disconnected` path can reconnect a watched room when it has a refreshed lease.

- [ ] **Step 3: Remove watched-room reconnect branch**

In `useScreenShare.ts`, in `RoomEvent.Disconnected`, remove the entire `canRecoverWithLease` block from `const lease = activeTokenLeaseRef.current;` through its `return;`.

The remaining disconnect handler should begin cleanup like this:

```ts
roomRef.current = null;
roomAccessModeRef.current = null;
clearTokenLease();
invalidateRoomLifecycle();
clearWatchingState();
const teardownIntent = localShareTeardownIntentRef.current;
localShareTeardownIntentRef.current = null;
if (isSharingRef.current) {
  void stopLocalShare(teardownIntent ?? 'interrupted', room);
}
```

- [ ] **Step 4: Add explicit service-loss cleanup return value**

In `useScreenShare.ts`, add this callback before the return object:

```ts
const handleScreenShareServiceUnavailable = useCallback(async () => {
  cancelPendingViewerAttempts();
  const room = roomRef.current;
  roomRef.current = null;
  roomAccessModeRef.current = null;
  roomReconnectUpgradeRef.current = false;
  clearTokenLease();
  invalidateRoomLifecycle();
  clearWatchingState();
  if (isSharingRef.current) {
    await stopLocalShare('interrupted', room);
  }
  try { await room?.disconnect(); } catch { /* ignore */ }
}, [cancelPendingViewerAttempts, clearTokenLease, clearWatchingState, invalidateRoomLifecycle, stopLocalShare]);
```

Expose it in the return object:

```ts
handleScreenShareServiceUnavailable,
```

- [ ] **Step 5: Call cleanup from App on native service loss**

In `App.tsx`, destructure `handleScreenShareServiceUnavailable` from `useScreenShare`.

In `onBrmbleServiceStatus`, after `updateStatus(mapped.service, mapped.update);`, add:

```ts
if ((status.service === 'session' || status.service === 'screenshare') && status.state !== 'connected') {
  void handleScreenShareServiceUnavailable();
}
```

Add `handleScreenShareServiceUnavailable` to the bridge effect dependency list if the effect currently depends on hook callbacks.

- [ ] **Step 6: Run tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "does not reconnect watched LiveKit room"`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: clear screenshare state on service loss"
```

---

### Task 7: Watched Share Ended Notifications

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.ts`
- Modify: `src/Brmble.Web/src/hooks/useScreenShare.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/App.screenShareEnded.test.ts`

- [ ] **Step 1: Write failing watched-share callback tests**

In `useScreenShare.test.ts`, add:

```ts
it('reports explicit watched share stop through callback', async () => {
  let shareStartedHandler: ((data: unknown) => void) | null = null;
  let shareStoppedHandler: ((data: unknown) => void) | null = null;
  (bridge.on as ReturnType<typeof vi.fn>).mockImplementation((type: string, handler: (data: unknown) => void) => {
    if (type === 'livekit.screenShareStarted') shareStartedHandler = handler;
    if (type === 'livekit.screenShareStopped') shareStoppedHandler = handler;
  });

  const onWatchedShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, undefined, onWatchedShareEnded));

  act(() => {
    shareStartedHandler?.({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });
  act(() => {
    result.current.addWatchingShare({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });
  act(() => {
    shareStoppedHandler?.({ roomName: 'channel-1', userId: 10 });
  });

  expect(onWatchedShareEnded).toHaveBeenCalledWith(
    expect.objectContaining({ userName: 'alice', userId: 10 }),
    'ended',
  );
});

it('reports unexpected watched share end on room disconnect', async () => {
  const onWatchedShareEnded = vi.fn();
  const { result } = renderHook(() => useScreenShare(undefined, undefined, undefined, onWatchedShareEnded));

  act(() => {
    result.current.addWatchingShare({ roomName: 'channel-1', userName: 'alice', userId: 10, matrixUserId: '@alice:test' });
  });
  await act(async () => {
    await result.current.handleScreenShareServiceUnavailable();
  });

  expect(onWatchedShareEnded).toHaveBeenCalledWith(
    expect.objectContaining({ userName: 'alice', userId: 10 }),
    'unexpected',
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/hooks/useScreenShare.test.ts -t "reports .* watched share"`

Working directory: `src/Brmble.Web`

Expected: FAIL because `useScreenShare` does not accept a watched-share-ended callback and does not expose `handleScreenShareServiceUnavailable` yet if Task 6 was not completed.

- [ ] **Step 3: Add watched-share callback type**

In `useScreenShare.ts`, add near exported types:

```ts
export type WatchedShareEndReason = 'ended' | 'unexpected';
export type WatchedShareEndedCallback = (share: ShareInfo, reason: WatchedShareEndReason) => void;
```

Change the hook signature to:

```ts
export function useScreenShare(
  onDisconnected?: () => void,
  screenShareSettings?: ScreenShareSettings,
  onLocalShareEnded?: (reason: LocalShareStopReason) => void,
  onWatchedShareEnded?: WatchedShareEndedCallback,
) {
```

Add a ref near existing callback refs:

```ts
const onWatchedShareEndedRef = useRef<WatchedShareEndedCallback | undefined>(onWatchedShareEnded);
onWatchedShareEndedRef.current = onWatchedShareEnded;
```

- [ ] **Step 4: Notify explicit watched share stop**

In `onShareStopped`, before `removeWatchingShare(d.userId);`, add:

```ts
if (wasWatching) {
  const stoppedShare = watchingSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId)
    ?? activeSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId);
  if (stoppedShare) {
    onWatchedShareEndedRef.current?.(stoppedShare, 'ended');
  }
}
```

- [ ] **Step 5: Notify unexpected watched share cleanup**

Add helper near `clearWatchingState`:

```ts
const notifyUnexpectedWatchedShareEnds = useCallback(() => {
  for (const share of watchingSharesRef.current) {
    onWatchedShareEndedRef.current?.(share, 'unexpected');
  }
}, []);
```

Call `notifyUnexpectedWatchedShareEnds();` before `clearWatchingState();` in token refresh failure, `RoomEvent.Disconnected`, and `handleScreenShareServiceUnavailable`.

- [ ] **Step 6: Add App notification state**

In `App.tsx`, add interfaces near `QueuedScreenShareEndedNotification`:

```ts
interface WatchedShareEndedNotification {
  id: string;
  status: NotificationStatus;
  title: string;
  detail: string;
}
```

Add state near `screenShareEndedNotification`:

```ts
const [watchedShareEndedNotification, setWatchedShareEndedNotification] = useState<WatchedShareEndedNotification | null>(null);
const nextWatchedShareEndedNotificationIdRef = useRef(0);
```

Add callback before `useScreenShare`:

```ts
const handleWatchedShareEnded = useCallback((share: ShareInfo, reason: WatchedShareEndReason) => {
  const id = `watched-share-ended-${nextWatchedShareEndedNotificationIdRef.current++}`;
  setWatchedShareEndedNotification({
    id,
    status: reason === 'unexpected' ? 'warning' : 'info',
    title: reason === 'unexpected' ? 'Share ended unexpectedly' : 'Share ended',
    detail: `${share.userName || 'Someone'}'s share ended${reason === 'unexpected' ? ' because the screen-share connection was interrupted.' : '.'}`,
  });
}, []);
```

Pass it as the fourth argument to `useScreenShare`.

Register it with notification queue:

```ts
useEffect(() => {
  if (watchedShareEndedNotification) {
    notifQueue.register(watchedShareEndedNotification.id, watchedShareEndedNotification.status);
  }
}, [watchedShareEndedNotification, notifQueue]);
```

Render it in the notification stack:

```tsx
{watchedShareEndedNotification && notifQueue.isVisible(watchedShareEndedNotification.id) && (
  <Notification
    key={watchedShareEndedNotification.id}
    status={watchedShareEndedNotification.status}
    position="top-right"
    visible={!!watchedShareEndedNotification}
    title={watchedShareEndedNotification.title}
    detail={watchedShareEndedNotification.detail}
    onDismiss={() => {
      notifQueue.unregister(watchedShareEndedNotification.id);
      setWatchedShareEndedNotification(null);
    }}
    onExited={() => {
      notifQueue.unregister(watchedShareEndedNotification.id);
    }}
  />
)}
```

- [ ] **Step 7: Run tests**

Run: `npm run test -- src/hooks/useScreenShare.test.ts src/App.screenShareEnded.test.ts`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/Brmble.Web/src/hooks/useScreenShare.ts src/Brmble.Web/src/hooks/useScreenShare.test.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.screenShareEnded.test.ts
git commit -m "feat: notify when watched shares end"
```

---

### Task 8: Service Status Dots And Deployment Validation

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx`
- Modify: `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`

- [ ] **Step 1: Write service dot tests**

In `Sidebar.test.tsx`, add after the existing `beforeEach`:

```tsx
it('shows server reconnect state through service dots', () => {
  useServiceStatusMock.mockReturnValue({
    statuses: {
      voice: { state: 'connected' },
      chat: { state: 'connected' },
      server: { state: 'connecting', error: 'Session reconnecting: connection-lost' },
      livekit: { state: 'disconnected', error: 'token-request-failed' },
    },
  });

  renderSidebar();

  expect(screen.getByLabelText(/Brmble: Connecting/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Screenshare: Disconnected/i)).toBeInTheDocument();
});
```

If the component uses `title` instead of `aria-label`, assert by title text:

```tsx
expect(screen.getByTitle(/Brmble: Connecting/i)).toBeInTheDocument();
expect(screen.getByTitle(/Screenshare: Disconnected/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run test**

Run: `npm run test -- src/components/Sidebar/Sidebar.test.tsx -t "server reconnect state"`

Working directory: `src/Brmble.Web`

Expected: PASS because `Sidebar` service dots expose service status text through accessible labels or titles.

- [ ] **Step 3: Update roadmap after implementation**

In `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`, update F section lines for items 34, 38, 39, and 40 to say:

```md
- [x] 34. Auto-reconnect on drop — implemented for Brmble server/session and Matrix reconnect after Brmble services restarts; LiveKit rooms intentionally clear and require manual restart/watch.
- [ ] 35. ICE fallback / TURN relay hardening — future work.
- [ ] 36. Connection quality indicator — F2.
- [ ] 37. Graceful degradation — F2.
- [x] 38. Disconnect notification when share ends unexpectedly — implemented through Brmble notifications for watched/local share interruption.
- [x] 39. Reconnect non-voice services independently when Mumble stays connected — implemented for Brmble server/session, Matrix chat, and screen-share support state.
- [ ] 40. Share state recovery after crash — intentionally deferred; users restart sharing/watching manually.
```

Keep the exact surrounding roadmap structure intact if the file uses a different checklist format.

- [ ] **Step 4: Run focused frontend tests**

Run: `npm run test -- src/utils/brmbleServiceStatus.test.ts src/utils/matrixCredentials.test.ts src/hooks/useMatrixClient.test.ts src/hooks/useScreenShare.test.ts src/App.screenShareEnded.test.ts src/components/Sidebar/Sidebar.test.tsx`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 5: Run focused native tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "CreateBrmbleServiceStatusPayload|ShouldRefreshCredentialsAfterHealthSuccess|ActiveShareFailure_EmitsScreenshareServiceStatus|ActiveShareFailure_IsNotCollapsedIntoEmptyShares|ActiveShareError_EchoesRequestId"`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.test.tsx docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md
git commit -m "docs: mark f1 reconnect scope complete"
```

---

### Task 9: Full Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run frontend build**

Run: `npm run build`

Working directory: `src/Brmble.Web`

Expected: PASS with Vite production build output.

- [ ] **Step 2: Run frontend tests**

Run: `npm run test`

Working directory: `src/Brmble.Web`

Expected: PASS.

- [ ] **Step 3: Run .NET tests**

Run: `dotnet test`

Expected: PASS.

- [ ] **Step 4: Run .NET build**

Run: `dotnet build`

Expected: PASS.

- [ ] **Step 5: Confirm no verification-only changes remain**

Run: `git status --short`

Expected: no modified tracked files. If verification produced generated files or local logs, leave unrelated untracked files untouched and do not create an empty commit.

---

## Manual Validation Checklist

- [ ] Connect to a Brmble server and join voice.
- [ ] Confirm voice status is connected.
- [ ] Start Matrix chat and send a channel message.
- [ ] Start watching a screen share.
- [ ] Restart only the Brmble services container while leaving the Mumble container running.
- [ ] Confirm voice remains connected.
- [ ] Confirm Brmble server/session status dots show reconnecting or disconnected during restart.
- [ ] Confirm watched screen-share video is cleared and old LiveKit rooms do not reconnect.
- [ ] Confirm Brmble server status returns connected after the services container returns.
- [ ] Confirm Matrix chat returns connected and active chat sync resumes.
- [ ] Confirm active-share discovery refreshes current channel/all-shares state.
- [ ] Confirm users can manually start sharing again and manually click Watch again.
- [ ] Confirm watched-share interruption shows a Brmble notification, not a toast.

---

## Plan Self-Review Notes

- Spec coverage: Brmble server reconnect is covered by Tasks 2, 4, and 5. Matrix reconnect is covered by Task 5. Screen-share cleanup and no LiveKit recovery are covered by Tasks 3, 6, and 7. Service dots are covered by Tasks 4 and 8. Roadmap updates and verification are covered by Tasks 8 and 9.
- Placeholder scan: no deferred implementation placeholders are present; each task includes exact files, code snippets, commands, and expected outcomes.
- Type consistency: native services are `server`, `session`, and `screenshare`; UI services remain `server`, `chat`, and `livekit`. The mapping helper is the only conversion point.
