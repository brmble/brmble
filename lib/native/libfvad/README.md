# libfvad — vendored

Source vendored from https://github.com/dpirch/libfvad (BSD-3-Clause). See
`COPYING-libfvad` for the full license.

## Why vendored

We ship `libfvad.dll` alongside the Brmble client. Vendoring the source
makes the build reproducible — anyone with CMake + a C compiler can rebuild
the DLL bit-for-bit (modulo PE timestamps).

## Rebuilding `libfvad.dll` (Windows x64)

Requires Visual Studio Build Tools (or full VS) and CMake >= 3.20.

```powershell
cd lib/native/libfvad
cmake -B build -A x64
cmake --build build --config Release
copy build\Release\libfvad.dll win-x64\libfvad.dll
```

(If CMake cannot auto-detect a Visual Studio generator, pass `-G "Visual Studio 18 2026"` or whichever VS version you have installed.)

After rebuilding, run the integration tests:

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter WebRtcVadTests
```

If they pass, commit `win-x64/libfvad.dll` together with whichever source/CMake
changes triggered the rebuild.

## Other architectures

Currently only `win-x64` ships. To add `win-arm64`, repeat the build with
`-A ARM64` and place the resulting DLL in `win-arm64/libfvad.dll`, then update
the `<None Include>` glob in `src/Brmble.Audio/Brmble.Audio.csproj` to copy it
based on RID.
