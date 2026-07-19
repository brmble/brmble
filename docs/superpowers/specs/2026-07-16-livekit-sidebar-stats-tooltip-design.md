# LiveKit Sidebar Stats Tooltip — Design

**Date:** 2026-07-16
**Branch:** `feature/screenshare-quality`
**Status:** Approved (pending written-spec review)

## Goal

Enrich the LiveKit connection dot's hover tooltip in the sidebar status
indicator with an at-a-glance screenshare health readout, for both the
broadcaster and viewers. This is a "quick glance" feature using data the client
already has — no new WebRTC `getStats()` plumbing.

## Non-Goals

- No bitrate / packet-loss / jitter / framerate metrics (would require new
  `getStats()` polling). Explicitly out of scope.
- No change to the shared `Tooltip` component (stays string-only).
- No new UI component, pattern, icon, or setting → no `UI_GUIDE.md` change.

## Content & Format

The LiveKit dot tooltip (`dotTooltip('livekit')` in `Sidebar.tsx`) becomes a
multi-line string, using the existing `\n` convention already used by the voice
and server tooltips. Content adapts to role:

| State | Tooltip |
|-------|---------|
| Available (connected, no room) | `LiveKit: Available` (unchanged) |
| Reconnecting | `LiveKit: Reconnecting` (unchanged) |
| Broadcasting only | `LiveKit: Connected - <quality>`<br>`Broadcasting: 1080p 30fps` |
| Watching only | `LiveKit: Connected - <quality>`<br>`Watching N share(s)`<br>`<name>: <W>×<H> (<quality>)` per share |
| Broadcasting + watching | quality line + Broadcasting line + Watching lines |

Example (watching two shares):

```
LiveKit: Connected - good
Watching 2 shares
alice: 1920×1080 (good)
bob: 1280×720 (fair)
```

Rules:
- The first line is the existing aggregate line
  (`LiveKit: Connected - <screenShareQuality>`); unchanged behavior when
  `screenShareQuality` is `unknown` (line omitted, falls back to existing logic).
- "Watching N shares" uses singular/plural correctly (`1 share` / `2 shares`).
- Per-share line: broadcaster display name, live resolution `W×H` read from the
  share's `<video>` element (`videoWidth`/`videoHeight`), and the per-share
  quality word from `shareQualities`.
- If a share's video element has no dimensions yet (0×0 / not attached), omit the
  resolution and show just `<name> (<quality>)`.
- Per-share quality word maps from `ScreenShareQuality`: `good`/`fair`/`poor`/
  `reconnecting`; `unknown` omits the `(...)` suffix.

## Data Plumbing

`dotTooltip` needs data the Sidebar does not currently receive. Thread new props
from `App.tsx` → `Sidebar`, following the existing pattern (App already passes
`screenShareQuality` and `isLiveKitRoomConnected`):

| New Sidebar prop | Type | Source in App.tsx |
|------------------|------|-------------------|
| `isSharing` | `boolean` | `useScreenShare().isSharing` |
| `broadcastSummary` | `string \| undefined` | preformatted `"1080p 30fps"` built in App from `screenShareSettings` when `isSharing`; `undefined` otherwise |
| `watchingShares` | `ShareInfo[]` | `useScreenShare().watchingShares` |
| `shareQualities` | `Map<number, ScreenShareQuality>` | `useScreenShare().shareQualities` |
| `remoteVideoEls` | `Map<number, HTMLVideoElement>` | `useScreenShare().remoteVideoEls` |

Notes:
- The broadcaster's resolution/fps is passed **preformatted** as
  `broadcastSummary` (decision: keep Sidebar dumb, avoid a settings dependency).
  Format: `` `${resolution} ${fps}fps` `` e.g. `1080p 30fps`.
- Live resolution is read from the `<video>` element at Sidebar render time.
  `dotTooltip` is computed during render (not on hover), so values reflect the
  last render. For a glance readout this is acceptable; the sidebar re-renders on
  quality/state changes, refreshing the numbers.
- All new props are optional with safe defaults so existing Sidebar tests /
  usages that don't pass them keep working.

## Components & Boundaries

- `Sidebar.tsx` — the only component changing. `dotTooltip` gains a helper to
  build the LiveKit multi-line string from the new props. Keep the helper small
  and pure (inputs → string) so it is unit-testable.
- `App.tsx` — passes the five new props; builds `broadcastSummary`.
- No changes to `useScreenShare`, `Tooltip`, or `screenShareQuality.ts`
  (reuse existing `ScreenShareQuality` type).

## Testing

- Update the existing tooltip test in `Sidebar.test.tsx:~217`.
- New cases:
  - Broadcasting only → includes `Broadcasting: 1080p 30fps`.
  - Watching one share → `Watching 1 share` + `alice: 1920×1080 (good)`.
  - Watching two shares → correct pluralization + two per-share lines.
  - Broadcasting + watching → both sections present.
  - Share with no video dimensions → resolution omitted, quality still shown.
  - `unknown` per-share quality → no `(...)` suffix.
  - Backward compatibility: Available / Reconnecting strings unchanged.

## Risks / Edge Cases

- Stale-by-one-render resolution: acceptable for a glance; documented above.
- Long tooltips when watching up to 4 shares: 4 short lines, within tooltip
  sizing already used by multi-line voice/server tooltips.
- Name source: use the same display name already resolved for `watchingShares`
  (`userName`); fall back to the numeric/matrix id if empty.
```
