# DM Mumble Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route Mumble private (user-to-user) text messages to the DM chat system instead of displaying them in the server/root channel. Wire up outgoing DM messages to send as Mumble private messages.

**Architecture:** The Mumble protocol's `TextMessage` has a `Sessions` field that distinguishes private messages from channel messages. When `Sessions` is populated and `ChannelIds`/`TreeIds` are empty, it's a private message. We modify the C# backend to (1) include `sessions` in the `voice.message` bridge event, (2) add a `voice.sendPrivateMessage` handler for outgoing DMs, and (3) update the frontend to detect incoming private messages and route them to `dm-{senderSession}` stores, and send outgoing DMs via the bridge.

**Tech Stack:** C# (.NET), MumbleSharp/MumbleProto, React/TypeScript, WebView2 bridge

---

### Task 1: Include `sessions` field in the `voice.message` bridge event

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:478-487`

**Step 1: Update `TextMessage` override to include sessions**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, replace the `TextMessage` override:

```csharp
public override void TextMessage(TextMessage textMessage)
{
    base.TextMessage(textMessage);
    _bridge?.Send("voice.message", new
    {
        message = textMessage.Message,
        senderSession = textMessage.Actor,
        channelIds = textMessage.ChannelIds ?? Array.Empty<uint>(),
    });
}
```

with:

```csharp
public override void TextMessage(TextMessage textMessage)
{
    base.TextMessage(textMessage);
    _bridge?.Send("voice.message", new
    {
        message = textMessage.Message,
        senderSession = textMessage.Actor,
        channelIds = textMessage.ChannelIds ?? Array.Empty<uint>(),
        sessions = textMessage.Sessions ?? Array.Empty<uint>(),
    });
}
```

This adds the `sessions` array so the frontend can detect private messages.

**Step 2: Build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds (may fail if the process is running — that's OK, check for compile errors only).

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: include sessions field in voice.message bridge event"
```

---

### Task 2: Add `voice.sendPrivateMessage` bridge handler and method

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:151-178,277-289`

**Step 1: Add `SendPrivateMessage` method**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, after the `SendTextMessage` method (around line 178), add:

```csharp
/// <summary>
/// Sends a private text message to a specific user session.
/// </summary>
/// <param name="message">The message text to send.</param>
/// <param name="targetSession">The session ID of the target user.</param>
public void SendPrivateMessage(string message, uint targetSession)
{
    if (Connection is not { State: ConnectionStates.Connected })
        return;

    var textMessage = new TextMessage
    {
        Message = message,
        Sessions = new[] { targetSession },
    };

    Connection.SendControl(PacketType.TextMessage, textMessage);
}
```

**Step 2: Register the bridge handler**

In the `RegisterHandlers` method, after the `voice.sendMessage` handler (around line 289), add:

```csharp
bridge.RegisterHandler("voice.sendPrivateMessage", data =>
{
    if (data.TryGetProperty("message", out var message) &&
        data.TryGetProperty("targetSession", out var session))
    {
        SendPrivateMessage(message.GetString() ?? "", session.GetUInt32());
    }
    return Task.CompletedTask;
});
```

**Step 3: Build to verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds (compile errors only matter).

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add voice.sendPrivateMessage bridge handler for DM sending"
```

---

