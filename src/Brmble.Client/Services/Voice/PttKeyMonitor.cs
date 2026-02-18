using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Voice;

/// <summary>
/// Monitors key-up events for the PTT key using a WH_KEYBOARD_LL hook.
/// Only active when PTT mode is enabled and a key is registered.
/// </summary>
internal sealed class PttKeyMonitor : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private IntPtr _hook = IntPtr.Zero;
    private LowLevelKeyboardProc? _proc; // prevent GC
    private volatile int _watchedVk;
    private readonly Action<bool> _onKeyEvent;

    public PttKeyMonitor(Action<bool> onKeyEvent)
    {
        _onKeyEvent = onKeyEvent;
    }

    public void Watch(int vkCode)
    {
        Unwatch();
        _watchedVk = vkCode;
        _proc = HookCallback;
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        if (_hook == IntPtr.Zero)
        {
            System.Diagnostics.Debug.WriteLine($"[PttKeyMonitor] SetWindowsHookEx failed: {Marshal.GetLastWin32Error()}");
            _proc = null; // allow GC since hook wasn't installed
        }
    }

    public void Unwatch()
    {
        if (_hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hook);
            _hook = IntPtr.Zero;
        }
        _watchedVk = 0;
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var kb = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            if (kb.vkCode == _watchedVk)
            {
                var isKeyUp = wParam == WM_KEYUP || wParam == WM_SYSKEYUP;
                if (isKeyUp) _onKeyEvent(false); // false = key released
            }
        }
        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    public void Dispose() => Unwatch();
}
