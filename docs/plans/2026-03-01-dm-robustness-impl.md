# DM Robustness Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 15 code review issues and refactor DM state into a dedicated `useDMStore` hook for robust, maintainable direct messaging.

**Architecture:** Extract all DM state (contacts, messages, routing, unread tracking) from App.tsx into a new `useDMStore` hook. Fix XSS, race conditions, URL encoding, error handling, and localStorage growth. Brmble users always use Matrix for DMs; pure-Mumble users use Mumble TextMessage (ephemeral).

**Tech Stack:** React + TypeScript + Vitest, DOMPurify, matrix-js-sdk, C# (.NET)

**Design doc:** `docs/plans/2026-03-01-dm-robustness-design.md`

**Worktree:** `.worktrees/dm-robustness` (branch: `feature/dm-robustness`)

**Pre-existing test failure:** `useMatrixClient.test.ts` — mock is missing `ClientEvent` and `Preset` exports. Fix this in Task 4 alongside the room creation mutex.

**Baseline:** .NET tests 205/205 passing. Frontend tests 1/10 passing (9 pre-existing failures).

---

### Task 1: Add DOMPurify dependency and fix XSS in MessageBubble

**Files:**
- Modify: `src/Brmble.Web/package.json`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`

**Step 1: Install DOMPurify**

Run: `(cd src/Brmble.Web && npm install dompurify && npm install -D @types/dompurify)`

**Step 2: Add sanitization to MessageBubble**

In `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`, add import at top:

```typescript
import DOMPurify from 'dompurify';
```

Replace the HTML rendering block (line 35-39):

```typescript
// Before:
{html ? (
  <div className="message-text" dangerouslySetInnerHTML={{ __html: content }} />
) : (
  <p className="message-text">{content}</p>
)}

// After:
{html ? (
  <div className="message-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
) : (
  <p className="message-text">{content}</p>
)}
```

**Step 3: Verify build**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add src/Brmble.Web/package.json src/Brmble.Web/package-lock.json src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx
git commit -m "fix: sanitize HTML content with DOMPurify to prevent XSS"
```

---

### Task 2: Fix URL encoding in MatrixAppService.cs

**Files:**
- Modify: `src/Brmble.Server/Matrix/MatrixAppService.cs:41,66`
- Test: `tests/Brmble.Server.Tests/` (existing tests should still pass)

**Step 1: Fix SendMessage URL (line 41)**

```csharp
// Before:
var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}";

// After:
var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/send/m.room.message/{txnId}";
```

**Step 2: Fix SetRoomName URL (line 66)**

```csharp
// Before:
var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{roomId}/state/m.room.name";

// After:
var url = $"{_homeserverUrl}/_matrix/client/v3/rooms/{Uri.EscapeDataString(roomId)}/state/m.room.name";
```

**Step 3: Run server tests**

Run: `dotnet test tests/Brmble.Server.Tests/Brmble.Server.Tests.csproj`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/Brmble.Server/Matrix/MatrixAppService.cs
git commit -m "fix: URL-encode roomId in Matrix SendMessage and SetRoomName"
```

---

### Task 3: Add error handling to MumbleAdapter.SendPrivateMessage

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:394-406`

**Step 1: Add error feedback and try-catch**

Replace the `SendPrivateMessage` method (lines 394-406):

```csharp
// Before:
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

// After:
public void SendPrivateMessage(string message, uint targetSession)
{
    if (string.IsNullOrWhiteSpace(message))
        return;

    if (Connection is not { State: ConnectionStates.Connected })
    {
        _bridge?.Send("voice.error", new { message = "Cannot send message: not connected" });
        _bridge?.NotifyUiThread();
        return;
    }

    var textMessage = new TextMessage
    {
        Message = message,
        Sessions = new[] { targetSession },
    };

    try
    {
        Connection.SendControl(PacketType.TextMessage, textMessage);
    }
    catch (Exception ex)
    {
        Debug.WriteLine($"[MumbleAdapter] Failed to send private message: {ex.Message}");
        _bridge?.Send("voice.error", new { message = "Failed to send message" });
        _bridge?.NotifyUiThread();
    }
}
```