### Task 3: Route incoming private messages to DM stores on the frontend

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:79-92,134-160`

This is the most important task. The `onVoiceMessage` handler needs to detect when a message is private (has `sessions`, no `channelIds`) and route it to the DM store instead of a channel store. It also needs to update the DM contacts list and increment unread counts.

**Step 1: Add refs for DM state needed inside the bridge handler**

In `src/Brmble.Web/src/App.tsx`, after the existing refs (around line 91), add:

```tsx
const selectedDMUserIdRef = useRef(selectedDMUserId);
selectedDMUserIdRef.current = selectedDMUserId;
const appModeRef = useRef(appMode);
appModeRef.current = appMode;
const addDMMessageRef = useRef(addDMMessage);
addDMMessageRef.current = addDMMessage;
```

**Step 2: Update the `onVoiceMessage` handler**

Replace the existing `onVoiceMessage` handler (lines ~134-160):

```tsx
const onVoiceMessage = ((data: unknown) => {
    const d = data as { message: string; senderSession?: number; channelIds?: number[] } | undefined;
    if (d?.message) {
        // Skip own message echoes -- we already added them locally in handleSendMessage
        const selfUser = usersRef.current.find(u => u.self);
        if (selfUser && d.senderSession === selfUser.session) {
            return;
        }
        const senderUser = usersRef.current.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        // Route to server-root if message targets root channel (0) or has no channel target
        const isRootMessage = !d.channelIds || d.channelIds.length === 0 || d.channelIds.includes(0);
        const targetKey = isRootMessage ? 'server-root' : `channel-${d.channelIds![0]}`;
        const currentKey = currentChannelIdRef.current;
        const currentStoreKey = currentKey === 'server-root' ? 'server-root' : currentKey ? `channel-${currentKey}` : 'no-channel';
        if (targetKey === currentStoreKey) {
            // Message belongs to the currently viewed store -- add via React state
            addMessageRef.current(senderName, d.message);
        } else {
            // Message belongs to a different store -- write directly to localStorage
            addMessageToStore(targetKey, senderName, d.message);
        }
        const newUnread = unreadCountRef.current + 1;
        setUnreadCount(newUnread);
        updateBadge(newUnread, hasPendingInviteRef.current);
    }
});
```

with:

```tsx
const onVoiceMessage = ((data: unknown) => {
    const d = data as {
        message: string;
        senderSession?: number;
        channelIds?: number[];
        sessions?: number[];
    } | undefined;
    if (!d?.message) return;

    const selfUser = usersRef.current.find(u => u.self);

    // Detect private message: has sessions, no channelIds
    const isPrivateMessage = d.sessions && d.sessions.length > 0 &&
        (!d.channelIds || d.channelIds.length === 0);

    if (isPrivateMessage) {
        // Skip own echoes for private messages too
        if (selfUser && d.senderSession === selfUser.session) return;

        const senderSession = String(d.senderSession);
        const senderUser = usersRef.current.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        const dmStoreKey = `dm-${senderSession}`;

        // Check if user is currently viewing this DM conversation
        const isViewingThisDM = appModeRef.current === 'dm' &&
            selectedDMUserIdRef.current === senderSession;

        if (isViewingThisDM) {
            // Add via React state so it appears immediately
            addDMMessageRef.current(senderName, d.message);
        } else {
            // Write to localStorage in the background
            addMessageToStore(dmStoreKey, senderName, d.message);
        }

        // Update DM contacts: upsert with lastMessage and increment unread
        // (only increment if not currently viewing this DM)
        const updated = upsertDMContact(senderSession, senderName, d.message, !isViewingThisDM);
        setDmContacts(updated.map(c => ({
            userId: c.userId,
            userName: c.userName,
            lastMessage: c.lastMessage,
            lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
            unread: c.unread,
        })));
        return;
    }

    // Channel message (existing logic)
    // Skip own message echoes
    if (selfUser && d.senderSession === selfUser.session) return;

    const senderUser = usersRef.current.find(u => u.session === d.senderSession);
    const senderName = senderUser?.name || 'Unknown';
    const isRootMessage = !d.channelIds || d.channelIds.length === 0 || d.channelIds.includes(0);
    const targetKey = isRootMessage ? 'server-root' : `channel-${d.channelIds![0]}`;
    const currentKey = currentChannelIdRef.current;
    const currentStoreKey = currentKey === 'server-root' ? 'server-root' : currentKey ? `channel-${currentKey}` : 'no-channel';
    if (targetKey === currentStoreKey) {
        addMessageRef.current(senderName, d.message);
    } else {
        addMessageToStore(targetKey, senderName, d.message);
    }
    const newUnread = unreadCountRef.current + 1;
    setUnreadCount(newUnread);
    updateBadge(newUnread, hasPendingInviteRef.current);
});
```

**Step 3: Build to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no TypeScript errors.

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: route incoming Mumble private messages to DM chat stores"
```

