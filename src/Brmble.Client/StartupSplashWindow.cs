using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Diagnostics;
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
    private const int Width = 200;
    private const int Height = 200;
    private const int LogoSize = 112;
    private const int LogoTop = 16;
    private const int LabelTop = 136;
    private static readonly Rectangle CloseButtonBounds = new(168, 8, 24, 24);
    private const uint WsPopup = 0x80000000;
    private const uint WsExToolWindow = 0x00000080;
    private const uint WsExTopmost = 0x00000008;
    private const uint WsExNoActivate = 0x08000000;
    private const uint WsExLayered = 0x00080000;
    private const uint ClassHRedraw = 0x0002;
    private const uint ClassVRedraw = 0x0001;
    private const uint WmPaint = 0x000F;
    private const uint WmEraseBkgnd = 0x0014;
    private const uint WmClose = 0x0010;
    private const uint WmLButtonUp = 0x0202;
    private const uint WmDestroy = 0x0002;
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const uint SwShow = 5;
    private const uint UlwAlpha = 0x00000002;
    private const byte AcSrcOver = 0;
    private const byte AcSrcAlpha = 1;

    private static readonly WndProc WindowProcedure = WindowProc;
    private readonly string _className = $"BrmbleStartupSplash_{Environment.ProcessId}";
    private IntPtr _windowHandle;
    private IntPtr _classAtom;
    private Bitmap? _mark;
    private Bitmap? _surface;
    private Color _background;
    private Color _accent;
    private bool _error;

    internal bool IsVisible => _windowHandle != IntPtr.Zero;

    internal static uint GetExtendedWindowStyle() => WsExToolWindow | WsExTopmost | WsExNoActivate | WsExLayered;

    internal static float GetLogoAlpha() => 1f;

    internal static bool IsCloseButtonHit(bool error, int x, int y) =>
        error && CloseButtonBounds.Contains(x, y);

    internal void Show(string theme)
    {
        Close();
        _active = this;
        _error = false;
        var (r, g, b) = ThemeColors.GetBgDeep(theme);
        _background = Color.FromArgb(r, g, b);
        (r, g, b) = ThemeColors.GetAccent(theme);
        _accent = Color.FromArgb(r, g, b);
        _mark = LoadMark(theme);

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
        RefreshSurface();
        UpdateWindow(_windowHandle);
    }

    internal void Close()
    {
        if (_windowHandle != IntPtr.Zero)
        {
            DestroyWindow(_windowHandle);
            _windowHandle = IntPtr.Zero;
        }
        _surface?.Dispose();
        _surface = null;
        DisposeMark();
        if (_classAtom != IntPtr.Zero)
        {
            UnregisterClass(_className, GetModuleHandle(null));
            _classAtom = IntPtr.Zero;
        }
        if (ReferenceEquals(_active, this))
            _active = null;
    }

    internal void ShowError()
    {
        if (_windowHandle == IntPtr.Zero)
            return;

        _error = true;
        RefreshSurface();
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

    private void RefreshSurface()
    {
        if (_windowHandle == IntPtr.Zero)
            return;

        _surface ??= new Bitmap(Width, Height, PixelFormat.Format32bppPArgb);
        using var graphics = Graphics.FromImage(_surface);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Color.Transparent);

        if (_mark != null)
        {
            var markBounds = new Rectangle((Width - LogoSize) / 2, LogoTop, LogoSize, LogoSize);
            using var attributes = new ImageAttributes();
            var alpha = GetLogoAlpha();
            var matrix = new ColorMatrix { Matrix33 = alpha };
            attributes.SetColorMatrix(matrix);
            graphics.DrawImage(_mark, markBounds, 0, 0, _mark.Width, _mark.Height, GraphicsUnit.Pixel, attributes);
        }
        else
        {
            using var brush = new SolidBrush(_accent);
            graphics.FillEllipse(brush, (Width - 72) / 2, 56, 72, 72);
        }

        if (_error)
        {
            using var buttonBrush = new SolidBrush(Color.FromArgb(180, _background));
            using var buttonPen = new Pen(Color.FromArgb(220, _accent), 2f);
            graphics.FillRectangle(buttonBrush, CloseButtonBounds);
            graphics.DrawRectangle(buttonPen, CloseButtonBounds);
            graphics.DrawLine(buttonPen, 175, 15, 185, 25);
            graphics.DrawLine(buttonPen, 185, 15, 175, 25);
        }

        using var textBrush = new SolidBrush(_error ? Color.FromArgb(235, 225, 235) : Color.FromArgb(190, 180, 195));
        using var font = new Font("Segoe UI", 10f, FontStyle.Regular, GraphicsUnit.Point);
        var message = _error ? "Brmble couldn't finish starting" : "Starting Brmble…";
        var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        graphics.DrawString(message, font, textBrush, new RectangleF(8, LabelTop, Width - 16, 26), format);
        if (_error)
            graphics.DrawString("See the log for more information.", font, textBrush, new RectangleF(8, LabelTop + 24, Width - 16, 26), format);

        PresentSurface();
    }

    private void PresentSurface()
    {
        if (_surface == null || _windowHandle == IntPtr.Zero)
            return;

        var bitmapHandle = CreateSurfaceBitmap();
        if (bitmapHandle == IntPtr.Zero)
            return;

        var memoryDc = CreateCompatibleDC(IntPtr.Zero);
        var previousBitmap = IntPtr.Zero;
        try
        {
            if (memoryDc == IntPtr.Zero)
                return;

            previousBitmap = SelectObject(memoryDc, bitmapHandle);
            if (previousBitmap == IntPtr.Zero)
                return;

            if (!GetWindowRect(_windowHandle, out var windowRect))
                return;

            var destination = new POINT { X = windowRect.Left, Y = windowRect.Top };
            var size = new SIZE { Width = Width, Height = Height };
            var source = new POINT { X = 0, Y = 0 };
            var blend = new BLENDFUNCTION
            {
                BlendOp = AcSrcOver,
                BlendFlags = 0,
                SourceConstantAlpha = 255,
                AlphaFormat = AcSrcAlpha,
            };
            if (!UpdateLayeredWindow(_windowHandle, IntPtr.Zero, ref destination, ref size, memoryDc, ref source, 0, ref blend, UlwAlpha))
                Debug.WriteLine($"[StartupSplash] UpdateLayeredWindow failed (win32={Marshal.GetLastWin32Error()})");
        }
        finally
        {
            if (memoryDc != IntPtr.Zero)
            {
                if (previousBitmap != IntPtr.Zero)
                    SelectObject(memoryDc, previousBitmap);
                DeleteDC(memoryDc);
            }
            if (bitmapHandle != IntPtr.Zero)
                DeleteObject(bitmapHandle);
        }
    }

    private IntPtr CreateSurfaceBitmap()
    {
        var surface = _surface;
        if (surface == null)
            return IntPtr.Zero;

        var bitmapInfo = new BITMAPINFOHEADER
        {
            Size = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
            Width = Width,
            Height = -Height,
            Planes = 1,
            BitCount = 32,
            Compression = 0,
        };
        var bitmapHandle = CreateDIBSection(IntPtr.Zero, ref bitmapInfo, 0, out var bits, IntPtr.Zero, 0);
        if (bitmapHandle == IntPtr.Zero || bits == IntPtr.Zero)
        {
            Debug.WriteLine("[StartupSplash] Failed to create alpha DIB section");
            if (bitmapHandle != IntPtr.Zero)
                DeleteObject(bitmapHandle);
            return IntPtr.Zero;
        }

        BitmapData? sourceData = null;
        var surfaceReady = false;
        try
        {
            sourceData = surface.LockBits(
                new Rectangle(0, 0, Width, Height),
                ImageLockMode.ReadOnly,
                PixelFormat.Format32bppPArgb);
            var row = new byte[Width * 4];
            for (var y = 0; y < Height; y++)
            {
                Marshal.Copy(IntPtr.Add(sourceData.Scan0, y * sourceData.Stride), row, 0, row.Length);
                Marshal.Copy(row, 0, IntPtr.Add(bits, y * row.Length), row.Length);
            }
            surfaceReady = true;
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"[StartupSplash] Failed to copy alpha surface: {exception.Message}");
        }
        finally
        {
            if (sourceData != null)
            {
                try
                {
                    surface.UnlockBits(sourceData);
                }
                catch (Exception exception)
                {
                    surfaceReady = false;
                    Debug.WriteLine($"[StartupSplash] Failed to unlock alpha surface: {exception.Message}");
                }
            }
        }

        if (!surfaceReady)
        {
            DeleteObject(bitmapHandle);
            return IntPtr.Zero;
        }

        return bitmapHandle;
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
                splash.RefreshSurface();
                EndPaint(hwnd, ref paint);
                return IntPtr.Zero;
            case WmEraseBkgnd:
                return new IntPtr(1);
            case WmLButtonUp:
            {
                var coordinates = lParam.ToInt64();
                var x = unchecked((short)(coordinates & 0xFFFF));
                var y = unchecked((short)((coordinates >> 16) & 0xFFFF));
                if (IsCloseButtonHit(splash._error, x, y))
                {
                    splash.Dismissed?.Invoke();
                    splash.Close();
                }
                return IntPtr.Zero;
            }
            case WmClose:
                splash.Dismissed?.Invoke();
                splash.Close();
                return IntPtr.Zero;
            case WmDestroy:
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
    private struct BITMAPINFOHEADER
    {
        public uint Size;
        public int Width;
        public int Height;
        public ushort Planes;
        public ushort BitCount;
        public uint Compression;
        public uint SizeImage;
        public int XPelsPerMeter;
        public int YPelsPerMeter;
        public uint ClrUsed;
        public uint ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X, Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int Width, Height; }

    [StructLayout(LayoutKind.Sequential)]
    private struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

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
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr destinationDc, ref POINT destination, ref SIZE size, IntPtr sourceDc, ref POINT source, uint colorKey, ref BLENDFUNCTION blend, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr instance, int cursor);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? moduleName);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SystemParametersInfo(uint action, uint parameter, out RECT result, uint update);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr BeginPaint(IntPtr hwnd, out PAINTSTRUCT paintStruct);
    [DllImport("user32.dll")] private static extern bool EndPaint(IntPtr hwnd, ref PAINTSTRUCT paintStruct);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFOHEADER bitmapInfo, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr objectHandle);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr objectHandle);
}
