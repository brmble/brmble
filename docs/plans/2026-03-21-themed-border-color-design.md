# Fix White Resize Border Design

**Issue:** #357 — Resize border shows white instead of theme color
**Date:** 2026-03-21

## Summary

The left, right, and bottom window resize borders flash white during resize and focus changes on Windows 10.

## Root Cause

Two factors combined to create the white border flash:

1. **NC area preserved on sides/bottom**: The `WM_NCCALCSIZE` handler called `DefWindowProc` to calculate NC insets, then only restored the top edge — leaving the left, right, and bottom NC frame area intact. During resize and focus changes, Windows briefly repaints this NC area with the default frame color (white) before DWM composites over it.

2. **DWM glass over entire client area**: `DwmExtendFrameIntoClientArea({-1,-1,-1,-1})` extended glass into the full client area. On Windows 10 (no blur), DWM glass renders as white/transparent, making any gap between WebView2 and the window edge appear white.

### Why `DWMWA_BORDER_COLOR` didn't work

The initial fix attempt used `DwmSetWindowAttribute(DWMWA_BORDER_COLOR)`, but this API requires Windows 11 Build 22000+. On the target system (Windows 10.0.19045), all calls fail with `E_INVALIDARG` (0x80070057). The white lines on Windows 10 are not the DWM thin border (a Windows 11 feature) — they are the NC frame area itself.

## Fix

Three changes eliminate the white border:

### 1. Remove all NC area (`Program.cs` — `WM_NCCALCSIZE`)

Save all 4 edges of the proposed window rect, call `DefWindowProc` for bookkeeping, then restore all 4 edges. This makes client area == window rect on all sides, eliminating the NC frame entirely.

### 2. Inset WebView2 bounds (`Program.cs` — `GetWebViewBounds`)

With no NC area, WebView2 would cover the entire window and consume mouse events on the edges. Inset WebView2 by `ResizeBorderWidth` (6px) on all sides when not maximized. The outer strip is painted by the WNDCLASS `hbrBackground` brush (`#0f0a14`), matching the theme's `--bg-deep`.

### 3. Zero DWM margins (`Win32Window.cs` — `ExtendFrameIntoClientArea`)

Change margins from `{-1,-1,-1,-1}` to `{0,0,0,0}`. No glass extension means no white glass showing through the resize border strip. `IsNonClientRegionSupportEnabled` (for `app-region: drag`) is a WebView2 setting and works without DWM frame extension.

### 4. Custom hit-testing (`Program.cs` — `WM_NCHITTEST`)

Use the existing `HitTestHelper.Calculate` for resize edge detection instead of delegating to `DwmDefWindowProc`/`DefWindowProc`. Returns `HTCLIENT` when maximized (no resize needed).

## Removed Code

- `SetBorderColor` method and `DwmSetWindowAttribute` P/Invoke (Win11-only, not needed)
- `window.setBorderColor` bridge handler
- `syncBorderColor()` in `theme-loader.ts` and bridge import
- `_borderColor` field in `Program.cs`

## Files Changed

| File | Change |
|---|---|
| `src/Brmble.Client/Win32Window.cs` | DWM margins `{-1,-1,-1,-1}` → `{0,0,0,0}`, remove `DwmSetWindowAttribute`/`SetBorderColor` |
| `src/Brmble.Client/Program.cs` | Remove all NC area in `WM_NCCALCSIZE`, add `GetWebViewBounds` with resize inset, custom `WM_NCHITTEST` via `HitTestHelper`, remove border color bridge handler |
| `src/Brmble.Web/src/themes/theme-loader.ts` | Remove `syncBorderColor()` and bridge import |

## Testing

- Resize all 4 edges and 4 corners — works via custom hit-testing
- No white flash on any edge during resize or focus change
- Maximize fills screen properly (no taskbar overlap)
- Restore returns to previous size
- Window drag via header still works
- 6px dark border strip matches theme background
