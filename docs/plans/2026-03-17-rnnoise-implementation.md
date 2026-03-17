# RNNoise Noise Suppression Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add RNNoise as an alternative noise suppression option in Options > Audio > Noise Suppression, replacing the existing Speech Enhancement toggle with a dropdown (None/RNNoise/GTCRN), defaulting to RNNoise.

**Architecture:** New `RnnoiseService` wraps native `renamenoise.dll` via P/Invoke. `AudioManager` calls it on 480-sample chunks (48kHz) before existing GTCRN processing. Settings flow through `AppSettings` → `MumbleAdapter.ApplySettings` → `AudioManager.ConfigureRnnoise` path.

**Tech Stack:** C# P/Invoke (native `renamenoise.dll`), React/TypeScript dropdown in `AudioSettingsTab.tsx`, existing `AppSettings` JSON persistence via `System.Text.Json`.

---

## Task 1: Add `SpeechDenoiseSettings` to `AppSettings`

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

**Step 1: Add enum and record**

In `AppSettings.cs`, after the `SpeechEnhancementSettings` record, add:

```csharp
public enum SpeechDenoiseMode
{
    None,
    Rnnoise,
    Gtcrn
}

public record SpeechDenoiseSettings(SpeechDenoiseMode Mode = SpeechDenoiseMode.Rnnoise);
```

**Step 2: Add to AppSettings record**

Add the field after `SpeechEnhancementSettings? SpeechEnhancement = null`:

```csharp
SpeechDenoiseSettings? SpeechDenoise = null
```

Add the init property after the existing `SpeechEnhancement` property:

```csharp
public SpeechDenoiseSettings SpeechDenoise { get; init; } = SpeechDenoise ?? new SpeechDenoiseSettings();
```

**Step 3: Run existing tests**

Run: `dotnet test tests/Brmble.Client.Tests/Brmble.Client.Tests.csproj`
Expected: all pass

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add SpeechDenoiseSettings (None/RNNoise/GTCRN) to AppSettings"
```

---

## Task 2: Write `RnnoiseService` P/Invoke wrapper

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`
- Create: `tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs`

**Step 1: Write the test first**

Create test file with these tests:
- `IsEnabled_ReturnsFalse_WhenDisabled` - mode is None
- `IsEnabled_ReturnsTrue_WhenRnnoiseMode` - mode is Rnnoise
- `Constructor_DoesNotThrow_WhenDisabledAndNoDll` - no DllNotFoundException when mode is None
- `Dispose_IsIdempotent` - double dispose doesn't throw

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests"`
Expected: compile error — RnnoiseService doesn't exist

**Step 3: Implement `RnnoiseService`**

Create `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`:

```csharp
using System.Runtime.InteropServices;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class RnnoiseService : IDisposable
{
    private const string DllName = "renamenoise";
    public const int FrameSize = 480;

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
                Console.Error.WriteLine("[RNNoise] rnnoise_create returned null — disabled.");
        }
        catch (DllNotFoundException ex)
        {
            Console.Error.WriteLine($"[RNNoise] renamenoise.dll not found — disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[RNNoise] Failed to initialize — disabled. Details: {ex.Message}");
            IsEnabled = false;
        }
    }

    public void ProcessFrame(float[] buffer, int offset = 0)
    {
        if (!IsEnabled || _state == IntPtr.Zero || buffer.Length - offset < FrameSize)
            return;

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

Run: `dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests"`
Expected: all 4 tests pass

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs
git add tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs
git commit -m "feat: add RnnoiseService P/Invoke wrapper"
```

---

## Task 3: Integrate RNNoise into `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`
- Modify: `src/Brmble.Client/Brmble.Client.csproj`

**Step 1: Add field and ConfigureRnnoise method**

After `_speechEnhancement` field (~line 215):

```csharp
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

**Step 2: Add DLL copy to csproj**

In `Brmble.Client.csproj`, add:

```xml
<ItemGroup>
  <Content Include="native\renamenoise.dll" Condition="Exists('native\renamenoise.dll')">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </Content>
</ItemGroup>
```

Create placeholder directory: `mkdir src/Brmble.Client/native`

**Step 3: Call ProcessFrame in OnMicData**

In `OnMicData`, after AGC and input volume, before GTCRN comment `// Apply speech enhancement if enabled`, add:

```csharp
// Apply RNNoise noise cancellation if enabled
if (_rnnoise?.IsEnabled == true)
{
    try
    {
        int sampleCount = e.BytesRecorded / 2;
        var floatBuf = new float[sampleCount];
        for (int i = 0; i < sampleCount; i++)
            floatBuf[i] = (short)(e.Buffer[i * 2] | (e.Buffer[i * 2 + 1] << 8));

        for (int offset = 0; offset + RnnoiseService.FrameSize <= sampleCount; offset += RnnoiseService.FrameSize)
            _rnnoise.ProcessFrame(floatBuf, offset);

        for (int i = 0; i < sampleCount; i++)
        {
            var s = (short)Math.Clamp(floatBuf[i], short.MinValue, short.MaxValue);
            e.Buffer[i * 2] = (byte)(s & 0xFF);
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

**Step 4: Dispose in Dispose method**

Add in `Dispose()`:

```csharp
_rnnoise?.Dispose();
```

**Step 5: Build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: builds cleanly

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git add src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: integrate RNNoise into AudioManager audio pipeline"
```

---

## Task 4: Wire RNNoise into `MumbleAdapter.ApplySettings`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add change-tracking field**

