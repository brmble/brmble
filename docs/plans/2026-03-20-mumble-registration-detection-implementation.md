# Mumble Registration Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect Mumble registration status from the protocol and display the registered name (with checkmark) in the server edit form's username field.

**Architecture:** Patch MumbleSharp's User model and BasicMumbleProtocol to read `UserState.user_id` and `UserState.hash` from incoming messages. MumbleAdapter sends registration status to the frontend after connection and after auto-registration. The frontend persists it to config and shows the registered name in a disabled username field with a checkmark icon.

**Tech Stack:** C# (MumbleSharp, Brmble.Client), TypeScript/React (Brmble.Web), CSS

---

### Task 1: Add Registration Properties to MumbleSharp User Model

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/Model/User.cs:24` (after ListeningVolumeAdjustments)

**Step 1: Add the three new properties**

After line 24 (`ListeningVolumeAdjustments`), before line 26 (`_channel`), add:

```csharp
public uint? RegisteredUserId { get; set; }
public string CertificateHash { get; set; }
public bool IsRegistered => RegisteredUserId.HasValue;
```

**Step 2: Build to verify compilation**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: Build succeeded.

**Step 3: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/Model/User.cs
git commit -m "feat: add RegisteredUserId, CertificateHash, IsRegistered to MumbleSharp User model"
```

---

### Task 2: Read Registration Fields in BasicMumbleProtocol.UserState()

**Files:**
- Modify: `lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs:414` (after Comment handling, before ChannelId handling)

**Step 1: Add UserId and Hash reading**

After line 414 (the closing brace of the Comment block) and before line 416 (the ChannelId block), insert:

```csharp
                if (userState.ShouldSerializeUserId())
                {
                    user.RegisteredUserId = userState.UserId;
                }
                if (userState.ShouldSerializeHash())
                {
                    user.CertificateHash = userState.Hash;
                }
```

This follows the exact same pattern as all the other field reads in this method (`ShouldSerializeX()` → set property).

**Step 2: Build to verify compilation**

Run: `dotnet build lib/MumbleSharp/MumbleSharp/MumbleSharp.csproj`
Expected: Build succeeded.

**Step 3: Commit**

```bash
git add lib/MumbleSharp/MumbleSharp/BasicMumbleProtocol.cs
git commit -m "feat: read UserState.user_id and hash in BasicMumbleProtocol"
```

---

### Task 3: Send Registration Status from MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
  - In `SendVoiceConnected()` (line ~2003): add registration fields to the payload
  - In `UserState` override or callback: detect registration changes for the local user

**Step 1: Add registration fields to `voice.connected` payload**

In `SendVoiceConnected()` at line ~2021, update the `_bridge?.Send("voice.connected", ...)` call. Add `registered` and `registeredName` to the anonymous object:

```csharp
_bridge?.Send("voice.connected", new
{
    username = LocalUser?.Name,
    channelId,
    channels,
    users,
    registered = LocalUser?.IsRegistered ?? false,
    registeredName = LocalUser?.IsRegistered == true ? LocalUser.Name : (string)null
});
```

**Step 2: Send registration update when UserState changes for local user**

Override `UserStateChanged` (or use the existing override) to detect when `LocalUser` becomes registered after auto-registration. Find the existing `UserStateChanged` or `UserStateNameChanged` override in MumbleAdapter.

When `LocalUser.IsRegistered` becomes true, send a bridge message to update the server entry:

```csharp
// Inside the UserState change handler for the local user:
if (user == LocalUser && user.IsRegistered && _activeServerId != null)
{
    _bridge?.Send("voice.registrationStatus", new
    {
        serverId = _activeServerId,
        registered = true,
        registeredName = user.Name
    });
}
```

Note: `_activeServerId` is already set in the `voice.connect` handler (line ~1479).

**Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: send registration status in voice.connected and on UserState changes"
```

---

### Task 4: Add `registeredName` to Frontend ServerEntry and Handle Bridge Messages

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useServerlist.ts:11` (add `registeredName` to interface)
- Modify: `src/Brmble.Web/src/App.tsx` (add `voice.registrationStatus` handler, update `voice.connected` handler)

**Step 1: Add `registeredName` to ServerEntry interface**

In `useServerlist.ts` at line 11, after `registered?: boolean;` add:

```typescript
registeredName?: string;
```

**Step 2: Also update the `SavedServer` interface in App.tsx**

In `App.tsx` at line ~101, after `registered?: boolean;` add:

```typescript
registeredName?: string;
```

