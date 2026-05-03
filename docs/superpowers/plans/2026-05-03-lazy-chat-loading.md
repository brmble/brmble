# Lazy chat loading — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the unbounded `messages: Map<string, ChatMessage[]>` in `useMatrixClient`, fix two related growth paths in `useChatStore`/`useDMStore`, and lower `initialSyncLimit` from 20 to 5 — so the WebView2 frontend stops leaking memory at idle and cold-starts faster.

**Architecture:** React-state holds only the active chat. matrix-js-sdk's `room.getLiveTimeline()` is the source of truth; we transform events to `ChatMessage` lazily (on channel-open) instead of eagerly (on every sync event). A small `lastMessages` map of one preview entry per room replaces full message arrays for sidebar rendering.

**Tech Stack:** React + TypeScript + Vite, matrix-js-sdk, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-03-lazy-chat-loading-design.md`

**Branch:** `feature/lazy-chat-loading` (already created, spec already committed).

---

## File map

| File | Change kind | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/hooks/useChatStore.ts` | Modify | Add cap for non-server-root channels (mirror existing server-root cap). |
| `src/Brmble.Web/src/hooks/useChatStore.test.ts` | Modify | Add tests covering non-server-root cap. |
| `src/Brmble.Web/src/hooks/useDMStore.ts` | Modify | Cap mumbleMessages per contact; remove pending Matrix DM on send failure; consume new `activeDmMessages` and `matrixDmLastMessages` from `useMatrixClient`. |
| `src/Brmble.Web/src/hooks/useDMStore.test.ts` | Create | Cover the new caps and the failure-path cleanup. |
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Modify (major) | Replace `messages` and `dmMessages` Maps with active-only state + `lastMessages` previews; extract pure event-to-ChatMessage transformer; lower initialSyncLimit. |
| `src/Brmble.Web/src/hooks/useMatrixClient.test.ts` | Modify | Update existing tests to new API; add tests for `setActiveChannel`, `lastMessages`, version-guard race. |
| `src/Brmble.Web/src/App.tsx` | Modify | Wire `setActiveChannel`/`setActiveDmContact` based on UI active selection; pass new props to `useDMStore`. |

---

## Task 1: Cap non-server-root channels in useChatStore

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`
- Modify: `src/Brmble.Web/src/hooks/useChatStore.test.ts`

- [ ] **Step 1: Replace existing "does NOT cap" test with a "DOES cap" test**

In `src/Brmble.Web/src/hooks/useChatStore.test.ts`, find the test at line 58-68 (`'does NOT cap non-server-root channels'`) and replace its body to assert the cap IS applied:

```ts
  it('caps non-server-root channels at 200 messages via addMessage', () => {
    const { result } = renderHook(() => useChatStore('channel-5'));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.addMessage('User', `msg-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].content).toBe('msg-10');
    expect(result.current.messages[199].content).toBe('msg-209');
  });
```

- [ ] **Step 2: Add a parallel test for the addMessageToStore path**

After the test from Step 1, add:

```ts
  it('caps non-server-root channels at 200 messages via addMessageToStore', () => {
    const existing = Array.from({ length: 195 }, (_, i) => ({
      id: `id-${i}`,
      channelId: 'channel-5',
      sender: 'User',
      content: `old-${i}`,
      timestamp: new Date().toISOString(),
    }));
    localStorage.setItem('brmble_chat_channel-5', JSON.stringify(existing));

    for (let i = 0; i < 10; i++) {
      addMessageToStore('channel-5', 'User', `new-${i}`);
    }

    const stored = JSON.parse(localStorage.getItem('brmble_chat_channel-5')!);
    expect(stored).toHaveLength(200);
    expect(stored[0].content).toBe('old-5');
    expect(stored[199].content).toBe('new-9');
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npm test -- useChatStore --run)`
Expected: both new tests FAIL — first fails with `expected length 200, got 210`; second fails with `expected length 200, got 205`.

- [ ] **Step 4: Implement the cap in useChatStore.ts**

In `src/Brmble.Web/src/hooks/useChatStore.ts`:

a) After line 6 (`const SERVER_ROOT_MAX_MESSAGES = 200;`), add:

```ts
const NON_SERVER_ROOT_MAX_MESSAGES = 200;
```

b) In `addMessage` (around line 202-209), change the slice condition from server-root-only to all channels:

```ts
    setMessages(prev => {
      let updated = [...prev, newMessage];
      const cap = isServerRoot ? SERVER_ROOT_MAX_MESSAGES : NON_SERVER_ROOT_MAX_MESSAGES;
      if (updated.length > cap) {
        updated = updated.slice(updated.length - cap);
      }
      saveMessages(updated);
      return updated;
    });
```

c) In `addMessageToStore` (around line 257-269, the non-server-root path), apply the same slice after the push:

```ts
  // Non-server-root: immediate write
  const fullKey = `${STORAGE_KEY_PREFIX}${storeKey}`;
  let messages: ChatMessage[] = [];
  const stored = localStorage.getItem(fullKey);
  if (stored) {
    try {
      messages = JSON.parse(stored);
    } catch {
      messages = [];
    }
  }
  messages.push(newMessage);
  if (messages.length > NON_SERVER_ROOT_MAX_MESSAGES) {
    messages = messages.slice(messages.length - NON_SERVER_ROOT_MAX_MESSAGES);
  }
  localStorage.setItem(fullKey, JSON.stringify(messages));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- useChatStore --run)`