After `_lastSpeechEnhancementModel` (~line 579):

```csharp
private SpeechDenoiseMode _lastSpeechDenoiseMode = SpeechDenoiseMode.Rnnoise;
```

**Step 2: Call ConfigureRnnoise in ApplySettings**

After `ConfigureSpeechEnhancement` block (~line 611):

```csharp
var denoiseMode = settings.SpeechDenoise.Mode;
if (denoiseMode != _lastSpeechDenoiseMode)
{
    _lastSpeechDenoiseMode = denoiseMode;
    _audioManager?.ConfigureRnnoise(denoiseMode);
}
```

Also reset in connection setup (where `_lastSpeechEnhancementEnabled = false` is set, ~line 217):

```csharp
_lastSpeechDenoiseMode = SpeechDenoiseMode.None;
```

**Step 3: Build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: builds cleanly

**Step 4: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: wire RNNoise through MumbleAdapter.ApplySettings"
```

---

## Task 5: Add SpeechDenoiseSettings to TypeScript and UI

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Add TypeScript types to AudioSettingsTab.tsx**

After `SpeechEnhancementSettings` interface (~line 34):

```tsx
export type SpeechDenoiseMode = 'none' | 'rnnoise' | 'gtcrn';

export interface SpeechDenoiseSettings {
  mode: SpeechDenoiseMode;
}

export const DEFAULT_SPEECH_DENOISE: SpeechDenoiseSettings = {
  mode: 'rnnoise',
};
```

**Step 2: Add props to AudioSettingsTabProps**

Add to interface:

```tsx
speechDenoise: SpeechDenoiseSettings;
onSpeechDenoiseChange: (settings: SpeechDenoiseSettings) => void;
```

Update component signature to destructure the new props.

**Step 3: Replace Speech Enhancement toggle with Noise Suppression dropdown**

Replace the Speech Enhancement toggle (lines ~232-245) with:

```tsx
<div className="settings-item">
  <label>
    Noise Suppression
    <span className="tooltip-icon" data-tooltip="Reduces background noise. RNNoise is lightweight; GTCRN is more aggressive but uses more CPU.">?</span>
  </label>
  <Select
    value={speechDenoise.mode}
    onChange={(v) => onSpeechDenoiseChange({ ...speechDenoise, mode: v as SpeechDenoiseMode })}
    options={[
      { value: 'none', label: 'None' },
      { value: 'rnnoise', label: 'RNNoise' },
      { value: 'gtcrn', label: 'GTCRN' },
    ]}
  />
</div>
```

Remove the old Speech Enhancement toggle and its props (onSpeechEnhancementChange, speechEnhancement).

**Step 4: Update SettingsModal.tsx**

1. Import: Add `SpeechDenoiseSettings` and `DEFAULT_SPEECH_DENOISE`
2. Add `speechDenoise` to `AppSettings` interface
3. Add `speechDenoise: DEFAULT_SPEECH_DENOISE` to DEFAULT_SETTINGS
4. Add handler `handleSpeechDenoiseChange`
5. Pass to AudioSettingsTab (remove speechEnhancement props)

**Step 5: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: builds cleanly

**Step 6: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: add Noise Suppression dropdown to Audio settings UI"
```

---

## Task 6: Backward-compatibility test

**Files:**
- Modify: `tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs`

**Step 1: Add test**

Add test verifying JSON without `speechDenoise` defaults to `SpeechDenoiseMode.Rnnoise`:

```csharp
[Fact]
public void Settings_SpeechDenoiseDefaults_WhenMissingFromJson()
{
    var dir = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
    Directory.CreateDirectory(dir);
    var configPath = Path.Combine(dir, "config.json");
    File.WriteAllText(configPath, """
    {
      "servers": [],
      "settings": {
        "audio": { "inputDevice": "default", "outputDevice": "default", "inputVolume": 250, "maxAmplification": 100, "outputVolume": 250, "transmissionMode": "voiceActivity", "pushToTalkKey": null, "opusBitrate": 72000, "opusFrameSize": 20 },
        "shortcuts": {},
        "messages": { "ttsEnabled": false, "ttsVolume": 100, "notificationsEnabled": true },
        "overlay": { "overlayEnabled": false }
      }
    }
    """);

    var service = new AppConfigService(dir);
    var loaded = service.GetSettings();

    Assert.Equal(SpeechDenoiseMode.Rnnoise, loaded.SpeechDenoise.Mode);
}
```

**Step 2: Run test**

Run: `dotnet test tests/Brmble.Client.Tests/ --filter "Settings_SpeechDenoiseDefaults_WhenMissingFromJson"`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/Brmble.Client.Tests/Services/AppConfigServiceTests.cs
git commit -m "test: verify SpeechDenoiseSettings backward-compatibility"
```

---

## Task 7: Full verification

**Step 1: Run all tests**

Run: `dotnet test`
Expected: all pass

**Step 2: Build frontend**

Run: `cd src/Brmble.Web && npm run build`
Expected: clean build

**Step 3: Build client**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: clean build

---

## Notes

- Place `renamenoise.dll` at `src/Brmble.Client/native/renamenoise.dll` for actual RNNoise usage (service gracefully disables if missing)
- RNNoise processes 480-sample frames at 48kHz (10ms)
- Floats to RNNoise are in raw short range (-32768 to 32767), matching Mumble's approach
- Only one denoise mode active at a time (enforced by dropdown)