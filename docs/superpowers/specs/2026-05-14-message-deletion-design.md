# Design: Own Message Deletion in Matrix Chat

**Date:** 2026-05-14
**Status:** Approved

## Overview

Allow users to delete (redact) their own messages in Matrix chat. Uses Matrix's built-in `redact` API — no backend changes needed.

## Scope

- Own message deletion only (no admin deletion of other users' messages)
- Channel messages and DMs both covered (same `redactEvent` SDK call)
- Confirmation dialog before deletion
- Redacted messages show as "Message deleted" placeholder

## Behavior

- **Trigger**: Right-click own message → context menu → click "Delete"
- **Confirmation**: "Delete this message?" dialog with Cancel/Delete buttons
- **Result**: Matrix redaction is sent; the event is replaced with a placeholder in all clients
- **Availability**: Only the sender's own messages; other users' messages have no delete option

## Technical Implementation

### Files Modified

1. **types/index.ts** — add `redacted?: boolean` field to `ChatMessage`

2. **useMatrixClient.ts** — two changes:
   - Add `deleteMessage(channelId, eventId)` function calling `client.redactEvent(roomId, eventId)`
   - In `transformEventToChatMessage()`: check `event.isRedacted()` or detect `m.room.redaction` → set `redacted: true`
   - Expose `deleteMessage` in the hook return

3. **ChatPanel.tsx** — two changes:
   - Change `onOpenContextMenu` handler: allow own messages to open context menu (currently guarded by `if (s !== currentUsername)`)
   - Add "Delete" item to context menu for own messages (check `s === currentUsername`)
   - Wire Delete to confirmation dialog, then call `deleteMessage`
   - Add a `PromptDialog` or `ConfirmDialog` for the confirmation step — look at the existing `PromptDialog` component used elsewhere

4. **MessageBubble.tsx** — handle `redacted` flag:
   - When `message.redacted` is true, render a dimmed placeholder: "Message deleted" (italic, gray, same pattern as system messages)
   - Don't show content, media, reply preview, or link preview for redacted messages

### Edge Cases

| Scenario | Handling |
|----------|----------|
| Delete message with replies | Matrix keeps replies intact; replied-to content shows "Message deleted" |
| Delete image message | Shows "Message deleted" placeholder (no broken image) |
| Delete pending message | Can't happen (no eventId yet) — delete option not shown |
| Delete message in DM | Works same as channel (same `redactEvent` API) |
| Redaction from another client | Received via timeline sync → shows "Message deleted" |
| Rapid double-click Delete | First call succeeds, second throws — catch and ignore |

### Open Questions

None — pattern is well-understood and follows existing code conventions.

## Testing

- Right-click own message → context menu shows "Delete"
- Click Delete → confirmation dialog appears
- Confirm → message replaced with "Message deleted" placeholder
- Dismiss → dialog closed, message unchanged
- Other user's message → no context menu (same as before) or no Delete option
- Redaction received from sync → placeholder rendered correctly
