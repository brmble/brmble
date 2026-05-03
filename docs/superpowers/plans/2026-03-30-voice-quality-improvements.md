# Voice Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve outgoing voice quality to match/exceed Mumble by replacing the linear interpolation resampler with r8brain-free-src, tuning Opus encoder settings, and fixing encoder hot-reload.

**Architecture:** Three independent improvements stacked bottom-up: (1) Opus encoder CTL properties + tuning in MumbleVoiceEngine, (2) r8brain P/Invoke wrapper + native DLL in MumbleVoiceEngine, (3) integration in AudioManager + encoder hot-reload fix. Each task builds on the previous.

**Tech Stack:** C#/.NET 10, Opus via P/Invoke, r8brain-free-src v6.5 via P/Invoke, MSTest, NAudio

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/MumbleVoiceEngine/Codec/OpusNative.cs` | **Modify** — Add CTL enum values for Complexity, Signal, Bandwidth, DTX, PacketLoss |
| `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs` | **Modify** — Add Complexity, SignalType, Bandwidth, Dtx, PacketLossPercentage properties |
| `lib/MumbleVoiceEngine/Codec/OpusSignalType.cs` | **Create** — Enum for Opus signal type |
| `lib/MumbleVoiceEngine/Codec/OpusBandwidth.cs` | **Create** — Enum for Opus bandwidth |
| `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs` | **Modify** — Add dtx param, initialSequence param, CurrentSequence property, new Opus defaults |
| `lib/MumbleVoiceEngine/Native/R8BrainNative.cs` | **Create** — P/Invoke declarations for r8bsrc.dll |
| `lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs` | **Create** — Managed wrapper around r8brain native API |
| `lib/MumbleVoiceEngine/Native/r8bsrc.dll` | **Create** — Pre-built Win64 native DLL from r8brain-free-src repo |
| `lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj` | **Modify** — Add r8bsrc.dll to NativeLibraries |
| `src/Brmble.Client/Services/Voice/AudioManager.cs` | **Modify** — Replace linear resampling with R8BrainResampler, add DTX support, fix hot-reload |
| `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs` | **Modify** — Replace linear interpolation with R8BrainResampler |
| `src/Brmble.Client/Services/Voice/MumbleAdapter.cs` | **Modify** — Pass DTX based on transmission mode |
| `tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs` | **Modify** — Add tests for new CTL properties |
| `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs` | **Modify** — Add tests for DTX, initialSequence, VBR |
| `tests/MumbleVoiceEngine.Tests/Audio/R8BrainResamplerTest.cs` | **Create** — Tests for r8brain wrapper |

---

### Task 1: Add Opus CTL Constants

**Files:**
- Modify: `lib/MumbleVoiceEngine/Codec/OpusNative.cs:106-114`

- [ ] **Step 1: Write the failing test**

Add to `tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs`:

```csharp
[TestMethod]
public void Encoder_ComplexityProperty_CanBeSet()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.Complexity = 10;
    Assert.AreEqual(10, encoder.Complexity);
}

[TestMethod]
public void Encoder_SignalTypeProperty_CanBeSet()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.SignalType = OpusSignalType.Voice;
    Assert.AreEqual(OpusSignalType.Voice, encoder.SignalType);
}

[TestMethod]
public void Encoder_BandwidthProperty_CanBeSet()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.Bandwidth = OpusBandwidth.Fullband;
    Assert.AreEqual(OpusBandwidth.Fullband, encoder.Bandwidth);
}

[TestMethod]
public void Encoder_DtxProperty_CanBeSet()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.Dtx = true;
    Assert.IsTrue(encoder.Dtx);
}

