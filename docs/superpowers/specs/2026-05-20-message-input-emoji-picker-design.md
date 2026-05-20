# Message Input Emoji Picker Design

## Summary

Add an emoji button to the end of the chat message input bar so users can insert supported emotes into the message they are composing, not just react to existing messages. Selecting an emoji inserts it at the current textarea caret position, preserves the rest of the draft, and returns focus to the textarea.

## Goals

- Let users add supported emotes while composing a message.
- Place the emoji trigger directly in the existing message input bar.
- Reuse the existing supported reaction emoji set so message-composer emoji choices stay consistent with reactions.
- Preserve the current composer behaviors for mentions, replies, image attachments, multiline input, and send.

## Non-Goals

- Adding a full Unicode emoji browser or search experience.
- Expanding the supported emoji catalog beyond the existing reaction set.
- Changing backend, Matrix, or Mumble message transport behavior.
- Replacing the existing reaction context-menu flow.

## User Experience

The message composer gains a new emoji button at the trailing end of the input controls, adjacent to the existing send button.

When the user clicks the emoji button:

- A compact emoji picker popover opens from the composer.
- The picker displays the same supported emoji list currently used for reactions.
- The picker remains local to the composer and does not affect message send state.

When the user selects an emoji:

- The emoji is inserted at the textarea's current cursor position.
- If the user has selected text, the emoji replaces the selected range.
- The draft content before and after the insertion is preserved.
- Focus returns to the textarea.
- The cursor is placed immediately after the inserted emoji.
- The picker closes.

The picker also closes when:

- The user clicks outside the composer/picker.
- The user presses `Escape`.
- Mention autocomplete becomes active.

If the composer is disabled, the emoji trigger is disabled as well and the picker cannot be opened.

## Architecture

This feature stays fully inside the existing web composer and does not require app-level or backend changes.

### Primary integration point

Modify [src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx](/C:/PrOgram%20project/brmble/brmble/src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx) to:

- Track emoji-picker open state.
- Render the emoji trigger button.
- Render the emoji picker popover.
- Insert emoji into the current draft using the textarea selection.
- Restore focus and selection after insertion.

### Shared emoji source

Reuse `SUPPORTED_REACTIONS` from [src/Brmble.Web/src/utils/chatReactions.ts](/C:/PrOgram%20project/brmble/brmble/src/Brmble.Web/src/utils/chatReactions.ts) as the single source of truth for composer emoji choices.

This avoids duplicating emoji lists and keeps reactions and message composition aligned.

### Styling

Modify [src/Brmble.Web/src/components/ChatPanel/MessageInput.css](/C:/PrOgram%20project/brmble/brmble/src/Brmble.Web/src/components/ChatPanel/MessageInput.css) to add:

- Emoji trigger button layout within the input bar.
- Emoji picker popover positioning and appearance.
- Emoji option button styling, including hover and focus-visible states.
- Disabled-state styling consistent with the existing send button and composer controls.

## Detailed Behavior

### Insertion logic

Add a helper in `MessageInput` that:

1. Reads `selectionStart` and `selectionEnd` from the textarea.
2. Builds a new message string from:
   - content before the selection
   - the selected emoji
   - content after the selection
3. Updates the `message` state with the new string.
4. Closes the picker.
5. Uses `requestAnimationFrame` to:
   - refocus the textarea
   - restore the caret immediately after the inserted emoji

If the textarea ref is unavailable, the helper should no-op safely.

### Composer interactions

The feature must preserve all existing composer behavior:

- `Enter` still sends the message when mention autocomplete is not capturing it.
- `Shift+Enter` still inserts a newline.
- Mention autocomplete continues to work from the updated message text.
- Reply state remains unchanged.
- Image attachment, paste, and drag/drop behavior remain unchanged.

To avoid overlapping transient UI, activating the mention dropdown should close the emoji picker.

### Accessibility

The emoji trigger and emoji options should be keyboard-focusable buttons with accessible labels. The picker should support dismissal via `Escape`, and focus should return to the textarea after emoji selection.

## Error Handling

This feature is local draft manipulation, so no new network or persistence error handling is required.

The component should safely handle:

- Missing textarea refs during transient render timing.
- Disabled composer state.
- Empty drafts.
- Selected text replacement.

All of these cases should fail gracefully without affecting send behavior or existing draft content outside the selection.

## Testing Strategy

Add focused component tests around `MessageInput`.

Required coverage:

- The emoji button renders in the composer.
- Clicking the emoji button opens the picker.
- The picker renders the supported emoji set from `SUPPORTED_REACTIONS`.
- Selecting an emoji inserts it at the current caret position.
- Selecting an emoji replaces the current selected range.
- Focus returns to the textarea after insertion.
- The picker closes after selection.
- The picker closes on outside click.
- The picker closes on `Escape`.
- The picker cannot be opened when the composer is disabled.
- Mention activation closes the emoji picker.

Testing should stay at the React component level; no backend or end-to-end coverage is required for this change.

## Files Expected To Change

- [src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx](/C:/PrOgram%20project/brmble/brmble/src/Brmble.Web/src/components/ChatPanel/MessageInput.tsx)
- [src/Brmble.Web/src/components/ChatPanel/MessageInput.css](/C:/PrOgram%20project/brmble/brmble/src/Brmble.Web/src/components/ChatPanel/MessageInput.css)
- MessageInput component test file in `src/Brmble.Web/src/components/ChatPanel/` or the repo's existing frontend test location for this component

## Success Criteria

- Users can open an emoji picker from the message composer.
- Users can insert supported emoji into draft messages at the current cursor position.
- Existing composer behaviors continue working unchanged.
- Supported emoji remain centrally defined and reused between reactions and composer insertion.
