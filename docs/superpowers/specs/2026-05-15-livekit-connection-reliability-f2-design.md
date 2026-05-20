# LiveKit Connection Reliability F2 Design

**Date:** 2026-05-15
**Status:** Implemented
**Roadmap phase:** F. Connection & Reliability, second slice

## Context

F1 implemented non-voice service reconnect handling for Brmble server, Matrix chat, and screen-share support. It intentionally clears stale LiveKit room state after service loss and requires users to restart sharing or watching manually. That keeps recovery safe, but it does not yet tell users whether an active LiveKit room is healthy before it fails.

F2 covered the connection quality indicator and graceful degradation roadmap items. For this slice, graceful degradation is informational: Brmble explains degraded screen-share conditions and keeps the UI stable during transient LiveKit reconnects, but it does not automatically lower publisher quality, change capture settings, add TURN/ICE infrastructure, or recover crashed rooms.

## Goals

- Show LiveKit screen-share quality in existing Brmble UI surfaces.
- Distinguish available screen-share support from an actively connected LiveKit room with good, fair, poor, or reconnecting quality.
- Keep watched tiles visible during transient LiveKit reconnecting states instead of immediately removing them.
- Surface poor quality and reconnecting states without notification spam.
- Preserve F1 cleanup for terminal LiveKit disconnects, token failures, and service-loss trust-boundary events.

## Non-Goals

- Do not automatically reduce publisher resolution, frame rate, or bitrate.
- Do not prompt users to change quality settings in this slice.
- Do not implement ICE/TURN relay hardening or deployment changes.
- Do not persist or recover LiveKit room state after app, server, or LiveKit process crashes.
- Do not replace the existing service-status model or redesign screen-share layout.

## Chosen Approach

Use LiveKit room and participant events as the source of truth for screen-share quality, then map them into small UI-facing state.

`useScreenShare` already owns the LiveKit `Room`, watched shares, local share lifecycle, reconnect cleanup, and tile video elements. It should also own LiveKit room-quality state. React can derive aggregate Screenshare status from this state and pass per-share quality to screen-share tiles.

This keeps F2 small and avoids WebRTC stats polling. LiveKit already provides high-level quality and reconnect lifecycle signals that are sufficient for user-facing good/fair/poor/reconnecting indicators. More detailed bitrate, RTT, or frame-rate telemetry can be added later under the Performance & Quality roadmap.

## Quality Model

Add a lightweight screen-share quality type in the web layer:

```ts
type ScreenShareQuality = 'unknown' | 'good' | 'fair' | 'poor' | 'reconnecting';
```

Quality meanings:

- `unknown`: no active LiveKit room, no track yet, or LiveKit has not emitted a useful signal.
- `good`: LiveKit reports strong participant quality and the room is connected.
- `fair`: LiveKit reports degraded but usable quality.
- `poor`: LiveKit reports poor quality or equivalent degraded state.
- `reconnecting`: the LiveKit room is reconnecting after a transient network interruption.

The aggregate Screenshare service dot should remain `connected` when the LiveKit room is connected but poor. Poor quality is not the same as a disconnected service. Reconnecting should map to `connecting` only while the room is actively reconnecting. Terminal disconnects continue through the existing interrupted cleanup path.

## React Design

### `useScreenShare`

Extend the hook return value with:

- `roomQuality`: aggregate quality for the current LiveKit room.
- `shareQualities`: map of watched `userId` to quality for individual watched shares.

Bind LiveKit events when a room is created:

- Room reconnecting: set `roomQuality` to `reconnecting` and keep watched shares in place.
- Room reconnected/connected: return `roomQuality` to the best known participant quality or `unknown` until LiveKit emits one.
- Participant connection quality changes: update `shareQualities` for watched remote participants and update `roomQuality` to the worst active watched-share quality when viewing.
- Local participant quality changes, if available from LiveKit: update `roomQuality` while publishing.
- Terminal room disconnected: keep F1 behavior. Notify unexpected watched-share ends, clear watched state, and stop local share if needed.

The hook should not create a second lifecycle system. Quality state resets should happen alongside existing room cleanup paths such as `clearWatchingState`, token refresh failure cleanup, and explicit viewer disconnect.

### Service Status

Reuse `ServiceStatus` for aggregate quality metadata instead of adding a parallel context. Add an optional screen-share quality field or reuse a label field if that keeps the type smaller.

The effective Screenshare dot should show:

- `Available` when Brmble/LiveKit support is connected but no LiveKit room is active.
- `Connected - good/fair/poor` when a LiveKit room is active.
- `Reconnecting` when the active LiveKit room is in a transient reconnect state.
- Existing disconnected/error text for service loss or terminal failures.

Poor quality should appear in tooltip text and visual styling, but should not mark the service as failed.

### Screen-Share Tiles

`ScreenShareTile` should accept optional quality state for the watched share.

Tile behavior:

- `reconnecting`: keep the last video element mounted and show a small overlay such as `Reconnecting...`.
- `poor`: show a subtle status badge or overlay such as `Poor connection`.
- `fair`: optionally show a subdued `Fair connection` tooltip or badge only if it fits existing visual patterns.
- `good`/`unknown`: no extra visual noise.

All styling must use existing CSS tokens and the centralized icon system if an icon is needed.

## Error Handling

- Do not emit repeated notifications for every quality change.
- Quality changes should not block share start, watch start, or stop actions.
- Reconnecting is transient. If LiveKit later emits terminal disconnect, existing F1 cleanup takes over.
- If LiveKit quality events are unavailable in a test or runtime environment, default to `unknown` and keep existing behavior.
- Stale room events must be ignored when `roomRef.current` no longer matches the event source.

## Testing Strategy

### Unit Tests

- Quality mapping helper maps LiveKit quality values to Brmble quality states.
- Worst-quality derivation prefers `poor` over `fair`, `fair` over `good`, and `reconnecting` while the room is reconnecting.
- Unknown or unsupported LiveKit values map to `unknown`.

### Hook Tests

- `useScreenShare` sets room quality to reconnecting on LiveKit reconnecting events without clearing watched shares.
- `useScreenShare` restores quality after reconnect events.
- Remote participant quality changes update the matching watched share quality.
- Terminal room disconnect still clears watched shares and reports unexpected ended notifications.
- Explicit viewer disconnect clears quality for that watched share.

### UI Tests

- Sidebar Screenshare tooltip shows available when no room is connected.
- Sidebar Screenshare tooltip shows good/fair/poor quality for active LiveKit rooms.
- Sidebar Screenshare tooltip shows reconnecting during transient reconnect.
- `ScreenShareTile` shows reconnecting overlay and poor-connection badge without unmounting video.

## Manual Validation

- Start sharing and watching in a normal channel; confirm Screenshare dot shows active quality.
- Simulate LiveKit reconnecting; confirm watched tile stays visible with reconnecting overlay.
- Restore network; confirm reconnecting UI clears without requiring Watch again.
- Simulate poor quality; confirm the UI reports poor quality but does not stop sharing or watching.
- Drop the LiveKit room terminally; confirm existing unexpected-ended cleanup still runs.

## Roadmap Updates

After implementation, update `docs/superpowers/specs/2026-04-17-livekit-feature-roadmap.md`:

- Mark item 36, connection quality indicator, implemented for LiveKit screen-share UI.
- Mark item 37, graceful degradation, implemented as informational reconnecting/poor-quality UI that preserves tile state during transient reconnects.
- Leave item 35, ICE fallback / TURN relay hardening, as future work.
- Leave item 40, share state recovery after crash, deferred.
