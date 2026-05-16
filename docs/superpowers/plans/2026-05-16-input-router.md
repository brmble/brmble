# InputRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all low-level input handling from `AudioManager` into a new `InputRouter` component, closing #497 (mouse hook ownership), #538 (stuck-active PTT), and #537 (shortcut actions firing during keybinding recording).

**Architecture:** New `InputRouter` (Services/Voice/Input/) owns mouse hook (dictionary-based dispatch), PTT keyboard polling, shortcut keyboard polling, raw input, `RegisterHotKey`, and suspend/resume. `AudioManager` becomes an audio-only consumer of `PttStateChanged` and shortcut events. Win32 surface is abstracted behind `IInputBackend` so unit tests run without a Win32 message pump.

**Tech Stack:** C# .NET 8, MSTest (per project memory), React + TypeScript for web changes.

**Spec:** `docs/superpowers/specs/2026-05-16-input-router-design.md`

**Branch:** `feature/input-router` (already created)

---

## Pre-flight

- [ ] Verify branch and clean tree

Run:
```bash
git status
git rev-parse --abbrev-ref HEAD
```
Expected: clean working tree on `feature/input-router` (only the spec from the previous commit is present).

- [ ] Verify baseline build & tests pass before any changes

Run:
```bash
dotnet build
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```
Expected: build succeeds, all existing tests pass.

---

## Task 1: MouseButton enum and IInputBackend interface

**Why:** Pure foundation types so the rest of the work can be TDD'd against a fake.

**Files:**
- Create: `src/Brmble.Client/Services/Voice/Input/MouseButton.cs`
- Create: `src/Brmble.Client/Services/Voice/Input/IInputBackend.cs`

- [ ] **Step 1: Create MouseButton enum**

Write `src/Brmble.Client/Services/Voice/Input/MouseButton.cs`:

```csharp
namespace Brmble.Client.Services.Voice.Input;

/// <summary>
/// Logical mouse button identity for the dispatch table. Bridge between
/// the user-facing key name (e.g. "MouseLeft", "XButton2") and Win32 hook
/// message routing.
/// </summary>
public enum MouseButton
{
    Left,
    Right,
    Middle,
    X1,
    X2,
}

public static class MouseButtonExtensions
{
    /// <summary>
    /// Maps a key name from settings to a MouseButton. Returns null for
    /// non-mouse key names.
    /// </summary>
    public static MouseButton? FromKeyName(string? key) => key switch
    {
        "MouseLeft" => MouseButton.Left,
        "MouseRight" => MouseButton.Right,
        "MouseMiddle" => MouseButton.Middle,
        "XButton1" or "MouseXButton1" => MouseButton.X1,
        "XButton2" or "MouseXButton2" => MouseButton.X2,
        _ => null,
    };
}
```

- [ ] **Step 2: Create IInputBackend interface**

Write `src/Brmble.Client/Services/Voice/Input/IInputBackend.cs`:

```csharp
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

    // Polling primitive — returns the high-bit-set value when key is down.
    short GetAsyncKeyState(int vk);

    // Low-level mouse hook.
    IntPtr SetMouseHook(LowLevelMouseProc proc);
    bool UnhookMouse(IntPtr handle);
    IntPtr CallNextHook(IntPtr handle, int nCode, IntPtr wParam, IntPtr lParam);

    // RegisterHotKey wrapper (kept on the interface for completeness;
    // production Win32 backend returns false — we use polling instead).
    bool RegisterHotKey(int id, uint modifiers, uint vk);
    bool UnregisterHotKey(int id);

    // Raw input for keyboard PTT (unused after refactor; preserved for tests).
    bool RegisterRawKeyboard(bool inputSink);
    bool UnregisterRawKeyboard();
}
```

- [ ] **Step 3: Build to verify compilation**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: succeeds, no warnings about the new files.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/
git commit -m "feat(input): scaffold MouseButton and IInputBackend"
```

---

## Task 2: FakeInputBackend for unit tests

**Files:**
- Create: `tests/Brmble.Client.Tests/Services/Input/FakeInputBackend.cs`

- [ ] **Step 1: Write FakeInputBackend**

Write `tests/Brmble.Client.Tests/Services/Input/FakeInputBackend.cs`:

```csharp
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
```

- [ ] **Step 2: Build the test project**

Run: `dotnet build tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/Input/
git commit -m "test(input): add FakeInputBackend test double"
```

---

## Task 3: InputRouter scaffold + mouse dispatch table (closes #497)

**Files:**
- Create: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterDispatchTests.cs`

This is the heart of the #497 fix: one mouse hook, dictionary-based dispatch.

- [ ] **Step 1: Write failing dispatch test**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterDispatchTests.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterDispatchTests
{
    private const int HC_ACTION = 0;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;

    private static IntPtr InvokeMouseHook(
        FakeInputBackend backend, int msg, int xButton = 0)
    {
        // MSLLHOOKSTRUCT.mouseData puts xButton in the high word.
        var hookStruct = new MSLLHOOKSTRUCT { mouseData = xButton << 16 };
        var lParam = Marshal.AllocHGlobal(Marshal.SizeOf<MSLLHOOKSTRUCT>());
        try
        {
            Marshal.StructureToPtr(hookStruct, lParam, false);
            return backend.MouseHookProc!.Invoke(HC_ACTION, new IntPtr(msg), lParam);
        }
        finally
        {
            Marshal.FreeHGlobal(lParam);
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

    [TestMethod]
    public void PttOnX2AndMuteOnLeft_CoexistWithoutInterference()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        bool? pttState = null;
        string? lastPressed = null;
        router.PttStateChanged += s => pttState = s;
        router.ShortcutPressed += a => lastPressed = a;

        router.SetPttBinding("XButton2");
        router.SetShortcutBinding("toggleMute", "MouseLeft");

        // Simulate X2 down → PTT activates, mute ignored.
        InvokeMouseHook(backend, WM_XBUTTONDOWN, xButton: 2);
        Assert.AreEqual(true, pttState);
        Assert.IsNull(lastPressed);

        // Simulate Left down → mute fires, PTT state unchanged.
        InvokeMouseHook(backend, WM_LBUTTONDOWN);
        Assert.AreEqual("toggleMute", lastPressed);
        Assert.AreEqual(true, pttState, "PTT state must not be disturbed by other binding");

        // Simulate X2 up → PTT releases.
        InvokeMouseHook(backend, WM_XBUTTONUP, xButton: 2);
        Assert.AreEqual(false, pttState);
    }
}
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterDispatchTests`
Expected: FAIL (InputRouter type does not exist).

- [ ] **Step 3: Write minimal InputRouter implementation**

Write `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`:

```csharp
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
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterDispatchTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterDispatchTests.cs
git commit -m "feat(input): InputRouter mouse dispatch table (closes #497)"
```

---

## Task 4: ClearMouseBinding + release-on-clear

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Modify: `tests/Brmble.Client.Tests/Services/Input/InputRouterDispatchTests.cs`

- [ ] **Step 1: Write failing test for clear-while-held release**

Append to `InputRouterDispatchTests.cs`:

```csharp
    [TestMethod]
    public void ClearBinding_WhileHeld_FiresReleaseEvent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var releases = new List<string>();
        router.ShortcutReleased += a => releases.Add(a);

        router.SetShortcutBinding("toggleMute", "MouseLeft");
        InvokeMouseHook(backend, WM_LBUTTONDOWN);
        Assert.AreEqual(0, releases.Count);

        router.SetShortcutBinding("toggleMute", null);

        CollectionAssert.AreEqual(new[] { "toggleMute" }, releases);
    }

    [TestMethod]
    public void ClearLastBinding_UnregistersMouseHook()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        router.SetShortcutBinding("toggleMute", "MouseLeft");
        Assert.IsTrue(backend.MouseHookRegistered);

        router.SetShortcutBinding("toggleMute", null);

        Assert.IsFalse(backend.MouseHookRegistered);
    }
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~ClearBinding`
Expected: FAIL.

- [ ] **Step 3: Implement clear path**

In `InputRouter.cs`, replace the `SetMouseBinding` method and add a `ClearMouseBinding` private method. Also extend `SetPttBinding` / `SetShortcutBinding` to call `ClearMouseBinding` when key is null.

Replace `SetPttBinding`:
```csharp
    public void SetPttBinding(string? key)
    {
        // Clear any prior PTT mouse binding (action match in any slot).
        ClearMouseBindingByAction("pushToTalk");
        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, "pushToTalk", key!);
        }
    }
