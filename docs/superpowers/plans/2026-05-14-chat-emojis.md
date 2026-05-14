# Chat Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Matrix-native emoji reactions to chat messages with context-menu and badge toggles.

**Architecture:** Reaction state stays on `ChatMessage.reactions` as `emoji -> sender IDs`; pure helper functions mutate reaction maps immutably and prune empty emoji entries. `useMatrixClient` processes `m.reaction` timeline/redaction events, sends/removes reactions through Matrix, and exposes toggle primitives that `App`, `ChatPanel`, and `MessageBubble` wire into the UI.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, `matrix-js-sdk`.

---

## File Structure

- Modify: `src/Brmble.Web/src/types/index.ts`
  - Add `reactions?: Record<string, string[]>` to `ChatMessage`.
- Create: `src/Brmble.Web/src/utils/chatReactions.ts`
  - Own the supported emoji set and pure immutable helpers for adding/removing/pruning reaction senders.
- Create: `src/Brmble.Web/src/utils/chatReactions.test.ts`
  - Test duplicate prevention, removal, pruning, and own-reaction checks.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
  - Parse `m.reaction`, aggregate timeline reactions, track own reaction event IDs, process reaction redactions, and expose `sendReaction`/`removeReaction`.
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
  - Test reaction timeline processing, initial timeline aggregation, sending, and redaction removal.
- Modify: `src/Brmble.Web/src/App.tsx`
  - Wire reaction callbacks from `useMatrixClient` into both channel and DM `ChatPanel` instances.
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`
  - Render reaction badges below message content and allow badge toggle.
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`
  - Style reaction row and active badges.
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx`
  - Test visible counts, current-user highlighting, badge toggle, and hidden empty reactions.
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
  - Add `React` submenu to message context menu and pass reactions/toggle callback to bubbles.
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
  - Add context-menu reaction affordance styles if generic `ContextMenu` styles are not enough.
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`
  - Test context-menu reaction submenu calls the toggle callback and marks active own reactions.

## Important Existing Seams

- `useMatrixClient` currently returns message actions near the bottom of `src/Brmble.Web/src/hooks/useMatrixClient.ts`; add `sendReaction` and `removeReaction` next to `deleteMessage`.
- `App.tsx` already has channel/DM deletion wrappers around lines 2262-2271; add reaction wrappers in the same area.
- `ChatPanel.tsx` already builds context-menu items inline near the bottom; insert the `React` submenu before delete/DM dividers.
- `ContextMenu.tsx` already supports `children?: ContextMenuItem[]`, so no generic context-menu changes should be needed.
- `MessageBubble.tsx` currently receives `messageId` and `currentUsername`; add `reactions`, `currentUserId`, and `onReactionToggle`.

---

### Task 1: Reaction Types And Pure Helpers

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts`
- Create: `src/Brmble.Web/src/utils/chatReactions.ts`
- Create: `src/Brmble.Web/src/utils/chatReactions.test.ts`

- [ ] **Step 1: Add failing helper tests**

Create `src/Brmble.Web/src/utils/chatReactions.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_REACTIONS,
  addReactionSender,
  hasReactionFromSender,
  removeReactionSender,
} from './chatReactions';

