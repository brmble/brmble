# Watch Stream Context Menu Item

## Status
Approved

## Overview
Add "Watch Stream" to the user context menu in the channel list. The item appears near the top alongside "Direct Message" and "User Info", but only when the right-clicked user is currently sharing their screen.

## Placement
- Position: **First item** in the context menu (before Direct Message)
- Only rendered when `contextMenu.userId === String(sharingUserSession) && onWatchScreenShare`

## Behavior
| State | Visibility | Click Action |
|-------|------------|---------------|
| User is sharing | Visible | Opens their stream via `onWatchScreenShare()` |
| User is not sharing | Hidden | N/A |
| Different user sharing | Hidden | N/A |
| Already watching | Visible | Opens their stream (no toggle needed) |

## Implementation Details

### File
`src/Brmble.Web/src/components/Sidebar/ChannelTree.tsx`

### Location
Inside the user context menu items array (~line 432, as first item)

### Code
```tsx
...(contextMenu.userId === String(sharingUserSession) && onWatchScreenShare ? [{
  type: 'item' as const,
  label: 'Watch Stream',
  icon: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  onClick: () => {
    const channelId = contextMenu.channelId ?? currentChannelId;
    onWatchScreenShare?.(`channel-${channelId}`);
  },
}] : []),
```

### Icon
Uses the same screen share icon already present in user rows when someone is sharing.

## Testing Considerations
- Verify item appears when right-clicking the sharing user
- Verify item does not appear when right-clicking non-sharing users
- Verify clicking the item opens the screen share stream
- Verify existing context menu items still work correctly
