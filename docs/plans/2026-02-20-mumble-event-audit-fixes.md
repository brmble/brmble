# Mumble Event Audit Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all remaining bugs found in the Mumble event handler audit — channel state/remove handling, root channel user visibility, spurious channel-change events, permission denied forwarding, and cleanup of redundant code.

**Architecture:** Six targeted fixes across MumbleAdapter.cs (C# bridge layer), App.tsx (frontend event listeners), and ChannelTree.tsx (channel tree rendering). Each fix is independent and can be verified individually. No new infrastructure — just correcting existing event wiring.

**Tech Stack:** C# (.NET 10), React/TypeScript, WebView2 bridge

---

### Task 1: Fix ChannelState to read from Channel model instead of raw protobuf

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:705-714`

**Step 1: Replace raw protobuf reads with Channel model lookups**

After `base.ChannelState(channelState)` runs, the Channel object in `ChannelDictionary` has the correct merged state. Replace the current code:

Before:
```csharp
public override void ChannelState(ChannelState channelState)
{
    base.ChannelState(channelState);
    _bridge?.Send("voice.channelJoined", new
    {
        id = channelState.ChannelId,
        name = channelState.Name,
        parent = channelState.Parent
    });
}
```

After:
```csharp
public override void ChannelState(ChannelState channelState)
{
    base.ChannelState(channelState);

    if (ChannelDictionary.TryGetValue(channelState.ChannelId, out var channel))
    {
        _bridge?.Send("voice.channelJoined", new
        {
            id = channel.Id,
            name = channel.Name,
            parent = channel.Parent
        });
    }
}
```

**Step 2: Build**

Run: `dotnet build`
Expected: 0 compilation errors (file-lock warning on running client is OK)

**Step 3: Commit**

```
fix: read channel state from model instead of raw protobuf for bridge messages
```

---

### Task 2: Add ChannelRemove override to forward channel deletions to frontend

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (add override after ChannelState)
- Modify: `src/Brmble.Web/src/App.tsx` (add event listener)

**Step 1: Add ChannelRemove override in MumbleAdapter**

Add this method right after the `ChannelState` override (after current line ~714, before `TextMessage`):

```csharp
public override void ChannelRemove(ChannelRemove channelRemove)
{
    var channelId = channelRemove.ChannelId;
    base.ChannelRemove(channelRemove);
    _bridge?.Send("voice.channelRemoved", new { id = channelId });
}
```

Note: We capture `channelId` before `base.ChannelRemove()` because the base method removes the channel from `ChannelDictionary`.

**Step 2: Add frontend listener in App.tsx**

Add the handler function inside the `useEffect` block (after `onVoiceChannelJoined`, around line 251):

```typescript
const onVoiceChannelRemoved = ((data: unknown) => {
    const d = data as { id: number } | undefined;
    if (d?.id !== undefined) {
        setChannels(prev => prev.filter(c => c.id !== d.id));
    }
});
```

Add the `bridge.on` registration (after `voice.channelJoined` line):

```typescript
bridge.on('voice.channelRemoved', onVoiceChannelRemoved);
```

Add the `bridge.off` cleanup (after `voice.channelJoined` off line):

```typescript
bridge.off('voice.channelRemoved', onVoiceChannelRemoved);
```

**Step 3: Build frontend and backend**

Run: `dotnet build`
Expected: 0 compilation errors

Run: `cd src/Brmble.Web && npm run build`
Expected: 0 errors

**Step 4: Commit**

```
feat: forward channel deletions to frontend via voice.channelRemoved
```

---

### Task 3: Fix ChannelTree dropping users in root channel (channelId=0)

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:95`

**Step 1: Fix the falsy check for channelId**

Before (line 95):
```typescript
if (user.channelId && channelMap.has(user.channelId)) {
```

After:
```typescript
if (user.channelId !== undefined && channelMap.has(user.channelId)) {
```

JavaScript `0` is falsy, so `user.channelId && ...` drops users in the root channel (id=0). Using `!== undefined` correctly handles channel 0.

**Step 2: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: 0 errors

**Step 3: Commit**

```
fix: show users in root channel (channelId=0) in channel tree
```

---

### Task 4: Fix voice.channelChanged using raw protobuf channelId

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:605-607`

**Step 1: Use User model for channel-change detection and event**

Replace the raw protobuf `userState.ChannelId` reads with model-based reads. The `user` variable from Task 2 of the previous plan (the UserDictionary lookup) is already available at this point in the method.

Before (line 605-607):
```csharp
if (previousChannel.HasValue && userState.ChannelId != previousChannel && isSelf)
{
    _bridge?.Send("voice.channelChanged", new { channelId = userState.ChannelId });
```

After:
```csharp
var currentChannelId = user?.Channel?.Id ?? userState.ChannelId;
if (previousChannel.HasValue && currentChannelId != previousChannel && isSelf)
{
    _bridge?.Send("voice.channelChanged", new { channelId = currentChannelId });
```

Also fix line 636 which checks `userState.ChannelId == 0` — replace with `currentChannelId == 0`:

Before (line 636):
```csharp
else if (userState.ChannelId == 0 && ReceivedServerSync && userState.ShouldSerializeChannelId())
```

After:
```csharp
else if (currentChannelId == 0 && ReceivedServerSync && userState.ShouldSerializeChannelId())
```

**Step 2: Build**

Run: `dotnet build`
Expected: 0 compilation errors

**Step 3: Commit**

```
fix: use model channel ID for local user channel-change detection
```

---

### Task 5: Relax frontend onVoiceChannelJoined guard

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:242`

**Step 1: Remove truthy name check**

Before (line 242):
```typescript
if (d?.id !== undefined && d?.name) {
```

After:
```typescript
if (d?.id !== undefined) {
```

With Task 1 reading from the Channel model, `name` will always be present. But even without it, channels should still update — a channel's position in the tree is determined by `id` and `parent`, not `name`.

**Step 2: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: 0 errors

**Step 3: Commit**

```
fix: allow voice.channelJoined updates without name field
```

---

### Task 6: Forward PermissionDenied to frontend

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (add override)

**Step 1: Add PermissionDenied override**

Add this method after the `Reject` override (after line ~732):

```csharp
public override void PermissionDenied(PermissionDenied permissionDenied)
{
    base.PermissionDenied(permissionDenied);

    var reason = !string.IsNullOrEmpty(permissionDenied.Reason)
        ? permissionDenied.Reason
        : $"Permission denied: {permissionDenied.Type}";

    _bridge?.Send("voice.error", new { message = reason, type = "permissionDenied" });
}
```

**Step 2: Build**

Run: `dotnet build`
Expected: 0 compilation errors

**Step 3: Commit**

```
fix: forward permission denied errors to frontend
```

---

### Task 7: Remove redundant UserStateChannelChanged override

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:644-660`

**Step 1: Remove the entire override**

Delete the `UserStateChannelChanged` method (lines 644-660). The `UserState` override already sends `voice.userJoined` with the correct model data for ALL users (including local). This override only fires for `LocalUser` and sends a duplicate message.

**Step 2: Build**

Run: `dotnet build`
Expected: 0 compilation errors

**Step 3: Commit**

```
refactor: remove redundant UserStateChannelChanged override
```

---

### Task 8: Fix debug log to use model name

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:582`

**Step 1: Use model user name in debug log**

Before (line 582):
```csharp
Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session}), isNew: {isNewUser}");
```

After:
```csharp
Debug.WriteLine($"[Mumble] UserState: {user?.Name ?? userState.Name} (session: {userState.Session}), isNew: {isNewUser}");
```

Note: The `user` variable from the `UserDictionary.TryGetValue` call is available here.

**Step 2: Build**

Run: `dotnet build`
Expected: 0 compilation errors

**Step 3: Commit**

```
fix: use model name in UserState debug log
```

---

### Task 9: Build, test, and verify everything

**Step 1: Full build**

Run: `dotnet build`
Run: `cd src/Brmble.Web && npm run build`
Expected: 0 errors on both

**Step 2: Run tests**

Run: `dotnet test`
Expected: 57 MumbleVoiceEngine tests pass, server tests same as before (3 pre-existing failures from Matrix config)

---
