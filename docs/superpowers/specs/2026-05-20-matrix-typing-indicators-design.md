# Design: Matrix Typing Indicators

**Date:** 2026-05-20
**Status:** Approved (verbal); pending written-spec review

## Overview

Add Matrix typing indicators to Brmble chat for both channel rooms and Matrix DMs. The feature is Matrix-only, shows only other users, and renders named status text near the active composer such as `Alice is typing...` or `Alice and Bob are typing...`.

This should reuse the existing Matrix chat pipeline instead of introducing a new transport or sidebar badge system.

## Goals

- Show remote Matrix typing indicators in the active chat view.
- Support both Matrix-backed channel chat and Matrix DMs.
- Keep all Matrix protocol behavior centralized in the existing Matrix hook.
- Make typing indicators best-effort only so chat sending still works normally if typing updates fail.

## Non-Goals

- Mumble typing indicators.
- Sidebar badges, unread markers, toast notifications, or overlay events for typing.
- Showing the local user a `You are typing...` indicator.
- Persisting typing state across reconnects or room changes.

## Chosen Approach

Use `useMatrixClient.ts` as the single owner for Matrix typing state.

We considered:

1. Centralizing send and receive behavior in `useMatrixClient.ts`.
2. Sending directly from `MessageInput.tsx` while receiving in `useMatrixClient.ts`.
3. Keeping typing state local to `ChatPanel.tsx`.

Option 1 is the chosen design because it matches the current architecture: Matrix room lifecycle, event wiring, DM room mapping, and active-room coordination already live in `useMatrixClient.ts`. That keeps `ChatPanel.tsx` and `MessageInput.tsx` focused on UI and avoids spreading room cleanup logic across multiple components.

## Architecture

### UI flow

- `MessageInput.tsx` detects whether the current draft is meaningfully non-empty.
- It notifies its parent when local typing starts or stops.
- `ChatPanel.tsx` forwards the signal together with the active `matrixRoomId`.
- `App.tsx` passes that signal into `useMatrixClient.ts`.
- `ChatPanel.tsx` renders the current room's remote typing text near the composer.

### Matrix ownership

`useMatrixClient.ts` becomes the single owner for:

- sending throttled Matrix typing updates for the active room
- listening for remote Matrix typing updates
- storing room-scoped typing state
- resolving Matrix user IDs into display names
- exposing derived typing state back to the UI

### Shared room model

The typing system is keyed by Matrix room ID, not by chat mode. That lets channel chat and Matrix DMs use the same code path as long as they already resolve to a `matrixRoomId`.

## Behavior

### Local typing

- When the local user enters non-whitespace text in a Matrix-backed input, Brmble sends `typing: true` for that room.
- `typing: true` requests include a Matrix typing timeout so the homeserver can automatically clear stale state if the client disappears unexpectedly. V1 should use a 30,000 ms timeout and refresh before expiry while the user is still actively typing.
- When the input becomes empty, the message is sent, the room changes, the client disconnects, or the component unmounts, Brmble sends `typing: false`.
- The UI never shows the local user's own typing state.
- Typing should only begin from active draft changes in the current session. Simply rendering a non-empty input value is not enough to broadcast typing state.

### Remote typing

- Incoming typing state is filtered to exclude the current Matrix user.
- Indicators render only for the active room.
- No sidebar or background-room typing display is shown in v1.
- Named text formats:
  - `Alice is typing...`
  - `Alice and Bob are typing...`
  - `Alice, Bob, and others are typing...`

Visible names are capped at two in v1. This keeps the text readable in busy rooms without needing a more complex list treatment.

Remote typing state follows Matrix's room-scoped `m.typing` updates as the source of truth. The homeserver timeout clears stale typers if a client drops unexpectedly, and incoming typing events replace the client's current understanding of who is typing in that room. V1 should not add a second client-side expiry system for remote users unless real-world testing shows a server or SDK gap.

### Scope boundaries

- Matrix-backed channel chat: supported.
- Matrix DMs: supported.
- Mumble-only DMs: ignored.
- Non-Matrix chat paths: no behavior change.

