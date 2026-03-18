# Matrix SDK Frontend Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Matrix chat so messages appear in channel panels, make Matrix the sole source of truth for channel chat, keep localStorage only for system messages and DMs.

**Architecture:** The existing `useMatrixClient` hook initializes a matrix-js-sdk client and listens for room timeline events. App.tsx already has conditional logic for Matrix vs Mumble message paths. The work is: (1) debug why messages aren't appearing, (2) add diagnostic logging, (3) clean up the message merge so system messages interleave with Matrix chat, (4) stop writing non-system channel messages to localStorage when Matrix is active.

**Tech Stack:** React 19, TypeScript, matrix-js-sdk 41.x, Vitest, @testing-library/react

**Test command:** `(cd src/Brmble.Web && npx vitest run)`

---

## Task 1: Add Diagnostic Logging to useMatrixClient

The Matrix client initializes but messages don't appear. Add console logging at every stage so we can see what's happening.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:25-68`

**Step 1: Add logging to the client initialization and timeline handler**

In `useMatrixClient.ts`, add `console.log` calls at key points in the `useEffect`:

```typescript
useEffect(() => {
    if (!credentials) {
      console.log('[Matrix] No credentials, stopping client');
      clientRef.current?.stopClient();
      clientRef.current = null;
      setMessages(new Map());
      return;
    }

    console.log('[Matrix] Creating client', {
      baseUrl: credentials.homeserverUrl,
      userId: credentials.userId,
      roomMapKeys: Object.keys(credentials.roomMap),
    });

    const client = createClient({
      baseUrl: credentials.homeserverUrl,
      accessToken: credentials.accessToken,
      userId: credentials.userId,
    });

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      console.log('[Matrix] Timeline event', {
        type: event.getType(),
        roomId: room?.roomId,
        sender: event.getSender(),
      });
      if (event.getType() !== EventType.RoomMessage) return;
      const channelId = roomIdToChannelId.get(room?.roomId ?? '');
      console.log('[Matrix] Room message', {
        roomId: room?.roomId,
        mappedChannelId: channelId,
        reverseMapEntries: Array.from(roomIdToChannelId.entries()),
      });
      if (!channelId) return;

      // ... rest unchanged
    };

    client.on(RoomEvent.Timeline, onTimeline);
    console.log('[Matrix] Starting client with initialSyncLimit: 20');
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;

    // ... cleanup unchanged
  }, [credentials, roomIdToChannelId]);
```

Also add logging in `onServerCredentials` in App.tsx:

In `App.tsx:300-306`, change to:
```typescript
const onServerCredentials = (data: unknown) => {
  console.log('[Matrix] Received server.credentials', data);
  const wrapped = data as { matrix?: MatrixCredentials } | undefined;
  const d = wrapped?.matrix;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    console.log('[Matrix] Setting credentials', { homeserverUrl: d.homeserverUrl, userId: d.userId, roomMapKeys: Object.keys(d.roomMap) });
    setMatrixCredentials(d);
  } else {
    console.warn('[Matrix] Credentials missing required fields', { hasHomeserver: !!d?.homeserverUrl, hasToken: !!d?.accessToken, hasUserId: !!d?.userId, hasRoomMap: !!d?.roomMap });
  }
};
```

**Step 2: Build and test manually**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no type errors.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/App.tsx
git commit -m "feat: add diagnostic logging to Matrix client pipeline"
```

---

## Task 2: Add Connection State and Error Handling to useMatrixClient

The hook has no visibility into whether the Matrix sync completed or errored. Add connection state so the UI can show what's happening, and add error handling so failures don't silently swallow.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Test: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

**Step 1: Write tests for connection state**

Add to `useMatrixClient.test.ts`:

```typescript
it('starts with connectionState "disconnected"', () => {
  const { result } = renderHook(() => useMatrixClient(null));
  expect(result.current.connectionState).toBe('disconnected');
});

it('sets connectionState to "connecting" then "connected" on sync', () => {
  const { result } = renderHook(() => useMatrixClient(creds));
  expect(result.current.connectionState).toBe('connecting');

  // Simulate sync complete
  const onCall = mockClient.on.mock.calls.find(
    (c: [string, Function]) => c[0] === 'sync'
  );
  expect(onCall).toBeDefined();
  act(() => onCall![1]('PREPARED', null, undefined));
  expect(result.current.connectionState).toBe('connected');
});

it('sets connectionState to "error" on sync error', () => {
  const { result } = renderHook(() => useMatrixClient(creds));

  const onCall = mockClient.on.mock.calls.find(
    (c: [string, Function]) => c[0] === 'sync'
  );
  act(() => onCall![1]('ERROR', null, { error: { message: 'fail' } }));
  expect(result.current.connectionState).toBe('error');
});
```

**Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: FAIL — `connectionState` not returned from hook.

**Step 3: Implement connection state tracking**

Update `useMatrixClient.ts` to add a `connectionState` and sync listener:

```typescript
export type MatrixConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useMatrixClient(credentials: MatrixCredentials | null) {
  const clientRef = useRef<MatrixClient | null>(null);
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [connectionState, setConnectionState] = useState<MatrixConnectionState>(
    credentials ? 'connecting' : 'disconnected'
  );

  // ... roomIdToChannelId unchanged ...

  useEffect(() => {
    if (!credentials) {
      console.log('[Matrix] No credentials, stopping client');
      clientRef.current?.stopClient();
      clientRef.current = null;
      setMessages(new Map());
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('connecting');
    console.log('[Matrix] Creating client', {
      baseUrl: credentials.homeserverUrl,
      userId: credentials.userId,
      roomMapKeys: Object.keys(credentials.roomMap),
    });

    const client = createClient({
      baseUrl: credentials.homeserverUrl,
      accessToken: credentials.accessToken,
      userId: credentials.userId,
    });

    const onSync = (state: string, _prev: string | null, data?: { error?: { message?: string } }) => {
      console.log('[Matrix] Sync state:', state);
      if (state === 'PREPARED' || state === 'SYNCING') {
        setConnectionState('connected');
      } else if (state === 'ERROR') {
        console.error('[Matrix] Sync error:', data?.error?.message);
        setConnectionState('error');
      }
    };

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      // ... existing timeline handler with logging from Task 1 ...
    };

    client.on('sync' as any, onSync);
    client.on(RoomEvent.Timeline, onTimeline);
    console.log('[Matrix] Starting client with initialSyncLimit: 20');
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;

    return () => {
      client.off('sync' as any, onSync);
      client.off(RoomEvent.Timeline, onTimeline);
      client.stopClient();
      clientRef.current = null;
    };
  }, [credentials, roomIdToChannelId]);

  // ... sendMessage, fetchHistory unchanged ...

  return { messages, sendMessage, fetchHistory, connectionState };
}
```

**Step 4: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: add connection state tracking and sync listener to Matrix client"
```

---

## Task 3: Fix Sender Display Names

Matrix SDK returns sender as `@userid:homeserver.com`, but the chat UI expects a human-readable username. Extract the display name from the Matrix event or fall back to the localpart (the part before `:`).

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts:39-51` (the `onTimeline` handler)
- Test: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

**Step 1: Write test for display name extraction**

Add to `useMatrixClient.test.ts`:

```typescript
it('uses display name from event when available', () => {
  const { result } = renderHook(() => useMatrixClient(creds));

  const onTimelineCall = mockClient.on.mock.calls.find(
    (c: [string, Function]) => c[0] === 'Room.timeline'
  );
  expect(onTimelineCall).toBeDefined();

  const mockEvent = {
    getType: () => 'm.room.message',
    getContent: () => ({ body: 'hello' }),
    getSender: () => '@alice:example.com',
    getId: () => '$evt1',
    getTs: () => 1700000000000,
    sender: { name: 'Alice' },
  };
  const mockRoom = { roomId: '!room:example.com' };

  act(() => onTimelineCall![1](mockEvent, mockRoom));

  const msgs = result.current.messages.get('42');
  expect(msgs).toHaveLength(1);
  expect(msgs![0].sender).toBe('Alice');
});

it('falls back to localpart when no display name', () => {
  const { result } = renderHook(() => useMatrixClient(creds));

  const onTimelineCall = mockClient.on.mock.calls.find(
    (c: [string, Function]) => c[0] === 'Room.timeline'
  );

  const mockEvent = {
    getType: () => 'm.room.message',
    getContent: () => ({ body: 'hi' }),
    getSender: () => '@bob:example.com',
    getId: () => '$evt2',
    getTs: () => 1700000000000,
    sender: null,
  };
  const mockRoom = { roomId: '!room:example.com' };

  act(() => onTimelineCall![1](mockEvent, mockRoom));

  const msgs = result.current.messages.get('42');
  expect(msgs).toBeDefined();
  const bobMsg = msgs!.find(m => m.content === 'hi');
  expect(bobMsg?.sender).toBe('bob');
});
```

**Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: FAIL — sender is `@alice:example.com` not `Alice`.

**Step 3: Implement display name extraction**

In the `onTimeline` handler in `useMatrixClient.ts`, replace the sender line:

