# Connection Error Display + Per-Service Status Indicators — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface connection error messages in the UI and add per-service status indicators for Voice, Chat, Brmble Server, and Screenshare.

**Architecture:** A `useServiceStatus` React context provides a unified `ServiceStatusMap` (one `ServiceStatus` per service). Bridge handlers and hooks update it. ConnectionState displays the voice error reason. Sidebar shows a multi-dot row with tooltips. C# backend fixes ensure errors aren't silently dropped.

**Tech Stack:** React + TypeScript (context, hooks), CSS tokens per UI_GUIDE.md, C# (MumbleAdapter fixes)

---

## Task 1: Add ServiceStatus types

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:60`

**Step 1: Add types to types/index.ts**

Add these types after the existing `ConnectionStatus` type at line 60:

```ts
export type ServiceName = 'voice' | 'chat' | 'server' | 'livekit';

export type ServiceState = 'connected' | 'connecting' | 'disconnected' | 'unavailable';

export interface ServiceStatus {
  state: ServiceState;
  error?: string;
  label?: string;
}

export type ServiceStatusMap = Record<ServiceName, ServiceStatus>;

export const SERVICE_DISPLAY_NAMES: Record<ServiceName, string> = {
  voice: 'Voice',
  chat: 'Chat',
  server: 'Brmble',
  livekit: 'Screenshare',
};
```

**Step 2: Commit**

```
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add ServiceStatus types for per-service status tracking"
```

---

## Task 2: Create useServiceStatus context

**Files:**
- Create: `src/Brmble.Web/src/hooks/useServiceStatus.tsx`

**Step 1: Create the context and provider**

```tsx
import { createContext, useContext, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { ServiceName, ServiceStatus, ServiceStatusMap } from '../types';

const DEFAULT_STATUSES: ServiceStatusMap = {
  voice: { state: 'disconnected' },
  chat: { state: 'unavailable' },
  server: { state: 'unavailable' },
  livekit: { state: 'unavailable' },
};

interface ServiceStatusContextValue {
  statuses: ServiceStatusMap;
  updateStatus: (service: ServiceName, update: Partial<ServiceStatus>) => void;
}

const ServiceStatusContext = createContext<ServiceStatusContextValue | null>(null);

export function ServiceStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<ServiceStatusMap>(DEFAULT_STATUSES);

  const updateStatus = useCallback((service: ServiceName, update: Partial<ServiceStatus>) => {
    setStatuses(prev => ({
      ...prev,
      [service]: { ...prev[service], ...update },
    }));
  }, []);

  return (
    <ServiceStatusContext.Provider value={{ statuses, updateStatus }}>
      {children}
    </ServiceStatusContext.Provider>
  );
}

export function useServiceStatus() {
  const ctx = useContext(ServiceStatusContext);
  if (!ctx) throw new Error('useServiceStatus must be used within ServiceStatusProvider');
  return ctx;
}
```

**Step 2: Wrap App in the provider**

In `src/Brmble.Web/src/main.tsx`, import and wrap:

```tsx
import { ServiceStatusProvider } from './hooks/useServiceStatus'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="App">
      <ServiceStatusProvider>
        <App />
      </ServiceStatusProvider>
    </ErrorBoundary>
  </StrictMode>,
)
```

**Step 3: Commit**

```
git add src/Brmble.Web/src/hooks/useServiceStatus.tsx src/Brmble.Web/src/main.tsx
git commit -m "feat: add ServiceStatusProvider context for per-service status"
```

---

## Task 3: Wire voice bridge handlers to ServiceStatus context

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

This is the largest task. We need to:
1. Import and use the `useServiceStatus` hook in App.tsx
2. Update `onVoiceConnected`, `onVoiceDisconnected`, `onVoiceError`, `onVoiceReconnecting`, `onVoiceReconnectFailed`, and `handleConnect` to call `updateStatus('voice', ...)`
3. Keep the existing `connectionStatus` state variable temporarily — derive it from `statuses.voice.state` (to avoid changing all consumers at once). Later tasks will migrate consumers.

**Step 1: Add context hook to App**

Near the top of the `App` function (after line 132), add:

```tsx
const { statuses, updateStatus } = useServiceStatus();
```

Import `useServiceStatus` from `'./hooks/useServiceStatus'`.

**Step 2: Update handleConnect (line 1011-1015)**

After `setConnectionStatus('connecting')`, add:
```tsx
updateStatus('voice', { state: 'connecting', error: undefined, label: `${serverData.host}:${serverData.port}` });
```

**Step 3: Update onVoiceConnected**

Wherever `setConnectionStatus('connected')` is called, also add:
```tsx
updateStatus('voice', { state: 'connected', error: undefined });
```

**Step 4: Update onVoiceError (lines 560-564)**

Replace the handler body:
```tsx
const onVoiceError = ((data: unknown) => {
  clearPendingAction();
  const d = data as { message?: string } | undefined;
  const errorMsg = d?.message || 'Unknown error';
  console.error('Voice error:', errorMsg);
  updateStatus('voice', { state: 'disconnected', error: errorMsg });
  setConnectionStatus('idle');
});
```

Note: Setting state to `'disconnected'` with the error lets ConnectionState display it. Setting `connectionStatus` to `'idle'` handles the case where a validation error fires without a subsequent `voice.disconnected`.

**Step 5: Update onVoiceDisconnected (lines 519-548)**

Add after `setConnectionStatus(...)`:
```tsx
if (d?.reconnectAvailable) {
  updateStatus('voice', { state: 'disconnected' });
} else {
  updateStatus('voice', { state: 'disconnected', error: undefined });
}
```

Do NOT clear the error here — the error from `onVoiceError` should persist so ConnectionState can show it.

**Step 6: Update onVoiceReconnecting (find the handler)**

Add:
```tsx
updateStatus('voice', { state: 'connecting' });
```
(Don't clear error — user should see why they're reconnecting.)

**Step 7: Update onVoiceReconnectFailed (find the handler)**

Add:
```tsx
const d = data as { reason?: string } | undefined;
updateStatus('voice', { state: 'disconnected', error: d?.reason || 'Reconnect failed' });
```

**Step 8: Run `npm run build` and fix any type errors**

Run: `cd src/Brmble.Web && npm run build`

**Step 9: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire voice bridge handlers to ServiceStatus context"
```