describe('chatReactions', () => {
  it('exposes the six supported reaction emojis in menu order', () => {
    expect(SUPPORTED_REACTIONS).toEqual(['👍', '❤️', '😂', '😮', '😢', '😡']);
  });

  it('adds a sender without mutating the previous reaction map', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = addReactionSender(previous, '👍', '@bob:example.com');

    expect(next).toEqual({ '👍': ['@alice:example.com', '@bob:example.com'] });
    expect(previous).toEqual({ '👍': ['@alice:example.com'] });
  });

  it('does not duplicate the same sender for the same emoji', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = addReactionSender(previous, '👍', '@alice:example.com');

    expect(next).toBe(previous);
  });

  it('removes a sender and prunes empty emoji entries', () => {
    const previous = {
      '👍': ['@alice:example.com'],
      '😂': ['@alice:example.com', '@bob:example.com'],
    };

    const next = removeReactionSender(previous, '👍', '@alice:example.com');
    const second = removeReactionSender(next, '😂', '@alice:example.com');

    expect(next).toEqual({ '😂': ['@alice:example.com', '@bob:example.com'] });
    expect(second).toEqual({ '😂': ['@bob:example.com'] });
  });

  it('returns the previous map when removing a missing sender', () => {
    const previous = { '👍': ['@alice:example.com'] };

    const next = removeReactionSender(previous, '👍', '@bob:example.com');

    expect(next).toBe(previous);
  });

  it('detects whether a sender already reacted with an emoji', () => {
    expect(hasReactionFromSender({ '👍': ['@alice:example.com'] }, '👍', '@alice:example.com')).toBe(true);
    expect(hasReactionFromSender({ '👍': ['@alice:example.com'] }, '👍', '@bob:example.com')).toBe(false);
    expect(hasReactionFromSender(undefined, '👍', '@alice:example.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
npm run test -- src/utils/chatReactions.test.ts
```

Expected: FAIL because `src/utils/chatReactions.ts` does not exist.

- [ ] **Step 3: Implement reaction helpers**

Create `src/Brmble.Web/src/utils/chatReactions.ts`:

```typescript
import type { ChatMessage } from '../types';

export const SUPPORTED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'] as const;

export type SupportedReaction = typeof SUPPORTED_REACTIONS[number];
export type ReactionMap = NonNullable<ChatMessage['reactions']>;

function cloneWithoutEmptyEntries(reactions: ReactionMap): ReactionMap | undefined {
  const entries = Object.entries(reactions).filter(([, senders]) => senders.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function addReactionSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string,
): ReactionMap {
  const currentSenders = reactions?.[emoji] ?? [];
  if (currentSenders.includes(senderId)) {
    return reactions ?? { [emoji]: currentSenders };
  }
  return {
    ...(reactions ?? {}),
    [emoji]: [...currentSenders, senderId],
  };
}

export function removeReactionSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string,
): ReactionMap | undefined {
  const currentSenders = reactions?.[emoji];
  if (!currentSenders?.includes(senderId)) return reactions;

  const next = {
    ...(reactions ?? {}),
    [emoji]: currentSenders.filter(id => id !== senderId),
  };
  return cloneWithoutEmptyEntries(next);
}

export function hasReactionFromSender(
  reactions: ReactionMap | undefined,
  emoji: string,
  senderId: string | undefined,
): boolean {
  if (!senderId) return false;
  return reactions?.[emoji]?.includes(senderId) ?? false;
}
```

- [ ] **Step 4: Add the ChatMessage field**

Modify `src/Brmble.Web/src/types/index.ts` inside `ChatMessage`:

```typescript
export interface ChatMessage {
  id: string;
  channelId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  timestamp: Date;
  type?: 'system';
  systemType?: string;
  html?: boolean;
  media?: MediaAttachment[];
  pending?: boolean;
  error?: boolean;
  redacted?: boolean;
  reactions?: Record<string, string[]>;
  replyToEventId?: string;
  replyToSender?: string;
  replyToContent?: string;
}
```

- [ ] **Step 5: Run helper tests and commit**

Run:

```bash
npm run test -- src/utils/chatReactions.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/Brmble.Web/src/types/index.ts src/Brmble.Web/src/utils/chatReactions.ts src/Brmble.Web/src/utils/chatReactions.test.ts
git commit -m "feat: add chat reaction helpers"
```

---

### Task 2: Matrix Timeline Reaction Processing

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Add failing timeline and initial-sync tests**

Append these tests inside `describe('useMatrixClient', () => { ... })` in `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`:

```typescript
  it('adds reaction events to active channel messages without creating sidebar previews', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel('42'));

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => ({ rawDisplayName: 'Alice', name: 'Alice' }),
    };
    const messageEvent = {
      getType: () => 'm.room.message',
      getId: () => '$message',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'react to me' }),
      getTs: () => 1000,
    };
    const reactionEvent = {
      getType: () => 'm.reaction',
      getId: () => '$reaction',
      getSender: () => '@bob:example.com',
      getContent: () => ({
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: '$message',
          key: '👍',
        },
      }),
      getTs: () => 1001,
    };

    act(() => {
      onTimeline?.(messageEvent, mockRoom);
      onTimeline?.(reactionEvent, mockRoom);
    });

    expect(result.current.activeMessages[0]).toEqual(expect.objectContaining({
      id: '$message',
      reactions: { '👍': ['@bob:example.com'] },
    }));
    expect(result.current.lastMessages.get('42')).toEqual({
      content: 'react to me',
      ts: 1000,
      sender: 'Alice',
    });
  });

  it('aggregates reaction events when loading active channel timeline', () => {
    const fakeEvents = [
      {
        getType: () => 'm.room.message',
        getId: () => '$message',
        getSender: () => '@alice:example.com',
        getContent: () => ({ body: 'loaded from timeline' }),
        getTs: () => 1000,
      },
      {
        getType: () => 'm.reaction',
        getId: () => '$reaction',
        getSender: () => '@bob:example.com',
        getContent: () => ({
          'm.relates_to': {
            rel_type: 'm.annotation',
            event_id: '$message',
            key: '😂',
          },
        }),
        getTs: () => 1001,
      },
    ];
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => ({ rawDisplayName: 'Alice', name: 'Alice' }),
      getLiveTimeline: () => ({ getEvents: () => fakeEvents }),
    };
    mockClient.getRoom.mockReturnValue(mockRoom);

    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel('42'));

    expect(result.current.activeMessages).toEqual([
      expect.objectContaining({
        id: '$message',
        content: 'loaded from timeline',
        reactions: { '😂': ['@bob:example.com'] },
      }),
    ]);
  });

  it('removes a reaction from an active channel message when the reaction event is redacted', () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel('42'));

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => ({ rawDisplayName: 'Alice', name: 'Alice' }),
    };
    const messageEvent = {
      getType: () => 'm.room.message',
      getId: () => '$message',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'react then redact' }),
      getTs: () => 1000,
    };
    const reactionEvent = {
      getType: () => 'm.reaction',
      getId: () => '$reaction',
      getSender: () => '@bob:example.com',
      getContent: () => ({
        'm.relates_to': { rel_type: 'm.annotation', event_id: '$message', key: '👍' },
      }),
      getTs: () => 1001,
    };
    const redactionEvent = {
      getType: () => 'm.room.redaction',
      getId: () => '$redaction',
      getSender: () => '@bob:example.com',
      getContent: () => ({}),
      getTs: () => 1002,
      getRedacts: () => '$reaction',
    };

    act(() => {
      onTimeline?.(messageEvent, mockRoom);
      onTimeline?.(reactionEvent, mockRoom);
      onTimeline?.(redactionEvent, mockRoom);
    });

    expect(result.current.activeMessages[0].reactions).toBeUndefined();
  });
