using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Brmble.Client.Services.Voice;

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

    // Keyboard PTT polling state.
    private int _pttVk;                   // 0 = no keyboard PTT binding
    private bool _pttKeyWasDown;          // edge-detect helper
    private bool _pollPttPressed;         // current poll-derived view
    private bool _jsPttPressed;           // current JS-derived view
    private bool _pttBound;               // true when any PTT binding (mouse or keyboard) is active
    private System.Threading.Timer? _pttPollingTimer;
    private const int PttPollIntervalMs = 50;

    // Guards all transitions of _pollPttPressed/_jsPttPressed/_pttKeyWasDown
    // and the derived combined-PTT state. Without this lock, concurrent
    // release events on the JS path and poll timer could both observe the
    // other source as still pressed and suppress the only PttStateChanged(false).
    private readonly object _pttStateLock = new();

    // Keyboard shortcut polling state (multiple actions, edge-detected per VK).
    private readonly object _shortcutLock = new();
    private readonly Dictionary<int, string> _shortcutKbVkToAction = new();
    private readonly Dictionary<string, int> _shortcutKbActionToVk = new();
    private readonly Dictionary<int, bool> _shortcutKbWasDown = new();
    private System.Threading.Timer? _shortcutKbTimer;
    private const int ShortcutPollIntervalMs = 30;

    // Suspend gate (#537): while true, all dispatch paths bypass event firing.
    // Timers and the hook stay registered to avoid Win32 tear-down/re-up cost.
    private volatile bool _suspended;

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

    /// <summary>
    /// Fired when MumbleAdapter must tell the JS side to reset its local
    /// pttPressed state — because native has forced a release (via
    /// ReleaseAllHeld) that the JS side would otherwise not know about.
    /// Without this, the next physical keydown is suppressed by JS's
    /// "if (!pttPressed)" guard.
    /// </summary>
    public event Action? JsForceReleaseRequested;

    public InputRouter(IInputBackend backend)
    {
        _backend = backend ?? throw new ArgumentNullException(nameof(backend));
    }

    public void SetPttBinding(string? key)
    {
        // Reset all prior PTT state (mouse + keyboard + poll + js) so a no-op
        // reapply still clears stale held state — defensive against #538.
        ClearMouseBindingByAction("pushToTalk");
        StopPttPolling();

        bool wasActive;
        lock (_pttStateLock)
        {
            _pttVk = 0;
            _pttKeyWasDown = false;
            wasActive = _pollPttPressed || _jsPttPressed;
            _pollPttPressed = false;
            _jsPttPressed = false;
            _pttBound = false;
        }
        if (wasActive) PttStateChanged?.Invoke(false);

        if (key == null) return;

        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, BindingKind.Ptt, "pushToTalk", key);
            lock (_pttStateLock) _pttBound = true;
            return;
        }

        int vk = KeyNameToVirtualKey(key);
        if (vk == 0) return;

        // Prime _pttKeyWasDown from current physical state. If the key is
        // already held at the moment the binding is installed (e.g. user
        // held PTT through a Disconnect → Connect cycle), we want to wait
        // for the next release before reacting — not treat the leftover
        // hold as a fresh press. Without this priming the next poll tick
        // would see "down + !was-down" and start transmitting without the
        // user pressing anything new.
        bool currentlyDown = (_backend.GetAsyncKeyState(vk) & 0x8000) != 0;
        lock (_pttStateLock)
        {
            _pttVk = vk;
            _pttKeyWasDown = currentlyDown;
            _pttBound = true;
        }
        StartPttPolling();
    }

    public void Suspend()
    {
        // Release held state BEFORE flipping the gate. Otherwise a PTT held
        // when recording starts would keep transmitting (release events are
        // bypassed while suspended) until Resume eventually fires ReleaseAllHeld.
        ReleaseAllHeld();
        _suspended = true;
    }

    public void Resume()
    {
        _suspended = false;
        // Anything held that we ignored during suspend cannot leak through.
        ReleaseAllHeld();
    }

    public void HandleJsPttKey(bool pressed)
    {
        if (_suspended) return;
        bool fire;
        bool newState;
        lock (_pttStateLock)
        {
            if (!_pttBound) return;
            bool wasActive = _pollPttPressed || _jsPttPressed;
            _jsPttPressed = pressed;
            bool isActive = _pollPttPressed || _jsPttPressed;
            fire = wasActive != isActive;
            newState = isActive;
        }
        if (fire) PttStateChanged?.Invoke(newState);
    }

    /// <summary>
    /// Forces every currently-held binding to "released" state and fires
    /// matching release events. Called by MumbleAdapter on voice lifecycle
    /// events (connected / disconnected / channelJoined / channelLeft) to
    /// guarantee PTT cannot remain latched across a transition (#538).
    /// </summary>
    public void ReleaseAllHeld()
    {
        // Mouse bindings.
        var releasedMouse = new List<(BindingKind kind, string action)>();
        lock (_mouseLock)
        {
            foreach (var binding in _mouseBindings.Values)
            {
                if (binding.IsHeld)
                {
                    binding.IsHeld = false;
                    releasedMouse.Add((binding.Kind, binding.Action));
                }
            }
        }
        foreach (var (kind, action) in releasedMouse)
        {
            if (kind == BindingKind.Ptt) PttStateChanged?.Invoke(false);
            else ShortcutReleased?.Invoke(action);
        }

        // Keyboard shortcut bindings.
        var releasedShortcuts = new List<string>();
        lock (_shortcutLock)
        {
            foreach (var (vk, action) in _shortcutKbVkToAction)
            {
                if (_shortcutKbWasDown.TryGetValue(vk, out var d) && d)
                {
                    _shortcutKbWasDown[vk] = false;
                    releasedShortcuts.Add(action);
                }
            }
        }
        foreach (var action in releasedShortcuts) ShortcutReleased?.Invoke(action);

        // Keyboard PTT (poll + JS).
        bool kbWasActive;
        lock (_pttStateLock)
        {
            kbWasActive = _pollPttPressed || _jsPttPressed;
            _pollPttPressed = false;
            _jsPttPressed = false;
            _pttKeyWasDown = false;
        }
        if (kbWasActive)
        {
            PttStateChanged?.Invoke(false);
            JsForceReleaseRequested?.Invoke();
        }
    }

    private void StartPttPolling()
    {
        StopPttPolling();
        _pttPollingTimer = new System.Threading.Timer(_ => TickPollOnce(), null, 0, PttPollIntervalMs);
    }

    private void StopPttPolling()
    {
        _pttPollingTimer?.Dispose();
        _pttPollingTimer = null;
    }

    internal void TickPollOnce()
    {
        if (_suspended) return;

        int vk;
        lock (_pttStateLock)
        {
            vk = _pttVk;
        }
        if (vk == 0) return;

        bool isDown = (_backend.GetAsyncKeyState(vk) & 0x8000) != 0;

        bool fire = false;
        bool newState = false;
        lock (_pttStateLock)
        {
            if (isDown && !_pttKeyWasDown)
            {
                _pttKeyWasDown = true;
                bool wasActive = _pollPttPressed || _jsPttPressed;
                _pollPttPressed = true;
                bool isActive = _pollPttPressed || _jsPttPressed;
                fire = wasActive != isActive;
                newState = isActive;
            }
            else if (!isDown && _pttKeyWasDown)
            {
                _pttKeyWasDown = false;
                bool wasActive = _pollPttPressed || _jsPttPressed;
                _pollPttPressed = false;
                bool isActive = _pollPttPressed || _jsPttPressed;
                fire = wasActive != isActive;
                newState = isActive;
            }
        }
        if (fire) PttStateChanged?.Invoke(newState);
    }

    public void SetShortcutBinding(string action, string? key)
    {
        // Remove all prior bindings for this action (mouse + keyboard) so a
        // re-bind from MouseLeft → F1 doesn't leave the old binding active.
        ClearMouseBindingByAction(action);
        ClearKeyboardShortcutByAction(action);

        if (key == null) return;

        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, BindingKind.Shortcut, action, key);
            return;
        }

        int vk = KeyNameToVirtualKey(key);
        if (vk == 0) return;
        lock (_shortcutLock)
        {
            _shortcutKbVkToAction[vk] = action;
            _shortcutKbActionToVk[action] = vk;
            _shortcutKbWasDown[vk] = false;
        }
        EnsureShortcutPolling();
    }

    private void ClearKeyboardShortcutByAction(string action)
    {
        bool releasedHeld = false;
        lock (_shortcutLock)
        {
            if (!_shortcutKbActionToVk.TryGetValue(action, out int vk)) return;
            if (_shortcutKbWasDown.TryGetValue(vk, out var down) && down) releasedHeld = true;
            _shortcutKbActionToVk.Remove(action);
            _shortcutKbVkToAction.Remove(vk);
            _shortcutKbWasDown.Remove(vk);
        }
        if (releasedHeld) ShortcutReleased?.Invoke(action);
        MaybeStopShortcutPolling();
    }

    private void EnsureShortcutPolling()
    {
        if (_shortcutKbTimer != null) return;
        _shortcutKbTimer = new System.Threading.Timer(_ => TickShortcutPollOnce(), null, 0, ShortcutPollIntervalMs);
    }

    private void MaybeStopShortcutPolling()
    {
        lock (_shortcutLock)
        {
            if (_shortcutKbVkToAction.Count > 0) return;
        }
        _shortcutKbTimer?.Dispose();
        _shortcutKbTimer = null;
    }

    internal void TickShortcutPollOnce()
    {
        if (_suspended) return;
        List<KeyValuePair<int, string>> snapshot;
        lock (_shortcutLock)
        {
            if (_shortcutKbVkToAction.Count == 0) return;
            snapshot = new List<KeyValuePair<int, string>>(_shortcutKbVkToAction);
        }

        foreach (var kvp in snapshot)
        {
            int vk = kvp.Key;
            string action = kvp.Value;
            bool isDown = (_backend.GetAsyncKeyState(vk) & 0x8000) != 0;

            // Re-check membership + transition state under one lock. A
            // concurrent ClearKeyboardShortcutByAction may have removed this
            // entry between snapshot capture and now; without the recheck
            // we'd emit a phantom Pressed/Released for the cleared action.
            string? fireAction = null;
            bool firePressed = false;
            lock (_shortcutLock)
            {
                if (!_shortcutKbVkToAction.TryGetValue(vk, out var currentAction) || currentAction != action)
                    continue;

                bool wasDown = _shortcutKbWasDown.TryGetValue(vk, out var d) && d;
                if (isDown && !wasDown)
                {
                    _shortcutKbWasDown[vk] = true;
                    fireAction = action;
                    firePressed = true;
                }
                else if (!isDown && wasDown)
                {
                    _shortcutKbWasDown[vk] = false;
                    fireAction = action;
                    firePressed = false;
                }
            }

            if (fireAction != null)
            {
                if (firePressed) ShortcutPressed?.Invoke(fireAction);
                else ShortcutReleased?.Invoke(fireAction);
            }
        }
    }

    private void ClearMouseBindingByAction(string action)
    {
        BindingKind? releasedKind = null;
        string? releasedAction = null;
        bool unhookNow = false;
        IntPtr handleToUnhook = IntPtr.Zero;

        lock (_mouseLock)
        {
            MouseButton? toRemove = null;
            foreach (var (btn, binding) in _mouseBindings)
            {
                if (binding.Action == action) { toRemove = btn; break; }
            }
            if (toRemove == null) return;
            var removed = _mouseBindings[toRemove.Value];
            _mouseBindings.Remove(toRemove.Value);
            if (removed.IsHeld)
            {
                releasedKind = removed.Kind;
                releasedAction = removed.Action;
            }
            if (_mouseBindings.Count == 0 && _mouseHookHandle != IntPtr.Zero)
            {
                handleToUnhook = _mouseHookHandle;
                _mouseHookHandle = IntPtr.Zero;
                _mouseHookProc = null;
                unhookNow = true;
            }
        }

        if (releasedKind is BindingKind.Ptt) PttStateChanged?.Invoke(false);
        else if (releasedKind is BindingKind.Shortcut && releasedAction != null)
            ShortcutReleased?.Invoke(releasedAction);

        if (unhookNow) _backend.UnhookMouse(handleToUnhook);
    }

    private void SetMouseBinding(MouseButton button, BindingKind kind, string action, string key)
    {
        // IsHeld defaults to false because WH_MOUSE_LL hooks only observe
        // future button transitions — Windows does NOT re-fire DOWN for a
        // button that is already held when the hook is installed. We
        // previously primed IsHeld from GetAsyncKeyState, but mouse-button
        // GetAsyncKeyState can return spurious "down" values that would
        // leave IsHeld stuck true and break the binding entirely until the
        // user rebinds in settings. Trust the hook event stream instead.
        //
        // The held-across-disconnect scenario is still safe: when the user
        // physically releases the leftover hold, the hook fires WM_*BUTTONUP,
        // we see `isUp && !IsHeld` and emit nothing. The next press fires
        // normally.
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
        if (_suspended) return _backend.CallNextHook(handleSnapshot, nCode, wParam, lParam);

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
        StopPttPolling();
        _shortcutKbTimer?.Dispose();
        _shortcutKbTimer = null;
        if (handle != IntPtr.Zero) _backend.UnhookMouse(handle);
    }

    /// <summary>
    /// Translates browser-style key names ("Space", "KeyA", "F1", "MouseLeft", ...)
    /// to Win32 virtual key codes. Returns 0 for unknown names. Lives here because
    /// InputRouter is the only consumer; the previous home in AudioManager moved
    /// out as part of the input-ownership refactor.
    /// </summary>
    internal static int KeyNameToVirtualKey(string key) => key switch
    {
        // Function keys
        "F1" => 0x70, "F2" => 0x71, "F3" => 0x72, "F4" => 0x73,
        "F5" => 0x74, "F6" => 0x75, "F7" => 0x76, "F8" => 0x77,
        "F9" => 0x78, "F10" => 0x79, "F11" => 0x7A, "F12" => 0x7B,
        "F13" => 0x7C, "F14" => 0x7D, "F15" => 0x7E, "F16" => 0x7F,
        "F17" => 0x80, "F18" => 0x81, "F19" => 0x82, "F20" => 0x83,
        "F21" => 0x84, "F22" => 0x85, "F23" => 0x86, "F24" => 0x87,

        // Modifier keys
        "ShiftLeft" => 0x10, "ShiftRight" => 0x10,
        "ControlLeft" => 0x11, "ControlRight" => 0x11,
        "AltLeft" => 0x12, "AltRight" => 0x12,
        "MetaLeft" => 0x5B, "MetaRight" => 0x5C,
        "CapsLock" => 0x14,
        "NumLock" => 0x90,
        "ScrollLock" => 0x91,

        // Special keys
        "Space" => 0x20,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "Enter" => 0x0D,
        "Escape" => 0x1B,
        "Delete" => 0x2E,
        "Insert" => 0x2D,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "PrintScreen" => 0x2C,
        "Pause" => 0x13,

        // Arrow keys
        "ArrowUp" => 0x26, "ArrowDown" => 0x28,
        "ArrowLeft" => 0x25, "ArrowRight" => 0x27,

        // Mouse buttons (kept here for callers that ask via string;
        // mouse dispatch uses MouseButtonExtensions instead).
        "MouseLeft" => 0x01,
        "MouseRight" => 0x02,
        "MouseMiddle" => 0x04,
        "MouseXButton1" => 0x05,
        "MouseXButton2" => 0x06,
        "XButton1" => 0x05,
        "XButton2" => 0x06,
        "Back" => 0x0A,
        "Forward" => 0x0B,

        // Numpad
        "Numpad0" => 0x60, "Numpad1" => 0x61, "Numpad2" => 0x62,
        "Numpad3" => 0x63, "Numpad4" => 0x64, "Numpad5" => 0x65,
        "Numpad6" => 0x66, "Numpad7" => 0x67, "Numpad8" => 0x68,
        "Numpad9" => 0x69,
        "NumpadDecimal" => 0x6E,
        "NumpadDivide" => 0x6F,
        "NumpadMultiply" => 0x6A,
        "NumpadSubtract" => 0x6D,
        "NumpadAdd" => 0x6B,
        "NumpadEnter" => 0x0D,

        // Digits
        "Digit0" => 0x30, "Digit1" => 0x31, "Digit2" => 0x32,
        "Digit3" => 0x33, "Digit4" => 0x34, "Digit5" => 0x35,
        "Digit6" => 0x36, "Digit7" => 0x37, "Digit8" => 0x38,
        "Digit9" => 0x39,

        // Letters
        "KeyA" => 0x41, "KeyB" => 0x42, "KeyC" => 0x43, "KeyD" => 0x44,
        "KeyE" => 0x45, "KeyF" => 0x46, "KeyG" => 0x47, "KeyH" => 0x48,
        "KeyI" => 0x49, "KeyJ" => 0x4A, "KeyK" => 0x4B, "KeyL" => 0x4C,
        "KeyM" => 0x4D, "KeyN" => 0x4E, "KeyO" => 0x4F, "KeyP" => 0x50,
        "KeyQ" => 0x51, "KeyR" => 0x52, "KeyS" => 0x53, "KeyT" => 0x54,
        "KeyU" => 0x55, "KeyV" => 0x56, "KeyW" => 0x57, "KeyX" => 0x58,
        "KeyY" => 0x59, "KeyZ" => 0x5A,

        // Punctuation
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "BracketLeft" => 0xDB, "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        "Backquote" => 0xC0,

        _ => 0
    };
}
