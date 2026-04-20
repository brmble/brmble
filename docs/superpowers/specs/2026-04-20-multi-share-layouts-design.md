# Multi-Share Layouts (Sub-project A2) — Design Spec

**Date:** 2026-04-20
**Status:** Designed
**Depends on:** Sub-project A (Multi-Share Foundation) — completed
**Branch:** TBD (will branch from `docs/livekit-feature-roadmap` after merge, or from `main`)

## Overview

Add multi-view grid layout, click-to-focus, and toggle-based watch management to the existing multi-share infrastructure. Viewers can watch up to 4 streams simultaneously in a responsive grid, click any stream to focus/enlarge it, and toggle watching on/off directly from the sidebar monitor icons.

## Use Case

Social/gaming: friends sharing gameplay or browsing together. Viewers want to see what everyone is doing at a glance, with the ability to focus on one stream when something interesting happens.

## Features

### 1. ScreenShareGrid Component

A single component replaces the existing `ScreenShareViewer`. It adapts its layout based on the number of watched streams and whether one is focused.

**Component hierarchy:**

```
ChatPanel
  └── ScreenShareGrid
        ├── ScreenShareTile  (stream 1)
        ├── ScreenShareTile  (stream 2)
        ├── ScreenShareTile  (stream 3)
        └── ScreenShareTile  (stream 4)
```

**`ScreenShareGrid` props:**
- `watchingShares: ShareInfo[]` — streams being watched (1-4)
- `focusedShare: ShareInfo | null` — which stream is enlarged (null = equal grid)
- `videoElements: Map<number, HTMLVideoElement>` — keyed by userId
- `onFocus: (share: ShareInfo | null) => void` — set/clear focus
- `onClose: (share: ShareInfo) => void` — stop watching one stream

**`ScreenShareTile` props:**
- `videoEl: HTMLVideoElement`
- `sharerName: string`
- `isFocused: boolean`
- `isThumbnail: boolean`
- `onClose: () => void`
- `onClick: () => void`

`ScreenShareTile` contains the video element, name label (always visible), close (X) button (always visible), and fullscreen button (hover-only). Reuses the existing visual style from `ScreenShareViewer`.

`ScreenShareViewer` is retired. `ScreenShareGrid` with a single stream renders identically to the old single viewer.

### 2. Layout Modes

The grid layout is controlled by a CSS data attribute on the container:

| Streams | Focus | `data-layout` | Behavior |
|---------|-------|---------------|----------|
| 1 | — | `single` | Full width, single video. Same as current viewer. |
| 2 | none | `grid-2` | Side by side, equal width. |
| 3 | none | `grid-3` | Top row: 2 tiles. Bottom row: 1 tile full width. |
| 4 | none | `grid-4` | 2x2 grid, all tiles equal. |
| 2 | yes | `focused-2` | Focused ~75% width + 1 thumbnail right. |
| 3 | yes | `focused-3` | Focused ~75% width + 2 thumbnails stacked right. |
| 4 | yes | `focused-4` | Focused ~75% width + 3 thumbnails stacked right. |

The grid lives in the same split-panel area as the current viewer (above the chat divider in `ChatPanel`). The existing draggable split divider still controls how much vertical space the grid vs. chat gets.

### 3. Focus Interaction

- **Click a tile in grid mode** → that stream becomes focused (large), others become thumbnails on the right.
- **Click a thumbnail in focused mode** → focus swaps to the clicked thumbnail.
- **Click the focused stream** → focus clears, returns to equal grid.
- **Press Esc** → focus clears, returns to equal grid.
- Focused tile gets a highlight border (e.g. `var(--accent-primary)` or `#4a6cf7`).

### 4. Sidebar Monitor Icon Toggle

The monitor icon in the channel tree user list becomes a toggle:

- **Not watching** (outline/default icon): click → `connectAsViewer(share)`, adds to `watchingShares[]`.
- **Watching** (highlighted/filled icon): click → `disconnectViewer(share)`, removes from `watchingShares[]`.

Visual indicator: the monitor icon for a stream you're currently watching should be visually distinct (filled, highlighted, or use `var(--accent-primary)` color).

### 5. Max 4 Streams

- Maximum of 4 simultaneous watched streams.
- If the user clicks a 5th monitor icon while already watching 4, the oldest non-focused stream is replaced by the new one.
- No error/modal — seamless replacement.

## Hook Changes (`useScreenShare`)

### State Changes

Replace:
- `watchingShare: ShareInfo | null` → `watchingShares: ShareInfo[]`
- `remoteVideoEl: HTMLVideoElement | null` → `remoteVideoEls: Map<number, HTMLVideoElement>`

Add:
- `focusedShare: ShareInfo | null` — managed as local state in the hook or lifted to the grid component

Keep:
- `watchingShareRef` → `watchingSharesRef` (ref mirrors array for use in callbacks)

### API Changes

- `connectAsViewer(share)` → adds to `watchingShares[]` (up to 4). If already watching this user, disconnects instead (toggle behavior).
- `disconnectViewer(share)` → removes one stream from `watchingShares[]`. Calls `maybeDisconnectRoom()` only when the last stream is removed and not sharing.
- `disconnectViewer()` (no args) → removes all streams (used for channel switch cleanup).

### Track Subscription

The hook already connects to a single LiveKit room per channel. For multi-view, it subscribes to screen share tracks from multiple participants within that room. The existing `RoomEvent.TrackSubscribed` handler needs to handle multiple track subscriptions and map each to the correct video element in `remoteVideoEls`.

When a remote participant's screen share track ends (`TrackUnsubscribed`), that stream is removed from `watchingShares[]` and its video element is cleaned up from the map.

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Sharer stops while you watch them | Tile removed, grid reflows (e.g. 4→3) |
| Focused sharer stops | Focus clears, remaining streams return to equal grid |
| You start sharing while multi-viewing | Views stay, no disruption (single-connection model) |
| You stop sharing while multi-viewing | Views stay, `maybeDisconnectRoom()` skipped because still watching |
| Channel switch | All views disconnect, clean slate |
| Watching 1 stream, add a second | Transitions from `single` to `grid-2` layout |
| Click monitor icon of stream you're watching | Toggle off — removes that stream from views |

## What's NOT in Scope

- **Pinning** — deferred. Can be added later as a `pinnedShare` state that prevents focus-swap.
- **Pop-out / PiP for individual tiles** — belongs to sub-project C (Viewing Experience).
- **Audio mixing for multiple streams** — each stream's audio plays independently (browser default).
- **Drag-to-reorder tiles** — deferred to sub-project G (UI/UX Polish).

## Testing Strategy

### Unit Tests
- `ScreenShareGrid` renders correct layout for 1, 2, 3, 4 streams
- `ScreenShareGrid` renders focused layout when `focusedShare` is set
- `ScreenShareTile` click handler fires `onFocus`/`onClose`
- Focus clears on Esc keypress

### Integration Tests
- Toggle behavior: clicking monitor icon adds/removes stream from `watchingShares`
- Max 4 enforcement: 5th stream replaces oldest non-focused
- Sharer disconnect: tile removed, grid reflows
- Focused sharer disconnect: focus clears, grid mode restored
- Channel switch: all views cleared

### Manual Testing
- Visual: grid layouts look correct at various panel sizes
- Visual: focus transition is smooth (no flicker)
- Visual: sidebar monitor icon toggle state is clear
- Performance: 4 streams don't cause frame drops or excessive CPU
