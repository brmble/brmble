# GTCRN Speech Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate GTCRN speech enhancement as a preprocessing step in the client audio pipeline to enhance voice audio quality before transmission.

**Architecture:** ONNX Runtime-based speech enhancement service inserted between microphone capture and Opus encoding. Uses pre-converted GTCRN models from sherpa-onnx, with NAudio resampling for 48kHz ↔ 16kHz conversion.

**Tech Stack:** Microsoft.ML.OnnxRuntime (NuGet), NAudio (existing), GTCRN ONNX models from sherpa-onnx

---

### Task 1: Add ONNX Runtime NuGet package

**Files:**
- Modify: `src/Brmble.Client/Brmble.Client.csproj`

**Step 1: Add NuGet package reference**

Add to Brmble.Client.csproj inside `<ItemGroup>`:
```xml
<PackageReference Include="Microsoft.ML.OnnxRuntime" Version="1.19.2" />
```

**Step 2: Verify package restores**

Run: `dotnet restore src/Brmble.Client/Brmble.Client.csproj`
Expected: Restore completed successfully

**Step 3: Commit**

```bash
git add src/Brmble.Client/Brmble.Client.csproj
git commit -m "feat: add Microsoft.ML.OnnxRuntime package"
```

---

### Task 2: Download GTCRN ONNX models

**Files:**
- Download to: `src/Brmble.Client/models/gtcrn_simple.onnx`

