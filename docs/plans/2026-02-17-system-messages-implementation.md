# System Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display server system messages (connecting, welcome text, user joins/leaves, kicks/bans) in the server root chat as "Server" sender bubbles with distinct styling.

**Architecture:** A single `voice.system` bridge event carries all system message types from C# to JS. The frontend extends `ChatMessage` with optional `type` and `html` fields. `MessageBubble` gains a system variant. All system messages route exclusively to the `server-root` chat store.

**Tech Stack:** C# + MumbleSharp (backend), React + TypeScript (frontend), WebView2 bridge

---

### Task 1: Extend ChatMessage type with system message fields

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:25-31`

**Step 1: Add optional `type` and `html` fields to ChatMessage**

```typescript
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  content: string;
  timestamp: Date;
  type?: 'system';
  html?: boolean;
}
```

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No new errors (existing code doesn't use the new fields yet)

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: extend ChatMessage type with system message fields"
```

---

### Task 2: Extend useChatStore to support type and html fields

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts:30-43` (addMessage)
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts:58-78` (addMessageToStore)

**Step 1: Update `addMessage` to accept optional type and html parameters**

Change `addMessage` (line 30-43) from:

```typescript
const addMessage = useCallback((sender: string, content: string) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date()
    };
    setMessages(prev => {
      const updated = [...prev, newMessage];
      saveMessages(updated);
      return updated;
    });
  }, [channelId, saveMessages]);
```

to:

```typescript
const addMessage = useCallback((sender: string, content: string, type?: 'system', html?: boolean) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date(),
      ...(type && { type }),
      ...(html && { html }),
    };
    setMessages(prev => {
      const updated = [...prev, newMessage];
      saveMessages(updated);
      return updated;
    });
  }, [channelId, saveMessages]);
```

**Step 2: Update `addMessageToStore` to accept optional type and html parameters**

Change `addMessageToStore` (line 58-78) from:

```typescript
export function addMessageToStore(storeKey: string, sender: string, content: string) {
```

to:

```typescript
export function addMessageToStore(storeKey: string, sender: string, content: string, type?: 'system', html?: boolean) {
```

And update the `newMessage` object inside it:

```typescript
const newMessage: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: storeKey,
    sender,
    content,
    timestamp: new Date(),
    ...(type && { type }),
    ...(html && { html }),
  };
```

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors (new params are optional, existing callers don't need changes)

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/hooks/useChatStore.ts
git commit -m "feat: extend chat store functions with type and html params"
```

---

### Task 3: Add system message variant to MessageBubble

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` (full file)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` (add system styles)

**Step 1: Add isSystem and html props to MessageBubble**

Replace the full `MessageBubble.tsx` content:

```tsx
import './MessageBubble.css';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: Date;
  isOwnMessage?: boolean;
  isSystem?: boolean;
  html?: boolean;
}

