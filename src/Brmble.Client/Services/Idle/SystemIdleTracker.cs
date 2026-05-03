using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Idle;

/// <summary>
/// Tracks the local Windows session idle time and lock state.
/// </summary>
/// <remarks>
/// Uses <c>GetLastInputInfo</c> for keyboard/mouse idle (session-scoped, returns
/// idle for the calling user's session) and subscribes to
/// <c>WM_WTSSESSION_CHANGE</c> via <c>WTSRegisterSessionNotification</c> to learn
/// about screen lock / unlock events.
/// </remarks>
public sealed class SystemIdleTracker : IDisposable
{
    public const uint WM_WTSSESSION_CHANGE = 0x02B1;

    private const int WTS_CONSOLE_CONNECT = 0x1;
    private const int WTS_CONSOLE_DISCONNECT = 0x2;
    private const int WTS_SESSION_LOCK = 0x7;
    private const int WTS_SESSION_UNLOCK = 0x8;

    private const int NOTIFY_FOR_THIS_SESSION = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSRegisterSessionNotification(IntPtr hWnd, uint dwFlags);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);

    private readonly IntPtr _hwnd;
    private readonly bool _registered;
    private bool _isLocked;
    private bool _disposed;

    /// <summary>True when the workstation is locked or the console session is disconnected.</summary>
    public bool IsLocked => _isLocked;

    /// <summary>
    /// Constructs a tracker. Pass a real <paramref name="hwnd"/> in production so the
    /// tracker subscribes to lock/unlock events; pass <see cref="IntPtr.Zero"/> in tests.
    /// </summary>
    public SystemIdleTracker(IntPtr hwnd)
    {
        _hwnd = hwnd;
        if (_hwnd != IntPtr.Zero)
        {
            _registered = WTSRegisterSessionNotification(_hwnd, NOTIFY_FOR_THIS_SESSION);
        }
    }

    /// <summary>
    /// Returns seconds since the user's last keyboard/mouse input on this session,
    /// using a wraparound-safe 32-bit unsigned subtraction (TickCount and
    /// LASTINPUTINFO.dwTime are both <c>DWORD</c>; mismatched widths corrupt the
    /// result after ~49.7 days uptime).
    /// </summary>
    public int GetIdleSeconds()
    {
        var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref lii))
            return 0;

        // Both values are 32-bit; unsigned subtraction wraps correctly.
        var idleMs = unchecked((uint)Environment.TickCount - lii.dwTime);
        return (int)(idleMs / 1000);
    }

    /// <summary>
    /// Called by the Win32 message loop when <c>WM_WTSSESSION_CHANGE</c> arrives.
    /// </summary>
    public void OnSessionChange(int wParam)
    {
        switch (wParam)
        {
            case WTS_SESSION_LOCK:
            case WTS_CONSOLE_DISCONNECT:
                _isLocked = true;
                break;
            case WTS_SESSION_UNLOCK:
            case WTS_CONSOLE_CONNECT:
                _isLocked = false;
                break;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_registered)
        {
            WTSUnRegisterSessionNotification(_hwnd);
        }
    }
}
