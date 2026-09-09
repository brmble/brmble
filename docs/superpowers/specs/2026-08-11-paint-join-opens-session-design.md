# Paint Join Opens Session Design

## Goal

Make **Join paint** open the collaborative paint editor as soon as the join request succeeds, removing the current second **Open paint** click.

## Scope

Change only the join action in `PaintSessionCard`. Existing participants retain the separate **Open paint** action so they can reopen an editor they previously closed. No API, invitation, eligibility, styling, or editor lifecycle changes are required.

## Behavior

When an eligible user presses **Join paint**:

1. The card enters its existing joining state and disables the action.
2. The card awaits `onJoin(sessionId)`.
3. If joining succeeds, the card immediately calls `onOpen(sessionId)`.
4. The card refreshes its session summary in the background so its participant state remains accurate if the editor is later closed.

If joining fails, the editor does not open. The card leaves the joining state and displays the existing error message. A summary refresh failure after a successful join does not block or close the editor because the join request is the authoritative success boundary for this interaction.

## Component Boundary

`PaintSessionCard` composes the existing `onJoin` and `onOpen` callbacks. `App.tsx` keeps its current callback responsibilities: `handleJoinPaint` performs the API join, while `handleOpenPaint` selects and displays the editor. This avoids changing the meaning of the callbacks for other consumers.

## Testing

Update the card regression test to prove that a successful **Join paint** action calls `onJoin` and then `onOpen` with the same session ID without requiring another click. Add or retain coverage proving that a rejected join does not call `onOpen` and displays the join error. Existing coverage for the participant-only **Open paint** action remains unchanged.
