# Audio Processing Stacks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the WebRTC APM spike into a real, swappable capture-side audio pipeline with a dev-facing stack selector, an in-app virtual mic for A/B testing, and an offline CLI harness.

**Architecture:** Extract the three capture processors (`Passthrough`, `Legacy`, `WebRtcApm`) behind one `IAudioCapturePostProcessor` interface in the existing `Brmble.Audio` class library. `AudioManager` holds a swappable instance guarded by the existing `_lock`. A new `tools/ApmBench` console app reuses the same classes to process WAV files for regression and tuning. Fixtures come from Chromium's BSD-3 `voice_engine/` corpus.

**Tech Stack:** .NET 10, C#, NAudio (existing), `SoundFlow.Extensions.WebRtc.Apm` (existing), xUnit (existing), React + TypeScript (existing), WebView2 bridge (existing).

**Plan deviation from spec:** The spec placed processor classes in `src/Brmble.Client/Services/Voice/`. This plan places them in `src/Brmble.Audio/Processing/` (the existing shared library) so the CLI harness can reference them without taking a dependency on the Windows-only `Brmble.Client` WinExe. This is one of the two options the spec explicitly left open.

---

## Prerequisites

- Worktree `C:/dev/brmble/brmble/.worktrees/apm-spike` on branch `feature/apm-spike`.
- Working APM spike already committed (NuGet added, `WebRtcApmProcessor.cs` in `Brmble.Client/Services/Voice/`, inline wiring in `AudioManager.OnMicData`).
- `dotnet build` succeeds, `dotnet test` passes.

## File Structure

```
src/Brmble.Audio/
├── Brmble.Audio.csproj           [MODIFY — add SoundFlow.Extensions.WebRtc.Apm PackageReference]
└── Processing/                   [NEW folder]
    ├── IAudioCapturePostProcessor.cs   [NEW]
    ├── ProcessingStack.cs              [NEW]
    ├── PassthroughProcessor.cs         [NEW]
    ├── LegacyAudioProcessor.cs         [NEW]
    └── WebRtcApmProcessor.cs           [MOVED from Brmble.Client/Services/Voice/]

src/Brmble.Client/
├── Brmble.Client.csproj          [MODIFY — remove direct SoundFlow PackageReference (transitive now)]
├── Services/Voice/
│   ├── AudioManager.cs           [MODIFY — use _processor field, hot-swap, virtual mic]
│   ├── VoiceService.cs           [MODIFY — expose SetProcessingStack, SetVirtualMic]
│   └── FixtureWaveProvider.cs    [NEW — NAudio IWaveIn that replays a WAV file]
└── Bridge/
    └── NativeBridge.cs           [MODIFY — route new voice.* messages]

src/Brmble.Web/src/
└── components/Settings/Voice/
    ├── VoiceSettings.tsx         [MODIFY — add stack dropdown + Testing subsection]
    └── ProcessingStackSelect.tsx [NEW — reusable dropdown component]

tools/ApmBench/                   [NEW project]
├── ApmBench.csproj               [NEW]
├── Program.cs                    [NEW]
├── Metrics.cs                    [NEW]
└── Args.cs                       [NEW]

tests/Brmble.Audio.Tests/
├── Brmble.Audio.Tests.csproj     [MODIFY — add ProjectReference to ApmBench if needed]
├── Processing/
│   ├── PassthroughProcessorTests.cs    [NEW]
│   ├── LegacyAudioProcessorTests.cs    [NEW]
│   └── WebRtcApmProcessorTests.cs      [NEW]
├── ApmBenchIntegrationTests.cs         [NEW]
└── fixtures/apm/
    ├── near_speech.wav                 [NEW — from Chromium voice_engine/, BSD-3]
    ├── far_end.wav                     [NEW — from Chromium voice_engine/, BSD-3]
    ├── noise_speech.wav                [NEW — from Chromium voice_engine/, BSD-3]
    └── README.md                       [NEW — attribution + SHAs]

Brmble.sln                        [MODIFY — add tools/ApmBench project]
```

---

### Task 1: Move `WebRtcApmProcessor` into `Brmble.Audio.Processing`

Prepare the shared library as the home for all capture processors. This is a pure move + namespace change; behavior must not change.

**Files:**
- Move: `src/Brmble.Client/Services/Voice/WebRtcApmProcessor.cs` → `src/Brmble.Audio/Processing/WebRtcApmProcessor.cs`
- Modify: `src/Brmble.Audio/Brmble.Audio.csproj`
- Modify: `src/Brmble.Client/Brmble.Client.csproj`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs` (`using` import)

- [ ] **Step 1: Move the file and change namespace**

Create `src/Brmble.Audio/Processing/WebRtcApmProcessor.cs` with the same content as the spike, but with the new namespace:

```csharp
using System;
using SoundFlow.Extensions.WebRtc.Apm;

namespace Brmble.Audio.Processing;

/// <summary>
/// WebRTC APM wrapper for the mic capture path. Fixed at 48 kHz mono, 10 ms frames.
/// Samples that don't align to a 10 ms boundary are buffered until the next call.
/// Not thread-safe — must be driven from a single thread (the WASAPI capture thread).
/// </summary>
public sealed class WebRtcApmProcessor : IDisposable
{
    public const int SampleRate = 48000;
    public const int Channels = 1;
    public const int FrameSamples = 480;
    public const int FrameBytes = FrameSamples * sizeof(short);

    private readonly AudioProcessingModule _apm;
    private readonly ApmConfig _config;
    private readonly StreamConfig _streamConfig;

    private readonly float[][] _frameIn = { new float[FrameSamples] };
    private readonly float[][] _frameOut = { new float[FrameSamples] };
    private readonly byte[] _pending = new byte[FrameBytes];
    private int _pendingBytes;

    private bool _disposed;

    /// <summary>
    /// Linear gain applied after APM processing, before int16 conversion.
    /// AGC2 targets ~-19 dBFS which is quieter than typical VOIP expectations;
    /// a post-gain of ~1.5x (≈3.5 dB) brings output closer to -15 dBFS.
    /// Hard-clipped at int16 bounds.
    /// </summary>
    public float OutputGain { get; set; } = 1.5f;

    public WebRtcApmProcessor()
    {
        _apm = new AudioProcessingModule();
        _config = new ApmConfig();
        _config.SetGainController1(false, GainControlMode.AdaptiveDigital, 3, 9, true);
        _config.SetGainController2(true);
        _config.SetNoiseSuppression(true, NoiseSuppressionLevel.High);
        _config.SetHighPassFilter(true);
        _config.SetEchoCanceller(false, false);

        var err = _apm.ApplyConfig(_config);
        if (err != ApmError.NoError)
            throw new InvalidOperationException($"APM ApplyConfig failed: {err}");

        _streamConfig = new StreamConfig(SampleRate, Channels);

        err = _apm.Initialize();
        if (err != ApmError.NoError)
            throw new InvalidOperationException($"APM Initialize failed: {err}");
    }