**Note:** The plan originally specified `gtcrn-dns3-raw.onnx`, but the implementation uses `gtcrn_simple.onnx` from the sherpa-onnx releases (see https://github.com/k2-fsa/sherpa-onnx/releases/tag/speech-enhancement-models). The `gtcrn_simple.onnx` model is the DNS3 variant in a simplified format.

**Step 1: Create models directory**

```bash
mkdir -p src/Brmble.Client/models
```

**Step 2: Download models from sherpa-onnx releases**

Download from: https://github.com/k2-fsa/sherpa-onnx/releases/tag/speech-enhancement-models
- `gtcrn_simple.onnx` (~50KB) - DNS3 variant (simplified format)

**Step 3: Add to project**

Add to Brmble.Client.csproj:
```xml
<ItemGroup>
  <None Include="models\*.onnx">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
</ItemGroup>
```

**Step 4: Commit**

```bash
git add src/Brmble.Client/models/
git commit -m "feat: add GTCRN ONNX models"
```

---

### Task 3: Create GtcrnModel wrapper class

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/GtcrnModel.cs`

**Step 1: Write the failing test**

Create test file `tests/Brmble.Client.Tests/GtcrnModelTests.cs`:
```csharp
using Brmble.Client.Services.SpeechEnhancement;

namespace Brmble.Client.Tests;

public class GtcrnModelTests
{
    [Fact]
    public void LoadModel_ThrowsFileNotFound_WhenModelMissing()
    {
        var modelPath = "nonexistent.onnx";
        
        Assert.Throws<FileNotFoundException>(() => new GtcrnModel(modelPath));
    }
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests --filter "GtcrnModelTests" -v`
Expected: FAIL

**Step 3: Write minimal implementation**

Create `src/Brmble.Client/Services/SpeechEnhancement/GtcrnModel.cs`:
```csharp
using Microsoft.ML.OnnxRuntime;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class GtcrnModel : IDisposable
{
    private readonly InferenceSession _session;
    private readonly int _sampleRate = 16000;
    private readonly int _expectedSamples = 320; // 20ms at 16kHz

    public GtcrnModel(string modelPath)
    {
        if (!File.Exists(modelPath))
            throw new FileNotFoundException($"Model not found: {modelPath}");
        
        var sessionOptions = new SessionOptions();
        sessionOptions.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
        _session = new InferenceSession(modelPath, sessionOptions);
    }

    public ReadOnlySpan<float> Process(ReadOnlySpan<float> input16kHz)
    {
        if (input16kHz.Length == 0)
            return ReadOnlySpan<float>.Empty;

        var input = new float[_expectedSamples];
        var len = Math.Min(input16kHz.Length, _expectedSamples);
        input16kHz.Slice(0, len).CopyTo(input.AsSpan(0, len));

        var inputTensor = new DenseTensor<float>(input, new[] { 1, _expectedSamples });
        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input", inputTensor)
        };

        using var results = _session.Run(inputs);
        var output = results.FirstOrDefault()?.AsTensor<float>().ToArray() ?? Array.Empty<float>();

        return new ReadOnlySpan<float>(output);
    }

    public void Dispose() => _session.Dispose();
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests --filter "GtcrnModelTests" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/GtcrnModel.cs tests/Brmble.Client.Tests/GtcrnModelTests.cs
git commit -m "feat: add GtcrnModel ONNX wrapper"
```

---

### Task 4: Create SpeechEnhancementService

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/SpeechEnhancementService.cs`

**Step 1: Write the failing test**

Add to `tests/Brmble.Client.Tests/GtcrnModelTests.cs`:
```csharp
[Fact]
public void Enhance_Enabled_ReturnsEnhancedAudio()
{
    var service = new SpeechEnhancementService(modelsPath, enabled: true);
    
    // Create 20ms of 16kHz audio (320 samples)
    var input = new float[320];
    for (int i = 0; i < 320; i++)
        input[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 16000); // 440Hz tone
    
    var result = service.Enhance(input);
    
    Assert.NotNull(result);
    Assert.Equal(320, result.Length);
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests --filter "SpeechEnhancement" -v`
Expected: FAIL (class doesn't exist)

**Step 3: Write SpeechEnhancementService**

Create `src/Brmble.Client/Services/SpeechEnhancement/SpeechEnhancementService.cs`:
```csharp
namespace Brmble.Client.Services.SpeechEnhancement;

public enum GtcrnModelVariant
{
    Dns3,
    VctkDemand
}

public sealed class SpeechEnhancementService : IDisposable
{
    private readonly GtcrnModel? _model;
    private readonly bool _enabled;
    private readonly string _modelsPath;

    public bool IsEnabled => _enabled;

    public SpeechEnhancementService(string modelsPath, bool enabled = true, GtcrnModelVariant variant = GtcrnModelVariant.Dns3)
    {
        _modelsPath = modelsPath;
        _enabled = enabled;

        if (!enabled)
            return;

        var modelFile = variant switch
        {
            GtcrnModelVariant.Dns3 => "gtcrn-dns3-raw.onnx",
            GtcrnModelVariant.VctkDemand => "gtcrn-vctk-demand-raw.onnx",
            _ => "gtcrn-dns3-raw.onnx"
        };

        var modelPath = Path.Combine(modelsPath, modelFile);
        _model = new GtcrnModel(modelPath);
    }

    public float[]? Enhance(ReadOnlySpan<float> input16kHz)
    {
        if (!_enabled || _model == null)
            return null;

        var output = _model.Process(input16kHz);
        return output.ToArray();
    }

    public void Dispose()
    {
        _model?.Dispose();
    }
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests --filter "SpeechEnhancement" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/SpeechEnhancementService.cs tests/Brmble.Client.Tests/GtcrnModelTests.cs
git commit -m "feat: add SpeechEnhancementService"
```

---

### Task 5: Create AudioResampler helper

**Files:**
- Create: `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs`

**Step 1: Write the failing test**

Add to test file:
```csharp
[Fact]
public void Resample_48kTo16k_ProducesCorrectLength()
{
    var resampler = new AudioResampler(48000, 16000, 1);
    
    // 960 samples at 48kHz = 20ms
    var input48k = new float[960];
    for (int i = 0; i < 960; i++)
        input48k[i] = (float)Math.Sin(2 * Math.PI * 440 * i / 48000);
    
    var output16k = resampler.Resample(input48k);
    
    // Should be ~320 samples at 16kHz
    Assert.True(output16k.Length >= 300 && output16k.Length <= 340);
}
```

**Step 2: Run test to verify it fails**

Run: `dotnet test tests/Brmble.Client.Tests --filter "Resampler" -v`
Expected: FAIL

**Step 3: Write AudioResampler**

Create `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs`:
```csharp
using NAudio.Wave;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class AudioResampler : IDisposable
{
    private readonly WaveFormat _targetFormat;
    private MediaFoundationResampler? _resampler;
    private readonly int _sourceRate;
    private float[]? _inputBuffer;

    public AudioResampler(int sourceRate, int targetRate, int channels)
    {
        _sourceRate = sourceRate;
        _targetFormat = WaveFormat.CreateIeeeFloatWaveFormat(targetRate, channels);
    }

    public float[] Resample(ReadOnlySpan<float> input)
    {
        if (input.Length == 0)
            return Array.Empty<float>();

        var sourceFormat = WaveFormat.CreateIeeeFloatWaveFormat(_sourceRate, 1);
        
        using var provider = new BufferedWaveProvider(sourceFormat);
        
        var inputBytes = new byte[input.Length * sizeof(float)];
        Buffer.BlockCopy(input.ToArray(), 0, inputBytes, 0, inputBytes.Length);
        provider.AddSamples(inputBytes, 0, inputBytes.Length);

        _resampler = new MediaFoundationResampler(provider, _targetFormat);

        var outputSamples = new List<float>();
        var buffer = new float[4096];
        int read;

        while ((read = _resampler.Read(buffer, 0, buffer.Length)) > 0)
        {
            for (int i = 0; i < read; i++)
                outputSamples.Add(buffer[i]);
        }

        return outputSamples.ToArray();
    }

    public void Dispose()
    {
        _resampler?.Dispose();
    }
}
```

**Step 4: Run test to verify it passes**

Run: `dotnet test tests/Brmble.Client.Tests --filter "Resampler" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs tests/Brmble.Client.Tests/
git commit -m "feat: add AudioResampler for 48kHz ↔ 16kHz conversion"
```

---

### Task 6: Integrate with AudioManager (transmit path)

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:220-240`

**Step 1: Add SpeechEnhancementService to AudioManager**

Add private field to AudioManager:
```csharp
private SpeechEnhancementService? _speechEnhancement;
private AudioResampler? _to16kResampler;
private AudioResampler? _to48kResampler;
```

**Step 2: Add configuration method**

Add method to AudioManager:
```csharp
public void ConfigureSpeechEnhancement(string modelsPath, bool enabled, GtcrnModelVariant variant)
{
    _speechEnhancement?.Dispose();
    _to16kResampler?.Dispose();
    _to48kResampler?.Dispose();

    if (!enabled)
    {
        _speechEnhancement = null;
        return;
    }

    _speechEnhancement = new SpeechEnhancementService(modelsPath, enabled, variant);
    _to16kResampler = new AudioResampler(48000, 16000, 1);
    _to48kResampler = new AudioResampler(16000, 48000, 1);
}
```

**Step 3: Modify OnMicData to apply enhancement**

In `OnMicData`, after applying input volume and before VAD:
```csharp
private void OnMicData(object? sender, WaveInEventArgs e)
{
    if (_muted) return;
    if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
    if (_transmissionMode == TransmissionMode.VoiceActivity && !IsAboveThreshold(e.Buffer, e.BytesRecorded)) return;

    // Apply input volume
    if (_inputVolume != 1.0f)
        ApplyInputVolume(e.Buffer, e.BytesRecorded);

    // Apply speech enhancement if enabled
    var pcmData = new ReadOnlySpan<byte>(e.Buffer, 0, e.BytesRecorded);
    if (_speechEnhancement?.IsEnabled == true && _to16kResampler != null && _to48kResampler != null)
    {
        // Convert to float samples
        var samples48k = new float[e.BytesRecorded / 2];
        for (int i = 0; i < samples48k.Length; i++)
        {
            samples48k[i] = (short)(e.Buffer[i * 2] | (e.Buffer[i * 2 + 1] << 8));
        }

        // Resample to 16kHz
        var samples16k = _to16kResampler.Resample(samples48k);
        
        // Enhance
        var enhanced16k = _speechEnhancement.Enhance(samples16k);
        
        if (enhanced16k != null)
        {
            // Resample back to 48kHz
            var enhanced48k = _to48kResampler.Resample(enhanced16k);
            
            // Convert back to bytes
            for (int i = 0; i < Math.Min(enhanced48k.Length, samples48k.Length); i++)
            {
                var sample = (short)Math.Clamp(enhanced48k[i], short.MinValue, short.MaxValue);
                e.Buffer[i * 2] = (byte)(sample & 0xFF);
                e.Buffer[i * 2 + 1] = (byte)((sample >> 8) & 0xFF);
            }
        }
    }

    // Local speaking detection
    lock (_lock)
    {
        if (!_lastVoicePacket.ContainsKey(_localUserId))
        {
            UserStartedSpeaking?.Invoke(_localUserId);
        }
        _lastVoicePacket[_localUserId] = DateTime.UtcNow;
    }

    _encodePipeline?.SubmitPcm(pcmData);
}
```

**Step 4: Update Dispose**

Add to AudioManager.Dispose():
```csharp
_speechEnhancement?.Dispose();
_to16kResampler?.Dispose();
_to48kResampler?.Dispose();
```

**Step 5: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

**Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: integrate GTCRN speech enhancement in transmit path"
```

---

### Task 7: Add configuration options

**Files:**
- Modify: `src/Brmble.Client/Services/AppConfig/AppConfig.cs` (or similar config file)
- Modify: `src/Brmble.Client/Program.cs` (or where AudioManager is instantiated)

**Step 1: Add settings to AppConfig**

Add to AppSettings class:
```csharp
public bool SpeechEnhancementEnabled { get; set; } = true;
public string SpeechEnhancementModel { get; set; } = "dns3";
```

**Step 2: Wire up configuration**

In Program.cs where AudioManager is created:
```csharp
var modelVariant = settings.SpeechEnhancementModel?.ToLowerInvariant() switch
{
    "vctk-demand" => GtcrnModelVariant.VctkDemand,
    _ => GtcrnModelVariant.Dns3
};

audioManager.ConfigureSpeechEnhancement(
    modelsPath: Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "models"),
    enabled: settings.SpeechEnhancementEnabled,
    variant: modelVariant
);
```

**Step 3: Build and verify**

Run: `dotnet build src/Brmble.Client/Brmble.Client.csproj`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add src/Brmble.Client/
git commit -m "feat: add speech enhancement configuration options"
```

---

### Task 8: Final verification

**Step 1: Run all tests**

Run: `dotnet test`
Expected: All tests pass

**Step 2: Build all**

Run: `dotnet build`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add .
git commit -m "feat: complete GTCRN speech enhancement integration"
```

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-02-22-gtcrn-speech-enhancement-plan.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
