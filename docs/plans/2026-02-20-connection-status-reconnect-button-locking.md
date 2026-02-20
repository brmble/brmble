# Connection Status, Auto-Reconnect & Button Locking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a rich connection status indicator to the sidebar (#75), auto-reconnect on unexpected drops (#66), and lock channel/voice buttons while server confirmation is pending (#73).

**Architecture:** Replace the boolean `connected` state with a `ConnectionStatus` union type in TypeScript. Add a reconnect loop in `MumbleAdapter.cs` that emits `voice.reconnecting` / `voice.reconnectFailed`. Frontend reacts to the new events; button locking uses a `pendingChannelAction` state with a 5s timeout fallback.

**Tech Stack:** C# (.NET 8, MumbleSharp), React 18 + TypeScript, Vite, WebView2 bridge

---

## Task 1: Add `ConnectionStatus` type to the frontend

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`

**Step 1: Add the type**

Open `src/Brmble.Web/src/types/index.ts` and append at the end:

```ts
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
```

**Step 2: Verify it compiles**

```bash
cd src/Brmble.Web && npm run build
```

Expected: build succeeds (no TS errors from just adding a type).

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add ConnectionStatus type to frontend types"
```

---

## Task 2: Replace `connected: boolean` with `connectionStatus` in `App.tsx`

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Replace state declaration**

Find:
```ts
const [connected, setConnected] = useState(false);
```
Replace with:
```ts
const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
```

Add import at top if not already present:
```ts
import type { ConnectionStatus } from './types';
```

**Step 2: Update `onVoiceConnected` handler**

Find the line inside `onVoiceConnected` that calls `setConnected(true)` and replace:
```ts
setConnected(true);
```
with:
```ts
setConnectionStatus('connected');
```

**Step 3: Update `onVoiceDisconnected` handler**

Find the line inside `onVoiceDisconnected` that calls `setConnected(false)` and replace:
```ts
setConnected(false);
```
with:
```ts
setConnectionStatus('idle');
```

**Step 4: Update `handleConnect` to set `connecting` on send**

Find `handleConnect` (the function that calls `bridge.send('voice.connect', ...)`). Just before the `bridge.send(...)` call add:
```ts
setConnectionStatus('connecting');
```

**Step 5: Register `voice.reconnecting` and `voice.reconnectFailed` handlers**

Inside the `useEffect` that registers bridge handlers, add:

```ts
const onVoiceReconnecting = () => {
  setConnectionStatus('reconnecting');
};
const onVoiceReconnectFailed = () => {
  setConnectionStatus('failed');
};
bridge.on('voice.reconnecting', onVoiceReconnecting);
bridge.on('voice.reconnectFailed', onVoiceReconnectFailed);
```

And in the cleanup return:
```ts
bridge.off('voice.reconnecting', onVoiceReconnecting);
bridge.off('voice.reconnectFailed', onVoiceReconnectFailed);
```

**Step 6: Add `handleCancelReconnect`**

Near `handleDisconnect`, add:
```ts
const handleCancelReconnect = () => {
  bridge.send('voice.cancelReconnect');
};
```

**Step 7: Derive backwards-compatible `connected` boolean for any remaining consumers**

At the point where `connected` was used, derive it:
```ts
const connected = connectionStatus === 'connected';
```

Or update all usages directly (check with grep for `connected` references).

**Step 8: Update `<Sidebar>` prop**

Find where `<Sidebar connected={connected}` is passed and change to:
```tsx
connectionStatus={connectionStatus}
onCancelReconnect={handleCancelReconnect}
```

**Step 9: Verify build**

```bash
cd src/Brmble.Web && npm run build
```

Expected: Sidebar prop type mismatch errors (expected — Sidebar still uses `connected: boolean`, fixed in Task 3).

