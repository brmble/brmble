# RNNoise Noise Suppression Implementation Plan

**Goal:** Add RNNoise as an alternative noise suppression option alongside GTCRN, with a dropdown in Options > Audio to select between GTCRN, RNNoise, or Disabled.

**Architecture:** A new `RnnoiseService` wraps the native `renamenoise.dll` via P/Invoke. `AudioManager` calls it in `OnMicData` on 480-sample chunks (48kHz) before the existing GTCRN speech enhancement. Settings flow through the existing `AppSettings` → `MumbleAdapter.ApplySettings` → `AudioManager.ConfigureRnnoise` path. The UI provides a dropdown with three options: Disabled, RNNoise, and GTCRN.

**Tech Stack:** C# P/Invoke, NAudio (existing), renamenoise.dll (user-provided)

---

## Task 1: Add SpeechDenoiseSettings to AppSettings

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppSettings.cs`

**Step 1: Add SpeechDenoiseMode enum and SpeechDenoiseSettings record**

Replace the current file content to add the new enum and settings:

```csharp
namespace Brmble.Client.Services.AppConfig;

public enum SpeechDenoiseMode
{
    Disabled,
    Rnnoise,
    Gtcrn
}

public record SpeechDenoiseSettings(
    SpeechDenoiseMode Mode = SpeechDenoiseMode.Disabled
);

public record AudioSettings(
    string InputDevice = "default",
    string OutputDevice = "default",
    int InputVolume = 250,
    int MaxAmplification = 100,
    int OutputVolume = 250,
    string TransmissionMode = "voiceActivity",
    string? PushToTalkKey = null,
    int OpusBitrate = 72000,
    int OpusFrameSize = 20,
    string CaptureApi = "wasapi"
);

public record ShortcutsSettings(
    string? ToggleMuteKey = null,
    string? ToggleMuteDeafenKey = null,
    string? ToggleLeaveVoiceKey = null,
    string? ToggleDMScreenKey = null,
    string? ToggleScreenShareKey = null
);

public record MessagesSettings(
    bool TtsEnabled = false,
    int TtsVolume = 100,
    bool NotificationsEnabled = true
);

public record OverlaySettings(
    bool OverlayEnabled = false
);

public record SpeechEnhancementSettings(
    bool Enabled = false,
    string Model = "dns3"
);

public record AppearanceSettings(
    string Theme = "classic"
);

public record AppSettings(
    AudioSettings Audio,
    ShortcutsSettings Shortcuts,
    MessagesSettings Messages,
    OverlaySettings Overlay,
    SpeechEnhancementSettings? SpeechEnhancement = null,
    SpeechDenoiseSettings? SpeechDenoise = null,
    bool AutoConnectEnabled = false,
    string? AutoConnectServerId = null,
    bool ReconnectEnabled = true,
    AppearanceSettings? Appearance = null
)
{
    public SpeechEnhancementSettings SpeechEnhancement { get; init; } = SpeechEnhancement ?? new SpeechEnhancementSettings();
    public SpeechDenoiseSettings SpeechDenoise { get; init; } = SpeechDenoise ?? new SpeechDenoiseSettings();
    public AppearanceSettings Appearance { get; init; } = Appearance ?? new AppearanceSettings();

    public static AppSettings Default => new(
        new AudioSettings(),
        new ShortcutsSettings(),
        new MessagesSettings(),
        new OverlaySettings()
    );
}

public record WindowState(int X, int Y, int Width, int Height, bool IsMaximized);
```

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/AppConfig/AppSettings.cs
git commit -m "feat: add SpeechDenoiseSettings (Disabled/RNNoise/GTCRN) to AppSettings"
```

---

## Task 2: Create native folder and update csproj

**Files:**
- Create: `src/Brmble.Client/native/renamenoise.dll` (placeholder - user will provide)
- Modify: `src/Brmble.Client/Brmble.Client.csproj`

**Step 1: Create native directory**

```bash
mkdir -p src/Brmble.Client/native
```

**Step 2: Add csproj entry for native DLL**

Add to the `<ItemGroup>` with other `<None>` entries:

```xml
<ItemGroup>
  <None Include="native\*.dll">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
  <!-- existing entries -->
</ItemGroup>
```

**Step 3: Commit**

```bash
git add src/Brmble.Client/native/ src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: add native folder for renamenoise.dll"
```

---

## Task 3: Write RnnoiseService

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`
- Test: `tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs`

**Step 1: Write the failing test**

Create `tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs`:

```csharp
using Brmble.Client.Services.AppConfig;
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests.Services.SpeechEnhancement;

