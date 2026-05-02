namespace Brmble.Audio;

/// <summary>
/// Immutable snapshot of the VAD gate's tunable parameters.
/// Swapped atomically via volatile reference assignment in <see cref="VadGate"/>;
/// the gate reads the snapshot once per frame.
/// </summary>
public sealed record VadGateConfig(
    VadAggressiveness VadMode,
    double OpenRmsThreshold,
    double CloseRmsThreshold,
    int HangoverMs,
    int OnsetLookbackFrames)
{
    public const int DefaultOnsetLookbackFrames = 3;

    public static VadGateConfig FromSensitivity(VadSensitivity level) => level switch
    {
        VadSensitivity.Low =>
            new VadGateConfig(VadAggressiveness.Quality,        150, 60,  300, DefaultOnsetLookbackFrames),
        VadSensitivity.Balanced =>
            new VadGateConfig(VadAggressiveness.Aggressive,     250, 120, 300, DefaultOnsetLookbackFrames),
        VadSensitivity.High =>
            new VadGateConfig(VadAggressiveness.VeryAggressive, 400, 250, 350, DefaultOnsetLookbackFrames),
        _ => throw new ArgumentOutOfRangeException(nameof(level), level, "Unknown sensitivity level"),
    };
}

public enum VadSensitivity
{
    Low,
    Balanced,
    High
}
