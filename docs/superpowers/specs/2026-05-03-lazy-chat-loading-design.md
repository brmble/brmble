# Lazy chat loading — design

**Date:** 2026-05-03
**Branch:** `feature/lazy-chat-loading`
**Status:** approved (verbal); pending written-spec review

## Problem

Two compounding issues in the WebView2 frontend:

1. **Memory leak.** `useMatrixClient` keeps a `Map<string, ChatMessage[]>` per Matrix room and per Matrix DM contact. Both grow unbounded — `insertMessage` only appends, never evicts. Over a long session (channel browsing + scrollback + incoming messages), the JS heap grows without bound. `useDMStore.mumbleMessages` and `useChatStore` non-server-root entries have the same shape. Reported symptom (commit `94cc38c`): WebView2 *page out of memory* after ~30 minutes idle. The throttle-rerenders fix removed the largest sustained churn but explicitly did not fix the underlying leak.

2. **Slow cold start.** `client.startClient({ initialSyncLimit: 20 })` causes the matrix-js-sdk `/sync` to return 20 events per room. With N rooms, that's 20×N events on the wire and 20×N transformations through `onTimeline` before first paint. Each transformation does mxc-URL resolution, reply-relation parsing, mention detection, and `setMessages` (a re-render trigger).

The two issues share a root cause: **the React-state holds a transformed copy of every message in every room, eagerly populated at sync time and never pruned.** The matrix-js-sdk already caches the underlying events itself (`room.getLiveTimeline()`), so we are storing each Matrix message twice — once in the SDK and once as a `ChatMessage` in React.

## Goal

Eliminate the duplicate storage. Make React-state hold only what is currently rendered. Drastically reduce work done at cold start.

Non-goals:

- Persisting chat history beyond the SDK's existing cache.
- Implementing message search (would require a separate index).
- Fixing all Codex/explore findings — only those that fall out of this redesign or are tightly coupled (`pendingMessages` cleanup, `pendingRoomCreations` cleanup).

## Approach

**Approach A — "only-active-room" with derived sidebar previews.** Selected after evaluating cap-per-room (does not solve cold start) and LRU-window (overengineered for the gain over A).

**Principle:** each chat source has a source of truth that is not React. React-state is a transient view over the source of truth, scoped to what the user is currently looking at.

| Source | Source of truth | What React holds |
|---|---|---|
| Matrix channels | `matrix-js-sdk` internal timeline (`room.getLiveTimeline()`) | Active channel only, as `ChatMessage[]` |
| Matrix DMs | idem | Active DM only, as `ChatMessage[]` |
| Mumble channel-root | `localStorage` per channel | Active channel only (already so) |
| Mumble session DMs | in-memory map (session-scoped, capped) | Active contact only |

For sidebar rendering, a small bounded `lastMessages: Map<roomId, {content, ts, sender}>` holds a single preview entry per room (≤1 ChatMessage worth of data per room).

The transformation `MatrixEvent → ChatMessage` is no longer eager. It runs once per channel-open from the SDK cache (~5 events post-sync), and incrementally for new real-time messages in the active room.

## Per-store changes

### `useMatrixClient.ts`

- Replace `messages: Map<string, ChatMessage[]>` with `activeMessages: ChatMessage[]` and an `activeChannelId: string | null` setter exposed as a new `setActiveChannel(channelId | null)`.
- Same shape for DMs: `activeDmMessages: ChatMessage[]` and `setActiveDmContact(matrixUserId | null)`.
- New: `lastMessages: Map<string, MessagePreview>` where `MessagePreview = { content: string; ts: number; sender: string }`. Bounded to one entry per room. Populated on PREPARED by iterating `client.getRooms()` and reading the last `m.room.message` from each room's live timeline; updated on every `RoomEvent.Timeline`. Same for `dmLastMessages`.
- New helper: `loadActiveMessages(roomId: string)` — reads `room.getLiveTimeline().getEvents()`, filters to `m.room.message`, transforms to `ChatMessage[]`, and stores. Uses an `activeRoomVersionRef` (monotonic counter) so a stale load cannot overwrite a newer active room.
- `onTimeline` is now: always update `lastMessages` for the room; if `room.roomId === activeRoomId`, also update `activeMessages` via the existing `insertMessage` logic. No other branches.
- `startClient` parameter changes: `initialSyncLimit: 20 → 5`. Five is enough to bootstrap previews and unread-since-marker logic; reduces cold-start payload by 75%.
- `fetchHistory(channelId)`: unchanged externally — still calls `scrollback(room, 50)`. The SDK's resulting backfill events fire `RoomEvent.Timeline`, which our new `onTimeline` will only commit to `activeMessages` when the channel is active. Behaviour identical to before for the user.
- Hook return shape changes: `messages` and `dmMessages` Maps are removed; new exports are `activeMessages`, `activeDmMessages`, `lastMessages`, `dmLastMessages`, `setActiveChannel`, `setActiveDmContact`.

### `useChatStore.ts`

- React-state is already only-active. Single change: introduce `NON_SERVER_ROOT_MAX_MESSAGES = 200` and apply slice-from-end cap in both `addMessage` (when `!isServerRoot`) and `addMessageToStore`'s non-server-root path.
- No localStorage migration — existing oversized entries shrink at the next write.