**Step 2: Build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "fix: add error handling and feedback to SendPrivateMessage"
```

---

### Task 4: Add room creation mutex to useMatrixClient

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:41,184-212`
- Test: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

**Step 1: Write test for concurrent room creation**

Add to `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`:

```typescript
it('does not create duplicate rooms for concurrent DM sends', async () => {
  const mockCreateRoom = vi.fn().mockResolvedValue({ room_id: '!dm:example.com' });
  const mockGetAccountData = vi.fn().mockReturnValue({ getContent: () => ({}) });
  const mockSetAccountData = vi.fn().mockResolvedValue(undefined);
  Object.assign(mockClient, {
    createRoom: mockCreateRoom,
    getAccountData: mockGetAccountData,
    setAccountData: mockSetAccountData,
  });

  const { result } = renderHook(() => useMatrixClient(creds));

  // Send two DMs concurrently to the same user
  await act(async () => {
    await Promise.all([
      result.current.sendDMMessage('@bob:example.com', 'hello'),
      result.current.sendDMMessage('@bob:example.com', 'world'),
    ]);
  });

  // Only one room should be created
  expect(mockCreateRoom).toHaveBeenCalledTimes(1);
  // Both messages should be sent
  expect(mockClient.sendMessage).toHaveBeenCalledTimes(2);
});
```

**Step 2: Run test to verify it fails**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: FAIL — `createRoom` called twice.

**Step 3: Add `pendingRoomCreations` ref and mutex logic**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, after the `dmRoomMapRef` declaration (around line 41), add:

```typescript
const pendingRoomCreations = useRef<Map<string, Promise<string>>>(new Map());
```

Replace the `sendDMMessage` function (lines 184-212):

```typescript
const sendDMMessage = useCallback(async (targetMatrixUserId: string, text: string) => {
    const client = clientRef.current;
    if (!client || !credentials) return;

    let roomId = dmRoomMapRef.current.get(targetMatrixUserId);

    if (!roomId) {
      // Check if room creation is already in progress for this user
      let pending = pendingRoomCreations.current.get(targetMatrixUserId);
      if (!pending) {
        pending = (async () => {
          const createResult = await client.createRoom({
            is_direct: true,
            invite: [targetMatrixUserId],
            preset: Preset.TrustedPrivateChat,
          });
          const newRoomId = createResult.room_id;

          // Update m.direct account data
          const directEvent = client.getAccountData(EventType.Direct);
          const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
          directContent[targetMatrixUserId] = [newRoomId, ...(directContent[targetMatrixUserId] ?? [])];
          await client.setAccountData(EventType.Direct, directContent);

          // Update local state
          setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, newRoomId));
          dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(targetMatrixUserId, newRoomId);
          roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(newRoomId, targetMatrixUserId);

          return newRoomId;
        })();
        pendingRoomCreations.current.set(targetMatrixUserId, pending);
      }

      try {
        roomId = await pending;
      } finally {
        pendingRoomCreations.current.delete(targetMatrixUserId);
      }
    }

    await client.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
  }, [credentials]);
```

**Step 4: Run test to verify it passes**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "fix: prevent duplicate DM room creation with mutex"
```

---

### Task 5: Add localStorage message cap and error handling to useChatStore

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Add message cap constant and safe write helper**

At the top of `useChatStore.ts` (after the `STORAGE_KEY_PREFIX` constant):

```typescript
const MAX_MESSAGES_PER_STORE = 500;

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // QuotaExceededError — evict oldest half and retry
    try {
      const parsed: unknown[] = JSON.parse(value);
      const trimmed = parsed.slice(Math.floor(parsed.length / 2));
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      // Give up silently — messages still in React state
    }
  }
}
```

**Step 2: Apply cap in `useChatStore` hook's `addMessage`**

In the `addMessage` callback (line 40-44), replace:

```typescript
// Before:
setMessages(prev => {
  const updated = [...prev, newMessage];
  saveMessages(updated);
  return updated;
});

