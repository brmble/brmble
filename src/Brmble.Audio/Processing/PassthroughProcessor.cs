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
