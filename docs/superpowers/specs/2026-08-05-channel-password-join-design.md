# Channel Password Join UX Design

## Goal

Let users enter a password-protected channel without an unexpected voice reconnect, while still giving them a clear choice about remembering the password.

## User experience

When a user joins a password-protected channel, Brmble shows a password prompt with:

- A password field.
- A checked-by-default checkbox labeled **Remember this password**.
- A primary action labeled **Join channel**.
- A cancel action.

Submitting the prompt joins the target channel on the existing Mumble connection using the entered password. If the checkbox is checked, Brmble also saves the password for future joins and reconnects. If it is unchecked, the password is used only for this join and is not persisted.

The prompt shown after a rejected join uses the same behavior and wording. It must not require a reconnect to complete the current join.

The context-menu action **Edit Saved Password** remains available for password-protected channels. It opens a password editor with a normal **Save** action. Saving, clearing, or canceling this editor never reconnects or moves the user. A changed saved password takes effect on the next join or connection; editing it does not retroactively change an already-authenticated channel session.

## Architecture and data flow

The existing Mumble `UserState.TemporaryAccessTokens` path already supports sending a channel password on the active connection. The frontend should use that path for the normal join flow:

1. The password prompt resolves both the entered password and the remember choice.
2. The frontend optionally sends `voice.saveChannelPassword`.
3. The frontend sends `voice.joinChannel` with the password.
4. The native client sends the password as a temporary access token in the channel-join `UserState` packet.

The existing reconnect path remains responsible for loading remembered passwords as authentication access tokens during a future connection. No new reconnect is added to the password prompt flow.

The prompt API needs a small typed extension so an input prompt can expose an optional checkbox and return structured data without breaking existing callers that expect `string | null`. Existing non-password prompts retain their current behavior. The implementation should favor a dedicated password prompt result/helper over making all prompt callers handle an object.

## Copy and interaction rules

- Do not use “Save & reconnect” in user-facing password prompts.
- Use “Join channel” for the join flow.
- Use “Remember this password” for persistence.
- Use “Save” for the saved-password editor.
- Canceling never saves, joins, or reconnects.
- An empty password in the saved-password editor clears the saved value.
- An empty password submitted from the join prompt is treated as cancel/no-op rather than attempting a passwordless protected join.

## Error handling

If the direct join is rejected, preserve the existing password retry behavior: show the password prompt again once, prefilling the saved password when available. Do not save an unchecked password. Do not reconnect as part of retrying.

If saving the remembered password fails, the join should still be attempted with the entered password, and the existing save-error notification should remain available. The password must not be written to logs or error text.

## Testing

Frontend tests should cover:

- Joining with a checked remember option saves the password and sends `voice.joinChannel` with that password, without sending `voice.reconnect`.
- Joining with the checkbox unchecked sends the password for the current join but does not save it or reconnect.
- Canceling the join prompt performs no bridge actions.
- Editing a saved password saves or clears it without reconnecting.
- Existing saved-password prefilling still works.
- A rejected direct join can prompt once for a retry without introducing a reconnect.

Native bridge tests should continue to verify that `voice.joinChannel` places the supplied password in `TemporaryAccessTokens`; no native reconnect behavior change is required.

## Scope exclusions

- No new global setting for reconnect behavior.
- No change to how saved passwords are encrypted or stored.
- No change to Mumble ACL password administration.
- No automatic password probing or repeated retry loop.
