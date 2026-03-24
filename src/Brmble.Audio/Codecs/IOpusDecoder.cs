namespace Brmble.Audio.Codecs;

public interface IOpusDecoder : IDisposable
{
    /// <summary>
    /// Decode an encoded Opus packet into PCM samples.
    /// </summary>
    /// <returns>Number of samples written to output.</returns>
    int Decode(ReadOnlySpan<byte> encodedData, Span<short> output);

    /// <summary>
    /// Generate PLC audio using decoder internal state from previous frames.
    /// </summary>
    /// <returns>Number of samples written to output.</returns>
    int DecodePlc(Span<short> output);
}
