# Channel Password Reconnect Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After saving a channel password, reconnect with `Authenticate.tokens` and then automatically try to enter the target channel without using temporary access tokens.

**Architecture:** The frontend includes a one-shot `channelId` target in `voice.reconnect`. The native client stores that target for the next reconnect, attempts a passwordless join after `ServerSync`, and clears the target immediately after the attempt.

**Tech Stack:** React + TypeScript + Vitest frontend; C# Win32/WebView2 client; MSTest native tests.

---

## File Map

- `src/Brmble.Web/src/App.tsx`: send reconnect target from channel password prompt flows.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`: send reconnect target from Edit Saved Password.
- `src/Brmble.Web/src/App.screenShareStart.test.ts`: assert password prompt reconnect payload includes `channelId`.
- `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`: assert edit-password reconnect payload includes `channelId`.
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`: parse reconnect target, store it, and join after reconnect `ServerSync`.
- `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`: assert reconnect handler accepts target channel.
- `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`: assert post-reconnect target is joined and cleared.

## Task 1: Frontend reconnect payload tests

**Files:**
- Modify: `src/Brmble.Web/src/App.screenShareStart.test.ts`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`

- [ ] **Step 1: Update failing App tests**

In `src/Brmble.Web/src/App.screenShareStart.test.ts`, update password-save expectations from:

```ts
expect(bridge.send).toHaveBeenCalledWith('voice.reconnect');
```

to:

```ts
expect(bridge.send).toHaveBeenCalledWith('voice.reconnect', { channelId: 2 });
```

- [ ] **Step 2: Update failing ChannelTree tests**

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.test.tsx`, update Edit Saved Password reconnect expectations from:

```ts
expect(bridgeMock.send).toHaveBeenCalledWith('voice.reconnect');
```

to:

```ts
expect(bridgeMock.send).toHaveBeenCalledWith('voice.reconnect', { channelId: 5 });
```

- [ ] **Step 3: Run tests to verify frontend red**

Run:

```powershell
npm test -- src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx
```

Expected: FAIL because production code still sends `voice.reconnect` without a payload.

## Task 2: Frontend reconnect target implementation

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

- [ ] **Step 1: Send channel target from App**

In `src/Brmble.Web/src/App.tsx`, change `saveChannelPasswordAndReconnect` to send the channel ID:

```ts
bridge.send('voice.saveChannelPassword', { channelId, channelName, password: normalized });
bridge.send('voice.reconnect', { channelId });
```

- [ ] **Step 2: Send channel target from ChannelTree**

In `src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`, change the reconnect send to:

```ts
bridge.send('voice.reconnect', { channelId: channelContextMenu.channelId });
```

- [ ] **Step 3: Run frontend tests to verify green**

Run:

```powershell
npm test -- src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx
```

Expected: PASS.

## Task 3: Native reconnect target tests

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`
- Modify: `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`

- [ ] **Step 1: Add bridge handler target test**

In `tests/Brmble.Client.Tests/Services/MumbleAdapterBridgeTests.cs`, add an assertion to `Reconnect_HandlerEmitsReconnectingWhenCredentialsAreAvailable` after invoking `voice.reconnect` with a payload:

```csharp
await NativeBridgeTestHarness.InvokeAsync(bridge, "voice.reconnect", JsonSerializer.SerializeToElement(new { channelId = 5 }));

Assert.AreEqual(5u, GetPrivateField<uint?>(adapter, "_reconnectTargetChannelId"));
```

Add helper if needed:

```csharp
private static T GetPrivateField<T>(object instance, string name)
    => (T)instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(instance)!;
```

- [ ] **Step 2: Add post-ServerSync join test**

In `tests/Brmble.Client.Tests/Services/MumbleAdapterParseTests.cs`, add a test that sets `_isReconnect = true` and `_reconnectTargetChannelId = 5`, invokes `ServerSync`, and asserts `_pendingLocalJoinChannelId` becomes `5` and `_reconnectTargetChannelId` becomes `null`.

```csharp
[TestMethod]
public void ServerSync_JoinsReconnectTargetAfterAuthenticateTokensApply()
{
    var bridge = NativeBridgeTestHarness.Create();
    var adapter = MumbleAdapterTestHarness.CreateWithBridge(bridge);
    var connection = new MumbleConnection(new IPEndPoint(IPAddress.Loopback, 64738), adapter, voiceSupport: false);
    adapter.Initialise(connection);
    typeof(MumbleConnection).GetProperty(nameof(MumbleConnection.State))!.SetValue(connection, ConnectionStates.Connected);
    MumbleAdapterTestHarness.SetField(adapter, "_isReconnect", true);
    MumbleAdapterTestHarness.SetField(adapter, "_reconnectTargetChannelId", 5u);

    adapter.ServerSync(new ServerSync { Session = 1 });

    Assert.AreEqual(5u, MumbleAdapterTestHarness.GetField<uint?>(adapter, "_pendingLocalJoinChannelId"));
    Assert.IsNull(MumbleAdapterTestHarness.GetField<uint?>(adapter, "_reconnectTargetChannelId"));
}
```

- [ ] **Step 3: Run native tests to verify red**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "Reconnect_Handler|ServerSync_JoinsReconnectTarget" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: FAIL because `_reconnectTargetChannelId` does not exist yet and native does not join after reconnect.

## Task 4: Native reconnect target implementation

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

- [ ] **Step 1: Add field**

Near existing reconnect fields in `MumbleAdapter.cs`, add:

```csharp
private uint? _reconnectTargetChannelId;
```

- [ ] **Step 2: Parse target in `voice.reconnect` handler**

In the `voice.reconnect` handler, before `Disconnect()`, add:

```csharp
_reconnectTargetChannelId = data.TryGetProperty("channelId", out var channelIdEl) &&
    channelIdEl.ValueKind == System.Text.Json.JsonValueKind.Number &&
    channelIdEl.TryGetUInt32(out var channelId)
        ? channelId
        : null;
```

- [ ] **Step 3: Join after reconnect ServerSync**

After reconnect channel-state handling in `ServerSync`, before `_isReconnect = false`, add:

```csharp
if (_isReconnect && _reconnectTargetChannelId is { } reconnectTargetChannelId)
{
    _reconnectTargetChannelId = null;
    JoinChannel(reconnectTargetChannelId);
    voiceConnectedChannelId = reconnectTargetChannelId;
}
```

- [ ] **Step 4: Clear stale target on disconnect paths**

When reconnect is no longer possible or intentional disconnect clears reconnect state, also set:

```csharp
_reconnectTargetChannelId = null;
```

- [ ] **Step 5: Run native tests to verify green**

Run:

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "Reconnect_Handler|ServerSync_JoinsReconnectTarget" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: PASS.

## Task 5: Final verification

**Files:**
- No edits unless tests fail.

- [ ] **Step 1: Run focused frontend tests**

```powershell
npm test -- src/App.screenShareStart.test.ts src/components/Sidebar/ChannelTree.test.tsx src/App.chatMode.test.ts src/utils/channelPasswords.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused native tests**

```powershell
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter "Reconnect_Handler|SaveChannelPassword_Handler|GetChannelPassword_Handler|ServerSync_JoinsReconnectTarget" -p:OutputPath=bin\Debug\net10.0-windows\test-isolated\
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 4: Build client**

```powershell
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: PASS.
