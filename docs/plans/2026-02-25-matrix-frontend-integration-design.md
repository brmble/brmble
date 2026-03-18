# Matrix SDK Frontend Integration — Design

**Issue:** [#104 — feat: Matrix SDK integration in frontend for chat](https://github.com/brmble/brmble/issues/104)
**Date:** 2026-02-25
**Scope:** Frontend only (backend is ready)

## Context

The frontend already has `useMatrixClient.ts` and App.tsx wiring for Matrix, but chat messages are not appearing. The backend sends `server.credentials` with homeserver URL, access token, user ID, and roomMap. This design covers debugging the connection, then cleaning up the message flow.

## Goals

1. Fix Matrix chat so messages appear in channel chat panels
2. Make Matrix the sole source of truth for channel chat messages
3. Keep localStorage only for system messages (join/leave) and DMs
4. DMs stay on the Mumble bridge path — no changes

## Design

### 1. Debug Matrix Connection

Investigate why messages aren't appearing:
- Verify `server.credentials` bridge event fires with valid data
- Verify `useMatrixClient` initializes the SDK client and sync completes
- Check `RoomEvent.Timeline` events fire for incoming messages
- Check channel ID string/number type mismatches in `roomIdToChannelId` mapping
- Add console logging to trace the full pipeline

### 2. Message Flow (Channel Chat)

**Receiving:**
- Matrix SDK room events (`m.room.message`) are the single source of truth
- `voice.message` bridge events are ignored for channels that have a Matrix room mapping
- System messages (`type: 'system'`) from `voice.message` still stored in localStorage

**Sending (dual-post, already implemented):**
- `voice.sendMessage` via bridge (for non-Brmble Mumble clients)
- `matrixClient.sendMessage()` via SDK (for Matrix users and Brmble clients)

**History:**
- On channel click, fetch room timeline via `matrixClient.fetchHistory()` (already implemented)

### 3. Chat Panel Rendering

Current: `messages={matrixMessages ?? messages}` — either/or.

New: Merge system messages from localStorage with Matrix messages:
```
channelMessages = [...(matrixMessages ?? []), ...systemMessages].sort(by timestamp)
```

System messages (join/leave) appear interleaved with chat.

### 4. useChatStore Changes

**Keep:**
- System message storage (`addMessage` with `type: 'system'`)
- DM message storage (all DM-related functions)
- DM contact management

**Remove:**
- Channel chat message writes for non-system messages when Matrix is active
- The `voice.message` handler stops writing regular user messages to localStorage for Matrix-active channels

### 5. Files Changed

- `src/Brmble.Web/src/hooks/useMatrixClient.ts` — debug/fix connection issues
- `src/Brmble.Web/src/hooks/useChatStore.ts` — slim down to system messages + DMs only
- `src/Brmble.Web/src/App.tsx` — clean up message flow, merge system + Matrix messages
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` — possibly minor adjustments for merged message rendering
