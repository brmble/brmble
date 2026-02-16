# Remove Title Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the default Windows title bar, keeping native caption buttons, using DWM frame extension.

**Architecture:** Use `DwmExtendFrameIntoClientArea` with top margin -1 to extend the frame glass into the client area. Handle `WM_NCCALCSIZE` to collapse the non-client area. Route messages through `DwmDefWindowProc` for caption button hit-testing. Add CSS drag region to the web Header component.

**Tech Stack:** Win32 API, DWM API (dwmapi.dll), WebView2, React, CSS

---

### Task 1: Add DWM P/Invoke declarations to Win32Window.cs

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

**Step 1: Add MARGINS struct and DWM imports**

Add after the existing P/Invoke declarations (after line 84):

```csharp
[StructLayout(LayoutKind.Sequential)]
public struct MARGINS
{
    public int Left, Right, Top, Bottom;
}

[DllImport("dwmapi.dll")]
public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

[DllImport("dwmapi.dll")]
public static extern int DwmDefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, out IntPtr result);
```

**Step 2: Add new message constants**

Add after the existing `WM_SIZE` constant (after line 14):

```csharp
public const uint WM_ACTIVATE = 0x0006;
public const uint WM_NCCALCSIZE = 0x0083;
```

**Step 3: Add helper method to apply DWM frame extension**

Add a public static method to Win32Window:

```csharp
public static void ExtendFrameIntoClientArea(IntPtr hwnd)
{
    var margins = new MARGINS { Left = 0, Right = 0, Top = -1, Bottom = 0 };
    DwmExtendFrameIntoClientArea(hwnd, ref margins);
}
```

**Step 4: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 5: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "feat: add DWM P/Invoke declarations for frameless window"
```

---

### Task 2: Update WndProc and window creation in Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Call ExtendFrameIntoClientArea after window creation**

In `Main()`, after the `Win32Window.Create` call (line 46), add:

```csharp
var hwnd = Win32Window.Create("BrmbleWindow", "Brmble", 1280, 720, WndProc);
Win32Window.ExtendFrameIntoClientArea(hwnd);
```

**Step 2: Update WndProc to route through DwmDefWindowProc first**

Replace the default case in the switch statement. The full updated WndProc:

```csharp
private static IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
{
    // Let DWM handle caption button hit-testing first
    if (Win32Window.DwmDefWindowProc(hwnd, msg, wParam, lParam, out var dwmResult) != 0)
        return dwmResult;

    switch (msg)
    {
        case Win32Window.WM_NCCALCSIZE:
            // When wParam is 1, returning 0 removes the non-client area (title bar)
            if (wParam != IntPtr.Zero)
                return IntPtr.Zero;
            break;

        case Win32Window.WM_ACTIVATE:
            Win32Window.ExtendFrameIntoClientArea(hwnd);
            return IntPtr.Zero;

        case Win32Window.WM_SIZE:
            if (_controller != null)
            {
                Win32Window.GetClientRect(hwnd, out var rect);
                _controller.Bounds = new Rectangle(0, 0, rect.Right - rect.Left, rect.Bottom - rect.Top);
            }
            return IntPtr.Zero;

        case Win32Window.WM_DESTROY:
            Win32Window.PostQuitMessage(0);
            return IntPtr.Zero;

        case 0x0400: // WM_USER
            _bridge?.ProcessUiMessage();
            return IntPtr.Zero;
    }

    return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
}
```

**Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeded

**Step 4: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: handle DWM messages to remove title bar"
```

---

### Task 3: Add drag region to Header CSS

**Files:**
- Modify: `src/Brmble.Web/src/components/Header/Header.css`

**Step 1: Add drag region styles**

Add `-webkit-app-region: drag` to `.header` and `no-drag` to interactive children. Add right padding for caption buttons:

In `.header`, add:
```css
  -webkit-app-region: drag;
  padding-right: 138px;
```

Add new rule:
```css
.header-right {
  -webkit-app-region: no-drag;
}
```

Note: `.header-right` already exists — just add the `app-region` property to it.

**Step 2: Build frontend to verify**

Run: `cd src/Brmble.Web && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Web/src/components/Header/Header.css
git commit -m "feat: add drag region to header for frameless window"
```

---

### Task 4: Manual smoke test

**Step 1: Build everything**

Run: `dotnet build`
Expected: Build succeeded

**Step 2: Run the app**

Run: `dotnet run --project src/Brmble.Client`

**Verify:**
- Window has no title bar text/background
- Native minimize/maximize/close buttons appear at top-right
- Clicking the BRMBLE logo area and dragging moves the window
- Buttons in the header (user panel, settings) are clickable (not intercepted by drag)
- Window can be resized from all edges
- Maximize/restore works correctly
- Win11 Snap Layouts appear when hovering maximize button

**Step 3: Commit any adjustments if needed**