```

Replace `SetShortcutBinding`:
```csharp
    public void SetShortcutBinding(string action, string? key)
    {
        ClearMouseBindingByAction(action);
        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, action, key!);
        }
    }
```

Add these private methods:
```csharp
    private void ClearMouseBindingByAction(string action)
    {
        string? releasedAction = null;
        bool nowEmpty;
        lock (_mouseLock)
        {
            MouseButton? toRemove = null;
            foreach (var (btn, binding) in _mouseBindings)
            {
                if (binding.Action == action) { toRemove = btn; break; }
            }
            if (toRemove == null) return;
            var removedBinding = _mouseBindings[toRemove.Value];
            _mouseBindings.Remove(toRemove.Value);
            if (removedBinding.IsHeld) releasedAction = removedBinding.Action;
            nowEmpty = _mouseBindings.Count == 0;
        }

        if (releasedAction != null)
        {
            if (releasedAction == "pushToTalk") PttStateChanged?.Invoke(false);
            else ShortcutReleased?.Invoke(releasedAction);
        }
        if (nowEmpty && _mouseHookHandle != IntPtr.Zero)
        {
            _backend.UnhookMouse(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
            _mouseHookProc = null;
        }
    }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterDispatchTests`
Expected: all tests PASS (including the earlier coexistence test).

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterDispatchTests.cs
git commit -m "feat(input): clear binding releases held state and unhooks when empty"
```

---

## Task 5: Keyboard PTT polling

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterKeyboardPttTests.cs`

InputRouter needs to start a polling timer for keyboard PTT. To keep tests deterministic, expose an `internal` `TickPollOnce()` method that callers can drive in tests instead of waiting on a real timer.

- [ ] **Step 1: Write failing test**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterKeyboardPttTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterKeyboardPttTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void Polling_DownAndUp_FiresPttEvents()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space"); // KeyNameToVirtualKey("Space") == VK_SPACE (0x20)

        // Key not down — first tick reports nothing.
        router.TickPollOnce();
        Assert.AreEqual(0, states.Count);

        // Key down.
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        // Still down — idempotent.
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        // Key up.
        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }
}
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterKeyboardPttTests`
Expected: FAIL — `TickPollOnce` and keyboard binding path don't exist.

- [ ] **Step 3: Add keyboard PTT polling to InputRouter**

In `InputRouter.cs`, add these fields near the mouse fields:

```csharp
    // Keyboard PTT state.
    private int _pttVk;                   // 0 = unbound or non-keyboard
    private bool _pttKeyWasDown;          // edge-detect helper
    private bool _pollPttPressed;         // current poll-derived state
    private bool _jsPttPressed;           // current JS-derived state
    private System.Threading.Timer? _pttPollingTimer;
    private const int PttPollIntervalMs = 50;
```

Add a `KeyNameToVirtualKey` helper. Inline the full switch (this is the existing `AudioManager.KeyNameToVirtualKey` at `src/Brmble.Client/Services/Voice/AudioManager.cs:2326`, moved verbatim):

```csharp
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

        // Mouse buttons (kept here for callers that ask via string; mouse dispatch uses MouseButtonExtensions)
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
```

Update `SetPttBinding` so it also handles the keyboard path:

```csharp
    public void SetPttBinding(string? key)
    {
        ClearMouseBindingByAction("pushToTalk");
        StopPttPolling();
        _pttVk = 0;
        _pttKeyWasDown = false;
        _pollPttPressed = false;

        if (key == null) return;

        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, "pushToTalk", key);
            return;
        }

        int vk = KeyNameToVirtualKey(key);
        if (vk == 0) return;
        _pttVk = vk;
        StartPttPolling();
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
        if (_pttVk == 0) return;
        short state = _backend.GetAsyncKeyState(_pttVk);
        bool isDown = (state & 0x8000) != 0;

        if (isDown && !_pttKeyWasDown)
        {
            _pttKeyWasDown = true;
            UpdatePollPtt(true);
        }
        else if (!isDown && _pttKeyWasDown)
        {
            _pttKeyWasDown = false;
            UpdatePollPtt(false);
        }
    }

    private void UpdatePollPtt(bool pressed)
    {
        bool wasActive = _pollPttPressed || _jsPttPressed;
        _pollPttPressed = pressed;
        bool isActive = _pollPttPressed || _jsPttPressed;
        if (wasActive != isActive) PttStateChanged?.Invoke(isActive);
    }
```

Also update `Dispose()` to stop the polling timer:

```csharp
    public void Dispose()
    {
        StopPttPolling();
        if (_mouseHookHandle != IntPtr.Zero)
        {
            _backend.UnhookMouse(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
        }
    }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterKeyboardPttTests`
Expected: PASS.

Also run `--filter FullyQualifiedName~InputRouterDispatchTests` to confirm the mouse tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterKeyboardPttTests.cs
git commit -m "feat(input): keyboard PTT polling with edge detection"
```

---

## Task 6: JS PTT handler + OR-dedupe

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterJsPollDedupeTests.cs`

- [ ] **Step 1: Write failing tests**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterJsPollDedupeTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterJsPollDedupeTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void JsPressed_PollReleased_StaysActive()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        CollectionAssert.AreEqual(new[] { true }, states);

        // Poll says "not down" — combined state must remain true.
        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        // JS releases — now both are false, combined goes to false.
        router.HandleJsPttKey(false);
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void PollPressed_JsNeverFires_PollControlsState()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true }, states);

        backend.KeyDownStates[VK_SPACE] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { true, false }, states);
    }

    [TestMethod]
    public void HandleJsPttKey_OnlyTakesEffectWhenPttBound()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        // No binding — JS event should be a no-op.
        router.HandleJsPttKey(true);
        Assert.AreEqual(0, states.Count);
    }
}
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterJsPollDedupeTests`
Expected: FAIL — `HandleJsPttKey` doesn't exist.

- [ ] **Step 3: Add HandleJsPttKey**

In `InputRouter.cs`, add a field for "binding present" and the method:

```csharp
    private bool _pttBound;
