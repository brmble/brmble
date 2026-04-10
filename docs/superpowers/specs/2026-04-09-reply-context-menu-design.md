# Design: Reply Button in Chat Context Menu

**Date:** 2026-04-09  
**Status:** Approved

## Overview

Add a "Reply" option to the existing right-click context menu on chat messages. When clicked, it pre-populates the message input with the original message text prefixed with `> ` (quote-reply style like Discord).

## Behavior

- **Trigger**: Right-click any message → context menu appears → click "Reply"
- **Result**: Message input receives `> <original message lines>\n\n` followed by cursor ready for user's reply
- **Availability**: All messages (own and others' messages)

## UI/UX

### Context Menu
- Add "Reply" item to the context menu that appears on right-click
- Icon: ↩️ (or similar reply indicator)
- Position: Below "Copy", above the divider (if any), or before "Send DM"

### Message Input
- When Reply is triggered, prepend quoted text to input field
- Format: `> line1\n> line2\n\n` (each line prefixed with `> `)
- Cursor positioned after the quoted block, ready for user input

## Technical Implementation

### Files Modified

1. **ChatPanel.tsx** (`src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`)
   - Add Reply handler to context menu items
   - Wire to message input via callback prop

2. **MessageInput.tsx** (`src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`)
   - Expose method to insert text at cursor/end of input
   - Or use ref to access input element directly

3. **App.tsx** (`src/Brmble.Web/src/App.tsx`)
   - Pass reply handler to ChatPanel

### Message Bubble Changes

Update `onOpenContextMenu` prop to also pass `messageId`:
```ts
onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
```

### Quote-Reply Format

```ts
function formatQuoteReply(content: string): string {
  const lines = content.split('\n');
  let quoted = lines.map(line => `> ${line}`).join('\n');
  return quoted + '\n\n';
}
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Multi-line message | Prefix each line with `> ` |
| Empty message | Show "Reply" but maybe disable? |
| Very long message | Truncate quote? (Optional) |
| Own message | Allow reply (user approved) |

## Testing

- Right-click own message → Reply → input shows quoted text
- Right-click other's message → Reply → input shows quoted text
- Reply then type → sends as normal message (no special Matrix reply)