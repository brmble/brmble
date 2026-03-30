# Server/Root Chat Lag Fix

**Issue:** #297
**Branch:** `fix/server-root-chat-lag`
**Date:** 2026-03-30

## Problem

The `server-root` chat experiences significant lag from two sources:

1. **On tab switch:** Deserializing the entire message history from localStorage and rendering all DOM nodes at once.
2. **During active use:** Every new message triggers `JSON.stringify` of the entire message array back to localStorage, plus a full React re-render of the message list.

The root cause is that `server-root` messages are stored in localStorage via `useChatStore` with no cap, no cleanup, and no write batching. High-frequency events (`userJoined`, `userLeft`) accumulate indefinitely across sessions.

## Scope

This fix targets the data/storage layer only. Virtual scrolling and DOM optimization are out of scope and can be assessed separately after this fix lands.

Only the `server-root` channel is affected. Matrix-backed channels use `useMatrixClient` with bounded sync limits and are not part of this change.

## Architecture Context

### Current Flow

Messages arrive via the C# bridge as `voice.system` events. The backend (`MumbleAdapter.cs`) sends a `systemType` field with each event, but the frontend ignores it. All messages are stored in localStorage under key `brmble_chat_server-root` as a single JSON array. There is no cap, no expiry, and no cleanup on disconnect.

### Message Types

| systemType | Example | Frequency | Classification |
|---|---|---|---|
| `connecting` | "Connecting to host:port..." | Once per connect | Ephemeral |
| `welcome` | Server MOTD (HTML) | Once per connect | Ephemeral |
| `userJoined` | "Alice connected to the server" | High on busy servers | Ephemeral |
| `userLeft` | "Bob disconnected from the server" | High on busy servers | Ephemeral |
| `banned` | "You were banned by Admin: reason" | Rare | Persistent |
| `kicked` | "You were kicked by Admin: reason" | Rare | Persistent |
| (none) | User-typed text messages | Variable | Persistent |

Ephemeral messages are re-generated each session and have no value after disconnect. Persistent messages contain information the user may need to reference later.

## Design

### 1. Message Classification

Add an optional `systemType?: string` field to the `ChatMessage` interface in `types/index.ts`.

Propagate the `systemType` from the `voice.system` bridge event through:
- The `onVoiceSystem` handler in `App.tsx` (lines 785-795)
- `addMessage()` in `useChatStore.ts`
- `addMessageToStore()` in `useChatStore.ts`

The ephemeral set is: `connecting`, `welcome`, `userJoined`, `userLeft`.
Everything else (including messages with no `systemType`) is persistent.

### 2. Purge Ephemeral Messages on Disconnect

Add a `purgeEphemeralMessages(channelId: string)` function to `useChatStore.ts` (module-level, not inside the hook):
1. Flush the debounce buffer for the channel (see section 4).
2. Read the stored messages from localStorage for the given channel.
3. Filter out messages where `systemType` is in the ephemeral set.
4. Write the filtered array back to localStorage.

React state does not need updating here -- the purge runs on disconnect, and server-root messages are re-loaded from localStorage on the next `useChatStore('server-root')` mount when the user reconnects.

Call `purgeEphemeralMessages('server-root')` from the `onVoiceDisconnected` handler in `App.tsx` (line 664). This is the primary disconnect handler that fires in all disconnect scenarios.

The debounce buffer (see section 4) must be flushed before purging to avoid stale data.

### 3. Hard Cap (200 Messages, Server-Root Only)

Add a `SERVER_ROOT_MAX_MESSAGES = 200` constant to `useChatStore.ts`.

Enforce the cap in both write paths:
- `addMessage()` — after appending, if `channelId === 'server-root'` and length exceeds cap, slice from the end (keep newest).
- `addMessageToStore()` — same logic when `storeKey === 'server-root'`.

Trimming is type-agnostic: oldest messages are dropped first regardless of classification. 200 is generous enough that persistent kick/ban messages won't be pushed out under normal use.

### 4. Debounced localStorage Writes (Server-Root Only)

Replace immediate `localStorage.setItem` calls with a debounced write for `server-root`:

**React state path (`addMessage`):**
- Messages are added to React state immediately (UI updates instantly).
- The `saveMessages` localStorage write is debounced with a 500ms delay.
- If another message arrives within the window, the timer resets.
- Only one write happens with the latest state after the burst settles.

**Background path (`addMessageToStore`):**
- Messages accumulate in a module-level in-memory buffer.
- A 500ms debounce timer flushes the buffer to localStorage.
- On flush: read current localStorage, merge buffered messages, enforce cap, write back.

**Disconnect safety:**
- `purgeEphemeralMessages` flushes the debounce buffer before reading localStorage.
- Any unflushed messages during disconnect are ephemeral join/leave events that would be purged anyway.

Non-server-root channels continue with immediate writes (their volume doesn't warrant debouncing).

## Files Changed

| File | Changes |
|---|---|
| `src/Brmble.Web/src/types/index.ts` | Add `systemType?: string` to `ChatMessage` |
| `src/Brmble.Web/src/hooks/useChatStore.ts` | Debounce logic, cap enforcement, `purgeEphemeralMessages()`, propagate `systemType` through `addMessage` and `addMessageToStore` |
| `src/Brmble.Web/src/App.tsx` | Pass `systemType` from bridge event, call `purgeEphemeralMessages` on disconnect |

## Not in Scope

- Virtual scrolling / DOM virtualization for ChatPanel
- Join/leave message collapsing ("5 users connected")
- Consolidating the scattered disconnect cleanup logic (noted as inconsistent across `onVoiceDisconnected`, `handleBackToServerList`, `onVoiceReconnectFailed`)
- Changes to Matrix-backed channel message handling

## Testing

- Connect to a server, verify `systemType` is stored in messages.
- Disconnect and verify ephemeral messages are purged from localStorage.
- Send >200 messages to server-root, verify oldest are trimmed.
- Rapid join/leave burst: verify only one localStorage write per ~500ms window.
- Verify kick/ban messages survive disconnect.
- Verify non-server-root localStorage channels are unaffected by cap and debounce.
