# DM View Design

## Summary

Replace the current modal-based DM panel with an integrated view where the main content area slides between channel chat and DM conversations. A DM contact list appears on the right when in DM mode.

## Layout

Channel mode (current):
```
+--sidebar(280px)--+------main-content(flex:1)------+
|  server info     |                                 |
|  channel tree    |   ChatPanel (#channel-name)     |
|  users           |                                 |
+------------------+---------------------------------+
```

DM mode (slides right-to-left):
```
+--sidebar(280px)--+------main-content(flex:1)------+--dm-contacts(260px)--+
|  server info     |                                 |  Search...           |
|  channel tree    |   ChatPanel (@username)          |  [user] last msg...  |
|  users           |   or Welcome empty state        |  [user] last msg...  |
+------------------+---------------------------------+----------------------+
```

## Decisions

- **Approach**: CSS transform slide (Approach A). Both panels stay mounted in the DOM. `translateX(-100%)` on a sliding container for GPU-composited 60fps transitions.
- **Left sidebar**: Stays visible with channel tree in DM mode. No changes.
- **DM trigger**: Existing DM button in UserPanel toggles `appMode` between `'channels'` and `'dm'` (no longer opens a modal).
- **Conversation selection**: Clicking a contact in the right-side list replaces main content with that DM conversation.
- **Contact list style**: Conversation list with avatar + username + last message preview + timestamp.
- **Empty state**: Welcome prompt with chat icon + "Right-click a user in the channel tree to start a conversation" + search/filter.
- **New DM initiation**: Right-click context menu on users in ChannelTree with "Send Direct Message" option.
- **Visual identity**: Consistent with channel chat. Same fonts, bubbles, colors. Header shows `@username` with avatar instead of `#channel-name`.
- **Message storage**: `useChatStore` with `dm-{userId}` keys, same localStorage pattern as channels.

## Transition Details

- Sliding container: 300ms `cubic-bezier(0.4, 0, 0.2, 1)`
- DM contact list: Slides in from right edge, 350ms delay for staggered effect
- Both panels always mounted (state preserved across switches)
