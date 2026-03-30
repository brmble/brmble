# Server/Root Chat Lag Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate server-root chat lag by adding message classification, ephemeral purging on disconnect, a hard cap of 200 messages, and debounced localStorage writes.

**Architecture:** The `server-root` channel stores messages in localStorage via `useChatStore`. We add a `systemType` field to classify messages as ephemeral or persistent, purge ephemeral messages on disconnect, enforce a 200-message cap, and debounce localStorage writes with a 500ms window. All changes are scoped to `server-root` only.

**Tech Stack:** React, TypeScript, Vitest, `@testing-library/react`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/types/index.ts` | Modify (line 42-54) | Add `systemType` to `ChatMessage` interface |
| `src/Brmble.Web/src/hooks/useChatStore.ts` | Modify (all) | Debounce, cap, purge, `systemType` propagation |
| `src/Brmble.Web/src/App.tsx` | Modify (lines 785-795, 664-707) | Pass `systemType`, call purge on disconnect |
| `src/Brmble.Web/src/hooks/useChatStore.test.ts` | Create | Tests for cap, purge, debounce |

---

### Task 1: Add `systemType` to `ChatMessage` Interface

**Files:**
- Modify: `src/Brmble.Web/src/types/index.ts:42-54`

- [ ] **Step 1: Add the field**

In `src/Brmble.Web/src/types/index.ts`, add `systemType` to the `ChatMessage` interface. Insert after the `type` field (line 49):

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
}
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No new errors (adding an optional field is backward-compatible).

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/types/index.ts
git commit -m "feat: add systemType field to ChatMessage interface"
```

---

### Task 2: Update `useChatStore` — Add `systemType` to Write Functions, Cap, and Purge

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useChatStore.ts`
- Create: `src/Brmble.Web/src/hooks/useChatStore.test.ts`

- [ ] **Step 1: Write tests for the new behavior**

Create `src/Brmble.Web/src/hooks/useChatStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatStore, addMessageToStore, purgeEphemeralMessages, flushPendingWrites } from './useChatStore';

const STORAGE_KEY = 'brmble_chat_server-root';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useChatStore systemType', () => {
  it('stores systemType on messages added via addMessage', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'Alice connected', 'system', false, undefined, 'userJoined');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].systemType).toBe('userJoined');
  });

  it('stores systemType via addMessageToStore', () => {
    addMessageToStore('server-root', 'Server', 'Bob left', 'system', false, undefined, 'userLeft');

    // Flush debounce
    vi.advanceTimersByTime(600);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].systemType).toBe('userLeft');
  });
});

