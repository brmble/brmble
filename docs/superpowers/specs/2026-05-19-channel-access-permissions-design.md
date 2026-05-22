# Channel Access Permissions Design

## Goal

Make Brmble understand Mumble channel access well enough to:

- show Mumble-like lock icons on restricted voice channels;
- prompt for a password only when Brmble knows a channel has a password restriction;
- treat denied voice entry as non-fatal access feedback;
- gate Matrix channel chat, unread badges, and message sending with Mumble `TextMessage` permission.

Mumble remains the source of truth. Brmble should not duplicate Mumble's ACL evaluator.

## Mumble Access Model

Mumble exposes voice entry state through `ChannelState`:

- `is_enter_restricted`: the channel has an ACL rule denying `Enter`.
- `can_enter`: the current client can enter this channel.

These fields are per recipient. Two users can receive different `can_enter` values for the same channel.

Mumble clients render locks from these fields:

- no lock: `is_enter_restricted = false`;
- open lock: `is_enter_restricted = true` and `can_enter = true`;
- closed lock: `is_enter_restricted = true` and `can_enter = false`.

Failed joins are reported with `PermissionDenied`. For denied channel entry this is usually `type = Permission`, `permission = Enter`, and `channel_id = targetChannel`. Mumble does not expose a dedicated "password required" denial type.

## Password Restrictions

Mumble channel passwords are ACL access-token conventions, not a separate channel field.

A password such as `secret` becomes a token group named `#secret`. A typical password-protected channel has:

- an `@all` ACL denying entry and related permissions;
- a `#secret` ACL granting those permissions back to users who present token `secret`.

Brmble should distinguish only Brmble-managed password restrictions. Native or unknown Mumble ACLs remain generic restricted access.

Brmble-managed password detection must not expose the plaintext password to React. The client only needs a boolean such as `hasPasswordRestriction`.

When a user attempts to enter a Brmble-managed password-restricted channel, Brmble prompts for a password and sends it as a temporary access token for that join attempt. The token must not be persisted in local storage or saved as a server access token.

## Chat Access Model

Matrix channel chat access is based on Mumble's effective `TextMessage` permission, checked server-side through ICE:

```csharp
ServerPrx.hasPermission(sessionId, channelId, PermissionTextMessage)
```

This determines whether a Brmble user can:

- open a channel chat;
- fetch or display unread badges for that channel;
- fetch/display Matrix messages for that channel;
- send Matrix messages to that channel.

Brmble should not manually compute this from ACL rows. Mumble ACL semantics include inheritance, group rules, access tokens, user IDs, special groups, and deny precedence. ICE `hasPermission` already applies the correct server logic.

For now, Matrix room membership may remain broad. The Brmble UI and Brmble APIs must treat Mumble `TextMessage` permission as the authorization gate for channel chat behavior.

## Backend Design

Extend the ACL service with a text-message permission check:

```csharp
Task<bool> HasTextMessagePermissionAsync(int sessionId, int channelId);
```

Implementation delegates to:

```csharp
IMumbleAclIceClient.HasPermissionAsync(sessionId, channelId, MumbleServer.PermissionTextMessage.value)
```

Add a Brmble API endpoint that returns channel chat access for the current authenticated user. The endpoint resolves the user's live Mumble session through existing session mapping, then calls the ACL service for relevant channel IDs.

The response should be simple and explicit:

```json
{
  "channels": {
    "1": { "canRead": true, "canSend": true },
    "2": { "canRead": false, "canSend": false }
  }
}
```

For Brmble's initial model, `canRead` and `canSend` are both derived from `TextMessage`. If later requirements need read-only channels, the response shape already allows separating them.

Unread badge endpoints or data fetches must filter out channels without `canRead`.

## Native Client Bridge Design

Forward complete channel entry state from `MumbleAdapter` to React on both initial snapshots and channel updates:

```ts
{
  id: number,
  name: string,
  parent?: number,
  isEnterRestricted?: boolean,
  canEnter?: boolean,
  hasPasswordRestriction?: boolean
}
```

Forward full `PermissionDenied` details instead of only a generic message:

```ts
{
  type: 'permissionDenied',
  denyType: string | number,
  permission?: number,
  channelId?: number,
  session?: number,
  reason?: string,
  name?: string,
  message: string
}
```

Join attempts use normal `UserState.channel_id` unless a password is entered. Password joins use `UserState.temporary_access_tokens` with the submitted password.

## React Design

Add channel model fields:

```ts
interface Channel {
  id: number;
  name: string;
  parent?: number;
  isEnterRestricted?: boolean;
  canEnter?: boolean;
  hasPasswordRestriction?: boolean;
  canOpenChat?: boolean;
  canSendChat?: boolean;
}
```

Channel tree rendering follows the UI guide and existing icon patterns:

- no icon for unrestricted channels;
- open lock icon for restricted channels the user can enter;
- closed lock icon for restricted channels the user cannot enter.

Chat navigation, unread badges, message history loading, and send actions must check `canOpenChat`/`canSendChat` before using Matrix channel data.

## Join UX

When a user clicks a channel:

1. If `canEnter` is true, send a normal join.
2. If `canEnter` is false and `hasPasswordRestriction` is true, prompt for a password.
3. If the user submits a password, send a join with that password as a temporary access token.
4. If the user cancels, do nothing.
5. If the join fails after a password prompt, show a non-fatal message such as "Incorrect password or no access."
6. If `canEnter` is false and no password restriction is known, show a non-fatal access-denied message.

Denied joins must not mark the voice service as disconnected or broken.

## Error Handling

`PermissionDenied` should be classified by structured fields:

- `permission == Enter` and `hasPasswordRestriction`: password retry or password failure UX;
- `permission == Enter` without known password restriction: access denied;
- `permission == TextMessage`: chat permission denied;
- `denyType == ChannelFull`: channel full message;
- other denial: generic non-fatal permission message.

The human-readable `reason` is display/logging text only. It must not drive core routing logic.

## Testing

Add tests for:

- `HasTextMessagePermissionAsync` delegating to `PermissionTextMessage`;
- chat access endpoint filtering/response behavior;
- bridge payloads including `canEnter` and full `PermissionDenied` fields;
- channel lock icon rendering;
- password prompt and temporary-token join flow;
- chat navigation and unread badge gating by `canOpenChat`;
- message send gating by `canSendChat`.

## Non-Goals

- Do not persist submitted channel passwords as Mumble access tokens.
- Do not manually implement Mumble's effective ACL evaluator in Brmble.
- Do not make Matrix room membership the source of truth for channel chat access in this phase.
- Do not expose plaintext channel passwords to React.
