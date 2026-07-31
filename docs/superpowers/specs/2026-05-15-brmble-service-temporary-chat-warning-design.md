# Brmble Service Temporary Chat Warning Design

## Goal

When the Brmble service or Matrix chat service is unavailable while voice is still connected, users should understand that they can keep talking in voice chat but Brmble features are temporarily unavailable. Channel chat should be clearly marked as temporary and non-persistent until Brmble and chat are fully connected again.

## Existing Context

Brmble already tracks service state in `statuses.server` and `statuses.chat`. Channel chat already falls back away from Matrix when `isMatrixChannelChatActive` returns false, including while the Brmble server is reconnecting. `ChatPanel` already supports a `topNotice` prop, currently used for ephemeral Mumble direct messages. App-level notifications already use the shared `Notification` component and notification queue.

## Approach

Derive the warning state from existing service status instead of adding a separate outage flag. A temporary chat state is active when voice remains connected, the selected chat is a normal channel, and either the Brmble server status or Matrix chat status is not `connected`.

While that state is active, the channel `ChatPanel` receives a non-dismissible `topNotice`. The notice uses the existing chat panel warning pattern and stays visible until Brmble and chat are fully connected again.

Banner copy:

> Brmble services are currently unavailable. You can keep talking in voice chat, but new chat messages are temporary and will not be saved.

## Notification Behavior

When Brmble or chat becomes unavailable during an active voice session, show one warning notification through the existing `Notification` framework.

Notification copy:

Title: `Brmble services disconnected`

Detail: `Voice chat is still online. Brmble features are unavailable, and chat messages sent now are temporary and will not be saved.`

The notification is dismissible by the user and does not reappear repeatedly during the same outage. When Brmble and chat are connected again, unregister and clear the notification so an old warning does not remain visible.

## Scope

This change only affects user-facing signaling. It does not change reconnect behavior, Matrix sync behavior, Mumble transport fallback, message persistence, or chat storage.

## Testing

Add or update focused frontend tests for the derived temporary chat state and notification lifecycle. Existing chat mode tests should continue to prove that Matrix channel chat is inactive while the Brmble service is reconnecting.
