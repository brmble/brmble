using Brmble.Audio.Codecs;

namespace Brmble.Audio.Tests.Helpers;

/// <summary>
/// Test double for IOpusDecoder. Generates predictable PCM output:
/// - Decode: fills output with ascending values starting from sequence-based seed
/// - DecodePlc: fills output with a low-amplitude, predictable pattern to simulate basic PLC
/// </summary>
public class FakeOpusDecoder : IOpusDecoder
{
    public const int FrameSize = 960; // 20ms @ 48kHz
    public int DecodeCallCount { get; private set; }
    public int PlcCallCount { get; private set; }

    public int Decode(ReadOnlySpan<byte> encodedData, Span<short> output)
    {
        DecodeCallCount++;
        // Use first byte of payload as seed for predictable output
        short seed = encodedData.Length > 0 ? (short)(encodedData[0] * 100) : (short)0;
        int samples = Math.Min(FrameSize, output.Length);
        for (int i = 0; i < samples; i++)
            output[i] = (short)(seed + i);
        return samples;
    }

    public int DecodePlc(Span<short> output)
    {
        PlcCallCount++;
        int samples = Math.Min(FrameSize, output.Length);
        // PLC generates low-amplitude noise to distinguish from real decode
        for (int i = 0; i < samples; i++)
            output[i] = (short)(i % 10);
        return samples;
    }

    public void Dispose() { }
}
