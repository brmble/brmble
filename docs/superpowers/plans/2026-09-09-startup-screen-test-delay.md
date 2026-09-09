# Startup Screen Test Delay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in five-second loading-screen preview to the local launcher without delaying normal Brmble startup.

**Architecture:** The native client reads an optional environment variable after it navigates the loading startup page and awaits the requested test delay before continuing initialization. The batch launcher exposes separate normal, loading-preview, and failure-preview choices; only the loading-preview branch sets the variable.

**Tech Stack:** C#/.NET 10 Win32 client, Windows batch script.

## Global Constraints

- The delay is opt-in and must not affect normal startup when `BRMBLE_STARTUP_DELAY_SECONDS` is absent.
- The launcher’s loading-preview delay is exactly 5 seconds.
- The existing failure-screen test remains available.
- The batch launcher restores any temporarily renamed file after the failure test.

---

### Task 1: Add an opt-in native startup delay

**Files:**
- Modify: `src/Brmble.Client/Program.cs`

- [ ] **Step 1: Add the test-only delay helper**

Add a private helper near `InitWebView2Async`:

```csharp
private static async Task ApplyStartupTestDelayAsync()
{
    var raw = Environment.GetEnvironmentVariable("BRMBLE_STARTUP_DELAY_SECONDS");
    if (!int.TryParse(raw, out var seconds) || seconds <= 0)
        return;

    await Task.Delay(TimeSpan.FromSeconds(Math.Min(seconds, 30)));
}
```

- [ ] **Step 2: Invoke it after loading-page navigation**

Immediately after the loading navigation call and before bridge/service initialization, add:

```csharp
await ApplyStartupTestDelayAsync();
```

- [ ] **Step 3: Verify the native project**

Run:

```text
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v minimal
dotnet build src/Brmble.Client/Brmble.Client.csproj -c Debug
```

Expected: all client tests pass and the build has zero errors.

- [ ] **Step 4: Commit**

```text
git add src/Brmble.Client/Program.cs
git commit -m "test: support startup screen preview delay"
```

### Task 2: Expose loading and failure previews in the launcher

**Files:**
- Modify: `Brmble-Run.bat`

- [ ] **Step 1: Add a three-choice launcher menu**

Use choices `N`, `L`, and `F` for normal, loading preview, and failure preview. Keep the existing build steps before the menu.

- [ ] **Step 2: Add the five-second loading preview**

The loading branch must set:

```bat
set "BRMBLE_STARTUP_DELAY_SECONDS=5"
```

Then launch the already-built client with `dotnet run --no-build --project "%ROOT%src\Brmble.Client\Brmble.Client.csproj" -c Debug`, preserving the exit code and pausing before closing.

- [ ] **Step 3: Preserve the failure preview**

The failure branch must temporarily move packaged `index.html` to `index.html.disabled`, launch the already-built client without rebuilding, restore the file afterward, print the exit code, and pause.

- [ ] **Step 4: Verify launcher inputs**

Confirm that `src\Brmble.Client\bin\Debug\net10.0-windows\Brmble.Client.exe` and `web\startup.html` exist after the build, and that the normal branch does not set `BRMBLE_STARTUP_DELAY_SECONDS`.

- [ ] **Step 5: Commit**

```text
git add Brmble-Run.bat
git commit -m "test: add startup screen preview launcher"
```
