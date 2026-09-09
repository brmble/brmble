# Native Compact Splash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-window WebView startup page with a compact native splash while the main Brmble window initializes.

**Architecture:** Add a focused native `StartupSplashWindow` responsible only for creating, painting, animating, and closing the compact splash. Program creates it before the main window, keeps the main window hidden while WebView/native services initialize, then closes the splash and shows the main window after successful main navigation. Existing WebView startup HTML remains available as a fallback/error surface but is no longer the primary splash.

**Tech Stack:** C#/.NET 10 Win32, GDI/GDI+, existing theme resources, MSTest.

## Global Constraints

- Splash is approximately 360×240 pixels and centered on the active monitor.
- Splash must not create a WebView2 control.
- Main window is hidden until the main UI is ready.
- Normal startup has no artificial delay; `BRMBLE_STARTUP_DELAY_SECONDS` remains test-only.
- Splash errors do not expose exception text or stack traces.

---

### Task 1: Add the focused native splash window

**Files:**
- Create: `src/Brmble.Client/StartupSplashWindow.cs`
- Modify: `src/Brmble.Client/Brmble.Client.csproj`

Create an internal class with a clear lifecycle: `Show(string theme)`, `Close()`, and `ShowError(string logPath)`. Use a borderless top-level Win32 window, center it using the work area of the primary monitor, set a theme-matched background using `ThemeColors.GetBgDeep`, and paint a compact Brmble mark using an existing packaged theme PNG (falling back to the application icon if needed). The loading state should repaint with a subtle timer-driven pulse; stop the timer for the error state. Respect `SystemParametersInfo(SPI_GETCLIENTAREAANIMATION)` or an equivalent Windows animation setting before animating. Keep all P/Invoke and handles private to this class.

Add only the resources needed for the splash image to the client output through the existing resource-copy convention. Avoid WebView2 references and avoid modifying existing logo components.

Run the client tests and Debug build, then commit.

### Task 2: Integrate splash lifecycle with native startup

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

Create/show the splash before creating the main Brmble window. Create the main window hidden, continue existing WebView2/native initialization behind the splash, and show the main window plus close the splash only after the intended main navigation completes successfully. On initialization failure, keep the splash visible and show its static error state; if the splash cannot be created, retain the existing native fallback dialog. Ensure WM_CLOSE during splash/startup closes the splash/client cleanly and does not route to React. Preserve the existing close preference once `_mainUiReady` is true.

Keep startup test delay after splash display so the launcher’s `L` option visibly previews the compact splash. Keep startup HTML navigation only as a lightweight WebView fallback if it is still needed by the existing initialization path; the user-facing primary surface must be the native compact splash.

Run all client tests, web tests/build, and native Debug build. Confirm the packaged output still contains `startup.html`. Commit.

### Task 3: End-to-end verification and launcher wording

**Files:**
- Modify: `Brmble-Run.bat` only if labels/help text need updating.

Verify `N` normal launch, `L` five-second loading preview, and `F` failure preview. Confirm `L` shows a compact centered native splash and then opens the main client, while `F` shows a compact static error state and restores `index.html`. Update launcher text only if necessary to describe the native compact splash accurately. Run final web/client checks and `git diff --check`.
