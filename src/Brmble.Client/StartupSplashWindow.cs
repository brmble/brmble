using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Brmble.Client;

/// <summary>
/// Small native startup surface shown while the main WebView is being prepared.
/// It deliberately owns its window class and all native handles so it cannot
/// affect the main window's WebView lifecycle.
/// </summary>
internal sealed class StartupSplashWindow : IDisposable
{
    internal event Action? Dismissed;
    private const int Width = 360;
    private const int Height = 240;
    private const uint WsPopup = 0x80000000;
    private const uint WsExToolWindow = 0x00000080;
    private const uint WsExTopmost = 0x00000008;
    private const uint WsExNoActivate = 0x08000000;
    private const uint ClassHRedraw = 0x0002;
    private const uint ClassVRedraw = 0x0001;
    private const uint WmPaint = 0x000F;
    private const uint WmEraseBkgnd = 0x0014;
    private const uint WmClose = 0x0010;
    private const uint WmDestroy = 0x0002;
    private const uint WmTimer = 0x0113;
    private const uint SpiGetClientAreaAnimation = 0x1042;
    private const uint TimerId = 1;
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const uint SwShow = 5;

    private static readonly WndProc WindowProcedure = WindowProc;
    private readonly string _className = $"BrmbleStartupSplash_{Environment.ProcessId}";
    private IntPtr _windowHandle;
    private IntPtr _classAtom;
    private Bitmap? _mark;
    private Color _background;
    private Color _accent;
    private bool _error;
    private bool _animationEnabled;
    private int _pulse;

    internal bool IsVisible => _windowHandle != IntPtr.Zero;

    internal static uint GetExtendedWindowStyle() => WsExToolWindow | WsExTopmost | WsExNoActivate;

    internal void Show(string theme)
    {
        Close();
        _active = this;
        _error = false;
        _pulse = 0;
        var (r, g, b) = ThemeColors.GetBgDeep(theme);
        _background = Color.FromArgb(r, g, b);
        (r, g, b) = ThemeColors.GetAccent(theme);
        _accent = Color.FromArgb(r, g, b);
        _mark = LoadMark(theme);
        _animationEnabled = GetClientAreaAnimationSetting();

        RegisterWindowClass();
        var workArea = GetPrimaryWorkArea();
        var x = workArea.Left + Math.Max(0, (workArea.Right - workArea.Left - Width) / 2);
        var y = workArea.Top + Math.Max(0, (workArea.Bottom - workArea.Top - Height) / 2);
        _windowHandle = CreateWindowEx(
            GetExtendedWindowStyle(), _className, "Brmble", WsPopup,
            x, y, Width, Height, IntPtr.Zero, IntPtr.Zero, GetModuleHandle(null), IntPtr.Zero);

        if (_windowHandle == IntPtr.Zero)
        {
            DisposeMark();
            return;
        }

        ShowWindow(_windowHandle, SwShow);
        UpdateWindow(_windowHandle);
        if (_animationEnabled)
            SetTimer(_windowHandle, TimerId, 90, IntPtr.Zero);
    }

    internal void Close()
    {
        if (_windowHandle != IntPtr.Zero)
        {
            KillTimer(_windowHandle, TimerId);
            DestroyWindow(_windowHandle);
            _windowHandle = IntPtr.Zero;
        }
        DisposeMark();
        if (_classAtom != IntPtr.Zero)
        {
            UnregisterClass(_className, GetModuleHandle(null));
            _classAtom = IntPtr.Zero;
        }
        if (ReferenceEquals(_active, this))
            _active = null;
    }

    internal void ShowError(string logPath)
    {
        if (_windowHandle == IntPtr.Zero)
            return;

        _error = true;
        KillTimer(_windowHandle, TimerId);
        InvalidateRect(_windowHandle, IntPtr.Zero, false);
        UpdateWindow(_windowHandle);
    }

    public void Dispose() => Close();

    private void RegisterWindowClass()
    {
        var windowClass = new WndClassEx
        {
            Size = (uint)Marshal.SizeOf<WndClassEx>(),
            Style = ClassHRedraw | ClassVRedraw,
            Procedure = WindowProcedure,
            Instance = GetModuleHandle(null),
            Cursor = LoadCursor(IntPtr.Zero,  IDC_ARROW),
            ClassName = _className,
        };
        _classAtom = RegisterClassEx(ref windowClass);
    }

