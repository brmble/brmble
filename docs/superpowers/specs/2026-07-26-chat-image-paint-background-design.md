# Chat Image Paint Background Design

**Status:** Draft  
**Last updated:** 2026-07-26

## 1. Purpose

Allow a user to right-click an image posted in the normal chat and start a collaborative paint session using that image as the paint background. The goal is to make it easy to turn a shared chat image into a paint canvas without leaving the chat flow.

## 2. Scope

This change includes:

- A new context-menu action on image attachments in the normal chat timeline.
- Reusing the existing collaborative paint setup flow with the chosen chat image preselected as the source image.
- Downloading the chat image into a usable local file/blob for the paint setup flow.
- Handling failure cases when the image cannot be prepared for paint.
- Test updates for the new menu action and the prefilling behavior.

This change does not include:

- Adding the action to the enlarged image preview overlay.
- Changing how paint sessions are drawn, synced, or saved once a session starts.
- Allowing users to replace the selected image inside an already running paint session.

## 3. User Experience

When the user right-clicks an image in the chat message list, the message image shows a context menu item labeled **Use as paint background**.

Selecting that action opens the existing **Start collaborative paint** dialog with that image already selected as the source image.

The user still chooses participants and clicks **Start paint** to create the session. The right-click action does not immediately create a paint session.

If the image cannot be prepared, the user stays in chat and sees an error message explaining that the image could not be used as a paint background.

## 4. Functional Requirements

### 4.1 Image Context Menu Entry

1. The image attachment in a normal chat message must respond to right-click.
2. The image-specific menu must include **Use as paint background**.
3. The action must only appear for image attachments that can be used as a paint source.
4. Existing message actions, such as copying or reacting, must continue to work unchanged.

#### Acceptance Criteria

- Given an image message in the normal chat, when the user right-clicks the image, then a menu item labeled **Use as paint background** is shown.
- Given a non-image message, when the user right-clicks it, then the paint-background action is not shown.
- Given a redacted or unavailable image attachment, when the user right-clicks it, then the paint-background action is not shown.

### 4.2 Prefill the Paint Setup Flow

1. Selecting **Use as paint background** must open the existing collaborative paint setup dialog.
2. The selected chat image must appear as the dialog's source image immediately.
3. The dialog must continue to support participant selection and the normal **Start paint** action.
4. The user must be able to cancel without creating a paint session.

#### Implementation Notes

The chat image should be downloaded into a local blob or file representation and passed into the existing paint setup flow as the initial source image. When available, the implementation should preserve the original filename and MIME type so the paint upload behaves like a normal selected file. The implementation should reuse the current paint session creation path rather than creating a separate paint-start flow.

#### Acceptance Criteria

- Given a usable image attachment, when the user selects **Use as paint background**, then the paint setup dialog opens with that image already selected.
- Given the dialog is open with a preselected image, when the user clicks **Start paint**, then the new session uses that image as the source image.
- Given the user cancels the dialog, then no paint session is created.

### 4.3 Failure Handling

1. If the image cannot be fetched, decoded, or converted into a file/blob for paint setup, the action must fail gracefully.
2. The user must remain in the chat view.
3. The app must surface a visible error message.
4. The failure must not create a half-configured paint session.

#### Acceptance Criteria

- Given the image bytes cannot be prepared, when the user selects **Use as paint background**, then the paint setup dialog does not open and an error is shown.
- Given the image preparation fails after the user opened the menu, then no paint session is created.
- Given a failure occurs, the user can try again from the same message image.

## 5. Behavior Boundaries

- The feature applies only to images posted in the normal chat timeline.
- The feature does not add a second entry point inside the enlarged image preview.
- The feature starts a new collaborative paint session using the chat image as the initial source.
- The feature does not modify the active paint canvas of an already running session.

## 6. Test Requirements

Add or update tests to verify:

- Right-clicking an image message shows **Use as paint background**.
- Right-clicking non-image content does not show the action.
- Choosing the action opens the paint setup dialog with the image preselected.
- Starting paint from the dialog uses the chosen chat image as the source.
- Cancelling leaves the user in chat and does not create a session.
- Image download or preparation failure shows an error and does not create a session.

## 7. Definition of Done

This work is complete when:

- The chat image context menu contains a working **Use as paint background** action.
- The action reuses the existing collaborative paint setup flow.
- The selected chat image becomes the paint session's initial source image.
- Failure cases are handled without starting a broken session.
- Tests cover the new menu path and the prefilled setup behavior.