    public int Process(ReadOnlySpan<byte> input, Span<byte> output)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(WebRtcApmProcessor));

        int outWritten = 0;
        int inputOffset = 0;

        if (_pendingBytes > 0)
        {
            int need = FrameBytes - _pendingBytes;
            int take = Math.Min(need, input.Length);
            input.Slice(0, take).CopyTo(_pending.AsSpan(_pendingBytes, take));
            _pendingBytes += take;
            inputOffset += take;
            if (_pendingBytes == FrameBytes)
            {
                ProcessOneFrame(_pending, output.Slice(outWritten, FrameBytes));
                outWritten += FrameBytes;
                _pendingBytes = 0;
            }
        }

        while (input.Length - inputOffset >= FrameBytes)
        {
            ProcessOneFrame(input.Slice(inputOffset, FrameBytes), output.Slice(outWritten, FrameBytes));
            outWritten += FrameBytes;
            inputOffset += FrameBytes;
        }

        int leftover = input.Length - inputOffset;
        if (leftover > 0)
        {
            input.Slice(inputOffset, leftover).CopyTo(_pending.AsSpan(_pendingBytes));
            _pendingBytes += leftover;
        }

        return outWritten;
    }

    private void ProcessOneFrame(ReadOnlySpan<byte> inPcm16, Span<byte> outPcm16)
    {
        var inFloat = _frameIn[0];
        for (int i = 0; i < FrameSamples; i++)
        {
            short s = (short)(inPcm16[i * 2] | (inPcm16[i * 2 + 1] << 8));
            inFloat[i] = s / 32768f;
        }

        var err = _apm.ProcessStream(_frameIn, _streamConfig, _streamConfig, _frameOut);
        if (err != ApmError.NoError)
        {
            inPcm16.CopyTo(outPcm16);
            return;
        }

        var outFloat = _frameOut[0];
        float gain = OutputGain;
        for (int i = 0; i < FrameSamples; i++)
        {
            int s = (int)MathF.Round(outFloat[i] * gain * 32768f);
            if (s > short.MaxValue) s = short.MaxValue;
            else if (s < short.MinValue) s = short.MinValue;
            outPcm16[i * 2] = (byte)(s & 0xFF);
            outPcm16[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _streamConfig.Dispose();
        _config.Dispose();
        _apm.Dispose();
    }
}
```

Delete the old file: `src/Brmble.Client/Services/Voice/WebRtcApmProcessor.cs`.

- [ ] **Step 2: Move the SoundFlow NuGet reference**

Edit `src/Brmble.Audio/Brmble.Audio.csproj` — add inside the existing `<ItemGroup>` for PackageReferences:

```xml
<PackageReference Include="SoundFlow.Extensions.WebRtc.Apm" Version="1.4.0" />
```

Edit `src/Brmble.Client/Brmble.Client.csproj` — remove the line:

```xml
<PackageReference Include="SoundFlow.Extensions.WebRtc.Apm" Version="1.4.0" />
```

- [ ] **Step 3: Update `AudioManager.cs` import**

In `src/Brmble.Client/Services/Voice/AudioManager.cs`, add `using Brmble.Audio.Processing;` near the top alongside other `using` statements.

- [ ] **Step 4: Build and smoke-test**

Run:

```bash
dotnet build
```

Expected: build succeeds with 0 errors. `webrtc-apm.dll` and `miniaudio.dll` still land in `src/Brmble.Client/bin/Debug/net10.0-windows/runtimes/win-x64/native/` (because Brmble.Client transitively pulls them via Brmble.Audio).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(audio): move WebRtcApmProcessor to Brmble.Audio library"
```

---

### Task 2: Add `IAudioCapturePostProcessor` interface + `ProcessingStack` enum

**Files:**
- Create: `src/Brmble.Audio/Processing/IAudioCapturePostProcessor.cs`
- Create: `src/Brmble.Audio/Processing/ProcessingStack.cs`

- [ ] **Step 1: Create the interface**

`src/Brmble.Audio/Processing/IAudioCapturePostProcessor.cs`:

```csharp
using System;

namespace Brmble.Audio.Processing;

/// <summary>
/// Capture-side audio post-processor. Processes 16-bit PCM at 48 kHz mono.
/// Implementations may buffer sub-frame leftovers internally and return
/// fewer bytes than <paramref name="input"/>.Length on a given call.
/// Not thread-safe — drive from a single thread (WASAPI capture thread).
/// </summary>
public interface IAudioCapturePostProcessor : IDisposable
{
    /// <summary>
    /// Processes 16-bit PCM mono at 48 kHz. Writes processed PCM16 into
    /// <paramref name="output"/>. Returns bytes written. Output capacity
    /// must be at least <c>input.Length + one 10 ms frame</c> to absorb
    /// drained leftover from a previous call.
    /// </summary>
    int Process(ReadOnlySpan<byte> input, Span<byte> output);
}
```

- [ ] **Step 2: Create the enum**

`src/Brmble.Audio/Processing/ProcessingStack.cs`:

```csharp
namespace Brmble.Audio.Processing;

/// <summary>
/// Selects which capture-side audio processing stack is active.
/// Default is <see cref="Legacy"/> to preserve existing user behavior.
/// </summary>
public enum ProcessingStack
{
    None = 0,
    Legacy = 1,
    WebRtcApm = 2,
}
```

- [ ] **Step 3: Make `WebRtcApmProcessor` implement the interface**

In `src/Brmble.Audio/Processing/WebRtcApmProcessor.cs`, change the class declaration:

```csharp
public sealed class WebRtcApmProcessor : IAudioCapturePostProcessor
```

(The `Process(ReadOnlySpan<byte>, Span<byte>) : int` signature already matches; no other changes needed.)

- [ ] **Step 4: Build and verify**

Run:

```bash
dotnet build src/Brmble.Audio/Brmble.Audio.csproj
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/Processing/
git commit -m "feat(audio): add IAudioCapturePostProcessor interface + ProcessingStack enum"
```

---

### Task 3: Implement `PassthroughProcessor` (TDD)

**Files:**
- Create: `src/Brmble.Audio/Processing/PassthroughProcessor.cs`
- Create: `tests/Brmble.Audio.Tests/Processing/PassthroughProcessorTests.cs`

- [ ] **Step 1: Write the failing test**

`tests/Brmble.Audio.Tests/Processing/PassthroughProcessorTests.cs`:

```csharp
using Brmble.Audio.Processing;
using Xunit;

namespace Brmble.Audio.Tests.Processing;

public class PassthroughProcessorTests
{
    [Fact]
    public void Process_CopiesInputToOutputExactly()
    {
        using var proc = new PassthroughProcessor();
        byte[] input = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 };
        byte[] output = new byte[input.Length];

        int written = proc.Process(input, output);

        Assert.Equal(input.Length, written);
        Assert.Equal(input, output);
    }

    [Fact]
    public void Process_EmptyInputWritesNothing()
    {
        using var proc = new PassthroughProcessor();
        byte[] output = new byte[8];

        int written = proc.Process(ReadOnlySpan<byte>.Empty, output);

        Assert.Equal(0, written);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~PassthroughProcessorTests
```

Expected: FAIL with "The type or namespace name 'PassthroughProcessor' could not be found".

- [ ] **Step 3: Write minimal implementation**

`src/Brmble.Audio/Processing/PassthroughProcessor.cs`:

```csharp
using System;

namespace Brmble.Audio.Processing;

public sealed class PassthroughProcessor : IAudioCapturePostProcessor
{
    public int Process(ReadOnlySpan<byte> input, Span<byte> output)
    {
        input.CopyTo(output);
        return input.Length;
    }

    public void Dispose() { }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~PassthroughProcessorTests
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/Processing/PassthroughProcessor.cs tests/Brmble.Audio.Tests/Processing/PassthroughProcessorTests.cs
git commit -m "feat(audio): add PassthroughProcessor"
```

---

### Task 4: Extract legacy AGC + RNNoise into `LegacyAudioProcessor` (TDD)

The legacy stack is the existing `ApplyAGC` method + the `RnnoiseService` block currently inline in `AudioManager.OnMicData`. Extract both into one class with self-contained state. `ApplyAGC` logic must be copied verbatim.

**Files:**
- Create: `src/Brmble.Audio/Processing/LegacyAudioProcessor.cs`
- Create: `tests/Brmble.Audio.Tests/Processing/LegacyAudioProcessorTests.cs`

- [ ] **Step 1: Read the current `ApplyAGC` implementation**

Open `src/Brmble.Client/Services/Voice/AudioManager.cs` and find the `ApplyAGC` method (roughly line 920). Copy the body verbatim. It processes a `byte[]` PCM16 buffer in-place and depends on a `_maxAmplification` field (float, default 1.0). The new class must accept `maxAmplification` via a property or constructor argument.

- [ ] **Step 2: Write the failing tests**

`tests/Brmble.Audio.Tests/Processing/LegacyAudioProcessorTests.cs`:

```csharp
using Brmble.Audio.Processing;
using Xunit;

namespace Brmble.Audio.Tests.Processing;

public class LegacyAudioProcessorTests
{
    [Fact]
    public void Process_WithAmplification1_CopiesInputVerbatimWhenRnnoiseOff()
    {
        using var proc = new LegacyAudioProcessor { MaxAmplification = 1.0f, RnnoiseEnabled = false };
        byte[] input = new byte[960]; // 10 ms @ 48 kHz mono
        for (int i = 0; i < input.Length; i++) input[i] = (byte)(i & 0xFF);
        byte[] output = new byte[input.Length];

        int written = proc.Process(input, output);

        Assert.Equal(input.Length, written);
        Assert.Equal(input, output);
    }

    [Fact]
    public void Process_WithAmplification_BoostsQuietSignal()
    {
        using var proc = new LegacyAudioProcessor { MaxAmplification = 4.0f, RnnoiseEnabled = false };
        // A quiet sine-like signal: int16 amplitude ~1000
        byte[] input = new byte[960];
        for (int i = 0; i < input.Length / 2; i++)
        {
            short s = (short)(1000 * (i % 2 == 0 ? 1 : -1));
            input[i * 2] = (byte)(s & 0xFF);
            input[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
        byte[] output = new byte[input.Length];

        proc.Process(input, output);

        // Output RMS must be strictly greater than input RMS.
        double inRms = Rms(input);
        double outRms = Rms(output);
        Assert.True(outRms > inRms * 1.5, $"expected output RMS > 1.5x input, got in={inRms:F1}, out={outRms:F1}");
    }

    private static double Rms(byte[] pcm16)
    {
        double sumSq = 0;
        int samples = pcm16.Length / 2;
        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            sumSq += (double)s * s;
        }
        return Math.Sqrt(sumSq / samples);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~LegacyAudioProcessorTests
```

Expected: FAIL with "The type or namespace name 'LegacyAudioProcessor' could not be found".

- [ ] **Step 4: Write the implementation**

`src/Brmble.Audio/Processing/LegacyAudioProcessor.cs`:

```csharp
using System;
using System.Buffers;

namespace Brmble.Audio.Processing;

/// <summary>
/// Current capture-side stack: amplitude AGC + optional RNNoise.
/// Holds its own per-frame state; instances are not thread-safe.
/// </summary>
public sealed class LegacyAudioProcessor : IAudioCapturePostProcessor
{
    /// <summary>
    /// Max amplification factor applied by AGC. 1.0 = off. Matches the
    /// user-facing "Boost amplification" slider.
    /// </summary>
    public float MaxAmplification { get; set; } = 1.0f;

    /// <summary>
    /// When true, applies RNNoise denoise to the post-AGC signal.
    /// The caller (AudioManager) owns lifecycle of the RNNoise instance
    /// and pokes it through here. For unit tests default to false.
    /// </summary>
    public bool RnnoiseEnabled { get; set; }

    /// <summary>
    /// Hook provided by the caller to run RNNoise on a float frame in-place.
    /// Returning false means RNNoise was not applied for this frame (warm-up, etc.).
    /// </summary>
    public Func<float[], bool>? RnnoiseProcess { get; set; }

    public const int RnnoiseFrameSamples = 480;

    private float[]? _rnnoiseRemainder;

    public int Process(ReadOnlySpan<byte> input, Span<byte> output)
    {
        // Copy input to output first — all subsequent ops are in-place on output.
        input.CopyTo(output);
        int bytesWritten = input.Length;

        if (MaxAmplification != 1.0f && bytesWritten > 0)
        {
            ApplyAgcInPlace(output, bytesWritten, MaxAmplification);
        }

        if (RnnoiseEnabled && RnnoiseProcess != null && bytesWritten > 0)
        {
            ApplyRnnoiseInPlace(output, ref bytesWritten);
        }

        return bytesWritten;
    }

    private static void ApplyAgcInPlace(Span<byte> pcm16, int bytes, float maxGain)
    {
        // Simple peak-normalising AGC: find peak, scale up to keep within int16.
        short peak = 0;
        int samples = bytes / 2;
        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            short abs = s == short.MinValue ? short.MaxValue : (short)Math.Abs(s);
            if (abs > peak) peak = abs;
        }
        if (peak == 0) return;

        float headroom = 32760f / peak;
        float gain = Math.Min(maxGain, headroom);
        if (gain <= 1.0f) return;

        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            int scaled = (int)(s * gain);
            if (scaled > short.MaxValue) scaled = short.MaxValue;
            else if (scaled < short.MinValue) scaled = short.MinValue;
            pcm16[i * 2] = (byte)(scaled & 0xFF);
            pcm16[i * 2 + 1] = (byte)((scaled >> 8) & 0xFF);
        }
    }

    private void ApplyRnnoiseInPlace(Span<byte> pcm16, ref int bytesWritten)
    {
        int sampleCount = bytesWritten / 2;
        int totalSamples = sampleCount + (_rnnoiseRemainder?.Length ?? 0);
        var scratch = ArrayPool<float>.Shared.Rent(totalSamples);
        try
        {
            int idx = 0;
            if (_rnnoiseRemainder != null)
            {
                Array.Copy(_rnnoiseRemainder, 0, scratch, 0, _rnnoiseRemainder.Length);
                idx = _rnnoiseRemainder.Length;
                _rnnoiseRemainder = null;
            }
            for (int i = 0; i < sampleCount; i++)
            {
                short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
                scratch[idx + i] = s / 32768f;
            }

            int offset = 0;
            while (offset + RnnoiseFrameSamples <= idx + sampleCount)
            {
                var frame = new float[RnnoiseFrameSamples];
                Array.Copy(scratch, offset, frame, 0, RnnoiseFrameSamples);
                if (RnnoiseProcess!(frame))
                {
                    for (int i = 0; i < RnnoiseFrameSamples; i++)
                    {
                        var s = (short)Math.Clamp(frame[i] * 32768f, short.MinValue, short.MaxValue);
                        int outByte = (offset + i) * 2;
                        if (outByte + 1 < pcm16.Length)
                        {
                            pcm16[outByte] = (byte)(s & 0xFF);
                            pcm16[outByte + 1] = (byte)((s >> 8) & 0xFF);
                        }
                    }
                }
                offset += RnnoiseFrameSamples;
            }

            int remaining = (idx + sampleCount) - offset;
            if (remaining > 0)
            {
                _rnnoiseRemainder = new float[remaining];
                Array.Copy(scratch, offset, _rnnoiseRemainder, 0, remaining);
            }
        }
        finally
        {
            ArrayPool<float>.Shared.Return(scratch);
        }
    }

    public void Dispose()
    {
        _rnnoiseRemainder = null;
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~LegacyAudioProcessorTests
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Audio/Processing/LegacyAudioProcessor.cs tests/Brmble.Audio.Tests/Processing/LegacyAudioProcessorTests.cs
git commit -m "feat(audio): extract legacy AGC + RNNoise into LegacyAudioProcessor"
```

---

### Task 5: Add `WebRtcApmProcessor` unit test

**Files:**
- Create: `tests/Brmble.Audio.Tests/Processing/WebRtcApmProcessorTests.cs`

- [ ] **Step 1: Write tests**

`tests/Brmble.Audio.Tests/Processing/WebRtcApmProcessorTests.cs`:

```csharp
using Brmble.Audio.Processing;
using Xunit;

namespace Brmble.Audio.Tests.Processing;

public class WebRtcApmProcessorTests
{
    [Fact]
    public void Process_ProducesSameLengthForFullFrames()
    {
        using var proc = new WebRtcApmProcessor();
        // 100 ms of silence = 10 frames = 9600 bytes.
        byte[] input = new byte[9600];
        byte[] output = new byte[input.Length + WebRtcApmProcessor.FrameBytes];

        int written = proc.Process(input, output);

        Assert.Equal(input.Length, written);
    }

    [Fact]
    public void Process_BuffersSubFrameLeftover()
    {
        using var proc = new WebRtcApmProcessor();
        // Half a frame: 240 samples = 480 bytes. Should return 0, buffer the rest.
        byte[] input = new byte[WebRtcApmProcessor.FrameBytes / 2];
        byte[] output = new byte[input.Length + WebRtcApmProcessor.FrameBytes];

        int written = proc.Process(input, output);
        Assert.Equal(0, written);

        // Send the other half; should now get one full frame out.
        written = proc.Process(input, output);
        Assert.Equal(WebRtcApmProcessor.FrameBytes, written);
    }

    [Fact]
    public void Process_SilenceInSilenceOut()
    {
        using var proc = new WebRtcApmProcessor();
        byte[] input = new byte[WebRtcApmProcessor.FrameBytes]; // all zeros
        byte[] output = new byte[input.Length];

        proc.Process(input, output);

        // Output should also be ~silence (allow tiny residual from HPF etc.)
        int maxAbs = 0;
        for (int i = 0; i < output.Length / 2; i++)
        {
            short s = (short)(output[i * 2] | (output[i * 2 + 1] << 8));
            int abs = s == short.MinValue ? short.MaxValue : Math.Abs(s);
            if (abs > maxAbs) maxAbs = abs;
        }
        Assert.True(maxAbs < 100, $"expected near-silence, peak={maxAbs}");
    }
}
```

- [ ] **Step 2: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~WebRtcApmProcessorTests
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Audio.Tests/Processing/WebRtcApmProcessorTests.cs
git commit -m "test(audio): add WebRtcApmProcessor unit tests"
```

---

### Task 6: Wire `_processor` field + `SetProcessingStack` into `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

- [ ] **Step 1: Replace spike-era APM wiring with interface-based processor**

In `AudioManager.cs`, remove the spike block added earlier:

Delete these fields (near `_speechEnhancement`):

```csharp
// WebRTC APM (spike): AGC2 + NS + HPF, runs before legacy AGC/RNNoise.
private WebRtcApmProcessor? _apmProcessor;
private bool _apmInitAttempted;
[ThreadStatic] private static byte[]? _apmOutputScratch;
```

Replace with:

```csharp
// Capture-side processor (swappable). Default = Legacy stack.
private IAudioCapturePostProcessor? _processor;
private ProcessingStack _processingStack = ProcessingStack.Legacy;
[ThreadStatic] private static byte[]? _processorOutputScratch;
```

- [ ] **Step 2: Add `SetProcessingStack` method**

Add this method near `SetDenoiseMode` (around line 380):

```csharp
public void SetProcessingStack(ProcessingStack stack)
{
    lock (_lock)
    {
        if (_processingStack == stack && _processor != null) return;
        _processingStack = stack;
        _processor?.Dispose();
        _processor = CreateProcessorLocked(stack);
        AudioLog.Write($"[Audio] Processing stack set to {stack}");
    }
}

private IAudioCapturePostProcessor? CreateProcessorLocked(ProcessingStack stack)
{
    try
    {
        return stack switch
        {
            ProcessingStack.None => new PassthroughProcessor(),
            ProcessingStack.Legacy => new LegacyAudioProcessor
            {
                MaxAmplification = _maxAmplification,
                RnnoiseEnabled = _rnnoise?.IsEnabled == true,
                RnnoiseProcess = frame =>
                {
                    var result = _rnnoise?.Process(frame);
                    if (result == null) return false;
                    Array.Copy(result, frame, frame.Length);
                    return true;
                },
            },
            ProcessingStack.WebRtcApm => new WebRtcApmProcessor(),
            _ => throw new ArgumentOutOfRangeException(nameof(stack)),
        };
    }
    catch (Exception ex)
    {
        AudioLog.Write($"[Audio] Failed to create processor for {stack}: {ex.Message}");
        return null;
    }
}
```

- [ ] **Step 3: Simplify `OnMicData` to use the processor**

In `OnMicData`, replace the entire spike block + legacy AGC + RNNoise blocks (currently lines ~751 through ~830) with:

```csharp
if (_muted) return;
if (_transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;

// Ensure processor exists for current stack.
IAudioCapturePostProcessor? processor;
lock (_lock)
{
    if (_processor == null) _processor = CreateProcessorLocked(_processingStack);
    processor = _processor;
}

if (processor != null)
{
    int needed = processedBytes + WebRtcApmProcessor.FrameBytes;
    if (_processorOutputScratch == null || _processorOutputScratch.Length < needed)
        _processorOutputScratch = new byte[needed];

    int written = processor.Process(
        new ReadOnlySpan<byte>(processedBuffer, 0, processedBytes),
        _processorOutputScratch.AsSpan());

    processedBuffer = _processorOutputScratch;
    processedBytes = written;

    if (processedBytes == 0) return;
}

// Apply input volume (AGC is now handled by the processor)
if (_inputVolume != 1.0f)
    ApplyInputVolume(processedBuffer, processedBytes);
```

(The block that previously contained `ApplyAGC(…)` and the entire RNNoise section is removed — they now live in `LegacyAudioProcessor`.)

Leave the SpeechEnhancement block, VAD check, and `SubmitPcm` call intact immediately after.

- [ ] **Step 4: Update `Dispose`**

In the class's `Dispose` method, replace:

```csharp
_apmProcessor?.Dispose();
_apmProcessor = null;
```

with:

```csharp
_processor?.Dispose();
_processor = null;
```

- [ ] **Step 5: Update `SetDenoiseMode` to refresh the processor**

Find `SetDenoiseMode` (around line 378). After the existing logic that sets `_rnnoise`, add at the end of the `lock (_lock)` block:

```csharp
// If we're on the Legacy stack, rebuild it so its RnnoiseProcess hook picks up the new service.
if (_processingStack == ProcessingStack.Legacy)
{
    _processor?.Dispose();
    _processor = CreateProcessorLocked(ProcessingStack.Legacy);
}
```

- [ ] **Step 6: Add `using` directive**

At the top of `AudioManager.cs`, if not already present:

```csharp
using Brmble.Audio.Processing;
```

- [ ] **Step 7: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: 0 errors.

- [ ] **Step 8: Smoke-test**

Run the client briefly (5-10 seconds), confirm mic still works, then exit:

```bash
cd src/Brmble.Web && npm run build && cd ../..
dotnet run --project src/Brmble.Client/Brmble.Client.csproj
```

Check `%LocalAppData%/Brmble/audio.log` for the line `[Audio] Processing stack set to Legacy` after the first call to `SetProcessingStack` (it won't appear on cold start yet — that wires up in later tasks, but the processor should still be created lazily in `OnMicData`).

- [ ] **Step 9: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(audio): wire IAudioCapturePostProcessor into AudioManager with hot-swap"
```

---

### Task 7: Bridge + `VoiceService` plumbing for `SetProcessingStack`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/VoiceService.cs`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` (or wherever bridge dispatch lives)

- [ ] **Step 1: Locate the bridge dispatch for `voice.setDenoiseMode`**

Grep the codebase:

```bash
grep -rn "setDenoiseMode" src/Brmble.Client
```

Note the file + line that dispatches that message. `SetProcessingStack` is added alongside using the same pattern.

- [ ] **Step 2: Add a `setProcessingStack` message handler**

In the file found in Step 1, add a parallel handler:

```csharp
case "voice.setProcessingStack":
{
    var stackStr = payload?.GetProperty("stack").GetString() ?? "Legacy";
    if (!Enum.TryParse<ProcessingStack>(stackStr, ignoreCase: true, out var stack))
        stack = ProcessingStack.Legacy;
    _audioManager.SetProcessingStack(stack);
    break;
}
```

(The exact shape depends on the project's current bridge style — follow the convention of the existing `setDenoiseMode` handler byte-for-byte.)

Add `using Brmble.Audio.Processing;` at the top of that file if needed.

- [ ] **Step 3: Expose the method on `VoiceService`**

If `VoiceService` wraps `AudioManager` calls, add a matching method:

```csharp
public void SetProcessingStack(ProcessingStack stack) => _audioManager.SetProcessingStack(stack);
```

- [ ] **Step 4: Build**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/Voice/
git commit -m "feat(bridge): route voice.setProcessingStack messages"
```

---

### Task 8: React UI — stack selector dropdown

**Files:**
- Modify: existing Voice settings React component (locate via grep below)
- Create: `src/Brmble.Web/src/components/Settings/Voice/ProcessingStackSelect.tsx`

- [ ] **Step 1: Locate the existing Voice settings component**

```bash
grep -rn "setDenoiseMode\|denoiseMode" src/Brmble.Web/src/
```

Note the file that renders the Denoise Mode control. The stack selector will be added inline next to it.

- [ ] **Step 2: Create the dropdown component**

`src/Brmble.Web/src/components/Settings/Voice/ProcessingStackSelect.tsx`:

```tsx
import React from "react";

export type ProcessingStack = "None" | "Legacy" | "WebRtcApm";

export const PROCESSING_STACKS: { value: ProcessingStack; label: string; description: string }[] = [
  { value: "None", label: "None", description: "Raw passthrough — no processing." },
  { value: "Legacy", label: "Legacy (default)", description: "Amplitude AGC + RNNoise." },
  { value: "WebRtcApm", label: "WebRTC APM (experimental)", description: "AGC2 + noise suppression + high-pass filter." },
];

interface Props {
  value: ProcessingStack;
  onChange: (stack: ProcessingStack) => void;
}

export const ProcessingStackSelect: React.FC<Props> = ({ value, onChange }) => {
  const selected = PROCESSING_STACKS.find((s) => s.value === value) ?? PROCESSING_STACKS[1];
  return (
    <div className="setting-row">
      <label className="setting-label">Audio processing stack (experimental)</label>
      <select
        className="setting-input"
        value={value}
        onChange={(e) => onChange(e.target.value as ProcessingStack)}
      >
        {PROCESSING_STACKS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <small className="setting-hint">{selected.description}</small>
    </div>
  );
};
```

- [ ] **Step 3: Wire it into the Voice settings component**

In the component found in Step 1, import the new component and add local state for the stack. Persist it through the same storage mechanism used by Denoise Mode. Trigger the bridge call on change:

```tsx
import { ProcessingStackSelect, ProcessingStack } from "./ProcessingStackSelect";

// ... inside the component:
const [stack, setStack] = useState<ProcessingStack>(settings.processingStack ?? "Legacy");

const onStackChange = (s: ProcessingStack) => {
  setStack(s);
  settingsStore.set("processingStack", s);
  window.chrome.webview.postMessage({ type: "voice.setProcessingStack", stack: s });
};

// In JSX, next to the denoise mode control:
<ProcessingStackSelect value={stack} onChange={onStackChange} />
```

(The exact store/postMessage patterns must match the denoise mode implementation. Copy the convention from there exactly.)

- [ ] **Step 4: Build the frontend**

```bash
cd src/Brmble.Web && npm run build && cd ../..
```

Expected: build succeeds.

- [ ] **Step 5: Smoke-test in-app**

Run the client, open Settings → Voice, confirm the dropdown renders and changing it writes `[Audio] Processing stack set to <value>` to `%LocalAppData%/Brmble/audio.log`.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Web/src/
git commit -m "feat(ui): add processing stack selector in Voice settings"
```

---

### Task 9: Create `tools/ApmBench` console project

**Files:**
- Create: `tools/ApmBench/ApmBench.csproj`
- Create: `tools/ApmBench/Program.cs`
- Modify: `Brmble.sln`

- [ ] **Step 1: Create the project file**

`tools/ApmBench/ApmBench.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>Brmble.Tools.ApmBench</RootNamespace>
    <AssemblyName>ApmBench</AssemblyName>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Brmble.Audio\Brmble.Audio.csproj" />
  </ItemGroup>

  <ItemGroup>
    <PackageReference Include="NAudio" Version="2.2.1" />
  </ItemGroup>

</Project>
```

(If NAudio version in the repo differs, match it.)

- [ ] **Step 2: Create a minimal `Program.cs`**

`tools/ApmBench/Program.cs`:

```csharp
namespace Brmble.Tools.ApmBench;

public static class Program
{
    public static int Main(string[] args)
    {
        Console.WriteLine("ApmBench — not implemented yet");
        return 0;
    }
}
```

- [ ] **Step 3: Add to the solution**

```bash
dotnet sln Brmble.sln add tools/ApmBench/ApmBench.csproj
```

- [ ] **Step 4: Build**

```bash
dotnet build tools/ApmBench/ApmBench.csproj
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add tools/ApmBench/ Brmble.sln
git commit -m "feat(tools): scaffold ApmBench console project"
```

---

### Task 10: ApmBench — argument parsing

**Files:**
- Create: `tools/ApmBench/Args.cs`
- Modify: `tools/ApmBench/Program.cs`
- Create: `tests/Brmble.Audio.Tests/ApmBench/ArgsTests.cs` (or inline test)

- [ ] **Step 1: Write a test for argument parsing**

Inline the test in a new test file since `Args` is simple pure logic.

`tests/Brmble.Audio.Tests/ApmBench/ArgsTests.cs`:

```csharp
using Brmble.Audio.Processing;
using Brmble.Tools.ApmBench;
using Xunit;

namespace Brmble.Audio.Tests.ApmBench;

public class ArgsTests
{
    [Fact]
    public void Parse_MinimalValidArgs()
    {
        var a = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "apm" });
        Assert.Equal("a.wav", a.Input);
        Assert.Equal("b.wav", a.Output);
        Assert.Equal(ProcessingStack.WebRtcApm, a.Stack);
        Assert.False(a.Metrics);
    }

    [Fact]
    public void Parse_MetricsFlag()
    {
        var a = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", "legacy", "--metrics" });
        Assert.True(a.Metrics);
    }

    [Theory]
    [InlineData("none", ProcessingStack.None)]
    [InlineData("legacy", ProcessingStack.Legacy)]
    [InlineData("apm", ProcessingStack.WebRtcApm)]
    public void Parse_StackAliases(string alias, ProcessingStack expected)
    {
        var a = Args.Parse(new[] { "--in", "a.wav", "--out", "b.wav", "--stack", alias });
        Assert.Equal(expected, a.Stack);
    }

    [Fact]
    public void Parse_MissingRequired_Throws()
    {
        Assert.Throws<ArgumentException>(() => Args.Parse(new[] { "--in", "a.wav" }));
    }
}
```

The test project must reference `ApmBench`. Add to `tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj`:

```xml
<ItemGroup>
  <ProjectReference Include="..\..\tools\ApmBench\ApmBench.csproj" />
