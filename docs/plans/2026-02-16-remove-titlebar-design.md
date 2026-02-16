# Remove Title Bar — Design

**Issue:** #10 — "Remove ugly window bar"
**Date:** 2026-02-16
**Approach:** DWM Frame Extension (VS Code / Edge style)

## Goal

Remove the default Windows title bar while keeping native caption buttons (minimize, maximize, close). Web content fills to the top of the window. The Header component becomes a draggable region for moving the window.

## Win32 Layer (Win32Window.cs)

### New P/Invoke declarations

- `DwmExtendFrameIntoClientArea` — extends the DWM frame glass into the client area
- `DwmDefWindowProc` — lets DWM handle hit-testing for native caption buttons
- `MARGINS` struct — specifies frame extension margins (top = -1 to extend fully)

### Window creation

Keep `WS_OVERLAPPEDWINDOW | WS_VISIBLE` unchanged. After `CreateWindowEx`, call `DwmExtendFrameIntoClientArea` with `MARGINS { top = -1 }` to remove the visible title bar while preserving caption buttons.

### New message constants

- `WM_NCCALCSIZE` (0x0083)
- `WM_ACTIVATE` (0x0006)

## WndProc (Program.cs)

### Message handling changes

1. **All messages**: Route through `DwmDefWindowProc` first. If it handles the message (returns true), use its result. This gives DWM control over caption button hover/click behavior.

2. **WM_NCCALCSIZE** (wParam == 1): Return 0 to collapse the non-client area, removing the title bar space so the client area extends to the top edge.

3. **WM_ACTIVATE**: Re-apply `DwmExtendFrameIntoClientArea` to ensure the frame extension persists across activation changes.

## Web Layer (Header.css)

### Drag region

- Add `-webkit-app-region: drag` to `.header` so users can drag the window by the header bar.
- Add `-webkit-app-region: no-drag` to interactive children (buttons, user panel) so they remain clickable.
- Add right padding (~138px) to `.header` to avoid overlapping the native caption buttons.

## Files changed

| File | Change |
|------|--------|
| `src/Brmble.Client/Win32Window.cs` | Add DWM P/Invoke, MARGINS struct, new message constants |
| `src/Brmble.Client/Program.cs` | Update WndProc with DWM routing, WM_NCCALCSIZE, WM_ACTIVATE handlers; call DwmExtendFrameIntoClientArea after window creation |
| `src/Brmble.Web/src/components/Header/Header.css` | Add drag region styles and caption button padding |
