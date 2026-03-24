# Mumble DM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Brmble users to send/receive DMs with pure Mumble users via Mumble's native private message system.

**Architecture:** Frontend-only transport selection. If the target user has a `matrixUserId`, use Matrix DMs (existing). If not, use Mumble PMs via `voice.sendPrivateMessage` bridge. Mumble DM contacts and messages are ephemeral (in-memory only, cleared on disconnect). Mumble users are identified across reconnects by their certificate hash.

**Tech Stack:** React + TypeScript (frontend), C# + MumbleSharp (client bridge)

**Design doc:** `docs/plans/2026-03-23-mumble-dm-design.md`

---

### Task 1: Add certHash to voice.userJoined and voice.message bridge events

The frontend needs certificate hashes for all Mumble users, but `MumbleAdapter.cs` currently doesn't include them in bridge events. MumbleSharp already parses `User.CertificateHash` from the protocol.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2119-2131` (voice.userJoined)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:2256-2266` (voice.message / TextMessage override)

**Step 1: Add `certHash` to the `voice.userJoined` payload**

In `MumbleAdapter.cs` around line 2119, the `voice.userJoined` bridge message is sent. Add `certHash` from the MumbleSharp User object:

```csharp
_bridge?.Send("voice.userJoined", new
{
    session = userState.Session,
    name = joinedUserName,
    channelId = currentChannelId,
    muted = ...,
    deafened = ...,
    self = isSelf,
    comment = user?.Comment,
    matrixUserId = _sessionMappings.TryGetValue(userState.Session, out var sm)
        ? sm.MatrixUserId
        : _userMappings.GetValueOrDefault(joinedUserName),
    certHash = user?.CertificateHash,  // NEW
});
```

Find the exact location by looking at the existing `voice.userJoined` send call near line 2119. The `user` variable is the MumbleSharp `User` object — add `certHash = user?.CertificateHash` to the anonymous object.

**Step 2: Add `certHash` to the `voice.message` (TextMessage) payload**

In `MumbleAdapter.cs` around line 2256, the `TextMessage` override sends `voice.message`. Add the sender's cert hash:

```csharp
public override void TextMessage(TextMessage textMessage)
{
    base.TextMessage(textMessage);
    var senderUser = Users.FirstOrDefault(u => u.Id == textMessage.Actor);
    _bridge?.Send("voice.message", new
    {
        message = textMessage.Message,
        senderSession = textMessage.Actor,
        channelIds = textMessage.ChannelIds ?? Array.Empty<uint>(),
        sessions = textMessage.Sessions ?? Array.Empty<uint>(),
        certHash = senderUser?.CertificateHash,  // NEW
    });
}
```

Note: `Users` is the MumbleSharp user collection on the protocol. The `textMessage.Actor` is the sender's session ID. Look up the sender by session to get their cert hash. Verify the correct property/method to find a user by session ID in MumbleSharp (may be `Users.FirstOrDefault(u => u.Id == textMessage.Actor)` or similar — check MumbleSharp's API).

**Step 3: Commit**

```
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: include certHash in voice.userJoined and voice.message bridge events"
```

---

### Task 2: Add certHash to frontend User type and wire through App.tsx

The frontend `User` interface needs a `certHash` field, and the user-join handler needs to read it.

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:15-28` (User interface)
- Modify: `src/Brmble.Web/src/App.tsx:689` (onVoiceUserJoined handler)

**Step 1: Add `certHash` to the `User` interface**

In `src/Brmble.Web/src/types/index.ts`, add `certHash` to the `User` interface:

```typescript
export interface User {
  id?: string;
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  matrixUserId?: string;
  speaking?: boolean;
  comment?: string;
  prioritySpeaker?: boolean;
  avatarUrl?: string;
  certHash?: string;  // NEW: Mumble certificate hash, stable across reconnects
}
```

**Step 2: Update `onVoiceUserJoined` cast in App.tsx**

In `App.tsx` around line 689, the `onVoiceUserJoined` handler casts the data. Add `certHash` to the type assertion:

```typescript
const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean; comment?: string; matrixUserId?: string; certHash?: string } | undefined;
```

No other changes needed — the spread `{...d}` into the users array will carry `certHash` through automatically.

**Step 3: Commit**

```
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add certHash to User type and wire from bridge"
```

---

### Task 3: Extend useDMStore with Mumble contact support

This is the core task. Extend `useDMStore.ts` to manage Mumble DM contacts alongside Matrix contacts.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useDMStore.ts`