```

Update `SetPttBinding` to maintain `_pttBound`:

At the top of `SetPttBinding`, after the existing reset block, add:
```csharp
        _pttBound = false;
```

In the mouse branch, after `SetMouseBinding(...)`:
```csharp
            _pttBound = true;
            return;
```

In the keyboard branch, after `StartPttPolling();`:
```csharp
            _pttBound = true;
```

Add the JS handler method:

```csharp
    public void HandleJsPttKey(bool pressed)
    {
        if (!_pttBound) return;
        UpdateJsPtt(pressed);
    }

    private void UpdateJsPtt(bool pressed)
    {
        bool wasActive = _pollPttPressed || _jsPttPressed;
        _jsPttPressed = pressed;
        bool isActive = _pollPttPressed || _jsPttPressed;
        if (wasActive != isActive) PttStateChanged?.Invoke(isActive);
    }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterJsPollDedupeTests`
Expected: PASS. Also run `--filter FullyQualifiedName~InputRouter` to confirm no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterJsPollDedupeTests.cs
git commit -m "feat(input): JS PTT handler with OR-dedupe against poll state"
```

---

## Task 7: ReleaseAllHeld lifecycle (closes #538)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterLifecycleTests.cs`

- [ ] **Step 1: Write failing tests**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterLifecycleTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterLifecycleTests
{
    private const int VK_SPACE = 0x20;

    [TestMethod]
    public void ReleaseAllHeld_AfterKeyboardPttDown_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(true, states[^1]);

        router.ReleaseAllHeld();

        Assert.AreEqual(false, states[^1]);
    }

    [TestMethod]
    public void ReleaseAllHeld_AfterJsPttDown_FiresRelease()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        Assert.AreEqual(true, states[^1]);

        router.ReleaseAllHeld();

        Assert.AreEqual(false, states[^1]);
    }

    [TestMethod]
    public void ReleaseAllHeld_TwiceInARow_IsIdempotent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var states = new List<bool>();
        router.PttStateChanged += s => states.Add(s);

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);
        int countAfterFirst = states.Count;

        router.ReleaseAllHeld();
        router.ReleaseAllHeld();

        Assert.AreEqual(countAfterFirst + 1, states.Count, "second ReleaseAllHeld must not fire another event");
    }

    [TestMethod]
    public void ReleaseAllHeld_EmitsForcedJsResetSignal()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        int forcedCount = 0;
        router.JsForceReleaseRequested += () => forcedCount++;

        router.SetPttBinding("Space");
        router.HandleJsPttKey(true);

        router.ReleaseAllHeld();

        Assert.AreEqual(1, forcedCount, "ReleaseAllHeld must request a JS-side force reset");
    }
}
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterLifecycleTests`
Expected: FAIL.

- [ ] **Step 3: Implement ReleaseAllHeld**

In `InputRouter.cs`, add the new event and the method:

```csharp
    /// <summary>
    /// Fired when MumbleAdapter must tell the JS side to reset its local
    /// pttPressed state (because native has forced a release that JS would
    /// otherwise not know about).
    /// </summary>
    public event Action? JsForceReleaseRequested;

    public void ReleaseAllHeld()
    {
        // Mouse bindings.
        var releasedMouse = new List<string>();
        lock (_mouseLock)
        {
            foreach (var binding in _mouseBindings.Values)
            {
                if (binding.IsHeld)
                {
                    binding.IsHeld = false;
                    releasedMouse.Add(binding.Action);
                }
            }
        }
        foreach (var action in releasedMouse)
        {
            if (action == "pushToTalk") PttStateChanged?.Invoke(false);
            else ShortcutReleased?.Invoke(action);
        }

        // Keyboard PTT (poll + JS).
        bool wasActive = _pollPttPressed || _jsPttPressed;
        _pollPttPressed = false;
        _jsPttPressed = false;
        _pttKeyWasDown = false;
        if (wasActive)
        {
            PttStateChanged?.Invoke(false);
            JsForceReleaseRequested?.Invoke();
        }
    }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterLifecycleTests`
Expected: PASS. Run `--filter FullyQualifiedName~InputRouter` to confirm full InputRouter suite still passes.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterLifecycleTests.cs
git commit -m "feat(input): ReleaseAllHeld for connect/channel lifecycle (closes #538)"
```

---

## Task 8: Shortcut keyboard polling

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterShortcutKeyboardTests.cs`

Shortcut keyboard polling differs from PTT: it tracks multiple vk→action mappings, fires `ShortcutPressed` on edge-down and `ShortcutReleased` on edge-up.

- [ ] **Step 1: Write failing test**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterShortcutKeyboardTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterShortcutKeyboardTests
{
    private const int VK_F1 = 0x70;
    private const int VK_F2 = 0x71;

    [TestMethod]
    public void TwoKeyboardShortcuts_Independent()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var pressed = new List<string>();
        var released = new List<string>();
        router.ShortcutPressed += a => pressed.Add(a);
        router.ShortcutReleased += a => released.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleLeaveVoice", "F2");

        backend.KeyDownStates[VK_F1] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute" }, pressed);

        backend.KeyDownStates[VK_F2] = true;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute", "toggleLeaveVoice" }, pressed);

        backend.KeyDownStates[VK_F1] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute" }, released);

        backend.KeyDownStates[VK_F2] = false;
        router.TickPollOnce();
        CollectionAssert.AreEqual(new[] { "toggleMute", "toggleLeaveVoice" }, released);
    }

    [TestMethod]
    public void ClearShortcutBinding_RemovesPolling()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        var pressed = new List<string>();
        router.ShortcutPressed += a => pressed.Add(a);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleMute", null);

        backend.KeyDownStates[VK_F1] = true;
        router.TickPollOnce();
        Assert.AreEqual(0, pressed.Count);
    }
}
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterShortcutKeyboardTests`
Expected: FAIL.

- [ ] **Step 3: Implement keyboard shortcut path**

In `InputRouter.cs` add state:

```csharp
    private readonly object _shortcutLock = new();
    private readonly Dictionary<int, string> _shortcutKbVkToAction = new();
    private readonly Dictionary<string, int> _shortcutKbActionToVk = new();
    private readonly Dictionary<int, bool> _shortcutKbWasDown = new();
```

Update `SetShortcutBinding`:

```csharp
    public void SetShortcutBinding(string action, string? key)
    {
        // Remove prior binding for this action (both mouse and keyboard).
        ClearMouseBindingByAction(action);
        ClearKeyboardShortcutByAction(action);

        if (key == null) return;

        var btn = MouseButtonExtensions.FromKeyName(key);
        if (btn.HasValue)
        {
            SetMouseBinding(btn.Value, action, key);
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
        string? releasedAction = null;
        lock (_shortcutLock)
        {
            if (!_shortcutKbActionToVk.TryGetValue(action, out int vk)) return;
            if (_shortcutKbWasDown.TryGetValue(vk, out var down) && down)
            {
                releasedAction = action;
            }
            _shortcutKbActionToVk.Remove(action);
            _shortcutKbVkToAction.Remove(vk);
            _shortcutKbWasDown.Remove(vk);
        }
        if (releasedAction != null) ShortcutReleased?.Invoke(releasedAction);
        MaybeStopShortcutPolling();
    }
```

