## Summary

Adds a new "Screen Share" tab in the Settings modal for configuring screen capture and viewer options, plus a bug fix for re-watching.

### Screen Share Settings Tab
- **Capture Audio** - Toggle to capture microphone audio along with screen share
- **Resolution** - Dropdown to select output resolution: 720p (HD), 1080p (Full HD), 1440p (QHD), 4K (Ultra HD)
- **FPS** - Dropdown to select frame rate: 15, 30, or 60
- **System Audio** - Toggle to include system audio (Windows/macOS only)
- **Viewer Mode** - Choose where to display screen share when watching others:
  - **In-app** - Shows in a split panel within the chat
  - **Full window** - Opens in a full-screen overlay

### Technical Implementation
The UI settings are mapped to LiveKit's `ScreenShareCaptureOptions`:
- Resolution/FPS → `resolution` object with width, height, frameRate
- Bitrate → `videoEncoding.maxBitrate` (2-15 Mbps based on resolution)
- Codec → `videoCodec: 'h264'` for cross-hardware efficiency

### Bug Fix
- **Re-watching** - Fixed a bug where viewers couldn't re-watch a screen share after closing the viewer. Previously, closing the viewer cleared `activeShare` to null, preventing re-watching. Now `activeShare` is only cleared when the sharer actually stops sharing (via the `screenShareStopped` event).

## Testing
1. Open Settings → Screen Share tab - verify all settings appear
2. Toggle capture audio, change resolution/FPS, enable system audio - settings persist
3. Share your screen with different settings - verify options are applied
4. Watch someone else's screen share, close it, then re-watch - should now work
5. Switch between In-app and Full window viewer modes - both work