# Unified Resize Handles and Window Borders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four visual inconsistencies: sidebar resize handle invisible at rest, sidebar scrollbar in onboarding, hardcoded native border color, missing spacing when maximized.

**Architecture:** CSS-only fixes for the sidebar handle and onboarding scrollbar. Bridge message plumbing for window state and dynamic brush update on the C# side. CSS class toggle on the frontend for maximized padding.

**Tech Stack:** CSS (theme tokens), C# (Win32 P/Invoke, GDI brushes), TypeScript/React (bridge messages, state)

**Spec:** `docs/superpowers/specs/2026-04-15-unified-resize-borders-design.md`

---

### Task 1: Unify Sidebar Resize Handle Styling

**Files:**
- Modify: `src/Brmble.Web/src/components/Sidebar/Sidebar.css:297-313`

- [ ] **Step 1: Change resting state from transparent to visible**

In `src/Brmble.Web/src/components/Sidebar/Sidebar.css`, change the `::after` pseudo-element's default background from `transparent` to `var(--border-subtle)`, and change the hover state to `var(--accent-primary)`.

Find this block (lines 297-313):
```css
.sidebar-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 2px;
  background: transparent;
  transition: background var(--transition-fast);
}

.sidebar-resize-handle:hover::after {
  background: var(--border-subtle);
}

.sidebar-resize-handle--active::after {
  background: var(--accent-primary);
  transition: none;
}
```

Replace with:
```css
.sidebar-resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 2px;
  background: var(--border-subtle);
  transition: background var(--transition-fast);
}

.sidebar-resize-handle:hover::after {
  background: var(--accent-primary);
}

.sidebar-resize-handle--active::after {
  background: var(--accent-primary);
  transition: none;
}
```

Changes: resting `transparent` → `var(--border-subtle)`, hover `var(--border-subtle)` → `var(--accent-primary)`. Active stays the same.

- [ ] **Step 2: Visual verification**

Run: `cd src/Brmble.Web && npm run dev`

Verify in the app:
- The sidebar resize handle shows a subtle 2px line at rest (not invisible)
- On hover, it turns accent color
- While dragging, it stays accent color
- Compare with the chat split divider — they should follow the same pattern

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Sidebar/Sidebar.css
git commit -m "fix: make sidebar resize handle visible at rest (#409)

Match the chat split divider pattern: --border-subtle at rest,
--accent-primary on hover/active."
```

---

### Task 2: Hide Sidebar Scrollbar During Onboarding

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:2132`
- Modify: `src/Brmble.Web/src/App.css` (add rule after line 30)

- [ ] **Step 1: Add `.app--onboarding` class to root element**

In `src/Brmble.Web/src/App.tsx`, find the root div at line 2132:
```tsx
<div className="app">
```

Replace with:
```tsx
<div className={`app${showOnboarding ? ' app--onboarding' : ''}`}>
```

- [ ] **Step 2: Add CSS rule to hide sidebar overflow during onboarding**

In `src/Brmble.Web/src/App.css`, after the `.sidebar--disconnected` rule (around line 34), add:

```css
.app--onboarding .sidebar {
  overflow: hidden;
}
```

- [ ] **Step 3: Visual verification**

Clear app data to trigger the onboarding wizard (or temporarily set `showOnboarding` to `true`). Verify no sidebar scrollbar is visible during any wizard step.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.css
git commit -m "fix: hide sidebar scrollbar during onboarding wizard (#409)"
```

---

### Task 3: Add P/Invoke Declarations for Dynamic Brush Update

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs` (add P/Invoke declarations near existing ones around line 243)

- [ ] **Step 1: Add GDI and window class P/Invoke declarations**

In `src/Brmble.Client/Win32Window.cs`, find the existing `CreateSolidBrush` declaration (line 243-244):
```csharp
[DllImport("gdi32.dll")]
private static extern IntPtr CreateSolidBrush(uint crColor);
```

After it, add the following declarations:

