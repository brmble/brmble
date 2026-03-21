# RNNoise Noise Cancellation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate RNNoise noise cancellation into the audio pipeline via P/Invoke, matching how original Mumble uses it, with a selection dropdown in Options > Audio > Transmission to choose between None/RNNoise/GTCRN.

**Architecture:** A new `RnnoiseService` wraps the native `renamenoise.dll` via P/Invoke. `AudioManager` calls it in `OnMicData` on 480-sample chunks (48kHz) before the existing GTCRN speech enhancement. Settings flow through the existing `AppSettings` → `MumbleAdapter.ApplySettings` → `AudioManager.ConfigureRnnoise` path. The UI provides a dropdown with three options: None, RNNoise, and GTCRN.

**Tech Stack:** C# P/Invoke (native `renamenoise.dll`), React/TypeScript dropdown in `AudioSettingsTab.tsx`, existing `AppSettings` JSON persistence via `System.Text.Json`.

---

## Context: How original Mumble uses RNNoise

From `AudioInput.cpp`:
```cpp
// RNNoise requires exactly 480 float samples at 48kHz
float denoiseFrames[480];
for (unsigned int i = 0; i < 480; i++) {
    denoiseFrames[i] = psSource[i];  // raw short value as float (e.g. -3000.0)
}
rnnoise_process_frame(denoiseState, denoiseFrames, denoiseFrames);  // in-place
for (unsigned int i = 0; i < 480; i++) {
    psSource[i] = clampFloatSample(denoiseFrames[i]);
}
```

Note: floats are in raw short range (~-32768 to 32767), NOT normalized to [-1,1].

The C API:
```c
DenoiseState* rnnoise_create(RNNModel* model);  // model=NULL uses built-in
void rnnoise_destroy(DenoiseState* st);
float rnnoise_process_frame(DenoiseState* st, float* out, const float* in);
```

---

## Prerequisite: `renamenoise.dll`

> **Note:** The original Mumble client named this DLL `ReNameNoise.dll` (capital R, N, N) to avoid symbol clashes with Opus. In recent Mumble versions (1.4+), they've replaced it with RNNoise v0.2 which no longer has those symbol issues. Mumble bundled `ReNameNoise.dll` in its installer and placed it in the application directory alongside the main executable.

Before the code compiles and runs, `renamenoise.dll` (Windows x64) must be available. Obtain a pre-built binary from the RNNoise project or build from source. Place it at:

```
src/Brmble.Client/native/renamenoise.dll
```

Without the DLL the app still builds; `RnnoiseService` will catch `DllNotFoundException` and disable itself.

---

## Task 1: Add `SpeechDenoiseSettings` to `AppSettings`

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

**Step 1: Add the enum and record**

In `AppSettings.cs`, after the `SpeechEnhancementSettings` record, add:

```csharp
public enum SpeechDenoiseMode
{
    None,
    Rnnoise,
    Gtcrn
}

public record SpeechDenoiseSettings(SpeechDenoiseMode Mode = SpeechDenoiseMode.None);
```

**Step 2: Add to `AppSettings`**

In the `AppSettings` record, add the new field after `SpeechEnhancementSettings? SpeechEnhancement = null`:

```csharp
SpeechDenoiseSettings? SpeechDenoise = null
```

Add the null-coalescing init property inside the record body, after the existing `SpeechEnhancement` property:

```csharp
public SpeechDenoiseSettings SpeechDenoise { get; init; } = SpeechDenoise ?? new SpeechDenoiseSettings();
```

**Step 3: Run existing tests**

```
dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj
```

Expected: all pass (new field is optional, backward-compatible JSON).

**Step 4: Commit**

```
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add SpeechDenoiseSettings (None/RNNoise/GTCRN) to AppSettings"
```

---

## Task 2: Write `RnnoiseService`

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`

**Step 1: Write the test first**

Create `tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs`:

```csharp
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

public class RnnoiseServiceTests
{
    [Fact]
    public void IsEnabled_ReturnsFalse_WhenDisabled()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.None);
        Assert.False(service.IsEnabled);
    }

    [Fact]
    public void IsEnabled_ReturnsTrue_WhenRnnoiseMode()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        Assert.True(service.IsEnabled);
    }

    [Fact]
    public void Constructor_DoesNotThrow_WhenDisabledAndNoDll()
    {
        // Should not throw DllNotFoundException when mode is None
        var ex = Record.Exception(() =>
        {
            using var service = new RnnoiseService(SpeechDenoiseMode.None);
        });
        Assert.Null(ex);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var service = new RnnoiseService(SpeechDenoiseMode.None);
        service.Dispose();
        var ex = Record.Exception(() => service.Dispose());
        Assert.Null(ex);
    }
}
```

**Step 2: Run test to confirm it fails**

```
dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests"
```

Expected: compile error — `RnnoiseService` does not exist yet.

**Step 3: Implement `RnnoiseService`**

Create `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`:

```csharp
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.SpeechEnhancement;

