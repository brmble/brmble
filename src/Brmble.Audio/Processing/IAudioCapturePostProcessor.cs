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
