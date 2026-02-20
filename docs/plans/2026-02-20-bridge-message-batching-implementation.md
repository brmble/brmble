# Bridge Message Batching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Batch bridge messages into single WebView2 IPC calls so channel switches and other server events update the UI without visible lag.

**Architecture:** Remove per-message `PostMessage(WM_USER)` from `NativeBridge.Send()`. The MumbleAdapter process loop posts one `WM_USER` after each `Connection.Process()` call, and `ProcessUiMessage()` drains the queue into a single JSON array sent via one `PostWebMessageAsJson` call. `bridge.ts` detects arrays and dispatches each message synchronously.

**Tech Stack:** C# / Win32 / WebView2 / TypeScript / React

---

### Task 1: Update NativeBridge — enqueue-only Send, batched ProcessUiMessage, Flush

**Files:**
- Modify: `src/Brmble.Client/Bridge/NativeBridge.cs`

**Step 1: Remove PostMessage from Send() and SendString()**

In `NativeBridge.cs`, change `Send()` (line 61-69) so it only enqueues — no `PostMessage`:

```csharp
public void Send(string type, object? data = null)
{
    var message = new { type, data };
    var json = JsonSerializer.Serialize(message, _jsonOptions);
    Debug.WriteLine($"[NativeBridge] Sending: {type}");

    _pendingMessages.Enqueue(json);
    // No PostMessage here — caller is responsible for triggering flush
}
```

Same for `SendString()` (line 75-79):

```csharp
public void SendString(string message)
{
    _pendingMessages.Enqueue(message);
}
```

**Step 2: Rewrite ProcessUiMessage() to batch into a single IPC call**

Replace `ProcessUiMessage()` (line 87-93) with:

```csharp
public void ProcessUiMessage()
{
    // Drain all pending messages
    var batch = new List<string>();
    while (_pendingMessages.TryDequeue(out var json))
    {
        batch.Add(json);
    }

    if (batch.Count == 0)
        return;

    if (batch.Count == 1)
    {
        // Single message — send as-is, no array wrapper
        _webView.PostWebMessageAsJson(batch[0]);
    }
    else
    {
        // Multiple messages — wrap in JSON array, one IPC call
        _webView.PostWebMessageAsJson("[" + string.Join(",", batch) + "]");
    }
}
```

**Step 3: Add Flush() method for UI-thread callers**

Add after `ProcessUiMessage()`:

```csharp
/// <summary>
/// Immediately drains the message queue and sends to WebView2.
/// Call this from the UI thread when you need messages delivered without
/// waiting for a WM_USER roundtrip (e.g. after ToggleMute, Disconnect).
/// </summary>
public void Flush()
{
    ProcessUiMessage();
}
```

**Step 4: Expose PostMessage as a static helper for the process loop**

Add a public method so MumbleAdapter's process loop can trigger UI-thread flush:

```csharp
/// <summary>
/// Posts a WM_USER message to trigger ProcessUiMessage on the UI thread.
/// Safe to call from any thread.
/// </summary>
public void NotifyUiThread()
{
    PostMessage(_hwnd, WM_USER, IntPtr.Zero, IntPtr.Zero);
}
```

**Step 5: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds with no new errors.

**Step 6: Commit**

```bash
git add src/Brmble.Client/Bridge/NativeBridge.cs
git commit -m "feat: batch bridge messages into single WebView2 IPC calls"
```

---

### Task 2: Update MumbleAdapter — process loop triggers flush

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Update ProcessLoop to post WM_USER after Process()**

Change `ProcessLoop()` (line 144-161) to notify the UI thread after processing a packet:

```csharp
private void ProcessLoop(CancellationToken ct)
{
    while (!ct.IsCancellationRequested
           && Connection is { State: not ConnectionStates.Disconnected })
    {
        try
        {
            if (Connection.Process())
            {
                // A server packet was processed — Send() calls have enqueued
                // messages. Post one WM_USER to flush the batch on the UI thread.
                _bridge?.NotifyUiThread();
                Thread.Yield();
            }
            else
            {
                Thread.Sleep(1);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _bridge?.Send("voice.error", new { message = $"Process error: {ex.Message}" });
            _bridge?.NotifyUiThread();
        }
    }
}
```

**Step 2: Add Flush() calls after UI-thread-originated Send() calls**

These methods are called from WndProc handlers (UI thread) and call `Send()` directly.
Add `_bridge?.Flush()` at the end of each:

In `Disconnect()` — after the `_bridge?.Send("voice.disconnected", null)` call (line 141):

```csharp
_bridge?.Send("voice.disconnected", null);
_bridge?.Flush();
```

In `ToggleMute()` — after the last `Send()` call (line 233):

```csharp
_bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
_bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
_bridge?.Flush();
```

In `ToggleDeaf()` — after the last `Send()` call (line 337):

```csharp
_bridge?.Send("voice.selfDeafChanged", new { deafened = LocalUser.SelfDeaf });
_bridge?.Send("voice.selfMuteChanged", new { muted = LocalUser.SelfMuted });
_bridge?.Flush();
```

In `LeaveVoice()` — after each branch's last `Send()` call.

The leave branch (around line 297) ends with `ActivateLeaveVoice()` which calls multiple
`Send()` calls. Add flush after the method returns:

```csharp
ActivateLeaveVoice(channelMoveInProgress: true);
_bridge?.Flush();
```

The rejoin branch (around line 322) ends with:

```csharp
_bridge?.Send("voice.leftVoiceChanged", new { leftVoice = false });
_bridge?.Flush();
```

**Step 3: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds with no new errors.

**Step 4: Run tests**

Run: `dotnet test`
Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: process loop triggers batched bridge flush after each server packet"
```

---

### Task 3: Update bridge.ts — handle batched messages

**Files:**
- Modify: `src/Brmble.Web/src/bridge.ts`

**Step 1: Update _handleMessage to detect arrays**

Replace `_handleMessage()` (line 15-26) with:

```typescript
_handleMessage(event: { data: { type: string; data?: unknown } | { type: string; data?: unknown }[] }) {
  try {
    const payload = event.data;
    const messages = Array.isArray(payload) ? payload : [payload];

    for (const msg of messages) {
      const { type, data } = msg;
      console.log('[JS Bridge] Received:', type, data);

      if (this._handlers.has(type)) {
        this._handlers.get(type)?.forEach(handler => handler(data));
      }
    }
  } catch (e) {
    console.error('[JS Bridge] Error:', e);
  }
},
```

**Step 2: Update the event listener type**

Change the `init()` listener (line 9) to use a broader type:

```typescript
init() {
  const webview = window.chrome?.webview;
  if (webview) {
    webview.addEventListener('message', (event: { data: unknown }) => {
      this._handleMessage(event as { data: { type: string; data?: unknown } | { type: string; data?: unknown }[] });
    });
  }
},
```

**Step 3: Build frontend**

Run from `src/Brmble.Web`: `npm run build`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/bridge.ts
git commit -m "feat: handle batched bridge messages in frontend"
```

---

### Task 4: Verification

**Step 1: Full build**

Run: `dotnet build`
Expected: Build succeeds.

**Step 2: All tests**

Run: `dotnet test`
Expected: All tests pass.

**Step 3: Manual testing**

1. Start the app (`dotnet run --project src/Brmble.Client`)
2. Connect to a Mumble server
3. Switch channels — verify UI updates without visible lag
4. Toggle mute/deafen — verify instant feedback
5. Observe another user join/leave — verify it appears/disappears promptly

**Step 4: Final commit (if any fixups needed)**

Otherwise the feature is complete.