```csharp
[DllImport("gdi32.dll")]
public static extern bool DeleteObject(IntPtr hObject);

[DllImport("user32.dll")]
public static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, bool bErase);

[DllImport("user32.dll", EntryPoint = "SetClassLongPtrW")]
private static extern IntPtr SetClassLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

[DllImport("user32.dll", EntryPoint = "SetClassLongW")]
private static extern IntPtr SetClassLongPtr32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

public static IntPtr SetClassLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong)
{
    return IntPtr.Size == 8
        ? SetClassLongPtr64(hWnd, nIndex, dwNewLong)
        : SetClassLongPtr32(hWnd, nIndex, dwNewLong);
}

public const int GCL_HBRBACKGROUND = -10;
```

Note: `SetClassLongPtr` needs a 32/64-bit wrapper because the entry point differs between architectures. `CreateSolidBrush` is already `private`, but the new methods are `public` since they will be called from `Program.cs`.

Also add a public helper to create brushes (since `CreateSolidBrush` is currently private):

```csharp
public static IntPtr CreateBackgroundBrush(uint colorRef)
{
    return CreateSolidBrush(colorRef);
}
```

- [ ] **Step 2: Build and verify no compilation errors**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded, no errors from the new declarations.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "refactor: add P/Invoke declarations for dynamic window brush updates"
```

---

### Task 4: Dynamic Border Brush Per Theme

**Files:**
- Modify: `src/Brmble.Client/Program.cs:383-393` (notification.theme handler)

- [ ] **Step 1: Add a static field to track the current brush handle**

In `src/Brmble.Client/Program.cs`, near the existing static fields at the top of the class (near `_hwnd`, `_bridge`, `_controller`), add:

```csharp
private static IntPtr _currentBgBrush;
```

- [ ] **Step 2: Extend the notification.theme handler to update the window brush**

Find the existing handler (lines 383-393):
```csharp
_bridge.RegisterHandler("notification.theme", data =>
{
    var theme = data.TryGetProperty("theme", out var t) ? t.GetString() : null;
    if (!string.IsNullOrEmpty(theme))
    {
        TrayIcon.SetTheme(theme);
        TaskbarBadge.SetTheme(theme);
        Win32Window.SetWindowIcon(_hwnd, theme);
    }
    return Task.CompletedTask;
});
```

Replace with:
```csharp
_bridge.RegisterHandler("notification.theme", data =>
{
    var theme = data.TryGetProperty("theme", out var t) ? t.GetString() : null;
    if (!string.IsNullOrEmpty(theme))
    {
        TrayIcon.SetTheme(theme);
        TaskbarBadge.SetTheme(theme);
        Win32Window.SetWindowIcon(_hwnd, theme);

        // Update the native resize border brush to match the theme
        var (r, g, b) = ThemeColors.GetBgDeep(theme);
        uint colorRef = (uint)(b << 16 | g << 8 | r);
        var newBrush = Win32Window.CreateBackgroundBrush(colorRef);
        var oldBrush = Win32Window.SetClassLongPtr(
            _hwnd, Win32Window.GCL_HBRBACKGROUND, newBrush);
        if (oldBrush != IntPtr.Zero && oldBrush != _currentBgBrush)
            Win32Window.DeleteObject(oldBrush);
        if (_currentBgBrush != IntPtr.Zero && _currentBgBrush != oldBrush)
            Win32Window.DeleteObject(_currentBgBrush);
        _currentBgBrush = newBrush;
        Win32Window.InvalidateRect(_hwnd, IntPtr.Zero, true);
    }
    return Task.CompletedTask;
});
```

The brush cleanup logic: `SetClassLongPtr` returns the previous brush. We delete the old one to avoid GDI handle leaks. We also track `_currentBgBrush` in case the old brush returned differs from what we expect (defensive).

- [ ] **Step 3: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Manual test**

Launch the app. Switch between themes in Settings. The 6px border strip (visible in normal/restored window mode) should change color to match each theme's `--bg-deep` value. There should be no visible seam between the border strip and the WebView2 content background.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "fix: update native border brush color on theme change (#381)

Extend notification.theme handler to swap the window class background
brush via SetClassLongPtr, matching the active theme's --bg-deep."
```

