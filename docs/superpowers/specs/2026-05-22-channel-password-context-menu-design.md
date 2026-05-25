# Channel Saved Password Context Menu Design

## Goal

Allow normal users to save a password for a password-protected channel so they do not need to re-enter it the next time they connect to the same server.

## Mumble Model

Mumble channel passwords are access-token ACLs. An admin creates server-side ACL rules such as `#secret` to allow users who present token `secret` to enter the channel. Brmble already exposes this admin/server-side behavior through `Edit Permissions` and `acl.setChannelPassword`.

Mumble clients also let users store access tokens locally. On connection, those tokens are sent in `Authenticate.tokens`. During a single channel move, a client can also send `UserState.temporary_access_tokens`. Brmble already uses the temporary path for password prompts while joining.

This feature is about the user/client-side saved-token path, not admin ACL editing.

## Current Behavior

When a user attempts to join a Brmble-managed password-protected channel, Brmble prompts for a password and retries the join with `voice.joinChannel({ channelId, password })`. The native client sends the password as `UserState.temporary_access_tokens`, so it works only for that join attempt and is not remembered after reconnect.

Brmble currently connects to Mumble with `Array.Empty<string>()` for `Authenticate.tokens`, so no saved access tokens are sent on reconnect.

## Design

Replace the earlier admin-oriented `Edit Password` context-menu behavior with a non-admin saved-password action.

Add one item to the channel context menu:

- Label: `Edit Saved Password`
- Visible for channels with `hasPasswordRestriction === true`
- Not gated by channel admin ACL edit permissions
- Does not call `acl.setChannelPassword`

Prompt copy:

- Title: `Saved Channel Password`
- Message: `Enter the password for <channel>. Leave blank to forget the saved password.`
- Placeholder: `Password`
- Confirm label: `Save`
- Cancel label: `Cancel`
- Password input: enabled

On save:

- Non-empty password: save encrypted local token metadata for the active server and channel id.
- Empty password: remove the saved password for that server and channel id.
- Cancel: do nothing.

On connect/reconnect:

- Native client loads saved passwords for the active server.
- Native client decrypts them.
- Native client passes the unique token values to Mumble through `Authenticate.tokens`.

Although Brmble stores saved passwords per channel for UX clarity, Mumble evaluates tokens at the server/session level. If two channels use the same token, one saved password may unlock both. That is normal Mumble behavior.

## Storage

Saved channel passwords are stored locally in native app config, encrypted with the existing secure password storage mechanism used for saved server passwords.

The storage record should include:

- server identity, based on the saved server entry or current connection target;
- channel id;
- channel name for UI display/debugging only;
- encrypted password token.

Plaintext passwords must not be exposed in React channel payloads, logs, or docs.

## Existing Join Prompt

This design does not require changing the current password-on-join prompt in the first implementation. The right-click action provides explicit persistence. A later improvement can offer “remember this password” after a successful temporary password join.

## Superseded Direction

The first implementation draft added a channel context-menu action that called `acl.setChannelPassword`. That edits the server-side ACL password and belongs to `Edit Permissions`, not the non-admin saved-password flow. It should be removed/reworked.

## Error Handling

- Saving failure should surface as a native bridge error or existing UI error path, not as a new notification system.
- If decrypting one saved token fails, skip that token and continue connecting with the remaining valid tokens.
- Wrong saved passwords simply fail Mumble access checks; users can update or remove the saved password from the channel context menu.

## Testing

Add coverage for:

- channel context menu shows `Edit Saved Password` for password-protected channels without requiring admin permission;
- channel context menu does not show the action for unrestricted channels;
- saving a non-empty password calls the new saved-token bridge/config path, not `acl.setChannelPassword`;
- saving an empty password removes the saved channel password;
- canceling makes no save/remove call;
- native config encrypts saved channel passwords at rest;
- native connect passes decrypted saved channel passwords as `Authenticate.tokens`;
- duplicate saved password values are de-duplicated before authentication.