Expected: all useChatStore tests pass (including the existing server-root cap tests).

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useChatStore.ts src/Brmble.Web/src/hooks/useChatStore.test.ts
git commit -m "$(cat <<'EOF'
fix(chat): cap non-server-root chat history at 200 messages

Previously only server-root chat had a 200-message cap. Per-channel
chat (non-server-root) and the addMessageToStore background path
appended without bound, growing localStorage and the JS heap on
every channel reload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cap mumbleMessages and fix pendingMessages cleanup in useDMStore

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useDMStore.ts`
- Create: `src/Brmble.Web/src/hooks/useDMStore.test.ts`

- [ ] **Step 1: Create the test file with vitest setup**

Create `src/Brmble.Web/src/hooks/useDMStore.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDMStore } from './useDMStore';
import type { DMStoreOptions } from './useDMStore';

function makeOptions(overrides: Partial<DMStoreOptions> = {}): DMStoreOptions {
  return {
    matrixDmMessages: new Map(),
    matrixDmRoomMap: new Map(),
    matrixDmUserDisplayNames: new Map(),
    matrixDmUserAvatarUrls: new Map(),
    sendMatrixDM: vi.fn().mockResolvedValue(undefined),
    fetchDMHistory: vi.fn().mockResolvedValue(undefined),
    sendMumbleDM: vi.fn(),
    users: [{ id: 1, name: 'me', session: 1 }] as DMStoreOptions['users'],
    username: 'me',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDMStore mumbleMessages cap', () => {
  it('caps mumbleMessages per contact at 200 on receiveMumbleDM', () => {
    const { result } = renderHook(() => useDMStore(makeOptions()));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.receiveMumbleDM('cert-1', 1, 'Alice', `msg-${i}`);
      }
    });

    // Select contact so messages are exposed via .messages
    act(() => result.current.selectContact('cert-1'));

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].content).toBe('msg-10');
    expect(result.current.messages[199].content).toBe('msg-209');
  });

  it('caps mumbleMessages on outgoing Mumble sendMessage', () => {
    const { result } = renderHook(() => useDMStore(makeOptions()));

    act(() => {
      result.current.startMumbleDM('cert-1', 1, 'Alice');
    });

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.sendMessage(`out-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(200);
    expect(result.current.messages[0].content).toBe('out-10');
  });
});

describe('useDMStore pendingMessages on Matrix send failure', () => {
  it('removes the optimistic pending message when sendMatrixDM rejects', async () => {
    const sendMatrixDM = vi.fn().mockRejectedValue(new Error('network down'));
    const matrixDmRoomMap = new Map([['@bob:example.com', '!bob:example.com']]);
    const { result } = renderHook(() =>
      useDMStore(makeOptions({ sendMatrixDM, matrixDmRoomMap }))
    );

    act(() => result.current.selectContact('@bob:example.com'));

    await act(async () => {
      result.current.sendMessage('hello');
      // Allow the rejected promise to settle
      await Promise.resolve();
      await Promise.resolve();
    });

    // No pending optimistic message should remain
    const pending = result.current.messages.filter(m => m.pending);
    expect(pending).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npm test -- useDMStore --run)`
Expected: cap tests FAIL (length 210, expected 200); pending-cleanup test FAIL (1 pending, expected 0).

- [ ] **Step 3: Implement the cap in useDMStore.ts**

In `src/Brmble.Web/src/hooks/useDMStore.ts`:

a) After the type declarations (around line 51, before the hook), add:

```ts
const MUMBLE_MESSAGES_MAX_PER_CONTACT = 200;
```

b) In `receiveMumbleDM` (around line 333-338), apply slice-from-end:

```ts
    setMumbleMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(certHash) ?? [];
      let updated = [...existing, msg];
      if (updated.length > MUMBLE_MESSAGES_MAX_PER_CONTACT) {
        updated = updated.slice(updated.length - MUMBLE_MESSAGES_MAX_PER_CONTACT);
      }
      next.set(certHash, updated);
      return next;
    });
```

c) In `sendMessage`, the Mumble path (around line 246-251), apply the same slice:

```ts
      setMumbleMessages(prev => {
        const next = new Map(prev);
        const existing = next.get(selectedContactId!) ?? [];
        let updated = [...existing, msg];
        if (updated.length > MUMBLE_MESSAGES_MAX_PER_CONTACT) {
          updated = updated.slice(updated.length - MUMBLE_MESSAGES_MAX_PER_CONTACT);
        }
        next.set(selectedContactId!, updated);
        return next;
      });
```

- [ ] **Step 4: Implement the pendingMessages cleanup-on-failure**

In `src/Brmble.Web/src/hooks/useDMStore.ts`, the `.catch(console.error)` around line 283 needs to also remove the optimistic message. Replace:

```ts
        .catch(console.error);
```

with:

```ts
        .catch(err => {
          console.error('Matrix DM send failed:', err);
          setPendingMessages(prev => {
            const next = new Map(prev);
            const existing = next.get(selectedContactId!) ?? [];
            next.set(selectedContactId!, existing.filter(m => m.id !== optimisticMsg.id));
            return next;
          });
        });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- useDMStore --run)`
