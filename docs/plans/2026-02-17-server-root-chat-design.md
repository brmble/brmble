# Server Root Chat Design

## Problem

Brmble currently displays a placeholder chat panel for each voice channel, with messages stored locally in localStorage. There is no way to view or send messages to the Mumble server's root channel (channel 0), which serves as the server-wide text chat. Users need a real server-level chat panel connected to the Mumble root channel.

## Decision

Reuse the existing ChatPanel component by treating the server root channel as a special selection target with channel key `"server-root"`. This avoids code duplication and keeps the UX consistent.

## Design

### 1. Selection & Navigation

- The server name in the Sidebar header becomes clickable. Clicking it sets `currentChannelId = "server-root"` and `currentChannelName` to the server label.
- Clicking a voice channel in the channel tree overrides the selection to that channel's ID and name (existing behavior).
- On initial connection, `currentChannelId` defaults to `"server-root"` so server chat is shown immediately.
- The ChatPanel header shows the server name when server chat is active, and the channel name otherwise.

### 2. Message Routing (Backend - MumbleAdapter)

**Sending**: When `voice.sendMessage` is received, if a `channelId` field is present in the payload, target that channel in the Mumble TextMessage protobuf. For server-root chat, the frontend sends `channelId: 0`. If no `channelId` is provided, default to channel 0. This fixes the existing bug where `SendTextMessage` doesn't set any target channel.

**Receiving**: `MumbleAdapter.TextMessage` currently sends `voice.message` with `{message, senderSession}`. It must also include the channel IDs from the TextMessage protobuf so the frontend can route messages to the correct chat store. The payload becomes `{message, senderSession, channelIds}`.

### 3. Message Routing (Frontend - App.tsx)

**Incoming messages**: The `voice.message` handler routes messages based on `channelIds`:
- If `channelIds` includes `0` (or is empty), add the message to the `"server-root"` store.
- Otherwise, add to the matching channel store.
- Messages persist in localStorage via `useChatStore` with key `"server-root"` for server chat.

**Sending messages**: In `handleSendMessage`:
- If `currentChannelId === "server-root"`: send `bridge.send('voice.sendMessage', { message, channelId: 0 })`.
- Otherwise: do not send via bridge (voice channel chats remain local-only).

### 4. Sidebar Changes

The server name/info section at the top of the Sidebar receives:
- `cursor: pointer` and hover highlight styling.
- An `onClick` handler calling `onSelectServer()` (new callback prop).
- Visual active-state indication when server chat is selected (consistent with channel selection styling).

### 5. Voice Channel Placeholder Chats

Voice channel placeholder chats remain unchanged: the message input works, messages are stored in localStorage, but nothing is sent over Mumble. This preserves the current local-only scratchpad behavior.

## Scope

### In scope
- Clickable server name in sidebar to select server root chat
- Real Mumble TextMessage send/receive for root channel (channel 0)
- Message routing by channel ID on both backend and frontend
- Default to server chat on connection
- Sender username display on server chat messages

### Out of scope
- Per-channel Mumble text chat (voice channels stay local-only)
- Chat history from server (Mumble doesn't persist history)
- Unread message indicators
- Direct messages