```

- [ ] **Step 2: Run hook tests and verify they fail**

Run:

```bash
npm run test -- src/hooks/useMatrixClient.test.ts
```

Expected: FAIL because `m.reaction` is ignored and reaction redactions mark only message events.

- [ ] **Step 3: Import helper functions and define reaction metadata types**

Modify imports near the top of `src/Brmble.Web/src/hooks/useMatrixClient.ts`:

```typescript
import { addReactionSender, removeReactionSender } from '../utils/chatReactions';
```

Add these types below `type RedactionLikeEvent`:

```typescript
type ReactionContent = {
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
    key?: string;
  };
};

interface ReactionEventRecord {
  reactionEventId: string;
  targetEventId: string;
  emoji: string;
  senderId: string;
}
```

- [ ] **Step 4: Add pure reaction parsing and state helpers**

Add these helpers below `markMessageRedacted`:

```typescript
function parseReactionEvent(event: MatrixEvent): ReactionEventRecord | null {
  if (event.getType() !== 'm.reaction') return null;
  const reactionEventId = event.getId();
  const senderId = event.getSender();
  const relatesTo = (event.getContent() as ReactionContent)['m.relates_to'];
  const targetEventId = relatesTo?.event_id;
  const emoji = relatesTo?.key;

  if (!reactionEventId || !senderId || !targetEventId || !emoji) return null;
  if (relatesTo?.rel_type && relatesTo.rel_type !== 'm.annotation') return null;

  return { reactionEventId, targetEventId, emoji, senderId };
}

function applyReactionToMessages(
  existing: ChatMessage[],
  reaction: ReactionEventRecord,
): ChatMessage[] {
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== reaction.targetEventId) return message;
    const reactions = addReactionSender(message.reactions, reaction.emoji, reaction.senderId);
    if (reactions === message.reactions) return message;
    changed = true;
    return { ...message, reactions };
  });
  return changed ? updated : existing;
}

function removeReactionFromMessages(
  existing: ChatMessage[],
  reaction: ReactionEventRecord,
): ChatMessage[] {
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== reaction.targetEventId) return message;
    const reactions = removeReactionSender(message.reactions, reaction.emoji, reaction.senderId);
    if (reactions === message.reactions) return message;
    changed = true;
    return { ...message, reactions };
  });
  return changed ? updated : existing;
}
```

- [ ] **Step 5: Aggregate reactions in timeline loading**

Replace the body of `loadMessagesFromTimeline` with:

```typescript
  const room = client.getRoom(roomId);
  if (!room) return [];
  const out: ChatMessage[] = [];
  const pendingReactions: ReactionEventRecord[] = [];

  for (const ev of room.getLiveTimeline().getEvents()) {
    const m = transformEventToChatMessage(ev, room, targetId, client);
    if (m) {
      out.push(m);
      continue;
    }

    const reaction = parseReactionEvent(ev);
    if (reaction) {
      pendingReactions.push(reaction);
    }
  }

  return pendingReactions.reduce(applyReactionToMessages, out);