---

## Task 4: Enhanced ConnectionState — display error message

**Files:**
- Modify: `src/Brmble.Web/src/components/ConnectionState/ConnectionState.tsx`
- Modify: `src/Brmble.Web/src/components/ConnectionState/ConnectionState.css`
- Modify: `src/Brmble.Web/src/App.tsx` (pass errorMessage prop)

**Step 1: Add errorMessage prop to ConnectionState**

In `ConnectionState.tsx`, add to the interface (line 5-11):

```tsx
interface ConnectionStateProps {
  connectionStatus: ConnectionStatus;
  serverLabel?: string;
  errorMessage?: string;  // NEW
  onCancel?: () => void;
  onReconnect?: () => void;
  onBackToServerList?: () => void;
}
```

Destructure `errorMessage` in the component function.

**Step 2: Render error text**

After the subtext `<p>` (line 43), add:

```tsx
{errorMessage && (
  <p className="connection-state-error">{errorMessage}</p>
)}
```

**Step 3: Add error CSS**

In `ConnectionState.css`, add after `.connection-state-subtext` (after line 27):

```css
.connection-state-error {
  color: var(--accent-danger-text);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  margin: 0 0 var(--space-lg);
  padding: var(--space-xs) var(--space-sm);
  background: var(--accent-danger-bg);
  border-radius: var(--radius-md);
  max-width: 420px;
  word-break: break-word;
}
```

**Step 4: Pass errorMessage from App.tsx**

In App.tsx where ConnectionState is rendered (lines 1629-1636), pass the error:

```tsx
<ConnectionState
  connectionStatus={connectionStatus}
  serverLabel={serverLabel}
  errorMessage={statuses.voice.error}
  onCancel={...}
  onReconnect={...}
  onBackToServerList={handleBackToServerList}
/>
```

**Step 5: Run `npm run build` and verify no errors**

**Step 6: Commit**

```
git add src/Brmble.Web/src/components/ConnectionState/ConnectionState.tsx src/Brmble.Web/src/components/ConnectionState/ConnectionState.css src/Brmble.Web/src/App.tsx
git commit -m "feat: display error message in ConnectionState panel (#309)"
```

---

## Task 5: Sidebar multi-dot service indicators

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

**Step 1: Import context and types in Sidebar**

Add imports:
```tsx
import { useServiceStatus } from '../../hooks/useServiceStatus';
import { Tooltip } from '../Tooltip/Tooltip';
import type { ServiceName } from '../../types';
import { SERVICE_DISPLAY_NAMES } from '../../types';
```

**Step 2: Use the context in the component**

At the top of the `Sidebar` function body:
```tsx
const { statuses } = useServiceStatus();
```

**Step 3: Create the multi-dot rendering**

Define a helper inside the component or as a small sub-component:

