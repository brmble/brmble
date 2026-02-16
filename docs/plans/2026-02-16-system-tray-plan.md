# System Tray Icon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a system tray icon with context menu (Show App, Mute Self, Deafen Self, Quit) and close-to-tray behavior.

**Architecture:** New `TrayIcon` static class using raw `Shell_NotifyIcon` P/Invoke. Tray callbacks arrive via `WM_TRAYICON` (WM_USER+1) in WndProc. Programmatically generated colored circle icons indicate mute/deafen state. Close button hides to tray instead of quitting.

**Tech Stack:** C#, Win32 P/Invoke (shell32.dll, user32.dll, gdi32.dll), .NET 10

---

### Task 1: Add Win32Window constants and P/Invoke for tray support

**Files:**
- Modify: `src/Brmble.Client/Win32Window.cs`

**Step 1: Add new constants and P/Invoke declarations**

Add the following after the existing `SW_RESTORE` constant (line 22):

```csharp
public const int SW_HIDE = 0;
public const int SW_SHOW = 5;
```

Add the following after existing `WM_NCCALCSIZE` constant (line 18):

```csharp
public const uint WM_COMMAND = 0x0111;
public const uint WM_LBUTTONDBLCLK = 0x0203;
public const uint WM_RBUTTONUP = 0x0205;
```

Add the following P/Invoke declarations after the existing `SetWindowPos` import (around line 102):

```csharp
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hwnd);

[DllImport("user32.dll")]
public static extern bool DestroyWindow(IntPtr hwnd);

[DllImport("user32.dll")]
public static extern bool IsWindowVisible(IntPtr hwnd);
```

**Step 2: Build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 3: Commit**

```bash
git add src/Brmble.Client/Win32Window.cs
git commit -m "feat: add Win32 constants and P/Invoke for tray support"
```

---

### Task 2: Create TrayIcon class with Shell_NotifyIcon P/Invoke

**Files:**
- Create: `src/Brmble.Client/TrayIcon.cs`

**Step 1: Create `TrayIcon.cs` with P/Invoke, icon generation, and context menu**

Create `src/Brmble.Client/TrayIcon.cs` with this content:

