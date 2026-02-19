# Speaking Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a mint green pulsing glow around users when they are speaking, displayed in both ChannelTree and UserPanel.

**Architecture:** Track speaking state per user session via bridge events. Pass speaking boolean to UI components. Use CSS animations for the glow effect.

**Tech Stack:** React, TypeScript, CSS, C# (AudioManager)

---

### Task 1: Update User type to include speaking property

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:15-23`

**Step 1: Add speaking to User interface**

```typescript
export interface User {
  id?: string;
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  speaking?: boolean;
}
```

---

### Task 2: Add speaking state tracking in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add speaking state**

```typescript
const [speakingUsers, setSpeakingUsers] = useState<Map<number, boolean>>(new Map());
```

**Step 2: Add voice.userSpeaking and voice.userSilent listeners**

The backend sends two events:
- `voice.userSpeaking` - when a user starts speaking (includes `{ session: number }`)
- `voice.userSilent` - when a user stops speaking (includes `{ session: number }`)

```typescript
const onVoiceUserSpeaking = ((data: unknown) => {
  const d = data as { session: number } | undefined;
  if (d?.session !== undefined) {
    setSpeakingUsers(prev => {
      const next = new Map(prev);
      next.set(d.session, true);
      return next;
    });
  }
});

const onVoiceUserSilent = ((data: unknown) => {
  const d = data as { session: number } | undefined;
  if (d?.session !== undefined) {
    setSpeakingUsers(prev => {
      const next = new Map(prev);
      next.delete(d.session);
      return next;
    });
  }
});
```

Add to bridge listeners:
```typescript
bridge.on('voice.userSpeaking', onVoiceUserSpeaking);
bridge.on('voice.userSilent', onVoiceUserSilent);
```

**Step 3: Pass speaking state to components**

- Pass `speakingUsers={speakingUsers}` to Sidebar
- Pass `speaking={speakingUsers.has(selfSession)}` to Header

---

### Task 3: Update Sidebar to pass speakingUsers to ChannelTree

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.tsx`

**Step 1: Add speakingUsers to SidebarProps**

```typescript
interface SidebarProps {
  // ... existing props
  speakingUsers?: Map<number, boolean>;
}
```

**Step 2: Pass through to ChannelTree**

```typescript
<ChannelTree
  // ... other props
  speakingUsers={speakingUsers}
/>
```

---

### Task 4: Update Header to pass speaking to UserPanel

**Files:**
- Modify: `src/Brmble.Web/src/components/Header/Header.tsx`

**Step 1: Add speaking to HeaderProps**

```typescript
interface HeaderProps {
  // ... existing props
  speaking?: boolean;
}
```

**Step 2: Pass through to UserPanel**

```typescript
<UserPanel
  // ... other props
  speaking={speaking}
/>
```

---

### Task 5: Update ChannelTree to display speaking indicator

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx`
- Modify: `src/Brmble.Web/src/components/ChannelTree.css`

**Step 1: Update ChannelTreeProps interface**

```typescript
interface ChannelTreeProps {
  // ... existing props
  speakingUsers?: Map<number, boolean>;
}
```

**Step 2: Update user-row to use speakingUsers**

```typescript
<div 
  key={user.session} 
  className={`user-row ${user.self ? 'self' : ''} ${speakingUsers?.has(user.session) ? 'speaking' : ''}`}
>
```

**Step 3: Add CSS for speaking indicator**

```css
.user-row.speaking {
  background: rgba(80, 200, 120, 0.15);
  box-shadow: 0 0 12px var(--accent-mint-glow);
  animation: speaking-pulse 1.5s ease-in-out infinite;
}

@keyframes speaking-pulse {
  0%, 100% { 
    box-shadow: 0 0 8px var(--accent-mint-glow);
  }
  50% { 
    box-shadow: 0 0 16px var(--accent-mint-glow);
  }
}
```

---

### Task 6: Update UserPanel to display speaking indicator

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Update UserPanelProps interface**

```typescript
interface UserPanelProps {
  // ... existing props
  speaking?: boolean;
}
```

**Step 2: Update avatar element**

```typescript
<div className={`user-avatar ${speaking ? 'speaking' : ''}`} title={username || 'Not logged in'}>
```

**Step 3: Add CSS**

```css
.user-avatar.speaking {
  box-shadow: 0 0 12px var(--accent-mint-glow);
  animation: speaking-pulse 1.5s ease-in-out infinite;
}

@keyframes speaking-pulse {
  0%, 100% { 
    box-shadow: 0 0 8px var(--accent-mint-glow);
  }
  50% { 
    box-shadow: 0 0 16px var(--accent-mint-glow);
  }
}
```

---

### Task 7: Backend - Add local user speaking detection (AudioManager)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**IMPORTANT:** The original implementation only detected speaking for remote users (when receiving their voice packets). For the local user's speaking indicator to work, you must add local speaking detection.

**Step 1: Add local user tracking**

```csharp
// Speaking detection
private readonly Dictionary<uint, DateTime> _lastVoicePacket = new();
private readonly Timer _speakingTimer;
private const int SpeakingTimeoutMs = 200;
private uint _localUserId = 0;

public void SetLocalUserId(uint sessionId) => _localUserId = sessionId;
```

**Step 2: Add local speaking detection in OnMicData**

```csharp
private void OnMicData(object? sender, WaveInEventArgs e)
{
    if (_muted) return;
    if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
    if (_transmissionMode == TransmissionMode.VoiceActivity && !IsAboveThreshold(e.Buffer, e.BytesRecorded)) return;

    // Local speaking detection - track in _lastVoicePacket like remote users
    lock (_lock)
    {
        if (!_lastVoicePacket.ContainsKey(_localUserId))
        {
            UserStartedSpeaking?.Invoke(_localUserId);
        }
        _lastVoicePacket[_localUserId] = DateTime.UtcNow;
    }

    _encodePipeline?.SubmitPcm(new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded));
}
```

---

### Task 8: Backend - Wire up local user session ID (MumbleAdapter)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Set local user ID when initializing AudioManager**

In the method that creates AudioManager (around line 370):

```csharp
_audioManager = new AudioManager();
_audioManager.SendVoicePacket += packet =>
    Connection?.SendVoice(new ArraySegment<byte>(packet.ToArray()));
_audioManager.UserStartedSpeaking += userId =>
    _bridge?.Send("voice.userSpeaking", new { session = userId });
_audioManager.UserStoppedSpeaking += userId =>
    _bridge?.Send("voice.userSilent", new { session = userId });
if (LocalUser != null)
    _audioManager.SetLocalUserId(LocalUser.Id);
_audioManager.StartMic();
```

---

### Task 9: Verify implementation

**Step 1: Build the frontend**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors

**Step 2: Build the backend**

Run: `dotnet build src/Brmble.Client`

Expected: No C# errors

---

### Task 10: Commit changes

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/ChannelTree.tsx src/Brmble.Web/src/components/ChannelTree.css src/Brmble.Web/src/components/UserPanel/UserPanel.tsx src/Brmble.Web/src/components/UserPanel/UserPanel.css src/Brmble.Web/src/components/Header/Header.tsx src/Brmble.Web/src/components/Sidebar/Sidebar.tsx src/Brmble.Client/Services/Voice/AudioManager.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add speaking indicator with mint glow"
```
