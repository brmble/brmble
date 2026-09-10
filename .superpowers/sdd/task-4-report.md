# Task 4 implementation report

## Scope

Implemented the requirements in `task-4-brief.md` after inspecting the current Task 3 initialization path. The implementation changed only:

- `src/Brmble.Client/Program.cs`
- `src/Brmble.Client/StartupSplashWindow.cs`
- `tests/Brmble.Client.Tests/StartupSplashWindowTests.cs`

Pre-existing unrelated untracked files (`Brmble-Server.bat` and `docs/superpowers/plans/2026-09-10-native-splash-app-ready-handoff.md`) were preserved and were not staged.

## Changes

- Simplified `StartupSplashWindow.ShowError(string)` to the zero-argument `ShowError()` API.
- Added the requested reflection regression test verifying that `ShowError` has zero parameters.
- Added idempotent `CloseWebViewController()` using `Interlocked.Exchange(ref _controller, null)`.
- Closed the controller when cancellation races with asynchronous controller creation.
- Closed the controller immediately from startup cancellation.
- Closed the controller on initialization failure before showing the native-only error state.
- Closed the controller during normal `WM_DESTROY` cleanup.
- Removed startup HTML error navigation and routed initialization failures through `ShowStartupFailure(IntPtr)`.
- Preserved the native splash error state when available, with the existing native `MessageBox` fallback when the splash cannot be created.

## TDD evidence

1. Added `ErrorSplashDoesNotRequireAnUnusedLogPathArgument` before changing production code.
2. Focused test initially failed as expected: expected 0 parameters, actual 1.
3. Changed the production API and reran the test.
4. Focused test passed: 1 passed, 0 failed.

## Verification

Focused splash/handoff tests:

```text
dotnet test tests\\Brmble.Client.Tests\\Brmble.Client.Tests.csproj --filter "FullyQualifiedName~StartupSplashWindowTests|FullyQualifiedName~StartupHandoffTests" -v minimal
Passed: 11, Failed: 0, Skipped: 0
```

Native Debug build:

```text
dotnet build src\\Brmble.Client\\Brmble.Client.csproj -c Debug --no-restore
Build succeeded.
0 Warning(s), 0 Error(s)
```

Repository hygiene:

- `git diff --check` passed.
- The commit staged exactly the three permitted files.
- No unrelated files were modified or staged.

## Commit

`f4adc2d9` — `fix: close webview on startup failure`

## Review follow-up

Addressed the Important race in the `NavigationCompleted` handler. The handler now reads `_controller` with `Volatile.Read`, returns when startup is cancelled or the controller has already been atomically cleared, and only then removes the handler from the captured controller. This prevents a queued completion from dereferencing `_controller!` after `CancelStartup` clears it. Added `NavigationCompletionChecksCancellationBeforeDereferencingController` as a focused regression assertion.

## Review follow-up TDD evidence

The new regression assertion initially failed against the pre-fix ordering:

```text
Failed NavigationCompletionChecksCancellationBeforeDereferencingController
Error Message:
Assert.IsTrue failed. A queued navigation completion must not dereference a controller cleared by cancellation.
Failed: 1, Passed: 0, Skipped: 0, Total: 1
```

After the fix, the requested focused tests passed:

```text
dotnet test tests\\Brmble.Client.Tests\\Brmble.Client.Tests.csproj --filter "FullyQualifiedName~StartupSplashWindowTests|FullyQualifiedName~StartupHandoffTests" -v minimal
Passed!  - Failed:     0, Passed:    12, Skipped:     0, Total:    12, Duration: 1 s - Brmble.Client.Tests.dll (net10.0)
```

The requested native Debug build passed:

```text
dotnet build src\\Brmble.Client\\Brmble.Client.csproj -c Debug --no-restore
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:00.69

## Review follow-up: stable controller ownership during initialization

`InitWebView2Async` now keeps the async-created `CoreWebView2Controller` in a local variable for the complete initialization sequence. The static `_controller` remains the shared cleanup slot and is still atomically cleared by `CloseWebViewController`; cancellation therefore cannot make setup, event registration, zoom restoration, bridge creation, or final navigation dereference a null static field. `StartupHandoffTests.cs` remains in scope and retains the navigation-completion regression test.

### TDD evidence

Added `WebViewInitializationUsesStableControllerReferenceAfterCreation` before the production change. The focused test failed against the pre-fix code because initialization still used `_controller` and had no `_controller = controller` local ownership assignment. After the production change, the same test passed.

### Verification

Focused regression test:

```text
dotnet test tests\\Brmble.Client.Tests\\Brmble.Client.Tests.csproj --filter "FullyQualifiedName~StartupHandoffTests.WebViewInitializationUsesStableControllerReferenceAfterCreation" -v minimal
Passed!  - Failed:     0, Passed:     1, Skipped:     0, Total:     1, Duration: 11 ms
```

Focused splash/handoff tests:

```text
dotnet test tests\\Brmble.Client.Tests\\Brmble.Client.Tests.csproj --filter "FullyQualifiedName~StartupSplashWindowTests|FullyQualifiedName~StartupHandoffTests" -v minimal
Passed!  - Failed:     0, Passed:    13, Skipped:     0, Total:    13, Duration: 1 s
```

Native Debug build:

```text
dotnet build src\\Brmble.Client\\Brmble.Client.csproj -c Debug --no-restore
Build succeeded.
    0 Warning(s)
    0 Error(s)
Time Elapsed 00:00:00.62
```
