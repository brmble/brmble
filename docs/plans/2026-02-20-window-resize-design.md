# Window Resize Design

**Date:** 2026-02-20
**Issue:** #29 — Add window resize handlers for GUI
**Branch:** fix/window-resize-29

## Problem

The Brmble client uses a frameless Win32 window (WM_NCCALCSIZE returns 0 to remove the non-client area). WebView2 covers the entire client area. Without a WM_NCHITTEST handler, mouse events on the window border never reach Windows' resize logic — the user cannot resize the window by dragging its edges.

## Solution

**Approach: WM_NCHITTEST in C# (WndProc)**

Add hit-test handling in the existing WndProc to detect when the cursor is on a resize edge, and return the appropriate hit code. Windows then intercepts the mouse input before WebView2 can consume it, enabling native resize behavior.

## Changes

### Win32Window.cs

Add the following constants:

- `WM_NCHITTEST` (0x0084)
- `WM_GETMINMAXINFO` (0x0024)
- Hit test return codes: `HTLEFT`, `HTRIGHT`, `HTTOP`, `HTBOTTOM`, `HTTOPLEFT`, `HTTOPRIGHT`, `HTBOTTOMLEFT`, `HTBOTTOMRIGHT`, `HTCLIENT`
- `MINMAXINFO` struct with `ptMinTrackSize` field
- P/Invoke for `GetCursorPos`, `ScreenToClient`
- `POINT` struct

### Program.cs (WndProc)

**Case WM_NCHITTEST:**

1. Get cursor position via `GetCursorPos`
2. Convert to client coordinates via `ScreenToClient`
3. Get client rect via `GetClientRect`
4. Border width: 6px
5. Return corner hit codes for corners (6×6px areas), edge codes for sides, `HTCLIENT` otherwise

**Case WM_GETMINMAXINFO:**

Set `ptMinTrackSize` to 600×400 to prevent the window from becoming too small for the UI to remain usable.

## No Frontend Changes Needed

The CSS already uses `100vh`, `flex: 1`, and `min-width: 0`. The existing `WM_SIZE` handler already updates the WebView2 bounds. No CSS or React changes required.

## Testing

- Drag all 8 resize directions (4 sides + 4 corners) — window should resize
- Minimize to 600×400 — should not go smaller
- Maximize and restore — should continue to work
- Window drag (header) — should still work
- WebView2 content interaction — should not be affected by hit-test changes
