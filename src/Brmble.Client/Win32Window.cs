using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Brmble.Client;

internal static class Win32Window
{
    private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    private const uint WS_POPUP = 0x80000000;
    private const uint WS_VISIBLE = 0x10000000;
    private const uint WS_EX_LAYERED = 0x00080000;
    private const uint WS_EX_TRANSPARENT = 0x00000020;
    private const uint WS_EX_TOOLWINDOW = 0x00000080;
    private const uint WS_EX_NOACTIVATE = 0x08000000;
    public const int CW_USEDEFAULT = unchecked((int)0x80000000);
    private const uint CS_HREDRAW = 0x0002;
    private const uint CS_VREDRAW = 0x0001;

    public const uint WM_DESTROY = 0x0002;
    public const uint WM_MOVE = 0x0003;
    public const uint WM_CLOSE = 0x0010;
    public const uint WM_SIZE = 0x0005;
    public const uint WM_ACTIVATE = 0x0006;
    public const uint WM_SYSCOMMAND = 0x0112;
    public const uint WM_NCCALCSIZE = 0x0083;
    public const uint WM_NCHITTEST = 0x0084;
    public const uint WM_GETMINMAXINFO = 0x0024;
    public const uint WM_COMMAND = 0x0111;
    public const uint WM_LBUTTONDBLCLK = 0x0203;
    public const uint WM_RBUTTONUP = 0x0205;
    public const uint WM_INPUT = 0x00FF;
    public const uint WM_HOTKEY = 0x0312;
    public const uint WM_SETICON = 0x0080;

    // WM_SYSCOMMAND wParam values for SC_SIZE direction (see WinUser.h):
    //   WMSZ_LEFT = 1, WMSZ_RIGHT = 2, WMSZ_TOP = 3, WMSZ_TOPLEFT = 4,
    //   WMSZ_TOPRIGHT = 5, WMSZ_BOTTOM = 6, WMSZ_BOTTOMLEFT = 7, WMSZ_BOTTOMRIGHT = 8.
    public const uint SC_SIZE = 0xF000;
    public const IntPtr ICON_SMALL = 0;
    public const IntPtr ICON_BIG = 1;

    public const uint RIM_INPUT = 0x00;
    public const uint RIM_INPUTSINK = 0x01;

    public const uint RIDEV_INPUTSINK = 0x00000001;

