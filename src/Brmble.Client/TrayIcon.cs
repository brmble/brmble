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
    private static extern bool DestroyIcon(IntPtr hIcon);

    private static NOTIFYICONDATA _nid;
    private static IntPtr _iconNormal;
    private static IntPtr _iconMuted;
    private static IntPtr _iconDeafened;
    private static IntPtr _iconNormalNotified;
    private static IntPtr _iconMutedNotified;
    private static IntPtr _iconDeafenedNotified;
    private static bool _muted;
    private static bool _deafened;
    private static bool _hasNotification;

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

        if (_hasNotification)
        {
            if (deafened)
            {
                _nid.hIcon = _iconDeafenedNotified;
                _nid.szTip = "Brmble (Deafened) •";
            }
            else if (muted)
            {
                _nid.hIcon = _iconMutedNotified;
                _nid.szTip = "Brmble (Muted) •";
            }
            else
            {
                _nid.hIcon = _iconNormalNotified;
                _nid.szTip = "Brmble •";
            }
        }
        else
        {
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
        }

        _nid.uFlags = NIF_ICON | NIF_TIP;
        Shell_NotifyIcon(NIM_MODIFY, ref _nid);
    }

    /// <summary>
    /// Sets whether the notification indicator is shown on the tray icon.
    /// </summary>
    public static void SetNotification(bool hasNotification)
    {
        _hasNotification = hasNotification;
        UpdateState(_muted, _deafened);
    }

    /// <summary>
    /// Shows the tray context menu at the cursor position.
    /// </summary>
    public static void ShowContextMenu(IntPtr hwnd)
    {
        var menu = CreatePopupMenu();
        InsertMenu(menu, 0, MF_STRING, IDM_SHOW, "Show App");
        SetMenuDefaultItem(menu, 0, 1);
        InsertMenu(menu, 1, MF_STRING | (_muted ? MF_CHECKED : MF_UNCHECKED), IDM_MUTE, "Mute Self");
        InsertMenu(menu, 2, MF_STRING | (_deafened ? MF_CHECKED : MF_UNCHECKED), IDM_DEAFEN, "Deafen Self");
        InsertMenu(menu, 3, MF_SEPARATOR, 0, "");
        InsertMenu(menu, 4, MF_STRING, IDM_QUIT, "Quit");

        GetCursorPos(out var pt);
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

    private static void CreateIcons()
    {
        _iconNormal = CreateColoredIcon(0x00, 0xC8, 0x50);    // green
        _iconMuted = CreateColoredIcon(0xE8, 0xB0, 0x00);     // yellow/amber
        _iconDeafened = CreateColoredIcon(0xD4, 0x14, 0x5A);   // berry red
    }

    private static IntPtr CreateColoredIcon(byte r, byte g, byte b)
    {
        const int size = 16;
        var pixels = new byte[size * size * 4];

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                var dx = x - 7.5;
                var dy = y - 7.5;
                var dist = Math.Sqrt(dx * dx + dy * dy);
                var idx = (y * size + x) * 4;

                if (dist <= 6.5)
                {
                    pixels[idx + 0] = b;     // Blue
                    pixels[idx + 1] = g;     // Green
                    pixels[idx + 2] = r;     // Red
                    pixels[idx + 3] = 0xFF;  // Alpha
                }
                else if (dist <= 7.5)
                {
                    var alpha = (byte)(255 * (7.5 - dist));
                    pixels[idx + 0] = b;
                    pixels[idx + 1] = g;
                    pixels[idx + 2] = r;
                    pixels[idx + 3] = alpha;
                }
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
        var bmi = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = size,
            biHeight = -size, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0
        };

        var hbmColor = CreateDIBSection(IntPtr.Zero, ref bmi, 0, out var bits, IntPtr.Zero, 0);
        if (hbmColor == IntPtr.Zero || bits == IntPtr.Zero)
        {
            Debug.WriteLine("[TrayIcon] Failed to create DIB section");
            return IntPtr.Zero;
        }

        Marshal.Copy(pixels, 0, bits, pixels.Length);

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
