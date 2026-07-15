# LiveKit Broadcaster Capture Source Design

Date: 2026-06-05
Status: Approved for implementation planning
Branch: `feature/livekit-broadcaster-controls`

## Context

The LiveKit roadmap includes B. Broadcaster Controls. This slice intentionally starts with a small, low-risk control: a preferred capture source hint for screen sharing. The main user need is game sharing, so Brmble should bias the native picker toward sharing a window while still letting the user choose the final target.

Brmble already has screen share settings for audio capture, system audio, resolution, frame rate, and viewer location. The existing settings tab follows the UI guide by using themed `Select` controls and `SettingsHelp` tooltips. This design extends that pattern and does not introduce a custom picker.

## Goals

- Add a `Preferred Capture Source` setting for screen sharing.
- Default the setting to `Window`, because most Brmble screen shares are expected to be game windows.
- Pass the preference into LiveKit/browser screen-share capture options as a display-surface hint.
- Keep the OS/WebView2 picker user-controlled; Brmble cannot programmatically preselect a game window.
- Use the existing UI guide patterns for settings rows, themed selects, and help text.
- Document current-game window suggestion as a later roadmap item, not part of this slice.

## Non-Goals

- Do not implement native foreground-game/window detection in this slice.
- Do not build a custom window picker.
- Do not theme the native OS/WebView2 capture picker; it is browser/OS-controlled.
- Do not add quality presets, region capture, webcam overlay, or lock/sleep handling in this slice.
- Do not change screen-share viewing behavior.

## User Experience

Add one row to the existing Screen Share settings tab under Screen Capture:

- Label: `Preferred Capture Source`
- Control: existing themed `Select`
- Help: existing `SettingsHelp`
- Help content: `Choose Window for game sharing. Your system picker still asks which window to share.`

Options:

- `Application Window` maps to `displaySurface: 'window'`
- `Full Screen` maps to `displaySurface: 'monitor'`
- `Browser Tab` maps to `displaySurface: 'browser'`
- `Auto` omits the display-surface hint

Default:

- New installs default to `window`.
- Existing settings are normalized by merging with `DEFAULT_SCREEN_SHARE`, so missing saved values also become `window`.

## Data Model

Extend `ScreenShareSettings` with:

```ts
preferredCaptureSource: 'auto' | 'window' | 'screen' | 'browser';
```

The persisted settings object remains stored under `brmble-settings`. No explicit migration is required because existing settings are already merged with `DEFAULT_SCREEN_SHARE` when loaded.

## LiveKit Integration

`useScreenShare.startSharing` currently builds capture options before calling `room.localParticipant.setScreenShareEnabled(true, options)`.

Update that capture-options builder so:

- `preferredCaptureSource === 'window'` sets `video: { displaySurface: 'window' }`
- `preferredCaptureSource === 'screen'` sets `video: { displaySurface: 'monitor' }`
- `preferredCaptureSource === 'browser'` sets `video: { displaySurface: 'browser' }`
- `preferredCaptureSource === 'auto'` keeps `video: true`

Resolution, frame rate, audio, system audio, and encoding behavior remain unchanged in this slice.

## Error Handling

Unsupported or ignored display-surface hints should not produce Brmble-specific errors. Browsers may ignore hints or still show all capture surfaces. Existing screen-share error handling remains responsible for permission denial, picker cancellation, publish failures, and ended tracks.

## Testing

Add or update frontend tests for:

- `ScreenShareSettingsTab` renders the new help button using `SettingsHelp` and no inline help paragraph.
- Changing `Preferred Capture Source` calls `onChange` with the new value.
- `useScreenShare` passes `video.displaySurface = 'window'` by default.
- `useScreenShare` omits the display-surface hint when the value is `auto`.
- Existing capture audio/system audio/resolution/FPS options continue to pass through.

## Deferred Follow-Up

Later B/Overlay work should investigate suggesting the current game window when the user starts sharing. The likely implementation is native foreground-window/process detection, improved by overlay/in-game context once the overlay is active. This should remain a suggestion because web screen capture APIs do not allow Brmble to preselect a specific OS window in the native picker.