// After:
setMessages(prev => {
  let updated = [...prev, newMessage];
  if (updated.length > MAX_MESSAGES_PER_STORE) {
    updated = updated.slice(updated.length - MAX_MESSAGES_PER_STORE);
  }
  saveMessages(updated);
  return updated;
});
```

**Step 3: Apply cap in `addMessageToStore` function**

In the `addMessageToStore` function (lines 80-81), replace:

```typescript
// Before:
messages.push(newMessage);
localStorage.setItem(fullKey, JSON.stringify(messages));

// After:
messages.push(newMessage);
if (messages.length > MAX_MESSAGES_PER_STORE) {
  messages = messages.slice(messages.length - MAX_MESSAGES_PER_STORE);
}
safeSetItem(fullKey, JSON.stringify(messages));
```

Also update `saveMessages` to use `safeSetItem`:

```typescript
// Before:
localStorage.setItem(`${STORAGE_KEY_PREFIX}${channelId}`, JSON.stringify(msgs));

// After:
safeSetItem(`${STORAGE_KEY_PREFIX}${channelId}`, JSON.stringify(msgs));
```

Note: change `let messages` instead of `const messages` in `addMessageToStore` since we now reassign it.

**Step 4: Build**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useChatStore.ts
git commit -m "fix: cap localStorage at 500 messages per conversation with QuotaExceededError handling"
```

---

### Task 6: Remove clearChatStorage from credential handler

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:354`

**Step 1: Remove the clearChatStorage call**

In `App.tsx`, in the `onServerCredentials` handler (lines 349-357), remove line 354:

```typescript
// Before:
const onServerCredentials = (data: unknown) => {
  const wrapped = data as { matrix?: MatrixCredentials } | undefined;
  const d = wrapped?.matrix;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    clearChatStorage();
    setMatrixCredentials(d);
  }
};

// After:
const onServerCredentials = (data: unknown) => {
  const wrapped = data as { matrix?: MatrixCredentials } | undefined;
  const d = wrapped?.matrix;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    setMatrixCredentials(d);
  }
};
```

Also check if `clearChatStorage` is still imported/used elsewhere. If this was the only call site, remove the import.

**Step 2: Build**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds (may warn about unused import — remove it).

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "fix: stop clearing chat storage on credential refresh"
```

---

### Task 7: Create useDMStore hook with tests

This is the core refactor. The hook owns all DM state.

**Files:**
- Create: `src/Brmble.Web/src/hooks/useDMStore.ts`
- Create: `src/Brmble.Web/src/hooks/useDMStore.test.ts`

**Step 1: Write failing tests for useDMStore**

