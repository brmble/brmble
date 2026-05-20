# Matrix Typing Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Matrix typing indicators for channel chat and Matrix DMs, showing only remote users in the active room with accessible named status text.

**Architecture:** Keep all Matrix protocol behavior inside `useMatrixClient.ts`. `MessageInput.tsx` emits local draft activity, `ChatPanel.tsx` and `App.tsx` forward the active room signal, and `useMatrixClient.ts` owns outgoing typing sends, incoming typing state, timeout refresh, and display-name resolution. The UI reads a derived typing string for the active room and renders it in a polite live region.

**Tech Stack:** React + TypeScript + Vite, matrix-js-sdk, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-20-matrix-typing-indicators-design.md`

---

## File map

| File | Change kind | Responsibility |
|---|---|---|
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Modify | Own local typing sends, remote typing state, timer cleanup, display formatting, and public room-scoped typing selectors. |
| `src/Brmble.Web/src/hooks/useMatrixClient.test.ts` | Modify | Cover typing send/stop behavior, timeout refresh, self-filtering, and formatting. |
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` | Modify | Emit draft-activity changes only from active input edits and send-stop on clear/send/unmount. |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` | Modify | Pass typing callbacks to the input and render the active-room typing indicator. |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` | Modify | Style the typing indicator row near the composer. |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx` | Create | Verify visible indicator text and `role="status"` behavior. |
| `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx` | Create | Verify draft transitions emit start/stop typing events. |
| `src/Brmble.Web/src/App.tsx` | Modify | Forward active Matrix room typing updates between `ChatPanel` and `useMatrixClient`. |

---

## Task 1: Add Matrix typing state and protocol handling to `useMatrixClient`

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`

- [ ] **Step 1: Add failing tests for typing send, stop, and formatter behavior**

In `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`, extend the SDK mock to include typing helpers:

```ts
const mockClient = {
  startClient: vi.fn(),
  stopClient: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  getRoom: vi.fn(),
  getRooms: vi.fn().mockReturnValue([]),
  getAccountData: vi.fn(),
  setAccountData: vi.fn().mockResolvedValue(undefined),
  createRoom: vi.fn().mockResolvedValue({ room_id: '!new:example.com' }),
  scrollback: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue({}),
  sendTyping: vi.fn().mockResolvedValue(undefined),
  mxcUrlToHttp: vi.fn((url: string) => url.replace('mxc://', 'https://matrix.example.com/_matrix/media/v3/download/')),
};
```

Then add these tests near the end of the file:

```ts
  it('sends typing true with a 30000ms timeout when active Matrix drafting starts', async () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    await act(async () => {
      await result.current.setRoomTyping('!room:example.com', true);
    });

    expect(mockClient.sendTyping).toHaveBeenCalledWith('!room:example.com', true, 30000);
  });

  it('sends typing false when active Matrix drafting stops', async () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    await act(async () => {
      await result.current.setRoomTyping('!room:example.com', true);
      await result.current.setRoomTyping('!room:example.com', false);
    });

    expect(mockClient.sendTyping).toHaveBeenNthCalledWith(1, '!room:example.com', true, 30000);
    expect(mockClient.sendTyping).toHaveBeenNthCalledWith(2, '!room:example.com', false, 0);
  });

  it('formats typing users for one, two, and many names', () => {
    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });

    expect(result.current.formatTypingLabel([{ matrixUserId: '@a:test', displayName: 'Alice' }])).toBe('Alice is typing...');
    expect(result.current.formatTypingLabel([
      { matrixUserId: '@a:test', displayName: 'Alice' },
      { matrixUserId: '@b:test', displayName: 'Bob' },
    ])).toBe('Alice and Bob are typing...');
    expect(result.current.formatTypingLabel([
      { matrixUserId: '@a:test', displayName: 'Alice' },
      { matrixUserId: '@b:test', displayName: 'Bob' },
      { matrixUserId: '@c:test', displayName: 'Cara' },
    ])).toBe('Alice, Bob, and others are typing...');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npm test -- src/hooks/useMatrixClient.test.ts --run)`
Expected: FAIL with `sendTyping is not a function` or missing `setRoomTyping` / `formatTypingLabel` in the hook return value.

- [ ] **Step 3: Implement room-scoped typing state, formatter, and timer cleanup**

