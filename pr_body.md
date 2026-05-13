## Summary

This PR fixes multiple companion overlay bugs and adds missing overlay events for self-mute/unmute and server-level user connect/disconnect. It also fixes Matrix message history bleeding into the overlay speech bubble and improves overlay layout for bottom positions.

## Changes

### New overlay events (`overlayModel.ts`, `overlayTypes.ts`, `App.tsx`)
- **Self-mute/unmute balloon:** When a user in the same channel toggles their mute state, a `user-muted` / `user-unmuted` overlay event is now published — previously only `user-joined`/`user-left` triggered in this path.
- **Server-level join/leave balloon:** When `voice.serverMessage` carries a `userJoined`/`userLeft` system type, a server-level event is created via new `createServerMembershipOverlayEvent` and appended to the overlay. These events appear regardless of which channel the local user is in.

### Overlay model stability (`overlayModel.ts`)
- `updateFullCompanionContext` now keeps `representedSession` in sync with the local user's session across reconnects.
- `resolveFullCompanionDisplay` has an early return when the computed state matches the current state, preventing unnecessary re-renders.
- Speaker expiry is now extended during continuous speaking (`SPEAKER_ACTIVE_MS = 50s`) and `pruneOverlaySnapshot` re-extends expiry for actively-speaking speakers so they don't flicker during long voice activity.
- `appendOverlayEvent` now uses `event.timestamp` instead of `Date.now()`, ensuring consistent timestamps for synthetic events.

### Matrix history filtering (`useMatrixClient.ts`, `useMatrixClient.test.ts`)
- Added `overlayLiveSinceRef` that captures `Date.now()` when the initial sync (`PREPARED`) completes.
- The `onTimeline` handler now checks `shouldPublishOverlayEvent` — only events with `getTs() >= liveSince` and `data.liveEvent !== false` are published as overlay balloons. This prevents replaying historical Matrix messages into the companion speech bubble after reconnect.
- Test updated with `vi.useFakeTimers` to properly verify timestamp ordering.

### Overlay CSS layout fix (`CompanionOverlay.css`)
- Converted from `display: grid` to `display: flex` + `flex-direction: column` to support `column-reverse` for bottom-aligned overlays.
- Bottom-left and bottom-right positions now use `flex-direction: column-reverse` so new events stack upward from the bottom edge.

### C# MumbleAdapter fix (`MumbleAdapter.cs`)
- Added `_bridge?.NotifyUiThread()` after `voice.userLeft` to ensure the UI thread processes user-removal events promptly.

## Files Modified

- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`
- `src/Brmble.Web/src/App.screenShareStart.test.ts`
- `src/Brmble.Web/src/App.tsx`
- `src/Brmble.Web/src/components/CompanionOverlay/CompanionOverlay.css`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.test.ts`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayModel.ts`
- `src/Brmble.Web/src/components/CompanionOverlay/overlayTypes.ts`
- `src/Brmble.Web/src/hooks/useMatrixClient.test.ts`
- `src/Brmble.Web/src/hooks/useMatrixClient.ts`

## Testing

- ✅ Updated `App.screenShareStart.test.ts` to verify mute/unmute balloons appear
- ✅ Added test in `overlayModel.test.ts` for server-level join/leave events
- ✅ Fixed `useMatrixClient.test.ts` to use fake timers with proper timestamp ordering
