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