```csharp
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Brmble.Client;

/// <summary>
/// Manages the system tray (notification area) icon and its context menu.
/// </summary>
internal static class TrayIcon
{
    // Shell_NotifyIcon commands
    private const uint NIM_ADD = 0x00;
    private const uint NIM_MODIFY = 0x01;
    private const uint NIM_DELETE = 0x02;

    // NOTIFYICONDATA flags
    private const uint NIF_MESSAGE = 0x01;
    private const uint NIF_ICON = 0x02;
    private const uint NIF_TIP = 0x04;

    // Menu flags
    private const uint MF_STRING = 0x0000;
    private const uint MF_SEPARATOR = 0x0800;
    private const uint MF_CHECKED = 0x0008;
    private const uint MF_UNCHECKED = 0x0000;
    private const uint MF_DEFAULT = 0x1000;
    private const uint TPM_RIGHTBUTTON = 0x0002;
    private const uint TPM_BOTTOMALIGN = 0x0020;

    // Menu item IDs
    public const int IDM_SHOW = 1001;
    public const int IDM_MUTE = 1002;
    public const int IDM_DEAFEN = 1003;
    public const int IDM_QUIT = 1004;

    /// <summary>
    /// Tray callback message ID (WM_USER + 1).
    /// </summary>
    public const uint WM_TRAYICON = 0x0401;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X, Y;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint dwMessage, ref NOTIFYICONDATA lpData);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool InsertMenu(IntPtr hMenu, uint uPosition, uint uFlags, nuint uIDNewItem, string lpNewItem);

    [DllImport("user32.dll")]
    private static extern bool TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetMenuDefaultItem(IntPtr hMenu, uint uItem, uint fByPos);

    [DllImport("user32.dll")]
    private static extern IntPtr CreateIcon(IntPtr hInstance, int nWidth, int nHeight,
        byte cPlanes, byte cBitsPixel, byte[] lpbANDbits, byte[] lpbXORbits);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private static NOTIFYICONDATA _nid;
    private static IntPtr _iconNormal;
    private static IntPtr _iconMuted;
    private static IntPtr _iconDeafened;
    private static bool _muted;
    private static bool _deafened;

    /// <summary>
    /// Creates the tray icon and adds it to the notification area.
    /// </summary>
    public static void Create(IntPtr hwnd)
    {
        CreateIcons();

        _nid = new NOTIFYICONDATA
        {
            cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = hwnd,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = WM_TRAYICON,
            hIcon = _iconNormal,
            szTip = "Brmble"
        };

        Shell_NotifyIcon(NIM_ADD, ref _nid);
    }

    /// <summary>
    /// Updates the tray icon and tooltip to reflect mute/deafen state.
    /// </summary>
    public static void UpdateState(bool muted, bool deafened)
    {
        _muted = muted;
        _deafened = deafened;

        if (deafened)
        {
            _nid.hIcon = _iconDeafened;
            _nid.szTip = "Brmble (Deafened)";
        }
        else if (muted)
        {
            _nid.hIcon = _iconMuted;
            _nid.szTip = "Brmble (Muted)";
        }
        else
        {
            _nid.hIcon = _iconNormal;
            _nid.szTip = "Brmble";
        }

        _nid.uFlags = NIF_ICON | NIF_TIP;
        Shell_NotifyIcon(NIM_MODIFY, ref _nid);
    }

    /// <summary>
    /// Shows the tray context menu at the cursor position.
    /// </summary>
    public static void ShowContextMenu(IntPtr hwnd)
    {
        var menu = CreatePopupMenu();
        InsertMenu(menu, 0, MF_STRING, IDM_SHOW, "Show App");
        SetMenuDefaultItem(menu, 0, 1); // first item is bold/default
        InsertMenu(menu, 1, MF_STRING | (_muted ? MF_CHECKED : MF_UNCHECKED), IDM_MUTE, "Mute Self");
        InsertMenu(menu, 2, MF_STRING | (_deafened ? MF_CHECKED : MF_UNCHECKED), IDM_DEAFEN, "Deafen Self");
        InsertMenu(menu, 3, MF_SEPARATOR, 0, "");
        InsertMenu(menu, 4, MF_STRING, IDM_QUIT, "Quit");

        GetCursorPos(out var pt);
        // SetForegroundWindow is required before TrackPopupMenu to dismiss properly
        Win32Window.SetForegroundWindow(hwnd);
        TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, pt.X, pt.Y, 0, hwnd, IntPtr.Zero);
        DestroyMenu(menu);
    }

    /// <summary>
    /// Removes the tray icon from the notification area and frees icon resources.
    /// </summary>
    public static void Destroy()
    {
        Shell_NotifyIcon(NIM_DELETE, ref _nid);
        if (_iconNormal != IntPtr.Zero) DestroyIcon(_iconNormal);
        if (_iconMuted != IntPtr.Zero) DestroyIcon(_iconMuted);
        if (_iconDeafened != IntPtr.Zero) DestroyIcon(_iconDeafened);
    }

    /// <summary>
    /// Creates simple 16x16 colored circle icons for each state.
    /// </summary>
    private static void CreateIcons()
    {
        // 16x16 monochrome icons: AND mask (transparency) and XOR mask (color)
        // For CreateIcon with 1 plane, 1 bit per pixel:
        // AND=0 XOR=1 → white pixel, AND=0 XOR=0 → black pixel
        // AND=1 XOR=0 → transparent, AND=1 XOR=1 → inverted
        // We'll create simple filled circle patterns

        var and = new byte[16 * 16 / 8]; // 32 bytes - AND mask
        var xor = new byte[16 * 16 / 8]; // 32 bytes - XOR mask

        // For a simple approach: fill all pixels as opaque (AND=0) and colored (XOR=1)
        // This gives us white icons. For colored icons we need more bits.
        // Better approach: use 32bpp ARGB icons via CreateIconIndirect

        _iconNormal = CreateColoredIcon(0x00, 0xC8, 0x50);    // green
        _iconMuted = CreateColoredIcon(0xE8, 0xB0, 0x00);     // yellow/amber
        _iconDeafened = CreateColoredIcon(0xD4, 0x14, 0x5A);   // berry red (accent-berry)
    }

    private static IntPtr CreateColoredIcon(byte r, byte g, byte b)
    {
        // Create a 16x16 32-bit ARGB bitmap for the icon
        const int size = 16;
        var pixels = new byte[size * size * 4]; // BGRA format

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                // Circle: distance from center (7.5, 7.5) with radius 7
                var dx = x - 7.5;
                var dy = y - 7.5;
                var dist = Math.Sqrt(dx * dx + dy * dy);
                var idx = (y * size + x) * 4;

                if (dist <= 6.5)
                {
                    // Inside circle
                    pixels[idx + 0] = b;     // Blue
                    pixels[idx + 1] = g;     // Green
                    pixels[idx + 2] = r;     // Red
                    pixels[idx + 3] = 0xFF;  // Alpha (opaque)
                }
                else if (dist <= 7.5)
                {
                    // Anti-alias edge
                    var alpha = (byte)(255 * (7.5 - dist));
                    pixels[idx + 0] = b;
                    pixels[idx + 1] = g;
                    pixels[idx + 2] = r;
                    pixels[idx + 3] = alpha;
                }
                // else: transparent (all zeros)
            }
        }

        return CreateIconFromArgb(size, pixels);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ICONINFO
    {
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public uint biSize;
        public int biWidth;
        public int biHeight;
        public ushort biPlanes;
        public ushort biBitCount;
        public uint biCompression;
        public uint biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public uint biClrUsed;
        public uint biClrImportant;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr CreateIconIndirect(ref ICONINFO piconinfo);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint cPlanes, uint cBitsPerPel, byte[]? lpvBits);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER pbmi, uint iUsage, out IntPtr ppvBits, IntPtr hSection, uint dwOffset);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    private static IntPtr CreateIconFromArgb(int size, byte[] pixels)
    {
        // Create color bitmap (32-bit ARGB)
        var bmi = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = size,
            biHeight = -size, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0 // BI_RGB
        };

        var hbmColor = CreateDIBSection(IntPtr.Zero, ref bmi, 0, out var bits, IntPtr.Zero, 0);
        if (hbmColor == IntPtr.Zero || bits == IntPtr.Zero)
        {
            Debug.WriteLine("[TrayIcon] Failed to create DIB section");
            return IntPtr.Zero;
        }

        Marshal.Copy(pixels, 0, bits, pixels.Length);

        // Create monochrome mask bitmap (all zeros = opaque, alpha is in color bitmap)
        var maskBits = new byte[size * size / 8];
        var hbmMask = CreateBitmap(size, size, 1, 1, maskBits);

        var iconInfo = new ICONINFO
        {
            fIcon = true,
            hbmMask = hbmMask,
            hbmColor = hbmColor
        };

        var hIcon = CreateIconIndirect(ref iconInfo);

        DeleteObject(hbmColor);
        DeleteObject(hbmMask);

        return hIcon;
    }
}
```