describe('useChatStore hard cap (server-root)', () => {
  it('trims oldest messages when exceeding 200 via addMessage', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.addMessage('Server', `msg-${i}`, 'system', false, undefined, 'userJoined');
      }
    });

    expect(result.current.messages).toHaveLength(200);
    // Oldest messages trimmed — first message should be msg-10
    expect(result.current.messages[0].content).toBe('msg-10');
    expect(result.current.messages[199].content).toBe('msg-209');
  });

  it('does NOT cap non-server-root channels', () => {
    const { result } = renderHook(() => useChatStore('channel-5'));

    act(() => {
      for (let i = 0; i < 210; i++) {
        result.current.addMessage('User', `msg-${i}`);
      }
    });

    expect(result.current.messages).toHaveLength(210);
  });

  it('trims oldest messages when exceeding 200 via addMessageToStore', () => {
    // Pre-fill with 195 messages
    const existing = Array.from({ length: 195 }, (_, i) => ({
      id: `id-${i}`,
      channelId: 'server-root',
      sender: 'Server',
      content: `old-${i}`,
      timestamp: new Date().toISOString(),
      type: 'system',
      systemType: 'userJoined',
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

    // Add 10 more (total 205 > 200)
    for (let i = 0; i < 10; i++) {
      addMessageToStore('server-root', 'Server', `new-${i}`, 'system', false, undefined, 'userLeft');
    }

    // Flush debounce
    vi.advanceTimersByTime(600);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(200);
    // Oldest should have been trimmed
    expect(stored[0].content).toBe('old-5');
  });
});

describe('purgeEphemeralMessages', () => {
  it('removes ephemeral messages and keeps persistent ones', () => {
    const messages = [
      { id: '1', channelId: 'server-root', sender: 'Server', content: 'Connecting...', timestamp: new Date().toISOString(), type: 'system', systemType: 'connecting' },
      { id: '2', channelId: 'server-root', sender: 'Server', content: 'Welcome!', timestamp: new Date().toISOString(), type: 'system', systemType: 'welcome' },
      { id: '3', channelId: 'server-root', sender: 'Server', content: 'Alice joined', timestamp: new Date().toISOString(), type: 'system', systemType: 'userJoined' },
      { id: '4', channelId: 'server-root', sender: 'Server', content: 'You were kicked', timestamp: new Date().toISOString(), type: 'system', systemType: 'kicked' },
      { id: '5', channelId: 'server-root', sender: 'User', content: 'Hello', timestamp: new Date().toISOString() },
      { id: '6', channelId: 'server-root', sender: 'Server', content: 'Bob left', timestamp: new Date().toISOString(), type: 'system', systemType: 'userLeft' },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));

    purgeEphemeralMessages('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
    expect(stored[0].content).toBe('You were kicked');
    expect(stored[1].content).toBe('Hello');
  });

  it('handles empty localStorage gracefully', () => {
    purgeEphemeralMessages('server-root');
    // Should not throw
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('flushes debounce buffer before purging', () => {
    // Add a message via background store (debounced)
    addMessageToStore('server-root', 'Server', 'Alice joined', 'system', false, undefined, 'userJoined');
    // Also add a persistent message
    addMessageToStore('server-root', 'Server', 'You were banned', 'system', false, undefined, 'banned');

    // Don't advance timers — buffer is not flushed yet
    // Purge should flush first, then purge ephemeral
    purgeEphemeralMessages('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('You were banned');
  });
});

describe('debounced localStorage writes', () => {
  it('does not write to localStorage immediately for server-root', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'test msg', 'system', false, undefined, 'userJoined');
    });

    // React state updated immediately
    expect(result.current.messages).toHaveLength(1);

    // localStorage not yet written (debounce pending)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Should not contain the new message yet
      expect(parsed.find((m: { content: string }) => m.content === 'test msg')).toBeUndefined();
    }
  });

  it('writes to localStorage after debounce period', () => {
    const { result } = renderHook(() => useChatStore('server-root'));

    act(() => {
      result.current.addMessage('Server', 'test msg', 'system', false, undefined, 'userJoined');
    });

    act(() => {
      vi.advanceTimersByTime(600);
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('test msg');
  });

  it('writes immediately for non-server-root channels', () => {
    const { result } = renderHook(() => useChatStore('channel-5'));

    act(() => {
      result.current.addMessage('User', 'hello');
    });

    const stored = JSON.parse(localStorage.getItem('brmble_chat_channel-5')!);
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('hello');
  });

  it('flushPendingWrites forces immediate write', () => {
    addMessageToStore('server-root', 'Server', 'msg1', 'system', false, undefined, 'userJoined');
    addMessageToStore('server-root', 'Server', 'msg2', 'system', false, undefined, 'userLeft');

    // Not flushed yet
    flushPendingWrites('server-root');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/useChatStore.test.ts` from `src/Brmble.Web/`
Expected: FAIL — `purgeEphemeralMessages` and `flushPendingWrites` don't exist yet, `addMessage` doesn't accept `systemType`.

- [ ] **Step 3: Implement the updated `useChatStore.ts`**

Replace the contents of `src/Brmble.Web/src/hooks/useChatStore.ts` with:

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage, MediaAttachment } from '../types';

const STORAGE_KEY_PREFIX = 'brmble_chat_';
const SERVER_ROOT_KEY = 'server-root';
const SERVER_ROOT_MAX_MESSAGES = 200;
const DEBOUNCE_MS = 500;

const EPHEMERAL_TYPES = new Set(['connecting', 'welcome', 'userJoined', 'userLeft']);

// --- Debounce infrastructure for server-root background writes ---

let bgBuffer: ChatMessage[] = [];
let bgTimer: ReturnType<typeof setTimeout> | null = null;

function flushBgBuffer() {
  if (bgTimer !== null) {
    clearTimeout(bgTimer);
    bgTimer = null;
  }
  if (bgBuffer.length === 0) return;

  const fullKey = `${STORAGE_KEY_PREFIX}${SERVER_ROOT_KEY}`;
  let messages: ChatMessage[] = [];
  const stored = localStorage.getItem(fullKey);
  if (stored) {
    try {
      messages = JSON.parse(stored);
    } catch {
      messages = [];
    }
  }

  messages.push(...bgBuffer);
  bgBuffer = [];

  if (messages.length > SERVER_ROOT_MAX_MESSAGES) {
    messages = messages.slice(messages.length - SERVER_ROOT_MAX_MESSAGES);
  }

  localStorage.setItem(fullKey, JSON.stringify(messages));
}

/**
 * Flush any pending debounced writes for a given channel.
 * Currently only server-root has debounced writes.
 */
export function flushPendingWrites(channelId: string) {
  if (channelId === SERVER_ROOT_KEY) {
    flushBgBuffer();
  }
}

/**
 * Purge ephemeral messages (connecting, welcome, userJoined, userLeft)
 * from localStorage for the given channel. Flushes the debounce buffer first.
 */
export function purgeEphemeralMessages(channelId: string) {
  flushPendingWrites(channelId);

  const fullKey = `${STORAGE_KEY_PREFIX}${channelId}`;
  const stored = localStorage.getItem(fullKey);
  if (!stored) return;

  let messages: ChatMessage[];
  try {
    messages = JSON.parse(stored);
  } catch {
    return;
  }

  const filtered = messages.filter(
    (m) => !m.systemType || !EPHEMERAL_TYPES.has(m.systemType)
  );

  if (filtered.length === 0) {
    localStorage.removeItem(fullKey);
  } else {
    localStorage.setItem(fullKey, JSON.stringify(filtered));
  }
}

// --- Hook-based debounce timer for server-root ---

let hookTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(fullKey: string, msgs: ChatMessage[]) {
  if (hookTimer !== null) {
    clearTimeout(hookTimer);
  }
  hookTimer = setTimeout(() => {
    hookTimer = null;
    localStorage.setItem(fullKey, JSON.stringify(msgs));
  }, DEBOUNCE_MS);
}

export function useChatStore(channelId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const isServerRoot = channelId === SERVER_ROOT_KEY;

  useEffect(() => {
    // On mount / channel switch, flush any pending server-root writes
    // so we read the latest data.
    if (isServerRoot) {
      flushBgBuffer();
      if (hookTimer !== null) {
        clearTimeout(hookTimer);
        hookTimer = null;
      }
    }

    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${channelId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setMessages(parsed.map((m: ChatMessage) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })));
      } catch {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
  }, [channelId, isServerRoot]);

  const saveMessages = useCallback((msgs: ChatMessage[]) => {
    const fullKey = `${STORAGE_KEY_PREFIX}${channelId}`;
    if (isServerRoot) {
      debouncedSave(fullKey, msgs);
    } else {
      localStorage.setItem(fullKey, JSON.stringify(msgs));
    }
  }, [channelId, isServerRoot]);

  const addMessage = useCallback((
    sender: string,
    content: string,
    type?: 'system',
    html?: boolean,
    media?: MediaAttachment[],
    systemType?: string,
  ) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date(),
      ...(type && { type }),
      ...(systemType && { systemType }),
      ...(html && { html }),
      ...(media && media.length > 0 && { media }),
    };
    setMessages(prev => {
      let updated = [...prev, newMessage];
      if (isServerRoot && updated.length > SERVER_ROOT_MAX_MESSAGES) {
        updated = updated.slice(updated.length - SERVER_ROOT_MAX_MESSAGES);
      }
      saveMessages(updated);
      return updated;
    });
  }, [channelId, isServerRoot, saveMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${channelId}`);
  }, [channelId]);

  return { messages, addMessage, clearMessages };
}

/**
 * Write a message directly to a specific store key in localStorage,
 * bypassing React state. Used for background message storage when
 * the user is viewing a different chat panel.
 *
 * For server-root, writes are debounced. For other channels, writes are immediate.
 */
export function addMessageToStore(
  storeKey: string,
  sender: string,
  content: string,
  type?: 'system',
  html?: boolean,
  media?: MediaAttachment[],
  systemType?: string,
) {
  const newMessage: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: storeKey,
    sender,
    content,
    timestamp: new Date(),
    ...(type && { type }),
    ...(systemType && { systemType }),
    ...(html && { html }),
    ...(media && media.length > 0 && { media }),
  };

  if (storeKey === SERVER_ROOT_KEY) {
    bgBuffer.push(newMessage);
    if (bgTimer !== null) {
      clearTimeout(bgTimer);
    }
    bgTimer = setTimeout(flushBgBuffer, DEBOUNCE_MS);
    return;
  }

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
  localStorage.setItem(fullKey, JSON.stringify(messages));
}

