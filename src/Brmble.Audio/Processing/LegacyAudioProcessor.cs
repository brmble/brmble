using System;
using System.Buffers;

namespace Brmble.Audio.Processing;

/// <summary>
/// Current capture-side stack: RMS-based AGC + optional RNNoise.
/// Holds its own per-frame state; instances are not thread-safe.
/// Algorithm is copied verbatim from AudioManager.ApplyAGC and the
/// inline RNNoise block in AudioManager.OnMicData.
/// </summary>
public sealed class LegacyAudioProcessor : IAudioCapturePostProcessor
{
    /// <summary>Target RMS for AGC quiet-boost. Matches AudioManager.TargetRms.</summary>
    private const float TargetRms = 1500f;

    /// <summary>RMS threshold above which compression kicks in. Matches AudioManager.LoudRms.</summary>
    private const float LoudRms = 8000f;

    /// <summary>
    /// Max amplification factor applied by AGC. 1.0 = off. Matches the
    /// user-facing "Boost amplification" slider (AudioManager._maxAmplification).
    /// </summary>
    public float MaxAmplification { get; set; } = 1.0f;

    /// <summary>
    /// When true, applies RNNoise denoise to the post-AGC signal.
    /// The caller owns the RNNoise instance lifecycle and provides the
    /// processing delegate via <see cref="RnnoiseProcess"/>.
    /// </summary>
    public bool RnnoiseEnabled { get; set; }

    /// <summary>
    /// Hook provided by the caller to run RNNoise on a float frame.
    /// Must accept exactly <see cref="RnnoiseFrameSamples"/> floats.
    /// Returns the denoised frame, or null if this frame was a warm-up
    /// frame (matching RnnoiseService.Process return semantics).
    /// </summary>
    public Func<float[], float[]?>? RnnoiseProcess { get; set; }

    /// <summary>RNNoise frame size: 480 samples = 10 ms at 48 kHz. Matches RnnoiseService.FrameSize.</summary>
    public const int RnnoiseFrameSamples = 480;

    private float[]? _rnnoiseRemainder;

    public int Process(ReadOnlySpan<byte> input, Span<byte> output)
    {
        // Copy input to output first — all subsequent ops are in-place on output.
        input.CopyTo(output);
        int bytesWritten = input.Length;

        if (bytesWritten == 0) return 0;

        if (MaxAmplification != 1.0f)
        {
            ApplyAgcInPlace(output, bytesWritten, MaxAmplification);
        }

        if (RnnoiseEnabled && RnnoiseProcess != null)
        {
            ApplyRnnoiseInPlace(output, bytesWritten);
        }

        return bytesWritten;
    }

    /// <summary>
    /// RMS-based AGC copied verbatim from AudioManager.ApplyAGC.
    /// Quiet audio: boost by min(TargetRms/rms, maxGain).
    /// Loud audio: soft-knee compression toward LoudRms.
    /// </summary>
    private static void ApplyAgcInPlace(Span<byte> pcm16, int bytes, float maxGain)
    {
        long sumSq = 0;
        int samples = bytes / 2;
        for (int i = 0; i < bytes - 1; i += 2)
        {
            short sample = (short)(pcm16[i] | (pcm16[i + 1] << 8));
            sumSq += (long)sample * sample;
        }
        if (samples == 0) return;
        float rms = (float)Math.Sqrt(sumSq / (double)samples);

        float gain = 1.0f;

        if (rms < TargetRms && rms > 0)
        {
            // Quiet audio: apply boost up to maxGain
            float neededBoost = TargetRms / rms;
            gain = Math.Min(neededBoost, maxGain);
        }
        else if (rms > LoudRms)
        {
            // Loud audio: gentle compression
            gain = LoudRms / rms;
            // Soft knee: blend between 1 and gain
            float excess = (rms - LoudRms) / LoudRms;
            gain = 1.0f - (1.0f - gain) * Math.Min(excess * 2, 1.0f);
        }

        if (gain != 1.0f)
        {
            for (int i = 0; i < bytes - 1; i += 2)
            {
                short sample = (short)(pcm16[i] | (pcm16[i + 1] << 8));
                float adjusted = sample * gain;
                adjusted = Math.Clamp(adjusted, short.MinValue, short.MaxValue);
                short clampedSample = (short)adjusted;
                pcm16[i] = (byte)(clampedSample & 0xFF);
                pcm16[i + 1] = (byte)((clampedSample >> 8) & 0xFF);
            }
        }
    }

    /// <summary>
    /// RNNoise block copied verbatim from AudioManager inline RNNoise logic.
    /// Buffers remainder samples across calls to maintain frame alignment.
    /// </summary>
    private void ApplyRnnoiseInPlace(Span<byte> pcm16, int bytesWritten)
    {
        var sampleCount = bytesWritten / 2;
        var totalSamples = sampleCount + (_rnnoiseRemainder?.Length ?? 0);

        // Rent FrameSize * 2 floats — same sizing as AudioManager
        var scratchBuffer = ArrayPool<float>.Shared.Rent(RnnoiseFrameSamples * 2);
        try
        {
            int combinedIndex = 0;

            if (_rnnoiseRemainder != null)
            {
                Array.Copy(_rnnoiseRemainder, 0, scratchBuffer, 0, _rnnoiseRemainder.Length);
                combinedIndex = _rnnoiseRemainder.Length;
                _rnnoiseRemainder = null;
            }

            for (int i = 0; i < sampleCount; i++)
            {
                short s = (short)(pcm16[i * 2] | (pcm16[i * 2 + 1] << 8));
                scratchBuffer[combinedIndex + i] = s / 32768f;
            }

            int offset = 0;
            while (offset + RnnoiseFrameSamples <= combinedIndex + sampleCount)
            {
                var frame = scratchBuffer.AsSpan(offset, RnnoiseFrameSamples);
                var frameCopy = new float[RnnoiseFrameSamples];
                frame.CopyTo(frameCopy);

                var denoised = RnnoiseProcess!(frameCopy);
                if (denoised != null)
                {
                    for (int i = 0; i < RnnoiseFrameSamples; i++)
                    {
                        var sample = (short)Math.Clamp(denoised[i] * 32768f, short.MinValue, short.MaxValue);
                        pcm16[(offset + i) * 2] = (byte)(sample & 0xFF);
                        pcm16[(offset + i) * 2 + 1] = (byte)((sample >> 8) & 0xFF);
                    }
                }

                offset += RnnoiseFrameSamples;
            }

            int remaining = (combinedIndex + sampleCount) - offset;
            if (remaining > 0)
            {
                _rnnoiseRemainder = new float[remaining];
                Array.Copy(scratchBuffer, offset, _rnnoiseRemainder, 0, remaining);
            }
        }
        finally
        {
            ArrayPool<float>.Shared.Return(scratchBuffer);
        }
    }

    public void Dispose()
    {
        _rnnoiseRemainder = null;
    }
}
