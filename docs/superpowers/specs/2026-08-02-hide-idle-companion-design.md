# Hide Idle Local Companion

## Goal

Let users hide their own companion while the overlay is idle, so the companion only occupies the overlay when there is activity to show.

## Behavior

- Add an interface setting named `showLocalCompanionWhenIdle`.
- The setting defaults to `true`, preserving the current behavior for existing and new users.
- When enabled, the overlay continues to show the local companion in its idle state.
- When disabled, the overlay has no display during the idle state.
- Activity displays remain unaffected: active speaking, channel/direct messages, join/leave events, and moderation events can still display companions according to their existing category settings.
- Remote users and proxy displays remain unaffected.
- The setting is persisted and normalized with the existing overlay settings.

## Design

The setting belongs in `OverlaySettings` and the Interface settings tab. The overlay model receives the setting when resolving the current full-companion display. Its existing `idleDisplay` path will return no display when the setting is disabled; activity paths continue to create or queue displays normally. The full overlay component already renders nothing for a null active display, so no new rendering mechanism is needed.

When an activity display expires, the resolver will return `null` rather than recreating the idle local display while the setting is disabled. Re-enabling the setting will allow the next resolver pass to restore the idle local display.

## Testing

- Settings normalization includes the new property and preserves the default for older stored settings.
- The Interface settings tab renders the toggle and forwards the updated value.
- The overlay model hides the idle local companion when disabled.
- The overlay model continues to show the local companion when enabled and continues to show activity displays when idle hiding is enabled.

## Scope

No changes are needed to companion selection, speaker detection, event queueing, native bridge messages, or overlay rendering structure.