[TestMethod]
public void Encoder_PacketLossPercentageProperty_CanBeSet()
{
    using var encoder = new OpusEncoder(48000, 1);
    encoder.PacketLossPercentage = 3;
    Assert.AreEqual(3, encoder.PacketLossPercentage);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Complexity|SignalType|Bandwidth|Dtx|PacketLoss" -v n`
Expected: FAIL — properties don't exist yet

- [ ] **Step 3: Create OpusSignalType enum**

Create `lib/MumbleVoiceEngine/Codec/OpusSignalType.cs`:

```csharp
namespace MumbleVoiceEngine.Codec;

public enum OpusSignalType
{
    Auto = -1000,
    Voice = 3001,
    Music = 3002
}
```

- [ ] **Step 4: Create OpusBandwidth enum**

Create `lib/MumbleVoiceEngine/Codec/OpusBandwidth.cs`:

```csharp
namespace MumbleVoiceEngine.Codec;

public enum OpusBandwidth
{
    Narrowband = 1101,
    Mediumband = 1102,
    Wideband = 1103,
    Superwideband = 1104,
    Fullband = 1105
}
```

- [ ] **Step 5: Add CTL constants to OpusNative.cs**

In `lib/MumbleVoiceEngine/Codec/OpusNative.cs`, add to the `Ctl` enum (line 106-114):

```csharp
public enum Ctl
{
    SetBitrateRequest = 4002,
    GetBitrateRequest = 4003,
    SetVbrRequest = 4006,
    GetVbrRequest = 4007,
    SetBandwidthRequest = 4008,
    GetBandwidthRequest = 4009,
    SetComplexityRequest = 4010,
    GetComplexityRequest = 4011,
    SetInbandFecRequest = 4012,
    GetInbandFecRequest = 4013,
    SetPacketLossPercRequest = 4014,
    GetPacketLossPercRequest = 4015,
    SetDtxRequest = 4016,
    GetDtxRequest = 4017,
    SetSignalRequest = 4024,
    GetSignalRequest = 4025
}
```

- [ ] **Step 6: Add properties to OpusEncoder.cs**

In `lib/MumbleVoiceEngine/Codec/OpusEncoder.cs`, add after the `Vbr` property (after line 220):

```csharp
public int Complexity
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int value;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetComplexityRequest, out value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return value;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetComplexityRequest, value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}

public OpusSignalType SignalType
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int value;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetSignalRequest, out value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return (OpusSignalType)value;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetSignalRequest, (int)value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}

public OpusBandwidth Bandwidth
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int value;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetBandwidthRequest, out value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return (OpusBandwidth)value;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetBandwidthRequest, (int)value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}

public bool Dtx
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int value;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetDtxRequest, out value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return value > 0;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetDtxRequest, Convert.ToInt32(value));
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}

public int PacketLossPercentage
{
    get
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        int value;
        var ret = NativeMethods.opus_encoder_ctl_out(_encoder, NativeMethods.Ctl.GetPacketLossPercRequest, out value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
        return value;
    }
    set
    {
        if (_encoder == IntPtr.Zero)
            throw new ObjectDisposedException("OpusEncoder");
        var ret = NativeMethods.opus_encoder_ctl(_encoder, NativeMethods.Ctl.SetPacketLossPercRequest, value);
        if (ret < 0)
            throw new Exception("Encoder error - " + ((NativeMethods.OpusErrors)ret));
    }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Complexity|SignalType|Bandwidth|Dtx|PacketLoss" -v n`
Expected: All 5 new tests PASS

- [ ] **Step 8: Run all existing tests to verify no regressions**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj -v n`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add lib/MumbleVoiceEngine/Codec/OpusNative.cs lib/MumbleVoiceEngine/Codec/OpusEncoder.cs lib/MumbleVoiceEngine/Codec/OpusSignalType.cs lib/MumbleVoiceEngine/Codec/OpusBandwidth.cs tests/MumbleVoiceEngine.Tests/Codec/OpusCodecTest.cs
git commit -m "feat: add Opus CTL properties for Complexity, SignalType, Bandwidth, DTX, PacketLossPercentage"
```

---

### Task 2: Tune EncodePipeline Opus Settings + DTX Support

**Files:**
- Modify: `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`
- Modify: `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs`

- [ ] **Step 1: Write the failing tests**

Add to `tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs`:

```csharp
[TestMethod]
public void Pipeline_UsesVbr_ProducesVariableSizePackets()
{
    var packets = new List<byte[]>();
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: p => packets.Add(p.ToArray()));

    // Submit silence frame
    pipeline.SubmitPcm(new byte[960 * 2]);
    // Submit sine wave frame (more complex → bigger packet with VBR)
    var sine = new byte[960 * 2];
    for (int i = 0; i < 960; i++)
    {
        short s = (short)(Math.Sin(2.0 * Math.PI * 400 * i / 48000) * 16000);
        sine[i * 2] = (byte)(s & 0xFF);
        sine[i * 2 + 1] = (byte)(s >> 8);
    }
    pipeline.SubmitPcm(sine);

    Assert.AreEqual(2, packets.Count);
    // With VBR, silence packet should be smaller than sine packet
    Assert.IsTrue(packets[0].Length < packets[1].Length,
        $"VBR: silence packet ({packets[0].Length}B) should be smaller than sine packet ({packets[1].Length}B)");
}

[TestMethod]
public void Pipeline_WithDtxEnabled_ConstructsSuccessfully()
{
    var packets = new List<byte[]>();
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: p => packets.Add(p.ToArray()),
        dtx: true);

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(1, packets.Count);
}

[TestMethod]
public void Pipeline_InitialSequence_StartsFromGivenValue()
{
    var packets = new List<byte[]>();
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: p => packets.Add(p.ToArray()),
        initialSequence: 42);

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(1, packets.Count);

    using var reader = new PacketReader(new MemoryStream(packets[0], 1, packets[0].Length - 1));
    long seq = reader.ReadVarInt64();
    Assert.AreEqual(42L, seq);
}

[TestMethod]
public void Pipeline_CurrentSequence_ReturnsCorrectValue()
{
    using var pipeline = new EncodePipeline(
        sampleRate: 48000, channels: 1, bitrate: 72000,
        onPacketReady: _ => { });

    Assert.AreEqual(0L, pipeline.CurrentSequence);

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(1L, pipeline.CurrentSequence);

    pipeline.SubmitPcm(new byte[960 * 2]);
    Assert.AreEqual(2L, pipeline.CurrentSequence);
}
```

Add the required `using` at the top of the test file:

```csharp
using System;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "Vbr|Dtx|InitialSequence|CurrentSequence" -v n`
Expected: FAIL — new constructor params don't exist yet

- [ ] **Step 3: Update EncodePipeline**

Replace the full constructor and add `CurrentSequence` in `lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs`:

Add `using MumbleVoiceEngine.Codec;` to the top (for the new enums).

Replace the constructor (lines 21-42):

```csharp
public EncodePipeline(int sampleRate, int channels, int bitrate,
    Action<ReadOnlyMemory<byte>> onPacketReady, int frameSize = 960,
    bool dtx = false, long initialSequence = 0)
{
    _frameSize = frameSize;
    _frameSizeBytes = frameSize * sizeof(short) * channels;
    _accumulator = new byte[_frameSizeBytes];
    _onPacketReady = onPacketReady;
    _sequenceNumber = initialSequence;

    var application = bitrate >= 32000 ? Application.Audio : Application.Voip;
    _encoder = new OpusEncoder(sampleRate, channels, application)
    {
        Bitrate = bitrate,
        EnableForwardErrorCorrection = true,
        Vbr = true,
        Complexity = 10,
        SignalType = OpusSignalType.Voice,
        Bandwidth = OpusBandwidth.Fullband,
        PacketLossPercentage = 3,
        Dtx = dtx
    };

    if (!_encoder.PermittedFrameSizes.Contains(_frameSize))
        throw new ArgumentException(
            $"Frame size {_frameSize} samples is not permitted by the Opus encoder at {sampleRate} Hz. " +
            $"Permitted sizes: {string.Join(", ", _encoder.PermittedFrameSizes)}",
            nameof(frameSize));
}
```

Add `CurrentSequence` property after `SetTarget`:

```csharp
public long CurrentSequence => _sequenceNumber;
```

Remove the `ResetSequence()` method (line 46) — superseded by `initialSequence` constructor param.

- [ ] **Step 4: Fix callers of ResetSequence**

In `src/Brmble.Client/Services/Voice/AudioManager.cs`, in `RecreateEncodePipelineLocked()` (line 326), remove the call to `_encodePipeline.ResetSequence();` — the new constructor accepts `initialSequence` instead.

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj -v n`
Expected: All tests PASS (including the old `SubmitSilenceFrames_ProducesPackets` test — with VBR, silence frames still produce packets, they're just smaller)

- [ ] **Step 6: Commit**

```bash
git add lib/MumbleVoiceEngine/Pipeline/EncodePipeline.cs tests/MumbleVoiceEngine.Tests/Pipeline/EncodePipelineTest.cs src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: tune Opus encoder — VBR, complexity 10, voice signal, fullband, DTX support"
```

---

### Task 3: Add r8brain Native DLL and P/Invoke Wrapper

**Files:**
- Create: `lib/MumbleVoiceEngine/Native/r8bsrc.dll`
- Create: `lib/MumbleVoiceEngine/Native/R8BrainNative.cs`
- Create: `lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs`
- Modify: `lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj`
- Create: `tests/MumbleVoiceEngine.Tests/Audio/R8BrainResamplerTest.cs`

- [ ] **Step 1: Download r8bsrc.dll**

Download the pre-built Win64 DLL from the r8brain-free-src GitHub repo:

```bash
curl -L -o /c/dev/brmble/brmble/lib/MumbleVoiceEngine/Native/r8bsrc.dll "https://github.com/avaneev/r8brain-free-src/raw/master/DLL/Win64/r8bsrc.dll"
```

Verify it downloaded correctly:

```bash
ls -la /c/dev/brmble/brmble/lib/MumbleVoiceEngine/Native/r8bsrc.dll
```

- [ ] **Step 2: Add DLL to csproj**

In `lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj`, add to the `NativeLibraries` ItemGroup:

```xml
<Content Include="Native\r8bsrc.dll" Link="r8bsrc.dll" CopyToOutputDirectory="Always" />
```

- [ ] **Step 3: Write the failing tests**

Create `tests/MumbleVoiceEngine.Tests/Audio/R8BrainResamplerTest.cs`:

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting;
using MumbleVoiceEngine.Audio;
using System;

namespace MumbleVoiceEngine.Tests.Audio
{
    [TestClass]
    public class R8BrainResamplerTest
    {
        [TestMethod]
        public void Resample_SameRate_ReturnsInputLength()
        {
            using var resampler = new R8BrainResampler(48000, 48000, 960);
            var input = new double[960];
            for (int i = 0; i < 960; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 48000);

            int outSamples = resampler.Process(input, out double[] output);
            Assert.IsTrue(Math.Abs(outSamples - 960) <= 1,
                $"Same-rate resample should return ~960 samples, got {outSamples}");
        }

        [TestMethod]
        public void Resample_44100To48000_ProducesCorrectRatio()
        {
            using var resampler = new R8BrainResampler(44100, 48000, 441);
            var input = new double[441]; // 10ms at 44.1kHz
            for (int i = 0; i < 441; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 44100);

            // Process several blocks to let the resampler warm up (initial latency)
            int totalOut = 0;
            for (int block = 0; block < 20; block++)
            {
                int n = resampler.Process(input, out _);
                totalOut += n;
            }

            // 20 blocks × 441 samples = 8820 input samples at 44100Hz = 200ms
            // Expected output: 200ms × 48000Hz = 9600 samples (±resampler latency)
            Assert.IsTrue(totalOut > 9000 && totalOut < 10200,
                $"Expected ~9600 total output samples, got {totalOut}");
        }

        [TestMethod]
        public void Resample_48000To16000_Downsamples()
        {
            using var resampler = new R8BrainResampler(48000, 16000, 960);
            var input = new double[960]; // 20ms at 48kHz
            for (int i = 0; i < 960; i++)
                input[i] = Math.Sin(2.0 * Math.PI * 400 * i / 48000);

            int totalOut = 0;
            for (int block = 0; block < 20; block++)
            {
                int n = resampler.Process(input, out _);
                totalOut += n;
            }

            // 20 blocks × 960 = 19200 at 48kHz = 400ms
            // Expected: 400ms × 16000Hz = 6400 (±latency)
            Assert.IsTrue(totalOut > 5800 && totalOut < 7000,
                $"Expected ~6400 total output samples, got {totalOut}");
        }

        [TestMethod]
        public void Clear_ResetsState()
        {
            using var resampler = new R8BrainResampler(48000, 16000, 960);
            var input = new double[960];
            resampler.Process(input, out _);
            resampler.Clear();
            // Should not throw after clear
            resampler.Process(input, out _);
        }

        [TestMethod]
        public void Dispose_PreventsUseAfterFree()
        {
            var resampler = new R8BrainResampler(48000, 16000, 960);
            resampler.Dispose();
            Assert.ThrowsException<ObjectDisposedException>(() =>
                resampler.Process(new double[960], out _));
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "R8Brain" -v n`
Expected: FAIL — classes don't exist yet

- [ ] **Step 5: Create R8BrainNative.cs**

Create `lib/MumbleVoiceEngine/Native/R8BrainNative.cs`:

```csharp
using System;
using System.IO;
using System.Runtime.InteropServices;

namespace MumbleVoiceEngine.Native;

internal enum R8BrainResolution
{
    R16Bit = 0,
    R16BitIR = 1,
    R24Bit = 2
}

internal static class R8BrainNative
{
    private static readonly nint _lib;

    static R8BrainNative()
    {
        var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "r8bsrc.dll");
        _lib = NativeLibrary.Load(path);
        r8b_create = Marshal.GetDelegateForFunctionPointer<r8b_create_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_create"));
        r8b_delete = Marshal.GetDelegateForFunctionPointer<r8b_delete_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_delete"));
        r8b_clear = Marshal.GetDelegateForFunctionPointer<r8b_clear_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_clear"));
        r8b_process = Marshal.GetDelegateForFunctionPointer<r8b_process_delegate>(
            NativeLibrary.GetExport(_lib, "r8b_process"));
    }

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate IntPtr r8b_create_delegate(
        double srcSampleRate, double dstSampleRate,
        int maxInLen, double reqTransBand, R8BrainResolution res);
    internal static readonly r8b_create_delegate r8b_create;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void r8b_delete_delegate(IntPtr rs);
    internal static readonly r8b_delete_delegate r8b_delete;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate void r8b_clear_delegate(IntPtr rs);
    internal static readonly r8b_clear_delegate r8b_clear;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    internal delegate int r8b_process_delegate(
        IntPtr rs, IntPtr ip0, int l, out IntPtr op0);
    internal static readonly r8b_process_delegate r8b_process;
}
```

- [ ] **Step 6: Create R8BrainResampler.cs**

Create `lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs`:

```csharp
using System;
using System.Runtime.InteropServices;
using MumbleVoiceEngine.Native;

namespace MumbleVoiceEngine.Audio;

public sealed class R8BrainResampler : IDisposable
{
    private IntPtr _handle;
    private readonly int _maxInLen;

    public R8BrainResampler(double srcRate, double dstRate, int maxInLen,
        double transitionBand = 2.0)
    {
        _maxInLen = maxInLen;
        _handle = R8BrainNative.r8b_create(
            srcRate, dstRate, maxInLen, transitionBand,
            R8BrainResolution.R24Bit);
        if (_handle == IntPtr.Zero)
            throw new InvalidOperationException("Failed to create r8brain resampler");
    }

    public int Process(double[] input, out double[] output)
    {
        if (_handle == IntPtr.Zero)
            throw new ObjectDisposedException(nameof(R8BrainResampler));

        var pinned = GCHandle.Alloc(input, GCHandleType.Pinned);
        try
        {
            int outSamples = R8BrainNative.r8b_process(
                _handle, pinned.AddrOfPinnedObject(), input.Length, out IntPtr outPtr);

            if (outSamples > 0 && outPtr != IntPtr.Zero)
            {
                output = new double[outSamples];
                Marshal.Copy(outPtr, output, 0, outSamples);
            }
            else
            {
                output = Array.Empty<double>();
            }

            return outSamples;
        }
        finally
        {
            pinned.Free();
        }
    }

    public void Clear()
    {
        if (_handle == IntPtr.Zero)
            throw new ObjectDisposedException(nameof(R8BrainResampler));
        R8BrainNative.r8b_clear(_handle);
    }

    public void Dispose()
    {
        if (_handle != IntPtr.Zero)
        {
            R8BrainNative.r8b_delete(_handle);
            _handle = IntPtr.Zero;
        }
    }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj --filter "R8Brain" -v n`
Expected: All 5 tests PASS

- [ ] **Step 8: Run all tests to verify no regressions**

Run: `dotnet test tests/MumbleVoiceEngine.Tests/MumbleVoiceEngine.Tests.csproj -v n`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add lib/MumbleVoiceEngine/Native/r8bsrc.dll lib/MumbleVoiceEngine/Native/R8BrainNative.cs lib/MumbleVoiceEngine/Audio/R8BrainResampler.cs lib/MumbleVoiceEngine/MumbleVoiceEngine.csproj tests/MumbleVoiceEngine.Tests/Audio/R8BrainResamplerTest.cs
git commit -m "feat: add r8brain-free-src resampler via P/Invoke"
```

---

### Task 4: Replace Linear Resampling in AudioManager

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:136-230` (fields), `624-698` (OnMicData)

- [ ] **Step 1: Add r8brain resampler field**

In `src/Brmble.Client/Services/Voice/AudioManager.cs`, add after the speech enhancement fields (after line 224):

```csharp
// Device→48kHz resampler (r8brain)
private R8BrainResampler? _deviceResampler;
private int _deviceSampleRate;
```

Add `using MumbleVoiceEngine.Audio;` at the top if not already present.

- [ ] **Step 2: Add double[] scratch buffer**

After the existing `[ThreadStatic]` scratch buffers (line 622):

```csharp
[ThreadStatic] private static double[]? _resampleDoubleScratch;
```

- [ ] **Step 3: Replace inline linear resampling in OnMicData**

Replace the resampling block in `OnMicData` (lines 660-682) with:

```csharp
// Resample from device sample rate to 48kHz if needed.
float[] monoAt48k;
int srcRate = fmt.SampleRate;
if (srcRate != 48000)
{
    // Create or recreate r8brain resampler if device rate changed
    if (_deviceResampler == null || _deviceSampleRate != srcRate)
    {
        _deviceResampler?.Dispose();
        _deviceSampleRate = srcRate;
        _deviceResampler = new R8BrainResampler(srcRate, 48000, monoFrames);
    }

    // Convert float→double for r8brain
    if (_resampleDoubleScratch == null || _resampleDoubleScratch.Length < monoFrames)
        _resampleDoubleScratch = new double[monoFrames];
    for (int i = 0; i < monoFrames; i++)
        _resampleDoubleScratch[i] = _wasapiMonoScratch[i];

    var inputSlice = new double[monoFrames];
    Array.Copy(_resampleDoubleScratch, inputSlice, monoFrames);

    int outSamples = _deviceResampler.Process(inputSlice, out double[] resampledDouble);

    var resampled = new float[outSamples];
    for (int i = 0; i < outSamples; i++)
        resampled[i] = (float)resampledDouble[i];

    monoAt48k = resampled;
    monoFrames = outSamples;
}
else
{
    monoAt48k = _wasapiMonoScratch;
}
```

- [ ] **Step 4: Dispose device resampler on StopMic and Dispose**

In `StopMic()` (around line 610), add before `_micStarted = false`:

```csharp
_deviceResampler?.Dispose();
_deviceResampler = null;
```

In `Dispose()`, add alongside other cleanup:

```csharp
_deviceResampler?.Dispose();
_deviceResampler = null;
```

- [ ] **Step 5: Build to verify compilation**

Run: `dotnet build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: replace linear interpolation with r8brain resampler in AudioManager"
```

---

### Task 5: Replace Linear Resampling in Speech Enhancement Path

**Files:**
- Modify: `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs`
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:330-347` (ConfigureSpeechEnhancement)

- [ ] **Step 1: Replace AudioResampler implementation**

Replace the entire contents of `src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs`:

```csharp
using MumbleVoiceEngine.Audio;

namespace Brmble.Client.Services.SpeechEnhancement;

public sealed class AudioResampler : IDisposable
{
    private R8BrainResampler? _resampler;
    private readonly int _sourceRate;
    private readonly int _targetRate;

    public AudioResampler(int sourceRate, int targetRate, int channels)
    {
        _sourceRate = sourceRate;
        _targetRate = targetRate;
        // Max input length: 20ms at source rate is a safe upper bound
        int maxInLen = sourceRate / 1000 * 20;
        _resampler = new R8BrainResampler(sourceRate, targetRate, maxInLen);
    }

    public float[] Resample(ReadOnlySpan<float> input)
    {
        if (input.Length == 0)
            return Array.Empty<float>();

        if (_resampler == null)
            throw new ObjectDisposedException(nameof(AudioResampler));

        // Convert float→double
        var doubleInput = new double[input.Length];
        for (int i = 0; i < input.Length; i++)
            doubleInput[i] = input[i];

        int outSamples = _resampler.Process(doubleInput, out double[] doubleOutput);

        // Convert double→float
        var output = new float[outSamples];
        for (int i = 0; i < outSamples; i++)
            output[i] = (float)doubleOutput[i];

        return output;
    }

    public void Dispose()
    {
        _resampler?.Dispose();
        _resampler = null;
    }
}
```

- [ ] **Step 2: Update ConfigureSpeechEnhancement to dispose resamplers**

In `src/Brmble.Client/Services/Voice/AudioManager.cs`, update `ConfigureSpeechEnhancement` (lines 330-348). Change the null-assignment lines to dispose:

```csharp
public void ConfigureSpeechEnhancement(string modelsPath, bool enabled, GtcrnModelVariant variant)
{
    lock (_lock)
    {
        _speechEnhancement?.Dispose();
        _to16kResampler?.Dispose();
        _to48kResampler?.Dispose();
        _to16kResampler = null;
        _to48kResampler = null;

        if (!enabled)
        {
            _speechEnhancement = null;
            return;
        }

        _speechEnhancement = new SpeechEnhancementService(modelsPath, enabled, variant);
        _to16kResampler = new AudioResampler(48000, 16000, 1);
        _to48kResampler = new AudioResampler(16000, 48000, 1);
    }
}
```

- [ ] **Step 3: Dispose speech enhancement resamplers in AudioManager.Dispose**

In the `Dispose()` method, add alongside the speech enhancement cleanup:

```csharp
_to16kResampler?.Dispose();
_to48kResampler?.Dispose();
```

- [ ] **Step 4: Add project reference if needed**

The `Brmble.Client` project needs to reference `MumbleVoiceEngine` for `R8BrainResampler`. Check if this reference already exists. If not, add it.

Run: `dotnet build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/Brmble.Client/Services/SpeechEnhancement/AudioResampler.cs src/Brmble.Client/Services/Voice/AudioManager.cs
git commit -m "feat: replace linear interpolation with r8brain in speech enhancement path"
```

---

### Task 6: Encoder Hot-Reload Fix + DTX Integration

**Files:**
- Modify: `src/Brmble.Client/Services/Voice/AudioManager.cs:283-328`
- Modify: `src/Brmble.Client/Services/Voice/MumbleAdapter.cs:652-716`

- [ ] **Step 1: Add DTX field to AudioManager**

In `src/Brmble.Client/Services/Voice/AudioManager.cs`, add after `_opusFrameMs` (line 219):

```csharp
private bool _dtxEnabled;
```

- [ ] **Step 2: Add SetDtx method**

Add after `SetOpusFrameMs` (after line 307):

```csharp
public void SetDtx(bool enabled)
{
    lock (_lock)
    {
        if (_dtxEnabled == enabled) return;
        _dtxEnabled = enabled;
        RecreateEncodePipelineLocked();
    }
}
```

- [ ] **Step 3: Update RecreateEncodePipelineLocked for sequence preservation and DTX**

Replace `RecreateEncodePipelineLocked()` (lines 315-328):

```csharp
private void RecreateEncodePipelineLocked()
{
    long seq = _encodePipeline?.CurrentSequence ?? 0;
    _encodePipeline?.Dispose();
    _encodePipeline = null;

    if (_micStarted)
    {
        _encodePipeline = new EncodePipeline(
            sampleRate: 48000, channels: 1, bitrate: _opusBitrate,
            onPacketReady: packet => SendVoicePacket?.Invoke(packet),
            frameSize: 48000 / 1000 * _opusFrameMs,
            dtx: _dtxEnabled,
            initialSequence: seq);
    }
}
```

- [ ] **Step 4: Update MumbleAdapter to set DTX based on transmission mode**

In `src/Brmble.Client/Services/Voice/MumbleAdapter.cs`, update `SetTransmissionMode` (lines 652-668) to set DTX:

```csharp
public void SetTransmissionMode(string mode, string? key)
{
    var parsed = mode switch
    {
        "voiceActivity" => TransmissionMode.VoiceActivity,
        "pushToTalk"    => TransmissionMode.PushToTalk,
        "continuous"    => TransmissionMode.Continuous,
        _ => TransmissionMode.Continuous,
    };
    if (parsed == TransmissionMode.Continuous && mode != "continuous")
        Debug.WriteLine($"[Audio] Unknown transmission mode '{mode}', defaulting to Continuous");

    if (parsed == TransmissionMode.PushToTalk)
        _currentPttKey = key;

    // DTX on for VAD/Continuous (silence suppression), off for PTT
    _audioManager?.SetDtx(parsed != TransmissionMode.PushToTalk);
    _audioManager?.SetTransmissionMode(parsed, key, _hwnd);
}
```

- [ ] **Step 5: Build and run all tests**

Run: `dotnet build && dotnet test -v n`
Expected: Build succeeds, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/Brmble.Client/Services/Voice/AudioManager.cs src/Brmble.Client/Services/Voice/MumbleAdapter.cs
git commit -m "feat: fix encoder hot-reload with sequence preservation, add DTX per transmission mode"
```

---

### Task 7: Full Integration Test

- [ ] **Step 1: Run all tests**

Run: `dotnet test -v n`
Expected: All tests pass

- [ ] **Step 2: Build the production client**

```bash
(cd /c/dev/brmble/brmble/src/Brmble.Web && npm run build)
dotnet build
```
Expected: Successful build

- [ ] **Step 3: Verify r8bsrc.dll is in output**

```bash
ls /c/dev/brmble/brmble/src/Brmble.Client/bin/Debug/net10.0-windows/r8bsrc.dll
```
Expected: File exists

- [ ] **Step 4: Manual PTT voice test**

Run the client and test:
1. Connect to a Mumble server
2. Set transmission mode to Push-to-Talk
3. Hold PTT key and speak — verify clear audio, no artifacts
4. Change bitrate mid-conversation — verify no audio breakage
5. Change frame size mid-conversation — verify no audio breakage
6. Enable RNNoise — verify quality improvement (or at least no degradation)
7. Switch to Voice Activity mode — verify DTX is active (silence packets should be smaller/fewer)

- [ ] **Step 5: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix: integration adjustments for voice quality improvements"
```
