# Chat Reactions Design

## Summary

Add emoji reactions to chat messages using Matrix's native `m.reaction` event type. Users can react with a predefined set of 6 emojis via the message context menu. No backend changes needed.

## Predefined Emoji Set

👍 ❤️ 😂 😮 😢 😡

## Data Model

Add a `reactions` field to `ChatMessage` in `types/index.ts`:

```typescript
interface ChatMessage {
  // ... existing fields
  reactions?: Record<string, string[]>  // emoji → sender IDs
}
```

Example: `{ "👍": ["@alice:server", "@bob:server"], "😂": ["@alice:server"] }`

Empty arrays are pruned — a reaction entry with no users is removed from the map.

## Matrix Event Processing

In `useMatrixClient.ts`:

- **Timeline filter relaxed**: process `m.reaction` events in addition to `m.room.message`
- **Reaction events**: parse `event.getContent()` → extract `m.relates_to.event_id`, `m.relates_to.key` (emoji), and sender. Update target message's `reactions` map in `activeMessages`/`lastMessages` state
- **Redaction handling**: when a reaction is redacted, remove the sender from that emoji's array; if array becomes empty, prune the entry
- **Initial sync**: when loading timeline (channel or DM), aggregate `m.reaction` events into their target messages

## Sending/Removing Reactions

Two functions exposed from `useMatrixClient`:

- **`sendReaction(roomId, eventId, emoji)`**: sends `m.reaction` via Matrix SDK. Optimistically adds current user to the reactions map.
- **`removeReaction(roomId, reactionEventId)`**: calls `client.redactEvent()` to remove own reaction. Optimistically removes current user.

A local cache `Map<messageEventId, Map<emoji, reactionEventId>>` tracks reaction event IDs for quick redaction lookup.

## Context Menu

In `ChatPanel.tsx`, add "React" to the message context menu. Opens an inline submenu with the 6 emojis. Each emoji shows:

- The emoji character
- Visual indication if already applied by current user
- Clicking toggles: add (sendReaction) or remove (removeReaction)

Context menu passes `messageId` (event ID) and `channelId` (room ID) to handlers.

## Reaction Display

In `MessageBubble.tsx`, render reactions as a row of badges below message content, above the timestamp:

- Each badge: emoji + count (e.g., "👍 2")
- If current user reacted: filled/highlighted background (`--accent`/`--accent-hover`)
- Clicking a badge toggles the reaction
- Entire row absent when `reactions` is undefined or empty

## Files Changed

| File | Changes |
|------|---------|
| `src/Brmble.Web/src/types/index.ts` | Add `reactions` to `ChatMessage` |
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Process `m.reaction`/redaction, add `sendReaction`/`removeReaction`, reaction event ID cache |
| `src/Brmble.Web/src/components/chat/MessageBubble.tsx` | Render reaction badges with toggle |
| `src/Brmble.Web/src/components/chat/MessageBubble.css` | Reaction badge styles |
| `src/Brmble.Web/src/components/chat/ChatPanel.tsx` | Add "React" submenu to context menu |
| `src/Brmble.Web/src/components/chat/ChatPanel.css` | Context menu reaction styles |
| `src/Brmble.Web/src/hooks/useMatrixClient.test.ts` | Tests for reaction send/remove/timeline processing |

## No Backend Changes

Reactions use standard Matrix CS API `m.reaction` events sent directly from the client. The Matrix homeserver handles persistence and sync. Mumble has no reaction concept, so no relay is needed.