```

- [ ] **Step 6: Track reaction events and process timeline reactions**

Inside `useMatrixClient`, after `waitForRoomRef`, add:

```typescript
  const reactionEventsRef = useRef<Map<string, ReactionEventRecord>>(new Map());
```

Inside `onTimeline`, before the `RoomRedaction` branch, add:

```typescript
      if (eventType === 'm.reaction') {
        const reaction = parseReactionEvent(event);
        if (!reaction) return;
        reactionEventsRef.current.set(reaction.reactionEventId, reaction);

        if (channelId && activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => applyReactionToMessages(prev, reaction));
          return;
        }

        const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
        if (dmUserId && activeDmContactIdRef.current === dmUserId) {
          setActiveDmMessages(prev => applyReactionToMessages(prev, reaction));
        }
        return;
      }
```

Then replace the `RoomRedaction` branch with:

```typescript
      if (eventType === EventType.RoomRedaction) {
        const redactedEventId = getRedactedEventId(event);
        const redactedReaction = redactedEventId ? reactionEventsRef.current.get(redactedEventId) : undefined;
        if (redactedReaction && redactedEventId) {
          reactionEventsRef.current.delete(redactedEventId);
          if (channelId && activeChannelIdRef.current === channelId) {
            setActiveMessages(prev => removeReactionFromMessages(prev, redactedReaction));
            return;
          }

          const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
          if (dmUserId && activeDmContactIdRef.current === dmUserId) {
            setActiveDmMessages(prev => removeReactionFromMessages(prev, redactedReaction));
          }
          return;
        }

        if (channelId && activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => markMessageRedacted(prev, redactedEventId));
          return;
        }

        const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
        if (dmUserId && activeDmContactIdRef.current === dmUserId) {
          setActiveDmMessages(prev => markMessageRedacted(prev, redactedEventId));
        }
        return;
      }
```

In the `!credentials` cleanup branch, add:

```typescript
      reactionEventsRef.current.clear();
```

- [ ] **Step 7: Run hook tests and commit**

Run:

```bash
npm run test -- src/hooks/useMatrixClient.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: process Matrix reaction events"
```

---

### Task 3: Matrix Send And Remove Reaction Actions

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Add failing send/remove tests**

In the mock client at the top of `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`, change `sendMessage` to return an event id:

```typescript
  sendMessage: vi.fn().mockResolvedValue({ event_id: '$sent-event' }),
```

Append these tests inside `describe('useMatrixClient', () => { ... })`:

```typescript
  it('sendReaction sends a Matrix reaction event and optimistically marks the current user', async () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel('42'));

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => ({ rawDisplayName: 'Alice', name: 'Alice' }),
    };
    const messageEvent = {
      getType: () => 'm.room.message',
      getId: () => '$message',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'reactable' }),
      getTs: () => 1000,
    };
    act(() => onTimeline?.(messageEvent, mockRoom));

    await act(() => result.current.sendReaction('42', '$message', '👍'));

    expect(mockClient.sendMessage).toHaveBeenCalledWith('!room:example.com', {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: '$message',
        key: '👍',
      },
    });
    expect(result.current.activeMessages[0].reactions).toEqual({ '👍': ['@1:example.com'] });
  });

  it('removeReaction redacts the cached reaction event and optimistically removes the current user', async () => {
    mockClient.getRoom.mockReturnValue(null);
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    act(() => result.current.setActiveChannel('42'));

    const onTimeline = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'Room.timeline')?.[1] as
      | ((ev: unknown, r: unknown) => void)
      | undefined;
    const mockRoom = {
      roomId: '!room:example.com',
      getMember: () => ({ rawDisplayName: 'Alice', name: 'Alice' }),
    };
    const messageEvent = {
      getType: () => 'm.room.message',
      getId: () => '$message',
      getSender: () => '@alice:example.com',
      getContent: () => ({ body: 'reactable' }),
      getTs: () => 1000,
    };
    act(() => onTimeline?.(messageEvent, mockRoom));
    await act(() => result.current.sendReaction('42', '$message', '👍'));
    await act(() => result.current.removeReaction('42', '$message', '👍'));

    expect(mockClient.redactEvent).toHaveBeenCalledWith('!room:example.com', '$sent-event');
    expect(result.current.activeMessages[0].reactions).toBeUndefined();
  });