Add the polling lifecycle helpers and tick:

```csharp
    private System.Threading.Timer? _shortcutKbTimer;
    private const int ShortcutPollIntervalMs = 30;

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

            bool wasDown;
            lock (_shortcutLock)
            {
                wasDown = _shortcutKbWasDown.TryGetValue(vk, out var d) && d;
            }

            if (isDown && !wasDown)
            {
                lock (_shortcutLock) _shortcutKbWasDown[vk] = true;
                ShortcutPressed?.Invoke(action);
            }
            else if (!isDown && wasDown)
            {
                lock (_shortcutLock) _shortcutKbWasDown[vk] = false;
                ShortcutReleased?.Invoke(action);
            }
        }
    }
```

Update `TickPollOnce` to also drive shortcut polling — but they're separate concerns; keep them separate (PTT polling vs shortcut polling each get their own timer in production). For tests, expose both methods.

Update `Dispose()`:

```csharp
    public void Dispose()
    {
        StopPttPolling();
        _shortcutKbTimer?.Dispose();
        _shortcutKbTimer = null;
        if (_mouseHookHandle != IntPtr.Zero)
        {
            _backend.UnhookMouse(_mouseHookHandle);
            _mouseHookHandle = IntPtr.Zero;
        }
    }
```

Update `ReleaseAllHeld` to also release held shortcut keys:

After the mouse bindings block, before the keyboard PTT block:
```csharp
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
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouter`
Expected: all InputRouter tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterShortcutKeyboardTests.cs
git commit -m "feat(input): keyboard shortcut polling with per-action edge detection"
```

---

## Task 9: Suspend / Resume (closes #537)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs`

- [ ] **Step 1: Write failing tests**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterSuspendTests
{
    private const int VK_SPACE = 0x20;
    private const int VK_F1 = 0x70;
    private const int WM_LBUTTONDOWN = 0x0201;

    [TestMethod]
    public void WhileSuspended_NoEventsFire()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        var pressed = new List<string>();
        router.PttStateChanged += s => ptt.Add(s);
        router.ShortcutPressed += a => pressed.Add(a);

        router.SetPttBinding("Space");
        router.SetShortcutBinding("toggleMute", "F1");

        router.Suspend();

        backend.KeyDownStates[VK_SPACE] = true;
        backend.KeyDownStates[VK_F1] = true;
        router.TickPollOnce();
        router.TickShortcutPollOnce();

        // Mouse hook callback bypassed too:
        var hookProc = backend.MouseHookProc;
        if (hookProc != null) hookProc(0, new IntPtr(WM_LBUTTONDOWN), IntPtr.Zero);

        Assert.AreEqual(0, ptt.Count);
        Assert.AreEqual(0, pressed.Count);
    }

    [TestMethod]
    public void Resume_AfterSuspendedDown_DoesNotLeakHeldState()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);
        var ptt = new List<bool>();
        router.PttStateChanged += s => ptt.Add(s);

        router.SetPttBinding("Space");

        // Pre-suspend: press, then suspend (release event would fire on resume's release-all).
        backend.KeyDownStates[VK_SPACE] = true;
        router.TickPollOnce();
        Assert.AreEqual(1, ptt.Count); // pressed

        router.Suspend();
        router.Resume();

        // Release-all on resume must have brought state back to false.
        Assert.AreEqual(2, ptt.Count);
        Assert.AreEqual(false, ptt[^1]);
    }
}
```

- [ ] **Step 2: Run test, confirm failure**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterSuspendTests`
Expected: FAIL.

- [ ] **Step 3: Implement Suspend/Resume**

In `InputRouter.cs`, add field:

```csharp
    private volatile bool _suspended;
```

Add methods:

```csharp
    public void Suspend()
    {
        _suspended = true;
    }

    public void Resume()
    {
        _suspended = false;
        // Anything held that we ignored during suspend cannot leak through.
        ReleaseAllHeld();
    }
```

Guard the dispatch paths against `_suspended`:

In `MouseHookCallback`, at the top after `if (nCode != HC_ACTION)`:
```csharp
        if (_suspended) return _backend.CallNextHook(_mouseHookHandle, nCode, wParam, lParam);
```

In `TickPollOnce`, at the top:
```csharp
        if (_suspended) return;
```

In `TickShortcutPollOnce`, at the top:
```csharp
        if (_suspended) return;
```

In `HandleJsPttKey`, at the top:
```csharp
        if (_suspended) return;
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterSuspendTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Input/InputRouter.cs tests/Brmble.Client.Tests/Services/Input/InputRouterSuspendTests.cs
git commit -m "feat(input): Suspend/Resume gate (closes #537)"
```

---

## Task 10: RegisterHotKey-based shortcuts

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`
- Create: `tests/Brmble.Client.Tests/Services/Input/InputRouterHotkeyTests.cs`

Many shortcut bindings currently use `RegisterHotKey` instead of polling. We mirror that behavior in InputRouter, but **only** for shortcuts that need it (the path is preserved for compatibility — see `AudioManager.SetShortcut` switch at lines 1710-1750 for which actions used hotkeys).

The current code uses a mix: some shortcuts use `RegisterHotKey` (mute/deafen/etc. — line 1717), and there is `ShortcutKeyboardPollCallback` polling for others. After this refactor we will only use polling for keyboard shortcuts — `RegisterHotKey` is dropped in favor of unified `GetAsyncKeyState` polling, which avoids the "blocks the key from other apps" issue (#99) and removes a whole code path.

**Decision recorded:** Skip `RegisterHotKey` entirely in `InputRouter`. All keyboard shortcut handling routes through `TickShortcutPollOnce`. Hotkey IDs, `WM_HOTKEY` dispatch, `RegisterSingleHotkey`, the `_hotkeyId` family of fields, and the `WM_HOTKEY` case in `Program.cs` all go away. This simplifies suspend (no Unregister/Register dance) and removes a class of subtle bugs.

**Test:** verify InputRouter never calls `_backend.RegisterHotKey`.

- [ ] **Step 1: Write test**

Write `tests/Brmble.Client.Tests/Services/Input/InputRouterHotkeyTests.cs`:

```csharp
using Brmble.Client.Services.Voice.Input;
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Brmble.Client.Tests.Services.Input;