**Step 2: Build to verify**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 3: Commit**

```bash
git add src/Brmble.Client/TrayIcon.cs
git commit -m "feat: add TrayIcon class with Shell_NotifyIcon and context menu"
```

---

### Task 3: Wire up tray icon in Program.cs

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

**Step 1: Add tray icon lifecycle and WndProc handlers**

In `Main()`, add `TrayIcon.Create(_hwnd)` after `ForceFrameChange` (after line 49):

```csharp
TrayIcon.Create(_hwnd);
```

Add mute/deafen state tracking fields after the `_hwnd` field (after line 32):

```csharp
private static bool _muted;
private static bool _deafened;
```

In `SetupBridgeHandlers()`, add handlers for mute/deafen state changes (after the existing `window.close` handler, around line 126):

```csharp
_bridge.RegisterHandler("voice.selfMuteChanged", data =>
{
    if (data.TryGetProperty("muted", out var m))
    {
        _muted = m.GetBoolean();
        TrayIcon.UpdateState(_muted, _deafened);
    }
    return Task.CompletedTask;
});

_bridge.RegisterHandler("voice.selfDeafChanged", data =>
{
    if (data.TryGetProperty("deafened", out var d))
    {
        _deafened = d.GetBoolean();
        TrayIcon.UpdateState(_muted, _deafened);
    }
    return Task.CompletedTask;
});
```

