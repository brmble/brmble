# @Mention Feature Design

**Issue:** #283 — feat: Add @reply feature to chat
**Date:** 2026-03-16
**Branch:** `feature/at-mention-chat`

## Summary

Add an @mention/tag mechanism to chat. Typing `@` shows a dropdown of users with typeahead filtering. Tab completes the selection. Mentioned usernames are styled distinctly in messages. If a Matrix user is @mentioned while not viewing the channel, a red unread badge appears.

## Requirements (from issue comment)

1. Typing `@` shows a dropdown of users (chatted before or in voice channel)
2. Typeahead filtering — `@a` filters to usernames starting with "A"
3. Tab completes the typeahead selection
4. Mentioned username styled differently (colored) in messages
5. Red unread badge on channel when a Matrix user is @mentioned but not viewing the channel
6. Unread badge visually matches existing "Unread direct message" style

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Dropdown approach | Portal to `document.body` | Follows existing Tooltip/Select patterns, avoids overflow clipping |
| User sources | Connected Mumble users + Matrix room members | Covers both voice channel users and historical chatters |
| Mention storage | Plain text `@Username` | Simple, readable, works for all users |
| Mention notification | Matrix users only | Unread tracking is Matrix-backed; Mumble-only users lack accounts to track |
| Badge layout | Two separate badges (white unread + red mention) | Distinguishes total unread from mention-specific unread |
| Self-mention color | `--accent-secondary` | Differentiates from general mentions (`--accent-primary`) |

## Architecture

### 1. User List Data Flow

**Sources merged into `mentionableUsers`:**
1. Connected Mumble users — from existing `users` prop on `ChatPanel`
2. Matrix room members — queried from `matrixClient.getRoom(roomId).getJoinedMembers()`

**Deduplication:** By `matrixUserId`. Connected users take priority (they appear as "online").

**Data structure:**
```ts
interface MentionableUser {
  displayName: string;
  matrixUserId?: string;
  avatarUrl?: string;
  isOnline: boolean;  // true if in connected Mumble users
}
```

Computed in `ChatPanel` (has access to both `users` and `matrixClient`), passed to `MessageInput`.

### 2. Autocomplete Dropdown

**Trigger:** `@` character typed in textarea enters mention mode.

**Filtering:** Case-insensitive prefix match on `displayName`. Online users sorted first, then offline.

**Keyboard:**
| Key | Action |
|-----|--------|
| ArrowDown/ArrowUp | Move highlight |
| Tab or Enter | Complete mention (insert `@Username `) |
| Escape | Dismiss dropdown |
| Continue typing | Refine filter |

**Positioning:** Portal above `.message-input-wrapper`, anchored left.

**Styling:** Glass panel (`--bg-glass`, `--glass-blur`, `--glass-border`). Each row: Avatar (20px) + display name. Online = normal text, offline = `--text-muted`. Max 6 visible with scroll.

### 3. Mention Rendering

**Pipeline:** Extend existing `linkifyText` → add `mentionifyText` step. Detects `@Username` in message content and wraps in styled spans.

**CSS classes:**
- `.mention` — `color: var(--accent-primary); font-weight: 600; background: var(--accent-primary-wash); padding: 0 2px; border-radius: var(--radius-xs)`
- `.mention--self` — uses `--accent-secondary` instead for self-mentions

**Self-detection:** Compare mention text against `currentUsername` prop (already available in ChatPanel).

### 4. Unread Notification

**Two-badge system in ChannelTree:**
- White badge (`.channel-unread-badge`): total unread count — existing, unchanged
- Red badge (`.channel-unread-badge--mention`): mention count — new separate element

**Detection:** Client-side in `useMatrixClient.ts` timeline handler. When message contains `@currentDisplayName` (case-insensitive) and user is not viewing that channel, increment mention counter.

**Clearing:** Both counts reset when user views the channel (existing `markRoomRead` flow).

## Files Changed

### New files
- `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.tsx`
- `src/Brmble.Web/src/components/ChatPanel/MentionDropdown.css`

### Modified files
- `MessageInput.tsx` — `mentionableUsers` prop, `@` detection, keyboard handling, Tab completion
- `MessageInput.css` — dropdown anchor positioning
- `MessageBubble.tsx` — `currentUsername` prop, mention rendering pipeline
- `MessageBubble.css` — `.mention` and `.mention--self` styles
- `ChatPanel.tsx` — compute `mentionableUsers`, pass `currentUsername` to MessageBubble
- `ChannelTree.tsx` — render two separate badges
- `ChannelTree.css` — side-by-side badge styling
- `useMatrixClient.ts` or `useUnreadTracker.ts` — client-side mention detection
- `linkifyText.tsx` or new `mentionifyText.tsx` — mention text processing

## Error Handling

- Matrix room member query fails → fall back to connected users only (silent)
- Empty user list → dropdown doesn't appear
- Username with spaces → match up to next `@` or word boundary

## Testing

Manual verification against Classic and Retro Terminal themes per UI guide.
