# Context Menu for Chat - Design

## Overview
Add a context menu to chat messages that appears on right-click with a "Send DM" option.

## Context
- ChatPanel renders messages via MessageBubble component
- ContextMenu component already exists in the codebase
- Sidebar already has right-click "Send DM" functionality
- DMContactList handles DM conversations

## UI/UX

### Placement
- Menu appears at mouse cursor position (clientX, clientY)
- ContextMenu component handles edge detection automatically

### Menu Items
- **Send DM** — Opens a DM with the message sender
  - Disabled if sender is the current user
  - Uses existing DM infrastructure (dmStore.startDM)

### Interaction
- Left-click outside menu closes it
- Escape key closes menu
- Clicking "Send DM" closes menu and initiates DM

## Data Flow

```
MessageBubble (onContextMenu)
    ↓
ChatPanel (onMessageContextMenu) — needs new prop
    ↓
App.tsx (handleStartDMFromContextMenu) — existing handler
    ↓
dmStore.startDM()
```

## Implementation

### MessageBubble.tsx
- Add `onContextMenu` handler to the root element
- Accept new props: `onOpenContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string) => void`
- Pass these through from ChatPanel

### ChatPanel.tsx
- Add state for context menu: `{ x: number; y: number; sender: string; senderMatrixUserId?: string } | null`
- Add `onMessageContextMenu` prop
- Render ContextMenu when state is set

### App.tsx
- Pass `onMessageContextMenu` to ChatPanel
- Reuse existing `handleStartDMFromContextMenu` callback

## Edge Cases
- Self messages: disable "Send DM" option
- Missing matrixUserId: fallback to username-based lookup
- Context menu near edges: ContextMenu component handles repositioning