**Step 10: Commit (even if build has TS errors — they'll be resolved in Task 3)**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: replace connected boolean with ConnectionStatus in App.tsx"
```

---

## Task 3: Update `Sidebar` props and layout for connection status

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

### Sidebar.tsx

**Step 1: Update `SidebarProps` interface**

Replace:
```ts
connected?: boolean;
```
With:
```ts
connectionStatus?: ConnectionStatus;
onCancelReconnect?: () => void;
```

Add import at top:
```ts
import type { ConnectionStatus } from '../../types';
```

**Step 2: Update all `connected` usages inside the component**

Where the component uses `connected` in render logic, derive it:
```ts
const { connectionStatus = 'idle', onCancelReconnect, ...rest } = props;
const connected = connectionStatus === 'connected';
```

Or add it as a derived const inside the component body.

**Step 3: Make the server info block always visible when `serverLabel` is set**

Change:
```tsx
{connected && (
  <div className={`server-info-panel...`} ...>
```
To:
```tsx
{serverLabel && (
  <div className={`server-info-panel...`} ...>
```

**Step 4: Add the status dot and status text inside the server info panel**

Inside the server info panel, after the `server-info-name` div, add:

```tsx
<div className="server-status-line">
  <span className={`status-dot status-dot--${connectionStatus ?? 'idle'}`} />
  {connectionStatus && connectionStatus !== 'idle' && (
    <span className="status-text">
      {connectionStatus === 'connected' && 'Connected'}
      {connectionStatus === 'connecting' && 'Connecting...'}
      {connectionStatus === 'reconnecting' && 'Reconnecting...'}
      {connectionStatus === 'failed' && 'Disconnected'}
    </span>
  )}
</div>
```

**Step 5: Update the Disconnect button to show "Cancel reconnecting" during reconnect**

Find the disconnect button render and change:
```tsx
{onDisconnect && (
  <button className="disconnect-btn" onClick={onDisconnect}>Disconnect</button>
)}
```
To:
```tsx
{(onDisconnect || onCancelReconnect) && (
  <button
    className="disconnect-btn"
    onClick={connectionStatus === 'reconnecting' ? onCancelReconnect : onDisconnect}
  >
    {connectionStatus === 'reconnecting' ? 'Cancel reconnecting' : 'Disconnect'}
  </button>
)}
```

### Sidebar.css

**Step 6: Add dot + status text styles**

Append to `Sidebar.css`:

```css
/* Connection status line */
.server-status-line {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.25rem;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot--idle        { background: var(--text-muted); opacity: 0.4; }
.status-dot--connecting  { background: var(--accent-lemon); animation: status-blink 0.5s ease-in-out infinite alternate; }
.status-dot--connected   { background: #4caf50; }
.status-dot--reconnecting{ background: var(--accent-lemon); animation: status-blink 0.5s ease-in-out infinite alternate; }
.status-dot--failed      { background: var(--accent-berry); }

@keyframes status-blink {
  from { opacity: 1; }
  to   { opacity: 0.2; }
}

.status-text {
  font-size: 0.6875rem;
  color: var(--text-muted);
}
```

**Step 7: Verify build**

```bash
cd src/Brmble.Web && npm run build
```

Expected: clean build.

**Step 8: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css
git commit -m "feat: add connection status dot and text to sidebar server block (#75)"
```

---

## Task 4: Implement auto-reconnect in `MumbleAdapter.cs`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add fields for reconnect tracking**

Inside the `MumbleAdapter` class, add these fields near the other `bool` fields:

```csharp
private bool _intentionalDisconnect = false;
private CancellationTokenSource? _reconnectCts;
private string? _reconnectHost;
private int _reconnectPort;
private string? _reconnectUsername;
private string? _reconnectPassword;
```

**Step 2: Capture connect parameters for reconnect**

In the `voice.connect` handler (where `Task.Run(() => Connect(h, p, u, pw))` is called), store the parameters:

```csharp
_reconnectHost = h;
_reconnectPort = p;
_reconnectUsername = u;
_reconnectPassword = pw;
_intentionalDisconnect = false;
```

**Step 3: Set `_intentionalDisconnect` in the `voice.disconnect` handler**

Find:
```csharp
bridge.RegisterHandler("voice.disconnect", _ => { Disconnect(); return Task.CompletedTask; });
```
Replace with:
```csharp
bridge.RegisterHandler("voice.disconnect", _ =>
{
    _intentionalDisconnect = true;
    _reconnectCts?.Cancel();
    Disconnect();
    return Task.CompletedTask;
});
```

**Step 4: Register `voice.cancelReconnect` handler**

After the `voice.disconnect` handler registration, add:

```csharp
bridge.RegisterHandler("voice.cancelReconnect", _ =>
{
    _intentionalDisconnect = true;
    _reconnectCts?.Cancel();
    // Emit disconnected so UI transitions to idle
    _bridge?.Send("voice.disconnected", null);
    _bridge?.NotifyUiThread();
    return Task.CompletedTask;
});
```

**Step 5: Add the `ReconnectLoop` method**

Add this method to `MumbleAdapter`:

```csharp
private async Task ReconnectLoop()
{
    var delays = new[] { 2000, 4000, 8000, 16000, 30000 };
    int attempt = 0;
    _reconnectCts = new CancellationTokenSource();
    var token = _reconnectCts.Token;

    while (!token.IsCancellationRequested && !_intentionalDisconnect)
    {
        int delayMs = delays[Math.Min(attempt, delays.Length - 1)];
        _bridge?.Send("voice.reconnecting", new { attempt = attempt + 1, delayMs });
        _bridge?.NotifyUiThread();

        try
        {
            await Task.Delay(delayMs, token);
        }
        catch (OperationCanceledException)
        {
            break;
        }

        if (_intentionalDisconnect || token.IsCancellationRequested)
            break;

        try
        {
            Connect(_reconnectHost!, _reconnectPort, _reconnectUsername!, _reconnectPassword ?? "");
            // Connect is synchronous and sets up the connection; success is confirmed when ServerSync fires
            return; // Exit loop — ServerSync will emit voice.connected
        }
        catch
        {
            // Connect failed; loop continues
        }

        attempt++;
    }

    if (!_intentionalDisconnect)
    {
        _bridge?.Send("voice.reconnectFailed", new { reason = "Cancelled or max attempts" });
        _bridge?.NotifyUiThread();
    }
}
```

**Step 6: Trigger `ReconnectLoop` on unexpected disconnect**

Find the `ProcessLoop` method (the background thread that reads Mumble packets). Locate where it catches socket exceptions or the connection closing unexpectedly, and after the existing cleanup logic add:

```csharp
if (!_intentionalDisconnect && _reconnectHost != null)
{
    Task.Run(() => ReconnectLoop());
}
else
{
    _bridge?.Send("voice.disconnected", null);
    _bridge?.NotifyUiThread();
}
```

> **Note:** The exact location depends on how `ProcessLoop` handles the disconnect path. Search for the call to `Disconnect()` inside `ProcessLoop` or the catch block that handles `SocketException` / `IOException`. The goal is: if the connection drops without `_intentionalDisconnect` being set, start `ReconnectLoop` instead of emitting `voice.disconnected` directly.

**Step 7: Reset `_intentionalDisconnect` at start of a fresh `Connect()` call**

At the very beginning of the `Connect()` method body (after parameter validation), add:
```csharp
_intentionalDisconnect = false;
```

**Step 8: Build the client**

```bash
dotnet build src/Brmble.Client
```

Expected: clean build.

**Step 9: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: implement auto-reconnect loop with exponential backoff in MumbleAdapter (#66)"
```

---

## Task 5: Add button locking for channel / voice actions

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/ChannelTree/ChannelTree.tsx`

### App.tsx

**Step 1: Add `pendingChannelAction` state and timeout ref**

```ts
const [pendingChannelAction, setPendingChannelAction] = useState<number | 'leave' | null>(null);
const pendingChannelActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**Step 2: Add `startPendingAction` helper**

```ts
const startPendingAction = (action: number | 'leave') => {
  if (pendingChannelActionTimeoutRef.current) {
    clearTimeout(pendingChannelActionTimeoutRef.current);
  }
  setPendingChannelAction(action);
  pendingChannelActionTimeoutRef.current = setTimeout(() => {
    setPendingChannelAction(null);
  }, 5000);
};

const clearPendingAction = () => {
  if (pendingChannelActionTimeoutRef.current) {
    clearTimeout(pendingChannelActionTimeoutRef.current);
    pendingChannelActionTimeoutRef.current = null;
  }
  setPendingChannelAction(null);
};
```

**Step 3: Call `startPendingAction` in `handleJoinChannel`**

Find `handleJoinChannel` and add `startPendingAction(channelId)` before `bridge.send(...)`.

**Step 4: Call `startPendingAction('leave')` in `handleLeaveVoice` and `handleRejoinVoice`**

Add `startPendingAction('leave')` at the top of both handlers.

**Step 5: Clear pending on `voice.channelChanged`**

Inside the `onVoiceChannelChanged` handler, add `clearPendingAction()` at the start.

**Step 6: Clear pending on `voice.leftVoiceChanged`**

Inside the `onLeftVoiceChanged` handler, add `clearPendingAction()` at the start.

**Step 7: Clear pending on `voice.error`**

Inside the `onVoiceError` handler (currently just `console.error`), add `clearPendingAction()`.

**Step 8: Pass `pendingChannelAction` to `<Sidebar>`**

```tsx
<Sidebar
  ...
  pendingChannelAction={pendingChannelAction}
/>
```

### Sidebar.tsx

**Step 9: Add `pendingChannelAction` to `SidebarProps`**

```ts
pendingChannelAction?: number | 'leave' | null;
```

Pass it through to `<ChannelTree>`:
```tsx
<ChannelTree
  ...
  pendingChannelAction={pendingChannelAction}
/>
```

Also pass to Leave/Rejoin button if it's rendered in Sidebar (check existing code — if it's in Sidebar pass the prop through; if it's in ChannelTree it gets it directly).

### ChannelTree.tsx

**Step 10: Add `pendingChannelAction` to ChannelTree props**

```ts
pendingChannelAction?: number | 'leave' | null;
```

**Step 11: Disable channel join buttons while action is pending**

Find where channel double-click / join button is rendered. Add `disabled` prop:

```tsx
<button
  ...
  disabled={pendingChannelAction !== null}
  onDoubleClick={pendingChannelAction === null ? () => onJoinChannel(channel.id) : undefined}
>
```

Or if it's `onDoubleClick` on a `<div>` rather than a `<button>`, add a CSS class and pointer-events guard:

```tsx
<div
  className={`channel-item${pendingChannelAction !== null ? ' channel-item--pending' : ''}`}
  onDoubleClick={pendingChannelAction === null ? () => onJoinChannel(channel.id) : undefined}
>
```

**Step 12: Disable Leave/Rejoin button while action is pending**

Find the Leave Voice and Rejoin buttons. Add `disabled={pendingChannelAction !== null}`.

**Step 13: Verify build**

```bash
cd src/Brmble.Web && npm run build
```

Expected: clean build.

**Step 14: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/ChannelTree/ChannelTree.tsx
git commit -m "feat: lock channel and voice buttons during pending server actions (#73)"
```

---

## Task 6: Full build verification

**Step 1: Build all**

```bash
dotnet build
```

Expected: all projects build without errors.

**Step 2: Run tests**

```bash
dotnet test
```

Expected: all tests pass.

**Step 3: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

Expected: no TypeScript errors, clean Vite output.

---

## Manual Testing Checklist

- [ ] Connect to a Mumble server → sidebar shows green dot + "Connected"
- [ ] While connecting → sidebar shows blinking yellow dot + "Connecting..."
- [ ] Kill server process while connected → dot turns yellow, status shows "Reconnecting...", Disconnect button changes to "Cancel reconnecting"
- [ ] Restore server → client reconnects, dot turns green, status shows "Connected", button reverts to "Disconnect"
- [ ] Click "Cancel reconnecting" → dot turns grey, panels below hide, status text disappears
- [ ] Double-click a channel → join button locks (disabled) until `voice.channelChanged` arrives
- [ ] Double-click a channel on slow server → button re-enables after 5 seconds
- [ ] Click Leave Voice → Leave button locks until `voice.leftVoiceChanged` arrives
- [ ] Server sends PermissionDenied error → button unlocks immediately
