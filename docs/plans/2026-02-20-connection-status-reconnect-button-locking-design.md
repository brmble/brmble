# Design: Connection Status, Auto-Reconnect, and Button Locking

**Date:** 2026-02-20  
**Issues:** #75 (connection status sidebar), #66 (auto-reconnect), #73 (button locking)  
**Approach:** A — Rich ConnectionStatus enum in TypeScript; new C# reconnect events only

---

## 1. Connection State Model

Replace the boolean `connected` state in `App.tsx` with a richer union type:

```ts
type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
```

### State Transitions

| Trigger | New Status |
|---|---|
| `bridge.send('voice.connect', ...)` called | `connecting` |
| `voice.connected` received | `connected` |
| `voice.disconnected` (user-initiated) | `idle` |
| `voice.disconnected` (unexpected drop) | → reconnect loop starts → `reconnecting` |
| `voice.reconnecting` received | `reconnecting` |
| `voice.reconnectFailed` received | `failed` |
| User sends `voice.cancelReconnect` | `idle` |

The existing `connected: boolean` prop on `<Sidebar>` is replaced by `connectionStatus: ConnectionStatus`.

### New Bridge Events

| Event | Direction | Payload |
|---|---|---|
| `voice.reconnecting` | C# → JS | `{ attempt: number, delayMs: number }` |
| `voice.reconnectFailed` | C# → JS | `{ reason: string }` |
| `voice.cancelReconnect` | JS → C# | none |

Existing events (`voice.connect`, `voice.connected`, `voice.disconnected`, `voice.disconnect`) are unchanged.

---

## 2. #75 — Connection Status UI (Sidebar)

### Always-Visible Server Block

The server name block is always rendered when `serverLabel` is set, regardless of connection status. The panels below (user info, Disconnect button) remain gated on `connectionStatus === 'connected'`.

### Layout

```
● Brmble Dev Server      ← status dot + server name inline
  127.0.0.1:64738        ← address line (unchanged)
  Connected              ← status text line (new)
```

### Status Dot + Text States

| Status | Dot Color | Dot Animation | Status Text |
|---|---|---|---|
| `idle` | grey | none | — |
| `connecting` | yellow | blinking pulse | Connecting... |
| `connected` | green | none | Connected |
| `reconnecting` | yellow | blinking pulse | Reconnecting... |
| `failed` | red | none | Disconnected |

Blinking: CSS `@keyframes` opacity pulse (0.5s ease-in-out, infinite alternate). No JS timers.

The existing `.server-info-active` lemon-yellow highlight for server-root chat selection is unchanged.

### Props Change

```diff
- connected?: boolean
+ connectionStatus?: ConnectionStatus
```

---

## 3. #66 — Auto-Reconnect

### C# Changes (`MumbleAdapter.cs`)

- Add `_intentionalDisconnect: bool` flag. Set to `true` before any user-initiated `Disconnect()` call.
- In `ProcessLoop`, on unexpected socket error/close: if `!_intentionalDisconnect`, start `ReconnectLoop` task instead of calling `Disconnect()` directly.
- `ReconnectLoop`:
  - Backoff schedule: 2s, 4s, 8s, 16s, 30s (cap). Unlimited attempts until cancelled or reconnected.
  - Before each attempt: emit `voice.reconnecting { attempt, delayMs }` then wait.
  - On success: `ServerSync` fires `voice.connected` as normal (restores previous channel/mute state via existing `_previousChannelId` tracking).
  - On `_intentionalDisconnect` set mid-loop: exit loop, emit `voice.disconnected`.
- `voice.disconnect` handler: set `_intentionalDisconnect = true`, then call existing `Disconnect()`.
- New `voice.cancelReconnect` handler: set `_intentionalDisconnect = true` (cancels loop), then emit `voice.disconnected`.

### TypeScript Changes (`App.tsx`)

- `voice.reconnecting` → `setConnectionStatus('reconnecting')`
- `voice.reconnectFailed` → `setConnectionStatus('failed')`
- `voice.connected` handler: always sets `connectionStatus = 'connected'` (handles both initial connect and successful reconnect)
- `voice.disconnected` handler: if `connectionStatus` was `reconnecting` do nothing (loop handles state); otherwise set `connectionStatus = 'idle'` and reset voice state.

### Sidebar Disconnect/Cancel Button

```tsx
<button onClick={connectionStatus === 'reconnecting' ? handleCancelReconnect : handleDisconnect}>
  {connectionStatus === 'reconnecting' ? 'Cancel reconnecting' : 'Disconnect'}
</button>
```

Same position, same styling. Label only changes.

---

## 4. #73 — Button Locking

### Scope

Two actions require locking: **Join/Switch channel** and **Leave Voice / Rejoin**.

### State

New state in `App.tsx`:

```ts
const [pendingChannelAction, setPendingChannelAction] = useState<number | 'leave' | null>(null)
const pendingChannelActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

### Lock / Unlock Logic

| Action | Sets | Cleared by |
|---|---|---|
| `handleJoinChannel(id)` | `pendingChannelAction = id` | `voice.channelChanged` or 5s timeout |
| `handleLeaveVoice()` | `pendingChannelAction = 'leave'` | `voice.leftVoiceChanged` (true) or 5s timeout |
| `handleRejoinVoice()` | `pendingChannelAction = 'leave'` | `voice.leftVoiceChanged` (false) or 5s timeout |
| Any action | cancels previous timeout, starts new 5s timeout | |
| `voice.error` (PermissionDenied) | — | clears pending immediately |

### UI Behaviour

- Channel join buttons in `ChannelTree`: `disabled` when `pendingChannelAction !== null`
- Leave/Rejoin button: `disabled` when `pendingChannelAction !== null`
- Disabled style: `cursor: not-allowed`, reduced opacity (existing `.btn:disabled` styles apply)

### Props Change to `<ChannelTree>` and `<Sidebar>`

```diff
+ pendingChannelAction?: number | 'leave' | null
```

No C# changes required for button locking.

---

## Files Changed

### C#
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — reconnect loop, intentional disconnect flag, `voice.cancelReconnect` handler

### TypeScript / React
- `src/Brmble.Web/src/App.tsx` — `ConnectionStatus` type, state changes, new handlers, button locking state
- `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx` — status dot+text, always-visible server block, cancel button label
- `src/Brmble.Web/src/components/Sidebar/Sidebar.css` — dot styles, blink animation, status text
- `src/Brmble.Web/src/components/ChannelTree/ChannelTree.tsx` — disabled prop on join buttons
- `src/Brmble.Web/src/types/index.ts` — `ConnectionStatus` type export