---

### Task 5: Bridge Message for Window State Changes

**Files:**
- Modify: `src/Brmble.Client/Program.cs:466-471` (WM_SIZE handler)

- [ ] **Step 1: Add SIZE constants if not already defined**

In `src/Brmble.Client/Win32Window.cs`, check if `SIZE_MAXIMIZED` and `SIZE_RESTORED` constants exist. If not, add them near other WM_ constants:

```csharp
public const int SIZE_RESTORED = 0;
public const int SIZE_MAXIMIZED = 2;
```

- [ ] **Step 2: Extend WM_SIZE handler to send window.stateChanged**

In `src/Brmble.Client/Program.cs`, find the `WM_SIZE` handler (lines 466-471):
```csharp
case Win32Window.WM_SIZE:
    if (_controller != null)
    {
        _controller.Bounds = GetWebViewBounds(hwnd);
    }
    return IntPtr.Zero;
```

Replace with:
```csharp
case Win32Window.WM_SIZE:
    if (_controller != null)
    {
        _controller.Bounds = GetWebViewBounds(hwnd);
    }
    var sizeType = (int)(wParam.ToInt64() & 0xFFFF);
    if (sizeType == Win32Window.SIZE_MAXIMIZED || sizeType == Win32Window.SIZE_RESTORED)
    {
        _bridge?.Send("window.stateChanged", new { maximized = Win32Window.IsZoomed(hwnd) });
        _bridge?.NotifyUiThread();
    }
    return IntPtr.Zero;
```

This sends `window.stateChanged` with `{ maximized: true }` or `{ maximized: false }` whenever the window is maximized or restored. The `NotifyUiThread()` call posts `WM_USER` to flush the bridge message queue.

- [ ] **Step 3: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Program.cs src/Brmble.Client/Win32Window.cs
git commit -m "feat: send window.stateChanged bridge message on maximize/restore (#381)"
```

---

### Task 6: Frontend Maximized State and CSS Compensation

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx:2132` (root div className)
- Modify: `src/Brmble.Web/src/App.css` (add `.app--maximized` rule)

- [ ] **Step 1: Add isMaximized state and bridge listener in App.tsx**

In `src/Brmble.Web/src/App.tsx`, near the other state declarations (around line 168 where `showOnboarding` is), add:

```tsx
const [isMaximized, setIsMaximized] = useState(false);
```

Then add a `useEffect` to listen for the bridge message. Place it near other bridge-related effects:

```tsx
useEffect(() => {
  const handleWindowState = (data: { maximized?: boolean }) => {
    setIsMaximized(data.maximized === true);
  };
  bridge.on('window.stateChanged', handleWindowState);
  return () => bridge.off('window.stateChanged', handleWindowState);
}, []);
```

- [ ] **Step 2: Add isMaximized to the root div className**

Find the root div (line 2132, already modified in Task 2):
```tsx
<div className={`app${showOnboarding ? ' app--onboarding' : ''}`}>
```

Replace with:
```tsx
<div className={`app${showOnboarding ? ' app--onboarding' : ''}${isMaximized ? ' app--maximized' : ''}`}>
```

- [ ] **Step 3: Add CSS rule for maximized padding**

In `src/Brmble.Web/src/App.css`, after the `.app--onboarding` rule (added in Task 2), add:

```css
.app--maximized {
  padding: 6px;
}
```

- [ ] **Step 4: Visual verification**

Launch the app. Maximize the window — content should have 6px of `--bg-deep` colored padding on all sides, matching the visual spacing of the normal/restored mode. Restore the window — padding should disappear (the native 6px border inset takes over). Toggle back and forth several times to confirm no flicker or layout jump.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.css
git commit -m "fix: add 6px padding when maximized to match normal mode spacing (#381)