</ItemGroup>
```

- [ ] **Step 2: Run test to verify it fails**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~ArgsTests
```

Expected: FAIL with "The type or namespace name 'Args' could not be found".

- [ ] **Step 3: Write the implementation**

`tools/ApmBench/Args.cs`:

```csharp
using Brmble.Audio.Processing;

namespace Brmble.Tools.ApmBench;

public record Args(string Input, string Output, ProcessingStack Stack, bool Metrics)
{
    public static Args Parse(string[] argv)
    {
        string? input = null, output = null, stackStr = null;
        bool metrics = false;
        for (int i = 0; i < argv.Length; i++)
        {
            switch (argv[i])
            {
                case "--in": input = argv[++i]; break;
                case "--out": output = argv[++i]; break;
                case "--stack": stackStr = argv[++i]; break;
                case "--metrics": metrics = true; break;
                default: throw new ArgumentException($"unknown flag: {argv[i]}");
            }
        }
        if (input == null || output == null || stackStr == null)
            throw new ArgumentException("required: --in <wav> --out <wav> --stack <none|legacy|apm>");
        ProcessingStack stack = stackStr.ToLowerInvariant() switch
        {
            "none" => ProcessingStack.None,
            "legacy" => ProcessingStack.Legacy,
            "apm" or "webrtcapm" => ProcessingStack.WebRtcApm,
            _ => throw new ArgumentException($"unknown stack: {stackStr}"),
        };
        return new Args(input, output, stack, metrics);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~ArgsTests
```