Create `src/Brmble.Web/src/hooks/useDMStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDMStore } from './useDMStore';

// Mock bridge
const mockBridge = {
  send: vi.fn(),
};

// Mock Matrix functions
const mockSendMatrixDM = vi.fn().mockResolvedValue(undefined);
const mockFetchDMHistory = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

const defaultProps = {
  bridge: mockBridge as any,
  users: [],
  username: 'TestUser',
  sendMatrixDM: mockSendMatrixDM,
  fetchDMHistory: mockFetchDMHistory,
};

describe('useDMStore', () => {
  it('initializes with channels mode and no selection', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    expect(result.current.appMode).toBe('channels');
    expect(result.current.selectedDMUserId).toBeNull();
    expect(result.current.dmContacts).toEqual([]);
  });

  it('toggleDMMode switches between channels and dm', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.toggleDMMode());
    expect(result.current.appMode).toBe('dm');
    act(() => result.current.toggleDMMode());
    expect(result.current.appMode).toBe('channels');
  });

  it('selectDM sets selected user, switches to dm mode, creates contact', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.selectDM('5', 'Alice'));
    expect(result.current.selectedDMUserId).toBe('5');
    expect(result.current.selectedDMUserName).toBe('Alice');
    expect(result.current.appMode).toBe('dm');
    expect(result.current.dmContacts.some(c => c.userId === '5')).toBe(true);
  });

  it('selectDM clears unread for that contact', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    // Receive a DM first to create unread
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
    // Select that DM
    act(() => result.current.selectDM('5', 'Alice'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(0);
  });

  it('sendDM to Mumble-only user sends via bridge', () => {
    const users = [{ session: 5, name: 'MumbleUser', self: false }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'MumbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(mockBridge.send).toHaveBeenCalledWith('voice.sendPrivateMessage', {
      message: 'hello',
      targetSession: 5,
    });
    expect(mockSendMatrixDM).not.toHaveBeenCalled();
  });

  it('sendDM to Brmble user sends via Matrix only', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'BrmbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(mockSendMatrixDM).toHaveBeenCalledWith('@bob:matrix.org', 'hello');
    expect(mockBridge.send).not.toHaveBeenCalledWith('voice.sendPrivateMessage', expect.anything());
  });

  it('sendDM adds local echo for Mumble path', () => {
    const users = [{ session: 5, name: 'MumbleUser', self: false }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'MumbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(result.current.activeDMMessages.some(m => m.content === 'hello')).toBe(true);
  });

  it('sendDM adds local echo for Matrix path', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));
    act(() => result.current.selectDM('5', 'BrmbleUser'));
    act(() => result.current.sendDM('hello'));
    expect(result.current.activeDMMessages.some(m => m.content === 'hello')).toBe(true);
  });

  it('receiveDM increments unread when not viewing that DM', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
  });

  it('receiveDM does not increment unread when viewing that DM', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.selectDM('5', 'Alice'));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(0);
  });

  it('receiveMatrixDMUpdate only processes new messages', () => {
    const users = [{ session: 5, name: 'BrmbleUser', self: false, matrixUserId: '@bob:matrix.org' }];
    const { result } = renderHook(() => useDMStore({ ...defaultProps, users: users as any }));

    const msg1 = { id: 'evt1', channelId: 'dm', sender: 'BrmbleUser', content: 'hi', timestamp: new Date() };
    act(() => result.current.receiveMatrixDMUpdate('@bob:matrix.org', [msg1]));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);

    // Same messages again — should NOT increment unread
    act(() => result.current.receiveMatrixDMUpdate('@bob:matrix.org', [msg1]));
    expect(result.current.dmContacts.find(c => c.userId === '5')?.unread).toBe(1);
  });

  it('unreadDMUserCount counts contacts with unread > 0', () => {
    const { result } = renderHook(() => useDMStore(defaultProps));
    act(() => result.current.receiveDM(5, 'Alice', 'hello'));
    act(() => result.current.receiveDM(6, 'Bob', 'hi'));
    expect(result.current.unreadDMUserCount).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useDMStore.test.ts)`
Expected: FAIL — module not found.

**Step 3: Implement useDMStore**

Create `src/Brmble.Web/src/hooks/useDMStore.ts`:

```typescript
import { useState, useCallback, useRef, useMemo } from 'react';
import type { ChatMessage, User } from '../types';
import {
  loadDMContacts,
  upsertDMContact,
  markDMContactRead,
  addMessageToStore,
  type StoredDMContact,
} from './useChatStore';
import { useChatStore } from './useChatStore';

interface DMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: number;
}

interface Bridge {
  send: (event: string, data?: unknown) => void;
}

interface UseDMStoreProps {
  bridge: Bridge;
  users: User[];
  username: string;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | null;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | null;
}

function mapStoredContacts(contacts: StoredDMContact[]): DMContact[] {
  return contacts.map(c => ({
    userId: c.userId,
    userName: c.userName,
    lastMessage: c.lastMessage,
    lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
    unread: c.unread,
  }));
}

export function useDMStore({ bridge, users, username, sendMatrixDM, fetchDMHistory }: UseDMStoreProps) {
  const [dmContacts, setDmContacts] = useState<DMContact[]>(() => mapStoredContacts(loadDMContacts()));
  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedDMUserId, setSelectedDMUserId] = useState<string | null>(null);
  const [selectedDMUserName, setSelectedDMUserName] = useState<string>('');

  // Refs for bridge handler access (avoids stale closures)
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;
  const selectedDMUserIdRef = useRef(selectedDMUserId);
  selectedDMUserIdRef.current = selectedDMUserId;
  const usersRef = useRef(users);
  usersRef.current = users;

  // Track last-processed Matrix message ID per conversation to avoid re-incrementing unread
  const lastProcessedMsgIdRef = useRef<Map<string, string>>(new Map());

  // localStorage-backed messages for the active DM
  const dmKey = selectedDMUserId ? `dm-${selectedDMUserId}` : 'no-dm';
  const { messages: localDMMessages, addMessage: addLocalDMMessage } = useChatStore(dmKey);

  // For bridge handler refs
  const addLocalDMMessageRef = useRef(addLocalDMMessage);
  addLocalDMMessageRef.current = addLocalDMMessage;

  const toggleDMMode = useCallback(() => {
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  }, []);

  const selectDM = useCallback((userId: string, userName: string) => {
    setSelectedDMUserId(userId);
    setSelectedDMUserName(userName);
    setAppMode('dm');

    markDMContactRead(userId);
    const updated = upsertDMContact(userId, userName);
    setDmContacts(mapStoredContacts(updated));

    // Fetch Matrix DM history if available
    const targetUser = usersRef.current.find(u => String(u.session) === userId);
    if (targetUser?.matrixUserId && fetchDMHistory) {
      fetchDMHistory(targetUser.matrixUserId).catch(console.error);
    }
  }, [fetchDMHistory]);

  const sendDM = useCallback((content: string) => {
    if (!username || !content || !selectedDMUserIdRef.current) return;

    const targetUser = usersRef.current.find(u => String(u.session) === selectedDMUserIdRef.current);
    const targetMatrixId = targetUser?.matrixUserId;

    // Add local echo immediately
    addLocalDMMessageRef.current(username, content);

    if (targetMatrixId && sendMatrixDM) {
      // Brmble user — Matrix only, no Mumble fallback
      sendMatrixDM(targetMatrixId, content).catch(console.error);
    } else {
      // Pure Mumble user
      bridge.send('voice.sendPrivateMessage', {
        message: content,
        targetSession: Number(selectedDMUserIdRef.current),
      });
    }

    const updated = upsertDMContact(
      selectedDMUserIdRef.current,
      targetUser?.name || selectedDMUserName,
      content,
    );
    setDmContacts(mapStoredContacts(updated));
  }, [username, bridge, sendMatrixDM, selectedDMUserName]);

  const receiveDM = useCallback((senderSession: number, senderName: string, content: string) => {
    const senderKey = String(senderSession);
    const dmStoreKey = `dm-${senderKey}`;

    const isViewing = appModeRef.current === 'dm' && selectedDMUserIdRef.current === senderKey;

    if (isViewing) {
      addLocalDMMessageRef.current(senderName, content);
    } else {
      addMessageToStore(dmStoreKey, senderName, content);
    }

    const updated = upsertDMContact(senderKey, senderName, content, !isViewing);
    setDmContacts(mapStoredContacts(updated));
  }, []);

  const receiveMatrixDMUpdate = useCallback((matrixUserId: string, messages: ChatMessage[]) => {
    if (!messages || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    const lastProcessedId = lastProcessedMsgIdRef.current.get(matrixUserId);

    // Skip if we've already processed up to this message
    if (lastProcessedId === lastMsg.id) return;
    lastProcessedMsgIdRef.current.set(matrixUserId, lastMsg.id);

    const matchedUser = usersRef.current.find(u => u.matrixUserId === matrixUserId);
    if (!matchedUser) return;

    const sessionKey = String(matchedUser.session);
    const isViewing = appModeRef.current === 'dm' && selectedDMUserIdRef.current === sessionKey;

    const updated = upsertDMContact(sessionKey, matchedUser.name, lastMsg.content, !isViewing);
    setDmContacts(mapStoredContacts(updated));
  }, []);

  const unreadDMUserCount = useMemo(
    () => dmContacts.filter(c => c.unread > 0).length,
    [dmContacts],
  );

  // Determine active DM messages: Matrix messages passed from parent or local storage
  // (Matrix messages are managed by useMatrixClient, local messages by useChatStore)

  return {
    // State
    appMode,
    selectedDMUserId,
    selectedDMUserName,
    dmContacts,
    localDMMessages,
    unreadDMUserCount,

    // For computing activeDmMessages in App.tsx (needs matrixDmMessages from useMatrixClient)
    // App.tsx will compute: selectedUser?.matrixUserId ? matrixDmMessages.get(id) : localDMMessages

    // Actions
    toggleDMMode,
    selectDM,
    sendDM,
    receiveDM,
    receiveMatrixDMUpdate,
  };
}

export type { DMContact };
```