[TestClass]
public class InputRouterHotkeyTests
{
    [TestMethod]
    public void SettingShortcut_DoesNotCallRegisterHotKey()
    {
        var backend = new FakeInputBackend();
        using var router = new InputRouter(backend);

        router.SetShortcutBinding("toggleMute", "F1");
        router.SetShortcutBinding("toggleDeafen", "F2");
        router.SetPttBinding("Space");

        Assert.AreEqual(0, backend.RegisteredHotkeys.Count,
            "InputRouter must use polling, not RegisterHotKey");
    }
}
```

- [ ] **Step 2: Run test, confirm pass (already true by construction)**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj --filter FullyQualifiedName~InputRouterHotkeyTests`
Expected: PASS (the test is a guard against future regression).

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/Input/InputRouterHotkeyTests.cs
git commit -m "test(input): guard against re-introducing RegisterHotKey"
```

---

## Task 11: Win32InputBackend (production backend)

**Files:**
- Create: `src/Brmble.Client/Services/Voice/Input/Win32InputBackend.cs`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs` — extract `Win32RawInput` constants/types to a shared file so Win32InputBackend can reuse them (or duplicate the small surface needed)

Win32InputBackend wraps the existing PInvoke surface. We can reuse `Win32RawInput` static class which already lives in `AudioManager.cs`. We will move it to its own file for cleanliness, but keep it in the same namespace.

- [ ] **Step 1: Extract Win32RawInput to its own file**

Create `src/Brmble.Client/Services/Voice/Win32RawInput.cs` and move the entire `internal static class Win32RawInput` block (currently at `src/Brmble.Client/Services/Voice/AudioManager.cs:118-207`) into it. Keep the same `namespace Brmble.Client.Services.Voice`. Then delete the block from `AudioManager.cs`.

