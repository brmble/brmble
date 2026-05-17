# InputRouter — design spec

**Date:** 2026-05-16
**Closes:** #497 (shared mouse hook ownership fight), #538 (stuck-active PTT after connect/channel-join), #537 (shortcut actions firing while recording a new keybinding)

## Problem

Low-level input plumbing (Win32 hooks, polling, RegisterHotKey, raw input) is tangled into `AudioManager.cs`. Three related bugs follow from this tangling:

- **#497** — A single shared `WH_MOUSE_LL` hook with a single-slot dispatch (`_shortcutActionForMouse` / `_shortcutKeyForMouse`) means PTT-on-mouse and any non-PTT mouse shortcut clobber each other. Whichever was registered last wins; the other silently stops working. The workaround in `IsTransmissionConfigStillValid` recovers PTT reactively but loses the shortcut.
- **#538** — PTT sometimes latches "active" after connect/reconnect/channel-join. Continues transmitting until the user re-records the PTT shortcut. Root causes include #497 (mouse-PTT release routed to the wrong slot after a settings reapply), and gaps in the keyboard-PTT path where JS and native polling can disagree without a release path that always wins.
- **#537** — Shortcut actions still fire while the user is recording a new keybinding in settings UI, because there is no central suspend mechanism.

These are three symptoms of one underlying problem: `AudioManager` owns both audio (mic/encoder/jitter/state) and input (Win32 hooks/polling/hotkeys), with no central authority over input lifecycle.

## Goals

1. PTT on a mouse button and a non-PTT mouse shortcut coexist without interfering.
2. PTT cannot remain active after connect/disconnect/channel-join unless the configured input is physically held.
3. Recording a new keybinding cannot fire shortcut actions or transmit on PTT.
4. The reactive `IsTransmissionConfigStillValid` workaround disappears (the architectural problem it covered no longer exists).
5. `AudioManager` no longer knows about `hwnd`, hooks, polling timers, or `RegisterHotKey`.

## Non-goals

- Replacing `GetLastInputInfo` system-idle tracking (`SystemIdleTracker.cs`) — different abstraction, different concern.
- Replacing local per-modal keyboard handlers (Esc-to-close, dialog navigation) — these are UI-local, not global input dispatch.
- Refactoring the `Win32Window.cs` PInvoke declaration layer — it stays as a utility surface.
- Audio pipeline changes (VAD, mic, encoder, jitter buffer, WASAPI) — pure audio paths are untouched.

## Architecture

### Component split

New component `InputRouter` (in `src/Brmble.Client/Services/Voice/Input/InputRouter.cs`) becomes the sole owner of low-level input. `AudioManager` becomes a consumer that subscribes to events.

**Moves from `AudioManager` → `InputRouter`:**
- Mouse hook lifecycle (`_mouseHookHandle`, `MouseHookCallback`, `RegisterMouseHookForShortcut`)
- PTT keyboard polling (`_pttPollingTimer`, `PttPollCallback`, `_pttVk`, `_pttKeyWasDown`)
- Shortcut keyboard polling (`_shortcutKeyboardPollingTimer`, `ShortcutKeyboardPollCallback`)
- Shortcut release polling (`_shortcutReleaseTimer`)
- Raw input keyboard handling (`HandleRawInput` keyboard branch, `_pttVk` checks)
- Key/button name → VK mapping (`KeyNameToVirtualKey`, `IsMouseButtonKey`)
- `RegisterHotKey` / `UnregisterHotKey` + all `_xxxHotkeyId` fields + `_suspendCount`
- `RegisterSingleHotkey` helper
- `WM_HOTKEY` message dispatch

**Stays in `AudioManager`:**
- `_pttActive` state and `SetPttActive` logic (debounce, mic gating, silence tail timing)
- Transmission mode logic (Continuous / PTT / PTT+ / VAD)
- All mic/encoder/jitter-buffer/WASAPI code

`AudioManager`'s constructor loses its `IntPtr hwnd` parameter. `MumbleAdapter` instantiates both `InputRouter` and `AudioManager`, wires the events:

```csharp
_inputRouter = new InputRouter(new Win32InputBackend(hwnd));
_audioManager = new AudioManager();
_inputRouter.PttStateChanged += _audioManager.SetPttActive;
_inputRouter.ShortcutPressed += action => /* forward to bridge */;
_inputRouter.ShortcutReleased += action => /* forward, fire toggle */;
```

### API surface