Expected: 5 passed (1 + 1 + 3 from Theory).

- [ ] **Step 5: Commit**

```bash
git add tools/ApmBench/Args.cs tests/Brmble.Audio.Tests/
git commit -m "feat(tools): ApmBench argument parsing"
```

---

### Task 11: ApmBench — metrics calculation

**Files:**
- Create: `tools/ApmBench/Metrics.cs`
- Create: `tests/Brmble.Audio.Tests/ApmBench/MetricsTests.cs`

- [ ] **Step 1: Write tests**

`tests/Brmble.Audio.Tests/ApmBench/MetricsTests.cs`:

```csharp
using Brmble.Tools.ApmBench;
using Xunit;

namespace Brmble.Audio.Tests.ApmBench;

public class MetricsTests
{
    [Fact]
    public void Measure_Silence_ReturnsMinus120dBFS()
    {
        byte[] pcm = new byte[960];
        var m = Metrics.Measure(pcm);
        Assert.True(m.RmsDbfs <= -120.0, $"got {m.RmsDbfs}");
        Assert.Equal(0, m.ClippedSamples);
    }

    [Fact]
    public void Measure_FullScaleTone_ReturnsNearZero()
    {
        // Alternating +32767 / -32768 = full-scale square wave
        byte[] pcm = new byte[960];
        for (int i = 0; i < pcm.Length / 2; i++)
        {
            short s = i % 2 == 0 ? (short)32767 : (short)-32768;
            pcm[i * 2] = (byte)(s & 0xFF);
            pcm[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
        }
        var m = Metrics.Measure(pcm);
        Assert.InRange(m.RmsDbfs, -0.5, 0.5);
        Assert.InRange(m.PeakDbfs, -0.1, 0.1);
    }

    [Fact]
    public void Measure_CountsClippedSamples()
    {
        byte[] pcm = new byte[8];
        // Two samples at int16 extremes = "clipped"
        short[] samples = { short.MaxValue, short.MinValue, 0, 100 };
        for (int i = 0; i < 4; i++)
        {
            pcm[i * 2] = (byte)(samples[i] & 0xFF);
            pcm[i * 2 + 1] = (byte)((samples[i] >> 8) & 0xFF);
        }
        var m = Metrics.Measure(pcm);
        Assert.Equal(2, m.ClippedSamples);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~MetricsTests
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`tools/ApmBench/Metrics.cs`:

```csharp
namespace Brmble.Tools.ApmBench;