    private Bitmap? LoadMark(string theme)
    {
        try
        {
            var iconPath = ThemeColors.GetIconPath(theme);
            var pngPath = Path.Combine(Path.GetDirectoryName(iconPath)!, "brmble-256.png");
            if (File.Exists(pngPath))
                return new Bitmap(pngPath);
        }
        catch { }

        try
        {
            using var icon = Icon.ExtractAssociatedIcon(ThemeColors.GetIconPath(theme));
            return icon?.ToBitmap();
        }
        catch { return null; }
    }

    private void Paint(IntPtr hdc)
    {
        using var graphics = Graphics.FromHdc(hdc);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(_background);

        if (_mark != null)
        {
            const int markSize = 112;
            var markBounds = new Rectangle((Width - markSize) / 2, 36, markSize, markSize);
            using var attributes = new ImageAttributes();
            var alpha = _error || !_animationEnabled ? 1f : 0.78f + (_pulse / 100f) * 0.22f;
            var matrix = new ColorMatrix { Matrix33 = alpha };
            attributes.SetColorMatrix(matrix);
            graphics.DrawImage(_mark, markBounds, 0, 0, _mark.Width, _mark.Height, GraphicsUnit.Pixel, attributes);
        }
        else
        {
            using var brush = new SolidBrush(_accent);
            graphics.FillEllipse(brush, (Width - 72) / 2, 56, 72, 72);
        }

        using var textBrush = new SolidBrush(_error ? Color.FromArgb(235, 225, 235) : Color.FromArgb(190, 180, 195));
        using var font = new Font("Segoe UI", 10f, FontStyle.Regular, GraphicsUnit.Point);
        var message = _error ? "Brmble couldn't finish starting" : "Starting Brmble…";
        var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        graphics.DrawString(message, font, textBrush, new RectangleF(20, 168, Width - 40, 28), format);
        if (_error)
            graphics.DrawString("See the log for more information.", font, textBrush, new RectangleF(20, 194, Width - 40, 24), format);
    }

    private static bool GetClientAreaAnimationSetting()
    {
        return SystemParametersInfo(SpiGetClientAreaAnimation, 0, out bool enabled, 0) && enabled;
    }

    private static RECT GetPrimaryWorkArea()
    {
        if (SystemParametersInfo(0x0030, 0, out RECT workArea, 0))
            return workArea;
        return new RECT { Right = GetSystemMetrics(SmCxScreen), Bottom = GetSystemMetrics(SmCyScreen) };
    }

    private static IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        var splash = _active;
        if (splash?._windowHandle != hwnd)
            return DefWindowProc(hwnd, message, wParam, lParam);

        switch (message)
        {
            case WmPaint:
                BeginPaint(hwnd, out var paint);
                splash.Paint(paint.DeviceContext);
                EndPaint(hwnd, ref paint);
                return IntPtr.Zero;
            case WmEraseBkgnd:
                return new IntPtr(1);
            case WmTimer:
                splash._pulse = (splash._pulse + 15) % 100;
                InvalidateRect(hwnd, IntPtr.Zero, false);
                return IntPtr.Zero;
            case WmClose:
                splash.Dismissed?.Invoke();
                splash.Close();
                return IntPtr.Zero;
            case WmDestroy:
                KillTimer(hwnd, TimerId);
                return IntPtr.Zero;
            default:
                return DefWindowProc(hwnd, message, wParam, lParam);
        }
    }

    private static StartupSplashWindow? _active;

    private void DisposeMark()
    {
        _mark?.Dispose();
        _mark = null;
    }

    private delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint Size;
        public uint Style;
        public WndProc Procedure;
        public int ClassExtra;
        public int WindowExtra;
        public IntPtr Instance;
        public IntPtr Icon;
        public IntPtr Cursor;
        public IntPtr Background;
        public string? MenuName;
        public string ClassName;
        public IntPtr SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PAINTSTRUCT
    {
        public IntPtr DeviceContext;
        public int Erase;
        public RECT PaintRectangle;
        public int Restore;
        public int IncUpdate;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Reserved;
    }

    private const int IDC_ARROW = 32512;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassEx(ref WndClassEx windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool UnregisterClass(string className, IntPtr instance);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool InvalidateRect(IntPtr hwnd, IntPtr rect, bool erase);
    [DllImport("user32.dll")] private static extern IntPtr SetTimer(IntPtr hwnd, uint id, uint interval, IntPtr callback);
    [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr hwnd, uint id);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr instance, int cursor);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out bool result, uint update);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out RECT result, uint update);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr BeginPaint(IntPtr hwnd, out PAINTSTRUCT paintStruct);
    [DllImport("user32.dll")] private static extern bool EndPaint(IntPtr hwnd, ref PAINTSTRUCT paintStruct);
}
