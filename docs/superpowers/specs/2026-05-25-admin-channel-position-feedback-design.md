# Admin Channel Position Feedback Design

## Summary

Improve the admin channel management panel so admins can see the numeric Mumble position that drives channel ordering and receive clear feedback when a position update is rejected.

## Goals

- Show each channel's effective `position` value in `Settings > Admin > Channels`.
- Keep the channel list compact and easy to scan.
- Notify admins when an `admin.updateChannel` save fails, especially when the likely cause is missing Mumble `Write` permission after ACL inheritance is disabled.

## Non-Goals

- Do not change normal sidebar channel rows.
- Do not add inline error state to the edit dialog.
- Do not keep the edit dialog open after a failed save.
- Do not change Mumble ACL authorization rules.

## UX

Admin channel rows will render the channel name on the left and a small right-aligned pill on the right: `Position N`.

If a channel has no explicit `position`, the pill shows `Position 0`, matching Mumble's default ordering value.

When `admin.channelUpdateError` is received, Brmble shows a top-right info notification:

- Title: `Channel position was not saved`
- Detail: `You need Write permission on that channel. Check the channel ACL if inheritance is disabled.`

The notification uses the existing `<Notification>` system and `useNotificationQueue`; no toast or new notification system is introduced.

## Data Flow

`AdminChannelsSection` already receives `channels` with optional `position` metadata. It will render `channel.position ?? 0` in each admin channel row.

`MumbleAdapter` already emits `admin.channelUpdateError` when the server rejects or cannot complete an update. `App.tsx` will listen for this event, register a queued info notification, and render it in the existing notification stack.

## Error Handling

The notification is intentionally informational rather than blocking. A failed save means the attempted channel state change did not persist; the dialog remains closed to preserve the current save flow.

The copy names the most likely cause based on current authorization: the server requires Mumble `Write` permission on the target channel.

## Styling

Use existing admin row styling and CSS custom property tokens only. The pill should be subtle, right-aligned, and not compete with the selected-row state.

## Tests

- Add or update admin channel section tests to assert `Position N` pills render, including default `Position 0`.
- Add or update app-level bridge event tests to assert `admin.channelUpdateError` displays the info notification copy.
