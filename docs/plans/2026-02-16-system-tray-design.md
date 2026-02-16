# System Tray Icon Design (#11)

**Goal:** Add a system tray (notification area) icon with context menu for Show App, Mute Self, Deafen Self, and Quit.

**Approach:** Raw Win32 `Shell_NotifyIcon` P/Invoke, consistent with the app's existing architecture (no WPF/WinForms).

## Architecture

A new `TrayIcon` static class in `Brmble.Client/` wrapping `Shell_NotifyIcon`. It communicates via `WM_USER+1` callback messages in WndProc (`WM_USER+0` is already used by NativeBridge).

## Components

### `TrayIcon.cs` (new file)

P/Invoke surface:
- `Shell_NotifyIcon` (NIM_ADD, NIM_MODIFY, NIM_DELETE)
- `CreatePopupMenu`, `InsertMenu`, `CheckMenuItem`, `TrackPopupMenu`, `DestroyMenu`
- `CreateIcon` or GDI for programmatic icon generation

Public API:
- `Create(IntPtr hwnd)` — adds icon to system tray
- `UpdateState(bool muted, bool deafened)` — swaps icon and updates menu checkmarks
- `ShowContextMenu(IntPtr hwnd)` — shows the right-click popup menu
- `Destroy()` — removes icon from tray on exit

Icons (programmatically generated):
- Normal: green circle (16x16)
- Muted: yellow circle
- Deafened: red circle

Context menu items:
- Show App (default/bold)
- Mute Self (checkmark when active)
- Deafen Self (checkmark when active)
- Separator
- Quit

### Program.cs changes

WndProc additions:
- `WM_USER+1` → tray callback (right-click shows menu, double-click shows app)
- `WM_COMMAND` → routes menu item IDs to actions
- `WM_CLOSE` → `ShowWindow(SW_HIDE)` instead of destroy (minimize to tray)

SetupBridgeHandlers additions:
- Register handlers on `voice.selfMuteChanged` / `voice.selfDeafChanged` to call `TrayIcon.UpdateState()`

Lifecycle:
- `TrayIcon.Create()` after window creation in Main()
- `TrayIcon.Destroy()` in WM_DESTROY before PostQuitMessage

### Win32Window.cs additions

New P/Invoke:
- `SetForegroundWindow`
- `DestroyWindow`
- `WM_COMMAND`, `WM_LBUTTONDBLCLK`, `WM_RBUTTONUP` constants

## Data Flow

```
Tray right-click → WM_USER+1 (WM_RBUTTONUP) → TrayIcon.ShowContextMenu()
Menu click → WM_COMMAND → WndProc routes by ID:
  - Show App  → ShowWindow(SW_RESTORE) + SetForegroundWindow
  - Mute Self → bridge.Send("voice.toggleMute")
  - Deafen    → bridge.Send("voice.toggleDeaf")
  - Quit      → DestroyWindow (actual exit)

State sync back:
  voice.selfMuteChanged → TrayIcon.UpdateState(muted, deafened)
  voice.selfDeafChanged → TrayIcon.UpdateState(muted, deafened)
```

## Close-to-Tray Behavior

- Close button (X) → hides window to tray (ShowWindow SW_HIDE)
- Double-click tray icon → restores window (ShowWindow SW_RESTORE + SetForegroundWindow)
- "Show App" menu → same as double-click
- "Quit" menu → DestroyWindow → WM_DESTROY → TrayIcon.Destroy() → PostQuitMessage