(Optional: leave `internal` but our new `Win32InputBackend.cs` is in `Services.Voice.Input` — that's a sibling namespace and `internal` covers the same assembly, so this works fine.)

- [ ] **Step 2: Verify build still passes**

Run: `dotnet build`
Expected: succeeds.

- [ ] **Step 3: Write Win32InputBackend**

Write `src/Brmble.Client/Services/Voice/Input/Win32InputBackend.cs`:

```csharp
using System;
using System.Runtime.InteropServices;
using Brmble.Client.Services.Voice;

namespace Brmble.Client.Services.Voice.Input;

public sealed class Win32InputBackend : IInputBackend
{
    private readonly IntPtr _hwnd;
    public IntPtr Hwnd => _hwnd;

    public Win32InputBackend(IntPtr hwnd) { _hwnd = hwnd; }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyStateNative(int vk);

    short IInputBackend.GetAsyncKeyState(int vk) => GetAsyncKeyStateNative(vk);

    public IntPtr SetMouseHook(LowLevelMouseProc proc)
    {
        IntPtr hModule = Win32RawInput.GetModuleHandle(null);
        // Adapter delegate so we can keep IInputBackend's delegate type internal to the abstraction.
        Win32RawInput.LowLevelMouseProc adapter = (n, w, l) => proc(n, w, l);
        // NOTE: caller must keep the delegate alive; production caller (InputRouter)
        // stores _mouseHookProc as a field. The adapter here is captured by the
        // returned hook handle's lifetime via the proc parameter the caller pins.
        return Win32RawInput.SetWindowsHookEx(Win32RawInput.WH_MOUSE_LL, adapter, hModule, 0);
    }

    public bool UnhookMouse(IntPtr handle)
        => Win32RawInput.UnhookWindowsHookEx(handle);

    public IntPtr CallNextHook(IntPtr handle, int nCode, IntPtr wParam, IntPtr lParam)
        => Win32RawInput.CallNextHookEx(handle, nCode, wParam, lParam);

    // We're dropping RegisterHotKey in this refactor — return false (caller never invokes).
    public bool RegisterHotKey(int id, uint modifiers, uint vk) => false;
    public bool UnregisterHotKey(int id) => false;

    // Raw keyboard. We only need this for the unfocused-window edge case;
    // keep behind a flag so we can disable per-platform/version.
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
```

The adapter delegate is the one subtle bit: `LowLevelMouseProc` and `Win32RawInput.LowLevelMouseProc` have identical signatures but are distinct delegate types. We bridge them by wrapping. The InputRouter pins its own `_mouseHookProc` field — that keeps the outer delegate alive; the adapter is a closure over that, also kept alive by reference from the hook chain.

- [ ] **Step 4: Build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/Win32RawInput.cs src/Brmble.Client/Services/Voice/Input/Win32InputBackend.cs src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(input): Win32InputBackend production wrapper"
```

---

## Task 12: Wire InputRouter into MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

This is the integration point. MumbleAdapter instantiates InputRouter, wires its events to AudioManager and the bridge, and calls `ReleaseAllHeld` on lifecycle events.

Note: AudioManager's input-handling methods are still present at this point. We continue to call them for now; in Task 13 we'll rip them out. This task is purely additive to keep the diff reviewable.

- [ ] **Step 1: Add InputRouter field and instantiate it**

In `MumbleAdapter.cs`, near the existing `_audioManager` field, add:

```csharp
    private InputRouter? _inputRouter;
```

Add `using Brmble.Client.Services.Voice.Input;` at the top.

In the constructor (or wherever `_audioManager` is first created — currently inline at `Connect()` line 219-253), add right after:

```csharp
            _inputRouter = new InputRouter(new Win32InputBackend(_hwnd));
            _inputRouter.PttStateChanged += _audioManager.SetPttActive;
            _inputRouter.ShortcutPressed += action =>
            {
                _bridge?.Send("voice.shortcutPressed", new { action });
                _bridge?.NotifyUiThread();
                if (action == "toggleGame")
                {
                    _bridge?.Send("game.toggle", null);
                    _bridge?.NotifyUiThread();
                }
            };
            _inputRouter.ShortcutReleased += action =>
            {
                _bridge?.Send("voice.shortcutReleased", new { action });
                _bridge?.NotifyUiThread();
                FireShortcutAction(action);
            };
            _inputRouter.JsForceReleaseRequested += () =>
            {
                _bridge?.Send("voice.pttKey", new { pressed = false, forced = true });
                _bridge?.NotifyUiThread();
            };
```

You'll need to make `SetPttActive` accessible. It is currently private in `AudioManager`. Add a `public` shim:

In `AudioManager.cs`, near the existing `SetPttActive`:

```csharp
    public void SetPttActiveExternal(bool active) => SetPttActive(active);
```

Then use `_audioManager.SetPttActiveExternal` instead of `_audioManager.SetPttActive` in the event wiring above.

Add `FireShortcutAction` helper to `MumbleAdapter` (mirror of `AudioManager.FireShortcutAction` at line 1671):

```csharp
    private void FireShortcutAction(string action)
    {
        switch (action)
        {
            case "toggleMute": ToggleMute(); break;
            case "toggleMuteDeafen": ToggleMute(); ToggleDeaf(); break;
            case "continuousTransmission": ToggleContinuousTransmission(); break;
            case "toggleLeaveVoice": LeaveVoice(); break;
            case "toggleDmScreen":
                _bridge?.Send("voice.toggleDmScreen", null);
                _bridge?.NotifyUiThread();
                break;
            case "toggleScreenShare":
                _bridge?.Send("voice.toggleScreenShare", null);
                _bridge?.NotifyUiThread();
                break;
        }
    }

    private void ToggleContinuousTransmission()
    {
        if (_audioManager == null) return;
        var current = _audioManager.TransmissionMode;
        var newMode = current == TransmissionMode.Continuous ? _previousMode : TransmissionMode.Continuous;
        if (current != TransmissionMode.Continuous) _previousMode = current;
        var pttKey = (newMode == TransmissionMode.PushToTalk || newMode == TransmissionMode.PushToTalkPlus) ? _currentPttKey : null;
        _audioManager.SetTransmissionMode(newMode, pttKey, _hwnd);
        _inputRouter?.SetPttBinding(pttKey);
    }
```

- [ ] **Step 2: Route bridge messages to InputRouter**

Find the bridge handler registration block (around `MumbleAdapter.cs:2239` for `voice.setTransmissionMode` and `:2278` for `voice.pttKey`). Update them:

Replace the `voice.pttKey` handler:
```csharp
        bridge.RegisterHandler("voice.pttKey", data =>
        {
            bool pressed = (data as Newtonsoft.Json.Linq.JObject)?["pressed"]?.ToObject<bool>() ?? false;
            _inputRouter?.HandleJsPttKey(pressed);
        });
```

Add new handlers for suspend/resume:
```csharp
        bridge.RegisterHandler("input.suspend", _ =>
        {
            _inputRouter?.Suspend();
        });
        bridge.RegisterHandler("input.resume", _ =>
        {
            _inputRouter?.Resume();
        });
```

Update `SetTransmissionMode(string mode, string? key)` to also route to InputRouter:
```csharp
    public void SetTransmissionMode(string mode, string? key)
    {
        var parsed = ParseTransmissionMode(mode);
        if (parsed == TransmissionMode.Continuous && mode != "continuous")
            Debug.WriteLine($"[Audio] Unknown transmission mode '{mode}', defaulting to Continuous");

        if (parsed == TransmissionMode.PushToTalk || parsed == TransmissionMode.PushToTalkPlus)
            _currentPttKey = key;

        _audioManager?.SetDtx(ShouldEnableDtx(parsed));
        _audioManager?.SetTransmissionMode(parsed, key, _hwnd);

        // Route to InputRouter: PTT binding gets the key; non-PTT modes clear it.
        bool isPtt = parsed == TransmissionMode.PushToTalk || parsed == TransmissionMode.PushToTalkPlus;
        _inputRouter?.SetPttBinding(isPtt ? key : null);
    }
```

Update `ApplySettings` to also route shortcuts:
```csharp
    public void ApplySettings(AppSettings settings)
    {
        SetTransmissionMode(settings.Audio.TransmissionMode, settings.Audio.PushToTalkKey);
        // ... existing VAD setup, leave as-is ...
        _audioManager?.SetShortcut("toggleMute", settings.Shortcuts.ToggleMuteKey);
        _audioManager?.SetShortcut("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
        _audioManager?.SetShortcut("toggleLeaveVoice", settings.Shortcuts.ToggleLeaveVoiceKey);
        _audioManager?.SetShortcut("toggleDmScreen", settings.Shortcuts.ToggleDMScreenKey);
        _audioManager?.SetShortcut("toggleScreenShare", settings.Shortcuts.ToggleScreenShareKey);
        _audioManager?.SetShortcut("toggleGame", settings.Shortcuts.ToggleGameKey);

        // Mirror to InputRouter (running in parallel during this PR; AudioManager calls are removed in Task 13).
        _inputRouter?.SetShortcutBinding("toggleMute", settings.Shortcuts.ToggleMuteKey);
        _inputRouter?.SetShortcutBinding("toggleMuteDeafen", settings.Shortcuts.ToggleMuteDeafenKey);
        _inputRouter?.SetShortcutBinding("toggleLeaveVoice", settings.Shortcuts.ToggleLeaveVoiceKey);
        _inputRouter?.SetShortcutBinding("toggleDmScreen", settings.Shortcuts.ToggleDMScreenKey);
        _inputRouter?.SetShortcutBinding("toggleScreenShare", settings.Shortcuts.ToggleScreenShareKey);
        _inputRouter?.SetShortcutBinding("toggleGame", settings.Shortcuts.ToggleGameKey);
    }
```

- [ ] **Step 3: Hook ReleaseAllHeld into lifecycle events**

Find the points where `voice.connected`, `voice.disconnected`, `voice.channelJoined`, `voice.channelLeft` are emitted to the bridge in `MumbleAdapter.cs`. Right after each emit, add:

```csharp
            _inputRouter?.ReleaseAllHeld();
```

Specifically: search the file for each event name with `_bridge?.Send` and insert `_inputRouter?.ReleaseAllHeld();` immediately after the `Send` + `NotifyUiThread()` calls. (If multiple call sites exist for the same event, all must release.)

- [ ] **Step 4: Build**

Run: `dotnet build`
Expected: succeeds. There will be duplicated input dispatch (AudioManager + InputRouter both seeing events) — that's temporary, fixed in Task 13.

- [ ] **Step 5: Run all tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: all PASS. The AudioManager tests continue to work because we haven't removed AudioManager's input plumbing yet.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(input): wire InputRouter into MumbleAdapter (parallel-running)"
```

---

## Task 13: Remove input plumbing from AudioManager

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs` (large deletions)
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (remove now-dead AudioManager calls)
- Modify: `tests/Brmble.Client.Tests/Services/AudioManagerTransmissionModeTests.cs` (delete or migrate)

This is a large surgical edit. The order matters: keep AudioManager compilable at each step.

- [ ] **Step 1: Delete the input-related private fields**

In `AudioManager.cs`, remove these fields (the line numbers refer to current main; use Grep to locate):

- `_hotkeyId`, `_muteHotkeyId`, `_muteDeafenHotkeyId`, `_continuousHotkeyId`, `_leaveVoiceHotkeyId`, `_dmScreenHotkeyId`, `_screenShareHotkeyId` (lines 238-251)
- `_muteKeyName`, `_muteDeafenKeyName`, `_continuousKeyName`, `_leaveVoiceKeyName`, `_dmScreenKeyName`, `_screenShareKeyName` (lines 252-258)
- `_hwnd` (line 259)
- `_pttVk`, `_rawInputRegistered` (lines 263-264)
- `_pttPollingTimer`, `_pttKeyWasDown` (lines 267-268)
- `_shortcutKeyboardLock`, `_shortcutKeyboardVkToAction`, `_shortcutKeyboardWasDown`, `_shortcutKeyboardPollingTimer` (lines 271-274)
- `_shortcutMouseVk`, `_shortcutReleaseTimer`, `_heldMouseAction` (find by Grep — these are in the shortcut path)
- `_mouseHookProc`, `_mouseHookHandle` (lines 1848-1849)
- `_shortcutActionForMouse`, `_shortcutKeyForMouse` (lines 1861-1862)
- `_suspendCount` (Grep for it)

- [ ] **Step 2: Delete the input-related methods**

Remove these methods entirely:
- `RegisterSingleHotkey` (line 1293)
- `SetShortcut` (line 1697)
- `Suspend`, `Resume`, `IsSuspended` (Grep — they manage `_suspendCount`)
- `RegisterMouseHookForShortcut`, `RegisterMouseHookForButton` (lines 1953, 1983)
- `MouseHookCallback` (line 1864)
- `UnregisterMouseHook` (line 1851)
- `StartPttPolling`, `StopPttPolling`, `PttPollCallback` (lines 1517, 1524, 1530)
- `StartShortcutKeyboardPolling`, `StopShortcutKeyboardPolling`, `ShortcutKeyboardPollCallback` (lines 1562, 1568, 1574)
- `StartShortcutReleasePolling`, `StopShortcutReleasePolling`, `ShortcutReleasePollCallback` (lines 1638, 1646, 1652)
- `FireShortcutAction` (line 1671 — already moved to MumbleAdapter)
- `HandleHotKey` (Grep for it)
- `HandleRawInput` (line 1990)
- `UnregisterRawInputKeyboard` (Grep)
- `IsTransmissionConfigStillValid` (line 1490) — the workaround is no longer needed
- `IsMouseButtonKey` (line 1472) — moved to MouseButtonExtensions
- `KeyNameToVirtualKey` (line 2326) — moved to InputRouter (still `internal`)
- `VirtualKeyToString` (line 2026) — only used by HandleRawInput, dies with it
- `PttInputState` record, `CurrentPttInputState`, `MouseHookPttAction` constant (lines 1453-1482)
- `HandlePttKeyFromJs` (line 2081)

- [ ] **Step 3: Simplify SetTransmissionMode**

Replace the entire `SetTransmissionMode` method (line 1359) with a much smaller version that only handles audio mode state:

```csharp
    public void SetTransmissionMode(TransmissionMode mode, string? key, IntPtr hwnd)
    {
        // hwnd parameter is now ignored — InputRouter owns Win32. Kept in the
        // signature for now so existing test call sites compile; future cleanup
        // removes it from the API surface.
        if (_transmissionConfigured
            && mode == _transmissionMode
            && key == _lastTransmissionKey)
        {
            return;
        }

        _pttActive = false;
        _transmissionMode = mode;

        if (mode == TransmissionMode.PushToTalk)
            StopMic();
        else if (mode == TransmissionMode.PushToTalkPlus)
            StartMic();
        else if (!_muted)
            StartMic();

        _lastTransmissionKey = key;
        _transmissionConfigured = true;
        TransmissionApplyCount++;
    }
```

- [ ] **Step 4: Remove constructor `hwnd` parameter**

If `AudioManager`'s constructor takes `IntPtr hwnd`, remove it. Update `MumbleAdapter.cs` callsites — replace `new AudioManager(_hwnd)` with `new AudioManager()`. Update `MumbleAdapter` to NOT pass `_hwnd` to `SetTransmissionMode` anymore — change it to `IntPtr.Zero` or, if the parameter is removable across all callers, drop it from the signature.

For simplicity, keep `IntPtr hwnd` in the signature for now (existing tests pass `IntPtr.Zero`) — but pass `IntPtr.Zero` from MumbleAdapter going forward.

- [ ] **Step 5: Remove MumbleAdapter passthrough wrappers**

In `MumbleAdapter.cs`, delete `HandleHotKey` and `HandleRawInput` (lines 862-867):

```csharp
    // DELETE these lines:
    public void HandleHotKey(int id, bool keyDown)
        => _audioManager?.HandleHotKey(id, keyDown);

    public void HandleRawInput(IntPtr wParam, IntPtr lParam)
        => _audioManager?.HandleRawInput(wParam, lParam);
```

Also delete the duplicated `_audioManager?.SetShortcut(...)` calls in `ApplySettings` (they were left in Task 12 for parallel-running; now InputRouter is sole owner):

```csharp
    // DELETE these — InputRouter handles all shortcuts now:
    _audioManager?.SetShortcut("toggleMute", ...);
    // ... etc for all 6 SetShortcut calls
```

- [ ] **Step 6: Build**

Run: `dotnet build`
Expected: succeeds. There will likely be compile errors from tests that reference deleted methods — that's expected and addressed next.

- [ ] **Step 7: Migrate `AudioManagerTransmissionModeTests.cs`**

Tests that exercise hook side effects (`MouseHookHandle_AfterSetTransmissionMode`, `IsTransmissionConfigStillValid` tests, etc.) — delete them. They are now covered by InputRouter tests.

Tests that exercise pure transmission-mode state (idempotency, mode switching, mic start/stop) — keep them and verify they still call only the now-simpler `SetTransmissionMode`.

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: all PASS (after deletions, fewer tests but all green).

- [ ] **Step 8: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs tests/Brmble.Client.Tests/Services/AudioManagerTransmissionModeTests.cs
git commit -m "refactor(audio): remove input plumbing from AudioManager (InputRouter owns it)"
```

---

## Task 14: Program.cs WndProc routing

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

`WM_HOTKEY` and `WM_INPUT` previously routed to `_mumbleClient.HandleHotKey` / `HandleRawInput`. We've dropped `RegisterHotKey` entirely, so `WM_HOTKEY` is dead. `WM_INPUT` is also unused after Task 13 deletions.

- [ ] **Step 1: Delete the WM_HOTKEY and WM_INPUT cases**

In `Program.cs` (lines 672-678), delete:

```csharp
            case Win32Window.WM_HOTKEY:
                _mumbleClient?.HandleHotKey((int)wParam.ToInt64(), true);
                return IntPtr.Zero;

            case Win32Window.WM_INPUT:
                _mumbleClient?.HandleRawInput(wParam, lParam);
                return Win32Window.DefWindowProc(hwnd, msg, wParam, lParam);
```

- [ ] **Step 2: Build and run app smoke test**

Run: `dotnet build && dotnet run --project src/Brmble.Client`
Expected: app launches without crash. (Manual: connect to a server, exercise PTT briefly.)

- [ ] **Step 3: Commit**

```bash
git add src/Brmble.Client/Program.cs
git commit -m "refactor(client): remove dead WM_HOTKEY and WM_INPUT WndProc cases"
```

---

## Task 15: Web — window blur force-release + forced-flag handling

**Files:**
- Modify: `src/Brmble.Web/src/App.tsx`
- Create: `src/Brmble.Web/src/App.pttBlur.test.ts`

- [ ] **Step 1: Write failing test for blur behavior**

Write `src/Brmble.Web/src/App.pttBlur.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal harness: import the App, render with a mock bridge, simulate keydown then blur,
// assert bridge.send was called with voice.pttKey { pressed: false }.

// NOTE: implementation will mirror the pattern used by the existing PTT key tests
// in src/Brmble.Web/src/. See e.g. App.screenShareStart.test.ts for the bridge mock pattern.
// The test must:
//   1. Set up a settings object with transmissionMode = 'pushToTalk' and pushToTalkKey = 'Space'.
//   2. Render <App />.
//   3. Fire window 'keydown' with code='Space' → expect bridge.send('voice.pttKey', {pressed: true}).
//   4. Fire window 'blur' → expect bridge.send('voice.pttKey', {pressed: false}).
//   5. Subsequent 'keydown' with same key must still fire pressed:true (local pttPressed was reset).

it.skip('TODO: implement following the App.screenShareStart.test.ts harness pattern', () => {});
```

The skip is intentional — implementing the test harness is a non-trivial setup, and the existing test in `App.screenShareStart.test.ts` shows the pattern. The agent implementing this task must replace `it.skip` with a real test that uses the same bridge-mock setup as the screenShareStart tests.

- [ ] **Step 2: Implement blur handler in App.tsx**

In `src/Brmble.Web/src/App.tsx`, inside the `useEffect` that handles PTT (currently at line 1138), inside the same effect:

After the existing `handleKeyUp` definition, add:

```typescript
    const handleBlur = () => {
      if (pttPressed) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }
    };
```

In the same effect, register the listener:

```typescript
    window.addEventListener('blur', handleBlur);
```

And in the cleanup:

```typescript
    return () => {
      // ... existing cleanup ...
      window.removeEventListener('blur', handleBlur);
    };
```

Also update the `voice.pttKey` listener-side path (currently App.tsx sends but does not receive). The native side will now send `voice.pttKey { pressed: false, forced: true }` when InputRouter calls JsForceReleaseRequested. Add a bridge handler that resets local state:

In the same effect, after registering settings handlers:

```typescript
    const handleNativePttForceRelease = (data: unknown) => {
      const d = data as { pressed?: boolean; forced?: boolean } | undefined;
      if (d?.forced && d.pressed === false) {
        // Native is telling us PTT was force-released (e.g. ReleaseAllHeld on channel join).
        pttPressed = false;
      }
    };
    bridge.on('voice.pttKey', handleNativePttForceRelease);
```

And in cleanup:
```typescript
      bridge.off('voice.pttKey', handleNativePttForceRelease);
```

- [ ] **Step 3: Run web tests**

Run: `(cd src/Brmble.Web && npm test -- --run App.pttBlur)`
Expected: skip notice, no failures. (Implementer of this task fills in the real test.)

Also run the full web test suite to check for regressions:
Run: `(cd src/Brmble.Web && npm test -- --run)`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/Brmble.Web/src/App.tsx src/Brmble.Web/src/App.pttBlur.test.ts
git commit -m "feat(web): force-release PTT on window blur + handle native force-release"
```

---

## Task 16: Web — input.suspend / input.resume during keybinding capture

**Files:**
- Modify: `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`

- [ ] **Step 1: Add suspend/resume to PttKeyCapture**

Read `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx`. Find the `useEffect` that mounts the capture listener.

Add to the effect:
```typescript
    bridge.send('input.suspend', null);
    return () => {
      bridge.send('input.resume', null);
      // ... existing cleanup ...
    };
```

(If `bridge` is not yet imported in this file, import it from the same path used in `App.tsx`.)

- [ ] **Step 2: Add suspend/resume to ShortcutsSettingsTab**

Read `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx`. Find the code path that enters "recording" mode (looking for state like `recordingAction` or similar).

Wrap the recording lifecycle:
- When recording mode starts → `bridge.send('input.suspend', null);`
- When recording mode ends (commit OR cancel OR component unmount while recording) → `bridge.send('input.resume', null);`

If recording mode has multiple end paths, factor a single helper:
```typescript
    const stopRecording = (committedKey: string | null) => {
      bridge.send('input.resume', null);
      // ... existing stop-recording logic ...
    };
```

And ensure `useEffect` cleanup also sends `input.resume` if the component unmounts mid-recording.

- [ ] **Step 3: Run web tests**

Run: `(cd src/Brmble.Web && npm test -- --run)`
Expected: PASS (these UI changes likely don't have direct tests; if existing tests stub `bridge.send` they may notice new calls — adjust expectations as needed).

- [ ] **Step 4: Manual smoke test**

Run the app:
```bash
(cd src/Brmble.Web && npm run dev)
# in another terminal:
dotnet run --project src/Brmble.Client
```

Steps:
1. Connect to a server with PTT bound to Space.
2. Open Settings → Shortcuts.
3. Click "Record" on the mute shortcut.
4. Press Space.
5. Confirm Space is NOT transmitting (the PTT polling is suspended).
6. Press the desired mute key (e.g. F1) — it should bind.
7. Close settings → press Space → PTT works again.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx
git commit -m "feat(web): suspend input during keybinding capture (closes #537)"
```

---

## Task 17: Self-review the spec deliverables

This is a checklist task — no code. Verify each spec acceptance criterion has a matching test or manual verification step.

- [ ] **Step 1: Walk the spec acceptance criteria**

Spec: `docs/superpowers/specs/2026-05-16-input-router-design.md`

For each item, point to where it's covered:

| Spec acceptance criterion | Covered by |
|---|---|
| PTT on mouse + non-PTT mouse shortcut coexist | `InputRouterDispatchTests.PttOnX2AndMuteOnLeft_CoexistWithoutInterference` |
| PTT cannot remain active after connect/disconnect/channel-join | `InputRouterLifecycleTests.ReleaseAllHeld_AfterJsPttDown_FiresRelease` + manual test |
| Recording keybinding cannot fire shortcut actions or transmit | `InputRouterSuspendTests.WhileSuspended_NoEventsFire` + Task 16 manual smoke |
| IsTransmissionConfigStillValid workaround disappears | Deleted in Task 13 |
| AudioManager no longer knows about hwnd, hooks, polling | Verified by Task 13 deletions; `dotnet build` would fail if it still referenced them |
| JS path force-release on blur | Task 15 |

- [ ] **Step 2: Run the entire test suite one more time**

Run: `dotnet test` and `(cd src/Brmble.Web && npm test -- --run)`
Expected: everything green.

- [ ] **Step 3: Build full release-config to catch any debug-only issues**

Run: `dotnet build -c Release`
Expected: succeeds with no warnings about the new code.

- [ ] **Step 4: Manual verification checklist (from spec)**

Run the app:
```bash
(cd src/Brmble.Web && npm run dev)
dotnet run --project src/Brmble.Client
```

Run through:
- Connect with keyboard PTT → PTT inactive on arrival.
- Connect with mouse PTT (bind XButton2) → PTT inactive on arrival.
- Switch channel mid-session with PTT held → PTT inactive after switch.
- Reconnect (kill server, wait 5s, restart) → PTT inactive after reconnect.
- Hold PTT (keyboard), Alt+Tab away, release physical key, Alt+Tab back → no stuck audio.
- Hold mouse-PTT, switch channel while holding → released.
- Bind PTT to XButton2 AND mute to MouseLeft → both work simultaneously across the session.
- Open settings, click record on a shortcut → no actions fire while recording.

Document any failures as new tasks and address before opening the PR.

- [ ] **Step 5: Final commit (only if any docs were touched in this review)**

```bash
git status
# if anything was changed:
git add -A && git commit -m "chore(input): post-implementation review tweaks"
```

---

## After plan execution

Once all tasks above are green, follow `superpowers:finishing-a-development-branch` to decide on PR creation. The PR description should reference all three issues (#497, #538, #537) with "Closes" lines.

The user must approve the push and PR creation per project CLAUDE.md branch policy.
