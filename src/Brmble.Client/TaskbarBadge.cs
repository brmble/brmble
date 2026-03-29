using System.Runtime.InteropServices;

namespace Brmble.Client;

internal static class TaskbarBadge
{
    private static ITaskbarList3? _taskbarList;
    private static IntPtr _hwnd;
    private static IntPtr _badgeIcon;
    private static bool _hasBadge;
    private static bool _initialized;

    [ComImport]
    [Guid("ea1afb91-9e28-4b86-90e9-9e9f8a5eefaf")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ITaskbarList3
    {
        void HrInit();
        void AddTab(IntPtr hwnd);
        void DeleteTab(IntPtr hwnd);
        void ActivateTab(IntPtr hwnd);
        void SetActiveAlt(IntPtr hwnd);
        void MarkFullscreenWindow(IntPtr hwnd, [MarshalAs(UnmanagedType.Bool)] bool fFullscreen);
        void SetProgressValue(IntPtr hwnd, ulong ullCompleted, ulong ullTotal);
        void SetProgressState(IntPtr hwnd, int tbpFlags);
        void RegisterTab(IntPtr hwndTab, IntPtr hwndMDI);
        void UnregisterTab(IntPtr hwndTab);
        void SetTabOrder(IntPtr hwndTab, IntPtr hwndInsertBefore);
        void SetTabActive(IntPtr hwndTab, IntPtr hwndMDI, uint dwReserved);
        void ThumbBarAddButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
        void ThumbBarUpdateButtons(IntPtr hwnd, uint cButtons, IntPtr pButton);
        void ThumbBarSetImageList(IntPtr hwnd, IntPtr himl);
        void SetOverlayIcon(IntPtr hwnd, IntPtr hIcon, [MarshalAs(UnmanagedType.LPWStr)] string pszDescription);
        void SetThumbnailTooltip(IntPtr hwnd, [MarshalAs(UnmanagedType.LPWStr)] string pszTip);
        void SetThumbnailClip(IntPtr hwnd, IntPtr prcClip);
    }

    [ComImport]
    [Guid("56FDF344-FD6D-11d0-958A-006097C9A090")]
    [ClassInterface(ClassInterfaceType.None)]
    private class TaskbarList { }

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

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER pbmi, uint iUsage, out IntPtr ppvBits, IntPtr hSection, uint dwOffset);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    private static extern IntPtr CreateIconIndirect(ref ICONINFO piconinfo);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint nPlanes, uint nBitCount, IntPtr lpBits);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteDC(IntPtr hdc);

    [StructLayout(LayoutKind.Sequential)]
    private struct ICONINFO
    {
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    public static void Initialize(IntPtr hwnd)
    {
        _hwnd = hwnd;

        try
        {
            _taskbarList = (ITaskbarList3)new TaskbarList();
            _taskbarList.HrInit();

            var (r, g, b) = ThemeColors.GetAccent(null); // default accent until theme message arrives
            _badgeIcon = CreateAccentDotIcon(r, g, b);
            _initialized = true;
        }
        catch
        {
            _initialized = false;
        }
    }

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

    public static void SetHasBadge(bool hasBadge)
    {
        if (!_initialized || _taskbarList == null)
            return;

        _hasBadge = hasBadge;

        if (hasBadge && _badgeIcon != IntPtr.Zero)
        {
            _taskbarList.SetOverlayIcon(_hwnd, _badgeIcon, "Unread messages");
        }
        else
        {
            _taskbarList.SetOverlayIcon(_hwnd, IntPtr.Zero, "");
        }
    }

    public static void Destroy()
    {
        if (_badgeIcon != IntPtr.Zero)
        {
            DestroyIcon(_badgeIcon);
            _badgeIcon = IntPtr.Zero;
        }
        _taskbarList = null;
        _initialized = false;
    }
}