In `WndProc`, change the `WM_CLOSE` behavior — add this case **before** the `WM_DESTROY` case in the switch:

```csharp
case Win32Window.WM_CLOSE:
    Win32Window.ShowWindow(hwnd, Win32Window.SW_HIDE);
    return IntPtr.Zero;
```

In `WndProc`, change the `WM_DESTROY` handler to clean up the tray icon:

```csharp
case Win32Window.WM_DESTROY:
    TrayIcon.Destroy();
    Win32Window.PostQuitMessage(0);
    return IntPtr.Zero;
```

Add the tray callback handler and command handler in the switch:

```csharp
case TrayIcon.WM_TRAYICON:
    var trayMsg = (uint)(lParam.ToInt64() & 0xFFFF);
    if (trayMsg == Win32Window.WM_RBUTTONUP)
        TrayIcon.ShowContextMenu(hwnd);
    else if (trayMsg == Win32Window.WM_LBUTTONDBLCLK)
    {
        Win32Window.ShowWindow(hwnd, Win32Window.SW_RESTORE);
        Win32Window.SetForegroundWindow(hwnd);
    }
    return IntPtr.Zero;

case Win32Window.WM_COMMAND:
    var menuId = (int)(wParam.ToInt64() & 0xFFFF);
    switch (menuId)
    {
        case TrayIcon.IDM_SHOW:
            Win32Window.ShowWindow(hwnd, Win32Window.SW_RESTORE);
            Win32Window.SetForegroundWindow(hwnd);
            break;
        case TrayIcon.IDM_MUTE:
            _bridge?.Send("voice.toggleMute");
            break;
        case TrayIcon.IDM_DEAFEN:
            _bridge?.Send("voice.toggleDeaf");
            break;
        case TrayIcon.IDM_QUIT:
            Win32Window.DestroyWindow(hwnd);
            break;
    }
    return IntPtr.Zero;
```

Also remove the existing `WM_CLOSE` handling — currently the header's close button sends `window.close` which posts `WM_CLOSE`. With our new `WM_CLOSE` case hiding the window, this still works: the HTML close button hides to tray. But we need to update the bridge handler for `window.close` to **not** post `WM_CLOSE` if the user wants to actually close — wait, actually this is correct. The HTML close button should minimize to tray too. Only the tray "Quit" menu should actually quit (via `DestroyWindow`).

**Step 2: Build and verify**

Run: `dotnet build src/Brmble.Client`
Expected: Build succeeded, 0 errors

**Step 3: Smoke test**

Run: `dotnet run --project src/Brmble.Client`

Verify:
- Tray icon appears (green circle) in the notification area
- Right-click tray icon shows context menu with: Show App, Mute Self, Deafen Self, separator, Quit
- Double-click tray icon restores the window
- Clicking X (close) hides the window to tray (does NOT quit)
- "Show App" from tray menu restores window
- "Quit" from tray menu exits the app
- Mute Self / Deafen Self toggles work (when connected to a server)
- Icon changes color when muted (yellow) or deafened (berry red)

**Step 4: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "feat: wire up tray icon lifecycle, close-to-tray, and menu commands"
```