**Step 3: Update `voice.connected` handler in App.tsx**

In the existing `voice.connected` handler (lines ~514-546), read the new `registered` and `registeredName` fields from the payload and persist them to the server entry:

```typescript
// After setting username, channels, users:
const reg = d as { registered?: boolean; registeredName?: string };
if (reg?.registered && savedServer?.id) {
  const updated = { ...savedServer, registered: true, username: reg.registeredName ?? savedServer.username, registeredName: reg.registeredName };
  bridge.send('servers.update', updated);
  // Also update localStorage
  localStorage.setItem('brmble-server', JSON.stringify(updated));
}
```

**Step 4: Add `voice.registrationStatus` handler**

Register a new bridge handler for `voice.registrationStatus` that updates the server entry when registration status changes mid-session (e.g., after auto-registration):

```typescript
const onRegistrationStatus = (data: unknown) => {
  const d = data as { serverId?: string; registered?: boolean; registeredName?: string } | undefined;
  if (!d?.registered || !d.serverId) return;
  // Update via servers.update bridge message
  bridge.send('servers.update', { id: d.serverId, registered: true, registeredName: d.registeredName });
};
bridge.on('voice.registrationStatus', onRegistrationStatus);
// cleanup: bridge.off('voice.registrationStatus', onRegistrationStatus);
```

**Step 5: Build to verify**

Run from `src/Brmble.Web`: `npm run build`
Expected: Build succeeded.

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useServerlist.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: handle registration status in frontend and persist to server entries"
```

---

### Task 5: Update ServerList Username Field UI with Checkmark

**Files:**
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.tsx:240-247` (username input)
- Modify: `src/Brmble.Web/src/components/ServerList/ServerList.css` (add checkmark styles)

**Step 1: Update the username field to show registeredName and checkmark**

Replace the username input block (lines 240-247) with:

```tsx
<div className="server-list-username-wrapper">
  <input
    className={`brmble-input server-list-input${editing?.registered ? ' server-list-input-registered' : ''}`}
    placeholder="Username"
    value={editing?.registered ? (editing.registeredName ?? form.username) : form.username}
    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
    disabled={editing?.registered === true}
    title={editing?.registered ? `Registered as "${editing.registeredName}" on this server` : undefined}
  />
  {editing?.registered && (
    <svg className="server-list-registered-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Registered">
      <polyline points="3.5 8 6.5 11 12.5 5" />
    </svg>
  )}
</div>
```

Note: The `editing` object needs to carry `registeredName`. Check the `handleEdit` function (lines 41-53) to make sure it passes the full server entry including `registeredName`. The `editing` state type may need updating.

**Step 2: Add CSS for the username wrapper and checkmark icon**

Add to `ServerList.css`:

```css
.server-list-username-wrapper {
  position: relative;
  width: 100%;
}

.server-list-input-registered {
  padding-right: var(--space-xl) !important;
}

.server-list-registered-icon {
  position: absolute;
  right: var(--space-sm);
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent-success, #4ade80);
  pointer-events: none;
}
```

This follows the same pattern as `.server-list-password-wrapper` and `.server-list-password-toggle` already in the CSS (lines 292-319).

**Step 3: Ensure `editing` state includes `registeredName`**

The `editing` state (line ~15) is set from the servers array. Make sure the `ServerEntry` type flowing through includes `registeredName`. If the `handleEdit` function (line ~41) spreads the server object, it should already pass through `registeredName` since it's on the `ServerEntry` interface. Verify this.

**Step 4: Build to verify**

Run from `src/Brmble.Web`: `npm run build`
Expected: Build succeeded.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ServerList/ServerList.tsx src/Brmble.Web/src/components/ServerList/ServerList.css
git commit -m "feat: show registered name with checkmark icon in server edit form"
```

---

### Task 6: Full Build Verification

**Step 1: Run all .NET tests**

Run: `dotnet test`
Expected: All tests pass (52 client + 68 voice engine + server tests).

**Step 2: Run frontend build**

Run from `src/Brmble.Web`: `npm run build`
Expected: Build succeeded, no TypeScript errors.

**Step 3: Manual testing checklist**

- Connect to a Mumble server where you ARE registered → username field should show the registered name, be disabled, and display a checkmark icon
- Connect to a Mumble server where you are NOT registered → username field should be editable, no checkmark
- Disconnect and reopen edit form → persisted `registered` + `registeredName` should still show
- After auto-registration completes on a new server → registration status should update via `voice.registrationStatus` bridge message