/** Clear all chat messages from localStorage.
 *  Preserves server-root messages since those are current-session system messages. */
export function clearChatStorage() {
  const serverRootKey = `${STORAGE_KEY_PREFIX}${SERVER_ROOT_KEY}`;
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_KEY_PREFIX) && k !== serverRootKey)
    .forEach(k => localStorage.removeItem(k));
}

export function useAllChats() {
  const getAllChannelIds = useCallback(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_KEY_PREFIX));
    return keys.map(k => k.replace(STORAGE_KEY_PREFIX, ''));
  }, []);

  const clearAllChats = useCallback(() => {
    getAllChannelIds().forEach(channelId => {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${channelId}`);
    });
  }, [getAllChannelIds]);

  return { getAllChannelIds, clearAllChats };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/useChatStore.test.ts` from `src/Brmble.Web/`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/hooks/useChatStore.ts src/Brmble.Web/src/hooks/useChatStore.test.ts
git commit -m "feat: add systemType, hard cap, debounce, and purge to useChatStore"
```

---

### Task 3: Update App.tsx — Pass `systemType` and Call Purge on Disconnect

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:28,785-795,664-707`

- [ ] **Step 1: Update the import**

In `src/Brmble.Web/src/App.tsx`, update the import on line 28 to include `purgeEphemeralMessages`:

Change:
```typescript
import { useChatStore, addMessageToStore, clearChatStorage } from './hooks/useChatStore';
```

To:
```typescript
import { useChatStore, addMessageToStore, clearChatStorage, purgeEphemeralMessages } from './hooks/useChatStore';
```

- [ ] **Step 2: Pass `systemType` through in `onVoiceSystem`**

In `src/Brmble.Web/src/App.tsx`, update the `onVoiceSystem` handler (lines 785-795). The current code:

```typescript
    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html);
        }
      }
    });
```

Change to:

```typescript
    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html, undefined, d.systemType);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html, undefined, d.systemType);
        }
      }
    });
```

- [ ] **Step 3: Call `purgeEphemeralMessages` on disconnect**

In `src/Brmble.Web/src/App.tsx`, in the `onVoiceDisconnected` handler (line 664), add the purge call right after `clearPendingAction()` on line 665. Change:

```typescript
    const onVoiceDisconnected = (data: unknown) => {
      clearPendingAction();
      const d = data as { reconnectAvailable?: boolean } | null;
```

To:

```typescript
    const onVoiceDisconnected = (data: unknown) => {
      clearPendingAction();
      purgeEphemeralMessages('server-root');
      const d = data as { reconnectAvailable?: boolean } | null;
```

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No new errors.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run` from `src/Brmble.Web/`
Expected: All tests PASS (both new and existing).

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: pass systemType to chat store and purge ephemeral messages on disconnect"
```

---

### Task 4: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run` from `src/Brmble.Web/`
Expected: All tests PASS.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit` from `src/Brmble.Web/`
Expected: No errors.

- [ ] **Step 3: Build the frontend**

Run: `npm run build` from `src/Brmble.Web/`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Verify localStorage behavior manually (if dev server available)**

1. Start the dev server and connect to a Mumble server.
2. Open DevTools > Application > Local Storage > `brmble_chat_server-root`.
3. Verify messages have `systemType` field.
4. Verify the array stays at or below 200 entries.
5. Disconnect and verify ephemeral messages are removed.
6. Verify kick/ban messages (if applicable) survive disconnect.
