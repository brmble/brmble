using System.Drawing;
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
    private static extern IntPtr CreateBitmap(int nWidth, int nHeight, uint cPlanes, uint cBitsPerPel, byte[]? lpvBits);

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

            _badgeIcon = LoadBrmbleOverlayIcon();
            _initialized = true;
        }
        catch
        {
            _initialized = false;
        }
    }

    private static IntPtr LoadBrmbleOverlayIcon()
    {
        try
        {
            return Win32Window.LoadAppIcon(16);
        }
        catch
        {
            return CreateSmallBrmbleIcon();
        }
    }

    private static IntPtr CreateSmallBrmbleIcon()
    {
        // Create a small 12x12 Brmble-style circle (green gradient)
        const int size = 12;
        var pixels = new byte[size * size * 4];

        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                var dx = x - 5.5;
                var dy = y - 5.5;
                var dist = Math.Sqrt(dx * dx + dy * dy);
                var idx = (y * size + x) * 4;

                if (dist <= 4.5)
                {
                    // Brmble green gradient from center
                    var factor = 1.0 - (dist / 5.0);
                    pixels[idx + 0] = (byte)(0x50 * factor + 0x30);  // Blue
                    pixels[idx + 1] = (byte)(0xC8 * factor + 0x80);  // Green
                    pixels[idx + 2] = (byte)(0x00 * factor + 0x20);  // Red
                    pixels[idx + 3] = 0xFF;  // Alpha
                }
                else if (dist <= 5.5)
                {
                    var alpha = (byte)(255 * (5.5 - dist));
                    pixels[idx + 0] = 0x40;
                    pixels[idx + 1] = 0xC0;
                    pixels[idx + 2] = 0x20;
                    pixels[idx + 3] = alpha;
                }
            }
        }

        return CreateIconFromArgb(size, pixels);
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

    private static IntPtr CreateIconFromArgb(int size, byte[] pixels)
    {
        var bmi = new BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            biWidth = size,
            biHeight = -size,
            biPlanes = 1,
            biBitCount = 32,
            biCompression = 0
        };

        var hbmColor = CreateDIBSection(IntPtr.Zero, ref bmi, 0, out var bits, IntPtr.Zero, 0);
        if (hbmColor == IntPtr.Zero || bits == IntPtr.Zero) return IntPtr.Zero;

        Marshal.Copy(pixels, 0, bits, pixels.Length);

        var stride = ((size + 15) / 16) * 2;
        var maskBits = new byte[stride * size];
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