**Step 1: Extend DMContact interface**

Replace the existing `DMContact` interface (lines 8-16) with:

```typescript
export interface DMContact {
  /** Primary key: matrixUserId for Matrix contacts, mumbleCertHash for Mumble contacts */
  id: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;

  // Mumble DM fields (only set for ephemeral Mumble contacts)
  isEphemeral?: boolean;
  mumbleCertHash?: string;
  mumbleSessionId?: number | null;  // null = offline
}
```

**Step 2: Add Mumble contact state and options**

Add to `DMStoreOptions`:

```typescript
export interface DMStoreOptions {
  // ... existing fields ...
  sendMumbleDM?: (targetSession: number, text: string) => void;
}
```

Add to `DMStore`:

```typescript
export interface DMStore {
  // ... existing fields ...
  receiveMumbleDM: (certHash: string, sessionId: number, displayName: string, text: string) => void;
  updateMumbleSession: (certHash: string, sessionId: number | null, displayName?: string) => void;
  clearMumbleContacts: () => void;
  startMumbleDM: (certHash: string, sessionId: number, displayName: string) => void;
}
```

**Step 3: Add Mumble state inside the hook**

After the existing `pendingMessages` state (line 62), add:

```typescript
const [mumbleContacts, setMumbleContacts] = useState<Map<string, DMContact>>(new Map());
const [mumbleMessages, setMumbleMessages] = useState<Map<string, ChatMessage[]>>(new Map());
```

**Step 4: Extend the `contacts` memo to merge Mumble contacts**

Update the `contacts` useMemo (starting at line 91). After building the Matrix `result` array, merge Mumble contacts:

```typescript
const contacts: DMContact[] = useMemo(() => {
  // ... existing Matrix contact derivation (unchanged) ...

  // Merge Mumble contacts
  for (const [, mc] of mumbleContacts) {
    const msgs = mumbleMessages.get(mc.mumbleCertHash!);
    const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
    result.push({
      ...mc,
      lastMessage: lastMsg?.content,
      lastMessageTime: lastMsg?.timestamp.getTime(),
    });
  }

  result.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
  return result;
}, [matrixDmRoomMap, matrixDmMessages, matrixDmUserDisplayNames, users, mumbleContacts, mumbleMessages]);
```

**Step 5: Extend messages memo for Mumble contacts**

Update the `messages` useMemo (line 128). After getting Matrix messages, also check Mumble messages:

```typescript
const messages: ChatMessage[] = useMemo(() => {
  if (!selectedContactId) return [];
  // Check if this is a Mumble contact
  const mumbleMsgs = mumbleMessages.get(selectedContactId);
  if (mumbleMsgs) return mumbleMsgs;
  // Otherwise Matrix messages
  const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
  const pending = pendingMessages.get(selectedContactId) ?? [];
  return [...matrixMsgs, ...pending];
}, [selectedContactId, matrixDmMessages, pendingMessages, mumbleMessages]);
```

**Step 6: Extend sendMessage for Mumble contacts**

Update `sendMessage` (line 163). Before the Matrix send path, check if the selected contact is ephemeral:

```typescript
const sendMessage = useCallback((content: string) => {
  if (!selectedContactId) return;

  const contact = mumbleContacts.get(selectedContactId);
  if (contact?.isEphemeral) {
    // Mumble DM path
    if (contact.mumbleSessionId == null) return; // offline, can't send
    const msg: ChatMessage = {
      id: `mumble-${Date.now()}-${Math.random()}`,
      channelId: selectedContactId,
      sender: username,
      content,
      timestamp: new Date(),
    };
    setMumbleMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(selectedContactId!) ?? [];
      next.set(selectedContactId!, [...existing, msg]);
      return next;
    });
    options.sendMumbleDM?.(contact.mumbleSessionId, content);
    return;
  }

  // ... existing Matrix send path (unchanged) ...
}, [selectedContactId, username, sendMatrixDM, mumbleContacts, options.sendMumbleDM]);
```