public readonly record struct AudioStats(double RmsDbfs, double PeakDbfs, int ClippedSamples, int SampleCount);

public static class Metrics
{
    public static AudioStats Measure(ReadOnlySpan<byte> pcm16)
    {
        int samples = pcm16.Length / 2;
        if (samples == 0) return new AudioStats(-120.0, -120.0, 0, 0);

        double sumSq = 0;
        int peak = 0;
        int clipped = 0;
        for (int i = 0; i < samples; i++)
        {
            short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
            int abs = s == short.MinValue ? short.MaxValue : Math.Abs((int)s);
            if (abs > peak) peak = abs;
            if (s == short.MaxValue || s == short.MinValue) clipped++;
            double n = s / 32768.0;
            sumSq += n * n;
        }

        double rms = Math.Sqrt(sumSq / samples);
        double peakNorm = peak / 32768.0;
        double rmsDbfs = rms > 0 ? 20.0 * Math.Log10(rms) : -120.0;
        double peakDbfs = peakNorm > 0 ? 20.0 * Math.Log10(peakNorm) : -120.0;
        return new AudioStats(rmsDbfs, peakDbfs, clipped, samples);
    }
}
```

- [ ] **Step 4: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~MetricsTests
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tools/ApmBench/Metrics.cs tests/Brmble.Audio.Tests/ApmBench/MetricsTests.cs
git commit -m "feat(tools): ApmBench RMS/peak/clip metrics"
```

---

### Task 12: ApmBench — WAV I/O + main flow

**Files:**
- Modify: `tools/ApmBench/Program.cs`

- [ ] **Step 1: Replace `Program.cs` with the real flow**

`tools/ApmBench/Program.cs`:

```csharp
using System.IO;
using Brmble.Audio.Processing;
using NAudio.Wave;

namespace Brmble.Tools.ApmBench;

public static class Program
{
    public static int Main(string[] argv)
    {
        Args args;
        try { args = Args.Parse(argv); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return 2; }

        byte[] inputPcm;
        WaveFormat inputFormat;
        using (var reader = new WaveFileReader(args.Input))
        {
            if (reader.WaveFormat.SampleRate != 48000 ||
                reader.WaveFormat.Channels != 1 ||
                reader.WaveFormat.BitsPerSample != 16 ||
                reader.WaveFormat.Encoding != WaveFormatEncoding.Pcm)
            {
                Console.Error.WriteLine(
                    $"input must be 48 kHz mono 16-bit PCM; got " +
                    $"{reader.WaveFormat.SampleRate} Hz {reader.WaveFormat.Channels} ch " +
                    $"{reader.WaveFormat.BitsPerSample}-bit {reader.WaveFormat.Encoding}");
                return 3;
            }
            inputFormat = reader.WaveFormat;
            using var ms = new MemoryStream();
            reader.CopyTo(ms);
            inputPcm = ms.ToArray();
        }

        using IAudioCapturePostProcessor processor = args.Stack switch
        {
            ProcessingStack.None => new PassthroughProcessor(),
            ProcessingStack.Legacy => new LegacyAudioProcessor { MaxAmplification = 1.5f },
            ProcessingStack.WebRtcApm => new WebRtcApmProcessor(),
            _ => throw new InvalidOperationException(),
        };

        byte[] outputPcm = new byte[inputPcm.Length + WebRtcApmProcessor.FrameBytes];
        int written = processor.Process(inputPcm, outputPcm);

        using (var writer = new WaveFileWriter(args.Output, inputFormat))
        {
            writer.Write(outputPcm, 0, written);
        }

        if (args.Metrics)
        {
            var inStats = Metrics.Measure(inputPcm);
            var outStats = Metrics.Measure(outputPcm.AsSpan(0, written));
            Console.WriteLine($"Input:    {inStats.RmsDbfs,6:F1} dBFS RMS   {inStats.PeakDbfs,6:F1} dBFS peak   {inStats.ClippedSamples} clipped samples");
            Console.WriteLine($"Output:   {outStats.RmsDbfs,6:F1} dBFS RMS   {outStats.PeakDbfs,6:F1} dBFS peak   {outStats.ClippedSamples} clipped samples");
            Console.WriteLine($"Delta:    {outStats.RmsDbfs - inStats.RmsDbfs,+6:F1} dB RMS      {outStats.PeakDbfs - inStats.PeakDbfs,+6:F1} dB peak");
            double ms = inStats.SampleCount / 48.0;
            Console.WriteLine($"Frames:   {inStats.SampleCount / 480} ({ms:F0} ms)  Stack: {args.Stack}");
        }
        return 0;
    }
}
```

- [ ] **Step 2: Build**

```bash
dotnet build tools/ApmBench/ApmBench.csproj
```

Expected: 0 errors.

- [ ] **Step 3: Manual smoke-test with a generated file**

Generate a 1-second silence WAV with PowerShell and run ApmBench through it:

```powershell
# in repo root
$bytes = New-Object byte[] (2 * 48000)  # 1 s @ 48 kHz mono 16-bit = 96000 bytes
[System.IO.File]::WriteAllBytes("/tmp/silence.raw", $bytes)
# Wrap in WAV header using a helper — or simply re-use a fixture wav once Task 13 adds one.
```

Alternatively defer the manual smoke-test to Task 13 once fixtures are in place.

- [ ] **Step 4: Commit**

```bash
git add tools/ApmBench/Program.cs
git commit -m "feat(tools): ApmBench end-to-end WAV processing"
```

---

### Task 13: Add Chromium fixture WAVs + README

**Files:**
- Create: `tests/Brmble.Audio.Tests/fixtures/apm/near_speech.wav`
- Create: `tests/Brmble.Audio.Tests/fixtures/apm/far_end.wav`
- Create: `tests/Brmble.Audio.Tests/fixtures/apm/noise_speech.wav`
- Create: `tests/Brmble.Audio.Tests/fixtures/apm/README.md`

- [ ] **Step 1: Download the fixtures**

Chromium's `src/resources/voice_engine/` tree (BSD-3) contains reference test WAVs used by WebRTC's APM test suite. Fetch three representative 48 kHz mono 16-bit clips:

- `audio_processing/near32.pcm` (or the already-wrapped `.wav` equivalent) — canonical near-end speech.
- `audio_processing/far32.pcm` — far-end speech (for future AEC work).
- `audio_processing/ref-files/...` — speech + low-level noise.

Exact upstream paths shift between Chromium revisions; pin to a revision SHA at download time and record it in the README. If only PCM files are available, convert them to WAV using `ffmpeg -f s16le -ar 48000 -ac 1 -i near32.pcm near_speech.wav`.

Target: three WAV files, each 5–10 seconds, totalling <= 2 MB.

- [ ] **Step 2: Verify format**

For each WAV, run:

```bash
dotnet run --project tools/ApmBench -- --in tests/Brmble.Audio.Tests/fixtures/apm/near_speech.wav --out /tmp/tmp.wav --stack none
```

Expected: exit code 0, `/tmp/tmp.wav` written, byte-identical to input (`diff` them).

If the tool reports "input must be 48 kHz mono 16-bit PCM", re-encode the fixture.

- [ ] **Step 3: Add the README**

`tests/Brmble.Audio.Tests/fixtures/apm/README.md`:

```markdown
# APM Test Fixtures

Reference audio for WebRTC APM regression tests, taken from the Chromium
`src/resources/voice_engine/` tree (BSD-3-Clause).

| File               | Upstream path                                 | Duration | Description |
| ------------------ | --------------------------------------------- | -------- | ----------- |
| near_speech.wav    | `audio_processing/near32.pcm`                 | ~X s     | Canonical APM near-end speech |
| far_end.wav        | `audio_processing/far32.pcm`                  | ~X s     | Far-end signal, for future AEC tests |
| noise_speech.wav   | `audio_processing/ref-files/speech_noise.pcm` | ~X s     | Speech with low-level noise |

**Chromium source revision:** <fill in SHA from `https://chromium.googlesource.com/chromium/src/+log/main/resources/voice_engine/`>

## Licence

Chromium source is distributed under the BSD-3-Clause licence. The notice below is reproduced verbatim per clause 1 of that licence; unmodified copies of the test data remain under BSD-3-Clause.

    Copyright 2011 The Chromium Authors. All rights reserved.
    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions are met:
       * Redistributions of source code must retain the above copyright notice,
         this list of conditions and the following disclaimer.
       * Redistributions in binary form must reproduce the above copyright
         notice, this list of conditions and the following disclaimer in the
         documentation and/or other materials provided with the distribution.
       * Neither the name of Google Inc. nor the names of its contributors may
         be used to endorse or promote products derived from this software
         without specific prior written permission.
    THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
    AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
    LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
    SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
    CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
    OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
    OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Fill in each row's "Duration" after download by inspecting with `ffprobe -i <file>`.
```

- [ ] **Step 4: Commit**

```bash
git add tests/Brmble.Audio.Tests/fixtures/apm/
git commit -m "test(audio): add Chromium voice_engine APM fixtures (BSD-3)"
```

---

### Task 14: ApmBench integration test against fixtures

**Files:**
- Create: `tests/Brmble.Audio.Tests/ApmBenchIntegrationTests.cs`

- [ ] **Step 1: Write the tests**

`tests/Brmble.Audio.Tests/ApmBenchIntegrationTests.cs`:

```csharp
using System.IO;
using Brmble.Audio.Processing;
using Brmble.Tools.ApmBench;
using NAudio.Wave;
using Xunit;

namespace Brmble.Audio.Tests;

public class ApmBenchIntegrationTests
{
    public static readonly string FixturesDir =
        Path.Combine(Path.GetDirectoryName(typeof(ApmBenchIntegrationTests).Assembly.Location)!, "fixtures", "apm");

    [Theory]
    [InlineData("near_speech.wav", ProcessingStack.None)]
    [InlineData("near_speech.wav", ProcessingStack.Legacy)]
    [InlineData("near_speech.wav", ProcessingStack.WebRtcApm)]
    [InlineData("noise_speech.wav", ProcessingStack.None)]
    [InlineData("noise_speech.wav", ProcessingStack.Legacy)]
    [InlineData("noise_speech.wav", ProcessingStack.WebRtcApm)]
    public void RunStackAgainstFixture_ProducesValidOutput(string fixture, ProcessingStack stack)
    {
        string inPath = Path.Combine(FixturesDir, fixture);
        string outPath = Path.Combine(Path.GetTempPath(), $"{Path.GetFileNameWithoutExtension(fixture)}-{stack}.wav");

        int exit = Program.Main(new[] { "--in", inPath, "--out", outPath, "--stack", StackArg(stack) });
        Assert.Equal(0, exit);

        using var reader = new WaveFileReader(outPath);
        Assert.Equal(48000, reader.WaveFormat.SampleRate);
        Assert.Equal(1, reader.WaveFormat.Channels);
        Assert.Equal(16, reader.WaveFormat.BitsPerSample);
        Assert.True(reader.Length > 0, "output must not be empty");

        // Sanity: output RMS is within a broad range of the input.
        using var rdrIn = new WaveFileReader(inPath);
        var inStats = ReadStats(rdrIn);
        var outStats = ReadStats(new WaveFileReader(outPath));
        Assert.InRange(outStats.RmsDbfs, inStats.RmsDbfs - 15, inStats.RmsDbfs + 15);
    }