**Step 4: Run tests**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useDMStore.test.ts)`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useDMStore.ts src/Brmble.Web/src/hooks/useDMStore.test.ts
git commit -m "feat: add useDMStore hook with tests for centralized DM state"
```

---

### Task 8: Wire useDMStore into App.tsx

This task removes DM state from App.tsx and delegates to `useDMStore`.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

**Step 1: Add useDMStore import and instantiate**

Add import near top of App.tsx:

```typescript
import { useDMStore } from './hooks/useDMStore';
```

After the `matrixClient` destructuring (around line 151), instantiate:

```typescript
const dmStore = useDMStore({
  bridge,
  users,
  username,
  sendMatrixDM: sendMatrixDM ?? null,
  fetchDMHistory: fetchDMHistory ?? null,
});
```

**Step 2: Remove old DM state declarations**

Delete these lines (140-143):
- `const [dmContacts, setDmContacts] = ...`
- `const [appMode, setAppMode] = ...`
- `const [selectedDMUserId, setSelectedDMUserId] = ...`
- `const [selectedDMUserName, setSelectedDMUserName] = ...`

Delete lines 156-157:
- `const dmKey = ...`
- `const { messages: dmMessages, addMessage: addDMMessage } = useChatStore(dmKey);`

Delete `addDMMessageRef` declaration and update (around lines 183-184).

**Step 3: Remove old DM handlers and replace with dmStore**

Delete `handleSendDMMessage` (lines 860-881), `handleSelectDMUser` (lines 940-954), `toggleDMMode` (lines 934-936), `unreadDMUserCount` (line 938).

Delete the `availableUsers` dead code (lines 956-961).

Delete the `mapStoredContacts` helper (lines 105-112) — it's now inside `useDMStore`.

Delete the `matrixDmMessages` useEffect (lines 755-772).

**Step 4: Update onVoiceMessage DM handling**

In the `onVoiceMessage` handler (lines 365-416), replace the DM portion (lines 401-416):

