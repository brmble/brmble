using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Voice.Input;

public sealed class InputRouter : IDisposable
{
    private readonly IInputBackend _backend;

    // Mouse dispatch table — one hook, multiplexed across bindings.
    private readonly object _mouseLock = new();
    private readonly Dictionary<MouseButton, MouseBinding> _mouseBindings = new();
    private IntPtr _mouseHookHandle = IntPtr.Zero;
    private LowLevelMouseProc? _mouseHookProc;

    private sealed record MouseBinding(string Action, string Key)
    {
        public bool IsHeld { get; set; }
    }

    // Win32 constants the hook callback needs.
    private const int HC_ACTION = 0;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MBUTTONUP = 0x0208;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;
    private const int XBUTTON1 = 1;
    private const int XBUTTON2 = 2;

    public event Action<bool>? PttStateChanged;
    public event Action<string>? ShortcutPressed;
    public event Action<string>? ShortcutReleased;

    public InputRouter(IInputBackend backend)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    public void SetPttBinding(string? key)
    {
        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, "pushToTalk", key!);
        }
    }

    public void SetShortcutBinding(string action, string? key)
    {
        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, action, key!);
        }
    }

    private void SetMouseBinding(MouseButton button, string action, string key)
    {
        bool needHook = false;
        lock (_mouseLock)
        {
            _mouseBindings[button] = new MouseBinding(action, key);
            needHook = _mouseHookHandle == IntPtr.Zero;
        }
        if (needHook)
        {
            _mouseHookProc = MouseHookCallback;
            _mouseHookHandle = _backend.SetMouseHook(_mouseHookProc);
        }
    }

    private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode != HC_ACTION) return _backend.CallNextHook(_mouseHookHandle, nCode, wParam, lParam);

        int msg = wParam.ToInt32();
        var (btn, isDown, isUp) = ClassifyMouseMessage(msg, lParam);
        if (btn == null || (!isDown && !isUp))
            return _backend.CallNextHook(_mouseHookHandle, nCode, wParam, lParam);

        MouseBinding? binding;
        lock (_mouseLock)
        {
            _mouseBindings.TryGetValue(btn.Value, out binding);
        }
        if (binding == null) return _backend.CallNextHook(_mouseHookHandle, nCode, wParam, lParam);

        if (isDown && !binding.IsHeld)
        {
            binding.IsHeld = true;
            if (binding.Action == "pushToTalk") PttStateChanged?.Invoke(true);
            else ShortcutPressed?.Invoke(binding.Action);
        }
        else if (isUp && binding.IsHeld)
        {
            binding.IsHeld = false;
            if (binding.Action == "pushToTalk") PttStateChanged?.Invoke(false);
            else ShortcutReleased?.Invoke(binding.Action);
        }

        return _backend.CallNextHook(_mouseHookHandle, nCode, wParam, lParam);
    }

    private static (MouseButton? button, bool isDown, bool isUp) ClassifyMouseMessage(int msg, IntPtr lParam)
    {
        switch (msg)
        {
            case WM_LBUTTONDOWN: return (MouseButton.Left, true, false);
            case WM_LBUTTONUP: return (MouseButton.Left, false, true);
            case WM_RBUTTONDOWN: return (MouseButton.Right, true, false);
            case WM_RBUTTONUP: return (MouseButton.Right, false, true);
            case WM_MBUTTONDOWN: return (MouseButton.Middle, true, false);
            case WM_MBUTTONUP: return (MouseButton.Middle, false, true);
            case WM_XBUTTONDOWN:
            case WM_XBUTTONUP:
                var hookStruct = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                int xb = (hookStruct.mouseData >> 16) & 0xFFFF;
                MouseButton? xbtn = xb == XBUTTON1 ? MouseButton.X1
                    : xb == XBUTTON2 ? MouseButton.X2
                    : (MouseButton?)null;
                return (xbtn, msg == WM_XBUTTONDOWN, msg == WM_XBUTTONUP);
            default:
                return (null, false, false);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public int ptX;
        public int ptY;
        public int mouseData;
        public int flags;
        public int time;
        public IntPtr dwExtraInfo;
    }

    public void Dispose()
    {
        if (_mouseHookHandle != IntPtr.Zero)
        {
            _backend.UnhookMouse(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
        }
    }
}
