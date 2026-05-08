namespace Brmble.Audio;

/// <summary>
/// Speech / non-speech classifier for one 10 ms frame at 48 kHz mono int16.
/// Implementations must be safe to call from a single capture thread; aggressiveness
/// may be hot-swapped from a different thread (the implementation handles synchronisation).
/// </summary>
public interface IVadDetector
{
    bool IsSpeech(ReadOnlySpan<short> frame);
    VadAggressiveness Mode { get; set; }
}
