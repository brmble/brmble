# DM Badge Fix & Theme-Aware Native Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the DM button badge to show contact count instead of message count, make tray/taskbar icons theme-aware, and rename the "Lemon Drop Martini" theme.

**Architecture:** Two-sided change. Frontend sends a `notification.theme` bridge message on init and theme change. C# loads theme-specific .ico files and draws accent-colored badge dots. The DM count fix is a pure frontend change in the unread tracker and App.tsx useMemo.

**Tech Stack:** React/TypeScript (frontend), C# with Win32 P/Invoke (native client), WebView2 bridge (communication)

**Spec:** `docs/superpowers/specs/2026-03-29-dm-badge-and-themed-icons-design.md`

---

### Task 1: Fix DM Badge Count (Frontend)

**Files:**
- Modify: `src/Brmble.Web/src/hooks/useUnreadTracker.ts:497-505`
- Modify: `src/Brmble.Web/src/App.tsx:415-424`

- [ ] **Step 1: Change useUnreadTracker to count contacts instead of summing messages**

In `src/Brmble.Web/src/hooks/useUnreadTracker.ts`, find this block around line 497:

```typescript
  // Compute totals from the current state (derived, not stored)
  let totalUnreadCount = 0;
  let totalDmUnreadCount = 0;
  for (const [roomId, state] of roomUnreads) {
    totalUnreadCount += state.notificationCount;
    if (dmRoomIds.has(roomId)) {
      totalDmUnreadCount += state.notificationCount;
    }
  }
```

Change line 503 from:
```typescript
      totalDmUnreadCount += state.notificationCount;
```
to:
```typescript
      totalDmUnreadCount += state.notificationCount > 0 ? 1 : 0;
```

`totalUnreadCount` (channel unreads) stays as a sum -- only the DM count changes.

- [ ] **Step 2: Change App.tsx ephemeral contact counting**

In `src/Brmble.Web/src/App.tsx`, find the `totalDmUnreadCount` useMemo around line 415:

```typescript
  const totalDmUnreadCount = useMemo(() => {
    let total = unreadTracker.totalDmUnreadCount;
    // Add Mumble DM unreads
    for (const contact of dmStore.contacts) {
      if (contact.isEphemeral) {
        total += contact.unreadCount;
      }
    }
    return total;
  }, [unreadTracker.totalDmUnreadCount, dmStore.contacts]);
```

Change line 420 from:
```typescript
        total += contact.unreadCount;
```
to:
```typescript
        total += contact.unreadCount > 0 ? 1 : 0;
```

- [ ] **Step 3: Build frontend to verify no type errors**

Run: `npm run build` in `src/Brmble.Web`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/hooks/useUnreadTracker.ts src/Brmble.Web/src/App.tsx
git commit -m "fix: DM badge shows contact count instead of total message count (#403)"
```

---

### Task 2: Add Theme Color Map to C# (Shared Utility)

**Files:**
- Create: `src/Brmble.Client/ThemeColors.cs`

- [ ] **Step 1: Create ThemeColors.cs**

Create `src/Brmble.Client/ThemeColors.cs`:

```csharp
namespace Brmble.Client;

/// <summary>
/// Maps theme IDs to their accent-primary RGB colors for native icon rendering.
/// These values must stay in sync with the --accent-primary CSS tokens in src/Brmble.Web/src/themes/.
/// </summary>
internal static class ThemeColors
{
    public static (byte R, byte G, byte B) GetAccent(string? themeName)
    {
        return themeName switch
        {
            "classic"        => (0xD4, 0x14, 0x5A), // #d4145a
            "clean"          => (0xD4, 0x14, 0x5A), // #d4145a (inherits classic)
            "blue-lagoon"    => (0x00, 0xB4, 0xD8), // #00b4d8
            "cosmopolitan"   => (0xE6, 0x39, 0x62), // #e63962
            "aperol-spritz"  => (0xE8, 0x65, 0x1A), // #e8651a
            "midori-sour"    => (0x00, 0xC8, 0x53), // #00c853
            "lemon-drop"     => (0xF5, 0xC5, 0x18), // #f5c518
            "retro-terminal" => (0x33, 0xFF, 0x00), // #33ff00
            _                => (0xD4, 0x14, 0x5A), // default to classic
        };
    }

