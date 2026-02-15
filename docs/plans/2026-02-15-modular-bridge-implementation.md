# Modular Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the C# ↔ JavaScript bridge to use service namespaced messages (voice.*) with clean event-based naming, establishing modular architecture for future services.

**Architecture:** Keep bridge thin - just transport. Services handle protocol specifics. Events emitted by services, bridge forwards to JS. UI thread marshaling already implemented.

**Tech Stack:** C#, JavaScript/TypeScript, WebView2, MumbleSharp

---

### Task 1: Create IService interface

**Files:**
- Create: `src/Brmble.Client/Bridge/IService.cs`

**Step 1: Create the interface**

```csharp
namespace Brmble.Client.Bridge;

public interface IService
{
    string ServiceName { get; }
    void Initialize(NativeBridge bridge);
    void RegisterHandlers(NativeBridge bridge);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Bridge/IService.cs
git commit -m "feat: add IService interface for modular services"
```

---

### Task 2: Rename WebViewBridge to NativeBridge

**Files:**
- Modify: `src/Brmble.Client/WebViewBridge.cs` → rename to `NativeBridge.cs`
- Modify: `src/Brmble.Client/Program.cs` - update references

**Step 1: Rename class in WebViewBridge.cs**

Change `class WebViewBridge` to `class NativeBridge`.

**Step 2: Update Program.cs**

Change `new WebViewBridge(...)` to `new NativeBridge(...)`.

**Step 3: Commit**

```bash
git add src/Brmble.Client/WebViewBridge.cs src/Brmble.Client/Program.cs
git commit -m "refactor: rename WebViewBridge to NativeBridge"
```

---

### Task 3: Create VoiceService abstract class

**Files:**
- Create: `src/Brmble.Client/Services/Voice/VoiceService.cs`

**Step 1: Create the abstract class**

```csharp
using MumbleSharp;
using MumbleSharp.Model;

namespace Brmble.Client.Services.Voice;

public abstract class VoiceService : IService
{
    public abstract string ServiceName { get; }
    public abstract void Connect(string host, int port, string username, string password = "");
    public abstract void Disconnect();
    public abstract void JoinChannel(uint channelId);
    public abstract void SendMessage(string message);
    
    public abstract void Initialize(NativeBridge bridge);
    public abstract void RegisterHandlers(NativeBridge bridge);

    // Events that services emit
    public event Action? Connected;
    public event Action? Disconnected;
    public event Action<string>? Error;
    public event Action<User>? UserJoined;
    public event Action<User>? UserLeft;
    public event Action<Channel>? ChannelJoined;
    public event Action<string>? MessageReceived;
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/VoiceService.cs
git commit -m "feat: add abstract VoiceService class"
```

---

### Task 4: Rename MumbleClient to MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/MumbleClient.cs` → rename to `MumbleAdapter.cs`
- Modify: `src/Brmble.Client/Program.cs` - update references

**Step 1: Rename class and inherit from VoiceService**

Change class to `class MumbleAdapter : VoiceService`.

**Step 2: Update Program.cs**

Change `new MumbleClient(_bridge)` to `new MumbleAdapter(_bridge)`.

**Step 3: Commit**

```bash
git add src/Brmble.Client/MumbleClient.cs src/Brmble.Client/Program.cs
git commit -m "refactor: rename MumbleClient to MumbleAdapter, inherit VoiceService"
```

---

### Task 5: Update message types to use voice. prefix

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- Modify: `src/Brmble.Web/src/bridge.ts`
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Update MumbleAdapter to use voice.* message types**

Change:
- `mumbleConnect` → `voice.connect`
- `mumbleDisconnect` → `voice.disconnect`
- `mumbleJoinChannel` → `voice.joinChannel`
- `mumbleSendMessage` → `voice.sendMessage`
- `mumbleConnected` → `voice.connected`
- `mumbleDisconnected` → `voice.disconnected`
- `mumbleUser` → `voice.userJoined` / `voice.userLeft`
- `mumbleChannel` → `voice.channelJoined`
- `mumbleMessage` → `voice.message`
- `mumbleError` → `voice.error`

**Step 2: Update JavaScript bridge and App.tsx**

Apply same naming changes to JavaScript side.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Web/src/bridge.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: use voice.* message namespace for modularity"
```

---

### Task 6: Build and test

**Step 1: Build the client**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

**Step 2: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 3: Test manually**

Run client and verify:
- Connect to Mumble server works
- Channels display
- Users display
- Join channel works

**Step 4: Commit**

```bash
git add -A
git commit -m "test: verify modular bridge works"
```

---

### Task 7: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

Add documentation about the bridge architecture and how to add new services.

---

**Plan complete. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