```csharp
public sealed class InputRouter : IDisposable
{
    InputRouter(IInputBackend backend);

    // Binding management. null key = unbound.
    void SetPttBinding(string? key);
    void SetShortcutBinding(string action, string? key);

    // JS-originated PTT events (from voice.pttKey bridge handler).
    void HandleJsPttKey(bool pressed);

    // Lifecycle. Called by MumbleAdapter on voice.connected /
    // voice.disconnected / voice.channelJoined / voice.channelLeft.
    void ReleaseAllHeld();

    // Recording UI calls these via input.suspend / input.resume bridge.
    void Suspend();
    void Resume();

    // Events.
    event Action<bool> PttStateChanged;   // true=down, false=up
    event Action<string> ShortcutPressed;
    event Action<string> ShortcutReleased;
}
```

### IInputBackend abstraction

```csharp
public interface IInputBackend
{
    IntPtr Hwnd { get; }
    short GetAsyncKeyState(int vk);
    IntPtr SetWindowsHookEx(int hookId, LowLevelMouseProc proc, IntPtr hMod, uint thread);
    bool UnhookWindowsHookEx(IntPtr handle);
    bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint vk);
    bool UnregisterHotKey(IntPtr hwnd, int id);
    bool RegisterRawInputDevices(...);
    // etc.
}
```

Production: `Win32InputBackend` (real PInvoke). Tests: `FakeInputBackend` that programmatically injects key/button events and records hotkey registrations. Allows unit tests to cover dispatch, lifecycle, suspend, and dedupe without touching Win32.

### Mouse-hook dispatch table (fixes #497)

```csharp
private enum MouseButton { Left, Right, Middle, X1, X2 }
private record MouseBinding(string Action, string Key, bool IsHeld);

private readonly object _mouseLock = new();
private readonly Dictionary<MouseButton, MouseBinding> _mouseBindings = new();
private IntPtr _mouseHookHandle = IntPtr.Zero;
```

`SetMouseBinding(button, action, key)`:
1. Lock `_mouseLock`.
2. Upsert `_mouseBindings[button] = new(action, key, IsHeld: false)`.
3. If hook not yet registered and dictionary non-empty → register once.
4. **No tear-down**. Other bindings untouched.

`ClearMouseBinding(button)`:
1. Lock.
2. Remove entry. If `IsHeld`, emit release event for its action.
3. If dictionary now empty → unhook.

`MouseHookCallback` reads the dictionary on each event:
- Map Win32 message + lParam to `MouseButton?`.
- If `_suspended` or button not in dictionary → `CallNextHookEx` and return.
- On down: if `!IsHeld`, set `IsHeld = true`, fire `PttStateChanged(true)` or `ShortcutPressed(action)`.
- On up: if `IsHeld`, set `IsHeld = false`, fire `PttStateChanged(false)` or `ShortcutReleased(action)` (and toggle action via `FireShortcutAction` equivalent).

Effects:
- PTT on X2 and mute on Left coexist — two dictionary entries, both active.
- `SetShortcutBinding("toggleMute", "MouseLeft")` does not touch the X2 entry.
- `IsHeld` per binding lets `ReleaseAllHeld()` emit release events only for actually-held bindings.
- `IsTransmissionConfigStillValid` consistency-check is deleted — no more "stolen hook" scenario to detect.

### Keyboard PTT (fixes the keyboard half of #538)

`SetPttBinding(key)` **always** performs an implicit release before activating the new binding:
- If previous binding had a held state (from polling or JS), emit `PttStateChanged(false)`.
- Reset `_pollPttPressed = false`, `_jsPttPressed = false`, and the internal poll edge-detect flag (`_pttKeyWasDown`) to known-safe state.
- For idempotent reapply (same key, same mode) we keep polling/hooks running (avoid unnecessary teardown), but we still reset the state-tracking flags above.