Note: `options` needs to be accessible — destructure `sendMumbleDM` from `options` at the top alongside the other destructured fields.

**Step 7: Add Mumble-specific actions**

Add these callbacks after the existing actions:

```typescript
const receiveMumbleDM = useCallback((certHash: string, sessionId: number, displayName: string, text: string) => {
  // Ensure contact exists
  setMumbleContacts(prev => {
    const next = new Map(prev);
    if (!next.has(certHash)) {
      next.set(certHash, {
        id: certHash,
        displayName,
        unreadCount: 0,
        isEphemeral: true,
        mumbleCertHash: certHash,
        mumbleSessionId: sessionId,
      });
    }
    return next;
  });
  // Append message
  const msg: ChatMessage = {
    id: `mumble-${Date.now()}-${Math.random()}`,
    channelId: certHash,
    sender: displayName,
    content: text,
    timestamp: new Date(),
  };
  setMumbleMessages(prev => {
    const next = new Map(prev);
    const existing = next.get(certHash) ?? [];
    next.set(certHash, [...existing, msg]);
    return next;
  });
  // Increment unread if not currently viewing this contact
  if (selectedContactIdRef.current !== certHash || appModeRef.current !== 'dm') {
    setMumbleContacts(prev => {
      const next = new Map(prev);
      const contact = next.get(certHash);
      if (contact) {
        next.set(certHash, { ...contact, unreadCount: contact.unreadCount + 1 });
      }
      return next;
    });
  }
}, []);

const updateMumbleSession = useCallback((certHash: string, sessionId: number | null, displayName?: string) => {
  setMumbleContacts(prev => {
    const next = new Map(prev);
    const contact = next.get(certHash);
    if (contact) {
      next.set(certHash, { ...contact, mumbleSessionId: sessionId ?? undefined, displayName: displayName ?? contact.displayName });
    }
    return next;
  });
}, []);

const clearMumbleContacts = useCallback(() => {
  setMumbleContacts(new Map());
  setMumbleMessages(new Map());
}, []);

const startMumbleDM = useCallback((certHash: string, sessionId: number, displayName: string) => {
  setMumbleContacts(prev => {
    const next = new Map(prev);
    if (!next.has(certHash)) {
      next.set(certHash, {
        id: certHash,
        displayName,
        unreadCount: 0,
        isEphemeral: true,
        mumbleCertHash: certHash,
        mumbleSessionId: sessionId,
      });
    }
    return next;
  });
  setSelectedContactId(certHash);
  setAppMode('dm');
}, []);
```

**Step 8: Extend the disconnect reset**

In the `useEffect` that resets on disconnect (line 79), also clear Mumble state:

```typescript
useEffect(() => {
  if (users.length === 0) {
    setAppMode('channels');
    setSelectedContactId(null);
    setPendingMessages(new Map());
    setMumbleContacts(new Map());   // NEW
    setMumbleMessages(new Map());    // NEW
    appModeRef.current = 'channels';
    selectedContactIdRef.current = null;
  }
}, [users.length]);
```

**Step 9: Clear unread on select**

When selecting a Mumble contact, clear its unread count. Extend `selectContact`:

```typescript
const selectContact = useCallback((id: string) => {
  setSelectedContactId(id);
  setAppMode('dm');

  // Clear Mumble unread if applicable
  setMumbleContacts(prev => {
    const contact = prev.get(id);
    if (contact && contact.unreadCount > 0) {
      const next = new Map(prev);
      next.set(id, { ...contact, unreadCount: 0 });
      return next;
    }
    return prev;
  });

  if (fetchDMHistory) {
    fetchDMHistory(id).catch(console.warn);
  }
}, [fetchDMHistory]);
```

**Step 10: Update return object**

Add the new actions to the return:

```typescript
return {
  // ... existing ...
  receiveMumbleDM,
  updateMumbleSession,
  clearMumbleContacts,
  startMumbleDM,
};
```

**Step 11: Commit**

