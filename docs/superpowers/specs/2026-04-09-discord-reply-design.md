# Design: Discord-Style Reply in Chat

**Date:** 2026-04-09  
**Status:** Approved

## Overview

Add a Discord-style reply feature with an inline reply bar above the message input. When sending, it creates a proper Matrix reply event with `m.in_reply_to` relation and `<mx-reply>` fallback HTML.

## UI/UX

### Reply Bar (Inline above input)

- Shows when user clicks "Reply" in context menu
- Displays: Avatar + Sender name + Full message preview (truncated at ~200 chars) + [X] to cancel
- Background: slightly distinct (border or darker shade)
- Position: Fixed at top of message input area, persists while composing

### Context Menu

- "Reply" option available on all messages (own + others)
- Clicking it opens the reply bar and focuses the input

### Visual Mockup

```
┌─────────────────────────────────────────────────────┐
│ [Reply Bar - appears above input when replying]     │
│ ┌─[Avatar]──────────────────────[X]───────────────┐│
│ │ Bob: This is the original message being replied  ││
│ │     to. It shows the full text preview.           ││
│ └───────────────────────────────────────────────────┘│
│ ┌────────────────────────────────────────────────────┐│
│ │ Type your reply here...                          ││
│ └────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Data Model

### In-memory reply state (TypeScript)

```ts
interface ReplyState {
  eventId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  html?: string;
  msgType: string;
}
```

### MessageBubble callback update

Update `onOpenContextMenu` to include `messageId`:
```ts
onOpenContextMenu?: (
  x: number,
  y: number,
  sender: string,
  senderMatrixUserId?: string,
  content?: string,
  messageId?: string
) => void;
```

## Sending (Matrix Protocol)

Build the reply event per Matrix spec:

### Plain text body

```
> <@sender:domain> original message line 1
> original message line 2

user's reply text
```

### HTML formatted_body

```html
<mx-reply>
  <a href="https://matrix.to/#/!room:domain/$PARENT_EVENT">In reply to</a>
  <blockquote>
    <a href="https://matrix.to/#/@sender:domain">@sender:domain</a>
    original message
  </blockquote>
</mx-reply>
user's reply
```

### Full event payload

```json
{
  "msgtype": "m.text",
  "body": "> <@alice:example.org> Hello world\n\nMy reply",
  "format": "org.matrix.custom.html",
  "formatted_body": "<mx-reply><a href=\"https://matrix.to/#/!room:example.org/$PARENT_EVENT\">In reply to</a><blockquote><a href=\"https://matrix.to/#/@alice:example.org\">@alice:example.org</a> Hello world</blockquote></mx-reply>My reply",
  "m.relates_to": {
    "m.in_reply_to": {
      "event_id": "$PARENT_EVENT"
    }
  }
}
```

### Fallback generation helper

```ts
function stripReplyFallback(body: string): string {
  return body.split('\n').filter(line => !/^> ?/.test(line)).join('\n').trim();
}

function makeReplyFallback(parent: { sender: string; body: string }, replyText: string): string {
  const cleanBody = stripReplyFallback(parent.body);
  const lines = cleanBody.split('\n');
  let fallback = `> <${parent.sender}> ${lines[0]}`;
  for (let i = 1; i < lines.length; ++i) {
    fallback += `\n> ${lines[i]}`;
  }
  return fallback + '\n\n' + replyText;
}
```

### Media message preview

For images/videos/files, show type indicator:
- `m.image` → 📷 Image
- `m.video` → 🎥 Video
- `m.file` → 📎 File
- `m.audio` → 🎵 Audio
- Default → 💬 Message

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Parent message deleted/redacted | Show "Message not found" in reply bar, allow cancel |
| Parent not in local cache | Fetch via `matrixClient.getEvent()`, show loading state |
| Very long original message | Truncate preview at ~200 chars with "…" |
| Image/media reply | Show icon + type label (📷 Image, 📎 File) |
| Network failure sending reply | Retry with same reply state preserved |
| User cancels reply | Clear reply state, hide reply bar |
| Reply to edited message | Use latest content (or document policy) |
| Rapid reply chains | UI shows only direct parent (flattened) |

## Files Modified

1. **MessageInput.tsx** (`src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`)
   - Add ReplyHeader component above textarea
   - Add reply state management (replyState, setReplyState, clearReply)
   - Pass replyState to ReplyHeader for display

2. **Create: ReplyHeader.tsx** (`src/Brmble.Web/src/components/ChatPanel/ReplyHeader.tsx`)
   - New component for reply bar UI
   - Props: replyState, onCancel
   - Shows avatar, sender, preview (truncated), close button

3. **MessageBubble.tsx** (`src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx`)
   - Add messageId to onOpenContextMenu callback

4. **ChatPanel.tsx** (`src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`)
   - Add Reply item to context menu
   - Set replyState when Reply clicked
   - Pass replyState to MessageInput

5. **App.tsx** (`src/Brmble.Web/src/App.tsx`)
   - Pass matrixClient to ChatPanel for sending reply events

## Implementation Notes

- Use `matrixClient.sendEvent(roomId, EventType.RoomMessage, content)` to send reply
- Generate `eventId` for matrix.to link from the parent message
- Room ID comes from `matrixRoomId` prop
- Test with Element/Hydrogen to verify fallback rendering matches

## Testing Checklist

- [ ] Right-click own message → Reply → reply bar shows with preview
- [ ] Right-click other's message → Reply → reply bar shows with preview
- [ ] Click [X] on reply bar → clears reply state
- [ ] Type message and send → sends as Matrix reply with m.in_reply_to
- [ ] Receive reply from another user → shows reply header in message bubble
- [ ] Long message → preview truncated with "…"
- [ ] Image message → shows 📷 Image indicator
- [ ] Network failure → reply state preserved for retry