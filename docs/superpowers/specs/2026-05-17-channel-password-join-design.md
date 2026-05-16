# Design: Channel Password Join Prompt

## Goal

When a user tries to join a password-protected voice channel, Brmble should ask for the channel password and retry the join successfully instead of failing with a generic denial.

The change should stay tightly scoped to channel join behavior. It should not redesign the broader ACL editor, connection flow, or saved server password behavior.

## Approved Direction

The approved direction is a fail-then-prompt flow:

1. User attempts to join a channel normally.
2. If the join is denied because the channel requires a password token, Brmble opens a password prompt.
3. User enters the password.
4. Brmble retries the same join with that password as a temporary Mumble access token.

This keeps the default path fast for open channels and only asks for input when the server actually rejects the move.

## Why This Direction

This approach is preferred over preloading ACL state for every channel because:

- it avoids extra ACL fetches and client-side protected-channel bookkeeping during normal browsing
- it works with the server's real authorization decision instead of a client-side guess
- it uses Mumble's existing temporary access token mechanism, which is the native model behind Brmble's channel password rules

## User Experience

The user experience should behave like this:

1. Double-click or press Enter on a channel as usual.
2. If the channel is open, the join succeeds with no extra UI.
3. If the channel is password-protected, show a modal prompt with:
   - title: `Channel Password`
   - message: `Enter the password for <channel name>.`
   - confirm label: `Join`
   - cancel label: `Cancel`
4. If the user cancels, Brmble leaves them in their current channel and clears any pending join state.
5. If the user submits a password, Brmble retries the same join once with that password token.
6. If the retry still fails, Brmble surfaces the denial as a normal error and does not loop endlessly.

The password prompt should not appear for unrelated permission failures such as missing `Enter`, moderator restrictions, or admin-only channels.

## Detection Rules

The retry flow should activate only when the failed join appears to be a password-related denial.

The implementation should use the denial payload already emitted through `voice.error` and match only password/token-specific failures. The exact wording can vary by server, so detection should check the structured type first when available and then fall back to a conservative text match for password/token language.

If the denial reason is ambiguous, Brmble should prefer not to prompt. A missed prompt is safer than showing a password dialog for the wrong kind of access problem.

## Frontend Changes

The web app should own the prompt and retry orchestration.

It should add:

- local state for one pending password-protected join attempt
- a helper that starts a join attempt for a channel id
- `voice.error` handling that recognizes a password-related join denial for the currently pending channel
- a prompt call that asks for the channel password
- a retry call that resends `voice.joinChannel` with the same channel id plus the entered password

The existing generic join entry points should continue to funnel through the same handler:

- channel double-click
- Enter key on a selected channel
- channel context menu join actions

## Native Client Changes

The native bridge contract for `voice.joinChannel` should expand to accept an optional password field.

`MumbleAdapter` should:

- keep the current plain join path unchanged when no password is supplied
- on password retry, submit the join using a temporary access token for that attempt
- avoid storing the channel password as a reconnect password or server password
- clear the temporary token once the join attempt resolves so it does not leak into unrelated future actions

The connect-time server password flow remains separate. Server passwords continue to authenticate the connection itself, while channel passwords authorize access to a specific room.

## Data Boundaries

This feature should treat the channel password as ephemeral join input:

- do not save it to the server list
- do not persist it in app settings
- do not log it
- do not reuse it across different channels automatically

If we later want "remember channel password" behavior, that should be a separate design.

## Error Handling

The flow should handle these cases explicitly:

- wrong password: show the normal denial after one retry
- user cancels prompt: do nothing further
- second denial after retry: stop retrying
- unrelated permission denial: never show password prompt
- stale pending join state after timeout or channel change: clear it so later errors are not misclassified

## Testing

The implementation should add regression coverage before production changes.

Required coverage:

- frontend test: a password-related join denial opens the prompt and retries with the entered password
- frontend test: canceling the prompt does not retry
- frontend test: non-password permission denials do not open the password prompt
- frontend test: a second denial after retry does not reopen the prompt
- native/client test: join handler accepts optional password data and routes password retries through temporary access token behavior without changing normal joins

## Out of Scope

This design does not include:

- showing lock icons on protected channels in the tree
- prefetching ACL snapshots for every visible channel
- saving channel passwords
- redesigning the server-connect password UX
- changing how channel passwords are edited in the ACL editor

## Implementation Notes

There is already ongoing ACL password work in this branch, including managed password marker parsing. This join flow should integrate with that work but remain independent from the ACL editor UI itself.

The key architectural boundary is:

- ACL editing defines whether a channel is password-protected
- join flow reacts only when the server denies access and requests the missing token implicitly through that denial
