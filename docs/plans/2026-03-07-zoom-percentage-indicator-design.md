# Zoom Percentage Indicator — Design

**Issue**: #223
**Date**: 2026-03-07

## Overview

Display a temporary zoom percentage indicator when the user zooms the interface using Ctrl+mousewheel, so they can see the current zoom level and easily return to 100%.

## Architecture

Two-layer approach: C# detects zoom changes via WebView2's `ZoomFactorChanged` event, sends the percentage over the bridge, and a React component renders the indicator.

### C# Side

In `Program.cs`, subscribe to `_controller.ZoomFactorChanged` after WebView2 init. On each change, send `window.zoomChanged` with `{ zoomPercent: <int> }` over the bridge. No new service needed — fits alongside existing `window.*` handlers.

### React Side

New `ZoomIndicator` component:
- Listens for `window.zoomChanged` bridge messages
- Shows percentage (e.g. "125%") in a pill-shaped element
- `position: fixed`, bottom-center, `pointer-events: none`
- Fades in on change, fades out after 1.5s of inactivity (debounced)
- Hidden entirely at 100% after fade-out
- Tokens: `--font-mono`, `--bg-surface`, `--text-primary`, `--radius-md`, `--shadow-elevated`
- `z-index: 10001`
- Placed in `App.tsx` before `<Prompt />`

### Visual Style

Small unobtrusive pill: `padding: var(--space-xs) var(--space-sm)`, subtle background with `backdrop-filter`, centered at bottom with ~48px margin. Fade via `opacity` + `--transition-normal` (250ms).

### Out of Scope

- No click-to-reset-zoom (keeps `pointer-events: none`)
- No persistence of zoom level across sessions
- No zoom controls (buttons/slider)