export function MessageBubble({ sender, content, timestamp, isOwnMessage, isSystem, html }: MessageBubbleProps) {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarLetter = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  const classes = ['message-bubble'];
  if (isOwnMessage) classes.push('own');
  if (isSystem) classes.push('message-bubble--system');

  return (
    <div className={classes.join(' ')}>
      <div className="message-avatar">
        <span className="avatar-letter">{getAvatarLetter(sender)}</span>
      </div>
      <div className="message-content">
        <div className="message-header">
          <span className="message-sender">{sender}</span>
          <span className="message-time">{formatTime(timestamp)}</span>
        </div>
        {html ? (
          <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
        ) : (
          <p className="message-text">{content}</p>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add system message CSS styles to MessageBubble.css**

Append to end of `MessageBubble.css`:

```css
/* System message variant */
.message-bubble--system .message-avatar {
  background: linear-gradient(135deg, var(--bg-elevated, #2a2a3e) 0%, var(--border-subtle, #3a3a4e) 100%);
}

.message-bubble--system .message-sender {
  color: var(--text-muted);
  font-style: italic;
}

.message-bubble--system .message-text {
  color: var(--text-muted);
}
```

**Step 3: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors (new props are optional)

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css
git commit -m "feat: add system message variant to MessageBubble"
```

---

### Task 4: Pass system message props through ChatPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx:66-74` (message rendering)

**Step 1: Pass type and html through to MessageBubble**

Change the `messages.map` block (line 66-74) from:

```tsx
messages.map(message => (
            <MessageBubble
              key={message.id}
              sender={message.sender}
              content={message.content}
              timestamp={message.timestamp}
              isOwnMessage={message.sender === currentUsername}
            />
          ))
```

to:

```tsx
messages.map(message => (
            <MessageBubble
              key={message.id}
              sender={message.sender}
              content={message.content}
              timestamp={message.timestamp}
              isOwnMessage={!message.type && message.sender === currentUsername}
              isSystem={message.type === 'system'}
              html={message.html}
            />
          ))
```

Note: `isOwnMessage` is set to false for system messages (they should never have own-message styling).

**Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx
git commit -m "feat: pass system message props through ChatPanel to MessageBubble"
```

---

### Task 5: Add voice.system handler in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:107-139` (after onVoiceMessage handler)
- Modify: `src/Brmble.Web/src/App.tsx:194-216` (bridge event registration and cleanup)

**Step 1: Add onVoiceSystem handler after onVoiceMessage**

Insert after the `onVoiceMessage` handler closing (after the `});` at line ~131):

```typescript
    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html);
        }
      }
    });
```

**Step 2: Register the handler**

In the bridge registration block (around line 194-203), add after `bridge.on('voice.message', onVoiceMessage);`:

```typescript
    bridge.on('voice.system', onVoiceSystem);
```

**Step 3: Add cleanup**

In the cleanup return block (around line 205-215), add after `bridge.off('voice.message', onVoiceMessage);`:

```typescript
      bridge.off('voice.system', onVoiceSystem);
```

**Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors

**Step 5: Build frontend**

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeded

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add voice.system bridge handler for system messages"
```

---

### Task 6: Add SendSystemMessage helper in MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (after SendTextMessage method, around line 224)

**Step 1: Add the SendSystemMessage helper method**

Insert after `SendTextMessage` (after line 224):

```csharp
    /// <summary>
    /// Sends a system message to the frontend via the voice.system bridge event.
    /// </summary>
    /// <param name="message">The message text (may contain HTML for welcome messages).</param>
    /// <param name="systemType">The type: connecting, welcome, userJoined, userLeft, kicked, banned.</param>
    /// <param name="html">Whether the message contains HTML that should be rendered as-is.</param>
    private void SendSystemMessage(string message, string systemType, bool html = false)
    {
        _bridge?.Send("voice.system", new { message, systemType, html });
    }
```

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded (method is private, no callers yet — that's fine)

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add SendSystemMessage helper method"
```

---

### Task 7: Emit "connecting" system message from Connect()

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:91-98` (Connect method, before MumbleConnection creation)

**Step 1: Add connecting system message before connection attempt**

Insert just before `var connection = new MumbleConnection(...)` at line 93:

```csharp
            SendSystemMessage($"Connecting to {host}:{port}...", "connecting");
```

So lines 91-99 become:

```csharp
        try
        {
            SendSystemMessage($"Connecting to {host}:{port}...", "connecting");

            var connection = new MumbleConnection(host, port, this, voiceSupport: true);
            
            _cts = new CancellationTokenSource();
            _processTask = Task.Run(() => ProcessLoop(_cts.Token));
```

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: emit connecting system message on Connect()"
```

---

### Task 8: Emit welcome message from ServerSync()

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:327-354` (ServerSync override)

**Step 1: Add a field to track the last welcome text**

Add a field at the top of the class (after line 23, near `_processTask`):

```csharp
    private string? _lastWelcomeText;
```

**Step 2: Emit welcome message after voice.connected in ServerSync**

After the `_bridge?.Send("voice.connected", ...)` call (after line 351), add:

```csharp
        if (!string.IsNullOrEmpty(serverSync.WelcomeText))
        {
            _lastWelcomeText = serverSync.WelcomeText;
            SendSystemMessage(serverSync.WelcomeText, "welcome", html: true);
        }
```

So the end of ServerSync becomes:

```csharp
        _bridge?.Send("voice.connected", new { 
            username = LocalUser?.Name,
            channels = channelList,
            users = userList
        });
        
        if (!string.IsNullOrEmpty(serverSync.WelcomeText))
        {
            _lastWelcomeText = serverSync.WelcomeText;
            SendSystemMessage(serverSync.WelcomeText, "welcome", html: true);
        }

        Debug.WriteLine($"[Mumble] Sent {channelList.Count} channels and {userList.Count} users");
    }
```

**Step 3: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: emit welcome system message from ServerSync"
```

---

### Task 9: Add ServerConfig override for updated welcome text

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (add new method after ServerSync, around line 360)

**Step 1: Add ServerConfig override**

Insert after the ServerSync method closing brace:

```csharp
    /// <summary>
    /// Called when the server sends updated configuration.
    /// </summary>
    /// <param name="serverConfig">The server config message.</param>
    public override void ServerConfig(MumbleProto.ServerConfig serverConfig)
    {
        base.ServerConfig(serverConfig);

        if (serverConfig.ShouldSerializeWelcomeText() 
            && !string.IsNullOrEmpty(serverConfig.WelcomeText) 
            && serverConfig.WelcomeText != _lastWelcomeText)
        {
            _lastWelcomeText = serverConfig.WelcomeText;
            SendSystemMessage(serverConfig.WelcomeText, "welcome", html: true);
        }
    }
```

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add ServerConfig override for updated welcome text"
```

---

### Task 10: Emit userJoined system messages from UserState()

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:360-390` (UserState override)

**Step 1: Detect new users before calling base.UserState()**

`base.UserState()` adds the user to `UserDictionary`. To detect genuinely new users (not state updates), check if the session already exists **before** the base call.

Change `UserState` from:

```csharp
    public override void UserState(UserState userState)
    {
        var previousChannel = LocalUser?.Channel?.Id;
        
        base.UserState(userState);
        
        Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session})");
        
        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        var newChannel = userState.ChannelId;
        
        // Send userJoined for new users or channel changes
        _bridge?.Send("voice.userJoined", new 
        { 
            session = userState.Session, 
            name = userState.Name,
            channelId = userState.ChannelId,
            muted = userState.Mute || userState.SelfMute,
            deafened = userState.Deaf || userState.SelfDeaf,
            self = isSelf
        });
        
        // If user switched channels, notify
        if (previousChannel.HasValue && newChannel != previousChannel && isSelf)
        {
            _bridge?.Send("voice.channelChanged", new
            {
                channelId = newChannel
            });
        }
    }
```

to:

```csharp
    public override void UserState(UserState userState)
    {
        var previousChannel = LocalUser?.Channel?.Id;
        var isNewUser = !UserDictionary.ContainsKey(userState.Session);
        
        base.UserState(userState);
        
        Debug.WriteLine($"[Mumble] UserState: {userState.Name} (session: {userState.Session}), isNew: {isNewUser}");
        
        var isSelf = LocalUser != null && userState.Session == LocalUser.Id;
        var newChannel = userState.ChannelId;
        
        // Send userJoined for new users or channel changes
        _bridge?.Send("voice.userJoined", new 
        { 
            session = userState.Session, 
            name = userState.Name,
            channelId = userState.ChannelId,
            muted = userState.Mute || userState.SelfMute,
            deafened = userState.Deaf || userState.SelfDeaf,
            self = isSelf
        });
        
        // Emit system message for genuinely new users (not initial sync, not self)
        if (isNewUser && !isSelf && ReceivedServerSync)
        {
            var userName = userState.Name ?? "Unknown";
            SendSystemMessage($"{userName} connected to the server", "userJoined");
        }

        // If user switched channels, notify
        if (previousChannel.HasValue && newChannel != previousChannel && isSelf)
        {
            _bridge?.Send("voice.channelChanged", new
            {
                channelId = newChannel
            });
        }
    }
```

Key points:
- `isNewUser` checks `UserDictionary` **before** `base.UserState()` adds the user.
- `ReceivedServerSync` guard prevents system messages for users that arrive during initial login handshake (those users are part of the server state dump, not new connections).
- `!isSelf` prevents a "you connected" message for the local user.

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: emit userJoined system messages for new users"
```

---

### Task 11: Emit userLeft/kicked/banned system messages from UserRemove()

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:418-428` (UserRemove override)

**Step 1: Look up user name before base call, then emit appropriate system message**

`base.UserRemove()` removes the user from `UserDictionary`, so we must look up the name first. Also, if the removed user is self, `base.UserRemove()` calls `Connection.Close()`.

Change `UserRemove` from:

```csharp
    public override void UserRemove(UserRemove userRemove)
    {
        base.UserRemove(userRemove);
        
        Debug.WriteLine($"[Mumble] UserRemove: session {userRemove.Session}");
        
        _bridge?.Send("voice.userLeft", new 
        { 
            session = userRemove.Session
        });
    }
```

to:

```csharp
    public override void UserRemove(UserRemove userRemove)
    {
        // Look up user name before base call removes them from dictionary
        string? userName = null;
        bool isSelf = LocalUser != null && userRemove.Session == LocalUser.Id;
        if (UserDictionary.TryGetValue(userRemove.Session, out var user))
        {
            userName = user.Name;
        }

        base.UserRemove(userRemove);
        
        Debug.WriteLine($"[Mumble] UserRemove: session {userRemove.Session}, name: {userName}, isSelf: {isSelf}");
        
        _bridge?.Send("voice.userLeft", new 
        { 
            session = userRemove.Session
        });

        // Emit system message
        if (isSelf)
        {
            // Self was kicked or banned
            var actorName = "the server";
            if (userRemove.ShouldSerializeActor() && UserDictionary.TryGetValue(userRemove.Actor, out var actor))
            {
                actorName = actor.Name ?? "Unknown";
            }
            var reason = !string.IsNullOrEmpty(userRemove.Reason) ? $": {userRemove.Reason}" : "";

            if (userRemove.Ban == true)
            {
                SendSystemMessage($"You were banned by {actorName}{reason}", "banned");
            }
            else
            {
                SendSystemMessage($"You were kicked by {actorName}{reason}", "kicked");
            }
        }
        else if (userName != null)
        {
            SendSystemMessage($"{userName} disconnected from the server", "userLeft");
        }
    }
```

Key points:
- User name lookup happens **before** `base.UserRemove()`.
- `isSelf` check happens **before** base call too (since base call nulls LocalUser for self-removal).
- Actor name lookup happens **after** base call — the actor (the admin who kicked) is still connected, so they remain in `UserDictionary`.
- `userRemove.Ban` is a `bool?` — check with `== true`.
- `ShouldSerializeActor()` checks if the Actor field was set in the protobuf.

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: emit userLeft/kicked/banned system messages from UserRemove"
```

---

### Task 12: Clear _lastWelcomeText on disconnect

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:126-161` (Disconnect method)

**Step 1: Reset _lastWelcomeText in Disconnect()**

Add after `ChannelDictionary.Clear();` (around line 157):

```csharp
        _lastWelcomeText = null;
```

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "fix: clear welcome text state on disconnect"
```

---

### Task 13: Full build verification

**Files:** None (verification only)

**Step 1: Build the frontend**

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeded

**Step 2: Build the C# backend**

Run: `dotnet build --no-incremental`
Expected: Build succeeded (ignore pre-existing ProtoBuf LSP warnings from MumbleSharp submodule)

**Step 3: Run tests**

Run: `dotnet test`
Expected: All tests pass

**Step 4: If any fixes were needed, commit them**

```bash
git add -A
git commit -m "fix: resolve build issues from system messages integration"
```

(Only if there were fixes needed.)
