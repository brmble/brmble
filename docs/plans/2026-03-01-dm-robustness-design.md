# DM Robustness Overhaul — Design

**Date:** 2026-03-01
**Status:** Approved
**Scope:** Fix all code review issues from PR #191, refactor DM state into dedicated hook

## Context

The DM system has a dual-transport architecture: Matrix for Brmble users, Mumble TextMessage for pure-Mumble users. A code quality review identified 15 issues ranging from XSS vulnerabilities to race conditions and UX gaps. This design addresses all of them via a state refactor and targeted fixes.

## Design Decisions

1. **Mumble-only DMs stay ephemeral** — session IDs are ephemeral, so pure-Mumble DM history resets on reconnect. Robustness investment targets Matrix DMs.
2. **Matrix store-and-forward for offline** — Matrix server holds messages until recipient syncs. No local outbox queue needed.
3. **500-message cap per conversation** in localStorage with oldest-message eviction.
4. **No Mumble fallback for Brmble users** — if `matrixUserId` is present, DMs always go through Matrix. Mumble private messages only for non-Brmble users.

## Architecture

### New: `useDMStore` Hook

Single source of truth for all DM state. Located at `src/Brmble.Web/src/hooks/useDMStore.ts`.

**State:**
- `dmContacts: DMContact[]` — contact list with unread counts, last message preview
- `activeDMMessages: ChatMessage[]` — messages for the currently selected DM
- `selectedDMUserId: string | null` / `selectedDMUserName: string`
- `appMode: 'channels' | 'dm'`

**Functions:**
- `selectDM(userId, userName)` — switch to DM view, clear unread, load history
- `sendDM(content)` — route to Matrix or Mumble, add local echo
- `receiveDM(senderSession, senderName, content)` — process incoming Mumble DMs
- `receiveMatrixDMUpdate(matrixUserId, messages)` — process Matrix sync, track last-processed ID
- `toggleDMMode()` — switch between channels and DMs

**localStorage backing:**
- Contacts: `brmble_dm_contacts`
- Messages: `brmble_chat_dm-{userId}` with 500-message cap
- All mutations go through the hook
- `QuotaExceededError` caught gracefully

**Moves out of App.tsx:**
- `appMode`, `selectedDMUserId`, `selectedDMUserName`, `dmContacts` state
- The `matrixDmMessages` useEffect
- `handleSendDMMessage`
- DM portion of `onVoiceMessage`
- `handleSelectDMUser`

### Security Fixes

| Fix | File | Detail |
|-----|------|--------|
| XSS | `MessageBubble.tsx` | Add DOMPurify, sanitize before `dangerouslySetInnerHTML` |
| Room creation race | `useMatrixClient.ts` | `pendingRoomCreations` ref: `Map<string, Promise<string>>` |
| URL encoding | `MatrixAppService.cs` | `Uri.EscapeDataString(roomId)` in `SendMessage` and `SetRoomName` |
| Silent send failure | `MumbleAdapter.cs` | Try-catch on `SendControl`, send `voice.error` on failure |

### DM Routing

```
User sends DM to target
  ├── target has matrixUserId? → Matrix DM (always)
  │   ├── Add optimistic local echo
  │   ├── Send via Matrix client
  │   ├── On sync echo: deduplicate
  │   └── On failure: show error indicator
  └── target has no matrixUserId? → Mumble TextMessage
      ├── Add local echo + store in localStorage
      └── Send via bridge voice.sendPrivateMessage
```

### Incoming DM Deduplication

- `voice.message` from a user with `matrixUserId` → skip (Matrix timeline will deliver)
- `voice.message` from a pure-Mumble user → process normally
- Matrix timeline event → process, track `lastProcessedMessageId` per conversation

### Unread Count Fix

Track `lastProcessedMessageId` per DM conversation. When `receiveMatrixDMUpdate` fires, only process messages newer than last-processed. Never re-increment unread for already-seen messages.

### Local Echo for Matrix DMs

1. On send: immediately add message to local state with temporary ID
2. On Matrix sync echo: match by content + sender + timestamp window, deduplicate
3. On send failure: show inline error indicator on the message bubble

### Other Fixes

- **Remove `clearChatStorage()` from `onServerCredentials`** — DM history persists across credential refreshes
- **Remove dead code** — `availableUsers` computation and `void availableUsers`
- **localStorage cap** — 500 messages per conversation, evict oldest on overflow, catch `QuotaExceededError`

## Files Changed

| File | Change |
|------|--------|
| `src/Brmble.Web/src/hooks/useDMStore.ts` | **New** — DM state hook |
| `src/Brmble.Web/src/App.tsx` | Slim down, delegate DM logic to useDMStore |
| `src/Brmble.Web/src/hooks/useChatStore.ts` | Add 500-msg cap, QuotaExceededError handling |
| `src/Brmble.Web/src/hooks/useMatrixClient.ts` | Room creation mutex |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` | DOMPurify |
| `src/Brmble.Server/Matrix/MatrixAppService.cs` | URL-encode roomId |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | Error handling on SendControl |
| `package.json` | Add `dompurify` dependency |