```tsx
const SERVICE_ORDER: ServiceName[] = ['voice', 'chat', 'server', 'livekit'];

const serviceDotsEl = (
  <div className="service-status-dots" aria-label="Service status">
    {SERVICE_ORDER.map(name => {
      const svc = statuses[name];
      const displayName = SERVICE_DISPLAY_NAMES[name];
      const stateText = svc.state.charAt(0).toUpperCase() + svc.state.slice(1);
      const tooltipText = svc.error
        ? `${displayName}: ${stateText} — ${svc.error}`
        : `${displayName}: ${stateText}`;
      return (
        <Tooltip key={name} content={tooltipText} position="bottom">
          <span
            className={`service-dot service-dot--${svc.state}`}
            aria-label={tooltipText}
          />
        </Tooltip>
      );
    })}
  </div>
);
```

**Step 4: Replace existing status-dot + status-text markup**

In both places where `<div className="server-status-line">` appears (lines 123-149 and 153-179), replace the status-dot + status-text spans with `{serviceDotsEl}`. Keep the action buttons (Reconnect, Disconnect/Cancel/Back) — they're still useful.

The new structure for each server-status-line:
```tsx
<div className="server-status-line" aria-live="polite" aria-atomic="true">
  {serviceDotsEl}
  {/* existing action buttons unchanged */}
</div>
```

**Step 5: Add CSS for service-dot**

In `Sidebar.css`, add after the existing status-dot rules (after line 146):

```css
/* Per-service status dots */
.service-status-dots {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
}

.service-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
  display: inline-block;
}

.service-dot--connected   { background: var(--status-connected); }
.service-dot--connecting  { background: var(--accent-secondary); animation: status-blink var(--animation-blink) ease-in-out infinite alternate; }
.service-dot--disconnected{ background: var(--accent-primary); }
.service-dot--unavailable { background: var(--text-muted); opacity: 0.4; }
```

**Step 6: Run `npm run build`**

**Step 7: Commit**

```
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css
git commit -m "feat: add per-service status dots in sidebar (#190)"
```

---

## Task 6: Wire Matrix (Chat) status to context

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/App.tsx` (if needed to bridge credentials → status)

**Step 1: Add sync state tracking to useMatrixClient**

In `useMatrixClient.ts`, import and use the service status context:

```tsx
import { useServiceStatus } from './useServiceStatus';
```

At the top of the hook:
```tsx
const { updateStatus } = useServiceStatus();
```

**Step 2: Update status on sync events**

In the `useEffect` that initializes the client (around line 56), update status:

When `createClient()` is called and `startClient()` begins:
```tsx
updateStatus('chat', { state: 'connecting', error: undefined, label: credentials.homeserverUrl });
```

In the `onSync` handler (around line 213), add:
```tsx
const onSync = (state: string, _prev: string | null, data?: { error?: { message?: string } }) => {
  if (state === 'PREPARED' || state === 'SYNCING') {
    updateStatus('chat', { state: 'connected', error: undefined });
    // existing code...
  } else if (state === 'ERROR') {
    updateStatus('chat', { state: 'disconnected', error: data?.error?.message || 'Sync error' });
  } else if (state === 'STOPPED') {
    updateStatus('chat', { state: 'disconnected' });
  }
};
```

Register for `ClientEvent.Sync` if not already done (check if it's already registered around lines 221-229).

**Step 3: Reset on cleanup/no credentials**

When credentials are null (lines 57-66), set:
```tsx
updateStatus('chat', { state: 'unavailable', error: undefined });
```

**Step 4: Add error handling around startClient**

Wrap `client.startClient()` (line 195) in try/catch:
```tsx
try {
  client.startClient({ initialSyncLimit: 20 });
} catch (err) {
  updateStatus('chat', { state: 'disconnected', error: err instanceof Error ? err.message : 'Failed to start Matrix client' });
}
```

**Step 5: Run `npm run build`**

**Step 6: Commit**

```
git add src/Brmble.Web/src/hooks/useMatrixClient.ts
git commit -m "feat: wire Matrix sync state to ServiceStatus context"
```

---

## Task 7: Wire Brmble Server health status

**Files:**
- Create: `src/Brmble.Web/src/hooks/useServerHealth.ts`
- Modify: `src/Brmble.Web/src/App.tsx` (call the hook)

**Step 1: Create useServerHealth hook**

```tsx
import { useEffect, useRef } from 'react';
import { useServiceStatus } from './useServiceStatus';

const POLL_INTERVAL = 30_000; // 30 seconds

