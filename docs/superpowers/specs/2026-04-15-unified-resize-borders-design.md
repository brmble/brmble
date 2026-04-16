# Unified Resize Handles and Window Borders

Fixes #409 (sidebar resize handle style + onboarding scrollbar) and #381 (window border theme color + maximized spacing).

## Problem

Four related visual inconsistencies in resize/border behavior:

1. **Sidebar resize handle is invisible at rest**, while the chat split divider is always visible. Users don't know the sidebar is resizable until they accidentally hover it.
2. **Sidebar scrollbar leaks through during onboarding wizard**, where it shouldn't appear.
3. **Native window border color is hardcoded** to Classic theme's `--bg-deep` (`#0f0a14`). Other themes show a mismatched border strip.
4. **Content is flush against edges when maximized.** The 6px native resize border inset disappears when the window is maximized, leaving 0px spacing on the left and top edges.

## What Stays

- **`useResizable` hook** (`hooks/useResizable.ts`) -- solid implementation using Pointer Events API with pointer capture, proper cleanup, min/max clamping, profile-scoped localStorage persistence, and double-click-to-reset. No changes needed.
- **Native hit-test architecture** (`HitTestHelper.cs`, `WM_NCHITTEST` in `Program.cs`) -- correct approach for custom-chrome WebView2 apps. Clean and unit-tested.
- **Chat split divider styling** (`ChatPanel.css:452-462`) -- this is the reference pattern that the sidebar handle should match.

## Fix 1: Unified Sidebar Resize Handle

**Files:** `src/Brmble.Web/src/components/Sidebar/Sidebar.css` (lines 280-313)

Change the `::after` pseudo-element on `.sidebar-resize-handle` from invisible at rest to always-visible, matching the chat split divider pattern:

| State | Current | New |
|-------|---------|-----|
| Resting | `background: transparent` | `background: var(--border-subtle)` |
| Hover | `background: var(--border-subtle)` | `background: var(--accent-primary)` |
| Active/dragging | `background: var(--accent-primary)` | `background: var(--accent-primary)` (unchanged) |

The hit area (8px wide), line width (2px), cursor (`col-resize`), z-index (200), and ARIA attributes all stay the same.

## Fix 2: Hide Sidebar Scrollbar During Onboarding

**Files:** `src/Brmble.Web/src/App.tsx`, `src/Brmble.Web/src/App.css`

The `showOnboarding` state already exists in `App.tsx`. When true, add class `.app--onboarding` to the root `.app` element. Then in CSS:

```css
.app--onboarding .sidebar {
  overflow: hidden;
}
```

The sidebar isn't interactive during onboarding, so hiding overflow has no side effects.

## Fix 3: Dynamic Native Border Brush Per Theme

**Files:** `src/Brmble.Client/Program.cs`, `src/Brmble.Client/Win32Window.cs`

The frontend already sends `notification.theme` with `{ theme }` on every theme change (via MutationObserver in `App.tsx`). The C# handler already receives this and updates tray icon, taskbar badge, and window icon.

Extend the existing `notification.theme` handler to also update the window background brush:

1. Call `ThemeColors.GetBgDeep(theme)` to get the correct COLORREF value.
2. Create a new brush with `CreateSolidBrush(colorRef)`.
3. Swap the window class brush via `SetClassLongPtr(hwnd, GCL_HBRBACKGROUND, newBrush)`.
4. Delete the old brush with `DeleteObject(oldBrush)` to avoid GDI handle leaks.
5. Call `InvalidateRect(hwnd, IntPtr.Zero, true)` to repaint the border strip.

Add P/Invoke declarations for `SetClassLongPtr`, `InvalidateRect`, and `DeleteObject` to `Win32Window.cs` if not already present. Store the current brush handle in a `static IntPtr _currentBgBrush` field in `Program.cs` so the old brush can be cleaned up on swap.

## Fix 4: Consistent Spacing When Maximized

**Files:** `src/Brmble.Client/Program.cs`, `src/Brmble.Web/src/App.tsx`, `src/Brmble.Web/src/components/Header/Header.tsx`

### Native inset

Keep the native 6px inset in `Program.cs` consistent across restored and maximized states instead of compensating in the web layer. The goal is for the same chrome-owned spacing to remain visible when the window is maximized, so content never sits flush against the screen edges.

### Frontend state

No frontend maximize-state plumbing is required for this behavior. `App.tsx` does not need to listen for a window-state event or toggle an `.app--maximized` class.

### CSS compensation

No maximized-only CSS padding is needed. Spacing is provided by the native window inset rather than by adding padding in the app root.

This keeps the responsibility for edge spacing in the native chrome layer, avoids web/native duplication, and ensures maximized and restored windows use the same 6px inset behavior.

### Bridge message: `window.stateChanged`

In the `WM_SIZE` handler in `Program.cs`, detect maximize/restore transitions. When `wParam` is `SIZE_MAXIMIZED` or `SIZE_RESTORED`, send:

```csharp
bridge.Send("window.stateChanged", new { maximized = IsZoomed(hwnd) });
bridge.NotifyUiThread();
```

This message is used by the frontend to toggle the maximize/restore icon in the Header, not for spacing.

### Maximize button icon toggle (polish)

Pass `isMaximized` as a prop to `Header.tsx`. The window control button currently always shows the maximize icon. When `isMaximized` is true, show a restore icon instead.

## Testing

- **Sidebar handle:** Hover and drag the sidebar resize handle. It should show a subtle `--border-subtle` line at rest, and highlight to `--accent-primary` on hover and drag. Compare visually with the chat split divider -- they should look the same.
- **Onboarding scrollbar:** Run through the onboarding wizard. No sidebar scrollbar should be visible at any step.
- **Border theme color:** Switch between all 8 themes while the window is in normal (restored) mode. The 6px border strip should match the theme's background color without a visible seam.
- **Maximized spacing:** Maximize the window. Content should not be flush with screen edges -- the same 6px native inset should remain visible rather than collapsing to 0px. Restore the window and verify spacing remains consistent without any extra web-layer padding being applied.
- **Maximize button:** The header button should show a restore icon when maximized, and a maximize icon when restored.
