# DM Panel: "Others" Collapsible Section for Non-Conversation Brmble Users

## Summary

Split Brmble/Matrix contacts in the DM panel into two groups: users with an existing conversation (stay at top) and users without a conversation (collapsible "Others" section). Mumble users remain unchanged at the bottom.

## Motivation

As the Brmble user directory grows, the DM panel becomes cluttered with users the operator has never interacted with. Collapsing them into a toggle keeps the panel focused on active conversations while preserving discoverability.

## Design

### Contact Classification

A Brmble contact is classified as "has conversation" if `lastMessageTime` is defined (at least one message has been exchanged):

```typescript
const conversationContacts = messageContacts.filter(c => c.lastMessageTime != null);
const otherContacts = messageContacts.filter(c => c.lastMessageTime == null);
```

Contacts from the server directory that have never received or sent a message have `lastMessageTime === undefined` and fall into "Others".

### UI Structure

```
┌─────────────────────────────────────┐
│ Messages                      [<]   │
├─────────────────────────────────────┤
│ 🔍 Search users...                  │
├─────────────────────────────────────┤
│                                     │
│  (conversation contacts, no label)  │ ← Brmble users WITH conversations
│  ┌─────────────────────────────┐    │
│  │ 👤 Vanilla Val          2m   │    │
│  └─────────────────────────────┘    │
│                                     │
│  ▸ Others                           │ ← Collapsible toggle (clickable)
│  ┌─────────────────────────────┐    │    chevron: ▸ collapsed / ▼ expanded
│  │ 👤 Offline Olive            │    │    only visible when expanded OR search active
│  └─────────────────────────────┘    │
│                                     │
│  ── Mumble users ──                 │ ← Unchanged
│  ┌─────────────────────────────┐    │
│  │ 👤 MumbleUser    [mumble]   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Toggle Behavior

- **Label:** `Others` (text only, no count)
- **Default state:** Collapsed (▸)
- **Click:** Toggles between ▸ (collapsed) and ▼ (expanded)
- **State persistence:** Stored in `localStorage` key `dm-others-expanded` so it survives panel collapse/expand and page reloads
- **Search override:** When `searchQuery` is non-empty, the Others section is always expanded regardless of toggle state, so matching users are visible

### Edge Cases

| Scenario | Behavior |
|---|---|
| No "Others" users | Section not rendered |
| No conversation users at all | Only "Others" section shown (if any) plus Mumble |
| Search active, no matches in Others | Section still expanded, but only matching users shown |
| Toggle collapsed, search clears | Section returns to saved toggle state |

### Files Changed

- `src/Brmble.Web/src/components/DMContactList/DMContactList.tsx` — split logic, toggle render, search override
- `src/Brmble.Web/src/components/DMContactList/DMContactList.css` — toggle button styles

## Out of Scope

- No changes to `useDMStore.ts` or `DMContact` type
- No changes to Mumble contact section
- No changes to context menu, user info dialog, or search behavior