```
git add src/Brmble.Web/src/hooks/useDMStore.ts
git commit -m "feat: extend useDMStore with Mumble DM contact and message support"
```

---

### Task 4: Wire Mumble DM events in App.tsx

Connect the bridge events to `useDMStore`'s new Mumble actions.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Pass `sendMumbleDM` to useDMStore options**

Where `useDMStore` is instantiated (find the call site), add:

```typescript
const dmStore = useDMStore({
  // ... existing options ...
  sendMumbleDM: (targetSession: number, text: string) => {
    bridge.send('voice.sendPrivateMessage', { message: text, targetSession });
  },
});
```

**Step 2: Handle incoming private Mumble messages**

In `onVoiceMessage` (around line 635), replace the comment at line 673 (`// Private Mumble messages are ignored — DMs are Matrix-only`) with actual handling:

```typescript
// Private Mumble message → route to DM store
if (isPrivateMessage) {
  const d2 = data as { certHash?: string };
  const senderCertHash = d2?.certHash;
  if (senderCertHash) {
    dmStore.receiveMumbleDM(senderCertHash, d.senderSession!, senderName, d.message);
  }
  return;
}
```

Note: `dmStore` needs to be accessible from within `onVoiceMessage`. Since `onVoiceMessage` is defined inside the same component, it should have access via closure. However, beware of stale closures — you may need a ref for `dmStore` or use `dmStoreRef.current.receiveMumbleDM(...)`. Check how other dmStore calls are made in the bridge callbacks.

**Step 3: Extend `handleStartDMFromContextMenu`**

Replace the existing handler (lines 1315-1321):

```typescript
const handleStartDMFromContextMenu = useCallback((sessionIdStr: string, userName: string) => {
  const user = users.find(u => String(u.session) === sessionIdStr);
  if (user?.matrixUserId) {
    dmStore.startDM(user.matrixUserId, userName);
  } else if (user?.certHash) {
    dmStore.startMumbleDM(user.certHash, user.session, userName);
  }
  // Users with neither matrixUserId nor certHash can't receive DMs
}, [users, dmStore]);
```

**Step 4: Handle Mumble user disconnect/reconnect**

In `onVoiceUserLeft` (around line 753), after removing the user from the users list, update the Mumble DM contact's session:

```typescript
const onVoiceUserLeft = ((data: unknown) => {
  const d = data as { session: number; name?: string; channelId?: number; certHash?: string } | undefined;
  if (d?.session) {
    // ... existing speak announcement logic ...
    
    // Update Mumble DM contact session to null (offline)
    const leavingUser = usersRef.current.find(u => u.session === d.session);
    const certHash = d.certHash || leavingUser?.certHash;
    if (certHash) {
      dmStore.updateMumbleSession(certHash, null);
    }

    setUsers(prev => prev.filter(u => u.session !== d.session));
  }
});
```

For reconnection, `onVoiceUserJoined` already adds the user with their `certHash`. Add session reattachment:

```typescript
// In onVoiceUserJoined, after the setUsers call:
if (d.certHash && !d.self) {
  dmStore.updateMumbleSession(d.certHash, d.session, d.name);
}
```

**Step 5: Include Mumble DM unreads in totalDmUnreadCount**

The `totalDmUnreadCount` memo (line 329) currently only uses Matrix unreads. Extend it to include Mumble DM unreads:

```typescript
const totalDmUnreadCount = useMemo(() => {
  let total = unreadTracker.totalDmUnreadCount;
  // Add Mumble DM unreads
  for (const contact of dmStore.contacts) {
    if (contact.isEphemeral) {
      total += contact.unreadCount;
    }
  }
  return total;
}, [unreadTracker.totalDmUnreadCount, dmStore.contacts]);
```

**Step 6: Verify `voice.userLeft` includes certHash from bridge**

Check if `MumbleAdapter.cs` includes `certHash` in the `voice.userLeft` event. If not, this needs to be added in a sub-step (similar to Task 1). The `onVoiceUserLeft` handler can fall back to looking up the cert hash from `usersRef.current` before the user is removed.

**Step 7: Commit**

```
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: wire Mumble DM events to useDMStore in App.tsx"
```

---

### Task 5: Update DMContactList for ephemeral contacts

