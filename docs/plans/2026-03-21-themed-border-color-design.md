# Themed Window Resize Border Design

**Issue:** #357 — Resize border shows white instead of theme color
**Date:** 2026-03-21

## Summary

The left, right, and bottom window resize borders are rendered by DWM using Windows' system accent color. The app never tells DWM what color to use, so they appear white regardless of the active theme.

## Root Cause

`DwmExtendFrameIntoClientArea({-1,-1,-1,-1})` extends the DWM glass frame into the entire client area, but without calling `DwmSetWindowAttribute(DWMWA_BORDER_COLOR)`, DWM uses the system default color for the visible resize border.

## Fix

### Bridge Message

Frontend sends `window.setBorderColor` with a hex color (e.g., `#0f0a14`) whenever the theme is applied. The C# side converts this to a COLORREF and calls `DwmSetWindowAttribute`.

### Frontend (`theme-loader.ts`)

After setting the `data-theme` attribute, read the computed `--bg-deep` token and send it via bridge:

```ts
const bgDeep = getComputedStyle(document.documentElement).getPropertyValue('--bg-deep').trim();
window.bridge.send('window.setBorderColor', { color: bgDeep });
```

### Backend (`Win32Window.cs`)

Add a `SetBorderColor` method:

```csharp
public static void SetBorderColor(IntPtr hwnd, uint colorRef)
{
    const int DWMWA_BORDER_COLOR = 34;
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref colorRef, sizeof(uint));
}
```

### Backend (`Program.cs`)

Handle `window.setBorderColor` in the bridge message handler, parse the hex color to COLORREF, and call `SetBorderColor`.

## Constraints

- `DWMWA_BORDER_COLOR` requires Windows 11 Build 22000+. On older builds, `DwmSetWindowAttribute` returns an error which we silently ignore (graceful degradation).
- COLORREF format is `0x00BBGGRR` (byte-swapped from RGB hex).

## Files Changed

| File | Change |
|---|---|
| `src/Brmble.Client/Win32Window.cs` | Add `SetBorderColor` method, add `DwmSetWindowAttribute` overload for uint |
| `src/Brmble.Client/Program.cs` | Handle `window.setBorderColor` bridge message |
| `src/Brmble.Web/src/themes/theme-loader.ts` | Send `--bg-deep` color via bridge after theme application |
