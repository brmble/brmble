# Task 4 report

## Files

- Modified `src/Brmble.Client/Win32Window.cs` only for source changes.
- Added the private `MB_OK` and `MB_ICONERROR` constants.
- Added a Unicode `user32.dll` `MessageBox` declaration.
- Added `ShowStartupError(IntPtr hwnd)`, which displays the fixed startup guidance and the `%TEMP%\brmble-tls.log` path without exposing exception details or stack traces.
- Updated this report as requested.

## Tests

Command:

```text
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj -v minimal
```

Result: passed. 393 passed, 0 failed, 0 skipped.

## Self-review

- Confirmed the helper uses `Path.Combine(Path.GetTempPath(), "brmble-tls.log")`.
- Confirmed the title is `Brmble couldn't start`.
- Confirmed the message tells the user that Brmble could not finish starting, asks them to close Brmble and try again, and points to the log path.
- Confirmed the message contains no exception text or stack trace.
- Confirmed the native call uses `MB_OK | MB_ICONERROR` and Unicode marshaling.
- Confirmed no generic message-box API or unrelated source changes were added.
