# Window State Persistence Design

**Date:** 2026-02-20
**Branch:** impl/settings-persistence

## Goal

Persist window size, position, and maximized state across sessions so Brmble reopens exactly where the user left it, including on the correct monitor. If the saved monitor is no longer available, fall back gracefully to OS-default placement.

## Data Model

A new `WindowState` record is added to `src/Brmble.Client/Services/AppConfig/AppSettings.cs` (alongside the existing settings records):

```csharp
public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
```

It is stored as a nullable top-level field in `AppConfigService`'s internal `ConfigData` record. `null` means no state has been saved yet — the OS default placement is used.

`AppConfigService` gains two new public methods:

```csharp
WindowState? GetWindowState();
void SaveWindowState(WindowState state);
```

## Save Logic

`WM_DESTROY` in `WndProc` (Program.cs) triggers a save. `GetWindowPlacement` is used rather than `GetWindowRect` because it returns the *restored* (non-maximized) rect alongside the current show state. This ensures that closing while maximized saves a sensible normal-size rect so the window restores to the right dimensions when unmaximized later.

## Restore Logic

`AppConfigService` is initialized in `Main()` (before `Win32Window.Create()`) instead of inside `InitWebView2Async`. It is pure synchronous file I/O so no thread-affinity issues arise.

Before creating the window:

1. Read `WindowState?` from `AppConfigService`.
2. If null → use `CW_USEDEFAULT` position and `1280×720` size (existing behaviour).
3. If non-null → validate using `MonitorFromPoint` on the center of the saved rect with `MONITOR_DEFAULTTONULL`. If no monitor is found (screen disconnected), fall back to `CW_USEDEFAULT` / `1280×720`.
4. Create the window at the resolved position and size.
5. If `IsMaximized` is true → call `ShowWindow(SW_MAXIMIZE)` immediately after creation.

## Win32 additions (Win32Window.cs)

Two new P/Invoke declarations:

- `GetWindowPlacement` — retrieves restored bounds and show state.
- `MonitorFromPoint` — validates that a point falls on a connected monitor (`MONITOR_DEFAULTTONULL` flag).

## Testing

One new automated test added to `AppConfigServiceTests`:

- `SavesAndReloads_WindowState` — writes a `WindowState`, constructs a fresh `AppConfigService` from the same directory, asserts all fields round-trip correctly.

Monitor validation and `SetWindowPos` paths are Win32-dependent and verified via manual smoke test.
