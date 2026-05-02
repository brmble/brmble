namespace Brmble.Audio.Processing;

/// <summary>
/// Capture-side noise suppression strength. Maps to WebRTC APM's NS levels,
/// with an extra <see cref="Off"/> option to disable NS while keeping AGC + HPF.
/// </summary>
public enum NoiseSuppressionLevel
{
    Off = 0,
    Low = 1,
    Moderate = 2,
    High = 3,
    VeryHigh = 4,
}
