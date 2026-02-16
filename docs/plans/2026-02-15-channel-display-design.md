# Channel Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display Mumble channels in a collapsible tree hierarchy with users grouped under their channels, showing all status indicators, styled with Bramble cocktail-inspired colors.

**Architecture:** Backend sends channel/user events to frontend; frontend builds tree structure, tracks expanded states, groups users per channel, and provides sort toggle.

**Tech Stack:** React + TypeScript (frontend), C# MumbleSharp (backend), CSS custom properties

---

### Task 1: Add userLeft event to MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Find where user removal is handled in MumbleSharp**

Search: `UserRemove` in MumbleSharp to find the handler

**Step 2: Add userLeft event handler**

```csharp
/// <summary>
/// Called when a user is removed from the server.
/// </summary>
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

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add voice.userLeft event for user disconnect"
```

---

### Task 2: Add userMoved event for channel switches

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Modify UserState to detect channel changes**

Replace the existing UserState override with:

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

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: add channelChanged event for user channel switches"
```

---

### Task 3: Add voice.userLeft to VoiceService interface

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/VoiceService.cs`

**Step 1: Add event to interface**

Add after UserJoined:
```csharp
event Action<uint>? UserLeft;
```

**Step 2: Commit**

```bash
git add src/Brmble.Client/Services/Voice/VoiceService.cs
git commit -m "feat: add UserLeft event to VoiceService interface"
```

---

### Task 4: Create ChannelTree component for hierarchical display

**Files:**
- Create: `src/Brmble.Web/src/components/ChannelTree.tsx`

**Step 1: Create the component**

```typescript
import { useState } from 'react';
import './ChannelTree.css';

interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
}

interface Channel {
  id: number;
  name: string;
  parent?: number;
}

interface ChannelWithUsers extends Channel {
  users: User[];
  children: ChannelWithUsers[];
}

interface ChannelTreeProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  sortByName: boolean;
}

export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, sortByName }: ChannelTreeProps) {
  const [expandedChannels, setExpandedChannels] = useState<Set<number>>(new Set());

  const toggleExpand = (channelId: number) => {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const buildTree = (): ChannelWithUsers[] => {
    const channelMap = new Map<number, ChannelWithUsers>();
    const roots: ChannelWithUsers[] = [];

    // Initialize channels
    channels.forEach(ch => {
      channelMap.set(ch.id, { ...ch, users: [], children: [] });
    });

    // Assign users to channels
    users.forEach(user => {
      if (user.channelId && channelMap.has(user.channelId)) {
        channelMap.get(user.channelId)!.users.push(user);
      }
    });

    // Sort users within channels
    channelMap.forEach(ch => {
      ch.users = sortByName
        ? [...ch.users].sort((a, b) => a.name.localeCompare(b.name))
        : ch.users;
    });

    // Build tree
    channelMap.forEach(ch => {
      if (ch.parent && channelMap.has(ch.parent)) {
        channelMap.get(ch.parent)!.children.push(ch);
      } else {
        roots.push(ch);
      }
    });

    return roots;
  };

  const renderChannel = (channel: ChannelWithUsers, level: number = 0) => {
    const hasChildren = channel.children.length > 0 || channel.users.length > 0;
    const isExpanded = expandedChannels.has(channel.id);
    const isCurrentChannel = currentChannelId === channel.id;

    return (
      <div key={channel.id} className="channel-item" style={{ paddingLeft: `${level * 16}px` }}>
        <div 
          className={`channel-row ${isCurrentChannel ? 'current' : ''}`}
          onClick={() => hasChildren && toggleExpand(channel.id)}
          onDoubleClick={() => onJoinChannel(channel.id)}
        >
          {hasChildren && (
            <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
          )}
          {!hasChildren && <span className="expand-icon placeholder">▶</span>}
          <span className="channel-icon">📁</span>
          <span className="channel-name">{channel.name}</span>
          {channel.users.length > 0 && (
            <span className="user-count">({channel.users.length})</span>
          )}
        </div>
        
        {isExpanded && (
          <div className="channel-children">
            {channel.users.map(user => (
              <div 
                key={user.session} 
                className={`user-row ${user.self ? 'self' : ''}`}
                style={{ paddingLeft: `${(level + 1) * 16 + 24}px` }}
                title={getUserTooltip(user)}
              >
                <span className="user-status">
                  {user.deafened ? '🔇❌' : user.muted ? '🔇' : '🔊'}
                </span>
                <span className="user-name">{user.name}</span>
                {user.self && <span className="self-badge">(you)</span>}
              </div>
            ))}
            {channel.children.map(child => renderChannel(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const tree = buildTree();

  return (
    <div className="channel-tree">
      {tree.map(channel => renderChannel(channel))}
    </div>
  );
}

function getUserTooltip(user: User): string {
  const statuses: string[] = [];
  if (user.muted) statuses.push('Muted');
  if (user.deafened) statuses.push('Deafened');
  return statuses.length > 0 ? statuses.join(', ') : 'Online';
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelTree.tsx
git commit -m "feat: add ChannelTree component with collapsible hierarchy"
```

---

### Task 5: Create CSS for Bramble-styled channel tree

**Files:**
- Create: `src/Brmble.Web/src/components/ChannelTree.css`

**Step 1: Create CSS with Bramble color palette**