    /// <summary>
    /// Resolves the path to a theme's brmble.ico file.
    /// Falls back to the root Resources/brmble.ico if the theme folder doesn't exist.
    /// </summary>
    public static string GetIconPath(string? themeName)
    {
        if (!string.IsNullOrEmpty(themeName))
        {
            var themed = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", themeName, "brmble.ico");
            if (File.Exists(themed)) return themed;
        }
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "brmble.ico");
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `dotnet build` from the repo root.
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/ThemeColors.cs
git commit -m "feat: add ThemeColors utility for theme-to-accent mapping"
```

---

### Task 3: Make TrayIcon Theme-Aware

**Files:**
- Modify: `src/Brmble.Client/TrayIcon.cs`

This task modifies `TrayIcon.cs` to:
1. Load the theme-specific .ico for the normal icon
2. Create the badge variant by drawing the accent-colored dot on top of the loaded .ico pixels (instead of drawing a programmatic green circle)
3. Add a `SetTheme()` method

- [ ] **Step 1: Update CreateColoredIconWithBadge to accept badge color parameters**

The existing `CreateColoredIconWithBadge` method hardcodes the red dot color `(180, 30, 30)`. Change its signature to accept accent color parameters.

Find the existing method (around line 230):
```csharp
    private static IntPtr CreateColoredIconWithBadge(byte r, byte g, byte b)
```

Change to:
```csharp
    private static IntPtr CreateColoredIconWithBadge(byte r, byte g, byte b, byte badgeR, byte badgeG, byte badgeB)
```

And in the `DrawBadge` call within that method, change from:
```csharp
        DrawBadge(pixels, size, 180, 30, 30);
```
to:
```csharp
        DrawBadge(pixels, size, badgeR, badgeG, badgeB);
```

- [ ] **Step 2: Add theme field and refactor icon creation**

In `src/Brmble.Client/TrayIcon.cs`, add a new field to track the current theme name. Near the existing static fields (around line 86):

Add after `private static bool _hasBadge;` (line 94):
```csharp
    private static string? _currentTheme;
```

Replace the existing `CreateIcons()` method (lines ~195-215) with:

```csharp
    private static void CreateIcons(string? themeName = null)
    {
        // Destroy previous icons
        DestroyIconSafe(ref _iconNormal);
        DestroyIconSafe(ref _iconMuted);
        DestroyIconSafe(ref _iconDeafened);
        DestroyIconSafe(ref _iconNormalBadge);
        DestroyIconSafe(ref _iconMutedBadge);
        DestroyIconSafe(ref _iconDeafenedBadge);

        // Normal: load theme-specific .ico
        var icoPath = ThemeColors.GetIconPath(themeName);
        if (File.Exists(icoPath))
            _iconNormal = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
        if (_iconNormal == IntPtr.Zero)
            _iconNormal = CreateColoredIcon(0x00, 0xC8, 0x50); // fallback green circle

        // Muted / Deafened: stay as programmatic colored circles
        _iconMuted = CreateColoredIcon(0xE8, 0xB0, 0x00);
        _iconDeafened = CreateColoredIcon(0xD4, 0x14, 0x5A);

        // Badge variants: draw accent-colored dot on top
        var (ar, ag, ab) = ThemeColors.GetAccent(themeName);
        _iconNormalBadge = CreateBadgeFromIcon(_iconNormal, ar, ag, ab);
        _iconMutedBadge = CreateColoredIconWithBadge(0xE8, 0xB0, 0x00, ar, ag, ab);
        _iconDeafenedBadge = CreateColoredIconWithBadge(0xD4, 0x14, 0x5A, ar, ag, ab);
    }
```

- [ ] **Step 3: Add CreateBadgeFromIcon method**

This method reads the pixels from an existing icon, draws the badge dot on top, and returns a new icon. Add this after the existing `CreateColoredIcon` method:

```csharp
    /// <summary>
    /// Creates a badge variant of an existing icon by extracting its pixels
    /// and drawing an accent-colored dot in the top-right corner.
    /// </summary>
    private static IntPtr CreateBadgeFromIcon(IntPtr sourceIcon, byte badgeR, byte badgeG, byte badgeB)
    {
        if (sourceIcon == IntPtr.Zero) return IntPtr.Zero;

        const int size = 16;
        var biHeader = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = size,
            biHeight = -size, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0,
        };

        var hdc = CreateCompatibleDC(IntPtr.Zero);
        var hBitmap = CreateDIBSection(hdc, ref biHeader, 0, out var bits, IntPtr.Zero, 0);
        var oldBmp = SelectObject(hdc, hBitmap);

        // Draw the source icon onto our DIB
        DrawIconEx(hdc, 0, 0, sourceIcon, size, size, 0, IntPtr.Zero, DI_NORMAL);