In `src/Brmble.Web/src/hooks/useMatrixClient.ts`, add these constants and types near the existing hook-level helpers:

```ts
const TYPING_TIMEOUT_MS = 30_000;
const TYPING_REFRESH_MS = 20_000;

export type TypingUser = {
  matrixUserId: string;
  displayName: string;
};

function formatTypingLabel(users: TypingUser[]): string {
  if (users.length === 0) return '';
  if (users.length === 1) return `${users[0].displayName} is typing...`;
  if (users.length === 2) return `${users[0].displayName} and ${users[1].displayName} are typing...`;
  return `${users[0].displayName}, ${users[1].displayName}, and others are typing...`;
}
```

Inside the hook body, add room-scoped state and timer refs:

```ts
  const [typingByRoom, setTypingByRoom] = useState<Map<string, TypingUser[]>>(new Map());
  const localTypingRoomRef = useRef<string | null>(null);
  const typingRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTypingRefreshTimer = useCallback(() => {
    if (typingRefreshTimerRef.current) {
      clearTimeout(typingRefreshTimerRef.current);
      typingRefreshTimerRef.current = null;
    }
  }, []);
```

Add helpers for name resolution and sending:

```ts
  const resolveTypingDisplayName = useCallback((roomId: string, matrixUserId: string): string => {
    const room = clientRef.current?.getRoom(roomId);
    const member = room?.getMember(matrixUserId);
    return member?.rawDisplayName || member?.name || matrixUserId;
  }, []);

  const setRoomTyping = useCallback(async (roomId: string | null | undefined, isTyping: boolean) => {
    if (!clientRef.current || !roomId) return;

    if (!isTyping) {
      clearTypingRefreshTimer();
      localTypingRoomRef.current = null;
      await clientRef.current.sendTyping(roomId, false, 0);
      return;
    }

    localTypingRoomRef.current = roomId;
    await clientRef.current.sendTyping(roomId, true, TYPING_TIMEOUT_MS);
    clearTypingRefreshTimer();
    typingRefreshTimerRef.current = setTimeout(() => {
      if (localTypingRoomRef.current === roomId) {
        void setRoomTyping(roomId, true);
      }
    }, TYPING_REFRESH_MS);
  }, [clearTypingRefreshTimer]);
```

Expose selectors in the return object:

```ts
    setRoomTyping,
    getTypingUsers: (roomId: string | null | undefined) => roomId ? (typingByRoom.get(roomId) ?? []) : [],
    formatTypingLabel,
```

Also clear typing state anywhere the hook currently tears the Matrix client down:

```ts
      clearTypingRefreshTimer();
      localTypingRoomRef.current = null;
      setTypingByRoom(new Map());
```

- [ ] **Step 4: Wire incoming remote typing events and self-filtering**

Still in `src/Brmble.Web/src/hooks/useMatrixClient.ts`, register a room-member typing listener next to the other Matrix event listeners:

```ts
    const onTyping = (_event: MatrixEvent, member: RoomMember) => {
      const roomId = member.roomId;
      const room = clientRef.current?.getRoom(roomId);
      if (!room || !credentials) return;

      const nextUsers = room
        .getTypingMembers()
        .filter(m => m.userId !== credentials.userId)
        .map(m => ({
          matrixUserId: m.userId,
          displayName: m.rawDisplayName || m.name || m.userId,
        }));

      setTypingByRoom(prev => {
        const next = new Map(prev);
        if (nextUsers.length === 0) next.delete(roomId);
        else next.set(roomId, nextUsers);
        return next;
      });
    };

    client.on(RoomMemberEvent.Typing, onTyping);
```

And clean it up with the other `off(...)` calls:

```ts
      client.off(RoomMemberEvent.Typing, onTyping);
```

Update the SDK mock import in the test file to include `RoomMemberEvent`:

```ts
  RoomMemberEvent: { Typing: 'RoomMember.typing' },
```

Add a self-filter test:

```ts
  it('filters the current user out of remote typing members', () => {
    const room = {
      getTypingMembers: () => [
        { userId: '@1:example.com', name: 'Me', rawDisplayName: 'Me' },
        { userId: '@alice:example.com', name: 'Alice', rawDisplayName: 'Alice' },
      ],
    };
    mockClient.getRoom.mockReturnValue(room);

    const { result } = renderHook(() => useMatrixClient(creds), { wrapper });
    const onTyping = mockClient.on.mock.calls.find((c: unknown[]) => c[0] === 'RoomMember.typing')?.[1] as
      | ((ev: unknown, member: { roomId: string }) => void)
      | undefined;

    act(() => onTyping?.({} as never, { roomId: '!room:example.com' } as never));

    expect(result.current.getTypingUsers('!room:example.com')).toEqual([
      { matrixUserId: '@alice:example.com', displayName: 'Alice' },
    ]);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- src/hooks/useMatrixClient.test.ts --run)`
Expected: PASS for existing hook behavior plus the new typing tests.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/hooks/useMatrixClient.test.ts
git commit -m "feat(matrix): add room-scoped typing state"
```

---

## Task 2: Emit local draft activity from `MessageInput` and wire it through `ChatPanel` and `App`

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`
- Create: `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx`
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add failing composer tests for start/stop transitions**

Create `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';

describe('MessageInput typing callbacks', () => {
  it('emits start typing when the draft becomes non-empty', () => {
    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'h' } });

    expect(onTypingChange).toHaveBeenCalledWith(true);
  });

  it('emits stop typing when the draft is cleared after typing', () => {
    const onTypingChange = vi.fn();
    render(<MessageInput onSend={vi.fn()} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.change(input, { target: { value: '' } });

    expect(onTypingChange).toHaveBeenNthCalledWith(1, true);
    expect(onTypingChange).toHaveBeenNthCalledWith(2, false);
  });

  it('emits stop typing when send succeeds', () => {
    const onTypingChange = vi.fn();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} onTypingChange={onTypingChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('hello', undefined);
    expect(onTypingChange).toHaveBeenLastCalledWith(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npm test -- src/components/ChatPanel/MessageInput.test.tsx --run)`
Expected: FAIL because `onTypingChange` does not exist yet on `MessageInputProps`.

- [ ] **Step 3: Implement composer-level typing transitions**

In `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`, extend props:

```ts
interface MessageInputProps {
  onSend: (content: string, image?: File) => void;
  onTypingChange?: (isTyping: boolean) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
  disabled?: boolean;
  replyState?: {
    eventId: string;
    sender: string;
    senderMatrixUserId?: string;
    content: string;
    html?: string;
    msgType: string;
  } | null;
  onClearReply?: () => void;
  matrixClient?: MatrixClient | null;
  matrixRoomId?: string | null;
}
```

Track last-emitted typing state and emit only on transitions:

```ts
  const typingStateRef = useRef(false);

  const emitTypingChange = useCallback((nextIsTyping: boolean) => {
    if (typingStateRef.current === nextIsTyping) return;
    typingStateRef.current = nextIsTyping;
    onTypingChange?.(nextIsTyping);
  }, [onTypingChange]);
```

Call it from `handleChange` based on draft content:

```ts
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    emitTypingChange(value.trim().length > 0);
    updateMentionState(value, e.target.selectionStart ?? value.length);
  }, [emitTypingChange, updateMentionState]);
```

Call stop-typing on successful send and unmount:

```ts
      setMessage('');
      emitTypingChange(false);
      setMentionActive(false);
```

```ts
  useEffect(() => {
    return () => {
      if (typingStateRef.current) {
        onTypingChange?.(false);
      }
    };
  }, [onTypingChange]);
```

- [ ] **Step 4: Pass typing callbacks through `ChatPanel` and `App`**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`, extend props:

```ts
  onTypingChange?: (matrixRoomId: string | null, isTyping: boolean) => void;
  typingLabel?: string;
```

Render the indicator above the composer:

```tsx
      {matrixRoomId && (
        <div className="chat-typing-indicator" role="status" aria-atomic="true">
          {typingLabel || ''}
        </div>
      )}
      <MessageInput
        onSend={onSendMessage}
        placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`}
        mentionableUsers={mentionableUsers}
        disabled={disabled}
        replyState={replyState}
        onClearReply={() => setReplyState(null)}
        matrixClient={matrixClient}
        matrixRoomId={matrixRoomId}
        onTypingChange={(isTyping) => onTypingChange?.(matrixRoomId ?? null, isTyping)}
      />
```

In `src/Brmble.Web/src/App.tsx`, derive and forward the active typing label:

```ts
  const activeTypingLabel = useMemo(() => {
    if (!activeMatrixRoomId) return '';
    return matrixClient.formatTypingLabel(matrixClient.getTypingUsers(activeMatrixRoomId));
  }, [activeMatrixRoomId, matrixClient]);

  const handleMatrixTypingChange = useCallback((roomId: string | null, isTyping: boolean) => {
    void matrixClient.setRoomTyping(roomId, isTyping).catch(console.error);
  }, [matrixClient]);
```

Pass both into each `ChatPanel` usage:

```tsx
                    onTypingChange={handleMatrixTypingChange}
                    typingLabel={activeTypingLabel}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- src/components/ChatPanel/MessageInput.test.tsx --run)`
Expected: PASS for start/stop/send transitions.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat(chat): wire local typing activity to matrix rooms"
```

---

## Task 3: Render and style the active-room typing indicator accessibly

**Files:**
- Modify: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`
- Create: `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`

- [ ] **Step 1: Add a failing UI test for visible indicator text and live-region markup**

Create `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx` with:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

describe('ChatPanel typing indicator', () => {
  it('renders the active typing label in a polite status region', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="General"
        messages={[]}
        currentUsername="Me"
        onSendMessage={vi.fn()}
        matrixRoomId="!room:example.com"
        typingLabel="Alice is typing..."
      />
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Alice is typing...');
  });

  it('renders an empty status region when nobody is typing', () => {
    render(
      <ChatPanel
        channelId="42"
        channelName="General"
        messages={[]}
        currentUsername="Me"
        onSendMessage={vi.fn()}
        matrixRoomId="!room:example.com"
        typingLabel=""
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd src/Brmble.Web && npm test -- src/components/ChatPanel/ChatPanel.test.tsx --run)`
Expected: FAIL because `typingLabel` is not rendered and no `role="status"` exists.

- [ ] **Step 3: Add minimal styles for the indicator row**

In `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css`, add:

```css
.chat-typing-indicator {
  min-height: 1.25rem;
  padding: 0.125rem 0.25rem 0;
  color: var(--text-secondary, rgba(255, 255, 255, 0.72));
  font-size: 0.875rem;
  line-height: 1.25rem;
}
```

If the component layout needs the indicator to sit directly above the input wrapper, keep it inside the existing bottom composer region instead of creating a new top-level bar.

- [ ] **Step 4: Run UI tests to verify they pass**

Run: `(cd src/Brmble.Web && npm test -- src/components/ChatPanel/ChatPanel.test.tsx --run)`
Expected: PASS and the indicator remains present as an empty live region when nobody is typing.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/ChatPanel/ChatPanel.css src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx
git commit -m "feat(chat): add accessible matrix typing indicator UI"
```

---

## Task 4: Final verification and cleanup

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useMatrixClient.ts` (only if verification reveals cleanup gaps)
- Modify: `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx` (only if verification reveals cleanup gaps)

- [ ] **Step 1: Run the focused frontend test set**

Run:

```bash
cd src/Brmble.Web
npm test -- src/hooks/useMatrixClient.test.ts --run
npm test -- src/components/ChatPanel/MessageInput.test.tsx --run
npm test -- src/components/ChatPanel/ChatPanel.test.tsx --run
```

Expected: PASS for all three files.

- [ ] **Step 2: Run the existing chat panel regression tests if present**

Run:

```bash
cd src/Brmble.Web
npm test -- src/components/ChatPanel --run
```

Expected: PASS, or a narrowly scoped failure that clearly points to a typing-indicator regression.

- [ ] **Step 3: Manual verification checklist**

Verify in a local Brmble session:

```text
1. Open a Matrix-backed channel on two clients.
2. Type on client A and confirm client B shows "Alice is typing..."
3. Stop typing and confirm the indicator clears.
4. Repeat in a Matrix DM.
5. Switch rooms mid-typing and confirm the old room does not keep the indicator.
6. Disconnect chat mid-typing and confirm the UI clears without blocking message send later.
7. Use a screen reader or accessibility inspector to confirm the indicator is exposed as role="status".
```

- [ ] **Step 4: Commit any final cleanup**

```bash
git add src/Brmble.Web/src/hooks/useMatrixClient.ts src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx src/Brmble.Web/src/components/ChatPanel/ChatPanel.css
git commit -m "test(chat): verify matrix typing indicator behavior"
```