Add visual indicators for Mumble DM contacts and handle the offline state.

**Files:**
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx`
- Modify: `src/Brmble.Web/src/components/DMContactList/DMContactList.css`

**Step 1: Add ephemeral indicator to contact entries**

In `DMContactList.tsx`, inside the contact entry `<button>` (around line 66-96), add an "online only" tag for ephemeral contacts and an offline indicator:

After the contact name span (line 80-83), add:

```tsx
{contact.isEphemeral && (
  <span className="dm-contact-ephemeral-tag">mumble</span>
)}
```

Add an offline overlay or muted style when `contact.mumbleSessionId == null && contact.isEphemeral`:

```tsx
<button
  key={contact.id}
  className={`dm-contact-entry ${selectedUserId === contact.id ? 'active' : ''} ${contact.isEphemeral && contact.mumbleSessionId == null ? 'offline' : ''}`}
  // ...
>
```

**Step 2: Add CSS for ephemeral tag and offline state**

In `DMContactList.css`, add:

```css
.dm-contact-ephemeral-tag {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  background: var(--bg-deep);
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dm-contact-entry.offline {
  opacity: 0.5;
}

.dm-contact-entry.offline .dm-contact-name {
  color: var(--text-muted);
}
```

**Step 3: Update the Avatar component call for Mumble contacts**

The Avatar currently passes `matrixUserId: contact.id`. For Mumble contacts, `contact.id` is a cert hash, not a Matrix user ID. Update:

```tsx
<Avatar
  user={{
    name: contact.displayName,
    matrixUserId: contact.isEphemeral ? undefined : contact.id,
    avatarUrl: contact.avatarUrl
  }}
  size={28}
/>
```

**Step 4: Commit**

```
git add src/Brmble.Web/src/components/DMContactList/DMContactList.tsx src/Brmble.Web/src/components/DMContactList/DMContactList.css
git commit -m "feat: add ephemeral indicator and offline state to DMContactList"
```

---

### Task 6: Disable message input for offline Mumble contacts

When a Mumble DM contact is offline (disconnected), the chat panel should disable message input and show a note.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx` (pass contact info to ChatPanel)
- Possibly modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`

**Step 1: Determine how ChatPanel receives its disabled state**

Read `ChatPanel.tsx` to understand its props. The message input likely has a disabled or placeholder prop. Pass whether the selected contact is an offline Mumble user.

Wherever the DM chat input is rendered, add a conditional:

```tsx
const isContactOffline = dmStore.selectedContact?.isEphemeral && dmStore.selectedContact?.mumbleSessionId == null;
```

Pass this as a prop to the chat panel or input component. If the input area is directly in App.tsx, add the `disabled` attribute and a placeholder like "User is offline".

**Step 2: Commit**

```
git add -A
git commit -m "feat: disable message input for offline Mumble DM contacts"
```

---

### Task 7: Add certHash to voice.userLeft bridge event

The `voice.userLeft` event from `MumbleAdapter.cs` likely doesn't include `certHash`. Add it so the frontend can match disconnecting users to their DM contacts.

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (voice.userLeft emission)

**Step 1: Find the `voice.userLeft` emission**

Search for `voice.userLeft` in MumbleAdapter.cs. Add `certHash` to the payload, looking up the user's cert hash before they're removed from the Users collection.

```csharp
_bridge?.Send("voice.userLeft", new
{
    session = userState.Session,
    name = ...,
    channelId = ...,
    certHash = user?.CertificateHash,  // NEW
});
```

**Step 2: Update the type assertion in App.tsx `onVoiceUserLeft`**

Already handled in Task 4 step 4 (the cast includes `certHash`).

**Step 3: Commit**

```
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: include certHash in voice.userLeft bridge event"
```

---

### Task 8: Build verification and manual testing

**Step 1: Run the frontend build**

```bash
cd src/Brmble.Web && npx tsc -b && npx vite build
```

Expected: Clean build, no type errors.

**Step 2: Fix any build errors**

Address type errors, missing imports, or interface mismatches.

**Step 3: Commit any fixes**

```
git add -A
git commit -m "fix: resolve build errors from Mumble DM implementation"
```
