# Voice Channel Chat Design

## Summary

Enable real Mumble text messaging in voice channel chats. Previously, voice channel chats were local-only localStorage scratchpads. This change makes them send and receive real Mumble protocol messages, matching the behavior already working for server-root chat.

## Current State

- **Backend:** `SendTextMessage(message, channelId)` already supports sending to arbitrary channel IDs. The `TextMessage` override already includes `channelIds` in `voice.message` bridge events.
- **Frontend routing:** `onVoiceMessage` already routes incoming messages to the correct channel store based on `channelIds` — root channel messages go to `server-root`, others go to `channel-{id}`.
- **Echo suppression:** Already works for all channels (checks `senderSession` against local user).
- **Chat stores:** `useChatStore` and `addMessageToStore` already work per-channel with localStorage keys like `brmble_chat_channel-5`.

## The Gap

`handleSendMessage` in `App.tsx` only sends via bridge for `server-root`:

```typescript
if (currentChannelId === 'server-root') {
    bridge.send('voice.sendMessage', { message: content, channelId: 0 });
}
```

Messages typed in voice channel chats are added to the local store but never sent over the Mumble protocol.

## Change

Add an `else` branch to send for non-root channels:

```typescript
if (currentChannelId === 'server-root') {
    bridge.send('voice.sendMessage', { message: content, channelId: 0 });
} else if (currentChannelId) {
    bridge.send('voice.sendMessage', { message: content, channelId: Number(currentChannelId) });
}
```

## Files

- Modify: `src/Brmble.Web/src/App.tsx` — `handleSendMessage` function only

## Scope Exclusions

- No channel permission checking (server enforces permissions regardless)
- No unread message indicators (future feature)
- No multi-channel message targeting
