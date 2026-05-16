using System;
using System.Runtime.InteropServices;
using Brmble.Client.Services.Voice;

namespace Brmble.Client.Services.Voice.Input;

/// <summary>
/// Production IInputBackend that wraps real Win32 PInvoke calls. The
/// InputRouter pins delegates as fields, so the adapter Win32 needs is
/// kept alive here for the duration of the hook.
/// </summary>
public sealed class Win32InputBackend : IInputBackend
{
    private readonly IntPtr _hwnd;

    // Field pins the adapter delegate so the GC cannot collect it while
    // Windows still holds the function pointer.
    private Win32RawInput.LowLevelMouseProc? _adapterProc;

    public IntPtr Hwnd => _hwnd;

    public Win32InputBackend(IntPtr hwnd) { _hwnd = hwnd; }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyStateNative(int vk);

    public short GetAsyncKeyState(int vk) => GetAsyncKeyStateNative(vk);

    public IntPtr SetMouseHook(LowLevelMouseProc proc)
    {
        IntPtr hModule = Win32RawInput.GetModuleHandle(null);
        _adapterProc = (n, w, l) => proc(n, w, l);
        return Win32RawInput.SetWindowsHookEx(Win32RawInput.WH_MOUSE_LL, _adapterProc, hModule, 0);
    }

    public bool UnhookMouse(IntPtr handle)
    {
        bool ok = Win32RawInput.UnhookWindowsHookEx(handle);
        _adapterProc = null;
        return ok;
    }

    public IntPtr CallNextHook(IntPtr handle, int nCode, IntPtr wParam, IntPtr lParam)
        => Win32RawInput.CallNextHookEx(handle, nCode, wParam, lParam);

    // RegisterHotKey is deliberately not used by the refactored InputRouter
    // — polling via GetAsyncKeyState avoids the "blocks the key from other
    // apps" issue (#99) and removes the WM_HOTKEY dispatch path entirely.
    // We satisfy the interface but never invoke these in production.
    public bool RegisterHotKey(int id, uint modifiers, uint vk) => false;
    public bool UnregisterHotKey(int id) => false;

    public bool RegisterRawKeyboard(bool inputSink)
    {
        var device = new Win32RawInput.RAWINPUTDEVICE
        {
            usUsagePage = Win32RawInput.HID_USAGE_PAGE_GENERIC,
            usUsage = Win32RawInput.HID_USAGE_GENERIC_KEYBOARD,
            dwFlags = inputSink ? Win32RawInput.RIDEV_INPUTSINK : 0,
            hwndTarget = _hwnd,
        };
        return Win32RawInput.RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTDEVICE>());
    }

    public bool UnregisterRawKeyboard()
    {
        var device = new Win32RawInput.RAWINPUTDEVICE
        {
            usUsagePage = Win32RawInput.HID_USAGE_PAGE_GENERIC,
            usUsage = Win32RawInput.HID_USAGE_GENERIC_KEYBOARD,
            dwFlags = Win32RawInput.RIDEV_REMOVE,
            hwndTarget = IntPtr.Zero,
        };
        return Win32RawInput.RegisterRawInputDevices(new[] { device }, 1, (uint)Marshal.SizeOf<Win32RawInput.RAWINPUTDEVICE>());
    }
}
