# Chat Message Hover Highlight

## Overview
Add a subtle background highlight to chat messages on hover, similar to Discord's message hover behavior.

## Changes

### CSS (`MessageBubble.css`)
Add hover state to `.message-bubble`:
```css
.message-bubble:hover {
  background: var(--bg-hover);
}
```

This applies to both full messages and collapsed (continuation) messages.

## Testing
- Hover over any message in the chat panel
- Both full and collapsed messages should show the faint highlight
- Verify it works with both light and dark themes (uses existing `--bg-hover` token)