/// <summary>
/// Wraps the native RNNoise library (renamenoise.dll) for per-frame noise suppression.
/// Matches the integration used by original Mumble (AudioInput.cpp).
/// 
/// RNNoise requirements:
/// - 48 kHz sample rate
/// - Exactly 480 samples per frame (10 ms)
/// - Float samples in raw short range (~-32768 to 32767), NOT normalized to [-1, 1]
/// </summary>
public sealed class RnnoiseService : IDisposable
{
    private const string DllName = "renamenoise";
    public const int FrameSize = 480; // RNNoise requires exactly 480 samples at 48kHz

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr rnnoise_create(IntPtr model);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern void rnnoise_destroy(IntPtr st);

    [DllImport(DllName, CallingConvention = CallingConvention.Cdecl)]
    private static extern float rnnoise_process_frame(IntPtr st, float[] output, float[] input);

    private IntPtr _state = IntPtr.Zero;
    private bool _disposed;

    public bool IsEnabled { get; private set; }

    public RnnoiseService(SpeechDenoiseMode mode)
    {
        if (mode != SpeechDenoiseMode.Rnnoise)
        {
            IsEnabled = false;
            return;
        }

        try
        {
            _state = rnnoise_create(IntPtr.Zero);
            IsEnabled = _state != IntPtr.Zero;
            if (!IsEnabled)
                Console.Error.WriteLine("[RNNoise] rnnoise_create returned null — noise cancellation disabled.");
        }
        catch (DllNotFoundException ex)
        {
            Console.Error.WriteLine($"[RNNoise] renamenoise.dll not found — noise cancellation disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[RNNoise] Failed to initialize — noise cancellation disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
    }

    /// <summary>
    /// Process exactly <see cref="FrameSize"/> (480) samples in-place.
    /// Input and output floats are in raw short range (~-32768 to 32767).
    /// No-op if not enabled or state is invalid.
    /// </summary>
    public void ProcessFrame(float[] buffer, int offset = 0)
    {
        if (!IsEnabled || _state == IntPtr.Zero || buffer.Length - offset < FrameSize)
            return;

        // RNNoise processes in-place: copy out, process, copy back
        var input = new float[FrameSize];
        Array.Copy(buffer, offset, input, 0, FrameSize);
        var output = new float[FrameSize];

        rnnoise_process_frame(_state, output, input);

        Array.Copy(output, 0, buffer, offset, FrameSize);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_state != IntPtr.Zero)
        {
            rnnoise_destroy(_state);
            _state = IntPtr.Zero;
        }
    }
}
```

**Step 4: Run tests**

```
dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests"
```

Expected: all 4 tests pass.

**Step 5: Commit**

```
git add src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs
git add tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs
git commit -m "feat: add RnnoiseService P/Invoke wrapper"
```

---

## Task 3: Integrate RNNoise into `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Add field and `ConfigureRnnoise` method**

After the `_speechEnhancement` field (line ~215):

```csharp
// RNNoise noise cancellation
private RnnoiseService? _rnnoise;
```

After `ConfigureSpeechEnhancement` method (~line 336):

```csharp
public void ConfigureRnnoise(SpeechDenoiseMode mode)
{
    lock (_lock)
    {
        _rnnoise?.Dispose();
        _rnnoise = new RnnoiseService(mode);
    }
}
```

**Step 2: Add DLL copy to `.csproj`**

In `src/Brmble.Client/Brmble.Client.csproj`, add inside the `<Project>` element:

```xml
<ItemGroup>
  <Content Include="native\renamenoise.dll" Condition="Exists('native\renamenoise.dll')">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </Content>
</ItemGroup>
```

Create the `native/` directory placeholder (even if the DLL isn't yet present the build won't fail due to the `Condition`):

```
mkdir src/Brmble.Client/native
```

**Step 3: Call `ProcessFrame` in `OnMicData`**

In `OnMicData`, after AGC and input volume, before GTCRN (find the comment `// Apply speech enhancement if enabled`), add the RNNoise block:

```csharp
// Apply RNNoise noise cancellation if enabled
if (_rnnoise?.IsEnabled == true)
{
    try
    {
        int sampleCount = e.BytesRecorded / 2;
        // Convert int16 bytes → float (raw short range, matching Mumble's approach)
        var floatBuf = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            floatBuf[i] = (short)(e.Buffer[i * 2] | (e.Buffer[i * 2 + 1] << 8));

        // Process in 480-sample chunks (RNNoise requirement)
        for (int offset = 0; offset + RnnoiseService.FrameSize <= sampleCount; offset += RnnoiseService.FrameSize)
            _rnnoise.ProcessFrame(floatBuf, offset);

        // Convert float → int16 bytes
        for (int i = 0; i < sampleCount; i++)
        {
            var s = (short)Math.Clamp(floatBuf[i], short.MinValue, short.MaxValue);
            e.Buffer[i * 2]     = (byte)(s & 0xFF);
            e.Buffer[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
    }
    catch (Exception ex)
    {
        AudioLog.Write($"[Audio] RNNoise error, disabling: {ex.Message}");
        _rnnoise = null;
    }
}
```

Add the `using` at the top of `AudioManager.cs`:

```csharp
using Brmble.Client.Services.SpeechEnhancement;
```

(Already present — `SpeechEnhancement` namespace is already imported at line 4.)

**Step 4: Dispose in `Dispose()`**

In the `Dispose()` method of `AudioManager` (near the end of the file), add:

```csharp
_rnnoise?.Dispose();
```

**Step 5: Build**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: builds cleanly (no new errors).

**Step 6: Commit**

```
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git add src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: integrate RNNoise into AudioManager audio pipeline"
```

---

## Task 4: Wire RNNoise into `MumbleAdapter.ApplySettings`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add change-tracking field**

After `_lastSpeechEnhancementModel` (line ~579):

```csharp
private SpeechDenoiseMode _lastSpeechDenoiseMode = SpeechDenoiseMode.None;
```

**Step 2: Call `ConfigureRnnoise` in `ApplySettings`**

After the `ConfigureSpeechEnhancement` block (after line ~611), add:

```csharp
// Only reinitialise RNNoise when its mode changes.
var denoiseMode = settings.SpeechDenoise.Mode;
if (denoiseMode != _lastSpeechDenoiseMode)
{
    _lastSpeechDenoiseMode = denoiseMode;
    _audioManager?.ConfigureRnnoise(denoiseMode);
}
```

Also reset `_lastSpeechDenoiseMode` in the connection setup (find where `_lastSpeechEnhancementEnabled = false` is set, line ~217):

```csharp
_lastSpeechDenoiseMode = SpeechDenoiseMode.None;
```

**Step 3: Build**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: builds cleanly.

**Step 4: Commit**

```
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: wire RNNoise enable/disable through MumbleAdapter.ApplySettings"
```

---

## Task 5: Add `SpeechDenoiseSettings` to TypeScript and `SettingsModal`

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add TypeScript types to `AudioSettingsTab.tsx`**

After the `SpeechEnhancementSettings` interface (line ~34):

```tsx
export type SpeechDenoiseMode = 'none' | 'rnnoise' | 'gtcrn';

export interface SpeechDenoiseSettings {
  mode: SpeechDenoiseMode;
}

export const DEFAULT_SPEECH_DENOISE: SpeechDenoiseSettings = {
  mode: 'none',
};
```

**Step 2: Add props to `AudioSettingsTabProps`**

In the `AudioSettingsTabProps` interface (lines 8–15), add:

```tsx
speechDenoise: SpeechDenoiseSettings;
onSpeechDenoiseChange: (settings: SpeechDenoiseSettings) => void;
```

**Step 3: Add dropdown to UI**

In `AudioSettingsTab.tsx`, after the Speech Enhancement toggle (after line ~248, the closing `</div>` of that toggle), add the Speech Denoise dropdown:

```tsx
<div className="settings-item">
  <label>
    Noise Cancellation
    <span
      className="tooltip-icon"
      data-tooltip="Reduces background noise. RNNoise is lightweight; GTCRN is more aggressive but uses more CPU."
    >?</span>
  </label>
  <select
    className="brmble-select"
    value={speechDenoise.mode}
    onChange={(e) => onSpeechDenoiseChange({ ...speechDenoise, mode: e.target.value as SpeechDenoiseMode })}
  >
    <option value="none">None</option>
    <option value="rnnoise">RNNoise</option>
    <option value="gtcrn">GTCRN</option>
  </select>
</div>
```

Destructure `speechDenoise` and `onSpeechDenoiseChange` from props in the component signature:

```tsx
export function AudioSettingsTab({ settings, speechEnhancement, onChange, onSpeechEnhancementChange, speechDenoise, onSpeechDenoiseChange, allBindings, onClearBinding }: AudioSettingsTabProps) {
```

**Step 4: Update `SettingsModal.tsx`**

In `SettingsModal.tsx`:

1. Import `SpeechDenoiseSettings` and `DEFAULT_SPEECH_DENOISE`:

```tsx
import { AudioSettingsTab, type AudioSettings, type SpeechEnhancementSettings, type SpeechDenoiseSettings, DEFAULT_SETTINGS as DEFAULT_AUDIO, DEFAULT_SPEECH_ENHANCEMENT, DEFAULT_SPEECH_DENOISE } from './AudioSettingsTab';
```

2. Add `speechDenoise` to the `AppSettings` interface (around line 42):

```tsx
speechDenoise: SpeechDenoiseSettings;
```

3. Add to `DEFAULT_SETTINGS` (around line 54):

```tsx
speechDenoise: DEFAULT_SPEECH_DENOISE,
```

4. Add handler after `handleSpeechEnhancementChange` (around line 214):

```tsx
const handleSpeechDenoiseChange = (speechDenoise: SpeechDenoiseSettings) => {
  const newSettings = { ...settings, speechDenoise };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
};
```

5. Pass the new props to `<AudioSettingsTab>` (around line 278):

```tsx
{activeTab === 'audio' && (
  <AudioSettingsTab
    settings={settings.audio}
    onChange={handleAudioChange}
    speechEnhancement={settings.speechEnhancement}
    onSpeechEnhancementChange={handleSpeechEnhancementChange}
    speechDenoise={settings.speechDenoise}
    onSpeechDenoiseChange={handleSpeechDenoiseChange}
    allBindings={allBindings}
    onClearBinding={handleClearBinding}
  />
)}
```

**Step 5: Build frontend**

```
cd src/Brmble.Web && npm run build
```

Expected: builds cleanly (no TypeScript errors).

**Step 6: Commit**

```
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: add RNNoise toggle to Audio settings UI"
```

---

## Task 6: Add `AppSettings` backward-compatibility test

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Add test**

Open `AppConfigServiceTests.cs` and add a test verifying that JSON without the `speechDenoise` key deserializes with the default (`Mode = SpeechDenoiseMode.None`):

```csharp
[Fact]
public void Settings_SpeechDenoiseDefaults_WhenMissingFromJson()
{
    // Arrange: config JSON without speechDenoise field (existing saved config)
    var dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    Directory.CreateDirectory(dir);
    var configPath = Path.Combine(dir, "config.json");
    File.WriteAllText(configPath, """
    {
      "servers": [],
      "settings": {
        "audio": {
          "inputDevice": "default",
          "outputDevice": "default",
          "inputVolume": 250,
          "maxAmplification": 100,
          "outputVolume": 250,
          "transmissionMode": "voiceActivity",
          "pushToTalkKey": null,
          "opusBitrate": 72000,
          "opusFrameSize": 20
        },
        "shortcuts": {},
        "messages": { "ttsEnabled": false, "ttsVolume": 100, "notificationsEnabled": true },
        "overlay": { "overlayEnabled": false }
      }
    }
    """);

    // Act
    var service = new AppConfigService(dir);
    var loaded = service.GetSettings();

    // Assert
    Assert.Equal(SpeechDenoiseMode.None, loaded.SpeechDenoise.Mode);
}
```

Make sure `AppConfigService` constructor is `internal` and accessible from tests (it already has `internal AppConfigService(string dir)` — this works because the test project references the client project directly).

**Step 2: Run test**

```
dotnet test tests/Brmble.Client.Tests/ --filter "Settings_RnnoiseDefaults_WhenMissingFromJson"
```

Expected: PASS.

**Step 3: Commit**

```
git add tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "test: verify SpeechDenoiseSettings backward-compatibility with existing saved configs"
```

---

## Task 7: Full test run and build verification

**Step 1: Run all tests**

```
dotnet test
```

Expected: all pass.

**Step 2: Build frontend**

```
cd src/Brmble.Web && npm run build
```

Expected: clean build, no TypeScript errors.

**Step 3: Build client**

```
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: clean build.

---

## Notes for the implementer

- `renamenoise.dll` (or `ReNameNoise.dll` to match original Mumble naming) must be placed at `src/Brmble.Client/native/renamenoise.dll` for the app to use it. Without it the service gracefully disables itself.
- RNNoise only supports 48kHz 10ms frames (480 samples). If the mic frame size changes (e.g. 10ms = 480 samples), the inner loop `offset + 480 <= sampleCount` handles all sizes cleanly.
- The floats passed to RNNoise are in raw short range (`-32768` to `32767`) — **not** normalized. This matches Mumble exactly.
- RNNoise runs before GTCRN in the pipeline when both are selected (though UI prevents this case).
- The UI dropdown allows selecting None/RNNoise/GTCRN — only one denoise mode should be active at a time.