Expected: all 3 useDMStore tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useDMStore.ts src/Brmble.Web/src/hooks/useDMStore.test.ts
git commit -m "$(cat <<'EOF'
fix(dm): cap mumbleMessages per contact and clean up failed Matrix DMs

- Cap mumbleMessages.get(contactId) at 200 messages (slice oldest).
- Remove the optimistic pending message when sendMatrixDM rejects;
  previously failures only logged to console, leaving the optimistic
  message stuck forever and growing pendingMessages over time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extract pure MatrixEvent → ChatMessage transformer in useMatrixClient

This is a refactor with no behavior change. It pulls the duplicated channel-message and DM-message transformation logic into a single pure function so subsequent tasks can call it from multiple sites without redundant code. After this task, `useMatrixClient.ts` should be smaller and the existing test suite should still pass unchanged.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`

- [ ] **Step 1: Add a pure transformer function near the top of the file**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, after the `insertMessage` function (line 25) and before the `MatrixCredentials` interface, add:

```ts
/**
 * Transform a Matrix `m.room.message` event into a ChatMessage.
 * Pure: only depends on its arguments. No SDK calls beyond what's
 * passed in via `client` (used for mxc → http URL resolution).
 *
 * Returns null for non-message events.
 */
function transformEventToChatMessage(
  event: MatrixEvent,
  room: Room | undefined,
  channelId: string,
  client: MatrixClient | null,
): ChatMessage | null {
  if (event.getType() !== EventType.RoomMessage) return null;

  const senderId = event.getSender() ?? 'Unknown';
  const senderMember = room?.getMember(senderId);
  const displayName = senderMember?.rawDisplayName || senderMember?.name || senderId;

  const content = event.getContent() as {
    body?: string;
    msgtype?: string;
    url?: string;
    info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
    'm.relates_to'?: { 'm.in_reply_to'?: { event_id: string } };
  };

  let media: MediaAttachment[] | undefined;
  if (content.msgtype === 'm.image' && content.url) {
    const fullUrl = client?.mxcUrlToHttp(content.url) ?? content.url;
    media = [{
      type: content.info?.mimetype?.toLowerCase() === 'image/gif' ? 'gif' : 'image',
      url: fullUrl,
      width: content.info?.w,
      height: content.info?.h,
      mimetype: content.info?.mimetype,
      size: content.info?.size,
    }];
  }

  const rawBody = content.body ?? '';
  const isBridgeBotSender = /^@brmble[_-]?/.test(senderId);
  const bridgeMatch = isBridgeBotSender ? rawBody.match(/^\[(.+?)\]:\s*/) : null;
  const messageSender = bridgeMatch ? bridgeMatch[1] : displayName;
  let messageContent = bridgeMatch ? rawBody.slice(bridgeMatch[0].length) : rawBody;

  // Strip reply fallback from body (lines starting with > )
  messageContent = messageContent.split('\n').filter(line => !/^> ?/.test(line)).join('\n').trim();

  // For image-only messages, body is just the filename — don't show it as text
  const displayContent = media ? '' : messageContent;

  const relatesTo = content['m.relates_to'] as { 'm.in_reply_to'?: { event_id: string } } | undefined;
  const replyToEventId = relatesTo?.['m.in_reply_to']?.event_id;

  return {
    id: event.getId() ?? crypto.randomUUID(),
    channelId,
    sender: messageSender,
    senderMatrixUserId: senderId,
    content: displayContent,
    timestamp: new Date(event.getTs()),
    ...(media && { media }),
    ...(replyToEventId && { replyToEventId }),
  };
}
```

- [ ] **Step 2: Replace the channel transformation block in onTimeline**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, the `onTimeline` function — replace the entire block from line 87 through to the `setMessages(prev => …)` block (around line 152), keeping the DM handling that follows:

```ts
    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      if (event.getType() !== EventType.RoomMessage) return;
      const channelId = roomIdToChannelId.get(room?.roomId ?? '');
      if (channelId) {
        const message = transformEventToChatMessage(event, room, channelId, clientRef.current);
        if (!message) return;

        setMessages(prev => {
          const existing = prev.get(channelId) ?? [];
          const updated = insertMessage(existing, message);
          if (updated === existing) return prev;
          return new Map(prev).set(channelId, updated);
        });
        return;
      }

      // DM message handling
      const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
      if (!dmUserId) {
        if (!isPrepared && room?.roomId) {
          bufferedDmEvents.push({ room, event });
        }
        return;
      }

      const dmMessage = transformEventToChatMessage(event, room, dmUserId, clientRef.current);
      if (!dmMessage) return;

      setDmMessages(prev => {
        const existing = prev.get(dmUserId) ?? [];
        const updated = insertMessage(existing, dmMessage);
        if (updated === existing) return prev;
        return new Map(prev).set(dmUserId, updated);
      });
    };