Listen for window.stateChanged bridge message and toggle .app--maximized
class. CSS adds 6px padding to compensate for the missing native border
inset when maximized."
```

---

### Task 7: Maximize Button Icon Toggle

**Files:**
- Modify: `src/Brmble.Web/src/components/Icon/Icon.tsx:363-366` (add window-restore icon)
- Modify: `src/Brmble.Web/src/components/Header/Header.tsx:80-82` (toggle icon)

- [ ] **Step 1: Add window-restore icon to Icon.tsx**

In `src/Brmble.Web/src/components/Icon/Icon.tsx`, find the `window-maximize` entry (lines 363-366):
```tsx
'window-maximize': {
    viewBox: '0 0 10 10',
    paths: <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />,
  },
```

After it, add the `window-restore` icon (two overlapping rectangles, standard Windows restore icon):
```tsx
  'window-restore': {
    viewBox: '0 0 10 10',
    paths: (
      <>
        <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
        <rect x="0.5" y="2.5" width="7" height="7" fill="var(--bg-deep, #0f0a14)" stroke="currentColor" strokeWidth="1" />
      </>
    ),
  },
```

The restore icon has a back rectangle (top-right) and a front rectangle (bottom-left), with the front filled with the background color to create the overlapping effect.

- [ ] **Step 2: Pass isMaximized prop to Header**

In `src/Brmble.Web/src/App.tsx`, find where `<Header` is rendered. Add the `isMaximized` prop:

```tsx
<Header isMaximized={isMaximized} ... />
```

(Keep all existing props intact, just add `isMaximized`.)

- [ ] **Step 3: Update Header to accept and use isMaximized**

In `src/Brmble.Web/src/components/Header/Header.tsx`, add `isMaximized` to the component's props interface/destructuring.

Then find the maximize button (lines 80-82):
```tsx
<button className="window-btn window-btn-maximize" onClick={() => bridge.send('window.maximize')} aria-label="Maximize">
  <Icon name="window-maximize" size={10} />
</button>
```

Replace with:
```tsx
<button className="window-btn window-btn-maximize" onClick={() => bridge.send('window.maximize')} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
  <Icon name={isMaximized ? 'window-restore' : 'window-maximize'} size={10} />
</button>
```

- [ ] **Step 4: Visual verification**

Launch the app. The maximize button should show a single rectangle (maximize icon) in normal mode. When maximized, it should switch to the overlapping rectangles (restore icon). Clicking it should toggle the window state and the icon should update accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/Icon/Icon.tsx src/Brmble.Web/src/components/Header/Header.tsx src/Brmble.Web/src/App.tsx
git commit -m "feat: toggle maximize/restore icon based on window state (#381)

Add window-restore icon and pass isMaximized prop to Header so the
button shows the correct icon for the current window state."
```

---

### Task 8: Final Integration Test

- [ ] **Step 1: Build everything**

```bash
dotnet build
cd src/Brmble.Web && npm run build
```

Expected: Both builds succeed with no errors.

- [ ] **Step 2: Full manual test pass**

Launch the app and verify all four fixes:

1. **Sidebar resize handle**: Visible subtle line at rest. Accent color on hover. Accent color while dragging. Matches chat split divider pattern.
2. **Onboarding scrollbar**: If testable, confirm no sidebar scrollbar during wizard.
3. **Border theme color**: Switch between multiple themes (Classic, Blue Lagoon, Retro Terminal at minimum). The 6px border strip should seamlessly match the app background.
4. **Maximized spacing**: Maximize window — 6px padding visible on all edges. Restore — padding gone, native border strip visible. No layout jump or flicker.
5. **Maximize button icon**: Shows maximize icon when restored, restore icon when maximized.

- [ ] **Step 3: Run existing tests**

```bash
dotnet test
```

Expected: All existing tests pass (no regressions).