```

- [ ] **Step 2: Run hook tests and verify they fail**

Run:

```bash
npm run test -- src/hooks/useMatrixClient.test.ts
```

Expected: FAIL because `sendReaction` and `removeReaction` are not returned.

- [ ] **Step 3: Add own reaction cache**

Inside `useMatrixClient`, near `reactionEventsRef`, add:

```typescript
  const ownReactionEventIdsRef = useRef<Map<string, Map<string, string>>>(new Map());
```

In the `!credentials` cleanup branch, add:

```typescript
      ownReactionEventIdsRef.current.clear();
```

In the timeline `m.reaction` branch, after `reactionEventsRef.current.set(...)`, add:

```typescript
        if (credentials && reaction.senderId === credentials.userId) {
          const existing = ownReactionEventIdsRef.current.get(reaction.targetEventId) ?? new Map<string, string>();
          existing.set(reaction.emoji, reaction.reactionEventId);
          ownReactionEventIdsRef.current.set(reaction.targetEventId, existing);
        }
```

In the reaction redaction branch, before `return`, add:

```typescript
          const ownForMessage = ownReactionEventIdsRef.current.get(redactedReaction.targetEventId);
          if (ownForMessage?.get(redactedReaction.emoji) === redactedEventId) {
            ownForMessage.delete(redactedReaction.emoji);
            if (ownForMessage.size === 0) {
              ownReactionEventIdsRef.current.delete(redactedReaction.targetEventId);
            }
          }
```

- [ ] **Step 4: Implement sendReaction and removeReaction**

Add these callbacks below `deleteMessage`:

```typescript
  const sendReaction = useCallback(async (targetId: string, eventId: string, emoji: string) => {
    const client = clientRef.current;
    if (!credentials || !client || !eventId || !emoji) return;

    const roomId = credentials.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId);
    if (!roomId) return;

    const optimisticReaction: ReactionEventRecord = {
      reactionEventId: `optimistic-${eventId}-${emoji}`,
      targetEventId: eventId,
      emoji,
      senderId: credentials.userId,
    };

    setActiveMessages(prev => applyReactionToMessages(prev, optimisticReaction));
    setActiveDmMessages(prev => applyReactionToMessages(prev, optimisticReaction));

    try {
      const response = await client.sendMessage(roomId, {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: emoji,
        },
      });
      const reactionEventId = response?.event_id;
      if (reactionEventId) {
        reactionEventsRef.current.set(reactionEventId, {
          ...optimisticReaction,
          reactionEventId,
        });
        const ownForMessage = ownReactionEventIdsRef.current.get(eventId) ?? new Map<string, string>();
        ownForMessage.set(emoji, reactionEventId);
        ownReactionEventIdsRef.current.set(eventId, ownForMessage);
      }
    } catch (err) {
      console.warn('[Matrix] Failed to send reaction:', err);
      setActiveMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
      setActiveDmMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
    }
  }, [credentials]);

  const removeReaction = useCallback(async (targetId: string, eventId: string, emoji: string) => {
    const client = clientRef.current;
    if (!credentials || !client || !eventId || !emoji) return;

    const roomId = credentials.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId);
    const reactionEventId = ownReactionEventIdsRef.current.get(eventId)?.get(emoji);
    if (!roomId || !reactionEventId) return;

    const optimisticReaction: ReactionEventRecord = {
      reactionEventId,
      targetEventId: eventId,
      emoji,
      senderId: credentials.userId,
    };

    setActiveMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
    setActiveDmMessages(prev => removeReactionFromMessages(prev, optimisticReaction));

    try {
      await client.redactEvent(roomId, reactionEventId);
      reactionEventsRef.current.delete(reactionEventId);
      const ownForMessage = ownReactionEventIdsRef.current.get(eventId);
      ownForMessage?.delete(emoji);
      if (ownForMessage?.size === 0) {
        ownReactionEventIdsRef.current.delete(eventId);
      }
    } catch (err) {
      console.warn('[Matrix] Failed to remove reaction:', err);
      setActiveMessages(prev => applyReactionToMessages(prev, optimisticReaction));
      setActiveDmMessages(prev => applyReactionToMessages(prev, optimisticReaction));
    }
  }, [credentials]);
