using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.Voice.Input;

public sealed class InputRouter : IDisposable
{
    private readonly IInputBackend _backend;

    // Mouse dispatch table — one hook, multiplexed across bindings.
    // _mouseLock guards both the dictionary topology AND each binding's
    // IsHeld field, because the hook callback and binding mutators can
    // run on different threads (mouse hook is on the message-pump thread
    // that called SetWindowsHookEx; binding setters run on the bridge
    // thread that delivers settings updates).
    private readonly object _mouseLock = new();
    private readonly Dictionary<MouseButton, MouseBinding> _mouseBindings = new();
    private IntPtr _mouseHookHandle = IntPtr.Zero;
    private LowLevelMouseProc? _mouseHookProc;
    private bool _disposed;

    private enum BindingKind { Ptt, Shortcut }

    private sealed record MouseBinding(BindingKind Kind, string Action, string Key)
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
            SetMouseBinding(btn.Value, BindingKind.Ptt, "pushToTalk", key!);
        }
    }

    public void SetShortcutBinding(string action, string? key)
    {
        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, BindingKind.Shortcut, action, key!);
        }
    }

    private void SetMouseBinding(MouseButton button, BindingKind kind, string action, string key)
    {
        // Install hook under the same lock that guards the dictionary so two
        // concurrent SetXxxBinding calls cannot both observe an empty hook
        // handle and double-install (leaking the first handle).
        lock (_mouseLock)
        {
            _mouseBindings[button] = new MouseBinding(kind, action, key);
            if (_mouseHookHandle == IntPtr.Zero)
            {
                _mouseHookProc = MouseHookCallback;
                _mouseHookHandle = _backend.SetMouseHook(_mouseHookProc);
            }
        }
    }

    private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        IntPtr handleSnapshot = _mouseHookHandle;

        if (nCode != HC_ACTION) return _backend.CallNextHook(handleSnapshot, nCode, wParam, lParam);

        int msg = wParam.ToInt32();
        var (btn, isDown, isUp) = ClassifyMouseMessage(msg, lParam);
        if (btn == null || (!isDown && !isUp))
            return _backend.CallNextHook(handleSnapshot, nCode, wParam, lParam);

        // Resolve, transition IsHeld, and capture what events to fire — all
        // under the lock. Fire events outside the lock so handlers can't
        // re-enter and deadlock us.
        BindingKind? firedKind = null;
        string? firedAction = null;
        bool firedDown = false;

        lock (_mouseLock)
        {
            if (!_mouseBindings.TryGetValue(btn.Value, out var binding)) return _backend.CallNextHook(handleSnapshot, nCode, wParam, lParam);

            if (isDown && !binding.IsHeld)
            {
                binding.IsHeld = true;
                firedKind = binding.Kind;
                firedAction = binding.Action;
                firedDown = true;
            }
            else if (isUp && binding.IsHeld)
            {
                binding.IsHeld = false;
                firedKind = binding.Kind;
                firedAction = binding.Action;
                firedDown = false;
            }
        }

        if (firedKind is BindingKind.Ptt)
        {
            PttStateChanged?.Invoke(firedDown);
        }
        else if (firedKind is BindingKind.Shortcut && firedAction != null)
        {
            if (firedDown) ShortcutPressed?.Invoke(firedAction);
            else ShortcutReleased?.Invoke(firedAction);
        }

        return _backend.CallNextHook(handleSnapshot, nCode, wParam, lParam);
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
                MouseButton? xbtn = xb switch
                {
                    XBUTTON1 => MouseButton.X1,
                    XBUTTON2 => MouseButton.X2,
                    _ => null,
                };
                return (xbtn, msg == WM_XBUTTONDOWN, msg == WM_XBUTTONUP);
            default:
                return (null, false, false);
        }
    }

    public void Dispose()
    {
        IntPtr handle;
        lock (_mouseLock)
        {
            if (_disposed) return;
            _disposed = true;
            handle = _mouseHookHandle;
            _mouseHookHandle = IntPtr.Zero;
            _mouseHookProc = null;
        }
        if (handle != IntPtr.Zero) _backend.UnhookMouse(handle);
    }
}
