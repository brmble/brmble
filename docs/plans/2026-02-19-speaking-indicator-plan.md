# Speaking Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a mint green pulsing glow around users when they are speaking, displayed in both ChannelTree and UserPanel.

**Architecture:** Track speaking state per user session via bridge events. Pass speaking boolean to UI components. Use CSS animations for the glow effect.

**Tech Stack:** React, TypeScript, CSS

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

Find where `const [selfMuted, setSelfMuted]` is defined (around line 29-30), add after it:

```typescript
const [speakingUsers, setSpeakingUsers] = useState<Map<number, boolean>>(new Map());
```

**Step 2: Add voice.userSpeaking listener**

In the `useEffect` that sets up bridge listeners (around line 277-287), add:

```typescript
const onVoiceUserSpeaking = ((data: unknown) => {
  const d = data as { session: number; speaking: boolean } | undefined;
  if (d?.session !== undefined && d?.speaking !== undefined) {
    setSpeakingUsers(prev => {
      const next = new Map(prev);
      if (d.speaking) {
        next.set(d.session, true);
      } else {
        next.delete(d.session);
      }
      return next;
    });
  }
});
```

Add to the bridge.on list (around line 287):
```typescript
bridge.on('voice.userSpeaking', onVoiceUserSpeaking);
```

Add to the bridge.off cleanup (around line 301):
```typescript
bridge.off('voice.userSpeaking', onVoiceUserSpeaking);
```

**Step 3: Pass speaking state to components**

Find where ChannelTree is rendered (around line 384), add:
```typescript
speakingUsers={speakingUsers}
```

Find where UserPanel/Header is rendered (around line 426), add:
```typescript
speaking={speakingUsers.has(selfSession) || false}
```

Note: You'll need to find or create `selfSession` - the session ID of the current user. This may already be available in the user state.

---

### Task 3: Update ChannelTree to display speaking indicator

**Files:**
- Modify: `src/Brmble.Web/src/components/ChannelTree.tsx:1-242`
- Modify: `src/Brmble.Web/src/components/ChannelTree.css`

**Step 1: Update ChannelTreeProps interface**

```typescript
interface ChannelTreeProps {
  channels: Channel[];
  users: User[];
  currentChannelId?: number;
  onJoinChannel: (channelId: number) => void;
  onSelectChannel?: (channelId: number) => void;
  onStartDM?: (userId: string, userName: string) => void;
  speakingUsers?: Map<number, boolean>;
}
```

**Step 2: Update component signature and get speaking state**

```typescript
export function ChannelTree({ channels, users, currentChannelId, onJoinChannel, onSelectChannel, onStartDM, speakingUsers }: ChannelTreeProps) {
```

In the user-row rendering (around line 177-200), update to use speaking state:

```typescript
<div 
  key={user.session} 
  className={`user-row ${user.self ? 'self' : ''} ${speakingUsers?.has(user.session) ? 'speaking' : ''}`}
>
```

**Step 3: Add CSS for speaking indicator**

In `src/Brmble.Web/src/components/ChannelTree.css`, add at the end:

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

### Task 4: Update UserPanel to display speaking indicator

**Files:**
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.tsx`
- Modify: `src/Brmble.Web/src/components/UserPanel/UserPanel.css`

**Step 1: Update UserPanelProps interface**

```typescript
interface UserPanelProps {
  username?: string;
  onToggleDM: () => void;
  dmActive?: boolean;
  unreadDMCount?: number;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
  speaking?: boolean;
}
```

**Step 2: Update component to use speaking prop**

```typescript
export function UserPanel({ username, onToggleDM, dmActive, unreadDMCount, onOpenSettings, muted, deafened, onToggleMute, onToggleDeaf, speaking }: UserPanelProps) {
```

Update the avatar element (around line 88):

```typescript
<div className={`user-avatar ${speaking ? 'speaking' : ''}`} title={username || 'Not logged in'}>
```

**Step 3: Add CSS for speaking indicator**

In `src/Brmble.Web/src/components/UserPanel/UserPanel.css`, add:

```css
.user-avatar.speaking {
  box-shadow: 0 0 12px var(--accent-mint-glow);
  animation: speaking-pulse 1.5s ease-in-out infinite;
}
```

**Step 4: Update Header component to pass speaking prop**

Check `src/Brmble.Web/src/components/Header/Header.tsx` - it wraps UserPanel, so add the speaking prop through it:

```typescript
interface HeaderProps {
  username?: string;
  onToggleDM: () => void;
  dmActive?: boolean;
  unreadDMCount?: number;
  onOpenSettings: () => void;
  muted?: boolean;
  deafened?: boolean;
  onToggleMute?: () => void;
  onToggleDeaf?: () => void;
  speaking?: boolean;
}
```

Pass through to UserPanel:
```typescript
<UserPanel ... speaking={speaking} />
```

---

### Task 5: Verify implementation

**Step 1: Build the frontend**

Run: `cd src/Brmble.Web && npm run build`

Expected: No TypeScript errors

**Step 2: Start the dev server**

Run: `cd src/Brmble.Web && npm run dev`

Expected: Dev server starts, no console errors

---

### Task 6: Commit changes

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/ChannelTree.tsx src/Brmble.Web/src/components/ChannelTree.css src/Brmble.Web/src/components/UserPanel/UserPanel.tsx src/Brmble.Web/src/components/UserPanel/UserPanel.css src/Brmble.Web/src/components/Header/Header.tsx
git commit -m "feat: add speaking indicator with mint glow"
```
