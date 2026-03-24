using MumbleSharp.Audio.Codecs.Opus;

namespace Brmble.Audio.Codecs;

/// <summary>
/// IOpusDecoder wrapper around MumbleSharp's OpusDecoder.
/// Adapts the byte[]-based API to Span-based interface.
/// </summary>
public class MumbleOpusDecoder : IOpusDecoder
{
    // Max Opus frame is 120ms = 5760 samples at 48kHz
    private const int MaxFrameSamples = 5760;
    private readonly OpusDecoder _decoder;
    private readonly byte[] _decodeBuffer;
    private bool _disposed;

    public MumbleOpusDecoder(int sampleRate = 48000, int channels = 1)
    {
        _decoder = new OpusDecoder(sampleRate, channels);
        _decodeBuffer = new byte[MaxFrameSamples * channels * sizeof(short)];
    }

    public int Decode(ReadOnlySpan<byte> encodedData, Span<short> output)
    {
        byte[] encoded = encodedData.ToArray();
        int bytesDecoded = _decoder.Decode(encoded, 0, encoded.Length, _decodeBuffer, 0);
        int samples = bytesDecoded / sizeof(short);

        // Reinterpret byte[] as short[]
        int toCopy = Math.Min(samples, output.Length);
        for (int i = 0; i < toCopy; i++)
        {
            output[i] = (short)(_decodeBuffer[i * 2] | (_decodeBuffer[i * 2 + 1] << 8));
        }

        return toCopy;
    }

    public int DecodePlc(Span<short> output)
    {
        // MumbleSharp's OpusDecoder supports PLC by passing null
        int bytesDecoded = _decoder.Decode(null!, 0, 0, _decodeBuffer, 0);
        int samples = bytesDecoded / sizeof(short);

        int toCopy = Math.Min(samples, output.Length);
        for (int i = 0; i < toCopy; i++)
        {
            output[i] = (short)(_decodeBuffer[i * 2] | (_decodeBuffer[i * 2 + 1] << 8));
        }

        return toCopy;
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _decoder.Dispose();
            _disposed = true;
        }
    }
}