```css
:root {
  --bramble-deep-berry: #1a0a1f;
  --bramble-purple: #6b2d5c;
  --bramble-blackberry: #c11677;
  --bramble-lemon: #f4d03f;
  --bramble-ice: #e8e4e9;
  --bramble-subtle: #3d2a3d;
}

.channel-tree {
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: var(--bramble-ice);
}

.channel-item {
  user-select: none;
}

.channel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.channel-row:hover {
  background-color: var(--bramble-subtle);
}

.channel-row.current {
  background-color: var(--bramble-blackberry);
  border-left: 3px solid var(--bramble-lemon);
}

.expand-icon {
  font-size: 10px;
  width: 16px;
  text-align: center;
  transition: transform 150ms ease;
  color: var(--bramble-lemon);
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.expand-icon.placeholder {
  visibility: hidden;
}

.channel-icon {
  font-size: 14px;
}

.channel-name {
  font-weight: 500;
  flex: 1;
}

.user-count {
  font-size: 12px;
  opacity: 0.7;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 13px;
  border-radius: 4px;
  cursor: default;
}

.user-row:hover {
  background-color: rgba(107, 45, 92, 0.3);
}

.user-row.self {
  background-color: rgba(107, 45, 92, 0.5);
}

.user-status {
  font-size: 12px;
}

.user-name {
  flex: 1;
}

.self-badge {
  font-size: 11px;
  color: var(--bramble-lemon);
  margin-left: 4px;
}

.channel-children {
  animation: expand 200ms ease;
}

@keyframes expand {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/components/ChannelTree.css
git commit -m "feat: add Bramble-styled CSS for channel tree"
```

---

### Task 6: Update App.tsx to use ChannelTree with sort toggle

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Import and add state for sort**

Add import:
```typescript
import { ChannelTree } from './components/ChannelTree';
```

Add state:
```typescript
const [sortUsersByName, setSortUsersByName] = useState<boolean>(false);
const [currentChannelId, setCurrentChannelId] = useState<number | undefined>();
```

**Step 2: Add event handlers for new events**

Add in useEffect:
```typescript
const onVoiceChannelChanged = ((data: unknown) => {
  const d = data as { channelId: number } | undefined;
  if (d?.channelId) {
    setCurrentChannelId(d.channelId);
    setMessages(prev => [...prev, `Joined channel`]);
  }
});

bridge.on('voice.userLeft', ((data: unknown) => {
  const d = data as { session: number } | undefined;
  if (d?.session) {
    setUsers(prev => prev.filter(u => u.session !== d.session));
  }
}));

bridge.on('voice.channelChanged', onVoiceChannelChanged);
```

Add to cleanup in useEffect:
```typescript
bridge.off('voice.userLeft', onVoiceUserLeft);
bridge.off('voice.channelChanged', onVoiceChannelChanged);
```

Update onVoiceUserJoined to include muted/deafened:
```typescript
const onVoiceUserJoined = ((data: unknown) => {
  const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean } | undefined;
  if (d?.session && d?.name) {
    setUsers(prev => {
      const existing = prev.find(u => u.session === d.session);
      if (existing) {
        return prev.map(u => u.session === d.session ? { ...u, ...d } : u);
      }
      return [...prev, d];
    });
  }
});
```

**Step 3: Replace channel display with ChannelTree**

Replace the server-panel section:
```tsx
{connected && (
  <section className="server-panel">
    <div className="channels">
      <div className="panel-header">
        <h2>Channels</h2>
        <button 
          className="sort-toggle"
          onClick={() => setSortUsersByName(!sortUsersByName)}
          title={sortUsersByName ? 'Sort by join order' : 'Sort alphabetically'}
        >
          Sort: {sortUsersByName ? 'A-Z' : 'Join'}
        </button>
      </div>
      <div className="channel-list">
        {channels.length === 0 ? (
          <p className="empty">No channels</p>
        ) : (
          <ChannelTree
            channels={channels}
            users={users}
            currentChannelId={currentChannelId}
            onJoinChannel={handleJoinChannel}
            sortByName={sortUsersByName}
          />
        )}
      </div>
    </div>
  </section>
)}
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: integrate ChannelTree with sort toggle"
```

---

### Task 7: Add styles for sort button

**Files:**
- Modify: `src/Brmble.Web/src/App.css`

**Step 1: Add panel header and sort button styles**

```css
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.sort-toggle {
  background: var(--bramble-purple);
  border: 1px solid var(--bramble-subtle);
  color: var(--bramble-ice);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 150ms ease;
}

.sort-toggle:hover {
  background: var(--bramble-blackberry);
  border-color: var(--bramble-lemon);
}
```

**Step 2: Commit**

```bash
git add src/Brmble.Web/src/App.css
git commit -m "feat: add sort button styles"
```

---

### Task 8: Build and test

**Step 1: Build frontend**

```bash
cd src/Brmble.Web && npm run build
```

**Step 2: Build client**

```bash
dotnet build src/Brmble.Client
```

**Step 3: Run and test manually**

Run client and verify:
- Channel tree displays hierarchically
- Click to expand/collapse (200ms animation)
- Users appear under their channels
- Sort toggle switches between A-Z and join order
- Current channel highlighted with purple + yellow border
- Muted/deafened icons show correctly
- User disconnect removes from list
- Channel switch updates current channel

**Step 4: Commit**

```bash
git add .
git commit -m "feat: complete channel display with hierarchical tree"
```

---

### Task 9: Create PR

**Step 1: Push branch**

```bash
git push -u origin ChannelDisplay
```

**Step 2: Create PR**

```bash
gh pr create --title "feat: collapsible channel tree with Bramble styling" --body "$(cat <<'EOF'
## Summary
- Add collapsible hierarchical channel tree display
- Group users under their respective channels
- Add Bramble cocktail-inspired purple styling
- Add sort toggle (alphabetical vs join order)
- Add user status indicators (muted, deafened)
- Add current channel highlight
- Fix userLeft and channelChanged events
EOF
)"
```

---

## Plan complete

**Execution approach?**
1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks
2. **Parallel Session** - Open new session with executing-plans