```typescript
const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
  // ... type check, channelId lookup ...

  const content = event.getContent() as { body?: string };
  const rawSender = event.getSender() ?? 'Unknown';
  // Prefer display name from event.sender, fall back to Matrix ID localpart
  const displayName = (event as any).sender?.name
    || rawSender.replace(/^@/, '').replace(/:.*$/, '')
    || 'Unknown';

  const message: ChatMessage = {
    id: event.getId() ?? crypto.randomUUID(),
    channelId,
    sender: displayName,
    content: content.body ?? '',
    timestamp: new Date(event.getTs()),
  };

  // ... setMessages unchanged ...
};
```

**Step 4: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npx vitest run src/hooks/useMatrixClient.test.ts)`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: extract display names from Matrix events for chat messages"
```

---

## Task 4: Merge System Messages with Matrix Messages in Chat Panel

Currently App.tsx uses `matrixMessages ?? messages` — it's either/or. Change it to merge system messages from localStorage with Matrix messages, sorted by timestamp.

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:786-839`

**Step 1: Update the message merging logic**

In `App.tsx`, replace the current `matrixMessages` variable and ChatPanel prop (around lines 786-839):

```typescript
// Before the return statement, compute merged messages for the channel chat panel
const activeChannelId = currentChannelId && currentChannelId !== 'server-root'
  ? currentChannelId
  : undefined;
const matrixMessages = activeChannelId
  ? matrixClient.messages.get(activeChannelId)
  : undefined;

// Merge: if Matrix is active for this channel, combine Matrix messages with system-only localStorage messages
const channelChatMessages = (() => {
  if (!matrixMessages) return messages; // No Matrix data — use localStorage as-is (server-root or no mapping)
  const systemOnly = messages.filter(m => m.type === 'system');
  if (systemOnly.length === 0) return matrixMessages;
  return [...matrixMessages, ...systemOnly].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
})();
```

Then update the ChatPanel prop:

```tsx
<ChatPanel
  channelId={currentChannelId || undefined}
  channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
  messages={channelChatMessages}
  currentUsername={username}
  onSendMessage={handleSendMessage}
/>
```

**Step 2: Build to verify no type errors**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: merge system messages with Matrix messages in channel chat"
```

---

## Task 5: Stop Writing Non-System Channel Messages to localStorage When Matrix Active

The `voice.message` handler in App.tsx already skips writing when Matrix is active. But the system message path needs to write system messages to localStorage for channels too (so they appear interleaved). Ensure the `voice.system` handler writes system messages to the current channel's localStorage key (not just server-root).

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:367-377` (the `onVoiceSystem` handler)

**Step 1: Update onVoiceSystem to write to current channel**

The current handler only writes system messages to `server-root`. For system messages that relate to channel events (user joined channel, user left channel), we should also write them to the current channel's key:

```typescript
const onVoiceSystem = ((data: unknown) => {
  const d = data as { message: string; systemType?: string; html?: boolean; channelId?: number } | undefined;
  if (!d?.message) return;

  // Always write to server-root
  const currentKey = currentChannelIdRef.current;
  if (currentKey === 'server-root') {
    addMessageRef.current('Server', d.message, 'system', d.html);
  } else {
    addMessageToStore('server-root', 'Server', d.message, 'system', d.html);
  }

  // Also write to the specific channel if it's not server-root
  if (d.channelId !== undefined && d.channelId !== 0) {
    const channelKey = `channel-${d.channelId}`;
    if (currentKey === String(d.channelId)) {
      addMessageRef.current('Server', d.message, 'system', d.html);
    } else {
      addMessageToStore(channelKey, 'Server', d.message, 'system', d.html);
    }
  }
});
```

**Step 2: Build to verify**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: write system messages to channel-specific localStorage keys"
```

---

## Task 6: Remove Diagnostic Logging

After verifying Matrix chat works, remove the `console.log` statements added in Task 1. Keep the sync state listener from Task 2 (that's permanent). Only remove the verbose debug logs.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/App.tsx:300-306`

**Step 1: Remove console.log/console.warn from useMatrixClient.ts**

Remove all lines starting with `console.log('[Matrix]` from the useEffect. Keep `console.error` for actual error conditions.

**Step 2: Remove console.log from onServerCredentials in App.tsx**

Revert to the original shape without the logging:

```typescript
const onServerCredentials = (data: unknown) => {
  const wrapped = data as { matrix?: MatrixCredentials } | undefined;
  const d = wrapped?.matrix;
  if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
    setMatrixCredentials(d);
  }
};
```

**Step 3: Run all tests**

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests PASS.

**Step 4: Build**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/App.tsx
git commit -m "chore: remove diagnostic logging from Matrix client"
```

---

## Task 7: Final Verification

**Step 1: Run full test suite**

Run: `(cd src/Brmble.Web && npx vitest run)`
Expected: All tests PASS.

**Step 2: Build frontend**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: Build succeeds with no errors.

**Step 3: Run dotnet build**

Run: `dotnet build`
Expected: Build succeeds (frontend dist is copied to output).
