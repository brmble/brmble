# Scroll To Reference Design

**Date:** 2026-05-09

**Goal:** Let users click a reply preview in chat and smoothly jump to the referenced message when that message is already loaded in the current message list.

---

## Overview

Brmble already renders reply previews inside `MessageBubble`, but those previews are passive. This design turns the reply preview into an interactive navigation control that scrolls the chat view to the original message and briefly highlights it so the destination is easy to spot.

This first version supports only messages that are already loaded in the current chat surface. If the referenced message is missing from the DOM, Brmble does nothing. The click contract stays narrow so future history-loading work can be added behind the same handler without changing the bubble API.

---

## Desired Behavior

### Clicking A Reply Preview

When a message contains reply metadata and Brmble can render a reply preview, clicking that preview should:

1. resolve the referenced message by `replyToEventId`
2. scroll the referenced message into view with smooth centering
3. apply a temporary visual highlight to the referenced bubble
4. remove that highlight automatically after a short delay

### Missing Target

If the original message is not currently rendered in the message list, Brmble should do nothing. There is no toast, inline notice, or fallback scroll target in this version.

### Repeated Jumps

If the user clicks multiple reply previews in sequence, the latest jump wins. Any in-flight highlight timeout should be cleared before applying a new one so stale highlight cleanup does not remove the current flash too early.

### Keyboard And Pointer Access

The reply preview should behave like an interactive control rather than a decorative block. It needs pointer affordance, hover/focus styling, and keyboard activation so the feature is not mouse-only.

---

## Architecture

### Data Flow

1. `ChatPanel` renders each `MessageBubble` with message metadata, including `replyToEventId`
2. `ChatPanel` passes a new `onReplyClick(eventId: string)` callback into `MessageBubble`
3. `MessageBubble` invokes that callback when the reply preview is activated
4. `ChatPanel` resolves the target element from the rendered message list using the existing `data-msg-track` attribute
5. `ChatPanel` calls `scrollIntoView({ behavior: 'smooth', block: 'center' })`
6. `ChatPanel` sets temporary highlight state for the target message id
7. a timeout clears that highlight state after the flash window ends

### DOM Targeting Strategy

Use the existing rendered marker:

- each bubble already receives `data-msg-track={item.message.id}` in `ChatPanel`
- the scroll handler can locate the target with `querySelector('[data-msg-track="...\"]')`

This keeps the feature local to the chat surface and avoids adding new ref plumbing or changing the message model.

### Highlight Ownership

The temporary highlight state should live in `ChatPanel`, keyed by message id. `MessageBubble` should receive a boolean prop such as `isReplyTargetHighlighted` and render an extra CSS class when true.

Keeping this state in `ChatPanel` avoids mixing navigation behavior into the presentation component and lets the jump logic manage timeout cleanup in one place.

---

## Component Changes

### `MessageBubble.tsx`

Add a new prop for reply navigation:

```ts
onReplyClick?: (eventId: string) => void;
isReplyTargetHighlighted?: boolean;
```

Behavior changes:

- render the reply preview as an interactive surface only when both preview content and `replyToEventId` exist
- activate `onReplyClick(replyToEventId)` on click
- support keyboard activation and focus styling
- add a modifier class to the outer bubble when `isReplyTargetHighlighted` is true

The component remains presentation-first: it does not resolve targets or manage scrolling itself.

### `ChatPanel.tsx`

Add a local scroll handler such as `scrollToMessage(eventId: string)` that:

- returns early when `eventId` is missing
- queries the current chat DOM for `[data-msg-track="${eventId}"]`
- exits quietly if the element is not found
- scrolls the element into view with smooth centering
- clears any previous highlight timeout
- marks that message id as highlighted
- removes the highlight after a short timeout

Add the new props to each `MessageBubble` instance:

- `onReplyClick={scrollToMessage}`
- `isReplyTargetHighlighted={highlightedMessageId === item.message.id}`

### Styling

Add interaction styles for the reply preview:

- `cursor: pointer`
- hover/focus treatment that matches the existing chat language
- no layout shift when focused

Add a short flash/highlight style on the target bubble. The highlight should apply to the bubble container so it remains obvious for text, image, and mixed-content messages.

---

## Visual Treatment

### Reply Preview Interaction

The reply preview should visually read as clickable without overwhelming the message body:

- pointer cursor
- subtle background or border accent on hover
- visible focus ring for keyboard users

### Target Flash

The destination message should briefly stand out after the scroll completes. A short-lived highlight or glow on the bubble container is preferred over text-only highlighting because it works for all message shapes.

Recommended direction:

- add a dedicated CSS class such as `.message-bubble--reply-target`
- use a short animation or transition-based flash
- keep the effect noticeable but not disruptive

---

## Error Handling And Scope Boundaries

### Out Of Scope

This design does not include:

- loading older messages when a referenced target is missing
- cross-room or cross-channel reply navigation
- inline notices when a target is unavailable
- URL/deep-link synchronization for jumped messages

### Future Extension Point

The `onReplyClick(eventId)` boundary intentionally leaves room for a future implementation that can:

1. detect missing targets
2. request additional history
3. retry the jump after the target message is rendered

That future work should not require changing `MessageBubble` again.

---

## Testing

Add focused UI tests around the new interaction.

### Happy Path

Render a chat transcript with:

- one original message
- one reply message pointing to the original via `replyToEventId`

Verify that activating the reply preview:

- calls `scrollIntoView` on the referenced message element
- applies the highlighted-target class to the original message
- removes the highlight after the timeout window

### Missing Target

Render a reply whose `replyToEventId` does not exist in the loaded message list. Verify that activating the preview:

- does not throw
- does not apply target highlight state
- does not break the rest of the chat render

### Repeated Clicks

Verify that clicking two different reply previews in sequence:

- moves highlight ownership to the latest target
- clears any previous timeout safely
- leaves only the current target highlighted during the active window

### Accessibility

Verify that the reply preview is keyboard reachable and that activation works through keyboard input in addition to pointer clicks.

---

## Files In Scope

| File | Change |
|------|--------|
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.tsx` | Add reply-click prop, interactive preview behavior, and target-highlight class support |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.tsx` | Add scroll-to-message logic, highlight state, and timeout cleanup |
| `src/Brmble.Web/src/components/ChatPanel/MessageBubble.css` | Add clickable preview styling and target highlight animation/style |
| `src/Brmble.Web/src/components/ChatPanel/ChatPanel.css` | Optional only if shared chat-level highlight styling belongs here |
| `src/Brmble.Web/src/components/ChatPanel/...test...` | Add focused tests for jump behavior and missing-target handling |

---

## Implementation Notes

The recommended implementation is the DOM-target approach rather than a separate ref registry because the current chat surface already exposes stable `data-msg-track` identifiers on rendered bubbles. That keeps the feature small, matches the current architecture, and avoids extra bookkeeping for a first version.