```

- [ ] **Step 5: Return the new callbacks**

Modify the return object at the bottom of `useMatrixClient`:

```typescript
  return { lastMessages, activeMessages, setActiveChannel,
           sendMessage, sendImageMessage, uploadContent, fetchHistory, deleteMessage,
           sendReaction, removeReaction,
           dmLastMessages, activeDmMessages, setActiveDmContact, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client };
```

- [ ] **Step 6: Run hook tests and commit**

Run:

```bash
npm run test -- src/hooks/useMatrixClient.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat: send and remove Matrix reactions"
```

---

### Task 4: App Reaction Wiring

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add channel and DM reaction wrappers**

Near `handleDeleteChannelMessage` in `src/Brmble.Web/src/App.tsx`, add:

```typescript
  const handleToggleChannelReaction = useCallback(async (
    chatPanelChannelId: string,
    messageId: string,
    emoji: string,
    isCurrentlyReacted: boolean,
  ) => {
    if (!chatPanelChannelId || chatPanelChannelId === 'server-root') return;
    if (isCurrentlyReacted) {
      await matrixClient.removeReaction(chatPanelChannelId, messageId, emoji);
    } else {
      await matrixClient.sendReaction(chatPanelChannelId, messageId, emoji);
    }
  }, [matrixClient]);

  const handleToggleDmReaction = useCallback(async (
    _chatPanelChannelId: string,
    messageId: string,
    emoji: string,
    isCurrentlyReacted: boolean,
  ) => {
    const selectedContactId = dmStore.selectedContact?.id;
    if (!selectedContactId) return;
    if (isCurrentlyReacted) {
      await matrixClient.removeReaction(selectedContactId, messageId, emoji);
    } else {
      await matrixClient.sendReaction(selectedContactId, messageId, emoji);
    }
  }, [dmStore.selectedContact?.id, matrixClient]);
```

- [ ] **Step 2: Pass callbacks and current Matrix user id to channel ChatPanel**

In the channel `ChatPanel` JSX, add:

```tsx
                    currentUserMatrixId={matrixCredentials?.userId}
                    onToggleReaction={handleToggleChannelReaction}
```

- [ ] **Step 3: Pass callbacks and current Matrix user id to DM ChatPanel**

In the DM `ChatPanel` JSX, add:

```tsx
                    currentUserMatrixId={matrixCredentials?.userId}
                    onToggleReaction={handleToggleDmReaction}
```

- [ ] **Step 4: Run TypeScript build and commit**

Run:

```bash
npm run build
```

Expected: FAIL until `ChatPanelProps` accepts the new props in the next task. Do not commit yet if this task is executed before Task 5; commit after Task 5 passes.

---

### Task 5: Message Bubble Reaction Badges

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx`

- [ ] **Step 1: Add failing MessageBubble tests**

Append these tests to `src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx`:

```typescript
describe('MessageBubble reactions', () => {
  it('renders reaction badges with counts and active state for the current Matrix user', () => {
    render(
      <MessageBubble
        sender="Alice"
        content="hello"
        timestamp={new Date('2026-05-14T10:00:00Z')}
        messageId="$message"
        currentUserMatrixId="@alice:example.com"
        reactions={{
          '👍': ['@alice:example.com', '@bob:example.com'],
          '😂': ['@bob:example.com'],
        }}
      />,
    );

    const thumbsUp = screen.getByRole('button', { name: 'Remove 👍 reaction, 2 reactions' });
    expect(thumbsUp).toHaveClass('message-reaction-badge--active');
    expect(screen.getByRole('button', { name: 'Add 😂 reaction, 1 reaction' })).toBeInTheDocument();
  });

  it('calls onReactionToggle with current active state when clicking a badge', async () => {
    const onReactionToggle = vi.fn();
    const user = (await import('@testing-library/user-event')).default.setup();

    render(
      <MessageBubble
        sender="Alice"
        content="hello"
        timestamp={new Date('2026-05-14T10:00:00Z')}
        messageId="$message"
        currentUserMatrixId="@alice:example.com"
        reactions={{ '👍': ['@alice:example.com'] }}
        onReactionToggle={onReactionToggle}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove 👍 reaction, 1 reaction' }));

    expect(onReactionToggle).toHaveBeenCalledWith('$message', '👍', true);
  });

  it('does not render empty reaction entries', () => {
    render(
      <MessageBubble
        sender="Alice"
        content="hello"
        timestamp={new Date('2026-05-14T10:00:00Z')}
        reactions={{ '👍': [] }}
      />,
    );

    expect(screen.queryByRole('button', { name: /👍/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run MessageBubble tests and verify they fail**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageBubble.test.tsx
```

Expected: FAIL because reaction props and rendering do not exist.

