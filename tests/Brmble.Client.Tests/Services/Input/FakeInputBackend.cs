using System;
using System.Collections.Generic;
using Brmble.Client.Services.Voice.Input;

namespace Brmble.Client.Tests.Services.Input;

/// <summary>
/// Test double for IInputBackend. Records what the InputRouter does, and
/// exposes hooks for tests to inject simulated input events.
/// </summary>
public sealed class FakeInputBackend : IInputBackend
{
    public IntPtr Hwnd => new(0x1234);

    // GetAsyncKeyState — tests set per-vk virtual key states.
    public readonly Dictionary<int, bool> KeyDownStates = new();
    public short GetAsyncKeyState(int vk)
        => KeyDownStates.TryGetValue(vk, out var down) && down ? unchecked((short)0x8000) : (short)0;

    // Mouse hook — tests invoke MouseHookProc directly to simulate events.
    public LowLevelMouseProc? MouseHookProc;
    public bool MouseHookRegistered;
    public IntPtr SetMouseHook(LowLevelMouseProc proc)
    {
        MouseHookProc = proc;
        MouseHookRegistered = true;
        return new IntPtr(0x9000);
    }
    public bool UnhookMouse(IntPtr handle)
    {
        MouseHookProc = null;
        MouseHookRegistered = false;
        return true;
    }
    public IntPtr CallNextHook(IntPtr handle, int nCode, IntPtr wParam, IntPtr lParam)
        => IntPtr.Zero;

    // RegisterHotKey — tests can inspect what's registered.
    public readonly Dictionary<int, (uint modifiers, uint vk)> RegisteredHotkeys = new();
    public bool RegisterHotKey(int id, uint modifiers, uint vk)
    {
        RegisteredHotkeys[id] = (modifiers, vk);
        return true;
    }
    public bool UnregisterHotKey(int id)
    {
        return RegisteredHotkeys.Remove(id);
    }

    // Raw keyboard — tests just track on/off.
    public bool RawKeyboardRegistered;
    public bool RawKeyboardInputSink;
    public bool RegisterRawKeyboard(bool inputSink)
    {
        RawKeyboardRegistered = true;
        RawKeyboardInputSink = inputSink;
        return true;
    }
    public bool UnregisterRawKeyboard()
    {
        RawKeyboardRegistered = false;
        return true;
    }
}