        SelectObject(hdc, oldBmp);

        // Read pixels, draw badge dot, write back
        var pixels = new byte[size * size * 4];
        Marshal.Copy(bits, pixels, 0, pixels.Length);
        DrawBadge(pixels, size, badgeR, badgeG, badgeB);
        Marshal.Copy(pixels, 0, bits, pixels.Length);

        // Create mask (all zeros = fully opaque, alpha is in the color bitmap)
        var hMono = CreateBitmap(size, size, 1, 1, IntPtr.Zero);

        var iconInfo = new ICONINFO { fIcon = true, hbmMask = hMono, hbmColor = hBitmap };
        var result = CreateIconIndirect(ref iconInfo);

        DeleteObject(hMono);
        DeleteObject(hBitmap);
        DeleteDC(hdc);

        return result;
    }
```

- [ ] **Step 4: Add missing P/Invoke declarations**

Add these P/Invoke declarations to `TrayIcon.cs` alongside the existing ones (near the top of the file):

```csharp
    private const uint DI_NORMAL = 0x0003;

    [DllImport("user32.dll")]
    private static extern bool DrawIconEx(IntPtr hdc, int xLeft, int yTop, IntPtr hIcon,
        int cxWidth, int cyWidth, uint istepIfAniCur, IntPtr hbrFlickerFreeDraw, uint diFlags);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr h);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint nPlanes, uint nBitCount, IntPtr lpBits);
```

Note: Check if `CreateCompatibleDC`, `SelectObject`, `DeleteDC`, `CreateDIBSection`, `CreateIconIndirect`, and `DeleteObject` already exist in the file. Only add the ones that are missing. `DrawIconEx` and `CreateBitmap` are definitely new.

- [ ] **Step 5: Add DestroyIconSafe helper and SetTheme public method**

Add near the existing `Destroy()` method:

```csharp
    private static void DestroyIconSafe(ref IntPtr icon)
    {
        if (icon != IntPtr.Zero)
        {
            DestroyIcon(icon);
            icon = IntPtr.Zero;
        }
    }

    /// <summary>
    /// Switches tray icons to match the given theme.
    /// Call from the UI thread.
    /// </summary>
    public static void SetTheme(string themeName)
    {
        _currentTheme = themeName;
        CreateIcons(themeName);
        UpdateIconAndTooltip();
    }
```

- [ ] **Step 6: Verify the Create method still compiles**

In the existing `Create(IntPtr hwnd)` method, the call to `CreateIcons()` should still work since the new signature has a default parameter `string? themeName = null`. Verify this compiles.

- [ ] **Step 7: Add LoadImage import if not already present**

Check if `LoadImage` is already imported in `TrayIcon.cs`. If not, add:

```csharp
    private const uint LR_LOADFROMFILE = 0x00000010;
    private const uint IMAGE_ICON = 1;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);
```

- [ ] **Step 8: Build to verify**

Run: `dotnet build` from the repo root.
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Client/TrayIcon.cs
git commit -m "feat: make tray icon theme-aware with accent-colored badge dot"
```

---

### Task 4: Make Taskbar Overlay Theme-Aware

**Files:**
- Modify: `src/Brmble.Client/TaskbarBadge.cs`

Replace the Brmble logo overlay with a small accent-colored dot.

- [ ] **Step 1: Replace LoadBrmbleOverlayIcon with CreateAccentDotIcon**

In `src/Brmble.Client/TaskbarBadge.cs`, replace the `LoadBrmbleOverlayIcon()` method and the fallback `CreateSmallBrmbleIcon()` method with a single new method:

