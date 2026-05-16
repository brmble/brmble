using System;

namespace Brmble.Client.Services.Voice.Input;

/// <summary>
/// Low-level mouse hook delegate. Top-level so both IInputBackend and the
/// production Win32 PInvoke signature line up.
/// </summary>
public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

/// <summary>
/// Abstracts Win32 input primitives so InputRouter can be unit-tested
/// without a real message pump. Production uses Win32InputBackend; tests
/// use FakeInputBackend.
/// </summary>
public interface IInputBackend
{
    IntPtr Hwnd { get; }

    short GetAsyncKeyState(int vk);

    IntPtr SetMouseHook(LowLevelMouseProc proc);
    bool UnhookMouse(IntPtr handle);
    IntPtr CallNextHook(IntPtr handle, int nCode, IntPtr wParam, IntPtr lParam);

    bool RegisterHotKey(int id, uint modifiers, uint vk);
    bool UnregisterHotKey(int id);

    bool RegisterRawKeyboard(bool inputSink);
    bool UnregisterRawKeyboard();
}
