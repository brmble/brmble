# Server Root Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable real Mumble text chat on the server root channel (channel 0) by making the server name clickable in the sidebar and routing messages through the existing ChatPanel.

**Architecture:** Treat the server root channel as a special selection target (`"server-root"`) in the existing ChatPanel system. The backend routes TextMessage protobufs with channel targeting; the frontend routes incoming messages to the correct chat store based on channel IDs.

**Tech Stack:** React + TypeScript (frontend), C# + MumbleSharp (backend), WebView2 bridge

---

### Task 1: Update MumbleAdapter.SendTextMessage to accept a channel ID

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:203-214` (SendTextMessage method)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:284-291` (voice.sendMessage handler)

**Step 1: Update SendTextMessage to accept an optional channelId parameter**

Change the method signature and set `ChannelIds` on the TextMessage protobuf:

```csharp
public void SendTextMessage(string message, uint? channelId = null)
{
    if (Connection == null || Connection.State != ConnectionStates.Connected)
        return;

    var textMessage = new TextMessage
    {
        Message = message
    };

    if (channelId.HasValue)
    {
        textMessage.ChannelIds = new[] { channelId.Value };
    }

    Connection.SendControl(PacketType.TextMessage, textMessage);
}
```

**Step 2: Update the voice.sendMessage bridge handler to pass channelId**

```csharp
bridge.RegisterHandler("voice.sendMessage", (data) =>
{
    if (data.TryGetProperty("message", out var message))
    {
        uint? channelId = null;
        if (data.TryGetProperty("channelId", out var cid))
        {
            channelId = cid.GetUInt32();
        }
        SendTextMessage(message.GetString() ?? "", channelId);
    }
    return Task.CompletedTask;
});
```

**Step 3: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add channel targeting to SendTextMessage"
```

---

### Task 2: Include channel IDs in incoming voice.message bridge events

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:437-446` (TextMessage override)

**Step 1: Add channelIds to the voice.message payload**

The `TextMessage` protobuf has a `ChannelIds` field (uint array) at `lib/MumbleSharp/MumbleSharp/Packets/Mumble.cs:895-896`. Include it in the bridge event:

```csharp
public override void TextMessage(TextMessage textMessage)
{
    base.TextMessage(textMessage);
    
    _bridge?.Send("voice.message", new 
    { 
        message = textMessage.Message,
        senderSession = textMessage.Actor,
        channelIds = textMessage.ChannelIds ?? Array.Empty<uint>()
    });
}
```

**Step 2: Verify the solution builds**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: include channelIds in voice.message bridge events"
```

---

### Task 3: Update App.tsx state to support "server-root" as a channel selection

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:45-46` (state declarations)
- Modify: `src/Brmble.Web/src/App.tsx:54-55` (channelKey derivation)
- Modify: `src/Brmble.Web/src/App.tsx:67-85` (voice.connected handler)

**Step 1: Change currentChannelId from `number | undefined` to `string | undefined`**

At line 45, change:
```tsx
const [currentChannelId, setCurrentChannelId] = useState<number | undefined>();
```
to:
```tsx
const [currentChannelId, setCurrentChannelId] = useState<string | undefined>();
```

**Step 2: Update channelKey derivation at line 54**

Change:
```tsx
const channelKey = currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
```
to:
```tsx
const channelKey = currentChannelId === 'server-root' ? 'server-root' : currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
```

**Step 3: Default to server-root on connection**

In the `onVoiceConnected` handler (line 67-85), after `setConnected(true)` at line 68, add:
```tsx
setCurrentChannelId('server-root');
setCurrentChannelName('');  // Will be set to serverLabel below
```

Note: `currentChannelName` for server-root will be derived from `serverLabel` in the rendering, so setting it to empty string here is fine (see Task 6).

**Step 4: Verify no TypeScript errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: Some type errors from downstream code that still expects `number` -- these are fixed in subsequent tasks.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: change currentChannelId to string type, default to server-root on connect"
```

---

### Task 4: Update handleSelectChannel and add handleSelectServer

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:220-226` (handleSelectChannel)
- Modify: `src/Brmble.Web/src/App.tsx:228-233` (handleSendMessage)

**Step 1: Update handleSelectChannel to use string IDs**

Change:
```tsx
const handleSelectChannel = (channelId: number) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      setCurrentChannelId(channelId);
      setCurrentChannelName(channel.name);
    }
  };
```
to:
```tsx
const handleSelectChannel = (channelId: number) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      setCurrentChannelId(String(channelId));
      setCurrentChannelName(channel.name);
    }
  };
```

**Step 2: Add handleSelectServer function right after handleSelectChannel**

```tsx
const handleSelectServer = () => {
    setCurrentChannelId('server-root');
    setCurrentChannelName(serverLabel || 'Server');
  };
```

**Step 3: Update handleSendMessage to only send via bridge for server-root**

Change:
```tsx
const handleSendMessage = (content: string) => {
    if (username && content) {
      addMessage(username, content);
      bridge.send('voice.sendMessage', { message: content });
    }
  };
```
to:
```tsx
const handleSendMessage = (content: string) => {
    if (username && content) {
      addMessage(username, content);
      if (currentChannelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: content, channelId: 0 });
      }
    }
  };
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: add handleSelectServer, route server-root messages to Mumble"
```

