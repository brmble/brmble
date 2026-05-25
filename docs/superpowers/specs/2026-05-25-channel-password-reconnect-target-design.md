# Channel Password Reconnect Target Design

## Goal

When a user saves, changes, or removes a saved channel password and the app reconnects to authenticate `Authenticate.tokens`, Brmble should try to enter that channel after reconnect completes.

## Approach

Use a native one-shot reconnect target. The frontend sends `voice.reconnect` with the channel ID that triggered the save. The native client stores that channel ID only for the next reconnect. After `ServerSync` completes and the saved channel passwords have been sent through `Authenticate.tokens`, native joins the target channel with a normal `voice.joinChannel`-equivalent `UserState` that does not include a temporary password token.

## Behavior

- Join password prompt sends `voice.saveChannelPassword` and then `voice.reconnect` with `{ channelId }`.
- `Edit Saved Password` sends the same reconnect target after saving or removing the password.
- Native clears the target after attempting the post-reconnect join.
- If the automatic post-reconnect join fails, existing permission-denied behavior applies. The frontend should not immediately open another password prompt from that automatic attempt.

## Rationale

This keeps channel password authentication on the connect-time `Authenticate.tokens` path while still delivering the user's intended action: enter the channel whose saved password changed. Keeping the target in native code avoids frontend races around reconnect state and mirrors existing reconnect/last-channel handling.

## Tests

- Frontend tests assert `voice.reconnect` includes the target channel ID for prompt and edit-password flows.
- Native bridge tests assert `voice.reconnect` accepts a channel target and emits reconnecting.
- Native lifecycle tests assert `ServerSync` attempts one passwordless join to the reconnect target and then clears it.