---

### Task 4: Wire outgoing DM messages to the bridge

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:317-329`

Currently `handleSendDMMessage` only writes to localStorage. It needs to also send via the bridge.

**Step 1: Update `handleSendDMMessage`**

Replace the existing `handleSendDMMessage` (lines ~317-329):

```tsx
const handleSendDMMessage = (content: string) => {
    if (username && content && selectedDMUserId) {
        addDMMessage(username, content);
        const updated = upsertDMContact(selectedDMUserId, selectedDMUserName, content);
        setDmContacts(updated.map(c => ({
            userId: c.userId,
            userName: c.userName,
            lastMessage: c.lastMessage,
            lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
            unread: c.unread,
        })));
    }
};
```

with:

```tsx
const handleSendDMMessage = (content: string) => {
    if (username && content && selectedDMUserId) {
        addDMMessage(username, content);
        bridge.send('voice.sendPrivateMessage', {
            message: content,
            targetSession: Number(selectedDMUserId),
        });
        const updated = upsertDMContact(selectedDMUserId, selectedDMUserName, content);
        setDmContacts(updated.map(c => ({
            userId: c.userId,
            userName: c.userName,
            lastMessage: c.lastMessage,
            lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
            unread: c.unread,
        })));
    }
};
```

The key addition is the `bridge.send('voice.sendPrivateMessage', ...)` call. The `selectedDMUserId` is already the session ID as a string (set from `String(u.session)` in `availableUsers` and from `senderSession` on incoming messages), so `Number(selectedDMUserId)` converts it back for the C# handler.

**Step 2: Build to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds with no TypeScript errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: send outgoing DM messages as Mumble private messages via bridge"
```

---

### Task 5: Final verification and cleanup

**Files:**
- Verify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Verify: `src/Brmble.Web/src/App.tsx`
- Verify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Run full frontend build**

Run: `cd src/Brmble.Web && npm run build`
Expected: Clean build, no errors.

**Step 2: Run full .NET build**

Run: `dotnet build`
Expected: Build succeeds (may warn about DLL locks if client is running — only check for compile errors).

**Step 3: Run tests**

Run: `dotnet test`
Expected: All tests pass.

**Step 4: Verify no dangling references**

Search for any leftover code that routes private messages to channel stores. Ensure:
- `onVoiceMessage` handles the private message branch before the channel message branch
- `handleSendDMMessage` calls `bridge.send('voice.sendPrivateMessage', ...)`
- `TextMessage` override includes `sessions` in the bridge event
- `voice.sendPrivateMessage` handler is registered

**Step 5: Commit (if any cleanup was needed)**

```bash
git add -u
git commit -m "chore: final verification of DM Mumble routing"
```

---

## Message Flow Summary

### Incoming private message:
```
Mumble Server → MumbleSharp TextMessage(sessions=[targetId], channelIds=[])
  → MumbleAdapter.TextMessage() → bridge.Send("voice.message", {sessions: [targetId], ...})
    → App.tsx onVoiceMessage → detects sessions.length > 0 && channelIds.length === 0
      → routes to dm-{senderSession} store
      → updates dmContacts with unread++
```

### Outgoing private message:
```
User types in DM ChatPanel → handleSendDMMessage(content)
  → addDMMessage (local store) + bridge.send("voice.sendPrivateMessage", {message, targetSession})
    → MumbleAdapter.SendPrivateMessage() → TextMessage{Sessions=[target]}
      → Mumble Server → delivers to target user
```

### Channel message (unchanged):
```
Mumble Server → TextMessage(channelIds=[id], sessions=[])
  → same as before → routes to channel-{id} or server-root store
```
