# Optional Notification Settings Design

**Date:** 2026-05-15
**Status:** Approved design

## Context

Brmble has a shared top-right notification system in `App.tsx` backed by `Notification` and `useNotificationQueue`. The Messages settings tab currently exposes `Message Notifications` through `messages.notificationsEnabled`, but that setting is not used to gate the optional top-right notifications requested here.

Some top-right notifications are critical, one-time, or recovery-oriented and should remain outside user notification preferences. This design adds settings only for repeatable optional notifications that users may reasonably want to suppress.

## Goals

- Replace the current Messages tab notification control with opt-out wording: `Disable optional notifications`.
- Default the global opt-out to off.
- Add individual optional notification category toggles that default on.
- Preserve individual category choices when the global opt-out is enabled.
- Gate only the requested optional top-right notifications.
- Leave warning, recovery, update, and other one-time notifications untouched.

## Non-Goals

- Do not add OS-level notifications.
- Do not change taskbar/tray unread badges.
- Do not change Matrix unread counts or sidebar badges.
- Do not change bottom-center toast behavior beyond notifications explicitly listed here.
- Do not add settings for critical warnings, update notices, broken certificate recovery, kicked/banned notices, server import confirmation, service outage warnings, or copy feedback.

## Settings Model

Replace `messages.notificationsEnabled` with explicit optional notification settings:

```ts
interface MessagesSettings {
  ttsEnabled: boolean;
  ttsVolume: number;
  ttsVoice: string;
  notificationsDisabled: boolean;
  notificationRemoteScreenShare: boolean;
  notificationScreenShareStatus: boolean;
  notificationIdleWarning: boolean;
  notificationMovedChannel: boolean;
}
```

Defaults:

```ts
notificationsDisabled: false,
notificationRemoteScreenShare: true,
notificationScreenShareStatus: true,
notificationIdleWarning: true,
notificationMovedChannel: true,
```

`notificationsDisabled` is an effective global override. It does not mutate the individual category settings.

Example behavior:

- Stored state: `notificationsDisabled: false`, all categories on except `notificationIdleWarning: false`.
- User turns `Disable optional notifications` on.
- UI shows all optional notification categories as off/disabled, but stored `notificationIdleWarning` remains false and the other stored category values remain true.
- User turns `Disable optional notifications` off.
- UI restores the previous stored category choices: idle warning remains off, the other categories return on.

## Messages Settings UI

In `MessagesSettingsTab`, keep the existing Text-to-Speech section and replace the Notifications section with:

- `Disable optional notifications`
  - Description: `Hide optional pop-up notifications. Critical warnings and one-time account or update notices may still appear.`
  - Default off.
- `Screen share invitations`
  - Covers remote screen share started notifications with the `Watch` action.
- `Screen share status`
  - Covers local screen share ended/failed and watched share ended/unexpectedly ended notifications.
- `Idle reminders`
  - Covers the idle pre-leave warning.
- `Channel move notices`
  - Covers moved channel and moved out of voice notifications.

When `Disable optional notifications` is on, category toggles remain visible but are disabled and visually shown as off. Toggling the global control back off restores the category toggles to their stored values.

## Notification Gating

Add small helper logic in `App.tsx` so notification registration/creation checks the effective settings before registering with `useNotificationQueue`.

Effective category enabled rule:

```ts
const enabled = !messages.notificationsDisabled && messages[categoryKey];
```

Gate these notifications:

- Remote screen share started with `Watch`: `notificationRemoteScreenShare`.
- Local screen share ended/failed: `notificationScreenShareStatus`.
- Watched share ended/unexpectedly ended: `notificationScreenShareStatus`.
- Idle pre-leave warning: `notificationIdleWarning`.
- Moved channel / moved out of voice: `notificationMovedChannel`.

If a notification becomes disabled after it is already visible, clear it and unregister its queue ID where practical so disabled categories do not leave stale optional notifications on screen.

## Notifications Left Ungated

These remain unchanged:

- Update available / installing.
- Broken certificate recovery.
- Server imported.
- Kicked or banned from server.
- Brmble service warning / temporary chat warning.
- Copy to clipboard success/failure.
- Idle auto-left voice.
- Idle auto-leave cancelled.
- Native tray and taskbar unread badges.

## Compatibility

Existing saved settings may still contain `messages.notificationsEnabled`. The new defaults should be merged in the same way existing settings are merged. No migration is required for the old field unless implementation finds it useful to delete stale data before saving.

For existing users, the new optional notification defaults should behave like today: optional notifications remain enabled unless the user changes the new settings.

## Testing

Add or update tests to cover:

- `MessagesSettingsTab` defaults `Disable optional notifications` off and all category toggles on.
- Enabling `Disable optional notifications` displays category toggles as off/disabled without overwriting stored category choices.
- Disabling `Disable optional notifications` restores previous category choices.
- Remote screen share notification does not register when its category is effectively disabled.
- Screen share ended and watched share ended notifications do not register when screen share status is effectively disabled.
- Idle pre-leave notification does not register when idle reminders are effectively disabled.
- Moved channel notification does not register when channel move notices are effectively disabled.
- Ungated warnings or one-time notifications are not accidentally blocked by optional notification settings.

## Success Criteria

- Users can globally suppress optional top-right notifications with `Disable optional notifications`.
- Users can independently disable the four requested optional notification categories.
- The global opt-out preserves previous individual category choices.
- Critical/recovery/update notifications still appear.
- Defaults preserve current behavior for existing and new users.