```csharp
    /// <summary>
    /// Creates a small filled circle icon in the given accent color.
    /// Used as the taskbar overlay badge.
    /// </summary>
    private static IntPtr CreateAccentDotIcon(byte r, byte g, byte b)
    {
        const int size = 16;
        var biHeader = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = size,
            biHeight = -size, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0,
        };

        var hdc = CreateCompatibleDC(IntPtr.Zero);
        var hBitmap = CreateDIBSection(hdc, ref biHeader, 0, out var bits, IntPtr.Zero, 0);
        DeleteDC(hdc);

        var pixels = new byte[size * size * 4];

        float cx = (size - 1) / 2f;
        float cy = (size - 1) / 2f;
        float outerRadius = size / 2f;
        float innerRadius = outerRadius - 1f;

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = x - cx;
                float dy = y - cy;
                float dist = MathF.Sqrt(dx * dx + dy * dy);
                int offset = (y * size + x) * 4;

                if (dist <= innerRadius)
                {
                    pixels[offset + 0] = b; // B
                    pixels[offset + 1] = g; // G
                    pixels[offset + 2] = r; // R
                    pixels[offset + 3] = 255; // A
                }
                else if (dist <= outerRadius)
                {
                    float alpha = 1f - (dist - innerRadius);
                    byte a = (byte)(alpha * 255);
                    pixels[offset + 0] = b;
                    pixels[offset + 1] = g;
                    pixels[offset + 2] = r;
                    pixels[offset + 3] = a;
                }
                // else: transparent (already 0)
            }
        }

        Marshal.Copy(pixels, 0, bits, pixels.Length);

        var hMono = CreateBitmap(size, size, 1, 1, IntPtr.Zero);
        var iconInfo = new ICONINFO { fIcon = true, hbmMask = hMono, hbmColor = hBitmap };
        var result = CreateIconIndirect(ref iconInfo);

        DeleteObject(hMono);
        DeleteObject(hBitmap);

        return result;
    }
```

- [ ] **Step 2: Add missing P/Invoke declarations**

Add to `TaskbarBadge.cs` if not already present (check existing imports first):

```csharp
    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint nPlanes, uint nBitCount, IntPtr lpBits);
```

Also verify that `CreateDIBSection`, `CreateIconIndirect`, `DeleteObject`, `BITMAPINFOHEADER`, and `ICONINFO` are already declared. They should be from the existing `CreateSmallBrmbleIcon` code.

- [ ] **Step 3: Add SetTheme method**

Add this public method:

```csharp
    /// <summary>
    /// Updates the overlay badge icon to use the given theme's accent color.
    /// Call from the UI thread.
    /// </summary>
    public static void SetTheme(string themeName)
    {
        // Destroy old badge icon
        if (_badgeIcon != IntPtr.Zero)
        {
            DestroyIcon(_badgeIcon);
            _badgeIcon = IntPtr.Zero;
        }

        var (r, g, b) = ThemeColors.GetAccent(themeName);
        _badgeIcon = CreateAccentDotIcon(r, g, b);

        // If badge is currently shown, re-apply with new icon
        if (_hasBadge && _initialized && _taskbarList != null && _badgeIcon != IntPtr.Zero)
        {
            _taskbarList.SetOverlayIcon(_hwnd, _badgeIcon, "Unread messages");
        }
    }
```

- [ ] **Step 4: Update Initialize to use default accent color**

In the `Initialize` method (around line 85), replace:
```csharp
        _badgeIcon = LoadBrmbleOverlayIcon();
```
with:
```csharp
        var (r, g, b) = ThemeColors.GetAccent(null); // default accent until theme message arrives
        _badgeIcon = CreateAccentDotIcon(r, g, b);
```

- [ ] **Step 5: Remove old LoadBrmbleOverlayIcon and CreateSmallBrmbleIcon methods**

Delete the `LoadBrmbleOverlayIcon()` method and the `CreateSmallBrmbleIcon()` method entirely -- they are no longer used.

- [ ] **Step 6: Build to verify**

Run: `dotnet build` from the repo root.
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/Brmble.Client/TaskbarBadge.cs
git commit -m "feat: replace taskbar overlay with theme-colored accent dot"
```

---

### Task 5: Add WM_SETICON Support to Win32Window

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

- [ ] **Step 1: Add WM_SETICON constant and SendMessage P/Invoke**

In `src/Brmble.Client/Win32Window.cs`, add these constants near the other `WM_` constants (around line 13-25):

```csharp
    public const uint WM_SETICON = 0x0080;
    public const IntPtr ICON_SMALL = 0;
    public const IntPtr ICON_BIG = 1;
```

Add the `SendMessage` P/Invoke near the other DllImport declarations:

```csharp
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
```

- [ ] **Step 2: Add SetWindowIcon helper method**

Add this helper method after the existing `LoadAppIcon` method (around line 265):

```csharp
    /// <summary>
    /// Updates the window's icon (taskbar and title bar) to the theme-specific .ico.
    /// Falls back to the default Resources/brmble.ico if theme folder doesn't exist.
    /// </summary>
    public static void SetWindowIcon(IntPtr hwnd, string? themeName)
    {
        var icoPath = ThemeColors.GetIconPath(themeName);
        if (!File.Exists(icoPath)) return;

        var hIconSm = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
        var hIconLg = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);

        if (hIconSm != IntPtr.Zero)
            SendMessage(hwnd, WM_SETICON, ICON_SMALL, hIconSm);
        if (hIconLg != IntPtr.Zero)
            SendMessage(hwnd, WM_SETICON, ICON_BIG, hIconLg);
    }
