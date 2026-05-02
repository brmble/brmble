namespace Brmble.Audio;

/// <summary>
/// Output of <see cref="VadGate.Process"/>. Callers switch on the concrete type
/// to decide what to do (submit PCM, emit terminator, or do nothing).
/// </summary>
public abstract record GateDecision
{
    private GateDecision() { }

    /// <summary>Gate stayed closed; drop this frame.</summary>
    public sealed record Stay : GateDecision;

    /// <summary>
    /// Gate transitioned from Closed to Open. The caller must submit every frame in
    /// <paramref name="Frames"/> to the encoder in order. Frames length is at most
    /// <see cref="VadGateConfig.OnsetLookbackFrames"/> + 1 (lookback ring + current).
    /// </summary>
    public sealed record OpenWithLookback(IReadOnlyList<short[]> Frames) : GateDecision;

    /// <summary>Gate stays open; submit <paramref name="Frame"/> to the encoder.</summary>
    public sealed record PassThrough(short[] Frame) : GateDecision;

    /// <summary>
    /// Gate transitioned from Open to Closed. The caller must call
    /// <c>EncodePipeline.EmitTerminator()</c> to flag end-of-transmission.
    /// </summary>
    public sealed record CloseWithTerminator : GateDecision;
}