## State Model

Add room-scoped typing state to `useMatrixClient.ts`.

Suggested shape:

```ts
type TypingUser = {
  matrixUserId: string;
  displayName: string;
};

type TypingStateByRoom = Map<string, TypingUser[]>;
```

This does not need persistence. It should be cleared when the Matrix client is reset or replaced.

For local sending, `useMatrixClient.ts` should also keep:

- the currently typed room ID, if any
- a refresh timer for renewing `typing: true`
- the last-known local typing state so duplicate sends can be avoided

The public API can expose either:

- `typingByRoom: Map<string, TypingUser[]>`

or

- `getTypingUsers(roomId: string | null | undefined): TypingUser[]`

The second option is preferred because it keeps the UI read path narrow and discourages accidental external mutation.

## Sending Strategy

Typing updates should be throttled instead of sending on every keystroke.

V1 behavior:

- Send `typing: true` once when typing begins, with a `30000` ms timeout.
- Refresh `typing: true` periodically while the draft remains non-empty, with enough safety margin that the timeout does not expire during active composition.
- Send `typing: false` immediately on clear, send, room change, disconnect, or unmount.

The exact refresh interval does not need to be surfaced in the UI, but it should be comfortably below the timeout. A roughly 20-25 second refresh window is appropriate for v1.

## Display Name Resolution

Remote typing events arrive as Matrix user IDs. The display text should resolve names using the same room-scoped Matrix membership data already available to the client:

1. active room membership display name
2. known live user mapping when applicable
3. raw Matrix user ID as the final fallback

This ensures typing indicators still render usable text even for offline-capable DM contacts or partially synced room membership.

## Error Handling

Typing indicators are best-effort only.

- If sending a typing update fails, log the error and leave normal messaging unaffected.
- If a room switch happens while a refresh timer is active, the old timer must be cancelled before any further typing updates can fire.
- If the Matrix client disconnects or is recreated, local typing state and timers must be cleared.
- If a remote typing event includes users whose names cannot be resolved, fall back gracefully to Matrix identifiers.
- If no `matrixRoomId` is available, typing behavior is inert.

## Accessibility

The typing indicator is dynamic status text and should be exposed to assistive technology.

- Render the indicator in a persistent container with `role="status"` so updates are announced politely by screen readers.
- Keep the live region focused on the current typing sentence only, so it does not re-announce unrelated chat UI.
- Do not use assertive announcements for typing updates.

## Testing

### Unit tests

Add tests around `useMatrixClient.ts` for:

- local typing start sends `typing: true`
- local clear/send/room-change sends `typing: false`
- refresh timers are cancelled when switching rooms
- self is filtered out of incoming typing lists
- display formatting for one user, two users, and 3+ users

Add tests around `MessageInput.tsx` and/or `ChatPanel.tsx` for:

- draft transitions from empty to non-empty emit start-typing
- clearing the draft emits stop-typing
- sending a message emits stop-typing
- indicator renders only when the active Matrix room has remote typers

### Manual verification

- Type in a Matrix channel room from one client and confirm named indicator appears in another.
- Repeat for Matrix DMs.
- Switch rooms while typing and confirm the old room indicator disappears promptly.
- Disconnect and reconnect the Matrix client while typing and confirm no stale indicator remains.
- Verify Mumble-only DM flows remain unchanged.

## Files Expected To Change

Primary:

- `src/Brmble.Web/src/hooks/useMatrixClient.ts`
- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx`
- `src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx`

Tests:

- `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
- `src/Brmble.Web/src/components/ChatPanel/ChatPanel.test.tsx`
- `src/Brmble.Web/src/components/ChatPanel/MessageInput.test.tsx`

## Rollout Notes

This feature is intentionally small and UI-local:

- no protocol or backend changes are required
- no migration is required
- failure mode is graceful degradation to "no typing indicator"

That keeps the implementation suitable for a single focused plan and avoids coupling it to unrelated chat or presence work.