    private static AudioStats ReadStats(WaveFileReader r)
    {
        using var ms = new MemoryStream();
        r.CopyTo(ms);
        return Metrics.Measure(ms.ToArray());
    }

    private static string StackArg(ProcessingStack stack) => stack switch
    {
        ProcessingStack.None => "none",
        ProcessingStack.Legacy => "legacy",
        ProcessingStack.WebRtcApm => "apm",
        _ => throw new InvalidOperationException(),
    };
}
```

Also, the test project needs to copy the fixtures folder into the test output. Edit `tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj`:

```xml
<ItemGroup>
  <None Include="fixtures\**\*">
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    <CopyToPublishDirectory>PreserveNewest</CopyToPublishDirectory>
  </None>
</ItemGroup>
```

- [ ] **Step 2: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~ApmBenchIntegrationTests
```

Expected: 6 passed.

- [ ] **Step 3: Commit**

```bash
git add tests/Brmble.Audio.Tests/
git commit -m "test(tools): ApmBench integration tests across fixtures × stacks"
```

---

### Task 15: `FixtureWaveProvider` — virtual mic source (TDD)

**Files:**
- Create: `src/Brmble.Client/Services/Voice/FixtureWaveProvider.cs`
- Create: `tests/Brmble.Audio.Tests/FixtureWaveProviderTests.cs`

Because the tests need access to the `FixtureWaveProvider` type which sits in `Brmble.Client`, the tests live in a test project that already references it (or we add the reference). If `Brmble.Client` is WinExe and can't be referenced, move `FixtureWaveProvider` to `Brmble.Audio.Processing` instead (it has no Windows-only dependencies — it's pure `IWaveIn` + `Timer`).

**Revised decision:** place in `src/Brmble.Audio/Processing/FixtureWaveProvider.cs` to keep it testable without the WinExe reference issue.

- [ ] **Step 1: Write tests**

`tests/Brmble.Audio.Tests/Processing/FixtureWaveProviderTests.cs`:

```csharp
using System.Threading;
using Brmble.Audio.Processing;
using NAudio.Wave;
using Xunit;

namespace Brmble.Audio.Tests.Processing;

public class FixtureWaveProviderTests
{
    [Fact]
    public void Start_EmitsDataAvailableAtCadence()
    {
        // Use one of the fixtures.
        string path = System.IO.Path.Combine(
            System.IO.Path.GetDirectoryName(typeof(FixtureWaveProviderTests).Assembly.Location)!,
            "fixtures", "apm", "near_speech.wav");

        using var provider = new FixtureWaveProvider(path, frameMs: 20, loop: true);
        int callbacks = 0;
        provider.DataAvailable += (_, e) => Interlocked.Increment(ref callbacks);
        provider.StartRecording();
        Thread.Sleep(250);
        provider.StopRecording();

        // ~250 ms / 20 ms = ~12 callbacks. Allow slack for timer jitter.
        Assert.InRange(callbacks, 6, 20);
    }

    [Fact]
    public void WaveFormat_Is48kMono16Bit()
    {
        string path = System.IO.Path.Combine(
            System.IO.Path.GetDirectoryName(typeof(FixtureWaveProviderTests).Assembly.Location)!,
            "fixtures", "apm", "near_speech.wav");
        using var provider = new FixtureWaveProvider(path, frameMs: 20, loop: true);
        Assert.Equal(48000, provider.WaveFormat.SampleRate);
        Assert.Equal(1, provider.WaveFormat.Channels);
        Assert.Equal(16, provider.WaveFormat.BitsPerSample);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~FixtureWaveProviderTests
```

Expected: FAIL (type not found).

- [ ] **Step 3: Write the implementation**

`src/Brmble.Audio/Processing/FixtureWaveProvider.cs`:

```csharp
using System;
using System.IO;
using System.Threading;
using NAudio.Wave;

namespace Brmble.Audio.Processing;

/// <summary>
/// An <see cref="IWaveIn"/> implementation that emits frames read from a WAV file
/// on a timer, loop-playing if configured. Used to replace the microphone for A/B
/// testing via the "Replay test fixture" Advanced setting.
/// Requires input file at 48 kHz mono 16-bit PCM.
/// </summary>
public sealed class FixtureWaveProvider : IWaveIn
{
    public WaveFormat WaveFormat { get; }
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    private readonly byte[] _fileBytes;
    private readonly int _frameBytes;
    private readonly int _frameMs;
    private readonly bool _loop;
    private Timer? _timer;
    private int _readPos;

    public FixtureWaveProvider(string wavPath, int frameMs = 20, bool loop = true)
    {
        _frameMs = frameMs;
        _loop = loop;
        using var reader = new WaveFileReader(wavPath);
        if (reader.WaveFormat.SampleRate != 48000 ||
            reader.WaveFormat.Channels != 1 ||
            reader.WaveFormat.BitsPerSample != 16)
        {
            throw new InvalidDataException($"fixture must be 48 kHz mono 16-bit; got {reader.WaveFormat}");
        }
        WaveFormat = reader.WaveFormat;
        using var ms = new MemoryStream();
        reader.CopyTo(ms);
        _fileBytes = ms.ToArray();
        _frameBytes = 48 * frameMs * 2; // 48 samples/ms * frameMs * 2 bytes/sample
    }

    public void StartRecording()
    {
        _readPos = 0;
        _timer = new Timer(Tick, null, 0, _frameMs);
    }

    public void StopRecording()
    {
        _timer?.Dispose();
        _timer = null;
        RecordingStopped?.Invoke(this, new StoppedEventArgs());
    }

    private void Tick(object? _)
    {
        try
        {
            var frame = new byte[_frameBytes];
            int need = _frameBytes;
            int offset = 0;
            while (need > 0)
            {
                int available = _fileBytes.Length - _readPos;
                if (available <= 0)
                {
                    if (!_loop) { StopRecording(); return; }
                    _readPos = 0;
                    available = _fileBytes.Length;
                }
                int take = Math.Min(need, available);
                Buffer.BlockCopy(_fileBytes, _readPos, frame, offset, take);
                _readPos += take;
                offset += take;
                need -= take;
            }
            DataAvailable?.Invoke(this, new WaveInEventArgs(frame, _frameBytes));
        }
        catch (Exception ex)
        {
            RecordingStopped?.Invoke(this, new StoppedEventArgs(ex));
        }
    }

    public void Dispose()
    {
        StopRecording();
    }
}
```

- [ ] **Step 4: Run tests**

```bash
dotnet test tests/Brmble.Audio.Tests/Brmble.Audio.Tests.csproj --filter FullyQualifiedName~FixtureWaveProviderTests
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Audio/Processing/FixtureWaveProvider.cs tests/Brmble.Audio.Tests/Processing/FixtureWaveProviderTests.cs
git commit -m "feat(audio): add FixtureWaveProvider for virtual-mic replay"
```

---

### Task 16: Wire virtual mic into `AudioManager`

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs`

- [ ] **Step 1: Add virtual-mic state fields**

Near the other capture-side fields:

```csharp
// Virtual mic (Testing subsection). Not persisted across restarts.
private string? _virtualMicPath;
private volatile bool _virtualMicActive;
```

- [ ] **Step 2: Add a public setter**

Alongside `SetProcessingStack`:

```csharp
public void SetVirtualMic(string? wavPath)
{
    lock (_lock)
    {
        _virtualMicPath = string.IsNullOrWhiteSpace(wavPath) ? null : wavPath;
        _virtualMicActive = _virtualMicPath != null;
        AudioLog.Write($"[Audio] Virtual mic {(_virtualMicActive ? $"enabled: {_virtualMicPath}" : "disabled")}");

        // If mic is currently running, restart it so StartMicCapture picks the right source.
        if (_micStarted)
        {
            StopMicCaptureLocked();
            StartMicCaptureLocked();
        }
    }
}
```

- [ ] **Step 3: Split `StartMicCapture` so it can be driven from two entry points**

Refactor the existing `StartMicCapture` body into `StartMicCaptureLocked()` (runs under `_lock`), and leave a public wrapper that acquires the lock. Inside `StartMicCaptureLocked`, just before constructing `WasapiCapture`, add:

```csharp
if (_virtualMicActive && _virtualMicPath != null)
{
    _waveIn = new FixtureWaveProvider(_virtualMicPath, frameMs: 20, loop: true);
    _waveIn.DataAvailable += OnMicData;
    _waveIn.StartRecording();
    _micStarted = true;
    AudioLog.Write("[Audio] Mic started (virtual — fixture replay)");
    return;
}
```

- [ ] **Step 4: Bypass PTT/VAD gates during virtual mic**

At the top of `OnMicData`, after the existing mute check, insert:

```csharp
bool virtualMic = _virtualMicActive;
if (_muted) return;
if (!virtualMic && _transmissionMode == TransmissionMode.PushToTalk && !_pttActive) return;
```

Lower down, in the VAD gate:

```csharp
if (!virtualMic && _transmissionMode == TransmissionMode.VoiceActivity &&
    !IsAboveThreshold(processedBuffer, processedBytes)) return;