```typescript
// Before (lines 401-416):
const senderSession = String(d.senderSession);
const dmStoreKey = `dm-${senderSession}`;
const isViewingThisDM = appModeRef.current === 'dm' &&
  selectedDMUserIdRef.current === senderSession;
if (isViewingThisDM) {
  addDMMessageRef.current(senderName, d.message);
} else {
  addMessageToStore(dmStoreKey, senderName, d.message);
}
const updated = upsertDMContact(senderSession, senderName, d.message, !isViewingThisDM);
setDmContacts(mapStoredContacts(updated));

// After:
// Skip Mumble DMs from Brmble users — Matrix will deliver these
if (senderUser?.matrixUserId) return;
dmStoreRef.current.receiveDM(d.senderSession, senderName, d.message);
```

Add a `dmStoreRef` for bridge handler access:

```typescript
const dmStoreRef = useRef(dmStore);
dmStoreRef.current = dmStore;
```

**Step 5: Update the Matrix DM messages effect**

Replace the deleted useEffect with one that calls `dmStore.receiveMatrixDMUpdate`:

```typescript
useEffect(() => {
  if (!matrixDmMessages || matrixDmMessages.size === 0) return;
  for (const [matrixUserId, msgs] of matrixDmMessages.entries()) {
    if (msgs.length === 0) continue;
    dmStore.receiveMatrixDMUpdate(matrixUserId, msgs);
  }
}, [matrixDmMessages, dmStore]);
```

**Step 6: Update JSX to use dmStore**

Replace all references:
- `appMode` → `dmStore.appMode`
- `selectedDMUserId` → `dmStore.selectedDMUserId`
- `selectedDMUserName` → `dmStore.selectedDMUserName`
- `dmContacts` → `dmStore.dmContacts`
- `handleSendDMMessage` → `dmStore.sendDM`
- `handleSelectDMUser` → `dmStore.selectDM`
- `toggleDMMode` → `dmStore.toggleDMMode`
- `unreadDMUserCount` → `dmStore.unreadDMUserCount`

Update `activeDmMessages` computation (around line 974):

```typescript
const selectedUser = dmStore.selectedDMUserId
  ? users.find(u => String(u.session) === dmStore.selectedDMUserId)
  : undefined;
const selectedMatrixId = selectedUser?.matrixUserId;
const activeDmMessages = selectedMatrixId
  ? (matrixDmMessages?.get(selectedMatrixId) ?? [])
  : dmStore.localDMMessages;
```

**Step 7: Remove now-unused imports**

Remove imports that are no longer needed in App.tsx:
- `upsertDMContact`, `markDMContactRead`, `loadDMContacts`, `mapStoredContacts` (if moved to useDMStore)
- `addMessageToStore` (if only used for DM — check channel usage first)

**Step 8: Also remove unused refs**

Remove `appModeRef`, `selectedDMUserIdRef`, `addDMMessageRef` that were only used for DM bridge handler access.

**Step 9: Build and verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no errors.

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests pass.

**Step 10: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "refactor: delegate DM state management to useDMStore hook"
```

---

### Task 9: Remove clearChatStorage import if unused and clean up

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`

**Step 1: Check if clearChatStorage is still used anywhere**

Search for `clearChatStorage` in App.tsx. If the only call was in `onServerCredentials` (removed in Task 6), remove the import.

If `clearChatStorage` is not used anywhere else in the codebase, consider keeping the function in `useChatStore.ts` but removing its export, or leaving it for potential future "logout" functionality.

**Step 2: Build and verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: No unused import warnings, build succeeds.

**Step 3: Run all tests**

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests pass.

Run: `dotnet test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: clean up unused imports and dead code"
```

---

### Task 10: Final verification

**Step 1: Full build**

Run: `(cd src/Brmble.Web && npm run build)`
Run: `dotnet build`
Expected: Both succeed.

**Step 2: All tests**

Run: `(cd src/Brmble.Web && npx vitest run)`
Run: `dotnet test`
Expected: All tests pass.

**Step 3: Verify no regressions in production mode**

Run: `dotnet run --project src/Brmble.Client`
Manually test: connect to server, send channel messages, open DM with a user, send DM, check unread badge.