---

### Task 5: Update voice.message handler to route by channel ID

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:104-111` (onVoiceMessage handler)

**Step 1: Update the voice.message handler to use channelIds for routing**

The challenge: `addMessageRef.current` always adds to the *currently selected* channel's store. For proper routing, we need to check if the message belongs to the currently viewed store. If the user is viewing server-root and a root channel message comes in, it adds directly. If not viewing the right channel, the message is still stored (via a direct localStorage write as a fallback). For simplicity in this first implementation, we route root channel messages (channelIds includes 0, or channelIds is empty) to the server-root store, and only add via `addMessageRef` if the user is currently viewing that store.

Change:
```tsx
const onVoiceMessage = ((data: unknown) => {
      const d = data as { message: string; senderSession?: number } | undefined;
      if (d?.message) {
        const senderUser = usersRef.current.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        addMessageRef.current(senderName, d.message);
      }
    });
```
to:
```tsx
const onVoiceMessage = ((data: unknown) => {
      const d = data as { message: string; senderSession?: number; channelIds?: number[] } | undefined;
      if (d?.message) {
        const senderUser = usersRef.current.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        // Route to server-root if message targets root channel (0) or has no channel target
        const isRootMessage = !d.channelIds || d.channelIds.length === 0 || d.channelIds.includes(0);
        const currentKey = currentChannelIdRef.current;
        if (isRootMessage && currentKey === 'server-root') {
          addMessageRef.current(senderName, d.message);
        } else if (!isRootMessage && currentKey !== 'server-root') {
          addMessageRef.current(senderName, d.message);
        }
        // Messages for non-active channels are dropped for now (future: background storage)
      }
    });
```

Note: This requires adding a `currentChannelIdRef` alongside the existing refs. Add near line 58-63:
```tsx
const currentChannelIdRef = useRef(currentChannelId);
currentChannelIdRef.current = currentChannelId;
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: route incoming messages by channel ID"
```

---

### Task 6: Make server name clickable in Sidebar

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:5-16` (props interface)
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx:33-38` (server-info-panel render)
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css` (add active/hover styles)

**Step 1: Add new props to SidebarProps**

Add `onSelectServer` and `isServerChatActive` to the interface:

```tsx
interface SidebarProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel: (channelId: number) => void;
  onSelectServer?: () => void;
  isServerChatActive?: boolean;
  connected?: boolean;
  serverLabel?: string;
  serverAddress?: string;
  username?: string;
  onDisconnect?: () => void;
}
```

**Step 2: Destructure new props and make server-info-panel clickable**

Update the destructuring at line 18-29 to include `onSelectServer` and `isServerChatActive`.

Change the server-info-panel div (lines 33-38) from:
```tsx
<div className="server-info-panel">
  <div className="server-info-name">{serverLabel || 'Server'}</div>
  {serverAddress && (
    <div className="server-info-address">{serverAddress}</div>
  )}
</div>
```
to:
```tsx
<div 
  className={`server-info-panel${isServerChatActive ? ' server-info-active' : ''}`}
  onClick={onSelectServer}
  style={{ cursor: onSelectServer ? 'pointer' : undefined }}
>
  <div className="server-info-name">{serverLabel || 'Server'}</div>
  {serverAddress && (
    <div className="server-info-address">{serverAddress}</div>
  )}
</div>
```

**Step 3: Add hover and active styles to Sidebar.css**

Add after the existing `.server-info-address` block (after line 32):

```css
.server-info-panel[style*="cursor: pointer"]:hover {
  background: var(--bg-hover);
  border-color: var(--border-default);
}

.server-info-active {
  background: var(--bg-hover);
  border-color: var(--accent-lemon);
}

.server-info-active .server-info-name {
  color: var(--accent-lemon);
}
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.css
git commit -m "feat: make server name clickable in sidebar for server chat"
```

---

### Task 7: Wire up App.tsx to pass new props and fix ChatPanel rendering

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:269-290` (Sidebar and ChatPanel rendering)

**Step 1: Pass new props to Sidebar**

Change the Sidebar JSX (lines 269-280) to include the new props:
```tsx
<Sidebar
  channels={channels}
  users={users}
  currentChannelId={currentChannelId !== 'server-root' ? Number(currentChannelId) : undefined}
  onJoinChannel={handleJoinChannel}
  onSelectChannel={handleSelectChannel}
  onSelectServer={handleSelectServer}
  isServerChatActive={currentChannelId === 'server-root'}
  connected={connected}
  serverLabel={serverLabel}
  serverAddress={serverAddress}
  username={username}
  onDisconnect={handleDisconnect}
/>
```

**Step 2: Update ChatPanel rendering to handle server-root**

Change the ChatPanel JSX (lines 283-289):
```tsx
<ChatPanel
  channelId={currentChannelId || undefined}
  channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
  messages={messages}
  currentUsername={username}
  onSendMessage={handleSendMessage}
/>
```

**Step 3: Verify the frontend builds**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire server chat props through App layout"
```

---

### Task 8: Build and verify everything compiles

**Files:** None (verification only)

**Step 1: Build the C# backend**

Run: `dotnet build`
Expected: Build succeeded

**Step 2: Build the frontend**

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeded with no errors

**Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build issues from server root chat integration"
```

(Only if there were fixes needed.)
