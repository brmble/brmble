using System;
using SoundFlow.Extensions.WebRtc.Apm;

namespace Brmble.Audio.Processing;

/// <summary>
/// WebRTC APM wrapper for the mic capture path. Fixed at 48 kHz mono, 10 ms frames.
/// Samples that don't align to a 10 ms boundary are buffered until the next call.
/// Not thread-safe — must be driven from a single thread (the WASAPI capture thread).
/// </summary>
public sealed class WebRtcApmProcessor : IAudioCapturePostProcessor
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
    /// a post-gain of ~1.6-2.0x (4-6 dB) brings output closer to -10 dBFS.
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

    /// <summary>
    /// Processes 16-bit PCM mono at 48 kHz. Writes processed PCM16 into <paramref name="output"/>.
    /// Returns bytes written. Output capacity must be at least <c>input.Length + FrameBytes</c>
    /// to absorb any drained leftover from the previous call.
    /// </summary>
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