    // SetWindowPos constants
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOZORDER = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTDEVICE
    {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTHEADER
    {
        public uint dwType;
        public uint dwSize;
        public IntPtr hDevice;
        public IntPtr wParam;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWMOUSE
    {
        public ushort usFlags;
        public ushort usButtonFlags;
        public ushort usButtonData;
        public uint ulRawButtons;
        public int lLastX;
        public int lLastY;
        public uint ulExtraInformation;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct RAWINPUTDATA
    {
        [FieldOffset(0)]
        public RAWMOUSE mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUT
    {
        public RAWINPUTHEADER header;
        public RAWINPUTDATA data;
    }

    [DllImport("user32.dll")]
    public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

    [DllImport("user32.dll")]
    public static extern uint GetRawInputData(IntPtr hRawInput, uint uiCommand, IntPtr pData, ref uint pcbSize, uint cbSizeHeader);

    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;
    public const int SW_RESTORE = 9;
    public const int SW_HIDE = 0;
    public const int SW_SHOW = 5;
    public const int SW_SHOWMAXIMIZED = SW_MAXIMIZE;

    public delegate IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX
    {
        public uint cbSize;
        public uint style;
        public WndProc lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X, Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WINDOWPLACEMENT
    {
        public uint length;
        public uint flags;
        public uint showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
        public RECT rcDevice;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MONITORINFO
    {
        public uint cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassEx(ref WNDCLASSEX lpwcx);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(
        uint exStyle, string className, string windowName, uint style,
        int x, int y, int width, int height,
        IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);

    [DllImport("user32.dll")]
    public static extern bool GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG msg);

    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG msg);

    [DllImport("user32.dll")]
    public static extern void PostQuitMessage(int exitCode);

    [DllImport("user32.dll")]
    public static extern IntPtr DefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool ScreenToClient(IntPtr hwnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int cmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsZoomed(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr hwndInsertAfter,
        int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    public const uint MONITOR_DEFAULTTONULL = 0x00000000;
    public const uint MONITOR_DEFAULTTOPRIMARY = 0x00000001;

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);

    [DllImport("user32.dll")]
    public static extern bool GetWindowPlacement(IntPtr hwnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(IntPtr instance, int cursorName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hInst, string name, uint type,
        int cx, int cy, uint fuLoad);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string AppID);

    /// <summary>
    /// Sets an explicit AppUserModelID for the current process so the Windows taskbar
    /// treats this app as its own grouping. Without this, Velopack-installed builds
    /// can have the taskbar bind to the launcher stub's icon resource, which makes
    /// runtime WM_SETICON updates (theme-aware icons) appear to do nothing.
    /// Must be called before any window is created.
    /// </summary>
    public static void SetAppUserModelId(string appId)
    {
        try { SetCurrentProcessExplicitAppUserModelID(appId); }
        catch (Exception ex) { Debug.WriteLine($"[AppUserModelID] Failed to set '{appId}': {ex.Message}"); }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x0010;

    private static IntPtr _currentSmallIcon;
    private static IntPtr _currentBigIcon;

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateSolidBrush(uint crColor);

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

    public const int SIZE_RESTORED = 0;
    public const int SIZE_MAXIMIZED = 2;

    public static IntPtr CreateBackgroundBrush(uint colorRef)
    {
        return CreateSolidBrush(colorRef);
    }

    [DllImport("kernel32.dll")]
    public static extern bool AllocConsole();

    [DllImport("kernel32.dll")]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? moduleName);

    [StructLayout(LayoutKind.Sequential)]
    public struct MARGINS
    {
        public int Left, Right, Top, Bottom;
    }

    [DllImport("dwmapi.dll")]
    public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    [DllImport("dwmapi.dll")]
    public static extern int DwmDefWindowProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, out IntPtr result);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, uint attribute, ref int pvAttribute, uint cbAttribute);

    // Win11-only DWM attributes. Older Windows versions silently ignore them.
    private const uint DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const uint DWMWA_BORDER_COLOR = 34;
    private const int DWMWCP_ROUND = 2;

    /// <summary>
    /// Packs an (R, G, B) triple into a Win32 COLORREF (0x00BBGGRR).
    /// Used by the window-class background brush and DWMWA_BORDER_COLOR.
    /// </summary>
    public static uint ToColorRef(byte r, byte g, byte b) => (uint)(b << 16 | g << 8 | r);

    /// <summary>
    /// Enables Win11 rounded window corners (~8px radius). No-op on Windows 10.
    /// </summary>
    public static void EnableRoundedCorners(IntPtr hwnd)
    {
        int preference = DWMWCP_ROUND;
        DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref preference, sizeof(int));
    }

    /// <summary>
    /// Sets the 1px DWM-drawn outline color around the window. Win11 22H2+ only;
    /// older Windows versions silently ignore the call. colorRef is COLORREF
    /// (0x00BBGGRR) — same layout as the window-class brush colors.
    /// </summary>
    public static void SetBorderColor(IntPtr hwnd, uint colorRef)
    {
        int c = (int)colorRef;
        DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, ref c, sizeof(int));
    }

    private static readonly List<WndProc> _wndProcRefs = []; // prevent GC of delegates

    /// <summary>
    /// Loads the Brmble application icon from the Resources folder next to the executable.
    /// Returns IntPtr.Zero if the file is not found.
    /// </summary>
    public static IntPtr LoadAppIcon(int size)
    {
        var icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Resources", "brmble.ico");
        if (!File.Exists(icoPath)) return IntPtr.Zero;
        return LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, size, size, LR_LOADFROMFILE);
    }

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
        {
            SendMessage(hwnd, WM_SETICON, ICON_SMALL, hIconSm);
            if (_currentSmallIcon != IntPtr.Zero)
                DestroyIcon(_currentSmallIcon);
            _currentSmallIcon = hIconSm;
        }
        if (hIconLg != IntPtr.Zero)
        {
            SendMessage(hwnd, WM_SETICON, ICON_BIG, hIconLg);
            if (_currentBigIcon != IntPtr.Zero)
                DestroyIcon(_currentBigIcon);
            _currentBigIcon = hIconLg;
        }
    }