export function useServerHealth(apiUrl: string | undefined) {
  const { updateStatus } = useServiceStatus();
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!apiUrl) {
      updateStatus('server', { state: 'unavailable', error: undefined });
      return;
    }

    const check = async () => {
      try {
        const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          updateStatus('server', { state: 'connected', error: undefined, label: apiUrl });
        } else {
          updateStatus('server', { state: 'disconnected', error: `Health check returned ${res.status}` });
        }
      } catch (err) {
        updateStatus('server', { state: 'disconnected', error: err instanceof Error ? err.message : 'Health check failed' });
      }
    };

    updateStatus('server', { state: 'connecting', label: apiUrl });
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [apiUrl, updateStatus]);
}
```

**Step 2: Call from App.tsx**

Import and call the hook in the App component. The Brmble server API URL comes from the `server.credentials` bridge message or the `voice.connect` data. Look for where `apiUrl` or Brmble server URL is stored and pass it to `useServerHealth(apiUrl)`.

If no API URL state exists yet, add one:
```tsx
const [brmbleApiUrl, setBrmbleApiUrl] = useState<string | undefined>();
```

Set it when `voice.connect` is called with an `apiUrl`, or when `server.credentials` arrives.

**Step 3: Run `npm run build`**

**Step 4: Commit**

```
git add src/Brmble.Web/src/hooks/useServerHealth.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add Brmble server health polling (#190)"
```

---

## Task 8: C# backend fixes

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Fix validation errors not sending voice.disconnected**

In `MumbleAdapter.Connect()`, after each validation error that sends `voice.error` and returns (lines 112, 119, 126), add a `voice.disconnected` send:

At line 114 (after `_bridge?.Send("voice.error", ...)`), add:
```csharp
_bridge?.Send("voice.disconnected", null);
_bridge?.NotifyUiThread();
return;
```

Same pattern for lines 121 and 128.

**Step 2: Add NotifyUiThread to Reject handler**

At the `Reject` override (around line 2048-2052), add `_bridge?.NotifyUiThread();` after the Send:

```csharp
public override void Reject(Reject reject)
{
    base.Reject(reject);
    _bridge?.Send("voice.error", new { message = reject.Reason, type = reject.Type });
    _bridge?.NotifyUiThread();
}
```

**Step 3: Add NotifyUiThread to PermissionDenied handler**

Same pattern for the `PermissionDenied` override (around lines 2054-2063).

**Step 4: Surface credential fetch failures**

At line 1104-1107 in `FetchAndSendCredentials`, change the catch block from:
```csharp
catch (Exception ex)
{
    Debug.WriteLine($"[Matrix] Failed to fetch credentials: {ex.Message}");
}
```
to:
```csharp
catch (Exception ex)
{
    Debug.WriteLine($"[Matrix] Failed to fetch credentials: {ex.Message}");
    _bridge?.Send("voice.error", new { message = $"Failed to fetch chat credentials: {ex.Message}" });
    _bridge?.NotifyUiThread();
}
```

**Step 5: Build the C# project**

Run: `dotnet build src/Brmble.Client`

**Step 6: Commit**

```
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "fix: surface connection errors and fix message delivery (#309)"
```

---

## Task 9: Add missing CSS rule for disconnected status dot

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css`

The existing CSS has rules for `--idle`, `--connecting`, `--connected`, `--reconnecting`, `--failed` but NOT `--disconnected`. Add:

```css
.status-dot--disconnected { background: var(--accent-primary); }
```

This also applies to the legacy single-dot (if any components still use it).

**Step 1: Add the rule, commit**

```
git add src/Brmble.Web/src/components/Sidebar/Sidebar.css
git commit -m "fix: add missing disconnected status dot CSS rule"
```

---

## Task 10: Build and verify

**Step 1: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

Fix any type errors.

**Step 2: Build backend**

```bash
dotnet build
```

Fix any compilation errors.

**Step 3: Run tests**

```bash
dotnet test
```

**Step 4: Final commit if any fixes were needed**

---

## Summary

| Task | What | Issue |
|------|------|-------|
| 1 | ServiceStatus types | #190, #309 |
| 2 | useServiceStatus context + provider | #190, #309 |
| 3 | Wire voice bridge handlers | #309 |
| 4 | Enhanced ConnectionState with error text | #309 |
| 5 | Sidebar multi-dot indicators | #190 |
| 6 | Wire Matrix sync state | #190 |
| 7 | Brmble server health polling | #190 |
| 8 | C# backend error fixes | #309 |
| 9 | Missing CSS rule | #190 |
| 10 | Build + verify | Both |