- [ ] **Step 3: Add reaction props and imports**

Modify imports in `MessageBubble.tsx`:

```typescript
import { hasReactionFromSender } from '../../utils/chatReactions';
```

Extend `MessageBubbleProps`:

```typescript
  reactions?: Record<string, string[]>;
  currentUserMatrixId?: string;
  onReactionToggle?: (messageId: string, emoji: string, isCurrentlyReacted: boolean) => void;
```

Add props to the destructuring parameter:

```typescript
reactions, currentUserMatrixId, onReactionToggle,
```

- [ ] **Step 4: Render reaction badges**

Before the `return (` in `MessageBubble.tsx`, add:

```typescript
  const visibleReactions = Object.entries(reactions ?? {}).filter(([, senders]) => senders.length > 0);
```

Inside `.message-content`, after media rendering and before `firstUrl`, add:

```tsx
        {visibleReactions.length > 0 && !redacted && (
          <div className="message-reactions" aria-label="Message reactions">
            {visibleReactions.map(([emoji, senders]) => {
              const isReactedByCurrentUser = hasReactionFromSender(reactions, emoji, currentUserMatrixId);
              const labelAction = isReactedByCurrentUser ? 'Remove' : 'Add';
              const reactionWord = senders.length === 1 ? 'reaction' : 'reactions';
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`message-reaction-badge${isReactedByCurrentUser ? ' message-reaction-badge--active' : ''}`}
                  onClick={() => {
                    if (!messageId || !onReactionToggle) return;
                    onReactionToggle(messageId, emoji, isReactedByCurrentUser);
                  }}
                  aria-label={`${labelAction} ${emoji} reaction, ${senders.length} ${reactionWord}`}
                >
                  <span className="message-reaction-emoji" aria-hidden="true">{emoji}</span>
                  <span className="message-reaction-count">{senders.length}</span>
                </button>
              );
            })}
          </div>
        )}
```

- [ ] **Step 5: Style badges**

Append to `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css`:

```css
.message-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.message-reaction-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.message-reaction-badge:hover {
  border-color: var(--accent);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.message-reaction-badge:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.message-reaction-badge--active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-contrast, #fff);
}

.message-reaction-count {
  font-weight: 700;
}
```

- [ ] **Step 6: Run MessageBubble tests and commit with Task 4 App wiring**

Run:

```bash
npm run test -- src/components/ChatPanel/MessageBubble.test.tsx
npm run build
```

Expected: `MessageBubble` tests PASS. Build may still fail until `ChatPanelProps` is updated in Task 6; if it fails only for `ChatPanel` prop/type wiring, continue to Task 6 before committing.

Commit after Task 6 build passes:

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx
git commit -m "feat: render chat reaction badges"
```

---

### Task 6: ChatPanel Context Menu Reaction Submenu

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`

- [ ] **Step 1: Add failing ChatPanel context-menu tests**

Append these tests to `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`:

```typescript
describe('ChatPanel reactions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('passes reactions to MessageBubble and toggles from an existing badge', async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();

    renderPanel({
      currentUserMatrixId: '@alice:example.com',
      onToggleReaction,
      messages: [{
        ...baseMessage,
        reactions: { '👍': ['@alice:example.com'] },
      }],
    });

    await user.click(screen.getByRole('button', { name: 'Remove 👍 reaction, 1 reaction' }));

    expect(onToggleReaction).toHaveBeenCalledWith('42', '$own', '👍', true);
  });

  it('shows a React submenu in the message context menu and toggles a selected emoji', async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();

    renderPanel({
      currentUserMatrixId: '@alice:example.com',
      onToggleReaction,
    });

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('hello') });
    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '👍' }));

    expect(onToggleReaction).toHaveBeenCalledWith('42', '$own', '👍', false);
  });
});
```

- [ ] **Step 2: Run ChatPanel tests and verify they fail**

Run:

```bash
npm run test -- src/components/ChatPanel/ChatPanel.test.tsx
```

Expected: FAIL because `currentUserMatrixId`, `onToggleReaction`, and reaction submenu wiring do not exist.

- [ ] **Step 3: Import reaction helpers and context-menu type**

Modify imports in `ChatPanel.tsx`:

```typescript
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';
import { SUPPORTED_REACTIONS, hasReactionFromSender } from '../../utils/chatReactions';
```

- [ ] **Step 4: Add ChatPanel props**

Extend `ChatPanelProps`:

```typescript
  currentUserMatrixId?: string;
  onToggleReaction?: (channelId: string, messageId: string, emoji: string, isCurrentlyReacted: boolean) => Promise<void> | void;
```