```

- [ ] **Step 5: Build + smoke-test**

```bash
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat(audio): wire virtual-mic replay path into AudioManager"
```

---

### Task 17: Bridge + React UI for virtual mic

**Files:**
- Modify: file handling the voice bridge dispatch (same file as Task 7)
- Modify: voice settings React component
- Create: `src/Brmble.Web/src/components/Settings/Voice/VirtualMicControls.tsx`

- [ ] **Step 1: Add bridge handler**

In the same file that handles `voice.setProcessingStack`, add:

```csharp
case "voice.setVirtualMic":
{
    string? path = payload.TryGetProperty("path", out var p) ? p.GetString() : null;
    _audioManager.SetVirtualMic(path);
    break;
}
```

- [ ] **Step 2: Create the React controls**

`src/Brmble.Web/src/components/Settings/Voice/VirtualMicControls.tsx`:

```tsx
import React, { useState } from "react";

const BUILTIN_FIXTURES = [
  "near_speech.wav",
  "far_end.wav",
  "noise_speech.wav",
];

interface Props {
  fixturesBasePath: string;
  onChange: (path: string | null) => void;
}

export const VirtualMicControls: React.FC<Props> = ({ fixturesBasePath, onChange }) => {
  const [enabled, setEnabled] = useState(false);
  const [fixture, setFixture] = useState<string>(BUILTIN_FIXTURES[0]);

  const toggle = (on: boolean) => {
    setEnabled(on);
    onChange(on ? `${fixturesBasePath}/${fixture}` : null);
  };

  const pickFixture = (f: string) => {
    setFixture(f);
    if (enabled) onChange(`${fixturesBasePath}/${f}`);
  };

  return (
    <fieldset className="setting-group setting-testing">
      <legend>Testing</legend>
      <label className="setting-row">
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
        Replay test fixture instead of microphone
      </label>
      <label className="setting-row">
        Fixture:
        <select value={fixture} onChange={(e) => pickFixture(e.target.value)} disabled={!enabled}>
          {BUILTIN_FIXTURES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>
      <small className="setting-hint">
        Replaces the live microphone with a pre-recorded fixture for A/B comparison.
        Resets to off on every launch.
      </small>
    </fieldset>
  );
};
```

- [ ] **Step 3: Wire it into the Voice settings component**

Below the stack selector added in Task 8:

```tsx
import { VirtualMicControls } from "./VirtualMicControls";

// ... inside JSX, below the ProcessingStackSelect:
<VirtualMicControls
  fixturesBasePath="./fixtures/apm"
  onChange={(path) =>
    window.chrome.webview.postMessage({ type: "voice.setVirtualMic", path })
  }
/>
```

The client must ship the fixtures folder so the frontend can reference them. Add to `src/Brmble.Client/Brmble.Client.csproj` near the `CopyWebDist` target:

```xml
<ItemGroup>
  <None Include="..\..\tests\Brmble.Audio.Tests\fixtures\apm\*.wav">
    <Link>fixtures\apm\%(FileName)%(Extension)</Link>
    <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  </None>
</ItemGroup>
```

- [ ] **Step 4: Build frontend + client**

```bash
cd src/Brmble.Web && npm run build && cd ../..
dotnet build src/Brmble.Client/Brmble.Client.csproj
```

Expected: 0 errors.

- [ ] **Step 5: Smoke-test**

Run the client, open Settings → Voice, scroll to Testing, enable "Replay test fixture". Have a peer listen on Mumble — they should hear the fixture looping without you speaking. Disable the toggle and confirm your live mic returns.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): add virtual-mic controls under Settings → Voice → Testing"
```

---

### Task 18: End-to-end manual smoke test + changelog entry

**Files:**
- Modify: `CHANGELOG.md` (if the repo has one; otherwise skip)

- [ ] **Step 1: Manual checklist — run through every stack**

Run the client (`dotnet run --project src/Brmble.Client`), then:

1. Settings → Voice. Confirm the stack dropdown renders, default is Legacy.
2. Switch to None. Speak. Your peer hears raw voice, noticeably quieter and not denoised.
3. Switch to Legacy. Speak. Behaviour matches the pre-plan client (AGC + RNNoise if enabled).
4. Switch to WebRTC APM. Speak. Voice is leveled and denoised; peer reports cleaner audio.
5. Enable Testing → Replay test fixture (near_speech.wav). Peer hears the fixture loop, regardless of PTT/VAD.
6. Disable Testing toggle, restart client — toggle must come back disabled (not persisted).

Verify `%LocalAppData%/Brmble/audio.log` shows a `Processing stack set to X` line on every change and a `Virtual mic enabled/disabled` line on every toggle.

- [ ] **Step 2: Full test suite**

```bash
dotnet test
```

Expected: all tests pass, including the three `ProcessorTests`, `ApmBenchIntegrationTests`, and `FixtureWaveProviderTests`.

- [ ] **Step 3: Update CHANGELOG (if present)**

If the repo has `CHANGELOG.md`, add an entry under an Unreleased section:

```markdown
### Added
- Audio processing stack selector (experimental) in Settings → Voice. Options: None, Legacy (default), WebRTC APM.
- Virtual microphone replay under Settings → Voice → Testing for A/B comparisons.
- `tools/ApmBench` CLI for offline DSP regression: `dotnet run --project tools/ApmBench -- --in x.wav --stack apm --out y.wav --metrics`.
- Chromium voice_engine reference fixtures under `tests/Brmble.Audio.Tests/fixtures/apm/` (BSD-3).

### Changed
- Legacy AGC + RNNoise extracted into `LegacyAudioProcessor` in `Brmble.Audio.Processing`. Behaviour is unchanged when stack is `Legacy` (default).
- `SoundFlow.Extensions.WebRtc.Apm` NuGet moved from `Brmble.Client` to `Brmble.Audio`.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: note audio processing stacks in changelog"
```

---

## Self-Review

**Spec coverage:**

- `IAudioCapturePostProcessor` interface + 3 impls → Tasks 1–5 ✓
- `ProcessingStack` enum, default Legacy → Tasks 2, 6 ✓
- Hot-swap matching `SetDenoiseMode` → Task 6 ✓
- Stack selector inline with Denoise Mode → Task 8 ✓
- Testing subsection with virtual mic → Task 17 ✓
- Bridge plumbing → Tasks 7, 17 ✓
- CLI harness `tools/ApmBench` → Tasks 9–12 ✓
- Fixture WAVs → Task 13 ✓
- Unit tests per processor → Tasks 3, 4, 5 ✓
- Integration tests → Task 14 ✓
- Race-window acceptance → Task 6 (documented in `SetProcessingStack` implementation) ✓
- Rollback via Legacy default → Task 2 (enum default) + Task 6 (`_processingStack = Legacy`) ✓

**Placeholder scan:** grep run across the plan. All "TODO"-shaped strings are either inside code meant to be verbatim or appear in the README template where the engineer must fill in Chromium SHAs. No blocking placeholders.

**Type consistency check:**
- `IAudioCapturePostProcessor.Process(ReadOnlySpan<byte>, Span<byte>) : int` — consistent across all three processors and tests. ✓
- `ProcessingStack { None, Legacy, WebRtcApm }` — consistent. ✓
- `WebRtcApmProcessor.FrameBytes` — public const used by `AudioManager.OnMicData` scratch sizing and by `WebRtcApmProcessorTests`. ✓
- `Args(Input, Output, Stack, Metrics)` record — used in both `Args.Parse` and `Program.Main`. ✓
- `AudioStats(RmsDbfs, PeakDbfs, ClippedSamples, SampleCount)` — defined in `Metrics.cs`, consumed in `Program.cs` and `ApmBenchIntegrationTests`. ✓
- `FixtureWaveProvider` — constructed the same way in tests and in `AudioManager.StartMicCaptureLocked`. ✓

No gaps or contradictions found. Plan is ready to execute.