```

- [ ] **Step 3: Replace the DM-backfill block in registerDMRoom**

In `registerDMRoom` (around lines 285-351), replace the manual transformation loop with a call to the helper:

```ts
    const registerDMRoom = (room: Room, otherUserId: string) => {
      if (roomIdToDMUserIdRef.current.has(room.roomId)) return;

      setDmRoomMap(prev => new Map(prev).set(otherUserId, room.roomId));
      dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(otherUserId, room.roomId);
      roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(room.roomId, otherUserId);

      const timelineEvents = room.getLiveTimeline().getEvents();
      const backfillMsgs: ChatMessage[] = [];
      for (const ev of timelineEvents) {
        const msg = transformEventToChatMessage(ev, room, otherUserId, clientRef.current);
        if (msg) backfillMsgs.push(msg);
      }

      if (backfillMsgs.length > 0) {
        setDmMessages(prev => {
          const existing = prev.get(otherUserId) ?? [];
          let merged = existing;
          for (const msg of backfillMsgs) {
            merged = insertMessage(merged, msg);
          }
          if (merged === existing) return prev;
          return new Map(prev).set(otherUserId, merged);
        });
      }
    };
```

- [ ] **Step 4: Run existing tests to verify no regression**

Run: `(cd src/Brmble.Web && npm test -- useMatrixClient --run)`
Expected: all existing tests pass (refactor preserves behavior).

- [ ] **Step 5: Run typecheck**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: build completes without TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts
git commit -m "$(cat <<'EOF'
refactor(matrix): extract pure event-to-ChatMessage transformer

Pulls the duplicated channel and DM transformation logic in onTimeline
and registerDMRoom into a single pure helper. No behavior change;
prepares for active-only state in the next change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add lastMessages and dmLastMessages preview maps + bootstrap

This task adds the bounded sidebar-preview maps as new outputs of `useMatrixClient`. It is purely additive: the existing `messages`/`dmMessages` Maps are unchanged, so callers continue to work. After this task `useMatrixClient` has both old and new outputs.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Add tests for lastMessages**

In `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`, append these tests inside the existing `describe('useMatrixClient', …)` block:

```ts
  it('lastMessages and dmLastMessages start empty', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    expect(result.current.lastMessages.size).toBe(0);
    expect(result.current.dmLastMessages.size).toBe(0);
  });

  it('updates lastMessages when a channel timeline event arrives', () => {
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: vi.fn(() => ({ rawDisplayName: 'Alice', name: 'Alice' })),
    };
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    expect(onTimeline).toBeDefined();

    const fakeEvent = {
      getType: () => 'm.room.message',
      getId: () => '$evt-1',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'hi there' }),
      getTs: () => 1_700_000_000_000,
    };

    act(() => onTimeline!(fakeEvent, mockRoom));

    expect(result.current.lastMessages.get('42')).toEqual({
      content: 'hi there',
      ts: 1_700_000_000_000,
      sender: 'Alice',
    });
  });
```

- [ ] **Step 2: Run new tests, verify they fail**

Run: `(cd src/Brmble.Web && npm test -- useMatrixClient --run)`
Expected: 2 new tests FAIL (`lastMessages` is undefined on `result.current`).

- [ ] **Step 3: Add the MessagePreview type and state**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`:

a) Below the `MatrixCredentials` interface, export a new type:

```ts
export interface MessagePreview {
  content: string;
  ts: number;
  sender: string;
}
```

b) Inside the hook body, alongside `const [messages, setMessages] = ...` (line 38), add:

```ts
  const [lastMessages, setLastMessages] = useState<Map<string, MessagePreview>>(new Map());
  const [dmLastMessages, setDmLastMessages] = useState<Map<string, MessagePreview>>(new Map());
```

- [ ] **Step 4: Update onTimeline to also write lastMessages / dmLastMessages**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, modify the channel branch of `onTimeline` (after the `setMessages(...)` call, before the `return`):

```ts
        setMessages(prev => {
          const existing = prev.get(channelId) ?? [];
          const updated = insertMessage(existing, message);
          if (updated === existing) return prev;
          return new Map(prev).set(channelId, updated);
        });

        setLastMessages(prev => {
          const existing = prev.get(channelId);
          if (existing && existing.ts >= message.timestamp.getTime()) return prev;
          const next = new Map(prev);
          next.set(channelId, {
            content: message.content,
            ts: message.timestamp.getTime(),
            sender: message.sender,
          });
          return next;
        });
        return;
```

And in the DM branch (after `setDmMessages(...)`):

```ts
      setDmMessages(prev => {
        const existing = prev.get(dmUserId) ?? [];
        const updated = insertMessage(existing, dmMessage);
        if (updated === existing) return prev;
        return new Map(prev).set(dmUserId, updated);
      });

      setDmLastMessages(prev => {
        const existing = prev.get(dmUserId);
        if (existing && existing.ts >= dmMessage.timestamp.getTime()) return prev;
        const next = new Map(prev);
        next.set(dmUserId, {
          content: dmMessage.content,
          ts: dmMessage.timestamp.getTime(),
          sender: dmMessage.sender,
        });
        return next;
      });
```

- [ ] **Step 5: Bootstrap lastMessages on PREPARED**

In `onSync`, inside the `if (state === 'PREPARED')` block (around line 237 in current code), after the existing DM-room-map population and bufferedDmEvents replay, add:

```ts
          // Bootstrap last-message previews from the SDK timelines now
          // that initial sync is complete. This avoids waiting for new
          // RoomEvent.Timeline events to populate the sidebar.
          const bootChannelPreviews = new Map<string, MessagePreview>();
          const bootDmPreviews = new Map<string, MessagePreview>();
          for (const room of client.getRooms()) {
            const channelId = roomIdToChannelId.get(room.roomId);
            const dmUserId = roomIdToDMUserIdRef.current.get(room.roomId);
            const target = channelId ?? dmUserId;
            if (!target) continue;

            const events = room.getLiveTimeline().getEvents();
            for (let i = events.length - 1; i >= 0; i--) {
              const ev = events[i];
              if (ev.getType() !== EventType.RoomMessage) continue;
              const msg = transformEventToChatMessage(ev, room, target, clientRef.current);
              if (!msg) continue;
              const preview: MessagePreview = {
                content: msg.content,
                ts: msg.timestamp.getTime(),
                sender: msg.sender,
              };
              if (channelId) bootChannelPreviews.set(channelId, preview);
              else if (dmUserId) bootDmPreviews.set(dmUserId, preview);
              break;
            }
          }
          if (bootChannelPreviews.size > 0) setLastMessages(bootChannelPreviews);
          if (bootDmPreviews.size > 0) setDmLastMessages(bootDmPreviews);
```

- [ ] **Step 6: Reset previews on credentials = null**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, the credentials-null branch (around line 64-75) currently resets `setMessages(new Map())` etc. Add the new resets:

```ts
      setMessages(new Map());
      setLastMessages(new Map());
      setDmRoomMap(new Map());
      setDmMessages(new Map());
      setDmLastMessages(new Map());
```

- [ ] **Step 7: Add lastMessages and dmLastMessages to the hook's return object**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, the `return { ... }` at the end of the hook (around line 629-631), add:

```ts
  return { messages, lastMessages, sendMessage, sendImageMessage, uploadContent, fetchHistory,
           dmMessages, dmLastMessages, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- useMatrixClient --run)`
Expected: all tests pass — both new lastMessages tests and existing tests.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "$(cat <<'EOF'
feat(matrix): add bounded lastMessages preview maps

Adds lastMessages and dmLastMessages: one MessagePreview entry per room,
populated on PREPARED from SDK timelines and updated on every
RoomEvent.Timeline. Prepares the sidebar to drop full message arrays
in the next change. Existing messages/dmMessages Maps are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add active-only message state + setActiveChannel/setActiveDmContact

Adds the new "active room" state alongside the existing eager Maps. Still purely additive — old API works, new API works. No consumer change yet.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Add tests for setActiveChannel**

In `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`, append:

```ts
  it('setActiveChannel rebuilds activeMessages from SDK timeline', () => {
    const aliceMember = { rawDisplayName: 'Alice', name: 'Alice' };
    const fakeEvents = [
      {
        getType: () => 'm.room.message',
        getId: () => '$e1',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'first' }),
        getTs: () => 1000,
      },
      {
        getType: () => 'm.room.message',
        getId: () => '$e2',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'second' }),
        getTs: () => 2000,
      },
    ];
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => aliceMember,
      getLiveTimeline: () => ({ getEvents: () => fakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockRoom);

    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    act(() => result.current.setActiveChannel('42'));

    expect(result.current.activeMessages).toHaveLength(2);
    expect(result.current.activeMessages[0].content).toBe('first');
    expect(result.current.activeMessages[1].content).toBe('second');
  });

  it('setActiveChannel(null) clears activeMessages', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel(null));
    expect(result.current.activeMessages).toEqual([]);
  });

  it('rapid setActiveChannel switches commit only the latest load', () => {
    // Build two rooms and have getRoom toggle between them.
    const roomA = {
      roomId: '!a:example.com',
      getMember: () => ({ rawDisplayName: 'A', name: 'A' }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$a1', getSender: () => '@a:example.com',
          getContent: () => ({ body: 'A-msg' }), getTs: () => 1 },
      ]}),
    };
    const roomB = {
      roomId: '!b:example.com',
      getMember: () => ({ rawDisplayName: 'B', name: 'B' }),
      getLiveTimeline: () => ({ getEvents: () => [
        { getType: () => 'm.room.message', getId: () => '$b1', getSender: () => '@b:example.com',
          getContent: () => ({ body: 'B-msg' }), getTs: () => 1 },
      ]}),
    };
    mockClient.getRoom.mockImplementation((id: string) =>
      id === '!a:example.com' ? roomA : id === '!b:example.com' ? roomB : null);

    const credsAB: MatrixCredentials = {
      ...creds,
      roomMap: { 'A': '!a:example.com', 'B': '!b:example.com' },
    };
    const { result } = renderHook(() => useMatrixClient(credsAB), { wrapper });

    act(() => {
      result.current.setActiveChannel('A');
      result.current.setActiveChannel('B');
      result.current.setActiveChannel('A');
    });

    expect(result.current.activeMessages).toHaveLength(1);
    expect(result.current.activeMessages[0].content).toBe('A-msg');
  });
```

- [ ] **Step 2: Run new tests, verify they fail**

Run: `(cd src/Brmble.Web && npm test -- useMatrixClient --run)`
Expected: 3 new tests FAIL (`setActiveChannel is not a function`).

- [ ] **Step 3: Add active state and setActiveChannel**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, near the existing useState declarations (after `dmLastMessages`), add:

```ts
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [activeDmMessages, setActiveDmMessages] = useState<ChatMessage[]>([]);
  const activeChannelIdRef = useRef<string | null>(null);
  const activeDmContactIdRef = useRef<string | null>(null);
  const activeRoomVersionRef = useRef(0);
  const activeDmVersionRef = useRef(0);
```

Then, inside the hook body but outside the main `useEffect`, add the helper callbacks:

```ts
  const setActiveChannel = useCallback((channelId: string | null) => {
    activeRoomVersionRef.current += 1;
    const myVersion = activeRoomVersionRef.current;
    activeChannelIdRef.current = channelId;

    if (!channelId) {
      setActiveMessages([]);
      return;
    }
    const client = clientRef.current;
    if (!credentials || !client) {
      setActiveMessages([]);
      return;
    }
    const roomId = credentials.roomMap[channelId];
    if (!roomId) {
      setActiveMessages([]);
      return;
    }
    const room = client.getRoom(roomId);
    if (!room) {
      setActiveMessages([]);
      return;
    }

    const events = room.getLiveTimeline().getEvents();
    const messages: ChatMessage[] = [];
    for (const ev of events) {
      const m = transformEventToChatMessage(ev, room, channelId, client);
      if (m) messages.push(m);
    }

    if (activeRoomVersionRef.current === myVersion) {
      setActiveMessages(messages);
    }
  }, [credentials]);

  const setActiveDmContact = useCallback((matrixUserId: string | null) => {
    activeDmVersionRef.current += 1;
    const myVersion = activeDmVersionRef.current;
    activeDmContactIdRef.current = matrixUserId;

    if (!matrixUserId) {
      setActiveDmMessages([]);
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setActiveDmMessages([]);
      return;
    }
    const roomId = dmRoomMapRef.current.get(matrixUserId);
    if (!roomId) {
      setActiveDmMessages([]);
      return;
    }
    const room = client.getRoom(roomId);
    if (!room) {
      setActiveDmMessages([]);
      return;
    }

    const events = room.getLiveTimeline().getEvents();
    const messages: ChatMessage[] = [];
    for (const ev of events) {
      const m = transformEventToChatMessage(ev, room, matrixUserId, client);
      if (m) messages.push(m);
    }

    if (activeDmVersionRef.current === myVersion) {
      setActiveDmMessages(messages);
    }
  }, []);
```

- [ ] **Step 4: Have onTimeline append to active state when matched**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, modify the channel branch of `onTimeline` so it also appends to `activeMessages` when the room is currently active. After the existing `setLastMessages(...)` block, add:

```ts
        if (activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => {
            const updated = insertMessage(prev, message);
            return updated === prev ? prev : updated;
          });
        }
```

In the DM branch, after the `setDmLastMessages(...)` block, add:

```ts
      if (activeDmContactIdRef.current === dmUserId) {
        setActiveDmMessages(prev => {
          const updated = insertMessage(prev, dmMessage);
          return updated === prev ? prev : updated;
        });
      }
```

- [ ] **Step 5: Reset active state on credentials = null**

In the credentials-null branch (where the other Maps reset), add:

```ts
      setActiveMessages([]);
      setActiveDmMessages([]);
      activeChannelIdRef.current = null;
      activeDmContactIdRef.current = null;
```

- [ ] **Step 6: Add to return object**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, append to the hook return:

```ts
  return { messages, lastMessages, activeMessages, setActiveChannel,
           sendMessage, sendImageMessage, uploadContent, fetchHistory,
           dmMessages, dmLastMessages, activeDmMessages, setActiveDmContact, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- useMatrixClient --run)`
Expected: all tests pass — including the 3 new setActiveChannel tests and existing ones.

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "$(cat <<'EOF'
feat(matrix): add active-only message state with version-guarded loads

Adds activeMessages, activeDmMessages, setActiveChannel, and
setActiveDmContact. Reads room timeline from the SDK on activation
and appends real-time events only when the room is active. Uses
monotonic version refs so a stale load cannot overwrite a newer one.

Old messages/dmMessages Maps are still maintained — consumers will
migrate in the next change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate App.tsx and useDMStore to the new API; remove old Maps

Switch consumers off the eager Maps and remove them from `useMatrixClient`. After this task, the old `messages`/`dmMessages` paths are gone and the leak is fixed.

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useDMStore.ts`
- Modify: `src/Brmble.Web/src/hooks/useDMStore.test.ts`
- Modify: `src/Brmble.Web/src/App.tsx`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Update DMStoreOptions in useDMStore.ts**

In `src/Brmble.Web/src/hooks/useDMStore.ts`, change the `DMStoreOptions` interface:

```ts
export interface DMStoreOptions {
  matrixDmLastMessages: Map<string, { content: string; ts: number; sender: string }> | undefined;
  activeDmMessages: ChatMessage[] | undefined;
  matrixDmRoomMap: Map<string, string> | undefined;
  matrixDmUserDisplayNames: Map<string, string> | undefined;
  matrixDmUserAvatarUrls: Map<string, string> | undefined;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
  sendMumbleDM?: (targetSession: number, text: string) => void;
  users: User[];
  username: string;
}
```

Update the destructure at the top of `useDMStore`:

```ts
  const {
    matrixDmLastMessages,
    activeDmMessages,
    matrixDmRoomMap,
    matrixDmUserDisplayNames,
    matrixDmUserAvatarUrls,
    sendMatrixDM,
    fetchDMHistory,
    sendMumbleDM,
    users,
    username,
  } = options;