Add to the `ChatPanel` destructured props:

```typescript
currentUserMatrixId, onToggleReaction,
```

- [ ] **Step 5: Add a helper for context-menu reaction items**

Inside `ChatPanel`, near the context-menu state, add:

```typescript
  const buildReactionMenuItems = useCallback((messageId: string | undefined): ContextMenuItem[] => {
    if (!channelId || !messageId || !onToggleReaction) return [];
    const message = lookupMessageById(messageId);
    if (!message || message.redacted || message.pending || message.type || messageId.startsWith('temp-')) return [];

    return SUPPORTED_REACTIONS.map((emoji) => {
      const isCurrentlyReacted = hasReactionFromSender(message.reactions, emoji, currentUserMatrixId);
      return {
        type: 'item' as const,
        label: emoji,
        onClick: () => {
          void onToggleReaction(channelId, messageId, emoji, isCurrentlyReacted);
        },
      };
    });
  }, [channelId, currentUserMatrixId, lookupMessageById, onToggleReaction]);
```

- [ ] **Step 6: Pass reaction props to MessageBubble**

In the `MessageBubble` JSX, add:

```tsx
                    reactions={item.message.reactions}
                    currentUserMatrixId={currentUserMatrixId}
                    onReactionToggle={(messageId, emoji, isCurrentlyReacted) => {
                      if (!channelId || !onToggleReaction) return;
                      void onToggleReaction(channelId, messageId, emoji, isCurrentlyReacted);
                    }}
```

- [ ] **Step 7: Add the React submenu to context menu items**

In the `ContextMenu` `items` array, insert this block after the `Reply` item and before delete/DM sections:

```tsx
              ...(buildReactionMenuItems(contextMenu.messageId).length > 0 ? [
                {
                  type: 'item' as const,
                  label: 'React',
                  children: buildReactionMenuItems(contextMenu.messageId),
                },
              ] : []),
```

- [ ] **Step 8: Add optional context-menu reaction styles**

Append to `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` only if the emoji submenu needs tighter hit targets after visual testing:

```css
.context-submenu .context-menu-item {
  justify-content: center;
  min-width: 44px;
}
```

- [ ] **Step 9: Run ChatPanel tests, build, and commit**

Run:

```bash
npm run test -- src/components/ChatPanel/ChatPanel.test.tsx
npm run build
```

Expected: PASS.

Commit:

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.css src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx src/Brmble.Web/src/components/ChatPanel/MessageBubble.css src/Brmble.Web/src/components/ChatPanel/MessageBubble.test.tsx
git commit -m "feat: add chat reaction controls"
```

---

### Task 7: Full Verification And Regression Pass

**Files:**
- No source edits expected unless verification finds issues.

- [ ] **Step 1: Run focused reaction tests**

Run:

```bash
npm run test -- src/utils/chatReactions.test.ts src/hooks/useMatrixClient.test.ts src/components/ChatPanel/MessageBubble.test.tsx src/components/ChatPanel/ChatPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run web build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Manually smoke test in the app**

Run the app in the usual local development flow for this repository. Verify:

```text
1. Right-click a Matrix-backed channel message.
2. Open React submenu.
3. Click 👍.
4. Badge appears under the message as 👍 1 and is highlighted for the current user.
5. Click the badge.
6. Badge disappears if no other users reacted.
7. Switch away and back to the channel.
8. Existing reactions still load from the Matrix timeline.
9. Repeat steps 1-6 in a Matrix DM.
10. Delete/redact a normal message and confirm reaction redaction handling did not break message deletion.
```

- [ ] **Step 4: Commit final verification fixes if needed**

If verification required follow-up fixes:

```bash
git add src/Brmble.Web/src
git commit -m "fix: stabilize chat reactions"
```

Expected: No commit is needed if all prior tasks passed without follow-up edits.

---

## Self-Review

**Spec coverage:** Covered `ChatMessage.reactions`, six predefined emojis, Matrix `m.reaction` processing, redaction removal, initial timeline aggregation, send/remove actions, context-menu submenu, badge display, badge toggle, and no backend changes.

**Placeholder scan:** No banned placeholder language or unspecified edge-case instructions remain. Optional CSS is explicitly conditional on visual test outcome and includes exact CSS if needed.

**Type consistency:** Reaction callbacks use `(targetId/channelId, messageId, emoji, isCurrentlyReacted)` consistently from `MessageBubble` through `ChatPanel` to `App`, then map to `sendReaction`/`removeReaction` in `useMatrixClient`.