```

- [ ] **Step 3: Build to verify**

Run: `dotnet build` from the repo root.
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "feat: add WM_SETICON support for dynamic window icon updates"
```

---

### Task 6: Add notification.theme Bridge Handler (C#)

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

- [ ] **Step 1: Register the notification.theme handler**

In `src/Brmble.Client/Program.cs`, find the `notification.badge` handler (around line 374). Add the new handler directly after the closing `});` of the badge handler (after line 381):

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

- [ ] **Step 2: Build to verify**

Run: `dotnet build` from the repo root.
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: add notification.theme bridge handler for themed native icons"
```

---

### Task 7: Send notification.theme from Frontend

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`

- [ ] **Step 1: Add useEffect to send theme to native bridge**

In `src/Brmble.Web/src/App.tsx`, find the existing useEffect that pushes badge state (around line 1563):

```typescript
  // Push DM badge state to native side whenever unread count changes
  useEffect(() => {
    updateBadge(totalDmUnreadCount, hasPendingInvite);
  }, [totalDmUnreadCount, hasPendingInvite, updateBadge]);
```

Add a new useEffect directly after it:

```typescript
  // Push current theme to native side for themed tray/taskbar icons
  useEffect(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme) {
      bridge.send('notification.theme', { theme });
    }
  }, [bridge]);
```

This sends the theme on mount. For theme changes, we also need to observe them. Since theme changes happen via `applyTheme()` which sets the `data-theme` attribute, we need to also send the message when theme changes. The simplest approach is to use a MutationObserver:

Replace the above with:

```typescript
  // Push current theme to native side for themed tray/taskbar icons
  useEffect(() => {
    const sendTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        bridge.send('notification.theme', { theme });
      }
    };

    // Send current theme on mount
    sendTheme();

    // Watch for theme changes (applyTheme sets data-theme attribute)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          sendTheme();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, [bridge]);
```

- [ ] **Step 2: Build frontend to verify**

Run: `npm run build` in `src/Brmble.Web`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Web/src/App.tsx
git commit -m "feat: send notification.theme to native bridge on init and theme change"
```

---

### Task 8: Rename "Lemon Drop Martini" to "Lemon Drop" (#342)

**Files:**
- Modify: `src/Brmble.Web/src/themes/theme-registry.ts:47`
- Modify: `src/Brmble.Web/src/themes/lemon-drop.css:2,4`
- Modify: `src/Brmble.Web/src/themes/_template.css:620`

- [ ] **Step 1: Update display name in theme registry**

In `src/Brmble.Web/src/themes/theme-registry.ts`, line 47, change:
```typescript
    name: 'Lemon Drop Martini',
```
to:
```typescript
    name: 'Lemon Drop',
```

- [ ] **Step 2: Update CSS comments in lemon-drop.css**

In `src/Brmble.Web/src/themes/lemon-drop.css`, line 2, change:
```css
   Brmble Lemon Drop Martini Theme — Premium Gold
```
to:
```css
   Brmble Lemon Drop Theme — Premium Gold
```

On line 4, change:
```css
   Cocktail:   Lemon Drop Martini (vodka, triple sec, lemon juice)
```
to:
```css
   Cocktail:   Lemon Drop (vodka, triple sec, lemon juice)
```

- [ ] **Step 3: Update CSS comment in _template.css**

In `src/Brmble.Web/src/themes/_template.css`, line 620, change:
```css
       Lemon Drop Martini: Sora + Plus Jakarta Sans
```
to:
```css
       Lemon Drop:         Sora + Plus Jakarta Sans
```

(Adjust spacing to keep alignment with other theme names in the list.)

- [ ] **Step 4: Build frontend to verify**

Run: `npm run build` in `src/Brmble.Web`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/themes/theme-registry.ts src/Brmble.Web/src/themes/lemon-drop.css src/Brmble.Web/src/themes/_template.css
git commit -m "fix: rename 'Lemon Drop Martini' theme to 'Lemon Drop' (#342)"
```

---

### Task 9: Full Build Verification

- [ ] **Step 1: Build everything**

Run from repo root:
```bash
dotnet build
```
Expected: Build succeeds with no errors.

Then:
```bash
cd src/Brmble.Web && npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run tests**

```bash
dotnet test
```
Expected: All tests pass.

- [ ] **Step 3: Verify complete**

All changes are committed on branch `fix/dm-badge-count-contacts`. Ready for PR.