    public static IntPtr Create(string className, string title, int x, int y, int width, int height, WndProc wndProc, uint backgroundColorRef)
    {
        var hInstance = GetModuleHandle(null);
        _wndProcRefs.Add(wndProc);

        var hIconLg = LoadAppIcon(32);  // taskbar / Alt+Tab
        var hIconSm = LoadAppIcon(16);  // title bar (if visible)

        var wc = new WNDCLASSEX
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEX>(),
            style = CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc = wndProc,
            hInstance = hInstance,
            hIcon = hIconLg,
            hIconSm = hIconSm,
            hCursor = LoadCursor(IntPtr.Zero, 32512),
            hbrBackground = CreateSolidBrush(backgroundColorRef),
            lpszClassName = className
        };
        RegisterClassEx(ref wc);

        return CreateWindowEx(0, className, title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            x, y, width, height,
            IntPtr.Zero, IntPtr.Zero, hInstance, IntPtr.Zero);
    }

    public static IntPtr CreateOverlay(string className, string title, IntPtr anchorHwnd, WndProc wndProc)
    {
        var hInstance = GetModuleHandle(null);
        _wndProcRefs.Add(wndProc);

        var workArea = GetMonitorWorkArea(anchorHwnd);

        var wc = new WNDCLASSEX
        {
            cbSize = (uint)Marshal.SizeOf<WNDCLASSEX>(),
            style = CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc = wndProc,
            hInstance = hInstance,
            hCursor = IntPtr.Zero,
            hbrBackground = IntPtr.Zero,
            lpszClassName = className
        };
        RegisterClassEx(ref wc);

        return CreateWindowEx(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            className,
            title,
            WS_POPUP,
            workArea.Left,
            workArea.Top,
            workArea.Right - workArea.Left,
            workArea.Bottom - workArea.Top,
            IntPtr.Zero,
            IntPtr.Zero,
            hInstance,
            IntPtr.Zero);
    }

    public static RECT GetMonitorWorkArea(IntPtr hwnd)
    {
        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONULL);
        if (monitor == IntPtr.Zero)
        {
            // Fall back to primary monitor using MonitorFromWindow with MONITOR_DEFAULTTOPRIMARY
            monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY);
        }

        var monitorInfo = new MONITORINFO { cbSize = (uint)Marshal.SizeOf<MONITORINFO>() };
        if (monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref monitorInfo))
        {
            return monitorInfo.rcWork;
        }

        // Last resort: use system metrics for primary screen
        return new RECT
        {
            Left = 0,
            Top = 0,
            Right = GetSystemMetrics(SM_CXSCREEN),
            Bottom = GetSystemMetrics(SM_CYSCREEN)
        };
    }

    public static void ExtendFrameIntoClientArea(IntPtr hwnd)
    {
        // Zero margins: no DWM glass extension. The entire client area is
        // painted by the app (WebView2 + hbrBackground brush for the resize
        // border strip). IsNonClientRegionSupportEnabled still enables
        // app-region:drag because it is a WebView2 setting, not DWM-dependent.
        var margins = new MARGINS { Left = 0, Right = 0, Top = 0, Bottom = 0 };
        DwmExtendFrameIntoClientArea(hwnd, ref margins);
    }

    public static void ForceFrameChange(IntPtr hwnd)
    {
        GetWindowRect(hwnd, out var rect);
        SetWindowPos(hwnd, IntPtr.Zero,
            rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    public static void RunMessageLoop()
    {
        while (GetMessage(out var msg, IntPtr.Zero, 0, 0))
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }
}