```

- [ ] **Step 2: Use matrixDmLastMessages in the contacts useMemo**

In `src/Brmble.Web/src/hooks/useDMStore.ts`, the `contacts` useMemo currently reads:

```ts
        const msgs = matrixDmMessages?.get(matrixUserId);
        const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
        // ...
          lastMessage: lastMsg?.content,
          lastMessageTime: lastMsg?.timestamp.getTime(),
```

Replace with:

```ts
        const lastPreview = matrixDmLastMessages?.get(matrixUserId);
        // ...
          lastMessage: lastPreview?.content,
          lastMessageTime: lastPreview?.ts,
```

Update the useMemo dependency list: replace `matrixDmMessages` with `matrixDmLastMessages`:

```ts
  }, [matrixDmRoomMap, matrixDmLastMessages, matrixDmUserDisplayNames, matrixDmUserAvatarUrls, users, pendingMatrixContacts, mumbleContacts, mumbleMessages]);
```

- [ ] **Step 3: Use activeDmMessages in the messages useMemo**

In `src/Brmble.Web/src/hooks/useDMStore.ts`, the `messages` useMemo currently reads:

```ts
    const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
```

Replace with:

```ts
    const matrixMsgs = activeDmMessages ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
```

Update the dependency list: replace `matrixDmMessages` with `activeDmMessages`:

```ts
  }, [selectedContactId, activeDmMessages, pendingMessages, mumbleMessages]);
```

- [ ] **Step 4: Update useDMStore.test.ts options helper**

In `src/Brmble.Web/src/hooks/useDMStore.test.ts`, update `makeOptions` to match the new signature:

```ts
function makeOptions(overrides: Partial<DMStoreOptions> = {}): DMStoreOptions {
  return {
    matrixDmLastMessages: new Map(),
    activeDmMessages: [],
    matrixDmRoomMap: new Map(),
    matrixDmUserDisplayNames: new Map(),
    matrixDmUserAvatarUrls: new Map(),
    sendMatrixDM: vi.fn().mockResolvedValue(undefined),
    fetchDMHistory: vi.fn().mockResolvedValue(undefined),
    sendMumbleDM: vi.fn(),
    users: [{ id: 1, name: 'me', session: 1 }] as DMStoreOptions['users'],
    username: 'me',
    ...overrides,
  };
}
```

- [ ] **Step 5: Update App.tsx to call setActiveChannel/setActiveDmContact**

In `src/Brmble.Web/src/App.tsx`, the variable that drives the visible Matrix channel is `activeChannelId` (see line 1955: `const activeChannelId = currentChannelId && currentChannelId !== 'server-root' ? currentChannelId : null;`).

After the `dmStore = useDMStore({ ... })` block (line 531-543), add two effects to mirror selection into `useMatrixClient`:

```tsx
  useEffect(() => {
    matrixClient.setActiveChannel(activeChannelId);
  }, [activeChannelId, matrixClient.setActiveChannel]);

  useEffect(() => {
    matrixClient.setActiveDmContact(dmStore.selectedContact?.id ?? null);
  }, [dmStore.selectedContact?.id, matrixClient.setActiveDmContact]);
```

Note: `activeChannelId` is computed below the `useDMStore` call in the current file — you must move its declaration up to before the new effects, or place the effects below where it is currently computed (around line 1955+). Either is fine; the simpler change is to move `activeChannelId` up so it lives next to `dmStore`.

- [ ] **Step 6: Update App.tsx to pass new props to useDMStore**

In `src/Brmble.Web/src/App.tsx`, the useDMStore call site is at lines 531-543. Replace the `matrixDmMessages: matrixClient.dmMessages` line (line 532) with two new props, keeping all other lines including the existing `sendMumbleDM` arrow function:

```tsx
  const dmStore = useDMStore({
    matrixDmLastMessages: matrixClient.dmLastMessages,
    activeDmMessages: matrixClient.activeDmMessages,
    matrixDmRoomMap: matrixClient.dmRoomMap,
    matrixDmUserDisplayNames: matrixClient.dmUserDisplayNames,
    matrixDmUserAvatarUrls: matrixClient.dmUserAvatarUrls,
    sendMatrixDM: matrixClient.sendDMMessage,
    fetchDMHistory: matrixClient.fetchDMHistory,
    users,
    username,
    sendMumbleDM: (targetSession: number, text: string) => {
      bridge.send('voice.sendPrivateMessage', { message: linkifyForMumble(text), targetSession });
    },
  });
```

- [ ] **Step 7: Update App.tsx channel ChatPanel to use activeMessages and lastMessages**

In `src/Brmble.Web/src/App.tsx`, line 1959-1960 currently reads:

```tsx
  const matrixMessages = activeChannelId
    ? matrixClient.messages.get(activeChannelId)
```

Replace with:

```tsx
  const matrixMessages = activeChannelId
    ? matrixClient.activeMessages
```

(The fallback after the conditional, and any `?? []`, stays as-is.)

Then `grep -n "matrixClient\.messages\|matrixClient\.dmMessages" src/Brmble.Web/src/App.tsx` to find any other call sites and update each:
- For sidebar last-message previews per channel: `matrixClient.lastMessages.get(channelId)?.content`.
- For DM previews per contact: already handled via `dmStore.contacts` consuming `matrixDmLastMessages`.
- For the active DM message list: `matrixClient.activeDmMessages` (already wired through `dmStore.messages`).

- [ ] **Step 8: Remove the old messages and dmMessages state from useMatrixClient**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`:

a) Delete the `messages` and `dmMessages` `useState` lines.

b) In `onTimeline`, delete the `setMessages(...)` and `setDmMessages(...)` blocks. The function should now only call `setLastMessages` / `setDmLastMessages` and (when active) `setActiveMessages` / `setActiveDmMessages`.

c) In `registerDMRoom`, delete the `setDmMessages(prev => ...)` block (its job is now done by onTimeline + setActiveDmContact-driven loads). Keep the rest of the function (room map updates).

d) In the credentials-null branch, remove `setMessages(new Map())` and `setDmMessages(new Map())`.

e) Lower the initialSyncLimit from 20 to 5:

```ts
    client.startClient({ initialSyncLimit: 5 });
```

f) In the return object, remove `messages` and `dmMessages`. Final return:

```ts
  return { lastMessages, activeMessages, setActiveChannel,
           sendMessage, sendImageMessage, uploadContent, fetchHistory,
           dmLastMessages, activeDmMessages, setActiveDmContact, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client };
```

- [ ] **Step 9: Update existing useMatrixClient tests that reference the old Maps**

In `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`:

a) The test `'calls stopClient and clears messages when credentials become null'` at line 76-84 references `result.current.messages.size`. Replace `messages` with `lastMessages` and `dmLastMessages`:

```ts
    expect(mockClient.stopClient).toHaveBeenCalled();
    expect(result.current.lastMessages.size).toBe(0);
    expect(result.current.dmLastMessages.size).toBe(0);
    expect(result.current.activeMessages).toEqual([]);
    expect(result.current.activeDmMessages).toEqual([]);
```

b) Update the `'calls startClient when credentials are provided'` test to expect the new sync limit:

```ts
    expect(mockClient.startClient).toHaveBeenCalledWith({ initialSyncLimit: 5 });
```

c) Any other test that asserts on `result.current.messages` (or `dmMessages`) — delete or rewrite to use `activeMessages` after a `setActiveChannel(...)` call.

- [ ] **Step 10: Run all hook tests**

Run: `(cd src/Brmble.Web && npm test -- --run hooks/)`
Expected: all hook tests pass.

- [ ] **Step 11: Run full frontend build to catch type errors in App.tsx**

Run: `(cd src/Brmble.Web && npm run build)`
Expected: build succeeds. If not, fix the type errors in App.tsx (likely places where `matrixClient.messages` or `matrixClient.dmMessages` are still referenced).

- [ ] **Step 12: Run dotnet build to make sure nothing native broke**

Run: `dotnet build`
Expected: build succeeds (frontend dist is copied as part of build per CLAUDE.md).

- [ ] **Step 13: Manual smoke test**

Start dev server and client:

```bash
(cd src/Brmble.Web && npm run dev)
# in another terminal:
dotnet run --project src/Brmble.Client
```

Verify:
- Open the app, channels appear in sidebar with "last message" preview text.
- Click a channel → messages render correctly.
- Switch between channels rapidly → no errors in `%TEMP%/brmble-tls.log` or DevTools console.
- Send a new message → it appears in the active channel and updates the sidebar preview.
- Open a DM → DM messages render. Switch DM contacts → previews update.
- Scroll back in the active channel → older messages backfill.
- Leave app idle for 5+ minutes (shorter repro) → no DevTools "out of memory" warnings; private bytes (Task Manager → brmble.client.exe) remains roughly stable.

- [ ] **Step 14: Commit**

```bash
git add src/Brmble.Web/src/hooks/useDMStore.ts \
        src/Brmble.Web/src/hooks/useDMStore.test.ts \
        src/Brmble.Web/src/hooks/useMatrixClient.ts \
        src/Brmble.Web/src/hooks/useMatrixClient.test.ts \
        src/Brmble.Web/src/App.tsx
git commit -m "$(cat <<'EOF'
perf(chat): drop eager per-room message Maps; only active room in state

useMatrixClient now keeps only the active channel and active DM in
React state. Sidebar previews come from a bounded lastMessages map
(one entry per room). matrix-js-sdk's internal timeline cache is the
source of truth; ChatMessage transformation runs once per channel
open instead of for every event in every room.

initialSyncLimit lowered 20 -> 5 to cut cold-start payload by 75%.
Real-time messages still arrive via incremental sync regardless.

Fixes the WebView2 "page out of memory" symptom from the original
30-min idle repro and reduces cold-start time-to-first-paint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (after Task 6)

- [ ] All hook tests pass: `(cd src/Brmble.Web && npm test -- --run hooks/)`
- [ ] Full frontend test suite passes: `(cd src/Brmble.Web && npm test -- --run)`
- [ ] Frontend build clean: `(cd src/Brmble.Web && npm run build)`
- [ ] Dotnet build clean: `dotnet build`
- [ ] Manual smoke test from Task 6 Step 13 passes.
- [ ] Optional: 30-min idle test (compare private bytes before/after; expectation: flat).

If verification passes, the branch is ready for the user to review and decide on PR/merge.
