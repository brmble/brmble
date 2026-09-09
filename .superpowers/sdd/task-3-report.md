# Task 3 report

## Implemented

- Added `src/Brmble.Client/StartupPageUri.cs`.
- Added internal `StartupPageState` with `Loading` and `Error` values.
- Added internal `StartupPageUri.Build(bool useDevServer, string devServerUrl, StartupPageState state)`.
- Dev-server URIs trim all trailing `/` characters before appending `/startup.html`.
- Packaged URIs use `https://brmble.local` through `WebViewCacheConfig.VirtualHost`.
- The helper appends exactly `?state=error` only for `StartupPageState.Error`.
- Added `tests/Brmble.Client.Tests/StartupPageUriTests.cs` with coverage for dev loading, trailing-slash trimming, packaged loading, and packaged error.

## TDD evidence

- RED: `dotnet test tests\Brmble.Client.Tests\Brmble.Client.Tests.csproj --filter "FullyQualifiedName~StartupPageUriTests" -v minimal` failed to compile because `StartupPageUri` and `StartupPageState` did not exist.
- GREEN: the same focused test command passed with 4/4 tests.

## Verification

- Full client test project: `dotnet test tests\Brmble.Client.Tests\Brmble.Client.Tests.csproj -v minimal`
- Result: 393 passed, 0 failed, 0 skipped.

## Commit

Task 3 changes were committed after verification.