### `useDMStore.ts`

- Cap `mumbleMessages.get(contactId)` at 200 messages in `receiveMumbleDM` and the Mumble path of `sendMessage` (slice-from-end).
- Fix `pendingMessages` accumulation on send failure: in `.catch` of `sendMatrixDM`, remove the optimistic message from `pendingMessages` (drop on failure; retry UI is out of scope).
- `DMStoreOptions` prop changes:
  - **Drop** `matrixDmMessages: Map<string, ChatMessage[]>` (no longer maintained per-contact).
  - **Add** `matrixDmLastMessages: Map<string, MessagePreview>` — used in the `contacts` useMemo to derive `lastMessage` and `lastMessageTime` for every DM contact in the sidebar (one preview per contact, bounded by contact count).
  - **Add** `activeDmMessages: ChatMessage[]` — used in the `messages` useMemo for the currently selected contact only.
  - `App.tsx` wires both new props from the corresponding `useMatrixClient` exports.

## Data flow

**Cold start:** `App` mounts → `MatrixClient.startClient({ initialSyncLimit: 5 })` → SDK populates internal timelines from `/sync` → `ClientEvent.Sync == PREPARED` → bootstrap `lastMessages` and `dmLastMessages` by iterating `client.getRooms()` → unread-tracker reads server unread counts → sidebar renders.

**User opens channel X:** `App.tsx` calls `setActiveChannel(X)` → useEffect on `activeChannelId` increments `activeRoomVersionRef`, captures the version, reads `client.getRoom(roomMap[X]).getLiveTimeline().getEvents()`, filters and transforms (~5 items, sub-ms), and sets `activeMessages` only if the captured version still matches.

**New message arrives in any room:** `RoomEvent.Timeline` fires → `onTimeline` always updates `lastMessages.set(roomId, preview)` → if room is active, also updates `activeMessages` via `insertMessage`. `useUnreadTracker` updates its badge independently via its own listener.

**User scrolls back:** `ChatPanel` detects top-reached, calls `fetchHistory(activeChannelId)` → `scrollback(room, 50)` → backfill events fire `RoomEvent.Timeline` → `onTimeline` appends them to `activeMessages` because the room is active. No special-case code path.

**User switches X → Y:** version ref bumps, invalidating any in-flight load for X. `activeMessages` reset, then rebuilt for Y from SDK cache. X's events remain in SDK cache, so re-visiting X is also a synchronous read with no network call.

## Edge cases

1. **Channel switch race.** Rapid X→Y→X within milliseconds. Mitigated by `activeRoomVersionRef`. Each `loadActiveMessages` captures the current version before its (synchronous) work and only commits if it still matches. Synchronous transformation of ~5 events makes the race window microscopic, but the guard is essentially free.

2. **Reply-to events outside the active window.** Today, replies whose target is not in the messages array fall back to rendering with only `replyToEventId` (no body). Same fallback applies in the new model. Optional future improvement: use `room.findEventById()` to look up the body from the SDK cache; not in scope for this design.

3. **Optimistic image blob URLs.** Codex finding #10 — failed Matrix uploads and the non-Matrix path leak `blob:` URLs. Out of scope here, but called out: dropping a message from `activeMessages` on channel switch does not free a blob whose owner is `optimisticImages` state. Separate one-line fix in `App.tsx` upload handlers.

4. **DM first-time flow.** Pending contact has no room → `setActiveDmContact(userId)` sets `activeDmMessages = []` and renders empty. When the room appears via `registerDMRoom`, the version ref bumps and the load runs against the now-existing room. No extra code required.

5. **Scrollback for inactive room.** Cannot occur via UI (only the active channel exposes scrollback), but if it did, `onTimeline` would only update `lastMessages` for the inactive room — the desired behavior.

6. **Sidebar badges.** `useUnreadTracker` is decoupled from the messages map; channel switching does not affect badge rendering.

## Testing

**Unit (Vitest, existing pattern in `src/Brmble.Web/src/hooks/*.test.ts`):**

- `useMatrixClient.test.ts`:
  - `setActiveChannel` rebuilds `activeMessages` from a mocked SDK timeline.
  - `onTimeline` updates `lastMessages` for any room; updates `activeMessages` only for the active room.
  - Rapid switch X→Y→X commits only the latest load (version guard).
- `useChatStore.test.ts`: non-server-root cap respected on `addMessage` and `addMessageToStore`.
- `useDMStore.test.ts`: `mumbleMessages` cap respected; pending Matrix DM removed on send failure.

**Integration / manual:**

- Cold-start measurement: time-to-first-paint and JS heap snapshot before/after, on a test server with 20 channels × 50 messages.
- 30-minute idle test (the original repro from commit `94cc38c`): private bytes + V8 heap before/after. Expectation: flat.
- Switch-storm: 100× rapid channel switches, no errors or hangs.

## Migration

- No localStorage schema migration required. Read markers untouched. Existing chat history entries shrink to the new cap on the next write.
- The `initialSyncLimit` change is a single-line config edit in `useMatrixClient`.
- The `useDMStore` prop signature changes: `matrixDmMessages` is removed and `activeDmMessages` is read directly from `useMatrixClient`. Callers (`App.tsx`) must be updated in the same change.