public class RnnoiseServiceTests
{
    [Fact]
    public void IsEnabled_ReturnsFalse_WhenDisabledMode()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Disabled);
        Assert.False(service.IsEnabled);
    }

    [Fact]
    public void IsEnabled_ReturnsTrue_WhenRnnoiseMode()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        Assert.True(service.IsEnabled);
    }

    [Fact]
    public void Process_ThrowsInvalidOperationException_WhenNotEnabled()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Disabled);
        var buffer = new float[480];
        Assert.Throws<InvalidOperationException>(() => service.Process(buffer));
    }

    [Fact]
    public void Process_ReturnsDenoisedBuffer_WhenEnabled()
    {
        using var service = new RnnoiseService(SpeechDenoiseMode.Rnnoise);
        var buffer = new float[480];
        var result = service.Process(buffer);
        Assert.NotNull(result);
        Assert.Equal(480, result.Length);
    }

    [Fact]
    public void FrameSize_Returns480()
    {
        Assert.Equal(480, RnnoiseService.FrameSize);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests" -v`
Expected: FAIL - RnnoiseService does not exist

**Step 3: Write RnnoiseService implementation**

Create `src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs`:

```csharp
using System.Runtime.InteropServices;
using Brmble.Client.Services.AppConfig;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class RnnoiseService : IDisposable
{
    public const int FrameSize = 480;

    private readonly IntPtr _state;
    private readonly bool _enabled;
    private bool _disposed;

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.C, EntryPoint = "rnnoise_create")]
    private static extern IntPtr RnnoiseCreate(IntPtr ctx);

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.C, EntryPoint = "rnnoise_process_frame")]
    private static extern int RnnoiseProcessFrame(IntPtr state, float[] input, float[] output);

    [DllImport("renamenoise.dll", CallingConvention = CallingConvention.C, EntryPoint = "rnnoise_destroy")]
    private static extern void RnnoiseDestroy(IntPtr state);

    public RnnoiseService(SpeechDenoiseMode mode)
    {
        _enabled = mode == SpeechDenoiseMode.Rnnoise;

        if (!_enabled)
            return;

        try
        {
            _state = RnnoiseCreate(IntPtr.Zero);
            if (_state == IntPtr.Zero)
            {
                Console.Error.WriteLine("RNNoise: Failed to create denoiser state. Disabling.");
                _enabled = false;
            }
        }
        catch (DllNotFoundException)
        {
            Console.Error.WriteLine("RNNoise: renamenoise.dll not found. Disabling noise suppression.");
            _enabled = false;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"RNNoise: Failed to initialize. Disabling. Details: {ex.Message}");
            _enabled = false;
        }
    }

    public bool IsEnabled => _enabled;

    public float[]? Process(float[] input)
    {
        if (_disposed)
            throw new ObjectDisposedException(nameof(RnnoiseService));

        if (!_enabled)
            throw new InvalidOperationException("RNNoise is not enabled. Create service with Rnnoise mode.");

        if (input.Length != FrameSize)
            throw new ArgumentException($"Input must be exactly {FrameSize} samples (10ms at 48kHz).", nameof(input));

        var output = new float[FrameSize];
        var result = RnnoiseProcessFrame(_state, input, output);

        if (result < 0)
        {
            Console.Error.WriteLine($"RNNoise: Process returned error code {result}.");
            return input;
        }

        return output;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        if (_state != IntPtr.Zero)
        {
            RnnoiseDestroy(_state);
        }
    }
}
```

**Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Brmble.Client.Tests/ --filter "RnnoiseServiceTests" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/RnnoiseService.cs
git add tests/Brmble.Client.Tests/Services/SpeechEnhancement/RnnoiseServiceTests.cs
git commit -m "feat: add RnnoiseService P/Invoke wrapper"
```

---

## Task 4: Integrate RNNoise into AudioManager

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

**Step 1: Add field and ConfigureRnnoise method**

Find the AudioManager class and add:

```csharp
private RnnoiseService? _rnnoise;
private SpeechDenoiseMode _lastDenoiseMode = SpeechDenoiseMode.Disabled;
```

Add the ConfigureRnnoise method after ConfigureSpeechEnhancement:

```csharp
public void ConfigureRnnoise(SpeechDenoiseMode mode)
{
    if (mode == _lastDenoiseMode)
        return;

    _lastDenoiseMode = mode;
    _rnnoise?.Dispose();
    _rnnoise = mode == SpeechDenoiseMode.Rnnoise ? new RnnoiseService(mode) : null;
}
```

**Step 2: Add RNNoise processing in OnMicData**

Find the `OnMicData` method and locate where audio processing happens. Add RNNoise processing after input volume but before GTCRN:

```csharp
// In OnMicData, after the volume/gain processing, add:
if (_rnnoise != null && _rnnoise.IsEnabled)
{
    var sampleCount = samples.Length;
    var offset = 0;
    while (offset + RnnoiseService.FrameSize <= sampleCount)
    {
        var frame = new float[RnnoiseService.FrameSize];
        Array.Copy(samples, offset, frame, 0, RnnoiseService.FrameSize);
        var denoised = _rnnoise.Process(frame);
        if (denoised != null)
        {
            Array.Copy(denoised, 0, samples, offset, RnnoiseService.FrameSize);
        }
        offset += RnnoiseService.FrameSize;
    }
}
```

Note: Find the exact location in OnMicData by searching for "// Apply speech enhancement" comment.

**Step 3: Add disposal**

Add to the AudioManager.Dispose method:

```csharp
_rnnoise?.Dispose();
```

**Step 4: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: integrate RNNoise in audio pipeline"
```

---

## Task 5: Wire up ConfigureRnnoise in MumbleAdapter

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`

**Step 1: Add field and call in ApplySettings**

Find the ApplySettings method. Add:

```csharp
private SpeechDenoiseMode _lastSpeechDenoiseMode = SpeechDenoiseMode.Disabled;
```

In ApplySettings, add after the speech enhancement config:

```csharp
var denoiseMode = settings.SpeechDenoise.Mode;
if (denoiseMode != _lastSpeechDenoiseMode)
{
    _lastSpeechDenoiseMode = denoiseMode;
    _audioManager?.ConfigureRnnoise(denoiseMode);
}
```

Also reset the mode in connection setup (find where `_lastSpeechEnhancementEnabled = false` is set):

```csharp
_lastSpeechDenoiseMode = SpeechDenoiseMode.Disabled;
```

**Step 2: Verify build**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: wire up RNNoise configuration in MumbleAdapter"
```

---

## Task 6: Add SpeechDenoiseSettings to TypeScript and SettingsModal

**Files:**
- Modify: `src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx`
- Modify: `src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx`

**Step 1: Update AudioSettingsTab.tsx types**

Replace SpeechEnhancementSettings with SpeechDenoiseSettings:

```typescript
export interface SpeechDenoiseSettings {
  mode: 'gtcrn' | 'rnnoise' | 'disabled';
}

export const DEFAULT_SPEECH_DENOISE: SpeechDenoiseSettings = {
  mode: 'disabled',
};
```

**Step 2: Update AudioSettingsTab UI**

Replace the Speech Enhancement toggle with a dropdown in the Transmission section:

```tsx
<div className="settings-item">
  <label>
    Noise Suppression
    <span className="tooltip-icon" data-tooltip="RNNoise is lightweight; GTCRN is more aggressive but uses more CPU.">?</span>
  </label>
  <Select
    value={speechDenoise.mode}
    onChange={(v) => onSpeechDenoiseChange({ ...speechDenoise, mode: v as SpeechDenoiseSettings['mode'] })}
    options={[
      { value: 'disabled', label: 'Disabled' },
      { value: 'rnnoise', label: 'RNNoise' },
      { value: 'gtcrn', label: 'GTCRN' },
    ]}
  />
</div>
```

Remove the old Speech Enhancement toggle section.

**Step 3: Update SettingsModal.tsx**

Add speechDenoise to the AppSettings interface and state:

```typescript
interface AppSettings {
  // ... existing fields
  speechDenoise: SpeechDenoiseSettings;
}

const DEFAULT_SETTINGS: AppSettings = {
  // ... existing defaults
  speechDenoise: DEFAULT_SPEECH_DENOISE,
};
```

Add handler:

```typescript
const handleSpeechDenoiseChange = (speechDenoise: SpeechDenoiseSettings) => {
  const newSettings = { ...settings, speechDenoise };
  setSettings(newSettings);
  bridge.send('settings.set', { settings: newSettings });
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
};
```

Pass to AudioSettingsTab:

```tsx
<AudioSettingsTab 
  // ... existing props
  speechDenoise={settings.speechDenoise}
  onSpeechDenoiseChange={handleSpeechDenoiseChange}
/>
```

**Step 4: Commit**

```bash
git add src/Brmble.Web/src/components/SettingsModal/AudioSettingsTab.tsx
git add src/Brmble.Web/src/components/SettingsModal/SettingsModal.tsx
git commit -m "feat: add Noise Suppression dropdown to audio settings"
```

---

## Task 7: Final verification

**Step 1: Run full build**

Run: `dotnet build`
Expected: Build succeeds

**Step 2: Run tests**

Run: `dotnet test`
Expected: All tests pass

**Step 3: Verify the user provides renamenoise.dll**

The user needs to place `renamenoise.dll` in `src/Brmble.Client/native/` folder. Without this DLL, RNNoise mode will gracefully disable itself with a console error message.
