# User Idle Status Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show idle indicators (clock/moon/bed icons) in the channel list for users with no voice activity for 5/10/20+ minutes using Mumble's UserStats protocol.

**Architecture:** C# client requests UserStats periodically, tracks idle levels per user, emits voice.userIdle events. Frontend updates user state and renders icons.

**Tech Stack:** C# (MumbleSharp), TypeScript, React, WebView2 bridge

---

## Task 1: Add idleLevel to Frontend User Type

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:15-26`
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:8-17`

**Step 1: Add idleLevel field to User type**

```typescript
// src/Brmble.Web/src/types/index.ts - add to User interface
export interface User {
  // ... existing fields ...
  idleLevel?: 0 | 1 | 2 | 3;  // 0=active, 1=5min, 2=10min, 3=20min+
}
```

**Step 2: Add idleLevel to ChannelTree User interface**

```typescript
// src/Brmble.Web/src/components/ChannelTree.tsx - update local User interface
interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  prioritySpeaker?: boolean;
  comment?: string;
  idleLevel?: 0 | 1 | 2 | 3;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/components/ChannelTree.tsx
git commit -m "feat: add idleLevel field to User type"
```

---

## Task 2: Add voice.userIdle Event Handler in App.tsx

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add onVoiceUserIdle handler**

Add this handler near the other voice event handlers (around line 460):

```typescript
const onVoiceUserIdle = ((data: unknown) => {
  const d = data as { session: number; idleLevel: number };
  setUsers(prev => prev.map(u => 
    u.session === d.session 
      ? { ...u, idleLevel: d.idleLevel as 0 | 1 | 2 | 3 }
      : u
  );
}) as (data: unknown) => void;
```

**Step 2: Register the event listener**

Add in the `useEffect` where other voice listeners are registered (around line 572):

```typescript
bridge.on('voice.userIdle', onVoiceUserIdle);
```

**Step 3: Unregister on cleanup**

Add in the cleanup section (around line 604):

```typescript
bridge.off('voice.userIdle', onVoiceUserIdle);
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: handle voice.userIdle event in frontend"
```

---

## Task 3: Render Idle Icons in ChannelTree

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:202-220`
- Modify: `src/Brmble.Web/src/components/ChannelTree.css`

**Step 1: Add idle icons to user-status span**

In the user-row rendering (around line 202), add after the mic icon:

```tsx
{/* After the mic icon, before closing .user-status span */}
{user.idleLevel && user.idleLevel > 0 && (
  <>
    {user.idleLevel === 1 && (
      <svg className="status-icon status-icon--idle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="Idle 5-10 min">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    )}
    {user.idleLevel === 2 && (
      <svg className="status-icon status-icon--idle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="Idle 10-20 min">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    )}
    {user.idleLevel === 3 && (
      <svg className="status-icon status-icon--idle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" title="Idle 20+ min">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2.5"/>
      </svg>
    )}
  </>
)}
```

**Step 2: Add CSS for idle icon**

Add to ChannelTree.css (or create if needed):

```css
.status-icon--idle {
  color: var(--text-muted, #888);
  margin-left: 2px;
}
```

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelTree.tsx src/Brmble.Web/src/components/ChannelTree.css
git commit -m "feat: render idle icons in channel tree"
```

---

## Task 4: Override UserStats in MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add UserStats override method**

Add after the UserState method (around line 1240):

```csharp
public override void UserStats(UserStats userStats)
{
    base.UserStats(userStats);

    var session = userStats.Session;
    var idlesecs = userStats.Idlesecs;
    var newIdleLevel = CalculateIdleLevel(idlesecs);

    if (_userIdleLevels.TryGetValue(session, out var previousLevel))
    {
        if (previousLevel != newIdleLevel)
        {
            _userIdleLevels[session] = newIdleLevel;
            _bridge?.Send("voice.userIdle", new { session, idleLevel = newIdleLevel });
        }
    }
    else
    {
        _userIdleLevels[session] = newIdleLevel;
        if (newIdleLevel > 0)
        {
            _bridge?.Send("voice.userIdle", new { session, idleLevel = newIdleLevel });
        }
    }
}

private int CalculateIdleLevel(uint idlesecs)
{
    if (idlesecs >= 1200) return 3; // 20+ min
    if (idlesecs >= 600) return 2;   // 10-20 min
    if (idlesecs >= 300) return 1;   // 5-10 min
    return 0;                        // < 5 min
}

private readonly Dictionary<uint, int> _userIdleLevels = new();
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: handle UserStats to track idle levels"
```

---

## Task 5: Add Periodic UserStats Request Timer

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add timer field and methods**

Add near the top of the class with other fields:

```csharp
private System.Threading.Timer? _userStatsTimer;
```

Add methods to start/stop timer:

```csharp
private void StartUserStatsTimer()
{
    _userStatsTimer = new System.Threading.Timer(
        RequestAllUserStats,
        null,
        TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(10)
    );
}

private void StopUserStatsTimer()
{
    _userStatsTimer?.Dispose();
    _userStatsTimer = null;
}

private void RequestAllUserStats(object? state)
{
    if (Connection == null || !ReceivedServerSync) return;

    foreach (var user in Users)
    {
        if (user.Id == LocalUser?.Id) continue; // Don't request for self
        
        Connection.SendRequestUserStats(new UserStats { Session = user.Id, StatsOnly = true });
    }
}
```

**Step 2: Call StartUserStatsTimer after connected**

Find where voice.connected is sent (around line 1149) and add after:

```csharp
StartUserStatsTimer();
```

**Step 3: Call StopUserStatsTimer on disconnect**

Find OnDisconnect or where cleanup happens, add:

```csharp
StopUserStatsTimer();
_userIdleLevels.Clear();
```

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add periodic UserStats request timer"
```

---

## Task 6: Test and Verify

**Step 1: Build the solution**

```bash
dotnet build
```

**Step 2: Build the frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 3: Run the app and verify**

Manual testing:
1. Connect to a Mumble server with two clients
2. Wait 5 minutes - verify clock icon appears
3. Wait another 5 minutes - verify moon icon appears
4. Wait another 10 minutes - verify bed icon appears
5. Speak - verify icon disappears

**Step 4: Commit any final changes**

```bash
git add .
git commit -m "test: verify idle status display works"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add idleLevel to User type (frontend) |
| 2 | Add voice.userIdle event handler |
| 3 | Render idle icons in ChannelTree |
| 4 | Override UserStats in MumbleAdapter |
| 5 | Add periodic UserStats request timer |
| 6 | Test and verify |