Native polling and JS path dedupe:
- Two derived flags: `_pollPttPressed` (current view from `PttPollCallback`'s edge detection) and `_jsPttPressed` (set by `HandleJsPttKey`).
- Public `PttStateChanged` event fires based on **OR** of the two — release wins only when both are false.
- This is deliberate: if the user physically holds the key but window blur causes JS to miss the keyup, native polling cannot release on its own. `ReleaseAllHeld()` on lifecycle transitions is the catch.
- A new `window.addEventListener('blur', ...)` in `App.tsx` sends `voice.pttKey { pressed: false }` so JS state stays consistent.

### Lifecycle: ReleaseAllHeld

Called by `MumbleAdapter` on:
- `voice.connected`
- `voice.disconnected`
- `voice.channelJoined`
- `voice.channelLeft`

Operation:
1. Lock `_mouseLock`, iterate mouse bindings with `IsHeld = true` → mark released, emit appropriate event.
2. Reset `_pttKeyWasDown = false`. If PTT state was true → emit `PttStateChanged(false)`.
3. Reset `_jsPttPressed = false`.
4. Iterate held shortcut keyboard entries → mark released, emit `ShortcutReleased`.
5. Send `voice.pttKey { pressed: false, forced: true }` to JS so `App.tsx`'s local `pttPressed` resets and the next user keydown isn't suppressed by `if (!pttPressed)`.

ReleaseAllHeld does **not** fire on every `ApplySettings` call. Idempotent UI-storm reapplies of settings do not interrupt an active PTT session.

### Suspend / Resume (fixes #537)

`Suspend()`:
- Call `ReleaseAllHeld()` first so anything held when capture starts is force-released through subscribers.
- Set `_suspended = true` (volatile bool).
- Mouse hook stays registered (Win32 cost to tear down + risk of missing events on a worker thread); `MouseHookCallback` checks `_suspended` and bypasses dispatch.
- Polling callbacks (PTT + shortcut) check `_suspended` and bypass dispatch (but keep timer alive — no state loss).
- `HandleJsPttKey` early-returns.

Note: the original draft of this spec described unregistering `RegisterHotKey` registrations during Suspend. The implementation dropped `RegisterHotKey` entirely — all keyboard shortcuts go through `GetAsyncKeyState` polling, which observes input without blocking other applications — so there are no hotkeys to unregister.

`Resume()`:
- Call `ReleaseAllHeld()` first to discard any state that built up while suspended.
- Prime `_pttKeyWasDown` and `_shortcutKbWasDown[vk]` from the current physical `GetAsyncKeyState` reading. A key still physically held when capture ends becomes `was-down = true`, so the next poll tick stays a no-op (no fresh press).
- For shortcut VKs that were down at resume, also flag them in `_shortcutKbSuppressNextRelease`. The next release tick consumes the entry without firing `ShortcutReleased`, so a key pressed during capture (recorded as the new binding) cannot trigger its action when the user releases it after capture ends.
- Set `_suspended = false`.

Call sites:
- `PttKeyCapture.tsx` (onboarding wizard) calls suspend on mount, resume on unmount.
- `ShortcutsSettingsTab.tsx` (settings modal) calls suspend on enter recording mode, resume on commit/cancel.
- `AudioSettingsTab.tsx` calls suspend/resume during PTT key capture.
- All three components send the existing `voice.suspendHotkeys` / `voice.resumeHotkeys` bridge messages. `MumbleAdapter` routes these to `InputRouter.Suspend()` / `Resume()`. (Earlier drafts of this spec proposed adding new `input.suspend` / `input.resume` channels; the implementation reuses the existing message names so the web side did not need to change.)

### Race safety

- `_mouseBindings` dictionary access is gated by `_mouseLock` (callback on random Win32 thread, registration on UI thread).
- `_suspended` is `volatile bool`.
- All event emissions happen on the thread where the input arrives. `AudioManager.SetPttActive` already handles cross-thread invocation via its internal lock. `MumbleAdapter` event handlers marshal to UI thread via `NativeBridge.NotifyUiThread()` where needed.
- `ReleaseAllHeld` is always invoked from the UI thread (it's hooked to bridge events that arrive there).

## Testing

### Unit tests (no Win32, via `FakeInputBackend`)

`InputRouterDispatchTests`:
- Bind PTT on X2, mute on Left → simulate X2 down → `PttStateChanged(true)` fires, no mute events. Simulate Left down → `ShortcutPressed("toggleMute")` fires, PTT state unchanged. **Proves #497 fix.**
- Bind PTT on X2 → simulate X2 down → simulate X2 up → release event with matching `IsHeld` transition.
- `ClearMouseBinding` while held → release event fires.

`InputRouterLifecycleTests`:
- Bind PTT, simulate down → `ReleaseAllHeld()` → `PttStateChanged(false)` fires, `IsHeld == false`. Second `ReleaseAllHeld` → no events (idempotent). **Proves #538 lifecycle fix.**
- `SetPttBinding` to a new key while old binding is held → release event for old binding fires before new binding becomes active.
- `SetPttBinding(null)` while held → release event, then no further events on input.

`InputRouterSuspendTests`:
- `Suspend()`, inject mouse + keyboard input → no events. **Proves #537 fix.**
- `Resume()` → registered hotkeys reactivated, `ReleaseAllHeld` implicitly invoked.
- Suspend during held PTT, release physical key during suspend, resume → state is released (not stuck).

`InputRouterJsPollDedupeTests`:
- `HandleJsPttKey(true)`, then poll release → PTT state stays true.
- `HandleJsPttKey(false)` after poll release → PTT state goes false.
- Poll down, JS never sends → PTT state true. Poll release → PTT state false.

### Migration of existing tests

`tests/Brmble.Client.Tests/Services/AudioManagerTransmissionModeTests.cs`:
- Tests covering `SetTransmissionMode` hook side-effects → move to `InputRouterDispatchTests`.
- `IsTransmissionConfigStillValid` tests → delete (the check is gone).
- Tests covering `_pttActive` state machine (debounce, silence tail, mic gating) → keep, drive via `_inputRouter.PttStateChanged` invocation rather than direct hook simulation.

### Manual verification (acceptance for #538)

- Connect with PTT configured (keyboard) → PTT inactive on arrival.
- Connect with PTT configured (mouse XButton2) → PTT inactive on arrival.
- Switch channel mid-session with PTT held → PTT inactive after switch (force release).
- Reconnect (kill server, wait, restart) → PTT inactive after reconnect.
- Hold PTT, Alt+Tab away from window, physically release key, Alt+Tab back → no stuck audio.
- Hold mouse-PTT, switch channel while holding → released.
- Bind PTT to X2 and mute to MouseLeft → both work simultaneously across full session (covers #497).
- Open settings, record a new shortcut → no actions fire while recording (#537).

## File layout

**New:**
```
src/Brmble.Client/Services/Voice/Input/
  InputRouter.cs
  IInputBackend.cs
  Win32InputBackend.cs
  MouseButton.cs

tests/Brmble.Client.Tests/Services/Input/
  InputRouterDispatchTests.cs
  InputRouterLifecycleTests.cs
  InputRouterSuspendTests.cs
  InputRouterJsPollDedupeTests.cs
  FakeInputBackend.cs
```

**Modified:**
- `src/Brmble.Client/Services/Voice/AudioManager.cs` — remove ~600 lines of input plumbing; accept events from `InputRouter`; drop `hwnd` constructor parameter.
- `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` — instantiate `InputRouter`, wire events, route `voice.connected` / `voice.disconnected` / `voice.channelJoined` / `voice.channelLeft` to `ReleaseAllHeld`. Add `input.suspend` / `input.resume` bridge handlers.
- `src/Brmble.Client/Program.cs` — `WndProc` routes `WM_HOTKEY` / `WM_INPUT` to `InputRouter` instead of `_mumbleClient.HandleHotKey` / `HandleRawInput`.
- `src/Brmble.Web/src/App.tsx` — add `window.blur` listener that sends `voice.pttKey { pressed: false }`; handle the `forced` flag from `voice.pttKey` (force-release from native side) by resetting local `pttPressed`.
- `src/Brmble.Web/src/components/OnboardingWizard/PttKeyCapture.tsx` — send `input.suspend` on mount, `input.resume` on unmount.
- `src/Brmble.Web/src/components/SettingsModal/ShortcutsSettingsTab.tsx` — send `input.suspend` on recording start, `input.resume` on commit/cancel.

**Not touched:**
- `src/Brmble.Client/Win32Window.cs` — PInvoke declarations stay as utility surface.
- `src/Brmble.Client/Services/Idle/SystemIdleTracker.cs` — different abstraction (idle query, not input dispatch).

## Rollout

One PR. Cannot be incrementally split without a feature flag, and feature-flagging input routing has its own footgun surface. Acceptable because:
- No schema migrations or user-facing data dependencies.
- Test coverage targets the regression surface explicitly.
- Three bugs fixed at once justify the one-time churn.

## Open questions

None at design time. Implementation may surface edge cases around:
- Whether `Resume()` should re-derive hotkey registrations from the last `SetShortcutBinding` snapshot or require call sites to re-issue them — current intent is the former (snapshot internally, restore on resume).
- Exact JS bridge protocol for the `forced` field in `voice.pttKey` — leaving the wire shape to implementation, but the field is documented as required so the JS side does not skip the local-state reset when native forces a release.
